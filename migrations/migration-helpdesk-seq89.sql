-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 89 — LOT G1 Helpdesk & Tickets de support (2026-05-20)
-- Système de support client : tickets multi-canaux (form public / email) +
-- base de connaissances (KB) publique simple. Un ticket s'ouvre par visiteur
-- ANONYME (lead_id NULLABLE) — l'Inbox lead-centric (conversations.lead_id
-- requis) NE PEUT PAS être réutilisée telle quelle ; ce lot pose des tables
-- NEUVES qui calquent le pattern `funnels` (seq 83 : client_id/agency_id en
-- colonnes directes, slug applicatif, bornage tenant côté handler).
--
-- depends_on : migration-reports-d-seq88.sql (seq 88 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 88).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER
--   d'une CONTRAINTE existante.
--   Ce lot N'AJOUTE QUE :
--     - 3 `CREATE TABLE IF NOT EXISTS` (support_tickets, ticket_messages,
--       kb_articles) NEUVES, idempotentes ;
--     - 6 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN `ALTER TABLE` sur une table existante. La table `conversations`
--   (seq 23 — Inbox) reste INTOUCHÉE : un ticket n'est PAS une conversation
--   (visiteur anonyme possible, lead_id nullable). Le wiring CRM (rattacher
--   un ticket à un lead existant par match email/phone) est APPLICATIF, par
--   colonne `support_tickets.lead_id` nullable — PAS par FK, PAS par ALTER.
--
--   CHECK role `users` seq 59 (rebuild:users) est INTOUCHÉ. AUCUN touch
--   `users` / `admin_sessions`. AUCUN touch tables E4/E6 régulées
--   (`payments`, `payment_events`, `payment_provider_config`, `refunds`,
--   `disputes`, `return_requests`). AUCUNE table existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; la
--   jointure `ticket_messages.ticket_id` → `support_tickets.id` est
--   APPLICATIVE, par colonne TEXT). PAS de CHECK (additif pur — les statuts
--   ouvert|en_cours|attente_client|resolu|escale et sla_level none|1h|4h|24h|72h
--   sont validés côté HANDLER, pas par CHECK SQL : ajouter un CHECK plus tard
--   ⇒ rebuild ⇒ on ne s'enferme pas).
--
-- TOLÉRANCE « table exists » — exécution best-effort :
--   si seq 89 est rejouée, `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent
--   (pas d'erreur). L'exécuteur (Antigravity) joue ce fichier statement-par-
--   statement, log + CONTINUE au statement suivant. scripts/migrate.ts est
--   FIGÉ et N'EST PAS modifié ; la tolérance est une consigne d'exécution.
--
-- Conventions (calque funnels.ts seq 83) :
--   Bornage tenant : `client_id` (tenant propriétaire — calque funnels.client_id
--   seq 83) + `agency_id` (scope agence — calque funnels.agency_id seq 83). Tous
--   deux nullables : legacy/mono-tenant → NULL, mode agence → bornés.
--   Slug KB = unicité APPLICATIVE (slugify + suffixe collision calque funnels),
--   PAS de UNIQUE SQL. Timestamps en INTEGER `unixepoch()`.
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-helpdesk-seq89.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) support_tickets — ticket de support de premier ordre. lead_id NULLABLE
--    (visiteur anonyme). status applicatif (PAS de CHECK). sla_level enum
--    applicatif (none|1h|4h|24h|72h) + sla_due_at epoch calculé création.
--    assigned_to = user_id simple (calque conversations.assigned_to/tasks).
--    Bornage tenant client_id/agency_id nullables (calque funnels seq 83).
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT, agency_id TEXT,
  lead_id TEXT,
  subject TEXT, body TEXT,
  requester_name TEXT, requester_email TEXT, requester_phone TEXT,
  status TEXT DEFAULT 'ouvert',
  priority TEXT DEFAULT 'normal',
  sla_level TEXT DEFAULT 'none', sla_due_at INTEGER,
  assigned_to TEXT,
  source TEXT DEFAULT 'form',
  last_message_at INTEGER DEFAULT (unixepoch()),
  created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch())
);

-- 2) ticket_messages — fil de messages d'un ticket (1 ticket → N messages,
--    jointure APPLICATIVE par ticket_id, zéro FK). direction = inbound|outbound.
--    is_internal = note interne équipe (non visible requester). client_id
--    dénormalisé pour bornage rapide (best-effort).
CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  client_id TEXT,
  direction TEXT,
  author_id TEXT, author_name TEXT,
  body TEXT, is_internal INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

-- 3) kb_articles — article de base de connaissances publique. slug = unicité
--    APPLICATIVE (slugify + suffixe collision côté handler, PAS de UNIQUE SQL).
--    status = draft|published applicatif (PAS de CHECK). Bornage tenant
--    client_id/agency_id nullables (calque funnels seq 83).
CREATE TABLE IF NOT EXISTS kb_articles (
  id TEXT PRIMARY KEY,
  client_id TEXT, agency_id TEXT,
  slug TEXT, title TEXT, body_md TEXT, category TEXT,
  status TEXT DEFAULT 'draft',
  view_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch())
);

-- Index ADDITIFs idempotents — lookup tickets par tenant+statut (file de
-- support), par agence, par assigné (mes tickets) ; fil de messages trié
-- chronologique ; KB par tenant+statut + résolution slug public.
CREATE INDEX IF NOT EXISTS idx_support_tickets_client_status ON support_tickets(client_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_agency ON support_tickets(agency_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kb_articles_client_status ON kb_articles(client_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_articles_slug ON kb_articles(slug);

-- NB : 3 tables NEUVES, AUCUN ALTER sur une table existante. AUCUN touch
-- `conversations` (seq 23) / `leads` / `users` / `admin_sessions` / tables
-- E4/E6 régulées. AUCUN CHECK existant modifié (CHECK role users seq 59
-- INTOUCHÉ). AUCUNE FK. AUCUN DROP / RENAME / rebuild. Statuts/SLA validés
-- côté HANDLER (Phase B Manager-B). Wiring CRM (lead_id) = match applicatif
-- email/phone réutilisant le pipeline forms.ts (applyLeadMapping/resolveDedup/
-- mergeIntoLead), PAS de création de lead forcée. Choix figés
-- docs/LOT-HELPDESK-G1.md §6.
