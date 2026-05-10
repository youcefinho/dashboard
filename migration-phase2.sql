-- Migration Phase 2 — Conversations & Email
-- Exécuter : bun run db:migrate:phase2

-- ── Messages (email + SMS + notes internes) ────────────────
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')) NOT NULL,
  channel TEXT CHECK (channel IN ('email', 'sms', 'internal_note')) NOT NULL,
  subject TEXT DEFAULT '',
  body TEXT NOT NULL,
  status TEXT CHECK (status IN ('draft', 'sent', 'delivered', 'failed', 'read', 'bounced')) DEFAULT 'sent',
  sent_by TEXT DEFAULT '',          -- user_id de l'expéditeur
  external_id TEXT DEFAULT '',       -- ID Resend/Twilio pour tracking
  metadata TEXT DEFAULT '{}',        -- JSON : headers email, SID Twilio, etc.
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- ── Templates d'emails ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,                     -- NULL = template global Intralys
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT DEFAULT '',          -- Version texte brut (fallback)
  variables TEXT DEFAULT '[]',        -- JSON : ["nom", "courtier", "ville"]
  category TEXT CHECK (category IN ('welcome', 'followup', 'reminder', 'notification', 'marketing', 'general')) DEFAULT 'general',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_templates_client_id ON email_templates(client_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);

-- ── Données de démo : templates par défaut ─────────────────

INSERT OR IGNORE INTO email_templates (id, client_id, name, subject, body_html, variables, category)
VALUES
  ('tpl-welcome', NULL, 'Bienvenue — Nouveau lead',
   'Merci pour votre intérêt, {{nom}} !',
   '<h2>Bonjour {{nom}},</h2><p>Merci d''avoir pris contact avec nous ! Votre courtier <strong>{{courtier}}</strong> vous contactera sous peu pour discuter de votre projet immobilier.</p><p>En attendant, n''hésitez pas à nous poser vos questions.</p><p>Cordialement,<br/>L''équipe {{courtier}}</p>',
   '["nom", "courtier", "email"]', 'welcome'),

  ('tpl-followup-1', NULL, 'Relance J+1',
   '{{nom}}, avez-vous des questions ?',
   '<h2>Bonjour {{nom}},</h2><p>Nous voulions simplement nous assurer que vous avez bien reçu notre message précédent.</p><p>Votre courtier <strong>{{courtier}}</strong> est disponible pour répondre à toutes vos questions concernant votre projet {{type_projet}}.</p><p>N''hésitez pas à répondre à ce courriel ou à appeler au <strong>{{telephone_courtier}}</strong>.</p><p>À bientôt !</p>',
   '["nom", "courtier", "type_projet", "telephone_courtier"]', 'followup'),

  ('tpl-followup-3', NULL, 'Relance J+3',
   '{{nom}}, votre projet immobilier',
   '<h2>Bonjour {{nom}},</h2><p>Nous n''avons pas eu de vos nouvelles et voulions simplement vérifier si vous avez toujours un intérêt pour votre projet immobilier.</p><p>Si le moment n''est pas idéal, aucun souci — nous resterons disponibles quand vous serez prêt(e).</p><p>Cordialement,<br/><strong>{{courtier}}</strong></p>',
   '["nom", "courtier"]', 'followup'),

  ('tpl-rdv-confirm', NULL, 'Confirmation de rendez-vous',
   'Rendez-vous confirmé — {{date_rdv}}',
   '<h2>Bonjour {{nom}},</h2><p>Votre rendez-vous avec <strong>{{courtier}}</strong> est confirmé :</p><ul><li><strong>Date :</strong> {{date_rdv}}</li><li><strong>Heure :</strong> {{heure_rdv}}</li><li><strong>Lieu :</strong> {{lieu_rdv}}</li></ul><p>Si vous devez modifier ou annuler, veuillez nous contacter au <strong>{{telephone_courtier}}</strong>.</p><p>Au plaisir de vous rencontrer !</p>',
   '["nom", "courtier", "date_rdv", "heure_rdv", "lieu_rdv", "telephone_courtier"]', 'reminder'),

  ('tpl-rdv-reminder', NULL, 'Rappel de rendez-vous (24h)',
   'Rappel : votre rendez-vous demain avec {{courtier}}',
   '<h2>Bonjour {{nom}},</h2><p>Un petit rappel que votre rendez-vous avec <strong>{{courtier}}</strong> est prévu pour <strong>demain</strong> :</p><ul><li><strong>Heure :</strong> {{heure_rdv}}</li><li><strong>Lieu :</strong> {{lieu_rdv}}</li></ul><p>À demain !</p>',
   '["nom", "courtier", "heure_rdv", "lieu_rdv"]', 'reminder');
