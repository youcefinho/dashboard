-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 92 — LOT G2 Programme d'affiliation natif
-- (2026-05-20)
-- Programme d'affiliation / parrainage côté PRO : entité affiliés dédiée +
-- programme (1 par tenant) + tracking de clics + jonction lead↔affilié +
-- commissions calculées SERVEUR. v1 = commission par CONVERSION (lead→won),
-- payout MANUEL (admin marque approved→paid + export CSV). ZÉRO Stripe, ZÉRO
-- paiement réel — les tables E4/E6 régulées (payments, payment_events,
-- payment_provider_config, refunds, disputes, return_requests) NE SONT NI
-- RÉUTILISÉES NI ALTÉRÉES (FLAG sécurité #1 — payout manuel v1, E4
-- payments_live_enabled=0 INTOUCHÉ).
--
-- ⚠ NAMESPACE `affiliate_*` IMPÉRATIF. `referral` existe DÉJÀ uniquement comme
--   source de lead (labels.source.referral / leads.source) — INCOMPATIBLE et
--   INTOUCHABLE. CE LOT NE LE RÉUTILISE NI NE L'ALTÈRE. Tables NEUVES dédiées.
--   Le pattern de redirect/clic est CALQUÉ sur trigger_links (seq 31) mais
--   AUCUNE table trigger_links n'est altérée (table NEUVE affiliate_clicks +
--   route publique NEUVE /r/:code, distincte de /l/:id).
--
-- ⚠ ATTRIBUTION : le paramètre de capture est `?aff=CODE` (PAS `?ref=`). L'alias
--   'ref' est DÉJÀ avalé par ATTRIBUTION_ALIASES.referrer (lead-mapping.ts:47).
--   `aff` est libre → zéro collision d'attribution. Pas de colonne leads.affiliate_id
--   (zéro ALTER leads) : la liaison passe par la table de jonction
--   affiliate_referrals (jointure APPLICATIVE par colonne TEXT lead_id).
--
-- depends_on : migration-aiworkspace-seq91.sql (seq 91 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 91).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   contrainte existante. Ce lot N'AJOUTE QUE :
--     - 5 `CREATE TABLE IF NOT EXISTS` (affiliates, affiliate_programs,
--       affiliate_clicks, affiliate_referrals, affiliate_commissions) NEUVES,
--       idempotentes ;
--     - 4 `CREATE INDEX IF NOT EXISTS` — neufs, idempotents.
--   AUCUN ALTER. AUCUN touch `leads` / `users` / `admin_sessions`. AUCUN touch
--   tables E4/E6 régulées. AUCUN touch `trigger_links` / `trigger_link_clicks`
--   (seq 31). Le CHECK role users seq 59 (rebuild:users) est INTOUCHÉ. AUCUNE
--   table existante recréée.
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures affiliate_referrals.lead_id → leads.id /
--   affiliate_referrals.affiliate_id → affiliates.id /
--   affiliate_commissions.referral_id → affiliate_referrals.id sont
--   APPLICATIVES, par colonne TEXT). PAS de CHECK (additif pur — les statuts
--   affiliates.status ('active'|'inactive') / commission_type ('fixed'|'percent')
--   / affiliate_commissions.status ('pending'|'approved'|'paid'|'rejected') sont
--   validés côté HANDLER, pas par CHECK SQL). Code unicité APPLICATIVE
--   (slugify + collision, PAS de contrainte UNIQUE SQL).
--
-- TOLÉRANCE rejeu — exécution best-effort :
--   `CREATE TABLE/INDEX IF NOT EXISTS` est idempotent (pas d'erreur si rejoué).
--   scripts/migrate.ts est FIGÉ et N'EST PAS modifié.
--
-- Conventions (calque seq 90/91 — aiworkspace / segment-abtest) :
--   id TEXT PK généré (lower(hex(randomblob(16)))), timestamps TEXT
--   DEFAULT (datetime('now')). PAS d'unixepoch. PAS d'INTEGER autoincrement,
--   PAS de FK. Bornage tenant : `client_id` NULLABLE (legacy/mono-tenant →
--   NULL, mode agence → borné) + `agency_id` NULLABLE (calque support_tickets
--   seq 89).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-affiliate-seq92.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) affiliates — l'affilié / parrain. Entité dédiée (PAS de 2e auth — promotion
--    lead→affilié = v2). code = identifiant public unique APPLICATIF (slugify +
--    collision côté handler, PAS de UNIQUE SQL). status validé HANDLER
--    ('active' | 'inactive'). Bornage tenant client_id/agency_id NULLABLE.
CREATE TABLE IF NOT EXISTS affiliates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  name TEXT,
  email TEXT,
  code TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 2) affiliate_programs — paramètres du programme (1 singleton par tenant).
--    commission_type validé HANDLER ('fixed' | 'percent'). commission_value =
--    montant fixe (fixed) OU pourcentage (percent, % de leads.deal_value).
--    cookie_window_days = durée d'attribution (cookie aff_attr). target_url =
--    destination du redirect /r/:code. Paliers = v2 (taux unique v1).
CREATE TABLE IF NOT EXISTS affiliate_programs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  commission_type TEXT DEFAULT 'fixed',
  commission_value REAL DEFAULT 0,
  cookie_window_days INTEGER DEFAULT 30,
  target_url TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 3) affiliate_clicks — log d'un clic sur le lien d'affiliation (route publique
--    /r/:code, calque trigger_link_clicks). Anonyme. ip/user_agent best-effort.
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  affiliate_id TEXT,
  code TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 4) affiliate_referrals — jonction lead↔affilié (PAS de colonne leads.affiliate_id
--    → zéro ALTER leads). Posée best-effort dans ingestLead si le payload porte
--    data.aff (code résolu → affiliate_id, borné client_id). lead_id / affiliate_id
--    = jointures APPLICATIVES.
CREATE TABLE IF NOT EXISTS affiliate_referrals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  affiliate_id TEXT,
  lead_id TEXT,
  code TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 5) affiliate_commissions — commission générée à la CONVERSION (lead→won),
--    calculée SERVEUR (onLeadWon). amount calculé d'après affiliate_programs
--    (fixed=commission_value ; percent=commission_value% de leads.deal_value).
--    status validé HANDLER ('pending' | 'approved' | 'paid' | 'rejected').
--    Payout MANUEL v1 (admin approved→paid + export CSV — ZÉRO Stripe).
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  affiliate_id TEXT,
  referral_id TEXT,
  lead_id TEXT,
  amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'CAD',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index ADDITIFs idempotents — résolution code public (redirect + lookup),
-- liaison lead→affilié, file des commissions d'un affilié par statut, et
-- clics d'un code dans le temps (analytics).
CREATE INDEX IF NOT EXISTS idx_aff_code ON affiliates(code);
CREATE INDEX IF NOT EXISTS idx_aff_referral_lead ON affiliate_referrals(lead_id);
CREATE INDEX IF NOT EXISTS idx_aff_commission_affiliate ON affiliate_commissions(affiliate_id, status);
CREATE INDEX IF NOT EXISTS idx_aff_clicks_code ON affiliate_clicks(code, created_at);

-- NB : 5 tables NEUVES (namespace affiliate_*), 4 INDEX NEUFS, AUCUN ALTER,
-- AUCUNE FK, AUCUN CHECK (statuts validés HANDLER ; code unicité APPLICATIVE).
-- AUCUN touch `leads` / `users` / `admin_sessions` / trigger_links seq 31 /
-- tables E4/E6 régulées. AUCUN DROP / RENAME / rebuild. Bornage tenant =
-- client_id/agency_id NULLABLE (calque support_tickets seq 89). v1 commission
-- par conversion, payout MANUEL (FLAG E4 payments_live_enabled=0 INTOUCHÉ).
-- Attribution via ?aff= (PAS ?ref=). Choix figés docs/LOT-AFFILIATE-G2.md §6.
