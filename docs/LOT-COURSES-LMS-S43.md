# LOT Courses LMS — Sprint 43

> Doc contrat §6 figé. Migration : seq138 — `migration-courses-lms-seq138.sql`.
> Compagnons : `LOT-MEMBERSHIP-ENROLL.md` (module parent — Sprint 6, seq107
> indexes course_enrollments), `LOT-MEMBER6.md` (Sprint 12, seq87 — tables
> courses / course_enrollments / lessons originales), `LOT-CHAT-BOT-S42.md`
> (calque pattern handler stub Phase A + ordre anti-shadowing + i18n parité
> STRICTE), `LOT-TEAM-BC.md` (capabilities FIGÉES seq80 — réutilisation
> `clients.manage` admin + `leads.write` member-facing).

## §1 Contexte

Le module **Memberships + Courses + Enrollments** existe déjà dans Intralys
(seq87 = tables, seq107 = indexes + endpoints inscription). Composants en
place :

- `migration-member-seq87.sql` — 9 tables : `members`, `member_sessions`,
  `membership_sites`, `membership_plans`, `courses`, `course_modules`,
  `lessons`, `course_enrollments`, `lesson_progress` (member_id-keyed).
- `migration-member-enroll-seq107.sql` — 3 indexes additifs pour accélérer
  les lookups d'inscription / listing modules→leçons.
- `src/worker/memberships.ts` — endpoints publics + AUTHED CRUD courses /
  modules / lessons / enrollments.

**Sprint 43 = ENRICHISSEMENT LMS, PAS reconstruction**. On NE TOUCHE PAS aux
tables existantes courses / course_enrollments / lessons / lesson_progress
(seq87) — uniquement 3 ALTER additifs `ADD COLUMN` sur `courses` (drip_enabled
+ certificate_template_html + completion_threshold). On ajoute la couche
**LMS avancé** :

1. **Lessons LMS riches** (`course_lessons` table NEUVE, distincte de
   `lessons` seq87) — contenu HTML/MD + drip délai post-enrollment + ordre +
   publish flag. Le `lessons` seq87 reste pour le legacy Memberships ;
   `course_lessons` est le nouveau format Sprint 43.
2. **Quiz par leçon** (`course_quizzes` + `quiz_questions` tables NEUVES) —
   multiple_choice / text / true_false + passing_score + max_attempts.
3. **Quiz attempts** (`quiz_attempts` table NEUVE) — tentatives par
   enrollment_id avec scoring HANDLER.
4. **Progress tracking détaillé** (`lesson_progress` table NEUVE, bornée
   `enrollment_id` — distincte de `lesson_progress` seq87 bornée `member_id`)
   — completed_at + time_spent_sec + UNIQUE (lesson_id, enrollment_id).
5. **Certificats PDF** (`course_certificates` table NEUVE + R2 binding) —
   généré auto à completion (% leçons ≥ completion_threshold), numéro 16 chars
   hex unique par tenant, download stream R2.
6. **Drip content** (course.drip_enabled + course_lessons.drip_delay_days) —
   leçons released sur calendrier (X jours après enrollment).

Phase A FIGE le contrat — Phase B Manager-B remplit l'engine (computeProgress
+ gradeQuizAttempt + generateCertificatePdf via env.R2 + grading logic), Phase
C Manager-C construit le frontend (`/courses/:id/lessons` + quiz UI + cert UI).

## §2 Migrations — seq138 (DDL résumé)

Fichier racine : `migration-courses-lms-seq138.sql`. Manifest entrée seq138
(`docs/migrations-manifest.json`), `depends_on:
["migration-chat-bot-seq137.sql", "migration-member-enroll-seq107.sql"]`
(chaînage strict sur dernière migration LOT 4 + parent module Sprint 6).

100 % ADDITIF, zéro CHECK / FK destructrice / ALTER destructeur / DROP / RENAME :

- `CREATE TABLE IF NOT EXISTS course_lessons` : id PK, course_id NOT NULL,
  title NOT NULL, content (TEXT NULL — HTML/MD), video_url (TEXT NULL),
  order_index (INTEGER DEFAULT 0), drip_delay_days (INTEGER DEFAULT 0),
  is_published (INTEGER DEFAULT 0), created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS course_quizzes` : id PK, lesson_id NOT NULL,
  title (TEXT NULL), passing_score (REAL DEFAULT 0.7), max_attempts
  (INTEGER DEFAULT 3), created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS quiz_questions` : id PK, quiz_id NOT NULL,
  question_text NOT NULL, type (TEXT DEFAULT 'multiple_choice' — enum
  HANDLER `multiple_choice|text|true_false`), options_json (TEXT NULL — JSON
  array pour MC), correct_answer NOT NULL, points (INTEGER DEFAULT 1),
  order_index (INTEGER DEFAULT 0).
- `CREATE TABLE IF NOT EXISTS quiz_attempts` : id PK, quiz_id NOT NULL,
  enrollment_id NOT NULL, customer_id (TEXT NULL), answers_json (TEXT NULL —
  JSON object { question_id: answer }), score (REAL DEFAULT 0), passed
  (INTEGER DEFAULT 0), attempted_at, completed_at (TEXT NULL).
- `CREATE TABLE IF NOT EXISTS lesson_progress` : id PK, lesson_id NOT NULL,
  enrollment_id NOT NULL, customer_id (TEXT NULL), started_at, completed_at
  (TEXT NULL), time_spent_sec (INTEGER DEFAULT 0).
- `CREATE TABLE IF NOT EXISTS course_certificates` : id PK, course_id NOT
  NULL, enrollment_id NOT NULL, customer_id (TEXT NULL), certificate_url
  (TEXT NULL — clé R2), certificate_number (TEXT NULL — 16 chars hex),
  issued_at.
- 3 `ALTER TABLE courses ADD COLUMN` : `drip_enabled` (INTEGER DEFAULT 0),
  `certificate_template_html` (TEXT NULL), `completion_threshold` (REAL
  DEFAULT 0.8).
- 6 indexes : `idx_course_lessons_course` (course_id, order_index),
  `idx_course_quizzes_lesson` (lesson_id), `idx_quiz_questions_quiz`
  (quiz_id, order_index), `idx_quiz_attempts_enrollment` (enrollment_id),
  `uniq_lesson_progress` (UNIQUE sur lesson_id, enrollment_id — porte
  l'upsert INSERT … ON CONFLICT(lesson_id, enrollment_id) DO UPDATE),
  `idx_course_certificates_enrollment` (enrollment_id).

Validation enums (`quiz_questions.type` ∈ `multiple_choice|text|true_false`,
`course_lessons.is_published` ∈ `0|1`, `quiz_attempts.passed` ∈ `0|1`) faite
SIDE-HANDLER (`courses-lms.ts` whitelist JS) — calque LOT-CHAT-BOT-S42 §6 +
LOT-VOICE-AGENT-S41 §6 (pas de CHECK = pas de rebuild SQLite jamais).

**⚠ COLLISION nommage `lesson_progress`** : seq87 pose déjà une table
`lesson_progress` bornée `member_id` + `lesson_id`. Le `CREATE TABLE IF NOT
EXISTS lesson_progress` Sprint 43 est IDEMPOTENT : si seq87 déjà appliquée,
la table existante (member_id-keyed) est PRÉSERVÉE et les colonnes Sprint 43
(enrollment_id, customer_id, started_at, time_spent_sec) NE sont PAS
appliquées. Phase B Manager-B DOIT détecter la présence de la colonne
`enrollment_id` via pragma table_info → fallback compatible (write member_id
si seulement seq87 dispo). Aucun risque destruction.

## §3 Routes (13 AUTHED + 0 PUBLIC Phase A)

Toutes câblées dans `src/worker.ts` à l'intérieur du bloc `routeProtected`,
APRÈS le bloc S42 chat-bot (~l.3127), AVANT le bloc Sprint 23 sécurité
(~l.3129). Garde `requireAuth` au choke-point + gardes capability
**`clients.manage`** (admin CRUD lessons/quizzes/questions + read progress
+ list certificates) ou **`leads.write`** (member-facing : mark lesson
complete + submit quiz attempt) appliquées DANS chaque handler.

ORDRE ANTI-SHADOWING strict :
- `/courses/:id/lessons` AVANT toute autre route `/lessons/*`
- `/lessons/:id/complete` AVANT `/lessons/:id` seul
- `/lessons/:id/quizzes` AVANT `/lessons/:id` seul
- `/quizzes/:id/questions` AVANT `/quizzes/:id/attempt`
- `/certificates` collection AVANT `/certificates/:id/download`

| Méthode | Chemin                                       | Handler                       | Cap                | Fichier         |
|--------:|----------------------------------------------|-------------------------------|--------------------|-----------------|
| GET     | `/api/courses/:id/lessons`                   | `handleListLessons`           | clients.manage     | courses-lms.ts  |
| POST    | `/api/courses/:id/lessons`                   | `handleCreateLesson`          | clients.manage     | courses-lms.ts  |
| PATCH   | `/api/lessons/:id`                           | `handleUpdateLesson`          | clients.manage     | courses-lms.ts  |
| DELETE  | `/api/lessons/:id`                           | `handleDeleteLesson`          | clients.manage     | courses-lms.ts  |
| POST    | `/api/lessons/:id/complete`                  | `handleMarkLessonComplete`    | leads.write        | courses-lms.ts  |
| GET     | `/api/lessons/:id/quizzes`                   | `handleListLessonQuizzes`     | clients.manage     | courses-lms.ts  |
| POST    | `/api/lessons/:id/quizzes`                   | `handleCreateQuiz`            | clients.manage     | courses-lms.ts  |
| GET     | `/api/quizzes/:id/questions`                 | `handleListQuizQuestions`     | clients.manage     | courses-lms.ts  |
| POST    | `/api/quizzes/:id/questions`                 | `handleCreateQuestion`        | clients.manage     | courses-lms.ts  |
| POST    | `/api/quizzes/:id/attempt`                   | `handleSubmitQuizAttempt`     | leads.write        | courses-lms.ts  |
| GET     | `/api/enrollments/:id/progress`              | `handleGetProgress`           | clients.manage     | courses-lms.ts  |
| GET     | `/api/certificates`                          | `handleListCertificates`      | clients.manage     | courses-lms.ts  |
| GET     | `/api/certificates/:id/download`             | `handleDownloadCertificate`   | clients.manage     | courses-lms.ts  |

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ `code` —
contrat GELÉ docs/LOT-TEAM-BC.md §6.A). Phase A renvoie `501` partout
(`Phase B not yet implemented: <handler_name>`) pour câbler la matrice
routes/handlers sans casser le worker — calque chat-bot Phase A + voice-agent
Phase A + snapshots Phase A.

**Routes existantes /api/memberships/\* / /api/courses/\* INCHANGÉES** (S6 +
S12 verrou). Sprint 43 n'ajoute AUCUNE route publique Phase A.

## §4 Handlers (signatures FIGÉES Phase A — Phase B Manager-B remplit)

### `src/worker/courses-lms.ts` (13 handlers AUTHED)

```ts
// 5 Lessons (4 admin + 1 member-facing)
export async function handleListLessons(env: Env, auth: CoursesLmsAuth, courseId: string): Promise<Response>
export async function handleCreateLesson(request: Request, env: Env, auth: CoursesLmsAuth, courseId: string): Promise<Response>
export async function handleUpdateLesson(request: Request, env: Env, auth: CoursesLmsAuth, id: string): Promise<Response>
export async function handleDeleteLesson(env: Env, auth: CoursesLmsAuth, id: string): Promise<Response>
export async function handleMarkLessonComplete(request: Request, env: Env, auth: CoursesLmsAuth, id: string): Promise<Response>

// 5 Quizzes (2 quiz + 2 questions + 1 attempt)
export async function handleListLessonQuizzes(env: Env, auth: CoursesLmsAuth, lessonId: string): Promise<Response>
export async function handleCreateQuiz(request: Request, env: Env, auth: CoursesLmsAuth, lessonId: string): Promise<Response>
export async function handleListQuizQuestions(env: Env, auth: CoursesLmsAuth, quizId: string): Promise<Response>
export async function handleCreateQuestion(request: Request, env: Env, auth: CoursesLmsAuth, quizId: string): Promise<Response>
export async function handleSubmitQuizAttempt(request: Request, env: Env, auth: CoursesLmsAuth, quizId: string): Promise<Response>

// 3 Progress + Certificats
export async function handleGetProgress(env: Env, auth: CoursesLmsAuth, enrollmentId: string): Promise<Response>
export async function handleListCertificates(env: Env, auth: CoursesLmsAuth, url: URL): Promise<Response>
export async function handleDownloadCertificate(env: Env, auth: CoursesLmsAuth, id: string): Promise<Response>
```

### `src/worker/lib/lms-engine.ts` (4 helpers stubs Phase A)

```ts
export async function computeProgress(env: Env, enrollmentId: string): Promise<EnrollmentProgress>
export function gradeQuizAttempt(questions: QuizQuestion[], answers: Record<string, string>): { score: number; passed: boolean; breakdown: Array<{question_id:string; correct:boolean; points:number}> }
export async function generateCertificatePdf(course: {id:string; title:string; certificate_template_html:string|null}, customer: {id:string; name:string}, template: string | null): Promise<Uint8Array>
export function pickCertificateNumber(): string
```

**Notes engine** :
- `computeProgress` Phase A stub retourne `{0,0,0,false}`. Phase B remplit
  avec 2 SELECT D1 (COUNT completed + COUNT total) + ratio + comparaison
  vs `courses.completion_threshold`.
- `gradeQuizAttempt` Phase A stub retourne `{score:0, passed:false, breakdown:[]}`.
  Phase B remplit avec compare logic case-insensitive text / exact MC /
  lowercased true_false + pondération points.
- `generateCertificatePdf` Phase A FLAG INACTIF : retourne `new Uint8Array(0)`
  → caller persiste `certificate_url=NULL` → UI Phase C affiche
  « Certificat indisponible (binding R2 manquant) ». Phase B Manager-B
  remplit avec rendu HTML→PDF (pdf-lib / @react-pdf via Workers AI ou local).
- `pickCertificateNumber` Phase A déjà FONCTIONNEL (pure helper, 16 chars
  hex via crypto.getRandomValues). Uniqueness garantie HANDLER caller
  (SELECT par client_id, retry si collision).

## §5 Types `src/lib/api.ts` (FIGÉS Phase A)

```ts
export type QuizQuestionType = 'multiple_choice' | 'text' | 'true_false'

export interface CourseLesson         // 10 champs : id, course_id, title, content, video_url, order_index, drip_delay_days, is_published, created_at, updated_at
export interface CourseQuiz           // 7 champs : id, lesson_id, title, passing_score, max_attempts, created_at, updated_at
export interface QuizQuestion         // 7 champs : id, quiz_id, question_text, type, options_json, correct_answer, points, order_index
export interface QuizAttempt          // 9 champs : id, quiz_id, enrollment_id, customer_id, answers_json, score, passed, attempted_at, completed_at
export interface LessonProgress       // 7 champs : id, lesson_id, enrollment_id, customer_id, started_at, completed_at, time_spent_sec
export interface CourseCertificate    // 7 champs : id, course_id, enrollment_id, customer_id, certificate_url, certificate_number, issued_at
export interface CourseLessonInput    // 6 champs optionnels (POST/PATCH)
export interface CourseQuizInput      // 3 champs optionnels (POST)
export interface QuizQuestionInput    // 6 champs (POST, dont question_text + correct_answer required)
export interface QuizAttemptInput     // 2 champs : enrollment_id + answers map
export interface EnrollmentProgress   // 4 champs : completed_lessons, total_lessons, progress_pct, can_get_certificate
```

Helpers async exportés (13 handlers, paritaire avec routes worker.ts) :

- `listCourseLessons(courseId)`, `createCourseLesson(courseId, input)`,
  `updateCourseLesson(id, input)`, `deleteCourseLesson(id)`
- `markLessonComplete(lessonId, enrollmentId)`
- `listLessonQuizzes(lessonId)`, `createQuiz(lessonId, input)`
- `getQuizQuestions(quizId)`, `createQuizQuestion(quizId, input)`
- `submitQuizAttempt(quizId, input)` (input = `{enrollment_id, answers}`)
- `getLessonProgress(enrollmentId)`
- `getCustomerCertificates(customerId)`, `downloadCertificate(id)`

## §6 Contrat inter-agent FIGÉ — Phase B/C ne peuvent PAS modifier

1. **Migrations** : seq138 verrou. Aucun champ supplémentaire en Phase B sans
   nouvelle seq (139+). Aucun CHECK ajouté (rebuild SQLite interdit). 100 %
   ADDITIF. NE TOUCHE PAS aux tables existantes `courses` /
   `course_enrollments` / `course_modules` / `lessons` (seq87) en dehors
   des 3 ALTER ADD COLUMN sur `courses`.
2. **Routes** : 13 chemins/méthodes AUTHED figés (§3). Aucun renommage.
   L'ordre anti-shadowing dans `worker.ts` est invariant. Routes existantes
   `/api/memberships/*` / `/api/courses/*` (S6 + S12) INCHANGÉES.
3. **Capabilities** : `clients.manage` (admin CRUD + read progress/certs)
   + `leads.write` (member-facing complete + attempt) UNIQUEMENT. AUCUN
   ajout à `ALL_CAPABILITIES`. Capabilities FIGÉES seq80.
4. **Contrat réponses** : `json({ data })` succès / `json({ error }, status)`
   erreur. PAS de champ `code`. PAS de wrapping supplémentaire.
5. **Types `src/lib/api.ts`** : noms et signatures FIGÉS (§5). Manager-C peut
   ajouter des `interface` supplémentaires côté front s'il les expose, mais
   ne renomme PAS les exports listés.
6. **Bornage tenant** : `WHERE client_id = ?` dans tout SELECT/UPDATE/DELETE
   bornable. Les tables NEUVES n'ont PAS de colonne `client_id` directe (sauf
   `course_certificates` qui hérite via `course_enrollments.client_id` seq87) ;
   le bornage passe par jointure applicative `course_enrollments` ↔ `course_id`
   ↔ `courses.client_id` (seq87). `resolveClientId()` via
   `getClientModules(env, auth.userId)` — calque `chat-bot.ts:33` +
   `voice-agent.ts:32`.
7. **Imports RELATIFS** : `import type { Env } from './types'` /
   `from '../types'` — JAMAIS d'alias `@/`. Calque chat-bot.ts +
   voice-agent.ts.
8. **NE TOUCHE PAS aux modules existants** :
   - `src/worker/memberships.ts` — INCHANGÉ
   - Tables seq87 (`courses`, `course_enrollments`, `course_modules`,
     `lessons`, `lesson_progress`) — INCHANGÉES (sauf 3 ADD COLUMN sur
     `courses` seq138)
   - `migration-member-seq87.sql` / `migration-member-enroll-seq107.sql` —
     INCHANGÉS
   Si Phase B a besoin de modifier le flow d'inscription existant
   (course_enrollments → trigger LMS), passer par un **nouveau** helper
   additif (ex `lib/lms-bridge.ts`) qui appelle l'engine seq138 — sans
   modifier `memberships.ts`.
9. **AI / R2 ENGINE — env.AI / env.R2 FLAGS INACTIFS** :
   - `generateCertificatePdf` retourne `new Uint8Array(0)` si `env.R2`
     absent → caller persiste `certificate_url=NULL` → 501 sur download
     `handleDownloadCertificate`. JAMAIS d'erreur jetée. JAMAIS d'API
     externe (pdf-lib local OK Phase B, Workers AI rendering OK, mais
     stockage via env.R2 only).
   - `gradeQuizAttempt` est PURE — pas de dépendance env.AI (logic compare
     simple Phase B).
10. **i18n** : 24 clés ajoutées dans 4 catalogues (`fr-CA`, `fr-FR`, `en`,
    `es`), parité STRICTE (même nombre de clés, mêmes noms `lms.*`).
    Manager-C ne change PAS le nom des clés. `};` final de chaque catalogue
    PRÉSERVÉ.

### Vérifications inter-agent (à valider AVANT Phase B kickoff)

- [x] Manifest JSON valide (`python -m json.tool docs/migrations-manifest.json`)
- [x] 4 catalogues i18n MÊME nombre de clés `lms.*` (24 chacun)
- [x] `};` final de chaque catalogue PRÉSERVÉ (fr-CA, fr-FR, en, es)
- [x] Routes câblées dans `worker.ts` après bloc S42 chat-bot (~l.3127)
- [x] Aucun touch sur `memberships.ts`, tables seq87 / seq107
      (vérifier `git status` Phase A end)
- [x] `courses-lms.ts` + `lms-engine.ts` créés en NOUVEAUX fichiers
- [x] Imports relatifs uniquement (`./types`, `../types`, `../../lib/api`)
- [x] `json({ data })` / `json({ error }, status)` partout — pas de `code`
- [x] `requireCapability(auth.capabilities, 'clients.manage')` top de chaque
      handler admin + `'leads.write'` top de chaque handler member-facing
      (complete + attempt)
- [x] ALTER ADD COLUMN sur `courses` (3) — NULLABLES / DEFAULT constant
      (in-place D1, zéro rebuild)

## §7 Découpe Phase B (Manager-B backend ∥ Manager-C frontend)

- **Manager-B** : remplit les 13 handlers AUTHED + 4 helpers engine. Branche
  `env.R2` réel (Workers R2 binding) pour stockage PDF + signed URLs.
  Implémente `computeProgress` flow complet : SELECT count completed +
  total → ratio → compare vs `courses.completion_threshold`. Implémente
  `gradeQuizAttempt` avec compare case-insensitive text / exact MC /
  lowercased true_false + pondération points. Implémente
  `generateCertificatePdf` via pdf-lib local OU Workers AI rendering
  (selon disponibilité). Handle drip content (refuse lesson access if
  `now() - enrollment.enrolled_at < drip_delay_days` quand
  `course.drip_enabled=1`).
- **Manager-C** : pages `/courses/:id/lessons` (admin CRUD), `/lessons/:id`
  (member view + quiz + mark complete), `/enrollments/:id/progress` (member
  progress bar + cert download), `/courses/:id/certificate-template` (admin
  HTML template editor). Intégration des 24 clés i18n `lms.*`. ZÉRO fichier
  partagé avec B (api.ts est en lecture pour C).

## §8 Sécurité & Loi 25 / RGPD

- **PII customer** : `customer_id` colonnes (quiz_attempts, lesson_progress,
  course_certificates) sont OPTIONNELLES (NULL si visiteur anonyme — Phase B
  bornage seulement via enrollment_id + course_enrollments.client_id).
  Audit redaction déjà couverte par audit-redact.ts (S23).
- **Abuse / rate-limit** : `course_quizzes.max_attempts` (default 3) appliqué
  HANDLER Phase B dans `handleSubmitQuizAttempt` — COUNT(quiz_attempts WHERE
  enrollment_id=? AND quiz_id=?) → refus si >= max_attempts.
- **Anti-cheat quiz** : `quiz_questions.correct_answer` JAMAIS exposé via
  `handleListQuizQuestions` côté member-facing (Phase B Manager-B doit
  redact `correct_answer` à `null` pour la lecture leads.write). Admin
  (clients.manage) voit tout.
- **PDF certificat** : `certificate_template_html` est contrôlé par le
  tenant via `clients.manage` (pas d'injection via visiteur). Phase B doit
  sanitize les variables interpolées (`customer_name` ∈ users tenant) —
  jamais d'eval / innerHTML / String.raw.
- **No external API key** : Workers R2 binding uniquement (`env.R2`). Aucun
  appel S3 / Cloudinary / autre CDN. Si `env.R2` absent → FLAG INACTIF →
  `certificate_url=NULL` + 501 sur download (UI Phase C dégrade).

---

**Tableau de bord Phase A — état Manager-A SOLO** :

| Livrable                                              | Statut |
|-------------------------------------------------------|:------:|
| Migration `migration-courses-lms-seq138.sql` (additif) |   X    |
| Manifest entry seq138 (depends seq137 + seq107)        |   X    |
| Types `src/lib/api.ts` (11 interfaces + 13 helpers)    |   X    |
| Routes `worker.ts` (13 routes après bloc S42)          |   X    |
| Stubs `courses-lms.ts` (13 handlers, 501)              |   X    |
| Stubs `lms-engine.ts` (4 helpers)                      |   X    |
| i18n × 4 catalogues (24 clés `lms.*` parité STRICTE)   |   X    |
| Doc `docs/LOT-COURSES-LMS-S43.md` §6 FIGÉ              |   X    |
