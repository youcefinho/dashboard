-- Sprint S7 M1 — Sécurité intégrations : coffre chiffré des tokens d'intégration
-- (2026-05-17) — programme de renforcement plateforme (Lot 3).
--
-- Problème corrigé : tokens d'intégration stockés EN CLAIR dans KV
--   - ecommerce-channel-shopify.ts:184  STATE_STORE.put('shopify_token:'+id, accessToken)
--   - ecommerce-channel-woo.ts:140-143  STATE_STORE.put('woo_creds:'+id, JSON.stringify({ck,cs}))
-- Remplacés par cette table D1 chiffrée AES-GCM (src/worker/lib/secret-store.ts).
--
-- Conventions strictes (alignées schema.sql / migration-sprintE8-m1.sql:12-17) :
--   id TEXT PK lower(hex(randomblob(16))), FK REFERENCES table(id),
--   timestamps TEXT DEFAULT (datetime('now')) — JAMAIS unixepoch,
--   multi-tenant strict via client_id.
--
-- FK validées par grep migrations réelles :
--   - clients(id)        : table bootstrap schema.sql (hors tracker, db:init) —
--                          même cible que migration-sprintE8-m1.sql:26.
--   - sales_channels(id) : migration-sprintE8-m1.sql:24 (seq 69 manifest).
--     ⇒ DÉPEND de migration-sprintE8-m1.sql.
--
-- Additif / non destructif : CREATE IF NOT EXISTS uniquement, aucun ALTER,
-- aucune réécriture d'historique. ON DELETE CASCADE sur channel_id (purge
-- automatique des secrets quand un canal est supprimé).
--
-- Exécution manuelle : npx wrangler d1 execute intralys-crm --file=migration-sprintS7-m1.sql --remote

CREATE TABLE IF NOT EXISTS integration_secrets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  channel_id TEXT NOT NULL REFERENCES sales_channels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- 'shopify_token' | 'woo_creds'
  ciphertext TEXT NOT NULL,           -- AES-GCM (IV préfixé, base64) — clair si !TOKEN_KEY (dev)
  rotated_at TEXT,
  revoked_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(channel_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_intsec_client ON integration_secrets(client_id);
CREATE INDEX IF NOT EXISTS idx_intsec_channel ON integration_secrets(channel_id);
