-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 109 — LOT REPUTATION (Sprint 8 « Reputation — collecte 1st-party
-- + routing intelligent », 2026-05-21). Le module Reviews EXISTE (reviews.ts :
-- demande d'avis email Resend + bulk + agrégation handleGetReviewStats + réponse
-- IA, CASL via isLeadDnd, anti-doublon 30j ; tables review_requests/reviews_cache
-- seq 12). GAPS = le différenciateur GHL :
--   (a) page PUBLIQUE de dépôt d'avis hébergée Intralys (token-scopée) ;
--   (b) ROUTING INTELLIGENT (note ≥ seuil → redirige vers Google/FB public ;
--       note < seuil → feedback PRIVÉ interne, jamais exposé publiquement) ;
--   (c) déclenchement AUTO (action workflow `request_review`).
--
-- Cette migration AJOUTE 3 tables neuves + 1 COLONNE sur reviews_cache + 2 INDEX
-- de lecture. AUCUNE table modifiée par rebuild, AUCUN CHECK, AUCUNE FK, AUCUN
-- DROP/RENAME. Google Business Profile / Facebook restent INACTIFS (_v2-backlog,
-- routes 404 — NON réactivés ici) : le routing « public » se fait par URL
-- CONFIGURÉE (reputation_settings.public_redirect_url ou clients.google_place_id),
-- PAS par une API GBP/FB live.
--
-- depends_on : migration-storefront-seq108.sql (seq 108 — dernière migration du
--              manifest avant ce lot ; chaînage SÉQUENTIEL pour l'ordre, AUCUNE
--              dépendance de SCHÉMA réelle sur seq 108).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / ALTER d'une
--   CONTRAINTE existante. `CREATE TABLE IF NOT EXISTS` est idempotent. `ADD
--   COLUMN` (sans CHECK, sans NOT NULL, sans FK, défaut NULL) NE déclenche PAS de
--   rebuild SQLite (additif pur, rétro-compat byte : toutes les rows
--   reviews_cache legacy restent valides bit-pour-bit, la colonne y vaut NULL).
--
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit). Les liens
--   review_invitations.client_id ↔ clients(id), .lead_id ↔ leads(id),
--   private_feedback.invitation_id ↔ review_invitations(id) restent APPLICATIFS
--   (bornés serveur). reviews_cache (seq 12) N'EST PAS rebâtie : seul un ADD
--   COLUMN additif (source_origin) la complète.
--
-- TOLÉRANCE best-effort : `ADD COLUMN` n'est PAS idempotent sur SQLite/D1 (rejeu
--   ⇒ « duplicate column ») ; jouer UNE SEULE FOIS. `CREATE TABLE/INDEX IF NOT
--   EXISTS` reste idempotent. scripts/migrate.ts est FIGÉ, NON modifié — l'entrée
--   manifest seq 109 est OBLIGATOIRE (ajoutée Phase A).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-reputation-seq109.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) review_invitations — invitation d'avis 1st-party hébergée Intralys, résolue
--    par TOKEN sur la page publique /r/:token (calque /api/form/:slug). Créée par
--    l'action workflow `request_review` (Manager-B) OU manuellement. rating_submitted
--    / comment_submitted / routed_to / submitted_at sont remplis au POST public.
--    routed_to ∈ { 'public' (≥ seuil → redirection Google/FB), 'private' (< seuil
--    → feedback interne) } — PAS de CHECK (valeur applicative, additif).
CREATE TABLE IF NOT EXISTS review_invitations (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  lead_id TEXT,
  token TEXT UNIQUE,
  channel TEXT,
  status TEXT DEFAULT 'sent',
  rating_submitted INTEGER,
  comment_submitted TEXT,
  routed_to TEXT,
  submitted_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 2) private_feedback — feedback NÉGATIF capté en privé (note < seuil) : ne part
--    JAMAIS vers Google/FB, reste interne pour traitement (status 'new' →
--    traité). C'est le cœur du routing intelligent côté « insatisfait ».
CREATE TABLE IF NOT EXISTS private_feedback (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  lead_id TEXT,
  invitation_id TEXT,
  rating INTEGER,
  comment TEXT,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 3) reputation_settings — réglages réputation PAR client (1 row/tenant, PK
--    client_id). rating_threshold = seuil de routing (défaut 4 ⇒ 4-5 → public,
--    1-3 → privé). public_redirect_url = URL de dépôt public (Google/FB) ; si
--    NULL, fallback clients.google_place_id côté handler. widget_enabled /
--    notify_on_review = flags d'affichage / notification.
CREATE TABLE IF NOT EXISTS reputation_settings (
  client_id TEXT PRIMARY KEY,
  rating_threshold INTEGER DEFAULT 4,
  public_redirect_url TEXT,
  widget_enabled INTEGER DEFAULT 0,
  notify_on_review INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 4) reviews_cache.source_origin — distingue l'ORIGINE d'un avis caché :
--    'internal' (déposé via la page publique 1st-party Intralys, note ≥ seuil)
--    vs 'google'/'facebook' (sync externe — INACTIF _v2-backlog). Défaut NULL =
--    rétro-compat : toutes les rows reviews_cache existantes restent valides
--    bit-pour-bit (la colonne y vaut NULL). PAS de CHECK (valeur applicative).
ALTER TABLE reviews_cache ADD COLUMN source_origin TEXT;

-- 5) Index de LECTURE (idempotents) :
--    - idx_review_invitations_token : lookup O(index) du token sur CHAQUE hit de
--      la page publique GET /api/r/:token (resolveInvitationToken). Sans index :
--      full scan review_invitations.
--    - idx_private_feedback_client : liste du feedback privé par tenant (PRO
--      GET /api/reputation/private-feedback), borné client_id.
CREATE INDEX IF NOT EXISTS idx_review_invitations_token ON review_invitations(token);
CREATE INDEX IF NOT EXISTS idx_private_feedback_client ON private_feedback(client_id);

-- NB : 3 tables ADDITIVES (IF NOT EXISTS) + 1 colonne ADDITIVE (NULL, sans
-- CHECK/NOT NULL/FK) + 2 index de LECTURE. AUCUN CHECK modifié. AUCUNE FK. AUCUN
-- DROP / RENAME / rebuild. AUCUNE capability ajoutée (page publique = sans
-- capability, bornée par token ; settings PRO = capability EXISTANTE réutilisée).
-- Google/FB INACTIFS (_v2-backlog). Contrat figé docs/LOT-REPUTATION.md §6.
