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
-- TASKS (12)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO tasks (id, title, description, due_date, priority, status, lead_id, client_id, assigned_to, created_by, created_at)
VALUES
  ('task-01', 'Appeler Sophie', 'Premier contact', datetime('now', '-1 days'), 'high', 'todo', 'lead-c01', 'cleaning', 'user-cleaning', 'admin-001', datetime('now', '-2 days')),
  ('task-02', 'Envoyer devis Marc', 'Nettoyage commercial.', datetime('now'), 'high', 'in_progress', 'lead-c02', 'cleaning', 'user-cleaning', 'admin-001', datetime('now', '-3 days')),
  ('task-03', 'Contacter David', 'Discuter Invisalign.', datetime('now', '+2 days'), 'medium', 'todo', 'lead-d01', 'dental', 'user-dental', 'admin-001', datetime('now', '-4 days')),
  ('task-04', 'Suivi François', 'Consultation carrière.', datetime('now', '+7 days'), 'high', 'todo', 'lead-h01', 'coaching', 'user-coaching', 'admin-001', datetime('now', '-6 days'));
