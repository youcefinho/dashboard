-- Sprint S8 M1 — Onboarding unifié CRM + e-commerce : table d'état de complétion
-- (2026-05-17) — programme de renforcement plateforme.
--
-- Problème corrigé : l'onboarding (WelcomeWizard Sprint 45) ne persiste RIEN
--   côté serveur. handleWelcomeOnboarding (src/worker/onboarding.ts) échoe le
--   payload mais ne touche que users.name/email + onboarding_step. L'état
--   (étape courante, étapes complétées, opt-in e-commerce, payload) vit
--   uniquement en localStorage ⇒ perdu au changement d'appareil / navigateur.
--
-- Cette table porte l'état d'onboarding par couple (client_id, user_id) :
--   - reprise multi-appareil (GET /api/onboarding/state)
--   - sauvegarde incrémentale d'étape (PUT /api/onboarding/state)
--   - opt-in e-commerce (ecommerce_opted_in) — NE déclenche AUCUNE activation
--     paiement (E4/E6 régulés, payments_live_enabled=0 jamais touché).
--
-- Conventions strictes (alignées schema.sql / migration-sprintS7-m1.sql:26-37 /
-- migration-sprintE8-m1.sql:12-17) :
--   id TEXT PK lower(hex(randomblob(16))), FK REFERENCES table(id),
--   timestamps TEXT DEFAULT (datetime('now')) — JAMAIS unixepoch,
--   multi-tenant strict via client_id + user_id.
--
-- FK validées par grep migrations/code réels :
--   - clients(id) : table bootstrap schema.sql (hors tracker, db:init) — même
--                   cible que migration-sprintS7-m1.sql:28 / sprintE8-m1.sql:26.
--   - users(id)   : table bootstrap schema.sql, reconstruite par
--                   migration-sprintE1-m2-modules-role.sql (seq 59,
--                   "rebuild:users") ⇒ DÉPEND de cette migration pour que la
--                   FK users(id) pointe la table finale.
--
-- Additif / non destructif : CREATE IF NOT EXISTS uniquement, aucun ALTER,
-- aucune réécriture d'historique. UNIQUE(client_id, user_id) ⇒ upsert idempotent.
--
-- Exécution manuelle : npx wrangler d1 execute intralys-crm --file=migration-sprintS8-m1.sql --remote

CREATE TABLE IF NOT EXISTS onboarding_state (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  current_step INTEGER DEFAULT 0,
  completed_steps_json TEXT DEFAULT '[]',
  payload_json TEXT,
  ecommerce_opted_in INTEGER DEFAULT 0,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_onbstate_client ON onboarding_state(client_id);
CREATE INDEX IF NOT EXISTS idx_onbstate_user ON onboarding_state(user_id);
