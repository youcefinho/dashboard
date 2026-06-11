-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 83 — LOT FUNNELS & LANDING PAGE BUILDER (2026-05-19)
-- Builder de landing pages + funnels (éditeur drag-drop blocs, templates,
-- capture→CRM, étapes opt-in→content→upsell→thankyou, publication slug
-- tenant, analytics).
--
-- depends_on : migration-invoice-real-seq82.sql (seq 82 — dernière migration
--              du manifest avant ce lot ; chaînage séquentiel pour l'ordre,
--              AUCUNE dépendance de SCHÉMA réelle sur seq 82).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild.
--   Ce lot N'AJOUTE QUE des CREATE TABLE/INDEX IF NOT EXISTS (idempotents).
--   AUCUN ALTER sur une table existante. Les tables `funnel_pages`/`funnels`/
--   `funnel_steps`/`funnel_publications`/`funnel_analytics` sont NEUVES.
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ; les
--   jointures funnel↔steps / step↔page / funnel↔publication / funnel↔
--   analytics sont APPLICATIVES, par `funnel_id`/`step_id` en colonne TEXT).
--   AUCUN touch `users` / CHECK role seq 59. AUCUN touch tables E4/E6
--   régulées (`payments`, `payment_events`, `payment_provider_config`,
--   `refunds`, `disputes`, `return_requests`). AUCUNE activation paiement.
--
-- TOLÉRANCE « duplicate / table exists » — exécution best-effort :
--   si seq 83 est rejouée, les `CREATE TABLE/INDEX IF NOT EXISTS` sont
--   idempotents (pas d'erreur). Si un objet pré-existe sous une autre forme,
--   l'erreur éventuelle sur un statement est ATTENDUE et NON FATALE :
--   l'exécuteur (Antigravity) joue ce fichier statement-par-statement,
--   log + CONTINUE au statement suivant. scripts/migrate.ts est FIGÉ et
--   N'EST PAS modifié ; la tolérance est une consigne d'exécution, pas du code.
--
-- Conventions schema.sql : id TEXT PK lower(hex(randomblob(16))),
--   timestamps TEXT DEFAULT (datetime('now')). PAS d'unixepoch, PAS
--   d'INTEGER autoincrement, PAS de FK.
--
-- Bornage tenant : `client_id` (tenant propriétaire — calque forms.client_id)
--   + `agency_id` (scope agence — calque quotes.agency_id seq 82). Le slug de
--   publication a une unicité APPLICATIVE (vérifiée côté handler Phase B), PAS
--   de contrainte UNIQUE SQL (rétro-tolérance multi-tenant + best-effort).
--   `custom_domain` est POSÉ mais INACTIF (v2 — voir docs/LOT-FUNNEL.md §6.E).
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-funnel-seq83.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Funnels — conteneur de premier ordre. Un funnel = liste ordonnée
--    d'étapes (funnel_steps). status draft/published. Bornage tenant
--    client_id + agency_id.
CREATE TABLE IF NOT EXISTS funnels (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  agency_id TEXT,
  name TEXT NOT NULL DEFAULT 'Funnel sans titre',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  industry TEXT,
  total_views INTEGER NOT NULL DEFAULT 0,
  total_submissions INTEGER NOT NULL DEFAULT 0,
  total_conversions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_funnels_client ON funnels(client_id);
CREATE INDEX IF NOT EXISTS idx_funnels_agency ON funnels(agency_id);
CREATE INDEX IF NOT EXISTS idx_funnels_status ON funnels(status);

-- 2) Étapes du funnel — liste ordonnée (v1 linéaire dnd-kit ; funnel branché
--    = v2). step_type : opt-in / content / upsell / thankyou / generic.
--    Jointure applicative par funnel_id (PAS de FK). position = ordre dnd.
--    Chaque étape porte 0..1 page (funnel_pages.step_id) — relation
--    applicative 1:1.
CREATE TABLE IF NOT EXISTS funnel_steps (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  funnel_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Étape',
  step_type TEXT NOT NULL DEFAULT 'content' CHECK (step_type IN ('optin','content','upsell','thankyou','generic')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_funnel_steps_funnel ON funnel_steps(funnel_id);
CREATE INDEX IF NOT EXISTS idx_funnel_steps_position ON funnel_steps(funnel_id, position);

-- 3) Pages du funnel — UNE page = lecture/écriture ATOMIQUE (verdict figé :
--    PAS de table funnel_blocks normalisée). `blocks` = JSON array sérialisé
--    (FunnelBlock[] — voir docs/LOT-FUNNEL.md §6.C ; calque
--    email_templates.blocks / EmailBuilder). Jointure applicative par
--    funnel_id + step_id (PAS de FK). seo_* alimentent le snapshot crawler
--    (route-meta-ssr.ts maybeServeFunnelSsr).
CREATE TABLE IF NOT EXISTS funnel_pages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  funnel_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  title TEXT,
  blocks TEXT DEFAULT '[]',
  settings_json TEXT DEFAULT '{}',
  seo_title TEXT,
  seo_description TEXT,
  seo_image TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_funnel_pages_funnel ON funnel_pages(funnel_id);
CREATE INDEX IF NOT EXISTS idx_funnel_pages_step ON funnel_pages(step_id);

-- 4) Publications — un funnel publié reçoit une ligne (slug tenant). Le
--    rendu public `/p/:slug` (SPA hydraté, PAS de SSR React) résout
--    client_id + funnel_id ICI. Unicité du slug = APPLICATIVE (handler
--    Phase B), PAS de UNIQUE SQL. `custom_domain` POSÉ mais INACTIF (v2 —
--    routing domaine custom = lot ultérieur, jamais lu en v1). is_active
--    permet dé-publication sans suppression.
CREATE TABLE IF NOT EXISTS funnel_publications (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  funnel_id TEXT NOT NULL,
  client_id TEXT,
  agency_id TEXT,
  slug TEXT NOT NULL,
  custom_domain TEXT DEFAULT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  published_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_funnel_pub_slug ON funnel_publications(slug);
CREATE INDEX IF NOT EXISTS idx_funnel_pub_funnel ON funnel_publications(funnel_id);
CREATE INDEX IF NOT EXISTS idx_funnel_pub_client ON funnel_publications(client_id);

-- 5) Analytics — événements bruts (view / submit / conversion) + agrégation
--    par date côté stats (GROUP BY date(created_at), calque
--    handleGetFormStats forms.ts:186-190). Les compteurs dénormalisés
--    vivent sur funnels.total_* (UPDATE +1, calque forms.total_submissions).
--    Jointure applicative par funnel_id (PAS de FK).
CREATE TABLE IF NOT EXISTS funnel_analytics (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  funnel_id TEXT NOT NULL,
  step_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('view','submit','conversion')),
  lead_id TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_funnel_analytics_funnel ON funnel_analytics(funnel_id);
CREATE INDEX IF NOT EXISTS idx_funnel_analytics_event ON funnel_analytics(funnel_id, event_type);
CREATE INDEX IF NOT EXISTS idx_funnel_analytics_date ON funnel_analytics(funnel_id, created_at);

-- NB : AUCUNE colonne ajoutée à `users`/`clients`/`forms`/tables régulées.
-- Le wiring funnel→CRM (submit → lead) RÉUTILISE le pipeline forms.ts
-- (applyLeadMapping / resolveDedup / mergeIntoLead / INSERT leads borné
-- client_id / autoEnrollForTrigger 'form_submitted') — source='funnel',
-- client_id résolu depuis funnel_publications. Aucune duplication de la
-- logique dedup. Choix figé docs/LOT-FUNNEL.md §6.F.
