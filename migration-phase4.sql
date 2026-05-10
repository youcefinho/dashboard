-- Migration Phase 4 — Calendrier & Rendez-vous
-- Exécuter : bun run db:migrate:phase4

-- ── Table appointments ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  client_id TEXT NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  start_time TEXT NOT NULL,            -- ISO 8601
  end_time TEXT NOT NULL,
  location TEXT DEFAULT '',            -- URL Zoom, adresse, etc.
  type TEXT CHECK (type IN ('meeting', 'call', 'visit', 'signing', 'other')) DEFAULT 'meeting',
  status TEXT CHECK (status IN ('scheduled', 'confirmed', 'cancelled', 'completed', 'no_show')) DEFAULT 'scheduled',
  calendly_event_id TEXT,              -- ID Calendly si intégré
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_lead_id ON appointments(lead_id);
CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- ══════════════════════════════════════════════════════════════
-- Données de démo — RDV fictifs pour les leads existants
-- ══════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO appointments (id, lead_id, client_id, title, description, start_time, end_time, location, type, status)
VALUES
  ('rdv-001', 'lead-003', 'gatineau', 'Première rencontre — Julie Paquette', 'Discussion budget et critères de recherche', datetime('now', '+1 days', 'start of day', '+10 hours'), datetime('now', '+1 days', 'start of day', '+11 hours'), 'Bureau Royal LePage Gatineau', 'meeting', 'confirmed'),
  ('rdv-002', 'lead-004', 'gatineau', 'Signature compromis — Pierre Lavoie', 'Signature de la promesse d''achat pour le condo Hull', datetime('now', '+2 days', 'start of day', '+14 hours'), datetime('now', '+2 days', 'start of day', '+15 hours'), 'Notaire Me Tremblay, 123 rue Principale', 'signing', 'scheduled'),
  ('rdv-003', 'lead-006', 'gatineau', 'Appel de suivi — JF Dubé', 'Discuter des options d''investissement locatif disponibles', datetime('now', '+1 days', 'start of day', '+15 hours'), datetime('now', '+1 days', 'start of day', '+15 hours', '+30 minutes'), 'Zoom', 'call', 'scheduled'),
  ('rdv-004', 'lead-009', 'serujan', 'RDV refinancement — Sarah Martins', 'Présentation des options de refinancement commercial', datetime('now', '+3 days', 'start of day', '+9 hours'), datetime('now', '+3 days', 'start of day', '+10 hours'), 'Bureau Serujan, Montréal', 'meeting', 'confirmed'),
  ('rdv-005', 'lead-012', 'buteau', 'Visite propriété — François Bergeron', 'Visite de la maison au 45 rue des Érables, Sainte-Foy', datetime('now', '+0 days', 'start of day', '+16 hours'), datetime('now', '+0 days', 'start of day', '+17 hours'), '45 rue des Érables, Sainte-Foy', 'visit', 'confirmed');
