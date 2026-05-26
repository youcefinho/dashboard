# LOT — Sprint 48 : B2B wholesale + Bundles + Pre-orders (customer groups + tier pricing + bundles + waitlist)

> Doc contrat §6 figé. Migration : seq143 — `migration-b2b-bundles-preorders-seq143.sql`.
> Compagnons : `LOT-WAREHOUSE-DROPSHIP-S47.md` (Sprint 47 stock multi-warehouse + dropshipping), schéma e-commerce S(E1) seq58.

## Objectif

Étendre le pipeline e-commerce S(E1+) avec les **fonctionnalités B2B wholesale + groupages + précommandes** attendues d'une plateforme de vente sérieuse, sans toucher aux handlers `ecommerce-*.ts` existants :

- **Customer groups + tier pricing** — Segmentation tarifaire customers (retail | wholesale | VIP | custom-named). Table `customer_groups` (tenant-scoped, slug, discount global, flag actif). Assignations via `customer_group_assignments` (UNIQUE par group×customer, expires_at NULL = permanent). Pricing surchargé par tier via `tier_prices` (variant × group × min_quantity, UNIQUE sur triplet). Résolution prix HANDLER `pricing-engine.resolveTierPrice()` applique le meilleur tier (min_quantity ≤ cart_qty), fallback `product_variants.price` legacy si aucun match.
- **Product bundles** — Groupage produits avec discount calculé vs sum items individuels. Tables `product_bundles` (id, name, prix total, discount_pct cache UI) + `bundle_items` (n variants × quantity). Helper `pricing-engine.computeBundleDiscount()` PURE — pas d'I/O. Phase B : auto-add bundle items au cart lors du POST checkout.
- **Pre-orders / waitlist queue** — File d'attente acheteurs sur variants en rupture ou pas encore lancés. Table `preorder_queue` (variant_id + customer_id + email + status enum HANDLER queued|notified|converted|cancelled). Endpoint **PUBLIC** `POST /api/public/preorders` permet le join visiteur (email seul requis), rate-limit + honeypot HANDLER. `processPreorderNotification()` envoie email best-effort quand variant restocké (Phase A : log + email_sent:false ; Phase B câblera Resend/sendgrid).

L'endpoint PUBLIC est verrouillé par rate-limit `preorder_join:<ip>` 5/300s (calque `/api/public/tickets`) + honeypot champ `website` (anti-fingerprint : si rempli ⇒ 200 silencieux avec id='bot'). Email validation regex basique HANDLER. PII Loi 25 : email fourni explicitement par visiteur, pas de cookie tiers collecté.

## Distinction critique S(E1+) / S47 / S48

| Aspect | S(E1) (`seq58`) | S47 (`seq142`) | Sprint 48 (`seq143`) |
|---|---|---|---|
| Périmètre | E-commerce core | Multi-warehouse + Dropshipping | B2B groups + tier pricing + bundles + pre-orders |
| Tables ajoutées | products, product_variants, … | warehouses, inventory_transfers, dropship_suppliers, dropship_routings, dropship_orders | customer_groups, customer_group_assignments, tier_prices, product_bundles, bundle_items, preorder_queue |
| Alter `inventory` | — | + `warehouse_id` (nullable) | — |
| Handlers worker | `ecommerce-*.ts` (Sprint E1+) | `warehouse-dropship.ts` (NEUF) | `b2b-bundles-preorders.ts` (NEUF, séparé) |
| Helpers lib | — | `lib/warehouse-engine.ts` | `lib/pricing-engine.ts` (NEUF, séparé) |
| Capabilities | `inventory.view` / `inventory.manage` | `clients.manage` + `settings.manage` | `clients.manage` (toutes ressources) + PUBLIC preorder join |
| Activation | Globale V1 | supplier_api INACTIF par défaut | groups + tiers + bundles activables tenant ; preorder PUBLIC activé par défaut |

Le Sprint 48 **étend** sans toucher : aucun rollback nécessaire des sprints précédents. Les handlers `ecommerce-*.ts` ET `warehouse-dropship.ts` restent **INTOUCHÉS** — toute la nouvelle logique vit dans `b2b-bundles-preorders.ts` + `lib/pricing-engine.ts`.

## Hors-scope

- **UI panels admin complets** (CustomerGroupsManager, TierPricingTable, BundleEditor, PreorderWaitlistDashboard) → Manager-C Phase B.
- **Auto-add bundle items au cart** (POST /api/cart avec `bundle_id` ⇒ INSERT N order_items selon bundle_items) → Phase B (intégration cart S(E1)).
- **Cron Cloudflare** `processPreorderNotification` automatique au restock variant → infra setup `wrangler.jsonc` séparé (Manager-Ops).
- **Email réel** (Resend/sendgrid avec template HTML + Loi 25 unsubscribe) → Phase B. Phase A : log + email_sent:false.
- **Customer self-service portal** (visiteur consulte ses preorders) → backlog V2.
- **Bulk import CSV customer_groups** (admin upload massif) → backlog V2.
- **Volume discount auto-add** (cart qty ≥ X ⇒ surclasse customer dans group temporaire) → backlog V2.
- **Tier pricing par devise** (multi-currency S39 cross-prix) → V1 = CAD locked.
- **Bundle pricing dynamique** (recalcul si stock partiel) → V1 = `total_price_cents` figé au POST bundle.

## §6 Contrats figés

### 6.1 Migration SQL

Fichier racine : `migration-b2b-bundles-preorders-seq143.sql`. Manifest entrée seq143 (`docs/migrations-manifest.json`).

Pattern **100 % ADDITIF** :

- `CREATE TABLE IF NOT EXISTS customer_groups` — (`id`, `client_id` NOT NULL, `name` NOT NULL, `slug`, `description`, `default_discount_pct` REAL DEFAULT 0, `is_active` DEFAULT 1, `created_at`, `updated_at`).
- `CREATE TABLE IF NOT EXISTS customer_group_assignments` — (`id`, `group_id` NOT NULL, `customer_id` NOT NULL, `client_id` NOT NULL denorm, `assigned_at`, `expires_at` NULL).
- `CREATE TABLE IF NOT EXISTS tier_prices` — (`id`, `product_variant_id` NOT NULL, `group_id` NOT NULL, `client_id` NOT NULL, `price_cents` INTEGER NOT NULL, `min_quantity` INTEGER DEFAULT 1, `created_at`, `updated_at`).
- `CREATE TABLE IF NOT EXISTS product_bundles` — (`id`, `client_id` NOT NULL, `name` NOT NULL, `description`, `total_price_cents` INTEGER, `discount_pct` REAL DEFAULT 0, `is_active` DEFAULT 1, `created_at`, `updated_at`).
- `CREATE TABLE IF NOT EXISTS bundle_items` — (`id`, `bundle_id` NOT NULL, `product_variant_id` NOT NULL, `quantity` INTEGER DEFAULT 1, `created_at`).
- `CREATE TABLE IF NOT EXISTS preorder_queue` — (`id`, `variant_id` NOT NULL, `customer_id` NOT NULL, `client_id` NOT NULL denorm, `quantity` INTEGER DEFAULT 1, `email` TEXT, `status` DEFAULT 'queued', `notified_at` NULL, `converted_order_id` NULL, `created_at`).
- Index : `idx_customer_groups_client (client_id, is_active)`, `uniq_customer_group_assignments UNIQUE (group_id, customer_id)`, `uniq_tier_prices_variant_group_qty UNIQUE (product_variant_id, group_id, min_quantity)`, `idx_product_bundles_client (client_id, is_active)`, `idx_bundle_items_bundle (bundle_id)`, `idx_preorder_queue_variant_status (variant_id, status)`, `idx_preorder_queue_customer (customer_id, status)`.

**Aucun CHECK** ajouté. Validation enum (`preorder_queue.status`) appartient au HANDLER (`pricing-engine.ts` whitelists). Aucune FK (D1/SQLite — FK ⇒ rebuild interdit). Aucune colonne droppée, aucun ALTER. Migration `seq143` réversible logiquement (`DROP TABLE IF EXISTS`) — mais pas en prod si données présentes. Rejeu tolérant via `IF NOT EXISTS`.

### 6.2 Routes API (22 AUTHED + 1 PUBLIC)

Toutes AUTHED gardes capability AU TOP de chaque handler. Câblées dans `src/worker.ts` après le bloc S47 (~ligne 3450) + AVANT S23, ordre anti-shadowing strict (suffixes `/:id/<action>` AVANT `/:id` générique). Route PUBLIC `/api/public/preorders` POST câblée AVANT le chokepoint `requireAuth` (~ligne 776, après gift-cards balance).

| Route | Méthode | Cap | Handler |
|---|---|---|---|
| `/api/public/preorders` | POST | **PUBLIC** | `handlePublicCreatePreorder` |
| `/api/customer-groups` | GET | `clients.manage` | `handleListCustomerGroups` |
| `/api/customer-groups` | POST | `clients.manage` | `handleCreateCustomerGroup` |
| `/api/customer-groups/:id` | PATCH | `clients.manage` | `handleUpdateCustomerGroup` |
| `/api/customer-groups/:id` | DELETE | `clients.manage` | `handleDeleteCustomerGroup` |
| `/api/customer-groups/:id/assign` | POST | `clients.manage` | `handleAssignCustomerToGroup` |
| `/api/customer-groups/:id/remove` | POST | `clients.manage` | `handleRemoveCustomerFromGroup` |
| `/api/customers/:id/groups` | GET | `clients.manage` | `handleGetCustomerGroups` |
| `/api/tier-prices` | GET | `clients.manage` | `handleListTierPrices` |
| `/api/tier-prices` | POST | `clients.manage` | `handleCreateTierPrice` |
| `/api/tier-prices/:id` | PATCH | `clients.manage` | `handleUpdateTierPrice` |
| `/api/tier-prices/:id` | DELETE | `clients.manage` | `handleDeleteTierPrice` |
| `/api/tier-prices/resolve` | GET | `clients.manage` | `handleResolveTierPrice` |
| `/api/product-bundles` | GET | `clients.manage` | `handleListProductBundles` |
| `/api/product-bundles` | POST | `clients.manage` | `handleCreateBundle` |
| `/api/product-bundles/:id` | GET | `clients.manage` | `handleGetBundle` |
| `/api/product-bundles/:id` | PATCH | `clients.manage` | `handleUpdateBundle` |
| `/api/product-bundles/:id` | DELETE | `clients.manage` | `handleDeleteBundle` |
| `/api/product-bundles/:id/items` | GET | `clients.manage` | `handleListBundleItems` |
| `/api/product-bundles/:id/items` | POST | `clients.manage` | `handleAddBundleItem` |
| `/api/bundle-items/:id` | DELETE | `clients.manage` | `handleRemoveBundleItem` |
| `/api/preorders` | GET | `clients.manage` | `handleListPreorders` |
| `/api/preorders/:id/notify` | POST | `clients.manage` | `handleNotifyPreorder` |
| `/api/preorders/:id/cancel` | POST | `clients.manage` | `handleCancelPreorder` |
| `/api/preorders/:id/convert` | POST | `clients.manage` | `handleConvertPreorder` |

### 6.3 Capabilities FIGÉES (AUCUN ajout ALL_CAPABILITIES seq80)

- `clients.manage` (admin/owner client) : customer_groups CRUD + assign/remove + getCustomerGroups, tier_prices CRUD + resolve, product_bundles CRUD + items, preorders list + notify + cancel + convert. **Rationale** : ces ressources sont opérationnelles tenant — l'owner d'un compte gère ses segments/tarifs/bundles/preorders sans intervention agence.
- **PUBLIC** (pré-requireAuth) : `POST /api/public/preorders` — visiteur join waitlist. Rate-limit `preorder_join:<ip>` 5/300s + honeypot champ `website` (calque `/api/public/tickets`).

### 6.4 PUBLIC preorder join — rate-limit + honeypot

- Rate-limit bucket `preorder_join:<cf-connecting-ip>` max 5 hits / 300 secondes (sliding window via `lib/rate-limit.checkRateLimit` calque `/api/public/tickets`). Dépassement ⇒ 429 + retry_after_seconds.
- Honeypot : body inclut champ optionnel `website` (chaîne vide attendue). Si rempli ⇒ bot, HANDLER retourne 200 silencieux `{ data: { id: 'bot', status: 'cancelled' } }` (anti-fingerprint : ne révèle pas le piège).
- Email validation HANDLER : regex basique `.includes('@')` + length ≤ 200. PII Loi 25 : email stocké en clair V1 (fourni par visiteur, pas de cookie tiers collecté). Phase B : chiffrement TOKEN_KEY si besoin d'export Loi 25.
- Résolution `client_id` HANDLER : `SELECT p.client_id FROM product_variants v INNER JOIN products p ON p.id = v.product_id WHERE v.id = ?`. Si variant introuvable ⇒ 404 (bornage tenant defense-in-depth).
- Insertion `preorder_queue` status='queued', customer_id = '' (vide V1 — Phase B linkera customer_id quand visiteur s'inscrit).

### 6.5 Conventions

- imports RELATIFS uniquement (`./types`, `./capabilities`, `./helpers`, `./lib/pricing-engine`, `./lib/rate-limit`)
- contrat réponses : `json({ data })` succès / `json({ error }, status)` erreur — **JAMAIS** de champ `code`
- bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR)
- garde capability au TOP de chaque handler AUTHED
- pas de throw HANDLER — best-effort, dégradation gracieuse
- devise locked `'CAD'` V1
- i18n parité STRICTE 4 catalogues (`en`, `fr-CA`, `fr-FR`, `es`) — 26 clés

### 6.6 i18n keys (26, parité STRICTE 4 catalogues)

```
customer_groups.title
customer_groups.create
customer_groups.empty
customer_groups.assign
customer_groups.discount_pct
tier_prices.title
tier_prices.create
tier_prices.empty
tier_prices.min_quantity
tier_prices.price
bundles.title
bundles.create
bundles.empty
bundles.total_price
bundles.discount
bundles.items
bundles.add_item
preorders.title
preorders.create
preorders.empty
preorders.notify
preorders.cancel
preorders.convert
preorders.status.queued
preorders.status.notified
preorders.status.converted
```

### 6.7 Phase A SOLO (Manager-A) — Livrables

- Migration `migration-b2b-bundles-preorders-seq143.sql` (6 tables + 7 index, 100% ADDITIF).
- Manifest entrée seq143 (`docs/migrations-manifest.json`).
- Types `src/lib/api.ts` (6 interfaces + 1 résolution + ~25 helpers AUTHED + 1 public).
- Routes worker.ts (22 AUTHED + 1 PUBLIC, insertion après bloc S47 ~ligne 3450 + PUBLIC ~ligne 776).
- Stubs handlers `src/worker/b2b-bundles-preorders.ts` (22 AUTHED + 1 PUBLIC — 18 stubs 501, 5 list/getter fonctionnels safe-read, 2 fonctionnels engine câblé `handleResolveTierPrice` + `handleNotifyPreorder`, 1 fonctionnel public `handlePublicCreatePreorder` rate-limit + honeypot).
- Stubs engine `src/worker/lib/pricing-engine.ts` (3 helpers — `resolveTierPrice` fonctionnel D1, `computeBundleDiscount` pure fonctionnel, `processPreorderNotification` fonctionnel D1 sans email réel).
- i18n keys × 4 catalogues (26 clés, parité STRICTE).
- Doc `docs/LOT-B2B-BUNDLES-PREORDERS-S48.md` (§6 figé).

### 6.8 Phase B (Manager-B) — Suite

- Corps fonctionnel des 18 stubs 501 (CRUD complets customer_groups / assign / tier_prices / bundles / bundle_items / preorders cancel + convert).
- Câblage Resend / sendgrid pour `processPreorderNotification` (template HTML + Loi 25 unsubscribe + ARK preorder ID dans URL pour tracking ouverture).
- Auto-add bundle items au cart (intégration cart S(E1) — POST `/api/cart` avec `bundle_id` ⇒ INSERT N order_items selon bundle_items + price = `total_price_cents` répartis proportionnellement).
- Cron Cloudflare scheduled `processPreorderNotification` automatique au restock variant (poll `inventory.quantity` crossing 0 → > 0).
- Conversion `preorderToOrder` (créer order draft minimal + UPDATE preorder_queue status='converted' + converted_order_id).
- Customer self-service portal "Mes pre-orders" (lookup par email + magic link signé HMAC).
- UI panels admin (Manager-C — CustomerGroupsManager, TierPricingTable, BundleEditor, PreorderWaitlistDashboard).

### 6.9 Sécurité — résumé defense-in-depth

| Layer | Mécanisme |
|---|---|
| AuthZ AUTHED | Gardes `requireCapability('clients.manage')` AU TOP de chaque handler authed |
| AuthZ PUBLIC | Aucun auth — rate-limit `preorder_join:<ip>` 5/300s + honeypot `website` |
| Tenant isolation | `WHERE client_id = ?` partout + auth.clientId résolu choke-point worker.ts |
| Tenant isolation PUBLIC | client_id résolu via lookup `product_variants → products.client_id` HANDLER |
| Anti-IDOR | Bornage WHERE client_id appliqué AVANT toute lecture/mutation (jamais juste WHERE id =) |
| Anti-bot PUBLIC | Honeypot champ `website` — réponse 200 silencieuse si rempli (anti-fingerprint) |
| Anti-XSS UI | Toutes valeurs retournées en clair échappées côté React (calque ecommerce-*.ts existant) |
| PII Loi 25 | Email visiteur stocké en clair V1 (consent explicite via action utilisateur). Phase B : chiffrement TOKEN_KEY si export Loi 25 demandé |

---

**Statut Phase A** : Livré 2026-05-25. Tests E2E + UI panels suivront en Phase B.
