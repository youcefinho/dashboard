-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 104 — LOT SMS/WHATSAPP COMPLETION (Sprint « SMS/WhatsApp
-- completion », 2026-05-21). Ferme 5 gaps du canal SMS sortant/entrant (Twilio
-- flag-inactif, déjà ~85% : helpers.sendSms / handleInboundSms / Inbox 2-way) :
--   1) STOP / opt-out CASL : l'inbound ne détecte PAS STOP (non-conforme légal).
--   2) Signature Twilio : webhooks /api/webhook/sms publics SANS validation.
--   3) Delivery receipts : pas de status-callback SMS (messages.delivery_status).
--   4) Broadcast SMS de masse : le mass-send est email-only (broadcasts.channel).
--   5) WhatsApp : ABSENT → squelette flag-inactif (sms_templates /
--      whatsapp_connections + sendWhatsAppTemplate gardé flag).
-- 100% ADDITIF, sans rien casser.
--
-- depends_on : migration-booking-reminders-seq103.sql (seq 103 — dernière
--              migration du manifest avant ce lot ; chaînage SÉQUENTIEL pour
--              l'ordre, AUCUNE dépendance de SCHÉMA réelle sur seq 103).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une CONTRAINTE existante.
--   Ce lot N'AJOUTE QUE des `ALTER TABLE ... ADD COLUMN` (broadcasts / messages)
--   et des `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
--   (sms_templates / whatsapp_connections) — additif pur, jamais de
--   modification de CHECK/PK/FK existante.
--   Les tables `broadcasts` (seq 24, migration-phase14.sql, enrichie seq 86/90)
--   et `messages` (seq 2, migration-phase2.sql, rebuild seq 49) EXISTENT DÉJÀ.
--   AUCUNE n'est recréée.
--
--   `messages.channel` et `messages.status` sont SANS CHECK depuis seq 49
--   (rebuild:messages migration-phase41.sql) ⇒ ajouter les valeurs applicatives
--   'whatsapp' (channel) / 'delivered' / 'failed' (status) est LIBRE et n'exige
--   AUCUN ALTER de CHECK. La colonne `delivery_status` (seq 104) est un canal
--   d'horodatage du receipt Twilio DISTINCT de `status` (legacy intouché) :
--   NULL = legacy (jamais de receipt), sinon 'queued'|'sent'|'delivered'|'failed'
--   etc. — SANS CHECK (libre, posé applicativement par handleSmsStatusCallback).
--
--   AUCUN touch tables E4/E6 régulées (`payments`, `payment_events`,
--   `payment_provider_config`, `refunds`, `disputes`, `return_requests`).
--   AUCUN touch `users` / `clients`. AUCUNE colonne `price_cents` modifiée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les
--   jointures sms_templates↔client / whatsapp_connections↔client restent
--   APPLICATIVES (colonne client_id TEXT, bornage serveur).
--
-- RÉTRO-COMPAT BYTE : `broadcasts.channel` a DEFAULT 'email' ⇒ tout broadcast
--   existant reste 'email' (chemin email INCHANGÉ). `broadcasts.body_text` et
--   `messages.delivery_status` sont NULLABLES ⇒ les rows legacy restent valides.
--
-- TOLÉRANCE « duplicate column » — exécution best-effort : si seq 104 est
--   rejouée, `ADD COLUMN` peut échouer (« duplicate column name »). L'erreur
--   éventuelle est ATTENDUE et NON FATALE (scripts/migrate.ts:21-30 reconnaît
--   le motif bénin 'duplicate column' et enregistre/skip). scripts/migrate.ts
--   est FIGÉ et N'EST PAS modifié ; la tolérance est une consigne d'exécution.
--
-- Conventions schema.sql (vérifiées sur migration-booking-reminders-seq103.sql
--   + migration-telephony-seq102.sql) :
--   timestamps TEXT DEFAULT (datetime('now')), id TEXT PRIMARY KEY. PAS
--   d'unixepoch, PAS d'INTEGER autoincrement, PAS de FK.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-sms-whatsapp-seq104.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) broadcasts — enrichissement ADDITIF (table seq 24 INTOUCHÉE pour
--    l'existant). channel = canal d'envoi du broadcast ('email' par DÉFAUT ⇒
--    rétro-compat byte : un broadcast existant reste 'email'). 'sms' = mass-send
--    SMS (branché Phase B dans processBroadcastQueueJob). body_text = corps SMS
--    en clair (NULL pour les broadcasts email legacy ; le HTML email reste dans
--    body_html / html_content existant — body_text NE remplace RIEN).
ALTER TABLE broadcasts ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';
ALTER TABLE broadcasts ADD COLUMN body_text TEXT;

-- 2) messages — enrichissement ADDITIF. `channel`/`status` (seq 49 SANS CHECK)
--    NON modifiés. delivery_status = horodatage/état du delivery receipt Twilio
--    (status-callback), DISTINCT de `status` (legacy intouché). NULL = legacy
--    (aucun receipt reçu). Posé applicativement par handleSmsStatusCallback
--    (Phase B) via MAJ par MessageSid — SANS CHECK.
ALTER TABLE messages ADD COLUMN delivery_status TEXT;

-- 3) sms_templates — table NEUVE (modèles de SMS réutilisables, CRUD protégé
--    capability 'settings.manage'). client_id = bornage tenant APPLICATIF (PAS
--    de FK). created_at TEXT DEFAULT datetime('now') (convention repo).
CREATE TABLE IF NOT EXISTS sms_templates (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  name TEXT,
  body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 4) whatsapp_connections — table NEUVE (config WhatsApp Business par tenant,
--    CRUD protégé 'settings.manage'). status DEFAULT 'inactive' (squelette
--    flag-inactif : tant qu'access_token absent → aucun appel réseau Meta).
--    access_token stocké tel quel (squelette ; durcissement chiffrement = v2,
--    calque oauth_connections — HORS scope seq 104). client_id APPLICATIF.
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  phone_number_id TEXT,
  access_token TEXT,
  status TEXT DEFAULT 'inactive',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 5) Index ADDITIFS (IF NOT EXISTS) — accélèrent le bornage tenant des CRUD.
CREATE INDEX IF NOT EXISTS idx_sms_templates_client ON sms_templates(client_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_client ON whatsapp_connections(client_id);

-- NB : AUCUNE colonne ajoutée à `users` / `clients` / tables E4/E6 régulées.
-- AUCUN CHECK existant modifié (messages.channel/status seq 49 SANS CHECK —
-- valeurs 'whatsapp'/'delivered'/'failed' libres, aucun ALTER). AUCUNE FK.
-- AUCUN DROP / RENAME / rebuild. AUCUNE capability ajoutée (réutilise
-- 'settings.manage' templates/whatsapp + 'leads.write' envoi, seq 80). Contrat
-- figé docs/LOT-SMS-WHATSAPP.md §6.
