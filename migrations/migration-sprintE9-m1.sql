-- ════════════════════════════════════════════════════════════════════════════
-- Migration Sprint E9 — M1 (Chaman) : généralisation workflow_enrollments e-comm
-- ════════════════════════════════════════════════════════════════════════════
--
-- BUT : permettre aux workflows (moteur Sprint 46, workflows.ts) d'enrôler
-- des entités e-commerce (customer / order) en plus des leads CRM, SANS
-- toucher la rétro-compatibilité du chemin lead existant.
--
-- ── POINT DUR (rétro-compat CRM absolue) ────────────────────────────────────
-- workflow_enrollments.lead_id était `TEXT NOT NULL REFERENCES leads(id)
-- ON DELETE CASCADE` (migration-phase3.sql ~l.37). D1 applique
-- PRAGMA foreign_keys=ON par défaut : une sentinelle 'ECOM:'||customer_id
-- VIOLERAIT la contrainte FK (aucune ligne leads correspondante).
--
-- DÉCISION : table-rebuild (même pattern éprouvé que migration-phase41.sql
-- pour messages) — on relâche lead_id en NULLABLE + on retire la FK
-- REFERENCES leads, tout en COPIANT les données existantes bit-pour-bit.
-- Les enrollments LEAD existants gardent leur lead_id réel intact
-- (entity_type rétro-défaut 'lead'). Aucune sentinelle nécessaire :
-- lead_id reste NULL pour les entités e-comm, l'entité cible est résolue
-- via (entity_type, customer_id, order_id).
--
-- Convention DB STRICTE respectée : id hex(randomblob(16)), datetime('now'),
-- IF NOT EXISTS partout, ZÉRO double-ALTER (rebuild = recréation propre),
-- AUCUNE colonne carte, multi-tenant inchangé (client_id porté par workflow).
-- ════════════════════════════════════════════════════════════════════════════

PRAGMA foreign_keys=OFF;

-- ── Recréation workflow_enrollments : lead_id NULLABLE + sans FK leads ──────
-- + colonnes additives e-comm (customer_id, order_id, entity_type).
CREATE TABLE IF NOT EXISTS workflow_enrollments_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  lead_id TEXT,                          -- NULLABLE : NULL pour entités e-comm ; valeur réelle pour leads (rétro-compat)
  customer_id TEXT,                      -- e-comm : client (entity_type='customer'|'order')
  order_id TEXT,                         -- e-comm : commande (entity_type='order')
  entity_type TEXT DEFAULT 'lead',       -- 'lead' (défaut rétro-compat) | 'customer' | 'order'
  current_step_id TEXT,                  -- ID du step actuel
  status TEXT CHECK (status IN ('active', 'paused', 'completed', 'cancelled')) DEFAULT 'active',
  next_action_at TEXT,                   -- Quand le prochain step s'exécute (pour le cron)
  enrolled_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Copie des enrollments existants (si la table source existe).
-- entity_type forcé 'lead' + lead_id réel conservé → branche LEAD bit-pour-bit.
INSERT INTO workflow_enrollments_new
  (id, workflow_id, lead_id, customer_id, order_id, entity_type,
   current_step_id, status, next_action_at, enrolled_at, completed_at)
  SELECT id, workflow_id, lead_id, NULL, NULL, 'lead',
         current_step_id, status, next_action_at, enrolled_at, completed_at
  FROM workflow_enrollments;

DROP TABLE workflow_enrollments;
ALTER TABLE workflow_enrollments_new RENAME TO workflow_enrollments;

-- Recréation des index historiques (migration-phase3.sql l.45-48).
CREATE INDEX IF NOT EXISTS idx_enrollments_workflow_id ON workflow_enrollments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_lead_id ON workflow_enrollments(lead_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON workflow_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_next_action ON workflow_enrollments(next_action_at);

-- Nouveaux index e-comm (lookup d'idempotence par entité).
CREATE INDEX IF NOT EXISTS idx_enrollments_customer ON workflow_enrollments(customer_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_order ON workflow_enrollments(order_id);

PRAGMA foreign_keys=ON;

-- ── Index analytics commandes (lecture E9 M2 ecommerce-analytics) ───────────
-- Couvre les agrégats par tenant/statut/date et par client.
CREATE INDEX IF NOT EXISTS idx_orders_client_status_placed
  ON orders(client_id, status, placed_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_placed
  ON orders(customer_id, placed_at);
