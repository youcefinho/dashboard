-- ── Sprint 84 (seq179) — Journal d'Audit Système (System Audit Logs) ──
--
-- Création de la table system_audit_logs pour tracer de manière exhaustive
-- toutes les actions de sécurité et de conformité du compte (Loi 25 / RGPD).

CREATE TABLE IF NOT EXISTS system_audit_logs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  payload_json TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_audit_logs_client ON system_audit_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_created ON system_audit_logs(created_at);
