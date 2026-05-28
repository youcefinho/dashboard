-- Migration seq 161 — Sprint 66 Moteur de Routage Intelligent des Commandes
-- Ce lot ajoute le support du routage de commandes vers des warehouses spécifiques.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-order-routing-rules-seq161.sql --remote

CREATE TABLE IF NOT EXISTS order_routing_rules (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  conditions_json TEXT DEFAULT '[]',
  action_warehouse_id TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_order_routing_rules_client ON order_routing_rules(client_id, priority);

-- Ajout de la colonne warehouse_id à orders pour persister l'affectation
ALTER TABLE orders ADD COLUMN warehouse_id TEXT;
