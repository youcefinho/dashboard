-- Sprint S9 M1 — Perf à l'échelle : index D1 manquants + table télémétrie web_vitals
-- (2026-05-17) — programme de renforcement plateforme, lot « perf ».
--
-- Problème corrigé :
--   1. `leads` n'a AUCUN index sur client_id / status / created_at alors que
--      handleGetClientLeads (src/worker/leads.ts:74) fait `WHERE client_id=?`,
--      `:77-79` `AND status=?`, `:91` `ORDER BY created_at DESC`, et
--      reports.ts:22-52 enchaîne 6+ agrégations `WHERE created_at>=? [AND
--      client_id]` ⇒ full table scan systématique.
--   2. `tasks` n'a pas d'index sur client_id / created_at (existants : assigned_to,
--      status, due_date, lead_id — cf migration-phase5.sql:49-52).
--   3. `order_items` n'a qu'un index sur order_id (idx_order_items_order,
--      migration-sprintE1-m1:209). Les jointures/filtres par variante font un
--      scan. ⚠️ La table order_items NE POSSÈDE PAS de colonne `product_id`
--      (cf migration-sprintE1-m1-ecommerce-schema.sql:195-207 : colonnes
--      id, order_id, variant_id, *_snapshot, *_cents, quantity, created_at).
--      On indexe donc `variant_id` (colonne réelle ligne 198), PAS product_id
--      (un index sur colonne inexistante ferait échouer TOUTE la migration).
--   4. webVitals.ts:189-267 POST vers /api/telemetry/web-vitals mais ni
--      l'endpoint worker ni la table de persistance n'existent (TODO
--      webVitals.ts:217-219,261). Cette migration crée la table cible.
--
-- Preuves d'existence des colonnes indexées (grep ligne-à-ligne, source réelle) :
--   - leads.client_id    : schema.sql:37  (`client_id TEXT NOT NULL REFERENCES clients(id)`)
--   - leads.status       : schema.sql:44  (`status TEXT CHECK (...) DEFAULT 'new'`)
--   - leads.created_at   : schema.sql:66  (`created_at TEXT DEFAULT (datetime('now'))`, bloc table leads 35-...)
--   - tasks.client_id    : migration-phase5.sql:43 (`client_id TEXT`)
--   - tasks.created_at   : migration-phase5.sql:46 (`created_at TEXT DEFAULT (datetime('now'))`)
--   - order_items.variant_id : migration-sprintE1-m1-ecommerce-schema.sql:198
--                              (`variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL`)
--   - order_items.product_id : ABSENTE — ligne RETIRÉE vs proposition Chaman.
--
-- Conventions strictes (alignées schema.sql / migration-sprintS7-m1.sql /
-- migration-sprintS8-m1.sql) :
--   id TEXT PK lower(hex(randomblob(16))), FK REFERENCES table(id),
--   timestamps TEXT DEFAULT (datetime('now')) — JAMAIS unixepoch.
--
-- Additif / non destructif STRICT : UNIQUEMENT CREATE INDEX IF NOT EXISTS /
-- CREATE TABLE IF NOT EXISTS. Aucun ALTER, aucun DROP, aucune réécriture
-- d'historique. Idempotent (rejouable sans effet de bord).
--
-- FK web_vitals.client_id → clients(id) : table bootstrap schema.sql (hors
--   tracker, db:init) — même cible que migration-sprintS7-m1.sql /
--   migration-sprintS8-m1.sql. NULL autorisé (beacon best-effort multi-tenant).
--
-- Exécution manuelle : npx wrangler d1 execute intralys-crm --file=migration-sprintS9-m1.sql --remote

-- ── 1. Index leads (handleGetClientLeads + reports.ts) ──────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_client_id   ON leads(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON leads(created_at);
-- Composites : couvrent `WHERE client_id=? ORDER BY created_at DESC` et
-- `WHERE client_id=? AND status=?` (hot paths handleGetClientLeads / reports).
CREATE INDEX IF NOT EXISTS idx_leads_client_created ON leads(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_client_status  ON leads(client_id, status);

-- ── 2. Index tasks (filtres tenant + tri chrono) ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_client_id  ON tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- ── 3. Index order_items (variant_id — product_id N'EXISTE PAS) ─────────────
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items(variant_id);

-- ── 4. Télémétrie Web Vitals (cible POST /api/telemetry/web-vitals) ─────────
CREATE TABLE IF NOT EXISTS web_vitals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  metric_name TEXT NOT NULL,
  value REAL NOT NULL,
  rating TEXT,
  url TEXT,
  session_id TEXT,
  client_id TEXT REFERENCES clients(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_web_vitals_created_at ON web_vitals(created_at);
CREATE INDEX IF NOT EXISTS idx_web_vitals_metric     ON web_vitals(metric_name);
