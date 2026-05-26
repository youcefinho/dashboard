-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 106 — LOT FORMS XL (Sprint 5 « Forms XL », 2026-05-21). Pose le
-- SOCLE DDL minimaliste de l'enrichissement des formulaires : logique
-- conditionnelle (show/hide), multi-étapes + barre de progression, analytics
-- drop-off PAR CHAMP, réparation du view-tracking, rendu public complet (date/
-- multiselect/file/hidden + consentement Loi 25), anti-spam honeypot et page de
-- gestion Forms.tsx.
--
-- Le builder (`src/pages/FormBuilder.tsx`, dnd-kit, 12 types de champs), le quiz
-- scoring (`form_field_options.weight`), la dédup/attribution/consentement
-- (`handlePublicFormSubmit`), l'embed (f.js) et le mapping custom fields sont
-- DÉJÀ en place. Cette migration N'AJOUTE QU'UNE table + un index de lecture
-- pour l'analytics drop-off ; tout le reste (conditional / step) vit dans le
-- JSON `forms.fields` (attributs OPTIONNELS) ⇒ AUCUN DDL pour ces colonnes.
--
-- depends_on : migration-automation-seq105.sql (seq 105 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 105).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   CONTRAINTE existante. Ce lot N'AJOUTE QU'UN `CREATE TABLE IF NOT EXISTS` +
--   un `CREATE INDEX IF NOT EXISTS` — additif pur.
--
--   CHECK INTOUCHABLE : `forms.submit_action`
--   (create_lead|webhook|email|none) — AUCUN ALTER ici. Les tables `forms`,
--   `form_submissions` (seq Phase 7), `form_views`, `form_field_options`
--   (seq Phase 31) EXISTENT DÉJÀ — AUCUNE n'est recréée ni altérée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Le lien
--   form_field_events.form_id ↔ forms(id) reste APPLICATIF (colonne TEXT
--   renseignée par les handlers en Phase B, lecture bornée serveur).
--
-- RÉTRO-COMPAT BYTE : aucune colonne ajoutée à une table existante ⇒ toutes les
--   rows legacy restent valides bit-pour-bit. Les formulaires existants dont le
--   JSON `forms.fields` n'a NI `conditional` NI `step` rendent EXACTEMENT comme
--   avant (attributs OPTIONNELS, absents = comportement legacy : tout visible,
--   étape unique).
--
-- TOLÉRANCE best-effort : si seq 106 est rejouée, `CREATE TABLE/INDEX IF NOT
--   EXISTS` sont idempotents. scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Conventions schema.sql (vérifiées seq 105 / Phase 31) : timestamps TEXT
--   DEFAULT (datetime('now')), id INTEGER PK AUTOINCREMENT pour les tables
--   d'événements (calque `form_views` Phase 31). PAS d'unixepoch, PAS de FK.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-forms-xl-seq106.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) form_field_events — analytics drop-off PAR CHAMP. Chaque événement de champ
--    (focus/blur/complete/abandon) est journalisé côté visiteur via
--    handleLogFormFieldEvent (corps Phase B). Calque `form_views` (Phase 31) :
--    id INTEGER PK AUTOINCREMENT, pas de FK, pas de CHECK (event = chaîne libre
--    applicative). session_id corrèle les événements d'une même session de
--    remplissage (drop-off = dernier champ atteint avant abandon).
CREATE TABLE IF NOT EXISTS form_field_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id TEXT,
  field_name TEXT,
  event TEXT,
  session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 2) Index ADDITIF (IF NOT EXISTS) — accélère l'agrégation drop-off par
--    formulaire (handleGetFormFieldAnalytics, Phase B). Lecture pure.
CREATE INDEX IF NOT EXISTS idx_form_field_events_form ON form_field_events(form_id);

-- NB : AUCUNE colonne ajoutée à `forms` / `form_submissions` / `form_views` /
-- `form_field_options`. AUCUN CHECK existant modifié (forms.submit_action
-- INTOUCHÉ). AUCUNE FK. AUCUN DROP / RENAME / rebuild. AUCUNE capability ajoutée
-- (les handlers forms gardent via auth.role === 'admin', cf. forms.ts). Les
-- attributs `conditional` / `step` des champs vivent dans le JSON `forms.fields`
-- (OPTIONNELS, rétro-compat). Contrat figé docs/LOT-FORMS-XL.md §6.
