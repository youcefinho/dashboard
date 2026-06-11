# LOT POS retail caisse — Sprint 37

> Doc contrat §6 figé. Migration : seq132 — `migration-pos-seq132.sql`.
> Compagnons : `ESC-POS-PRINTER-S37.md` (codeset thermique 80mm + flow Phase B C4),
> `LOT-TEAM-BC.md` (capabilities figées seq80 — réutilisation `clients.manage` + `reports.view`),
> `LOT-CHAT-WIDGET-S36.md` (calque pattern handler + i18n + manifest).

## §1 Contexte

L'e-commerce B2 **EXISTE DÉJÀ très mature** (Sprint E1-ER, seq58-71). Composants
en place :

- `src/worker/ecommerce-orders.ts` — `createOrderCore()` + `commitOrderSale()`
  CONTRATS FIGÉS (line items + snapshots + TPS/TVQ verbatim + machine d'états).
- `src/worker/ecommerce-tax-engine.ts` — `computeTax()` régime `'qc'` VERBATIM
  (TPS 5% + TVQ 9.975% séparés, régression-zéro Québec bit-pour-bit).
- `src/worker/ecommerce-inventory.ts` — `reserveStock` / `releaseStock` /
  `commitSale` idempotents avec `inventory_movements (reason='sale')`.
- `src/worker/ecommerce-payments.ts` — passerelles paiement (Stripe E4 = flag
  inactif, mock côté handler).
- `product_variants.barcode` — colonne EXISTANTE (E1 seq58), pas de migration
  schema requise pour le scan.

**Sprint 37 = ENRICHISSEMENT couche caisse retail, PAS reconstruction**. On
**NE TOUCHE PAS** à `ecommerce-orders.ts`, `ecommerce-tax-engine.ts`,
`ecommerce-payments.ts`, `ecommerce-inventory.ts`. On ajoute le **SOCLE** :

1. Caisses physiques par tenant (`pos_registers` : devise, régime fiscal défaut,
   config imprimante thermique, multi-emplacements).
2. Shifts caissier (`pos_sessions` : fond de caisse ouverture/fermeture,
   variance, agrégats temps réel total_sales/total_tax/tx_count, statut
   open|closed|reconciled).
3. Transactions caisse (`pos_transactions` : pont vers `orders.id` quand vente,
   payment_method enum cash|card_terminal|gift_card|other|split, change_due,
   void avec restitution stock).
4. Rattachement commande → POS (`orders.pos_session_id` + `orders.pos_register_id`,
   NULL = commande web standard).
5. UI caisse (Phase C frontend) : scan code-barres (caméra + saisie manuelle),
   panier live, modal paiement (cash + carte + split), reçu (HTML email +
   ESC/POS thermique + PDF R2), X/Z report (rapport quotidien/clôture shift).

**Régression-zéro QC garantie** : `pos-transactions:create` (Phase B Manager-B)
APPELLE `createOrderCore` + `commitOrderSale` en interne. Aucune duplication
de formule fiscale. Aucune écriture stock hors `inventory_movements`.

## §2 Migrations — seq132 (DDL résumé)

Fichier racine : `migration-pos-seq132.sql`. Manifest entrée seq132
(`docs/migrations-manifest.json`), `depends_on:
["migration-webchat-widget-s36-seq131.sql", "migration-sprintE1-m1-ecommerce-schema.sql"]`
(chaînage strict sur la dernière migration + table-source ecommerce E1).

100 % ADDITIF, zéro CHECK / FK destructrice / DROP / RENAME :

- `CREATE TABLE IF NOT EXISTS pos_registers` : id PK, client_id FK clients,
  name, location, currency (DEFAULT `'CAD'`), is_active (DEFAULT 1),
  default_tax_region (enum HANDLER `qc|eu|dz|exempt`, DEFAULT `'qc'`),
  printer_config_json (DEFAULT `'{}'`), created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS pos_sessions` : id PK, register_id FK
  pos_registers, client_id FK clients, opened_by / opened_at / closed_by /
  closed_at (user_id audit), opening_cash_cents (DEFAULT 0), closing_cash_cents,
  expected_cash_cents, variance_cents, status (enum HANDLER `open|closed|reconciled`,
  DEFAULT `'open'`), total_sales_cents / total_tax_cents / transaction_count
  (agrégats temps réel), notes, created_at.
- `CREATE TABLE IF NOT EXISTS pos_transactions` : id PK, session_id FK
  pos_sessions, client_id FK clients, order_id FK orders (NULL si non-order),
  payment_method (enum HANDLER `cash|card_terminal|gift_card|other|split`),
  amount_cents, tendered_cents, change_due_cents (DEFAULT 0),
  card_terminal_ref, receipt_url (R2 key), voided_at / voided_by / void_reason,
  cashier_id, created_at.
- 2 `ALTER TABLE orders ADD COLUMN` : `pos_session_id`, `pos_register_id`
  (NULL = commande web — rétro-compat totale).
- 7 indexes : `idx_pos_registers_client` (client+active),
  `idx_pos_sessions_register` (register+status), `idx_pos_sessions_client`
  (client+opened_at chrono), `idx_pos_transactions_session` (session+chrono),
  `idx_pos_transactions_order` (jointure inverse order→tx),
  `idx_pos_transactions_client` (client+chrono export),
  `idx_product_variants_barcode` (scan code-barres O(log n)).

Validation enums (`status`, `payment_method`, `default_tax_region`) faite
SIDE-HANDLER (`pos-sessions.ts` / `pos-transactions.ts` / `pos-registers.ts`)
— calque LOT-CHAT-WIDGET-S36 §6 (pas de CHECK = pas de rebuild SQLite jamais).

## §3 Routes (10 AUTHED, gated `ecommerce` module)

Toutes câblées dans `src/worker.ts` à l'intérieur du bloc `routeProtected`,
APRÈS le bloc chat-widgets/chat-presence Sprint 36 (~l.2780), AVANT le bloc
Sprint 23 sécurité/conformité (~l.2785). Gating **`requireModule(env, auth.userId, 'ecommerce')`**
au top du bloc (403 JSON FR-QC si module absent — helper M2). Multi-tenant
strict + capability appliquée DANS chaque handler.

**ORDRE ANTI-SHADOWING strict** dans `src/worker.ts` :

1. `/api/pos/registers` GET + POST (collection)
2. `/api/pos/registers/:id` PATCH (générique `:id`)
3. `/api/pos/sessions/open` POST (statique — AVANT régex `:id`)
4. `/api/pos/sessions/:id/close` POST (suffix)
5. `/api/pos/sessions/:id/report` GET (suffix)
6. `/api/pos/sessions/:id` GET (générique `:id` — APRÈS suffixes)
7. `/api/pos/products/scan/:barcode` GET (préfixe distinct)
8. `/api/pos/transactions/:id/void` POST (suffix)
9. `/api/pos/transactions` POST (collection)

| Méthode | Chemin                                       | Handler                          | Capability       | Fichier              |
|--------:|----------------------------------------------|----------------------------------|------------------|----------------------|
| GET     | `/api/pos/registers`                         | `handleListRegisters`            | `clients.manage` | pos-registers.ts     |
| POST    | `/api/pos/registers`                         | `handleCreateRegister`           | `clients.manage` | pos-registers.ts     |
| PATCH   | `/api/pos/registers/:id`                     | `handleUpdateRegister`           | `clients.manage` | pos-registers.ts     |
| POST    | `/api/pos/sessions/open`                     | `handleOpenSession`              | `clients.manage` | pos-sessions.ts      |
| POST    | `/api/pos/sessions/:id/close`                | `handleCloseSession`             | `clients.manage` | pos-sessions.ts      |
| GET     | `/api/pos/sessions/:id/report`               | `handleSessionReport`            | `reports.view`   | pos-sessions.ts      |
| GET     | `/api/pos/sessions/:id`                      | `handleGetSession`               | `clients.manage` | pos-sessions.ts      |
| GET     | `/api/pos/products/scan/:barcode`            | `handleScanBarcode`              | `clients.manage` | pos-transactions.ts  |
| POST    | `/api/pos/transactions`                      | `handleCreatePosTransaction`     | `clients.manage` | pos-transactions.ts  |
| POST    | `/api/pos/transactions/:id/void`             | `handleVoidPosTransaction`       | `clients.manage` | pos-transactions.ts  |

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ `code` —
contrat GELÉ docs/LOT-TEAM-BC.md §6.A). Statut HTTP transporté par le 2e arg
de `json()`. Phase A renvoie `501` partout (`Phase B not yet implemented`)
pour câbler la matrice routes/handlers sans casser le worker — calque chat-
widgets Phase A.

## §4 Handlers (signatures FIGÉES Phase A — Phase B Manager-B remplit)

### `src/worker/pos-registers.ts` (3 handlers AUTHED)

```ts
handleListRegisters(env, auth) → ApiResponse<PosRegister[]>
handleCreateRegister(request, env, auth) → ApiResponse<PosRegister>
handleUpdateRegister(request, env, auth, id) → ApiResponse<PosRegister>
```

### `src/worker/pos-sessions.ts` (4 handlers AUTHED)

```ts
handleOpenSession(request, env, auth) → ApiResponse<PosSession>
handleCloseSession(request, env, auth, id) → ApiResponse<PosSession>
handleGetSession(env, auth, id) → ApiResponse<PosSession>
handleSessionReport(env, auth, id, url) → ApiResponse<PosSessionReport>
```

### `src/worker/pos-transactions.ts` (3 handlers AUTHED)

```ts
handleScanBarcode(env, auth, barcode) → ApiResponse<ScanResult>
handleCreatePosTransaction(request, env, auth) → ApiResponse<PosTransaction>
handleVoidPosTransaction(request, env, auth, id) → ApiResponse<PosTransaction>
```

### `src/worker/lib/pos-engine.ts` (6 helpers purs — STUBS Phase A)

```ts
computeChange(totalCents, tenderedCents): { changeCents, error? }
computeSessionVariance(expectedCents, actualCents): { varianceCents, warningLevel: 'ok'|'low'|'high' }
roundCashTender(amountCents, region: 'qc'): number    // arrondi 5¢ CAD
validatePaymentSplit(totalCents, splits): { valid, error? }
buildOrderPayloadFromCart(items, region): { items[], tax_region }
chargeCardTerminal(env, amountCents, sessionId): Promise<...>  // flag-inactif E4
```

### `src/worker/lib/pos-receipt.ts` (4 helpers reçu — STUBS Phase A)

```ts
buildReceiptHtml(payload, locale): string
buildEscPosBytes(payload): Uint8Array
buildReceiptPdfStub(payload, locale): Promise<Uint8Array>
uploadReceiptToR2(env, clientId, transactionId, pdfBytes): Promise<{ r2Key }>
```

## §5 Types `src/lib/api.ts` (FIGÉS Phase A)

- `interface PosRegister` (10 champs : id, client_id, name, location, currency,
  is_active, default_tax_region, printer_config_json, created_at, updated_at).
- `interface PosSession` (15 champs : id, register_id, client_id, opened_by,
  opened_at, closed_at, opening_cash_cents, closing_cash_cents,
  expected_cash_cents, variance_cents, status, total_sales_cents,
  total_tax_cents, transaction_count, notes).
- `interface PosTransaction` (13 champs : id, session_id, order_id,
  payment_method, amount_cents, tendered_cents, change_due_cents,
  card_terminal_ref, receipt_url, voided_at, void_reason, cashier_id,
  created_at).
- `interface ScanResult` (variant + product + in_stock + unit_price_cents).
- `interface ReceiptPayload` (tenantName, transactionId, orderNumber, placedAt,
  items[], subtotalCents, taxLines[], totalCents, paymentMethod,
  tenderedCents?, changeCents?, cashierName, registerName).
- Enums : `PosSessionStatus` ('open'|'closed'|'reconciled'),
  `PosPaymentMethod` ('cash'|'card_terminal'|'gift_card'|'other'|'split').
- 10 helpers async (1 par route) : `listPosRegisters`, `createPosRegister`,
  `updatePosRegister`, `openPosSession`, `closePosSession`, `getPosSession`,
  `getPosSessionReport`, `scanBarcode`, `createPosTransaction`,
  `voidPosTransaction`.

## §6 Contrat inter-agent FIGÉ — Phase B B/C ne peuvent PAS modifier

1. **Migrations** : seq132 verrou. Aucun champ supplémentaire en Phase B sans
   nouvelle seq (133+). Aucun CHECK ajouté (rebuild SQLite interdit).
2. **Routes** : 10 chemins/méthodes AUTHED figés (§3). Aucun renommage.
   L'ordre anti-shadowing dans `worker.ts` est invariant. Toutes gated par
   `requireModule(env, auth.userId, 'ecommerce')` AU TOP du bloc.
3. **Capabilities** : `clients.manage` (toutes routes opérationnelles) +
   `reports.view` (uniquement `/sessions/:id/report`). AUCUN ajout à
   `ALL_CAPABILITIES` (seq80 figée).
4. **Contrat réponses** : `json({ data })` succès / `json({ error }, status)`
   erreur. PAS de champ `code`. PAS de wrapping supplémentaire. Money TOUJOURS
   en cents INTEGER.
5. **Types `src/lib/api.ts`** : noms et signatures FIGÉS (§5). Manager-C peut
   ajouter des `interface` supplémentaires côté front s'il les expose, mais
   ne renomme PAS les exports listés.
6. **Bornage tenant** : `WHERE client_id = ?` dans tout SELECT/UPDATE/DELETE
   pos_registers / pos_sessions / pos_transactions (defense-in-depth IDOR
   sur `:id`). `resolveClientId()` via `getClientModules(env, auth.userId)`
   — calque snapshots.ts:57 / ecommerce-orders.ts:76.
7. **Pas de modification de `ecommerce-orders.ts`, `ecommerce-tax-engine.ts`,
   `ecommerce-payments.ts`, `ecommerce-inventory.ts`**. Si Phase B a besoin
   d'un comportement nouveau, RÉUTILISER les exports existants
   (`createOrderCore`, `commitOrderSale`, `computeTax({regime:'qc'})`,
   `reserveStock`/`releaseStock`/`commitSale`). Régression-zéro QC = invariant.
8. **Stripe Terminal = flag inactif (E4)** : `chargeCardTerminal` reste un
   stub `{ success:false, mock:true }` tant que `env.STRIPE_TERMINAL_*` n'est
   pas bindé. Aucun appel réseau réel Phase B sans validation Rochdi.
9. **Sécurité Loi 25 / RGPD** : `cashier_id` = user_id, JAMAIS le nom en
   clair. Reçus PDF/email = données client minimales (pas d'IP, pas d'UA).
10. **i18n** : 45 clés ajoutées dans 4 catalogues (`fr-CA`, `fr-FR`, `en`,
    `es`), parité STRICTE. Manager-C ne change PAS le nom des clés.

## §7 Découpe Phase B (Manager-B backend ∥ Manager-C frontend)

- **Manager-B** : remplit les 10 handlers AUTHED + 6 helpers `pos-engine`
  + 4 helpers `pos-receipt` (sauf ESC/POS = C4). Branche `createOrderCore`
  + `commitOrderSale` (verbatim). Implémente computeChange, computeVariance,
  validateSplit. Branche `chargeCardTerminal` en flag-inactif (mock). Upload
  R2 best-effort. ZÉRO fichier partagé avec C.
- **Manager-C** : page `/pos` (caisse plein écran), pages
  `/settings/pos-registers` (CRUD caisses), `/pos/reports/:sessionId` (X/Z
  report avec export CSV/PDF). Composants scan (caméra + manuel), modal
  paiement, reçu print preview. Intégration des 45 clés i18n. ZÉRO fichier
  partagé avec B (api.ts est en lecture pour C).
- **Manager-C4 dédié** : ESC/POS thermique 80mm — voir doc compagnon
  `ESC-POS-PRINTER-S37.md`. Implémente `buildEscPosBytes` (codeset Epson
  TM-T20III + Star — init/gras/align/cut). Pont WebUSB optionnel pour
  impression directe depuis le navigateur.

## §8 Doc compagnon — [`ESC-POS-PRINTER-S37.md`](ESC-POS-PRINTER-S37.md)

Doc 1.0 complète (Phase B C4 livré 2026-05-24). 11 sections markdown :

1. **§1 Vue d'ensemble** — 3 modes de sortie (HTML preview, ESC/POS bytes, PDF
   stub R2), formats 80mm (42 cols) / 58mm (32 cols), charset CP858 default.
2. **§2 Architecture `pos-receipt.ts`** — tableau des 4 exports figés
   (`buildReceiptHtml` / `buildEscPosBytes` / `buildReceiptPdfStub` /
   `uploadReceiptToR2`), types `ReceiptPayload` / `ReceiptItem` / `ReceiptTaxLine`,
   i18n labels 4 locales, helpers privés (`escapeHtml` / `formatCents` / `formatDate`).
3. **§3 Commandes ESC/POS implémentées** — tableau des 9 commandes Phase A
   (Reset, Charset CP858, Align L/C/R, Bold ON/OFF, LF, Cut full), tableau
   des commandes Phase B+ (Double height, Cut partial, Barcode, QR, Drawer kick,
   Bitmap logo), séquence canonique commentée.
4. **§4 Workflow d'impression** — flow nominal cash transaction, chemin A
   `window.print()` CSS @media print (Phase A wired), chemin B raw TCP socket
   port 9100 via Cloudflare Workers TCP API (TODO Sprint Observabilité).
5. **§5 Configuration imprimante (`printer_config_json`)** — colonne
   `pos_registers.printer_config_json` DEFAULT `'{}'`, format proposé JSON
   (type / ip / port / width_mm / charset / auto_cut / drawer_kick), tableau
   des 9 champs avec types et defaults, fallback `window.print()`.
6. **§6 Spec PDF future** — stub HTML bytes Phase A, implémentation cible
   Sprint 40+ via `pdf-lib` WASM Worker-compatible, alternatives (browser print
   to PDF, service externe), migration backward-compat.
7. **§7 ESC/POS pour 58mm (variant)** — différences 80mm vs 58mm (42 vs 32 cols),
   imprimantes typiques (Bixolon SRP-150, Star SM-S210i mobile), implémentation
   Phase B C4 via paramètre `config` sur `buildEscPosBytes` (calque `formatCents`).
8. **§8 Tests imprimante terrain** — checklist 9 points pour validation tenant
   (LAN ping, IP statique, port 9100, curl test, charset, cutter, vitesse,
   multi-reçus, reprise après coupure, drawer kick).
9. **§9 Erreurs courantes** — tableau de 8 erreurs (mojibake, pas de coupe,
   imprimante muette, reçu trop large, pages vides, drawer KO, TCP refused)
   avec cause + fix actionnable.
10. **§10 Sécurité réseau** — TCP plaintext sur LAN, pas d'auth imprimante,
    cloud printers (PrintNode recommandé S38+), PII Loi 25 dans reçus, checklist
    sécurité 6 points (VLAN POS, firewall, audit logs, R2 signed URLs).
11. **§11 Références** — liens vers `LOT-POS-S37.md`, `EMBED-SECURITY-S36.md`
    (structure calquée), `pos-receipt.ts`, ecommerce E1, CF Workers TCP API,
    ESC/POS Epson reference, `pdf-lib`, PrintNode, Loi 25.
