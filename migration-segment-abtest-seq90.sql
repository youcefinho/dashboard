-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 90 — LOT G6 Segmentation comportementale + A/B testing campagnes
-- (2026-05-20)
-- Segments de leads DYNAMIQUES (recompute-on-read + cache, criteria_json ; ZÉRO
-- table de membres matérialisée) + A/B testing des broadcasts (2-N variantes,
-- split fixe pondéré, gagnant MANUEL, reporting open/click par variante).
--
-- Le segment marketing (`lead_segments`) est NEUF et SANS RAPPORT avec le
-- segment e-commerce RFM (`customer_segment_config` seq 68 — INTOUCHÉE). L'A/B
-- s'enfourne dans le pipeline broadcast EXISTANT (env.BROADCAST_QUEUE batch 50,
-- enqueueBroadcastJobs / processBroadcastQueueJob) derrière la garde additive
-- `if (ab_test_enabled)` — PAS de table ab_campaigns séparée, broadcast.ts est
-- RÉUTILISÉ ~85 %.
--
-- depends_on : migration-helpdesk-seq89.sql (seq 89 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 89).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une CONTRAINTE existante.
--   Ce lot N'AJOUTE QUE :
--     - 2 `CREATE TABLE IF NOT EXISTS` (lead_segments, broadcast_variants)
--       NEUVES, idempotentes ;
--     - 4 `ALTER TABLE ... ADD COLUMN` (broadcasts ×3, messages ×1) — additif
--       pur, nullable / DEFAULT, jamais de modification de CHECK/PK/FK ;
--     - 2 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--
--   Le CHECK status de `broadcasts` seq 24
--     status TEXT CHECK (status IN ('queued','processing','completed','failed'))
--   est INTOUCHABLE : modifier un CHECK ⇒ rebuild SQLite ⇒ INTERDIT. L'A/B et
--   `segment_id` n'ajoutent AUCUNE valeur de statut neuve : un broadcast A/B
--   reste status `queued`→`processing`→`completed` (valeurs EXISTANTES du CHECK
--   seq 24) ⇒ ZÉRO rebuild. `ab_test_enabled = 0` (DEFAULT) ⇒ chemin d'envoi
--   legacy STRICTEMENT identique. `messages.campaign_variant_id` NULL ⇒ message
--   non-variante (legacy, reporting par broadcast inchangé).
--   Le CHECK role users seq 59 (rebuild:users) est INTOUCHÉ. AUCUN touch
--   `users` / `admin_sessions`. AUCUN touch tables E4/E6 régulées
--   (`payments`, `payment_events`, `payment_provider_config`, `refunds`,
--   `disputes`, `return_requests`). AUCUNE table existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; la
--   jointure `broadcast_variants.broadcast_id` → `broadcasts.id` et
--   `messages.campaign_variant_id` → `broadcast_variants.id` sont APPLICATIVES,
--   par colonne TEXT). PAS de CHECK (additif pur — les opérateurs de critères
--   et le split_pct sont validés côté HANDLER, pas par CHECK SQL).
--
-- TOLÉRANCE « duplicate column » — exécution best-effort :
--   si seq 90 est rejouée, `ADD COLUMN` peut échouer (« duplicate column
--   name ») et `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas
--   d'erreur). L'erreur éventuelle d'un `ADD COLUMN` rejoué est ATTENDUE et
--   NON FATALE : l'exécuteur (Antigravity) joue ce fichier statement-par-
--   statement, log + CONTINUE au statement suivant. scripts/migrate.ts est
--   FIGÉ et N'EST PAS modifié ; la tolérance est une consigne d'exécution.
--
-- Conventions (calque broadcasts/messages seq 24/seq 86, vérifié sur
--   migration-emailseq-seq86.sql) :
--   id TEXT PK, timestamps TEXT DEFAULT (datetime('now')). PAS d'unixepoch
--   (≠ seq 89 helpdesk qui utilise unixepoch) — on calque l'écosystème
--   broadcasts/messages. PAS d'INTEGER autoincrement, PAS de FK.
--   Bornage tenant : `client_id` / `agency_id` nullables (calque funnels seq 83
--   / lead_segments) — legacy/mono-tenant → NULL, mode agence → bornés.
--
-- Rétro-compat BYTE-IDENTIQUE : `ab_test_enabled = 0` ⇒ chemin broadcast legacy
--   (un seul corps, pas de partition de variante) strictement identique Sprint 5 ;
--   `segment_id` NULL ⇒ ciblage par filters_json legacy ; `campaign_variant_id`
--   NULL ⇒ message hors-variante (reporting par broadcast inchangé).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-segment-abtest-seq90.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) lead_segments — segment DYNAMIQUE recompute-on-read. criteria_json =
--    arbre de critères AND (status/source/score/tags/dates + comportemental
--    opened/clicked/in_sequence) interprété côté handler. cached_count /
--    cached_at = cache best-effort (ZÉRO table de membres matérialisée — la
--    liste des leads est recalculée à la demande). Bornage tenant
--    client_id/agency_id nullables (calque funnels seq 83).
CREATE TABLE IF NOT EXISTS lead_segments (
  id TEXT PRIMARY KEY,
  client_id TEXT, agency_id TEXT,
  name TEXT, criteria_json TEXT,
  cached_count INTEGER DEFAULT 0, cached_at TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

-- 2) broadcast_variants — variante A/B d'un broadcast (1 broadcast → N
--    variantes, jointure APPLICATIVE par broadcast_id, zéro FK). split_pct =
--    part d'audience (somme = 100 validée côté handler). sent/opened/clicked =
--    agrégats tracking par variante (COUNT message_events ↔
--    messages.campaign_variant_id). template_id / body_html / body_text =
--    contenu propre à la variante (sujet A/B en colonne `subject`).
CREATE TABLE IF NOT EXISTS broadcast_variants (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL,
  label TEXT,
  subject TEXT, template_id TEXT, body_html TEXT, body_text TEXT,
  split_pct INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0, opened INTEGER NOT NULL DEFAULT 0, clicked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 3) broadcasts — enrichissement ADDITIF (table seq 24 INTOUCHÉE pour
--    l'existant ; CHECK status seq 24 INTOUCHABLE). ab_test_enabled 0 = chemin
--    legacy byte-identique (un seul corps, pas de variantes). winning_variant_id
--    = gagnant MANUEL (NULL tant que non désigné). segment_id = ciblage par
--    segment réutilisable (NULL = ciblage par filters_json legacy).
ALTER TABLE broadcasts ADD COLUMN ab_test_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN winning_variant_id TEXT;
ALTER TABLE broadcasts ADD COLUMN segment_id TEXT;

-- 4) messages — corrélation variante ADDITIVE. campaign_variant_id NULL =
--    message hors-variante (legacy : reporting par broadcast via campaign_id
--    seq 86 inchangé). Renseigné ⇒ reporting open/click PAR variante (Option A
--    tranchée §6.A : pas de table de jointure dédiée, colonne sur messages).
ALTER TABLE messages ADD COLUMN campaign_variant_id TEXT;

-- Index ADDITIFs idempotents — lookup segments par tenant ; fil des variantes
-- d'un broadcast (reporting + partition d'envoi).
CREATE INDEX IF NOT EXISTS idx_lead_segments_client ON lead_segments(client_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_variants_broadcast ON broadcast_variants(broadcast_id);

-- NB : 2 tables NEUVES, 4 ALTER ADD COLUMN ADDITIFS (broadcasts ×3 / messages
-- ×1), AUCUN ALTER sur une CONTRAINTE. AUCUN touch `users` / `admin_sessions` /
-- tables E4/E6 régulées / `customer_segment_config` seq 68 (RFM e-commerce,
-- sans rapport). AUCUN CHECK existant modifié (status broadcasts seq 24 / role
-- users seq 59 INTOUCHÉS). AUCUNE FK. AUCUN DROP / RENAME / rebuild. Critères de
-- segment + split_pct validés côté HANDLER (Phase B Manager-B). Le moteur
-- d'envoi broadcast legacy (chemin ab_test_enabled=0) reste byte-identique ;
-- l'enrôlement workflow en masse (POST /api/segments/:id/enroll) RÉUTILISE
-- handleEnrollLead EXISTANT (moteur workflows.ts READ-ONLY). Choix figés
-- docs/LOT-SEGMENT-G6.md §6.
