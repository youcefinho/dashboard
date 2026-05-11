-- ═══════════════════════════════════════════════════════════
-- Seed data réaliste — Intralys CRM PME (Sprint 4)
-- 3 clients (Cleaning, Dental, Coaching)
-- ═══════════════════════════════════════════════════════════

-- ── Admin ────────────────────────────────────────────────────
INSERT OR IGNORE INTO users (id, email, password_hash, name, role, client_id, is_active)
VALUES ('admin-001', 'admin@intralys.com', 'managed', 'Rochdi Dahmani', 'admin', NULL, 1);

-- ── Clients PMEs ────────────────────────────────────────
INSERT OR IGNORE INTO clients (id, name, email, phone, site_url, city, banner, is_active)
VALUES
  ('cleaning', 'Lumière Nettoyage Pro', 'contact@lumierenettoyage.com', '819-555-0101', 'https://cleaning.intralys.com', 'Gatineau', 'Lumière', 1),
  ('dental', 'Dr. Tremblay Dentisterie', 'info@tremblaydentaire.com', '514-555-0202', 'https://dental.intralys.com', 'Montréal', 'Tremblay', 1),
  ('coaching', 'Coach Performance Plus', 'hello@coachperformance.com', '418-555-0303', 'https://coaching.intralys.com', 'Québec', 'Performance', 1);

-- ── Utilisateurs ─────────────────────────────────
INSERT OR IGNORE INTO users (id, email, password_hash, name, role, client_id, is_active)
VALUES
  ('user-cleaning', 'contact@lumierenettoyage.com', 'managed', 'Marc Lumière', 'broker', 'cleaning', 1),
  ('user-dental', 'info@tremblaydentaire.com', 'managed', 'Dr. Alain Tremblay', 'broker', 'dental', 1),
  ('user-coaching', 'hello@coachperformance.com', 'managed', 'Julie Coach', 'broker', 'coaching', 1);

-- ═══════════════════════════════════════════════════════════
-- LEADS — Cleaning (10)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, message, type, status, source, budget, property_type, address, score, created_at)
VALUES
  ('lead-c01', 'cleaning', 'Sophie Tremblay', 'sophie.tremblay@gmail.com', '819-555-1001', 'Devis pour grand ménage de printemps 4 chambres.', 'inbound', 'new', 'website', '300', '', '123 rue Principale', 0, datetime('now', '-1 hours')),
  ('lead-c02', 'cleaning', 'Marc Bélanger', 'marc.belanger@outlook.com', '819-555-1002', 'Nettoyage régulier pour bureaux commerciaux 2000pc.', 'inbound', 'contacted', 'website', '1500', '', '456 Boul Industriel', 72, datetime('now', '-1 days')),
  ('lead-c03', 'cleaning', 'Julie Paquette', 'julie.paquette@hotmail.com', '819-555-1003', 'Nettoyage après construction.', 'inbound', 'qualified', 'website', '800', '', '789 Nouveau Dev', 85, datetime('now', '-3 days')),
  ('lead-c04', 'cleaning', 'Pierre Lavoie', 'pierre.lavoie@bell.ca', '819-555-1004', 'Lavage de vitres extérieur.', 'customer', 'won', 'website', '250', '', '321 Ch du Lac', 90, datetime('now', '-5 days')),
  ('lead-c05', 'cleaning', 'Isabelle Roy', 'isabelle.roy@yahoo.ca', '819-555-1005', 'Contrat mensuel garderie.', 'inbound', 'new', 'website', '600', '', '', 45, datetime('now', '-6 hours')),
  ('lead-c06', 'cleaning', 'Jean Dubé', 'jf.dube@gmail.com', '819-555-1006', 'Ménage avant déménagement.', 'inbound', 'contacted', 'website', '400', '', '', 68, datetime('now', '-2 days')),
  ('lead-c07', 'cleaning', 'Nathalie Gagnon', 'nathalie@videotron.ca', '819-555-1007', 'Finalement on le fait nous mêmes.', 'inbound', 'lost', 'website', '0', '', '', 15, datetime('now', '-10 days')),
  ('lead-c08', 'cleaning', 'Alex Côté', 'alex.cote@gmail.com', '819-555-1008', 'Nettoyage de conduits de ventilation.', 'inbound', 'new', 'referral', '350', '', '', 55, datetime('now', '-4 hours')),
  ('lead-c09', 'cleaning', 'Marie Pelletier', 'me.pelletier@icloud.com', '819-555-1009', 'Nettoyage tapis et meubles.', 'customer', 'qualified', 'facebook', '200', '', '987 Plateau', 78, datetime('now', '-4 days')),
  ('lead-c10', 'cleaning', 'Thomas Morin', 'thomas.morin@proton.me', '819-555-1010', 'Entretien ménager hebdomadaire Airbnb.', 'inbound', 'contacted', 'google_ads', '1000', '', '', 62, datetime('now', '-8 hours'));

-- ═══════════════════════════════════════════════════════════
-- LEADS — Dental (10)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, message, type, status, source, budget, property_type, address, score, created_at)
VALUES
  ('lead-d01', 'dental', 'David Chen', 'david.chen@gmail.com', '514-555-2001', 'Consultation pour Invisalign.', 'inbound', 'new', 'website', '5000', '', '', 80, datetime('now', '-3 hours')),
  ('lead-d02', 'dental', 'Sarah Martins', 'sarah.martins@outlook.com', '514-555-2002', 'Urgence dentaire, douleur intense.', 'inbound', 'qualified', 'website', '0', '', '', 88, datetime('now', '-2 days')),
  ('lead-d03', 'dental', 'Ahmed Bouzid', 'ahmed.bouzid@gmail.com', '514-555-2003', 'Blanchiment dentaire.', 'inbound', 'contacted', 'website', '400', '', '', 70, datetime('now', '-4 days')),
  ('lead-d04', 'dental', 'Émilie Fortin', 'emilie.fortin@bell.ca', '514-555-2004', 'Premier rendez-vous enfant.', 'inbound', 'new', 'website', '200', '', '', 55, datetime('now', '-12 hours')),
  ('lead-d05', 'dental', 'François Nguyen', 'f.nguyen@gmail.com', '514-555-2005', 'Implants dentaires complets.', 'customer', 'won', 'referral', '15000', '', '', 95, datetime('now', '-6 days')),
  ('lead-d06', 'dental', 'Camille Tremblay', 'camille.t@yahoo.ca', '514-555-2006', 'Nettoyage annuel.', 'inbound', 'contacted', 'instagram', '250', '', '', 60, datetime('now', '-1 days')),
  ('lead-d07', 'dental', 'Roberto Silva', 'roberto.silva@hotmail.com', '514-555-2007', 'Traitement de canal.', 'customer', 'qualified', 'website', '1200', '', '', 82, datetime('now', '-3 days')),
  ('lead-d08', 'dental', 'Mélanie Bouchard', 'mel.bouchard@gmail.com', '514-555-2008', 'Évaluation couronne.', 'inbound', 'new', 'google_ads', '800', '', '', 42, datetime('now', '-5 hours')),
  ('lead-d09', 'dental', 'Youssef Khalil', 'y.khalil@outlook.com', '514-555-2009', 'Prothèse partielle.', 'customer', 'contacted', 'referral', '3000', '', '', 75, datetime('now', '-7 days')),
  ('lead-d10', 'dental', 'Catherine Larose', 'c.larose@icloud.com', '514-555-2010', 'Renseignements tarifs.', 'inbound', 'lost', 'facebook', '0', '', '', 20, datetime('now', '-14 days'));

-- ═══════════════════════════════════════════════════════════
-- LEADS — Coaching (10)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, message, type, status, source, budget, property_type, address, score, created_at)
VALUES
  ('lead-h01', 'coaching', 'François Bergeron', 'francois@gmail.com', '418-555-3001', 'Coaching exécutif transition carrière.', 'inbound', 'new', 'website', '2000', '', '', 60, datetime('now', '-5 hours')),
  ('lead-h02', 'coaching', 'MC Dionne', 'mc.dionne@outlook.com', '418-555-3002', 'Mentorat gestion d''équipe.', 'inbound', 'contacted', 'website', '1500', '', '', 65, datetime('now', '-1 days')),
  ('lead-h03', 'coaching', 'Luc Proulx', 'luc.proulx@bell.ca', '418-555-3003', 'Programme leadership 6 mois.', 'customer', 'won', 'website', '5000', '', '', 88, datetime('now', '-7 days')),
  ('lead-h04', 'coaching', 'Stéphanie Parent', 'steph.parent@gmail.com', '418-555-3004', 'Gestion du stress et temps.', 'inbound', 'qualified', 'website', '1000', '', '', 72, datetime('now', '-2 days')),
  ('lead-h05', 'coaching', 'Martin Desj', 'martin.desj@videotron.ca', '418-555-3005', 'Développement des affaires.', 'inbound', 'new', 'referral', '3000', '', '', 50, datetime('now', '-9 hours')),
  ('lead-h06', 'coaching', 'Annie Savard', 'annie.savard@hotmail.com', '418-555-3006', 'Coaching prise de parole en public.', 'inbound', 'contacted', 'facebook', '800', '', '', 70, datetime('now', '-3 days')),
  ('lead-h07', 'coaching', 'Réjean Tanguay', 'rejean.t@gmail.com', '418-555-3007', 'Amélioration communication équipe.', 'customer', 'contacted', 'website', '2500', '', '', 58, datetime('now', '-5 days')),
  ('lead-h08', 'coaching', 'Valérie Asselin', 'valerie.asselin@icloud.com', '418-555-3008', 'Coaching de vie.', 'inbound', 'new', 'google_ads', '1200', '', '', 48, datetime('now', '-2 hours')),
  ('lead-h09', 'coaching', 'Sylvain Lemieux', 'sylvain.lem@proton.me', '418-555-3009', 'Lancement startup mentorat.', 'inbound', 'qualified', 'website', '4000', '', '', 85, datetime('now', '-4 days')),
  ('lead-h10', 'coaching', 'Karine Ouellet', 'karine.o@yahoo.ca', '418-555-3010', 'Curieuse des services.', 'inbound', 'lost', 'website', '0', '', '', 12, datetime('now', '-20 days'));

-- ═══════════════════════════════════════════════════════════
-- TEMPLATES — Email (10)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO email_templates (id, client_id, name, subject, body_html, body_text, category, is_active, created_at)
VALUES
  ('tpl-e01', NULL, 'Bienvenue — Nouveau lead', 'Bienvenue chez {{business_name}} !', '<h2>Bonjour {{nom}},</h2><p>Merci pour votre intérêt ! Notre équipe vous contactera sous 24h pour une consultation <strong>gratuite</strong>.</p><p>✅ Gratuit · ✅ Sans engagement · ✅ Confidentiel</p>', 'Bonjour {{nom}}, Merci pour votre intérêt ! On vous contactera sous 24h.', 'onboarding', 1, datetime('now', '-30 days')),
  ('tpl-e02', NULL, 'Relance J+1', 'Suite à votre demande, {{nom}}', '<h2>Bonjour {{nom}},</h2><p>Je voulais m''assurer que vous avez bien reçu notre réponse. Êtes-vous disponible cette semaine pour un appel rapide ?</p>', 'Bonjour {{nom}}, Suite à votre demande, êtes-vous disponible pour un appel ?', 'followup', 1, datetime('now', '-30 days')),
  ('tpl-e03', NULL, 'Relance J+3', 'Votre projet — on peut aider', '<h2>{{nom}},</h2><p>Votre projet nous tient à cœur. Notre équipe est disponible pour répondre à vos questions, sans engagement.</p>', 'Votre projet nous tient à cœur. Réservez un créneau.', 'followup', 1, datetime('now', '-30 days')),
  ('tpl-e04', NULL, 'Relance J+7', 'Toujours intéressé(e), {{nom}} ?', '<h2>Bonjour {{nom}},</h2><p>Ça fait une semaine que nous avons reçu votre demande. On peut vous aider à avancer.</p>', '', 'followup', 1, datetime('now', '-30 days')),
  ('tpl-e05', NULL, 'Confirmation RDV', 'Votre RDV est confirmé', '<h2>{{nom}}, c''est noté ! ✅</h2><p>Votre consultation est confirmée. Date : {{appointment_date}}.</p><p>Préparez vos questions — on est là pour vous.</p>', '', 'appointment', 1, datetime('now', '-30 days')),
  ('tpl-e06', NULL, 'Merci post-RDV', 'Merci pour notre rencontre, {{nom}}', '<h2>Merci {{nom}} !</h2><p>C''était un plaisir de discuter de vos besoins. Voici un résumé de nos échanges et les prochaines étapes.</p>', '', 'followup', 1, datetime('now', '-30 days')),
  ('tpl-e07', NULL, 'Devis personnalisé', 'Votre devis est prêt', '<h2>{{nom}}, bonne nouvelle !</h2><p>Votre devis personnalisé est complété. Contactez-nous pour en discuter.</p>', '', 'service', 1, datetime('now', '-30 days')),
  ('tpl-e08', NULL, 'Newsletter mensuelle', 'Les nouveautés de notre équipe', '<h2>Bonjour {{nom}},</h2><p>Voici nos derniers conseils et actualités du mois.</p>', '', 'newsletter', 1, datetime('now', '-30 days')),
  ('tpl-e09', NULL, 'Anniversaire client', 'Joyeux anniversaire, {{nom}} ! 🎂', '<h2>Joyeux anniversaire, {{nom}} !</h2><p>Toute l''équipe vous souhaite une magnifique journée. On est toujours là si vous avez besoin de nous.</p>', '', 'engagement', 1, datetime('now', '-30 days')),
  ('tpl-e10', NULL, 'Lead inactif 30j', 'On pense à vous, {{nom}}', '<h2>{{nom}},</h2><p>Ça fait un moment qu''on ne s''est pas parlé. Vos besoins sont-ils toujours d''actualité ? Un simple ''oui'' suffit !</p>', '', 'reactivation', 1, datetime('now', '-30 days'));

-- ═══════════════════════════════════════════════════════════
-- DEAL VALUES sur les leads gagnés/qualifiés
-- ═══════════════════════════════════════════════════════════
UPDATE leads SET deal_value = 250 WHERE id = 'lead-c04';
UPDATE leads SET deal_value = 15000 WHERE id = 'lead-d05';
UPDATE leads SET deal_value = 5000 WHERE id = 'lead-h03';
UPDATE leads SET deal_value = 1500 WHERE id = 'lead-c02';
UPDATE leads SET deal_value = 800 WHERE id = 'lead-c03';
UPDATE leads SET deal_value = 5000 WHERE id = 'lead-d01';
UPDATE leads SET deal_value = 1200 WHERE id = 'lead-d07';
UPDATE leads SET deal_value = 1000 WHERE id = 'lead-h04';
UPDATE leads SET deal_value = 4000 WHERE id = 'lead-h09';
UPDATE leads SET deal_value = 2500 WHERE id = 'lead-h07';

-- ═══════════════════════════════════════════════════════════
-- TASKS (8)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO tasks (id, title, description, due_date, priority, status, lead_id, client_id, assigned_to, created_by, created_at)
VALUES
  ('task-01', 'Appeler Sophie', 'Premier contact téléphonique.', datetime('now', '-1 days'), 'high', 'todo', 'lead-c01', 'cleaning', 'user-cleaning', 'admin-001', datetime('now', '-2 days')),
  ('task-02', 'Envoyer devis Marc', 'Nettoyage commercial 2000pc.', datetime('now'), 'high', 'in_progress', 'lead-c02', 'cleaning', 'user-cleaning', 'admin-001', datetime('now', '-3 days')),
  ('task-03', 'Contacter David', 'Discuter Invisalign options.', datetime('now', '+2 days'), 'medium', 'todo', 'lead-d01', 'dental', 'user-dental', 'admin-001', datetime('now', '-4 days')),
  ('task-04', 'Suivi François', 'Coaching carrière — intro call.', datetime('now', '+7 days'), 'high', 'todo', 'lead-h01', 'coaching', 'user-coaching', 'admin-001', datetime('now', '-6 days')),
  ('task-05', 'Rappeler Sarah', 'Urgence dentaire suivi.', datetime('now', '-2 days'), 'high', 'done', 'lead-d02', 'dental', 'user-dental', 'admin-001', datetime('now', '-5 days')),
  ('task-06', 'Préparer proposition Julie', 'Nettoyage post-construction.', datetime('now', '+1 days'), 'medium', 'in_progress', 'lead-c03', 'cleaning', 'user-cleaning', 'admin-001', datetime('now', '-3 days')),
  ('task-07', 'Suivi devis Émilie', 'Premier RDV enfant.', datetime('now', '+3 days'), 'low', 'todo', 'lead-d04', 'dental', 'user-dental', 'admin-001', datetime('now', '-1 days')),
  ('task-08', 'Envoyer contrat Luc', 'Programme leadership 6 mois.', datetime('now', '-3 days'), 'high', 'done', 'lead-h03', 'coaching', 'user-coaching', 'admin-001', datetime('now', '-8 days'));

-- ═══════════════════════════════════════════════════════════
-- CONVERSATIONS (10)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO conversations (id, lead_id, client_id, channel, status, subject, last_message_at, last_message_preview, unread_count, created_at)
VALUES
  ('conv-01', 'lead-c01', 'cleaning', 'email', 'open', 'Demande ménage printemps', datetime('now', '-1 hours'), 'Bonjour, je suis intéressée par vos services...', 1, datetime('now', '-1 hours')),
  ('conv-02', 'lead-c02', 'cleaning', 'email', 'open', 'Devis bureaux commerciaux', datetime('now', '-12 hours'), 'Merci pour le devis, j''ai quelques questions.', 0, datetime('now', '-1 days')),
  ('conv-03', 'lead-d01', 'dental', 'sms', 'open', 'Consultation Invisalign', datetime('now', '-3 hours'), 'Est-ce que le Dr Tremblay est disponible vendredi?', 1, datetime('now', '-3 hours')),
  ('conv-04', 'lead-d02', 'dental', 'email', 'closed', 'Urgence dentaire', datetime('now', '-2 days'), 'Merci beaucoup pour votre rapidité!', 0, datetime('now', '-3 days')),
  ('conv-05', 'lead-h01', 'coaching', 'email', 'open', 'Coaching transition carrière', datetime('now', '-5 hours'), 'Je voudrais en savoir plus sur le programme.', 1, datetime('now', '-5 hours')),
  ('conv-06', 'lead-c04', 'cleaning', 'sms', 'closed', 'Confirmation lavage vitres', datetime('now', '-4 days'), 'Parfait, on confirme pour mardi matin.', 0, datetime('now', '-5 days')),
  ('conv-07', 'lead-d05', 'dental', 'email', 'closed', 'Suivi implants', datetime('now', '-5 days'), 'Tout se passe bien, merci Dr Tremblay!', 0, datetime('now', '-7 days')),
  ('conv-08', 'lead-h03', 'coaching', 'email', 'closed', 'Contrat leadership', datetime('now', '-6 days'), 'Le contrat est signé, on démarre lundi.', 0, datetime('now', '-8 days')),
  ('conv-09', 'lead-c08', 'cleaning', 'email', 'open', 'Ventilation nettoyage', datetime('now', '-4 hours'), 'Combien ça coûte pour un 5 1/2?', 1, datetime('now', '-4 hours')),
  ('conv-10', 'lead-h04', 'coaching', 'sms', 'open', 'Gestion stress', datetime('now', '-1 days'), 'Disponible mercredi pour un appel?', 0, datetime('now', '-2 days'));

-- ═══════════════════════════════════════════════════════════
-- MESSAGES (15) — historique pour les conversations
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO messages (id, lead_id, client_id, conversation_id, direction, channel, subject, body, status, sent_by, created_at)
VALUES
  ('msg-01', 'lead-c01', 'cleaning', 'conv-01', 'inbound', 'email', 'Demande ménage', 'Bonjour, je suis intéressée par vos services de grand ménage.', 'delivered', '', datetime('now', '-1 hours')),
  ('msg-02', 'lead-c02', 'cleaning', 'conv-02', 'inbound', 'email', 'Devis bureaux', 'Bonjour, j''aurais besoin d''un devis pour 2000pc.', 'delivered', '', datetime('now', '-1 days')),
  ('msg-03', 'lead-c02', 'cleaning', 'conv-02', 'outbound', 'email', 'Re: Devis bureaux', 'Bonjour Marc, voici notre devis détaillé...', 'sent', 'user-cleaning', datetime('now', '-20 hours')),
  ('msg-04', 'lead-c02', 'cleaning', 'conv-02', 'inbound', 'email', 'Re: Devis bureaux', 'Merci pour le devis, j''ai quelques questions.', 'delivered', '', datetime('now', '-12 hours')),
  ('msg-05', 'lead-d01', 'dental', 'conv-03', 'inbound', 'sms', '', 'Est-ce que le Dr Tremblay est disponible vendredi?', 'delivered', '', datetime('now', '-3 hours')),
  ('msg-06', 'lead-d02', 'dental', 'conv-04', 'outbound', 'email', 'Votre RDV urgence', 'Bonjour Sarah, on vous attend demain 8h.', 'sent', 'user-dental', datetime('now', '-3 days')),
  ('msg-07', 'lead-d02', 'dental', 'conv-04', 'inbound', 'email', 'Re: Votre RDV urgence', 'Merci beaucoup pour votre rapidité!', 'delivered', '', datetime('now', '-2 days')),
  ('msg-08', 'lead-h01', 'coaching', 'conv-05', 'inbound', 'email', 'Coaching carrière', 'Je voudrais en savoir plus sur le programme.', 'delivered', '', datetime('now', '-5 hours')),
  ('msg-09', 'lead-c04', 'cleaning', 'conv-06', 'outbound', 'sms', '', 'On confirme pour mardi 9h. Merci Pierre!', 'sent', 'user-cleaning', datetime('now', '-5 days')),
  ('msg-10', 'lead-c04', 'cleaning', 'conv-06', 'inbound', 'sms', '', 'Parfait, on confirme pour mardi matin.', 'delivered', '', datetime('now', '-4 days'));

-- ═══════════════════════════════════════════════════════════
-- WORKFLOWS (4)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO workflows (id, client_id, name, description, trigger_type, trigger_config, is_active, created_at)
VALUES
  ('wf-01', NULL, 'Bienvenue nouveau lead', 'Séquence email de bienvenue J+0 / J+1 / J+3', 'lead_created', '{}', 1, datetime('now', '-30 days')),
  ('wf-02', NULL, 'Relance lead tiède', 'Relance si pas de réponse après 3 jours', 'status_changed', '{"to_status":"contacted"}', 1, datetime('now', '-30 days')),
  ('wf-03', NULL, 'Notification deal gagné', 'Notifier l''équipe quand un deal est gagné', 'status_changed', '{"to_status":"won"}', 1, datetime('now', '-30 days')),
  ('wf-04', NULL, 'Rappel RDV J-1', 'SMS rappel 24h avant le RDV', 'appointment_booked', '{}', 0, datetime('now', '-30 days'));

INSERT OR IGNORE INTO workflow_steps (id, workflow_id, step_order, step_type, config, created_at)
VALUES
  ('ws-01', 'wf-01', 1, 'send_email', '{"template_id":"tpl-e01"}', datetime('now', '-30 days')),
  ('ws-02', 'wf-01', 2, 'wait', '{"delay_minutes":1440}', datetime('now', '-30 days')),
  ('ws-03', 'wf-01', 3, 'send_email', '{"template_id":"tpl-e02"}', datetime('now', '-30 days')),
  ('ws-04', 'wf-01', 4, 'wait', '{"delay_minutes":2880}', datetime('now', '-30 days')),
  ('ws-05', 'wf-01', 5, 'send_email', '{"template_id":"tpl-e03"}', datetime('now', '-30 days')),
  ('ws-06', 'wf-02', 1, 'wait', '{"delay_minutes":4320}', datetime('now', '-30 days')),
  ('ws-07', 'wf-02', 2, 'send_email', '{"template_id":"tpl-e04"}', datetime('now', '-30 days')),
  ('ws-08', 'wf-03', 1, 'notify', '{"message":"Deal gagné pour {{name}} !"}', datetime('now', '-30 days')),
  ('ws-09', 'wf-04', 1, 'wait', '{"delay_minutes":-1440}', datetime('now', '-30 days')),
  ('ws-10', 'wf-04', 2, 'send_sms', '{"body":"Rappel : votre RDV demain. À bientôt !"}', datetime('now', '-30 days'));

-- ═══════════════════════════════════════════════════════════
-- APPOINTMENTS (6)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO appointments (id, lead_id, client_id, title, description, start_time, end_time, location, type, status, created_at)
VALUES
  ('appt-01', 'lead-c01', 'cleaning', 'Évaluation Sophie', 'Visite pour évaluer le ménage.', datetime('now', '+1 days', '+10 hours'), datetime('now', '+1 days', '+11 hours'), '123 rue Principale', 'visit', 'scheduled', datetime('now', '-1 hours')),
  ('appt-02', 'lead-d01', 'dental', 'Consultation Invisalign David', 'Premier examen.', datetime('now', '+3 days', '+14 hours'), datetime('now', '+3 days', '+15 hours'), 'Clinique Tremblay', 'meeting', 'confirmed', datetime('now', '-2 days')),
  ('appt-03', 'lead-h01', 'coaching', 'Appel découverte François', 'Appel 30min intro.', datetime('now', '+2 days', '+9 hours'), datetime('now', '+2 days', '+9 hours', '+30 minutes'), 'Zoom', 'call', 'scheduled', datetime('now', '-5 hours')),
  ('appt-04', 'lead-d05', 'dental', 'Suivi implants François', 'Contrôle 3 mois.', datetime('now', '-5 days', '+10 hours'), datetime('now', '-5 days', '+10 hours', '+30 minutes'), 'Clinique Tremblay', 'meeting', 'completed', datetime('now', '-10 days')),
  ('appt-05', 'lead-c07', 'cleaning', 'Devis Nathalie', 'Devis annulé.', datetime('now', '-8 days', '+14 hours'), datetime('now', '-8 days', '+15 hours'), '', 'call', 'cancelled', datetime('now', '-12 days')),
  ('appt-06', 'lead-h03', 'coaching', 'Signature contrat Luc', 'Signature programme 6 mois.', datetime('now', '-7 days', '+11 hours'), datetime('now', '-7 days', '+12 hours'), 'Bureau Coach Performance', 'signing', 'completed', datetime('now', '-10 days'));

-- ═══════════════════════════════════════════════════════════
-- ACTIVITY LOG (12) — événements récents pour le Dashboard
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO activity_log (lead_id, client_id, user_id, action, details, created_at)
VALUES
  ('lead-c01', 'cleaning', 'admin-001', 'created', '{"name":"Sophie Tremblay","source":"website"}', datetime('now', '-1 hours')),
  ('lead-d01', 'dental', 'admin-001', 'created', '{"name":"David Chen","source":"website"}', datetime('now', '-3 hours')),
  ('lead-c08', 'cleaning', 'admin-001', 'created', '{"name":"Alex Côté","source":"referral"}', datetime('now', '-4 hours')),
  ('lead-h01', 'coaching', 'admin-001', 'created', '{"name":"François Bergeron","source":"website"}', datetime('now', '-5 hours')),
  ('lead-c02', 'cleaning', 'user-cleaning', 'status_change', '{"from":"new","to":"contacted","name":"Marc Bélanger"}', datetime('now', '-18 hours')),
  ('lead-d02', 'dental', 'user-dental', 'status_change', '{"from":"new","to":"qualified","name":"Sarah Martins"}', datetime('now', '-2 days')),
  ('lead-c04', 'cleaning', 'user-cleaning', 'status_change', '{"from":"qualified","to":"won","name":"Pierre Lavoie"}', datetime('now', '-5 days')),
  ('lead-d05', 'dental', 'user-dental', 'deal_value_changed', '{"name":"François Nguyen","value":15000}', datetime('now', '-6 days')),
  ('lead-h03', 'coaching', 'user-coaching', 'status_change', '{"from":"qualified","to":"won","name":"Luc Proulx"}', datetime('now', '-7 days')),
  ('lead-c02', 'cleaning', 'user-cleaning', 'note_added', '{"name":"Marc Bélanger","note":"Devis envoyé par email"}', datetime('now', '-20 hours')),
  ('lead-d01', 'dental', 'user-dental', 'email_sent', '{"name":"David Chen","to":"david.chen@gmail.com"}', datetime('now', '-2 hours')),
  ('lead-h04', 'coaching', 'user-coaching', 'sms_sent', '{"name":"Stéphanie Parent","to":"418-555-3004"}', datetime('now', '-1 days'));

-- ═══════════════════════════════════════════════════════════
-- TAGS (variés)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO lead_tags (lead_id, tag) VALUES
  ('lead-c01', 'résidentiel'), ('lead-c01', 'nouveau'),
  ('lead-c02', 'commercial'), ('lead-c02', 'devis-envoyé'),
  ('lead-c04', 'client-fidèle'), ('lead-c04', 'résidentiel'),
  ('lead-d01', 'invisalign'), ('lead-d01', 'nouveau'),
  ('lead-d02', 'urgence'), ('lead-d05', 'vip'),
  ('lead-h01', 'transition'), ('lead-h03', 'leadership'),
  ('lead-h04', 'stress'), ('lead-c08', 'référé');
