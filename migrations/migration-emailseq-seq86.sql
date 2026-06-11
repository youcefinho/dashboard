-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 86 — LOT EMAIL MARKETING & SÉQUENCES PRO (Sprint 5, 2026-05-19)
-- Séquences drip multi-touch (= workflows linéaires, MOTEUR EXISTANT réutilisé),
-- broadcast programmé + throttle, tracking open/click (RÉUTILISE tracking.ts).
-- ADDITIF pur, zéro régression @xyflow / cron / Resend / message_events.
--
-- depends_on : migration-booking-seq84.sql (chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 84 ; seq 85
--              migration-promo-seq85.sql est PRISE par Sprint 4 — manifest
--              confirmé — donc ce lot réserve seq 86, on chaîne sur seq 84
--              comme convention de calque de l'en-tête garde-fous).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une CONTRAINTE existante.
--   Ce lot N'AJOUTE QUE :
--     - des `ALTER TABLE ... ADD COLUMN` (broadcasts / workflows / messages) —
--       additif pur, jamais de modification de CHECK/PK/FK existante ;
--     - des `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   Les tables `broadcasts` (seq 24, migration-phase14.sql), `workflows`
--   (seq 3, migration-phase3.sql ; rebuild seq 73 migration-sprintE9-m1.sql)
--   et `messages` (seq 2, migration-phase2.sql ; rebuild seq 49
--   migration-phase41.sql) EXISTENT DÉJÀ. AUCUNE n'est recréée.
--
--   Le CHECK status de `broadcasts` seq 24
--     status TEXT CHECK (status IN ('queued','processing','completed','failed'))
--   est INTOUCHABLE : modifier un CHECK ⇒ rebuild SQLite ⇒ INTERDIT. Un
--   broadcast PROGRAMMÉ = status `queued` (valeur EXISTANTE du CHECK) +
--   `scheduled_at` futur ; AUCUNE valeur de statut neuve n'est requise ⇒
--   ZÉRO rebuild. Les tables workflows / workflow_steps /
--   workflow_enrollments (CHECK / PK rebuild seq 73) sont INTOUCHÉES :
--   le flag `is_sequence` est un drapeau IGNORÉ par le moteur
--   (processWorkflowQueue / advanceEnrollment / autoEnrollForTrigger ne le
--   lisent jamais) ⇒ zéro régression cron / @xyflow.
--   Le CHECK role users seq 59 (rebuild:users) est INTOUCHÉ. AUCUN touch
--   `users`. AUCUN touch tables E4/E6 régulées (`payments`,
--   `payment_events`, `payment_provider_config`, `refunds`, `disputes`,
--   `return_requests`).
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures séquence↔workflow / broadcast↔messages / message↔campaign
--   sont APPLICATIVES, par colonne TEXT).
--
-- TOLÉRANCE « duplicate column » — exécution best-effort :
--   si seq 86 est rejouée, `ADD COLUMN` peut échouer (« duplicate column
--   name ») et `CREATE INDEX IF NOT EXISTS` est idempotent (pas d'erreur).
--   L'erreur éventuelle d'un `ADD COLUMN` rejoué est ATTENDUE et NON
--   FATALE : l'exécuteur (Antigravity) joue ce fichier statement-par-
--   statement, log + CONTINUE au statement suivant. scripts/migrate.ts est
--   FIGÉ et N'EST PAS modifié ; la tolérance est une consigne d'exécution.
--
-- Conventions schema.sql (vérifiées sur migration-booking-seq84.sql) :
--   id TEXT PK lower(hex(randomblob(16))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch, PAS d'INTEGER autoincrement,
--   PAS de FK.
--
-- Rétro-compat BYTE-IDENTIQUE : `scheduled_at` NULL ⇒ broadcast immédiat
--   (comportement legacy strictement identique) ; `throttle_per_min` 0 ⇒
--   pas de limite de débit (legacy Promise.all) ; `is_sequence` 0 ⇒
--   workflow normal ignoré du filtrage séquence ; `campaign_id` NULL ⇒
--   message hors-campagne (legacy, pas de pixel/réécriture liens).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-emailseq-seq86.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) broadcasts — enrichissement ADDITIF (table seq 24 INTOUCHÉE pour
--    l'existant ; CHECK status seq 24 INTOUCHABLE). scheduled_at NULL =
--    envoi immédiat (legacy). throttle_per_min 0 = pas de limite (legacy).
--    opened / clicked = agrégats tracking (COUNT message_events, §6.E).
ALTER TABLE broadcasts ADD COLUMN scheduled_at TEXT;
ALTER TABLE broadcasts ADD COLUMN throttle_per_min INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN opened INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN clicked INTEGER NOT NULL DEFAULT 0;

-- 2) workflows — flag séquence ADDITIF. is_sequence 0 = workflow normal.
--    Drapeau de CLASSEMENT UI uniquement : le moteur d'exécution
--    (processWorkflowQueue / advanceEnrollment / executeStep /
--    autoEnrollForTrigger) NE LE LIT JAMAIS ⇒ zéro régression cron/@xyflow.
ALTER TABLE workflows ADD COLUMN is_sequence INTEGER NOT NULL DEFAULT 0;

-- 3) messages — corrélation campagne ADDITIVE. campaign_id / campaign_kind
--    NULL = message hors-campagne (legacy : aucun pixel ni réécriture de
--    liens ⇒ chemin d'envoi existant strictement identique). campaign_kind
--    ∈ {'broadcast','sequence'} applicatif (PAS de CHECK — additif pur).
ALTER TABLE messages ADD COLUMN campaign_id TEXT;
ALTER TABLE messages ADD COLUMN campaign_kind TEXT;

-- 4) Index ADDITIFs idempotents — accélèrent l'agrégation tracking
--    (broadcasts.opened/clicked via COUNT message_events ↔ messages.campaign_id),
--    le balayage des broadcasts programmés (processScheduledBroadcasts) et le
--    filtrage UI des séquences (workflows.is_sequence).
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_scheduled ON broadcasts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_workflows_is_sequence ON workflows(is_sequence);

-- NB : AUCUNE colonne ajoutée à `users` / `clients` / tables E4/E6 régulées.
-- AUCUN CHECK existant modifié (status broadcasts seq 24 / role users seq 59
-- / CHECK workflow_enrollments seq 73 INTOUCHÉS). AUCUNE FK. AUCUN DROP /
-- RENAME / rebuild. Le moteur de séquences (Phase B) RÉUTILISE
-- processWorkflowQueue / advanceEnrollment / autoEnrollForTrigger /
-- handleEnrollLead EXISTANTS (aucun nouveau scheduler, aucun code moteur
-- neuf) ; le tracking RÉUTILISE tracking.ts (pixel /api/t/o/:id, redirect
-- /api/t/c/:id, table message_events seq 31). Choix figés
-- docs/LOT-EMAIL5.md §6.
