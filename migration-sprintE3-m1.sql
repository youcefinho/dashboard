-- ── Migration Sprint E3 M1 — Commandes (lifecycle + numérotation) ────────────
-- (2026-05-16) Module Boutique B2. Additif / non destructif sur le schéma E1.
--
-- Conventions strictes projet :
--   id TEXT (lower(hex(randomblob(16)))) — pas d'INTEGER autoincrement applicatif.
--   Timestamps TEXT DEFAULT (datetime('now')) — jamais unixepoch.
--   Money en cents INTEGER (déjà géré par les colonnes orders E1).
--   Multi-tenant : order_number_counters indexé par client_id (1 séquence/tenant).
--
-- order_number concurrent-safe : la séquence est portée par une ligne unique
-- par tenant ; l'incrément se fait via un seul statement atomique D1
-- (UPDATE ... RETURNING) — pas de course read-then-write.

-- Compteur de numéro de commande, une séquence par tenant (départ #1001).
CREATE TABLE IF NOT EXISTS order_number_counters (
  client_id   TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1001,
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Timestamps de cycle de vie (renseignés par la machine à états du lifecycle).
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN shipped_at TEXT;
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
