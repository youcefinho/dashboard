-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 139 — SPRINT 44 « Funnels Builder — pages multi-step + A/B
-- testing par étape + analytics conversion par étape » (2026-05-25)
--
-- ⚠ COLLISION NOMMAGE — Le Sprint 1 (seq83 — `migration-funnel-seq83.sql`)
--   a déjà posé des tables `funnels` + `funnel_steps` + `funnel_pages` +
--   `funnel_publications` + `funnel_analytics` dédiées au LOT FUNNEL initial
--   (un funnel = liste ordonnée d'étapes + page JSON `blocks`, sans A/B
--   testing). Sprint 44 introduit un MODULE DISTINCT : un **funnel builder
--   multi-step avec A/B testing par variante de page** (HTML rendu serveur),
--   tracking par visitor_id anonyme, et analytics conversion par étape.
--
--   Pour rester STRICTEMENT ADDITIF et NE PAS no-op silencieusement sur
--   `CREATE TABLE IF NOT EXISTS funnels` (qui serait préservé en l'état
--   seq83 avec ses colonnes incompatibles `status` / `industry` / `total_*`
--   sans `slug` / `primary_goal` / `is_published`), CE LOT UTILISE LE PRÉFIXE
--   `fb_` (« funnel builder » Sprint 44) pour les 5 tables neuves :
--     - `fb_funnels`              (≠ seq83 `funnels`)
--     - `fb_steps`                (≠ seq83 `funnel_steps`)
--     - `fb_step_variants`        (neuve — pas d'équivalent seq83)
--     - `fb_step_views`           (neuve — pas d'équivalent seq83)
--     - `fb_step_conversions`     (neuve — pas d'équivalent seq83)
--   Côté handlers (Phase B `funnels-builder.ts`) et types (`src/lib/api.ts`)
--   les **alias logiques** sont conservés (`Funnel`, `FunnelStep`,
--   `FunnelStepVariant`) — la mapping SQL ↔ TS est faite dans le handler
--   (`SELECT * FROM fb_funnels`). Aucune confusion runtime avec seq83
--   puisque le contexte est distinct (S1 = `/api/funnels/*` legacy, S44 =
--   `/api/funnels-builder/*` + `/api/public/funnels/*` builder).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild / CREATE
--   TABLE existante (les tables `funnels` / `funnel_steps` seq83 RESTENT
--   INCHANGÉES) / ALTER d'une contrainte existante. Ce lot N'AJOUTE QUE :
--     - 5 `CREATE TABLE IF NOT EXISTS fb_*`
--     - 7 `CREATE INDEX IF NOT EXISTS` (dont 1 UNIQUE composite client+slug)
--   AUCUN CHECK. AUCUNE FK destructrice (jointures applicatives par TEXT id).
--   AUCUN rebuild. AUCUN touch seq83 / seq107 / autres tables existantes.
--
-- ⚠ BORNAGE TENANT — toutes les tables nouvelles portent un `client_id`
--   colonne (résolu serveur via `resolveClientId` Phase B, JAMAIS depuis le
--   body). Les routes PUBLIQUES (`/api/public/funnels/track-view`,
--   `/api/public/funnels/track-conversion`, `/api/public/funnels/:slug/render`)
--   résolvent `client_id` depuis `fb_funnels.slug` côté handler.
--
-- ⚠ A/B TESTING — la résolution de variante par visiteur est DÉTERMINISTE
--   côté handler (`pickVariantForVisitor` dans `lib/funnel-engine.ts`) :
--   hash(visitor_id) modulo somme `traffic_pct` cumulé. Pas de RNG côté SQL.
--   Garantit qu'un même visiteur voit toujours la même variante (pas de
--   contamination des analytics).
--
-- ⚠ TRACKING ANONYME — `visitor_id` = UUID v4 généré côté navigateur dans un
--   cookie 1st-party `_intralys_fid` (calque deepLinks.ts). PAS d'IP brute
--   stockée. `user_agent_hash` = SHA-256 du UA tronqué à 32 hex chars
--   (anonymisation Loi 25). `country` = header CF-IPCountry (2 lettres,
--   non-PII).
--
-- ⚠ ENUMS HANDLER (whitelist JS, jamais CHECK SQL — rebuild interdit) :
--     - `fb_funnels.primary_goal`     ∈ `lead_capture|sale|webinar|other`
--     - `fb_steps.step_type`          ∈ `landing|optin|upsell|downsell|thank_you|custom`
--     - `fb_step_variants.is_control` ∈ `0|1`
--     - `fb_funnels.is_published`     ∈ `0|1`
--
-- depends_on : migration-courses-lms-seq138.sql (chaînage strict dernier lot
--              S43 LOT 4).
--
-- Voir docs/LOT-FUNNELS-S44.md §6 pour contrat figé inter-agent Phase B.
--
-- TOLÉRANCE rejeu — exécution best-effort : tous les CREATE sont idempotents
--   (`IF NOT EXISTS`).
--
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-funnels-seq139.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- ── fb_funnels : conteneur d'un funnel multi-step (S44 builder) ─────────────
-- slug UNIQUE par client_id (UNIQUE INDEX composite — pas CHECK SQL).
-- primary_goal : enum HANDLER whitelist (lead_capture par défaut).
-- is_published : 0/1 — toggle publication (route publique active si =1).
-- published_at : ISO timestamp du dernier publish (NULL si jamais publié).
CREATE TABLE IF NOT EXISTS fb_funnels (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id        TEXT NOT NULL,                      -- bornage tenant (resolveClientId)
  name             TEXT NOT NULL,                      -- nom interne du funnel
  slug             TEXT NOT NULL,                      -- slug UNIQUE par client (URL publique)
  description      TEXT,                               -- description optionnelle (UI admin)
  primary_goal     TEXT DEFAULT 'lead_capture',        -- enum HANDLER : lead_capture|sale|webinar|other
  is_published     INTEGER DEFAULT 0,                  -- 0 = draft, 1 = publié (route publique active)
  published_at     TEXT,                               -- ISO timestamp du dernier publish
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

-- ── fb_steps : étapes ordonnées d'un funnel (landing → optin → … → thank_you) ─
-- step_type : enum HANDLER (landing|optin|upsell|downsell|thank_you|custom).
-- order_index : position ASC dans le funnel (drag-and-drop UI Phase C).
-- redirect_after_url : URL externe optionnelle pour rediriger après conversion
--   (ex: vers /merci ou plateforme webinaire) — NULL = avancer vers step suivant.
CREATE TABLE IF NOT EXISTS fb_steps (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  funnel_id          TEXT NOT NULL,                    -- jointure applicative → fb_funnels.id
  name               TEXT NOT NULL,                    -- nom de l'étape (UI admin)
  step_type          TEXT DEFAULT 'landing',           -- enum HANDLER : landing|optin|upsell|downsell|thank_you|custom
  order_index        INTEGER DEFAULT 0,                -- position ASC dans le funnel
  redirect_after_url TEXT,                             -- URL externe optionnelle (NULL = step suivant)
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);

-- ── fb_step_variants : variantes A/B/C/... d'une étape ──────────────────────
-- variant_name : label libre (convention 'A'/'B'/'C'... mais TEXT pour
--   flexibilité — handler ne valide pas).
-- content_html : HTML complet de la page rendu serveur (Phase B render handler
--   wrappe avec layout shell + tracking pixel). Pas de stockage R2 v1.
-- traffic_pct : 0..1 — fraction du trafic dirigé vers cette variante. La
--   somme des traffic_pct d'un step doit être ≈ 1.0 (validation HANDLER,
--   PAS CHECK SQL). Si somme < 1 : reliquat distribué uniformément. Si > 1 :
--   normalisé côté handler.
-- is_control : 0/1 — flag UI pour identifier la variante de contrôle dans
--   l'analytics breakdown (PAS contrainte SQL).
CREATE TABLE IF NOT EXISTS fb_step_variants (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  step_id      TEXT NOT NULL,                          -- jointure applicative → fb_steps.id
  variant_name TEXT NOT NULL,                          -- 'A' | 'B' | 'C' | ... (TEXT libre HANDLER)
  content_html TEXT,                                   -- HTML page complète (rendu serveur)
  traffic_pct  REAL DEFAULT 0.5,                       -- 0..1 (fraction du trafic)
  is_control   INTEGER DEFAULT 0,                      -- 0/1 (UI breakdown)
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- ── fb_step_views : vues anonymes d'une variante par un visiteur ────────────
-- visitor_id : UUID v4 généré côté navigateur (cookie 1st-party
--   `_intralys_fid`). PAS d'IP brute, pas de PII. Anonyme + Loi 25 ok.
-- user_agent_hash : SHA-256 du UA tronqué 32 chars (HANDLER calcule via
--   crypto.subtle.digest). Anonymise tout en gardant le bucket UA pour
--   debug (mobile vs desktop).
-- country : header CF-IPCountry (2 lettres ISO, non-PII).
-- client_id : dénormalisé pour borner les SELECT analytics (évite double
--   join via fb_steps→fb_funnels).
CREATE TABLE IF NOT EXISTS fb_step_views (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  step_id         TEXT NOT NULL,                       -- jointure applicative → fb_steps.id
  variant_id      TEXT NOT NULL,                       -- jointure applicative → fb_step_variants.id
  visitor_id      TEXT NOT NULL,                       -- UUID v4 cookie 1st-party
  client_id       TEXT,                                -- dénormalisé (bornage analytics)
  viewed_at       TEXT DEFAULT (datetime('now')),
  user_agent_hash TEXT,                                -- SHA-256 tronqué 32 chars HANDLER
  country         TEXT                                 -- header CF-IPCountry (2 lettres)
);

-- ── fb_step_conversions : conversions d'un visiteur sur une variante ────────
-- next_step_id : NULL si conversion finale (thank_you), sinon FK applicative
--   → fb_steps.id (l'étape suivante atteinte).
-- conversion_value_cents : valeur monétaire optionnelle (sale step). Default
--   0 (lead_capture / webinar steps).
-- visitor_id : doit matcher un fb_step_views.visitor_id existant (cohérence
--   funnel — validation HANDLER best-effort).
CREATE TABLE IF NOT EXISTS fb_step_conversions (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  step_id                TEXT NOT NULL,                -- jointure applicative → fb_steps.id (origine)
  variant_id             TEXT NOT NULL,                -- jointure applicative → fb_step_variants.id
  visitor_id             TEXT NOT NULL,                -- doit matcher fb_step_views.visitor_id
  client_id              TEXT,                         -- dénormalisé (bornage analytics)
  next_step_id           TEXT,                         -- NULL si finale (thank_you), sinon fb_steps.id
  conversion_value_cents INTEGER DEFAULT 0,            -- valeur monétaire optionnelle (sale)
  converted_at           TEXT DEFAULT (datetime('now'))
);

-- ── Indexes (lookup admin + analytics + UNIQUE slug par client) ─────────────
--   - UNIQUE composite (client_id, slug) : unicité slug par tenant.
--     Garantit qu'un client peut avoir 2 funnels avec le même nom interne
--     MAIS pas 2 funnels avec le même slug public. Listing rapide par client
--     borné is_published.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fb_funnels_client_slug ON fb_funnels(client_id, slug);
--   - listing funnels d'un client filtrés publication (UI admin + render public)
CREATE INDEX IF NOT EXISTS idx_fb_funnels_client          ON fb_funnels(client_id, is_published);
--   - listing étapes d'un funnel ASC order_index (UI ordering + render flow)
CREATE INDEX IF NOT EXISTS idx_fb_steps_funnel            ON fb_steps(funnel_id, order_index);
--   - listing variantes d'une étape (UI A/B config + pickVariantForVisitor)
CREATE INDEX IF NOT EXISTS idx_fb_step_variants_step      ON fb_step_variants(step_id);
--   - analytics views par étape sur une plage temporelle (GROUP BY date)
CREATE INDEX IF NOT EXISTS idx_fb_step_views_step         ON fb_step_views(step_id, viewed_at);
--   - analytics views par variante (A/B comparison)
CREATE INDEX IF NOT EXISTS idx_fb_step_views_variant      ON fb_step_views(variant_id);
--   - analytics conversions par étape sur une plage temporelle
CREATE INDEX IF NOT EXISTS idx_fb_step_conversions_step   ON fb_step_conversions(step_id, converted_at);

-- NB : 5 CREATE TABLE IF NOT EXISTS, 7 CREATE INDEX IF NOT EXISTS (dont 1
-- UNIQUE composite). AUCUN CHECK, AUCUNE FK destructrice, AUCUN DROP /
-- RENAME / rebuild. Enums (primary_goal, step_type, is_published, is_control)
-- validés HANDLER (whitelist JS). UPDATE/DELETE bornés tenant (client_id
-- résolu serveur via resolveClientId, JAMAIS body). Capabilities
-- `settings.manage` (admin CRUD + analytics) RÉUTILISÉE — ZÉRO ajout à
-- ALL_CAPABILITIES. Routes PUBLIQUES (track-view, track-conversion, render)
-- = honeypot + rate-limit côté worker.ts pré-requireAuth. Choix figés
-- docs/LOT-FUNNELS-S44.md §6.
