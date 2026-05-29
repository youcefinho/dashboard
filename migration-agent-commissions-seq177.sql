-- Migration Sprint 82 (seq177) — Commissions d'Équipe de Vente
CREATE TABLE IF NOT EXISTS agent_commissions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  commission_cents INTEGER NOT NULL,
  status TEXT CHECK (status IN ('pending', 'paid', 'cancelled')) DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_commissions_client ON agent_commissions(client_id);
CREATE INDEX IF NOT EXISTS idx_agent_commissions_user ON agent_commissions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_commissions_lead ON agent_commissions(lead_id);
