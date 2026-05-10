-- ═══════════════════════════════════════
-- Données de démonstration — Intralys CRM
-- ═══════════════════════════════════════

-- Admin Rochdi
INSERT OR IGNORE INTO users (id, email, password_hash, name, role, client_id, is_active)
VALUES ('admin-001', 'rochdi@intralys.com', 'managed', 'Rochdi', 'admin', NULL, 1);

-- Clients courtiers
INSERT OR IGNORE INTO clients (id, name, email, phone, site_url, city, banner, is_active)
VALUES
  ('gatineau', 'Mathis Guimont', 'mathis@example.com', '819-555-0101', 'https://gatineau.intralys.com', 'Gatineau', 'Royal LePage', 1),
  ('serujan', 'Serujan Thanabal', 'serujan@example.com', '514-555-0202', 'https://serujan.intralys.com', 'Montréal', 'RE/MAX', 1),
  ('buteau', 'Équipe Buteau', 'buteau@example.com', '418-555-0303', 'https://buteau.intralys.com', 'Québec', 'Sutton', 1);

-- Courtier Mathis (accès courtier)
INSERT OR IGNORE INTO users (id, email, password_hash, name, role, client_id, is_active)
VALUES ('broker-mathis', 'mathis@example.com', 'managed', 'Mathis Guimont', 'broker', 'gatineau', 1);

-- Leads de démo — Gatineau (Mathis)
INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, message, type, status, source, created_at)
VALUES
  ('lead-001', 'gatineau', 'Sophie Tremblay', 'sophie@email.com', '819-555-1001', 'Je cherche une maison à Aylmer', 'buy', 'new', 'website', datetime('now', '-1 hours')),
  ('lead-002', 'gatineau', 'Marc Bélanger', 'marc@email.com', '819-555-1002', 'Estimation de ma propriété SVP', 'sell', 'contacted', 'website', datetime('now', '-1 days')),
  ('lead-003', 'gatineau', 'Julie Paquette', 'julie@email.com', '819-555-1003', 'Budget de 450 000 $, premier achat', 'buy', 'meeting', 'website', datetime('now', '-3 days')),
  ('lead-004', 'gatineau', 'Pierre Lavoie', 'pierre@email.com', '819-555-1004', 'Condo à vendre secteur Hull', 'sell', 'signed', 'website', datetime('now', '-5 days')),
  ('lead-005', 'gatineau', 'Isabelle Roy', 'isabelle@email.com', '819-555-1005', 'Terrain à Cantley', 'buy', 'new', 'website', datetime('now', '-6 hours')),
  ('lead-006', 'gatineau', 'Jean-François Dubé', 'jf@email.com', '819-555-1006', 'Investissement locatif', 'buy', 'contacted', 'website', datetime('now', '-2 days')),
  ('lead-007', 'gatineau', 'Nathalie Gagnon', 'nathalie@email.com', '819-555-1007', '', 'sell', 'lost', 'website', datetime('now', '-10 days'));

-- Leads de démo — Serujan
INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, message, type, status, source, created_at)
VALUES
  ('lead-008', 'serujan', 'David Chen', 'david@email.com', '514-555-2001', 'Hypothèque commerciale 2M$', 'buy', 'new', 'website', datetime('now', '-3 hours')),
  ('lead-009', 'serujan', 'Sarah Martins', 'sarah@email.com', '514-555-2002', 'Refinancement immeuble', 'buy', 'meeting', 'website', datetime('now', '-2 days')),
  ('lead-010', 'serujan', 'Ahmed Bouzid', 'ahmed@email.com', '514-555-2003', 'Achat multi-logements', 'buy', 'contacted', 'website', datetime('now', '-4 days')),
  ('lead-011', 'serujan', 'Émilie Fortin', 'emilie@email.com', '514-555-2004', 'Premier achat Plateau', 'buy', 'new', 'website', datetime('now', '-12 hours'));

-- Leads de démo — Buteau
INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, message, type, status, source, created_at)
VALUES
  ('lead-012', 'buteau', 'François Bergeron', 'francois@email.com', '418-555-3001', 'Maison à Sainte-Foy', 'buy', 'new', 'website', datetime('now', '-5 hours')),
  ('lead-013', 'buteau', 'Marie-Claude Dionne', 'mc@email.com', '418-555-3002', 'Vendre ma maison à Lévis', 'sell', 'contacted', 'website', datetime('now', '-1 days')),
  ('lead-014', 'buteau', 'Luc Proulx', 'luc@email.com', '418-555-3003', 'Duplex investissement', 'buy', 'signed', 'website', datetime('now', '-7 days'));
