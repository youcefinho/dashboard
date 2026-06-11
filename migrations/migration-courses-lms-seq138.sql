-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 138 — SPRINT 43 « Courses LMS avancé — quiz + certificats PDF
-- + drip content + progress tracking détaillé » (2026-05-25)
--
-- ÉTEND Sprint 6 Membership Enroll (seq107) + Sprint 12 Memberships (seq87).
-- NE TOUCHE PAS aux tables existantes `courses` / `course_enrollments` /
-- `course_modules` / `lessons` / `lesson_progress` (seq87) — uniquement
-- 3 ALTER additifs ADD COLUMN sur `courses` + 6 tables NEUVES dédiées au LMS
-- avancé (quiz par leçon, attempts, certificats, progression LMS bornée
-- enrollment_id).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / CREATE
--   TABLE existante / ALTER d'une contrainte existante. Ce lot N'AJOUTE QUE :
--     - 6 `CREATE TABLE IF NOT EXISTS` — course_lessons (LMS lessons avancées,
--       distinctes des `lessons` seq87 — drip délai + ordre + body HTML/MD +
--       video URL), course_quizzes (1+ quiz par leçon, passing_score + max
--       attempts), quiz_questions (multiple_choice|text|true_false, options
--       JSON, correct_answer + points + order), quiz_attempts (tentatives par
--       enrollment_id, score + passed + answers JSON), lesson_progress
--       (progression LMS bornée enrollment_id — distincte de seq87
--       lesson_progress qui borne member_id — coexistence applicative),
--       course_certificates (PDF certificat R2 + numéro unique par tenant).
--     - 3 `ALTER TABLE courses ADD COLUMN` — drip_enabled (INTEGER DEFAULT 0),
--       certificate_template_html (TEXT NULL — gabarit HTML→PDF),
--       completion_threshold (REAL DEFAULT 0.8 — % leçons complétées pour
--       déclencher le certificat).
--     - 6 `CREATE INDEX IF NOT EXISTS` — listing par course, par lesson, par
--       quiz, par enrollment, UNIQUE (lesson_id, enrollment_id) pour upsert
--       progress, et idx certificats par enrollment.
--   AUCUN CHECK. AUCUNE FK destructrice (toutes jointures sont APPLICATIVES,
--   colonnes TEXT renseignées par les handlers — calque seq87 + seq107).
--   AUCUN rebuild. AUCUN touch courses/course_enrollments/lessons/
--   lesson_progress (seq87) en dehors des 3 ADD COLUMN sur `courses`.
--
-- ⚠ ADD COLUMN sur SQLite/D1 : ajout de colonne NULLABLE / DEFAULT constant =
--   opération in-place (PAS de rebuild de table). On reste donc sur le contrat
--   « zéro rebuild courses ».
--
-- ⚠ COLLISION lesson_progress — seq87 pose déjà une table `lesson_progress`
--   bornée `member_id`. Le `CREATE TABLE IF NOT EXISTS lesson_progress`
--   ci-dessous est IDEMPOTENT : si seq87 est déjà appliquée, la table
--   existante (member_id-keyed) est PRÉSERVÉE et les colonnes Sprint 43
--   (enrollment_id, customer_id, started_at, time_spent_sec) ne sont PAS
--   appliquées. Les handlers Phase B doivent détecter ce cas (présence
--   `enrollment_id` colonne) et fallback. Documenté docs/LOT-COURSES-LMS-S43.md
--   §6. Aucun risque destruction.
--
-- ⚠ BORNAGE TENANT — toutes les tables nouvelles portent un `client_id` ou
--   sont bornées via jointure applicative `course_id` / `enrollment_id` →
--   `course_enrollments.client_id` (seq87). Toute lecture/écriture (Phase B
--   handlers) est bornée WHERE client_id = ? (résolu serveur via
--   resolveClientId, JAMAIS depuis le body).
--
-- ⚠ R2 PDF — `course_certificates.certificate_url` = clé R2 (env.R2 binding)
--   pour téléchargement HANDLER via `handleDownloadCertificate` (streaming
--   R2 get → Response). FLAG INACTIF si binding R2 absent → 501 ou
--   placeholder PDF stub. `course_certificates.certificate_number` = chaîne
--   aléatoire 16 chars unique PAR TENANT (validation HANDLER pré-INSERT).
--
-- ⚠ ENUMS HANDLER (whitelist JS, jamais CHECK SQL — rebuild interdit) :
--     - `quiz_questions.type` ∈ `multiple_choice|text|true_false`
--     - `course_lessons.is_published` ∈ `0|1`
--     - `quiz_attempts.passed` ∈ `0|1`
--
-- depends_on : migration-chat-bot-seq137.sql (chaînage strict dernier lot S42)
--              + migration-member-enroll-seq107.sql (parent module Membership
--              Enroll Sprint 6 — courses + course_enrollments + indexes).
--
-- Voir docs/LOT-COURSES-LMS-S43.md §6 pour contrat figé inter-agent Phase B.
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `ALTER TABLE … ADD COLUMN` n'est PAS idempotent sur D1 (échoue si la
--   colonne existe déjà). En cas de rejeu, retirer manuellement les 3 ADD
--   COLUMN déjà appliqués. `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF
--   NOT EXISTS` sont idempotents (rejeu = no-op).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-courses-lms-seq138.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- ── course_lessons : leçons LMS avancées (distinctes de `lessons` seq87) ────
-- Le `lessons` seq87 reste pour le module Memberships legacy (text/video +
-- drip_days + module_id). `course_lessons` est dédié au LMS Sprint 43 :
-- contenu HTML/MD plus riche, drip délai post-enrollment (jours), order_index
-- pour parcours linéaire, is_published 0/1 pour publication progressive.
-- video_url : URL externe (YouTube/Vimeo/MP4 hébergé) ; pas de proxy R2 ici
-- (le LMS Sprint 43 cible plutôt embed iframe Phase C).
CREATE TABLE IF NOT EXISTS course_lessons (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  course_id         TEXT NOT NULL,                    -- jointure applicative → courses.id (seq87)
  title             TEXT NOT NULL,                    -- titre court de la leçon
  content           TEXT,                             -- corps HTML ou markdown (rendu Phase C)
  video_url         TEXT,                             -- URL externe optionnelle (embed iframe)
  order_index       INTEGER DEFAULT 0,                -- position dans le cours (ASC)
  drip_delay_days   INTEGER DEFAULT 0,                -- jours après enrollment avant déblocage
  is_published      INTEGER DEFAULT 0,                -- 0 = draft, 1 = publié
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- ── course_quizzes : 1+ quiz par leçon (FK applicative lesson_id) ───────────
-- passing_score : seuil REAL 0..1 (default 0.7 = 70%) — pourcentage de
-- bonnes réponses minimum pour considérer le quiz « passé ». max_attempts :
-- hard cap applicatif (HANDLER) — refus 4ème tentative si déjà 3.
CREATE TABLE IF NOT EXISTS course_quizzes (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lesson_id       TEXT NOT NULL,                      -- jointure applicative → course_lessons.id
  title           TEXT,                               -- titre optionnel du quiz
  passing_score   REAL DEFAULT 0.7,                   -- 0..1 (70% par défaut)
  max_attempts    INTEGER DEFAULT 3,                  -- hard cap tentatives HANDLER
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ── quiz_questions : questions d'un quiz (multiple_choice|text|true_false) ──
-- type : enum HANDLER whitelist (validation JS — pas de CHECK SQL).
-- options_json : JSON array pour MC (`["A","B","C","D"]`), NULL sinon.
-- correct_answer : string (label de l'option pour MC, texte exact pour text,
-- "true"/"false" pour true_false — validation HANDLER case-insensitive).
-- points : entier (default 1) — pondération du calcul score.
CREATE TABLE IF NOT EXISTS quiz_questions (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  quiz_id         TEXT NOT NULL,                      -- jointure applicative → course_quizzes.id
  question_text   TEXT NOT NULL,                      -- énoncé de la question
  type            TEXT DEFAULT 'multiple_choice',     -- 'multiple_choice'|'text'|'true_false' (whitelist HANDLER)
  options_json    TEXT,                               -- JSON array pour MC, NULL sinon
  correct_answer  TEXT NOT NULL,                      -- bonne réponse (validation HANDLER)
  points          INTEGER DEFAULT 1,                  -- pondération du calcul score
  order_index     INTEGER DEFAULT 0                   -- ordre d'affichage (ASC)
);

-- ── quiz_attempts : tentatives d'un membre (enrollment_id) sur un quiz ──────
-- score : REAL 0..1 (pourcentage bonnes réponses pondérées). passed : 0/1
-- déduit HANDLER (score >= course_quizzes.passing_score). answers_json : JSON
-- object `{ question_id: answer }` pour rejeu / audit. completed_at NULL =
-- attempt en cours / abandonné (HANDLER timeout Phase B).
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  quiz_id         TEXT NOT NULL,                      -- jointure applicative → course_quizzes.id
  enrollment_id   TEXT NOT NULL,                      -- jointure applicative → course_enrollments.id (seq87)
  customer_id     TEXT,                               -- customer/member propriétaire (audit + UI)
  answers_json    TEXT,                               -- JSON object { question_id: answer }
  score           REAL DEFAULT 0,                     -- 0..1 (HANDLER computed)
  passed          INTEGER DEFAULT 0,                  -- 0/1 (HANDLER deduce vs passing_score)
  attempted_at    TEXT DEFAULT (datetime('now')),
  completed_at    TEXT                                -- NULL = en cours
);

-- ── lms_lesson_progress : progression LMS bornée enrollment_id ──────────────
-- Table DÉDIÉE LMS Sprint 43 (préfixe `lms_`) pour ÉVITER toute collision avec
-- `lesson_progress` seq87 (Memberships legacy, bornée `member_id`). Les 2
-- coexistent : Memberships utilise `lesson_progress` (member_id-keyed), LMS
-- avancé utilise `lms_lesson_progress` (enrollment_id-keyed).
-- UNIQUE INDEX uniq_lms_lesson_progress(lesson_id, enrollment_id) → upsert.
-- time_spent_sec : compteur applicatif HANDLER (accumulation à chaque ping).
CREATE TABLE IF NOT EXISTS lms_lesson_progress (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lesson_id       TEXT NOT NULL,                      -- jointure applicative → course_lessons.id
  enrollment_id   TEXT NOT NULL,                      -- jointure applicative → course_enrollments.id (seq87)
  customer_id     TEXT,                               -- customer/member propriétaire (audit + UI)
  started_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT,                               -- NULL = en cours
  time_spent_sec  INTEGER DEFAULT 0                   -- temps cumulé HANDLER (sec)
);

-- ── course_certificates : certificats PDF générés à completion ──────────────
-- certificate_url : clé R2 (env.R2 binding) — handleDownloadCertificate
-- streame le PDF via R2 GET. certificate_number : 16 chars hex aléatoires
-- UNIQUES PAR TENANT (validation HANDLER pré-INSERT : SELECT existing par
-- client_id, retry si collision). issued_at : timestamp d'émission ISO.
CREATE TABLE IF NOT EXISTS course_certificates (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  course_id           TEXT NOT NULL,                  -- jointure applicative → courses.id (seq87)
  enrollment_id       TEXT NOT NULL,                  -- jointure applicative → course_enrollments.id (seq87)
  customer_id         TEXT,                           -- customer/member propriétaire (audit + UI)
  certificate_url     TEXT,                           -- clé R2 (env.R2 binding) — NULL si FLAG INACTIF
  certificate_number  TEXT,                           -- 16 chars hex unique par tenant (HANDLER)
  issued_at           TEXT DEFAULT (datetime('now'))
);

-- ── ALTERs additifs courses (zéro CHECK, DEFAULT constant) ──────────────────
-- drip_enabled : 1 = le drip délai (course_lessons.drip_delay_days) est
--   appliqué pour ce cours ; 0 = toutes les leçons publiées dispo immédiat.
-- certificate_template_html : gabarit HTML (Phase B handlebars-like interpolé
--   HANDLER avec {{customer_name}} / {{course_title}} / {{date}} /
--   {{certificate_number}}) → rendu PDF via lms-engine.ts. NULL = pas de
--   certificat pour ce cours.
-- completion_threshold : % minimum de leçons complétées pour générer le
--   certificat (default 0.8 = 80% des leçons publiées). REAL 0..1.
ALTER TABLE courses ADD COLUMN drip_enabled INTEGER DEFAULT 0;
ALTER TABLE courses ADD COLUMN certificate_template_html TEXT;
ALTER TABLE courses ADD COLUMN completion_threshold REAL DEFAULT 0.8;

-- ── Indexes (listing par course / lesson / quiz / enrollment + UNIQUE) ──────
--   - listing leçons d'un cours (UI : afficher leçons ASC order_index)
CREATE INDEX IF NOT EXISTS idx_course_lessons_course        ON course_lessons(course_id, order_index);
--   - listing quizzes d'une leçon
CREATE INDEX IF NOT EXISTS idx_course_quizzes_lesson        ON course_quizzes(lesson_id);
--   - listing questions d'un quiz ASC order_index
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz          ON quiz_questions(quiz_id, order_index);
--   - listing tentatives d'un enrollment (UI : afficher historique attempts)
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_enrollment     ON quiz_attempts(enrollment_id);
--   - UNIQUE : 1 row de progression par (lesson_id, enrollment_id) → upsert
--     HANDLER en INSERT … ON CONFLICT(lesson_id, enrollment_id) DO UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lms_lesson_progress  ON lms_lesson_progress(lesson_id, enrollment_id);
--   - listing certificats d'un enrollment (UI : afficher cert + download)
CREATE INDEX IF NOT EXISTS idx_course_certificates_enrollment ON course_certificates(enrollment_id);

-- NB : 6 CREATE TABLE IF NOT EXISTS, 3 ALTER ADD COLUMN (NULLABLES / DEFAULT
-- constant), 6 CREATE INDEX IF NOT EXISTS (dont 1 UNIQUE). AUCUN CHECK,
-- AUCUNE FK destructrice, AUCUN DROP / RENAME / rebuild. Enums (type quiz,
-- passed) validés HANDLER (whitelist JS). UPDATE/DELETE bornés tenant
-- (client_id résolu serveur via course_enrollments.client_id seq87, JAMAIS
-- body). Capabilities `clients.manage` (admin CRUD) + `leads.write`
-- (member-facing complete/attempt) RÉUTILISÉES — ZÉRO ajout à
-- ALL_CAPABILITIES. Choix figés docs/LOT-COURSES-LMS-S43.md §6.
