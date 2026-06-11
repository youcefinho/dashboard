-- ════════════════════════════════════════════════════════════════════════════
-- Migration seq 82 — LOT FACTURATION-RÉELLE (2026-05-19)
-- Cycle complet facture conforme QC + objet devis/soumission.
--
-- depends_on : migration-team-lotC-seq81.sql (seq 81 — dernière migration du
--              manifest avant ce lot ; chaînage séquentiel, aucune dépendance
--              de SCHÉMA réelle sur seq 81, mais on chaîne pour l'ordre).
--
-- ⚠ STRICTEMENT ADDITIF — INTERDIT : tout DROP / RENAME / rebuild.
--   `invoices` (créée seq 18, migration_p3_8.sql) NE reçoit QUE des ALTER ADD
--   COLUMN nullable / DEFAULT NULL ⇒ rétro-compat BYTE-IDENTIQUE des lignes
--   existantes (une facture legacy n'a que `amount` ; le code lit
--   `total ?? amount` en fallback — voir docs/LOT-INVOICE.md §6.C/§6.I).
--   AUCUNE FK (D1/SQLite : FK ⇒ rebuild au moindre ALTER ⇒ interdit ;
--   les jointures invoice↔items / quote↔items / quote↔invoice sont
--   APPLICATIVES, par `invoice_id`/`quote_id` en colonne TEXT).
--   AUCUN touch `users` / CHECK role seq 59. AUCUN touch tables E4/E6
--   régulées (`payments`, `payment_events`, `payment_provider_config`,
--   `refunds`, `disputes`, `return_requests`). AUCUNE activation paiement.
--
-- TOLÉRANCE « duplicate column name » — exécution best-effort :
--   si seq 82 est rejouée (ou ces colonnes pré-existent), les `ALTER TABLE
--   invoices ADD COLUMN` échouent « duplicate column name: <col> » :
--   ATTENDU et NON FATAL. L'exécuteur (Antigravity) joue ce fichier
--   statement-par-statement : erreur « duplicate column name » sur un ALTER
--   ⇒ log + CONTINUE au statement suivant. `CREATE TABLE/INDEX IF NOT EXISTS`
--   sont idempotents. scripts/migrate.ts est FIGÉ et N'EST PAS modifié ;
--   la tolérance duplicate-column est une consigne d'exécution, pas du code.
--
-- Conventions schema.sql : id TEXT PK lower(hex(randomblob(16))),
--   timestamps TEXT DEFAULT (datetime('now')). PAS d'unixepoch, PAS
--   d'INTEGER autoincrement, PAS de FK.
-- Exécution manuelle :
--   npx wrangler d1 execute intralys-crm --file=migration-invoice-real-seq82.sql --remote
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Enrichissement `invoices` — colonnes additives (toutes nullable /
--    DEFAULT NULL ⇒ lignes existantes inchangées byte-à-byte). Le calcul
--    des taxes est SERVEUR (docs/LOT-INVOICE.md §6.C) ; ces colonnes
--    STOCKENT le résultat figé au moment de l'émission (snapshot comptable
--    immuable — l'ARQ exige TPS 5 % et TVQ 9,975 % ventilées séparément +
--    n° d'inscription présents sur la pièce).
ALTER TABLE invoices ADD COLUMN invoice_number TEXT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN subtotal REAL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN tax_tps REAL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN tax_tvq REAL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN total REAL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN due_date TEXT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN quote_id TEXT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN tps_number TEXT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN tvq_number TEXT DEFAULT NULL;

-- 2) Lignes de facture (articles). Jointure APPLICATIVE par invoice_id
--    (PAS de FK). line_total = round(qty * unit_price, 2) calculé SERVEUR
--    et stocké (snapshot). subtotal facture = round(Σ line_total, 2).
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  invoice_id TEXT NOT NULL,
  label TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- 3) Devis / soumission. Objet de premier ordre, cycle
--    draft → sent → accepted/declined/expired. Sur acceptation : génère une
--    facture liée (invoices.quote_id renseigné), quotes.invoice_id pointe la
--    facture créée (jointure applicative bidirectionnelle, PAS de FK).
--    agency_id : bornage tenant (pattern team.ts handleGetUsers — voir §6.D).
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,
  lead_id TEXT,
  agency_id TEXT,
  quote_number TEXT,
  subtotal REAL,
  tax_tps REAL,
  tax_tvq REAL,
  total REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','expired')),
  valid_until TEXT,
  accepted_at TEXT,
  invoice_id TEXT,
  tps_number TEXT,
  tvq_number TEXT,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_agency ON quotes(agency_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_lead ON quotes(lead_id);

-- 4) Lignes de devis (même forme que invoice_items, jointure applicative
--    par quote_id, PAS de FK).
CREATE TABLE IF NOT EXISTS quote_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  quote_id TEXT NOT NULL,
  label TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

-- NB : `description` ajouté à `quotes` (symétrie avec invoices.description
-- existante, migration_p3_8.sql:11). AUCUNE colonne ajoutée à `users`/
-- `clients`/tables régulées. tps_number/tvq_number vivent SUR la pièce
-- (invoices/quotes) — snapshot du n° d'inscription valide à l'émission —
-- car `clients` n'a AUCUNE colonne tps_number/tvq_number (audit migrations
-- 1→81 + schema.sql : seul `clients.tax_regime DEFAULT 'qc'` seq 72 existe,
-- pas de n° d'inscription stocké). Choix figé docs/LOT-INVOICE.md §6.C.
