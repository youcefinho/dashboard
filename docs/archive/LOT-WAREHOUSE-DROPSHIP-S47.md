# LOT — Sprint 47 : Multi-warehouse + Dropshipping (stock par lieu + transferts + suppliers + auto-routing)

> Doc contrat §6 figé. Migration : seq142 — `migration-warehouse-dropship-seq142.sql`.
> Compagnons : `LOT-SUBSCRIPTIONS-ADV-S46.md` (Sprint 46 trials/proration/dunning/MRR), schéma e-commerce S(E1) seq58.

## Objectif

Étendre le pipeline e-commerce S(E1+) avec les **fonctionnalités multi-warehouse + dropshipping** attendues d'une plateforme de vente sérieuse, sans toucher aux handlers `ecommerce-*.ts` existants :

- **Multi-warehouse** — Stock physique réparti sur plusieurs lieux (entrepôts, stores, dépôts). Table `warehouses` (tenant-scoped, flag défaut/actif, contact). Colonne ADDITIVE `inventory.warehouse_id` (nullable) — la colonne `location` (seq58) reste pour rétro-compat lecture legacy.
- **Transferts inter-warehouse** — Table `inventory_transfers` (statut enum HANDLER : pending → in_transit → completed | cancelled). Helper `executeTransfer` applique le delta sur `inventory` (UPDATE source -qty / UPDATE destination +qty, UPSERT si ligne absente) + UPDATE transfer status='completed' + completed_at.
- **Dropshipping fournisseurs** — Tables `dropship_suppliers` (config + api_endpoint + api_key_encrypted HMAC + csv_format_json), `dropship_routings` (variant → supplier UNIQUE par variant×client + auto_route flag), `dropship_orders` (orders dispatchés au supplier + tracking_number, statut enum HANDLER : pending → sent → confirmed → shipped → delivered | failed).
- **CSV import catalog** — Helper `parseSupplierCsv` (pure, mapping configurable via supplier.csv_format_json) parse le catalogue brut supplier → liste normalisée `{sku, name, cost_cents, stock_qty}`. Endpoint `POST /api/dropship-suppliers/:id/import-csv` (body JSON `{csv: string}`).
- **Auto-routing order vers supplier** — Endpoint `POST /api/dropship-orders/route/:orderId` câble `warehouse-engine.routeOrderItems` : pour chaque item de l'order, lookup `dropship_routings.auto_route=1` ⇒ INSERT `dropship_orders` (status='pending'). Items sans routing ⇒ assignés au warehouse par défaut tenant (Phase B inventory routing).

Tant que `supplier.api_endpoint` est NULL ou vide → `notifySupplier` retourne `sent:false, reason:'no_endpoint'` (flag inactif). Activation tenant-by-tenant via UPDATE supplier (cap `settings.manage`).

## Distinction critique S(E1+) / S47

| Aspect | S(E1) (`seq58`) | S(E2-E9, S7-S9, LOT1, …) | Sprint 47 (`seq142`) |
|---|---|---|---|
| Périmètre | E-commerce core (products / variants / orders / order_items / inventory / customers / carts) | Extensions (catalog / payments / shipments / refunds / multi-currency / reviews / POS / loyalty / channels / ...) | Multi-warehouse + Dropshipping (stock par lieu + transferts + suppliers + auto-routing) |
| Tables ajoutées | products, product_variants, product_images, product_categories, inventory, inventory_movements, orders, order_items, customers, carts | (cf. manifest seq60→seq140) | warehouses, inventory_transfers, dropship_suppliers, dropship_routings, dropship_orders |
| Alter `inventory` | — | `seq60` (sprint E2 m2) | + `warehouse_id` (nullable) |
| Handlers worker | `ecommerce-*.ts` (Sprint E1+) | (cf. routes-table) | `warehouse-dropship.ts` (NEUF, séparé) |
| Helpers lib | — | `pos-engine`, `loyalty-engine`, `tax-engine-multi`, ... | `lib/warehouse-engine.ts` (NEUF, séparé) |
| Capabilities | `inventory.view` / `inventory.manage` (E1) | `settings.manage` / `clients.manage` | `clients.manage` (warehouses/transfers/routings/orders) + `settings.manage` (suppliers admin secrets) |
| Activation | Globale V1 | Tenant-by-tenant flags | supplier_api INACTIF par défaut (api_endpoint NULL ⇒ no-op) |

Le Sprint 47 **étend** sans toucher : aucun rollback nécessaire des sprints précédents. Les handlers `ecommerce-*.ts` restent **INTOUCHÉS** — toute la nouvelle logique vit dans `warehouse-dropship.ts` + `lib/warehouse-engine.ts`.

## Hors-scope

- **UI panels admin complets** (WarehouseListPanel, InventoryTransferModal, DropshipSupplierForm, DropshipOrderTimeline, CsvCatalogImporter) → Manager-C Phase B.
- **Webhooks tracking supplier** (supplier callback `/api/dropship-orders/:id/tracking` push) → Phase B (`tracking_number` UPDATE + webhook source supplier).
- **Réel appel `api.stripe-style` au supplier** (HTTP POST `api_endpoint` avec api_key déchiffrée TOKEN_KEY) → Phase B (Phase A retourne `mock-${orderRef}` si `is_active=1` et `api_endpoint` configuré, sinon `sent:false, reason:'no_endpoint'`).
- **Retry exponentiel sur dropship_orders failed** → Phase B (cron + max_attempts).
- **Routing intelligent multi-warehouse** (cheapest warehouse / closest warehouse / load-balanced) → backlog V2. V1 = warehouse par défaut tenant (1 seul actif `is_default=1`).
- **Routing splittable** (1 order, plusieurs warehouses pour items différents) → backlog V2. V1 = 1 supplier × order via dropship_orders.
- **CSV format avancé** (quotes, escapes, multi-line) → V1 simple CSV flat (split sur `,` + 1 ligne par item).
- **CRON Cloudflare scheduled** déclenchement automatique import-csv supplier (poll catalog quotidien) → infra setup `wrangler.jsonc` séparé (Manager-Ops, hors scope code S47).
- **Multi-tenancy CSV import** (upload massif inter-clients) → cap `settings.manage` borne par client_id supplier — pas de cross-tenant.
- **OACIQ / AMF / Loi 25** pour dropshipping QC → si supplier QC, vérif AMF/OACIQ Phase B (hors scope V1 — V1 = supplier US/EU/AS standard).

## §6 Contrats figés

### 6.1 Migration SQL

Fichier racine : `migration-warehouse-dropship-seq142.sql`. Manifest entrée seq142 (`docs/migrations-manifest.json`).

Pattern **100 % ADDITIF** :

- `CREATE TABLE IF NOT EXISTS warehouses` — lieu physique (`id`, `client_id` NOT NULL, `name` NOT NULL, `address`, `country`, `country_subdiv`, `is_active` DEFAULT 1, `is_default` DEFAULT 0, `contact_email`, `contact_phone`, `created_at`, `updated_at`).
- `CREATE TABLE IF NOT EXISTS inventory_transfers` — transfer (`id`, `client_id` NOT NULL, `from_warehouse_id` NOT NULL, `to_warehouse_id` NOT NULL, `variant_id` NOT NULL, `quantity` INTEGER NOT NULL, `status` DEFAULT 'pending', `notes`, `created_by_user_id`, `created_at`, `completed_at`).
- `CREATE TABLE IF NOT EXISTS dropship_suppliers` — supplier (`id`, `client_id` NOT NULL, `name` NOT NULL, `api_endpoint`, `api_key_encrypted`, `csv_format_json`, `contact_email`, `default_shipping_cost_cents` DEFAULT 0, `is_active` DEFAULT 1, `created_at`, `updated_at`).
- `CREATE TABLE IF NOT EXISTS dropship_routings` — routing (`id`, `client_id` NOT NULL, `variant_id` NOT NULL, `supplier_id` NOT NULL, `auto_route` DEFAULT 1, `supplier_sku`, `cost_cents` DEFAULT 0, `created_at`, `updated_at`).
- `CREATE TABLE IF NOT EXISTS dropship_orders` — order routé (`id`, `client_id`, `order_id`, `supplier_id`, `supplier_order_ref`, `status` DEFAULT 'pending', `tracking_number`, `created_at`, `updated_at`).
- `ALTER TABLE inventory ADD COLUMN warehouse_id TEXT` — colonne nullable ADDITIVE (jointure applicative HANDLER, pas FK).
- Index : `idx_warehouses_client (client_id, is_active)`, `idx_inventory_transfers_client_status (client_id, status, created_at)`, `idx_dropship_suppliers_client (client_id, is_active)`, `uniq_dropship_routings_variant UNIQUE (client_id, variant_id)`, `idx_dropship_orders_order (order_id)`, `idx_dropship_orders_supplier_status (supplier_id, status)`.

**Aucun CHECK** ajouté. Validation enum (`inventory_transfers.status`, `dropship_orders.status`) appartient au HANDLER (`warehouse-engine.ts` whitelists). Aucune FK (D1/SQLite — FK ⇒ rebuild interdit). Aucune colonne droppée. Migration `seq142` réversible logiquement (`DROP TABLE IF EXISTS`) — mais pas en prod si données présentes. Rejeu tolérant via `IF NOT EXISTS` + runner absorbe `duplicate column name`.

### 6.2 Routes API (15+)

Toutes AUTHED, gardes capability AU TOP de chaque handler. Câblées dans `src/worker.ts` après le bloc S46 (~ligne 3340) + AVANT S23, ordre anti-shadowing strict (suffixes `/:id/<action>` AVANT `/:id` générique).

| Route | Méthode | Cap | Handler |
|---|---|---|---|
| `/api/warehouses` | GET | `clients.manage` | `handleListWarehouses` |
| `/api/warehouses` | POST | `clients.manage` | `handleCreateWarehouse` |
| `/api/warehouses/:id` | PATCH | `clients.manage` | `handleUpdateWarehouse` |
| `/api/warehouses/:id` | DELETE | `clients.manage` | `handleDeleteWarehouse` |
| `/api/warehouses/:id/default` | POST | `clients.manage` | `handleSetDefaultWarehouse` |
| `/api/inventory-transfers` | GET | `clients.manage` | `handleListInventoryTransfers` |
| `/api/inventory-transfers` | POST | `clients.manage` | `handleCreateInventoryTransfer` |
| `/api/inventory-transfers/:id/complete` | POST | `clients.manage` | `handleCompleteInventoryTransfer` |
| `/api/dropship-suppliers` | GET | `settings.manage` | `handleListDropshipSuppliers` |
| `/api/dropship-suppliers` | POST | `settings.manage` | `handleCreateDropshipSupplier` |
| `/api/dropship-suppliers/:id` | PATCH | `settings.manage` | `handleUpdateDropshipSupplier` |
| `/api/dropship-suppliers/:id` | DELETE | `settings.manage` | `handleDeleteDropshipSupplier` |
| `/api/dropship-suppliers/:id/import-csv` | POST | `settings.manage` | `handleImportSupplierCatalogCsv` |
| `/api/dropship-routings` | GET | `clients.manage` | `handleListDropshipRoutings` |
| `/api/dropship-routings` | POST | `clients.manage` | `handleCreateDropshipRouting` |
| `/api/dropship-routings/:id` | PATCH | `clients.manage` | `handleUpdateDropshipRouting` |
| `/api/dropship-routings/:id` | DELETE | `clients.manage` | `handleDeleteDropshipRouting` |
| `/api/dropship-orders` | GET | `clients.manage` | `handleListDropshipOrders` |
| `/api/dropship-orders/route/:orderId` | POST | `clients.manage` | `handleRouteOrderToSupplier` |

### 6.3 Capabilities FIGÉES (AUCUN ajout ALL_CAPABILITIES seq80)

- `clients.manage` (admin/owner client) : warehouses CRUD + default, inventory_transfers CRUD + complete, dropship_routings CRUD, dropship_orders list + route. **Rationale** : ces ressources sont opérationnelles tenant — l'owner d'un compte gère son stock/transferts/routings sans intervention agence.
- `settings.manage` (admin agence) : dropship_suppliers CRUD + import-csv. **Rationale** : la config supplier inclut un secret `api_key_encrypted` (HMAC HANDLER) sensible. Surface admin agence pour éviter qu'un owner client fuite sa clé API supplier par accident.

### 6.4 Secrets api_key_encrypted via TOKEN_KEY HMAC

- POST/PATCH `/api/dropship-suppliers` accepte body `{ api_key: string }` en clair.
- HANDLER `createDropshipSupplier` / `updateDropshipSupplier` (Phase B) chiffre via `lib/crypto.ts` (HMAC SHA-256 avec `env.TOKEN_KEY` — calque `integration_secrets` seq75) avant INSERT/UPDATE DB.
- GET `/api/dropship-suppliers` retourne `api_key_set: '***' | null` (masqué). **JAMAIS** `api_key_encrypted` ni `api_key` en clair en GET — defense-in-depth IDOR + RCE.
- Phase B : `notifySupplier` déchiffre en mémoire RAM volatile au moment d'appeler `fetch(api_endpoint)`, jamais persisté en clair.

### 6.5 supplier_api flag INACTIF par défaut

- Si `dropship_suppliers.api_endpoint` est NULL ou chaîne vide ⇒ `notifySupplier` retourne `{sent: false, ref: null, reason: 'no_endpoint'}`. Endpoint inactif tant que pas configuré.
- Si `is_active = 0` ⇒ `notifySupplier` retourne `{sent: false, ref: null, reason: 'inactive'}`.
- Si `api_endpoint` configuré ET `is_active = 1` : Phase A retourne `{sent: true, ref: 'mock-${orderRef}'}` (mock smoke-test). Phase B câblera l'appel réseau réel.

### 6.6 Conventions

- imports RELATIFS uniquement (`./types`, `./capabilities`, `./helpers`, `./lib/warehouse-engine`)
- contrat réponses : `json({ data })` succès / `json({ error }, status)` erreur — **JAMAIS** de champ `code`
- bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR)
- garde capability au TOP de chaque handler
- pas de throw HANDLER — best-effort, dégradation gracieuse
- devise locked `'CAD'` V1
- i18n parité STRICTE 4 catalogues (`en`, `fr-CA`, `fr-FR`, `es`) — ~25 clés `warehouse.*` / `transfers.*` / `dropship.*`

### 6.7 i18n keys (~25, parité STRICTE 4 catalogues)

```
warehouse.title
warehouse.create
warehouse.empty
warehouse.default
warehouse.activate
transfers.title
transfers.create
transfers.complete
transfers.empty
transfers.from
transfers.to
dropship.suppliers.title
dropship.suppliers.create
dropship.suppliers.import_csv
dropship.suppliers.empty
dropship.routings.title
dropship.routings.create
dropship.routings.auto_route
dropship.routings.empty
dropship.orders.title
dropship.orders.route
dropship.orders.tracking
dropship.orders.empty
dropship.errors.no_supplier
```

### 6.8 Phase A SOLO (Manager-A) — Livrables

- ✅ Migration `migration-warehouse-dropship-seq142.sql` (5 tables + 1 alter + 6 index, 100% ADDITIF).
- ✅ Manifest entrée seq142 (`docs/migrations-manifest.json`).
- ✅ Types `src/lib/api.ts` (5 interfaces + 19 helpers AUTHED).
- ✅ Routes worker.ts (19 routes, insertion après bloc S46 ~ligne 3340).
- ✅ Stubs handlers `src/worker/warehouse-dropship.ts` (19 handlers — 17 stubs 501 + 4 list* fonctionnels safe-read + 1 fonctionnel `routeOrderToSupplier`).
- ✅ Stubs engine `src/worker/lib/warehouse-engine.ts` (4 helpers — `routeOrderItems` fonctionnel D1, `executeTransfer` fonctionnel D1, `parseSupplierCsv` pure fonctionnel, `notifySupplier` flag inactif).
- ✅ i18n keys × 4 catalogues (24 clés, parité STRICTE).
- ✅ Doc `docs/LOT-WAREHOUSE-DROPSHIP-S47.md` (§6 figé).

### 6.9 Phase B (Manager-B) — Suite

- Corps fonctionnel des 17 stubs 501 (CRUD complets warehouses / transfers / suppliers / routings).
- Chiffrement `api_key` via `lib/crypto.ts` HMAC TOKEN_KEY (calque integration_secrets seq75).
- Câblage réel `notifySupplier` (fetch api_endpoint avec api_key déchiffrée + retry exponentiel + tracking_number webhook).
- Helper `migrateInventoryLocationToWarehouseId` (best-effort one-shot script, lit `inventory.location` legacy ⇒ INSERT warehouses + UPDATE `inventory.warehouse_id`).
- Cron Cloudflare scheduled (poll CSV catalog quotidien + retry dropship_orders failed).
- UI panels admin (Manager-C — WarehouseListPanel, InventoryTransferModal, DropshipSupplierForm, DropshipOrderTimeline, CsvCatalogImporter).

### 6.10 Sécurité — résumé defense-in-depth

| Layer | Mécanisme |
|---|---|
| AuthZ | Gardes `requireCapability('clients.manage' | 'settings.manage')` AU TOP de chaque handler |
| Tenant isolation | `WHERE client_id = ?` partout + auth.clientId résolu choke-point worker.ts |
| Secrets | `api_key_encrypted` HMAC TOKEN_KEY (lib/crypto.ts), masqué `'***'` en GET |
| Anti-IDOR | Bornage WHERE client_id appliqué AVANT toute lecture/mutation (jamais just WHERE id =) |
| Anti-RCE CSV | `parseSupplierCsv` pure, pas d'eval, valide types `Number()` + bornage [0, ∞) cents/stock |
| Anti-XSS UI | Toutes valeurs retournées en clair échappées côté React (calque ecommerce-*.ts existant) |
| Anti-replay supplier | Phase B : nonce + timestamp signature dans payload `notifySupplier` (calque saas-billing-live) |

---

**Statut Phase A** : ✅ Livré 2026-05-25. Tests E2E + UI panels suivront en Phase B.
