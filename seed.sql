-- ═══════════════════════════════════════════════════════════
-- Seed data réaliste — Intralys CRM (Sprint Consolidation)
-- 3 clients · 30 leads · 15 conversations · 8 workflows
-- 15 templates · 12 tasks · 8 RDV · 5 documents · 1 admin
-- ═══════════════════════════════════════════════════════════

-- ── Admin ────────────────────────────────────────────────────
INSERT OR IGNORE INTO users (id, email, password_hash, name, role, client_id, is_active)
VALUES ('admin-001', 'admin@intralys.com', 'managed', 'Rochdi Dahmani', 'admin', NULL, 1);

-- ── Clients courtiers ────────────────────────────────────────
INSERT OR IGNORE INTO clients (id, name, email, phone, site_url, city, banner, is_active)
VALUES
  ('gatineau', 'Mathis Guimont', 'mathis@guimont-immo.com', '819-555-0101', 'https://gatineau.intralys.com', 'Gatineau', 'Royal LePage', 1),
  ('serujan', 'Serujan Thanabal', 'serujan@thanabal-hypo.com', '514-555-0202', 'https://serujan.intralys.com', 'Montréal', 'RE/MAX', 1),
  ('buteau', 'Équipe Buteau', 'info@equipebuteau.com', '418-555-0303', 'https://buteau.intralys.com', 'Québec', 'Sutton', 1);

-- ── Courtiers (accès broker) ─────────────────────────────────
INSERT OR IGNORE INTO users (id, email, password_hash, name, role, client_id, is_active)
VALUES
  ('broker-mathis', 'mathis@guimont-immo.com', 'managed', 'Mathis Guimont', 'broker', 'gatineau', 1),
  ('broker-serujan', 'serujan@thanabal-hypo.com', 'managed', 'Serujan Thanabal', 'broker', 'serujan', 1),
  ('broker-buteau', 'info@equipebuteau.com', 'managed', 'Marie-Claude Buteau', 'broker', 'buteau', 1);

-- ═══════════════════════════════════════════════════════════
-- LEADS — Gatineau (10)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, message, type, status, source, budget, property_type, address, score, created_at)
VALUES
  ('lead-g01', 'gatineau', 'Sophie Tremblay', 'sophie.tremblay@gmail.com', '819-555-1001', 'Je cherche une maison unifamiliale à Aylmer, 3 chambres minimum. Budget flexible.', 'buy', 'new', 'website', '450000', 'Maison unifamiliale', '', 0, datetime('now', '-1 hours')),
  ('lead-g02', 'gatineau', 'Marc Bélanger', 'marc.belanger@outlook.com', '819-555-1002', 'Estimation de ma propriété au 123 rue Principale, Hull. Construit en 2015.', 'sell', 'contacted', 'website', '520000', 'Maison unifamiliale', '123 rue Principale, Hull', 72, datetime('now', '-1 days')),
  ('lead-g03', 'gatineau', 'Julie Paquette', 'julie.paquette@hotmail.com', '819-555-1003', 'Premier achat avec mon conjoint. Budget de 350k-450k, secteur Plateau.', 'buy', 'meeting', 'website', '400000', 'Condo', '', 85, datetime('now', '-3 days')),
  ('lead-g04', 'gatineau', 'Pierre Lavoie', 'pierre.lavoie@bell.ca', '819-555-1004', 'Condo 2 chambres à vendre secteur Hull, rénové 2023.', 'sell', 'signed', 'website', '340000', 'Condo', '456 boul. St-Joseph, Hull', 90, datetime('now', '-5 days')),
  ('lead-g05', 'gatineau', 'Isabelle Roy', 'isabelle.roy@yahoo.ca', '819-555-1005', 'Recherche terrain boisé à Cantley, 20000+ pi².', 'buy', 'new', 'website', '180000', 'Terrain', '', 45, datetime('now', '-6 hours')),
  ('lead-g06', 'gatineau', 'Jean-François Dubé', 'jf.dube@gmail.com', '819-555-1006', 'Investissement locatif : duplex ou triplex Gatineau/Hull. Pas pressé.', 'buy', 'contacted', 'website', '600000', 'Multi-logements', '', 68, datetime('now', '-2 days')),
  ('lead-g07', 'gatineau', 'Nathalie Gagnon', 'nathalie.gagnon@videotron.ca', '819-555-1007', 'Pas intéressée finalement. Trouvé par nous-mêmes.', 'sell', 'lost', 'website', '0', '', '', 15, datetime('now', '-10 days')),
  ('lead-g08', 'gatineau', 'Alexandre Côté', 'alex.cote@gmail.com', '819-555-1008', 'Maison avec garage double, proche des écoles. Aylmer ou Chelsea.', 'buy', 'new', 'referral', '550000', 'Maison unifamiliale', '', 55, datetime('now', '-4 hours')),
  ('lead-g09', 'gatineau', 'Marie-Ève Pelletier', 'me.pelletier@icloud.com', '819-555-1009', 'Downsizing : vendre notre maison et acheter un condo 55+.', 'sell', 'meeting', 'facebook', '425000', 'Maison unifamiliale', '789 ch. Rivermead, Aylmer', 78, datetime('now', '-4 days')),
  ('lead-g10', 'gatineau', 'Thomas Morin', 'thomas.morin@proton.me', '819-555-1010', 'Relocalisation Ottawa→Gatineau. Cherche semi-détaché proche du pont.', 'buy', 'contacted', 'google_ads', '480000', 'Maison semi-détachée', '', 62, datetime('now', '-8 hours'));

-- ═══════════════════════════════════════════════════════════
-- LEADS — Serujan (10)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, message, type, status, source, budget, property_type, address, score, created_at)
VALUES
  ('lead-s01', 'serujan', 'David Chen', 'david.chen@gmail.com', '514-555-2001', 'Hypothèque commerciale 2M$ pour immeuble 12 logements Hochelaga.', 'buy', 'new', 'website', '2000000', 'Commercial', '', 80, datetime('now', '-3 hours')),
  ('lead-s02', 'serujan', 'Sarah Martins', 'sarah.martins@outlook.com', '514-555-2002', 'Refinancement immeuble à revenus 6 unités, Villeray.', 'buy', 'meeting', 'website', '1200000', 'Multi-logements', '321 rue de Castelnau, Villeray', 88, datetime('now', '-2 days')),
  ('lead-s03', 'serujan', 'Ahmed Bouzid', 'ahmed.bouzid@gmail.com', '514-555-2003', 'Premier achat multi-logements. Triplex Rosemont ou Ahuntsic.', 'buy', 'contacted', 'website', '800000', 'Multi-logements', '', 70, datetime('now', '-4 days')),
  ('lead-s04', 'serujan', 'Émilie Fortin', 'emilie.fortin@bell.ca', '514-555-2004', 'Premier achat condo Plateau Mont-Royal, studio ou 3½.', 'buy', 'new', 'website', '350000', 'Condo', '', 55, datetime('now', '-12 hours')),
  ('lead-s05', 'serujan', 'François Nguyen', 'f.nguyen@gmail.com', '514-555-2005', 'Portfolio commercial : 3 immeubles, restructuration hypothécaire.', 'buy', 'signed', 'referral', '5000000', 'Commercial', '', 95, datetime('now', '-6 days')),
  ('lead-s06', 'serujan', 'Camille Tremblay', 'camille.t@yahoo.ca', '514-555-2006', 'Pré-qualification hypothèque, premier achat Griffintown.', 'buy', 'contacted', 'instagram', '500000', 'Condo', '', 60, datetime('now', '-1 days')),
  ('lead-s07', 'serujan', 'Roberto Silva', 'roberto.silva@hotmail.com', '514-555-2007', 'Vente immeuble 8 logements Verdun, retraite.', 'sell', 'meeting', 'website', '1800000', 'Multi-logements', '55 rue Wellington, Verdun', 82, datetime('now', '-3 days')),
  ('lead-s08', 'serujan', 'Mélanie Bouchard', 'mel.bouchard@gmail.com', '514-555-2008', 'Investissement REER/hypothèque combiné, première propriété.', 'buy', 'new', 'google_ads', '320000', 'Condo', '', 42, datetime('now', '-5 hours')),
  ('lead-s09', 'serujan', 'Youssef Khalil', 'y.khalil@outlook.com', '514-555-2009', 'Consultation privée : transfert portfolio immobilier commercial.', 'buy', 'contacted', 'referral', '3000000', 'Commercial', '', 75, datetime('now', '-7 days')),
  ('lead-s10', 'serujan', 'Catherine Larose', 'c.larose@icloud.com', '514-555-2010', 'Pas de budget encore. Recherche préliminaire Longueuil.', 'buy', 'lost', 'facebook', '0', '', '', 20, datetime('now', '-14 days'));

-- ═══════════════════════════════════════════════════════════
-- LEADS — Buteau (10)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO leads (id, client_id, name, email, phone, message, type, status, source, budget, property_type, address, score, created_at)
VALUES
  ('lead-b01', 'buteau', 'François Bergeron', 'francois.bergeron@gmail.com', '418-555-3001', 'Maison à Sainte-Foy, 4 chambres, proche Université Laval.', 'buy', 'new', 'website', '550000', 'Maison unifamiliale', '', 60, datetime('now', '-5 hours')),
  ('lead-b02', 'buteau', 'Marie-Claude Dionne', 'mc.dionne@outlook.com', '418-555-3002', 'Vendre ma maison 1965 à Lévis, 2 étages, terrain 8000 pi².', 'sell', 'contacted', 'website', '380000', 'Maison unifamiliale', '12 rue des Érables, Lévis', 65, datetime('now', '-1 days')),
  ('lead-b03', 'buteau', 'Luc Proulx', 'luc.proulx@bell.ca', '418-555-3003', 'Duplex investissement locatif Saint-Roch ou Limoilou.', 'buy', 'signed', 'website', '420000', 'Multi-logements', '', 88, datetime('now', '-7 days')),
  ('lead-b04', 'buteau', 'Stéphanie Parent', 'steph.parent@gmail.com', '418-555-3004', 'Condo neuf Beauport, livraison 2027. Pré-construction.', 'buy', 'meeting', 'website', '300000', 'Condo', '', 72, datetime('now', '-2 days')),
  ('lead-b05', 'buteau', 'Martin Desjardins', 'martin.desj@videotron.ca', '418-555-3005', 'Chalet Charlevoix ou Portneuf, usage saisonnier.', 'buy', 'new', 'referral', '250000', 'Chalet', '', 50, datetime('now', '-9 hours')),
  ('lead-b06', 'buteau', 'Annie Savard', 'annie.savard@hotmail.com', '418-555-3006', 'Estimation gratuite maison Charlesbourg, réno complète 2020.', 'sell', 'contacted', 'facebook', '460000', 'Maison unifamiliale', '88 av. des Pins, Charlesbourg', 70, datetime('now', '-3 days')),
  ('lead-b07', 'buteau', 'Réjean Tanguay', 'rejean.t@gmail.com', '418-555-3007', 'Terrain à construire Cap-Rouge, Vue fleuve.', 'buy', 'contacted', 'website', '200000', 'Terrain', '', 58, datetime('now', '-5 days')),
  ('lead-b08', 'buteau', 'Valérie Asselin', 'valerie.asselin@icloud.com', '418-555-3008', 'Recherche bungalow L''Ancienne-Lorette, max 400k.', 'buy', 'new', 'google_ads', '400000', 'Maison unifamiliale', '', 48, datetime('now', '-2 hours')),
  ('lead-b09', 'buteau', 'Sylvain Lemieux', 'sylvain.lem@proton.me', '418-555-3009', 'Vendre rapidement — divorce. Maison Beauport.', 'sell', 'meeting', 'website', '350000', 'Maison unifamiliale', '33 rue des Bouleaux, Beauport', 85, datetime('now', '-4 days')),
  ('lead-b10', 'buteau', 'Karine Ouellet', 'karine.o@yahoo.ca', '418-555-3010', 'Exploration seulement. Pas de timeline.', 'buy', 'lost', 'website', '0', '', '', 12, datetime('now', '-20 days'));

-- ═══════════════════════════════════════════════════════════
-- TEMPLATES — Email (10)
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO email_templates (id, client_id, name, subject, body_html, body_text, category, is_active, created_at)
VALUES
  ('tpl-e01', NULL, 'Bienvenue — Nouveau lead', 'Bienvenue chez Intralys, {{nom}} !', '<h2>Bonjour {{nom}},</h2><p>Merci pour votre intérêt ! Un courtier vous contactera sous 24h pour une rencontre stratégique <strong>gratuite</strong>.</p><p>✅ Gratuit · ✅ Sans engagement · ✅ Confidentiel</p>', 'Bonjour {{nom}}, Merci pour votre intérêt ! Un courtier vous contactera sous 24h.', 'onboarding', 1, datetime('now', '-30 days')),
  ('tpl-e02', NULL, 'Relance J+1', 'Suite à votre demande, {{nom}}', '<h2>Bonjour {{nom}},</h2><p>Je voulais m''assurer que vous avez bien reçu notre réponse. Êtes-vous disponible cette semaine pour un appel de 15 minutes ?</p>', 'Bonjour {{nom}}, Suite à votre demande, êtes-vous disponible pour un appel ?', 'followup', 1, datetime('now', '-30 days')),
  ('tpl-e03', NULL, 'Relance J+3', 'Votre projet immobilier — on peut aider', '<h2>{{nom}},</h2><p>Votre projet immobilier nous tient à cœur. Notre équipe est disponible pour répondre à vos questions, sans engagement.</p><p><a href="{{calendly}}">Réserver un créneau →</a></p>', 'Votre projet immobilier nous tient à cœur. Réservez un créneau.', 'followup', 1, datetime('now', '-30 days')),
  ('tpl-e04', NULL, 'Relance J+7', 'Toujours à la recherche, {{nom}} ?', '<h2>Bonjour {{nom}},</h2><p>Ça fait une semaine que nous avons reçu votre demande. Le marché bouge vite — on peut vous aider à ne rien manquer.</p>', '', 'followup', 1, datetime('now', '-30 days')),
  ('tpl-e05', NULL, 'Confirmation RDV', 'Votre RDV est confirmé', '<h2>{{nom}}, c''est noté ! ✅</h2><p>Votre rencontre stratégique est confirmée. Lieu : {{lieu}}. Date : {{date}}.</p><p>Préparez vos questions — on est là pour vous.</p>', '', 'appointment', 1, datetime('now', '-30 days')),
  ('tpl-e06', NULL, 'Merci post-RDV', 'Merci pour votre rencontre, {{nom}}', '<h2>Merci {{nom}} !</h2><p>C''était un plaisir de discuter de votre projet. Voici un résumé de nos échanges et les prochaines étapes.</p>', '', 'followup', 1, datetime('now', '-30 days')),
  ('tpl-e07', NULL, 'Estimation gratuite', 'Votre estimation personnalisée est prête', '<h2>{{nom}}, bonne nouvelle !</h2><p>Notre analyse du marché pour votre propriété est complète. Contactez-nous pour en discuter.</p>', '', 'service', 1, datetime('now', '-30 days')),
  ('tpl-e08', NULL, 'Newsletter mensuelle', 'Marché immobilier — Tendances du mois', '<h2>Bonjour {{nom}},</h2><p>Voici les tendances du marché immobilier ce mois-ci dans votre secteur.</p>', '', 'newsletter', 1, datetime('now', '-30 days')),
  ('tpl-e09', NULL, 'Anniversaire client', 'Bonne fête, {{nom}} ! 🎂', '<h2>Joyeux anniversaire, {{nom}} !</h2><p>Toute l''équipe vous souhaite une magnifique journée. On est toujours là si vous avez besoin de nous.</p>', '', 'engagement', 1, datetime('now', '-30 days')),
  ('tpl-e10', NULL, 'Lead inactif 30j', 'On pense à vous, {{nom}}', '<h2>{{nom}},</h2><p>Ça fait un moment qu''on ne s''est pas parlé. Votre projet est-il toujours d''actualité ? Un simple ''oui'' suffit !</p>', '', 'reactivation', 1, datetime('now', '-30 days'));

-- ═══════════════════════════════════════════════════════════
-- TEMPLATES — SMS (via email_templates, catégorie 'sms')
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO email_templates (id, client_id, name, subject, body_html, body_text, category, is_active, created_at)
VALUES
  ('tpl-s01', NULL, 'Bienvenue SMS', 'Bienvenue', '', 'Bonjour {{nom}} ! Merci pour votre demande. Un courtier Intralys vous contactera sous 24h. 🏠', 'sms', 1, datetime('now', '-30 days')),
  ('tpl-s02', NULL, 'Relance J+1 SMS', 'Relance', '', 'Bonjour {{nom}}, avez-vous reçu notre courriel ? On aimerait planifier un appel de 5 min. Sans engagement 😊', 'sms', 1, datetime('now', '-30 days')),
  ('tpl-s03', NULL, 'Rappel RDV SMS', 'Rappel', '', '📅 Rappel : votre RDV est demain à {{heure}}. À bientôt ! — Votre courtier Intralys', 'sms', 1, datetime('now', '-30 days')),
  ('tpl-s04', NULL, 'Nouvelle propriété SMS', 'Alerte', '', '🏡 Nouvelle propriété qui pourrait vous intéresser ! Consultez : {{lien}}', 'sms', 1, datetime('now', '-30 days')),
  ('tpl-s05', NULL, 'Post-visite SMS', 'Suivi', '', 'Merci pour la visite {{nom}} ! Qu''en avez-vous pensé ? On peut en discuter quand vous voulez.', 'sms', 1, datetime('now', '-30 days'));

-- ═══════════════════════════════════════════════════════════
-- TASKS (12) — overdue, today, this week, done
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO tasks (id, title, description, due_date, priority, status, lead_id, client_id, assigned_to, created_by, created_at)
VALUES
  ('task-01', 'Appeler Sophie Tremblay', 'Premier contact téléphonique, discuter du budget et des besoins.', datetime('now', '-1 days'), 'high', 'todo', 'lead-g01', 'gatineau', 'broker-mathis', 'admin-001', datetime('now', '-2 days')),
  ('task-02', 'Envoyer estimation Marc Bélanger', 'Préparer l''estimation comparative de marché pour le 123 rue Principale.', datetime('now'), 'high', 'in_progress', 'lead-g02', 'gatineau', 'broker-mathis', 'admin-001', datetime('now', '-3 days')),
  ('task-03', 'Préparer dossier Julie Paquette', 'Documents pré-qualification + listing 3 condos Plateau.', datetime('now', '+2 days'), 'medium', 'todo', 'lead-g03', 'gatineau', 'broker-mathis', 'admin-001', datetime('now', '-4 days')),
  ('task-04', 'Signature notaire Pierre Lavoie', 'Confirmer date avec Me Tremblay au 819-555-9999.', datetime('now', '+7 days'), 'high', 'todo', 'lead-g04', 'gatineau', 'broker-mathis', 'admin-001', datetime('now', '-6 days')),
  ('task-05', 'Relance Isabelle Roy', 'Envoyer les terrains disponibles à Cantley ce mois-ci.', datetime('now', '+1 days'), 'low', 'todo', 'lead-g05', 'gatineau', 'broker-mathis', 'admin-001', datetime('now', '-1 days')),
  ('task-06', 'Appeler David Chen', 'Discuter hypothèque commerciale 2M$, vérifier pré-approbation.', datetime('now', '-2 days'), 'high', 'todo', 'lead-s01', 'serujan', 'broker-serujan', 'admin-001', datetime('now', '-5 days')),
  ('task-07', 'Visite immeuble Sarah Martins', 'Organiser visite 6 logements Villeray avec inspecteur.', datetime('now', '+3 days'), 'medium', 'todo', 'lead-s02', 'serujan', 'broker-serujan', 'admin-001', datetime('now', '-3 days')),
  ('task-08', 'Dossier François Nguyen', 'Restructuration 3 immeubles — préparer sommaire financier.', datetime('now', '+5 days'), 'high', 'in_progress', 'lead-s05', 'serujan', 'broker-serujan', 'admin-001', datetime('now', '-7 days')),
  ('task-09', 'Estimation maison MC Dionne', 'Analyse comparative Lévis, secteur similaire 2020-2026.', datetime('now'), 'medium', 'done', 'lead-b02', 'buteau', 'broker-buteau', 'admin-001', datetime('now', '-5 days')),
  ('task-10', 'RDV Stéphanie Parent', 'Présenter 3 projets condo neuf Beauport.', datetime('now', '+1 days'), 'medium', 'todo', 'lead-b04', 'buteau', 'broker-buteau', 'admin-001', datetime('now', '-3 days')),
  ('task-11', 'Suivi Sylvain Lemieux divorce', 'Obtenir copie jugement pour évaluer rapidité de vente.', datetime('now', '-3 days'), 'high', 'todo', 'lead-b09', 'buteau', 'broker-buteau', 'admin-001', datetime('now', '-5 days')),
  ('task-12', 'Mettre à jour pipeline Serujan', 'Revoir les 10 leads et déplacer les stagnants.', datetime('now', '+4 days'), 'low', 'done', NULL, 'serujan', 'broker-serujan', 'admin-001', datetime('now', '-8 days'));

-- ═══════════════════════════════════════════════════════════
-- CONVERSATIONS (8) — avec messages historiques
-- ═══════════════════════════════════════════════════════════
INSERT OR IGNORE INTO conversations (id, lead_id, client_id, channel, status, subject, last_message_at, last_message_preview, unread_count, created_at)
VALUES
  ('conv-01', 'lead-g01', 'gatineau', 'email', 'open', 'Recherche maison Aylmer', datetime('now', '-30 minutes'), 'Merci beaucoup ! On se parle bientôt.', 1, datetime('now', '-1 hours')),
  ('conv-02', 'lead-g02', 'gatineau', 'email', 'open', 'Estimation 123 rue Principale', datetime('now', '-6 hours'), 'Voici les comparables du secteur...', 0, datetime('now', '-1 days')),
  ('conv-03', 'lead-g03', 'gatineau', 'sms', 'open', '', datetime('now', '-1 days'), 'Super, on se voit mardi à 10h !', 0, datetime('now', '-3 days')),
  ('conv-04', 'lead-g09', 'gatineau', 'email', 'open', 'Downsizing projet', datetime('now', '-2 days'), 'Nous avons 3 condos 55+ à vous proposer.', 2, datetime('now', '-4 days')),
  ('conv-05', 'lead-s01', 'serujan', 'email', 'open', 'Hypothèque commerciale 2M$', datetime('now', '-1 hours'), 'Pouvez-vous nous envoyer les états financiers ?', 1, datetime('now', '-3 hours')),
  ('conv-06', 'lead-s02', 'serujan', 'email', 'open', 'Refinancement Villeray', datetime('now', '-12 hours'), 'Le dossier est en cours d''analyse.', 0, datetime('now', '-2 days')),
  ('conv-07', 'lead-b02', 'buteau', 'email', 'closed', 'Estimation Lévis', datetime('now', '-2 days'), 'Merci pour l''estimation, très utile !', 0, datetime('now', '-3 days')),
  ('conv-08', 'lead-b09', 'buteau', 'sms', 'open', '', datetime('now', '-4 hours'), 'Oui on peut visiter samedi matin.', 1, datetime('now', '-4 days'));
