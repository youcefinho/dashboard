# LOT FACTURATION-RÉELLE — cycle complet facture conforme QC + devis/soumission

> Phase A SOLO (Manager unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> disjoints — §6.H). Non exécuté (VM VMware sans bun/node) — Antigravity
> buildera côté hôte. Modèle : `docs/LOT-TEAM-BC.md`. Phase B ne lit QUE ce
> document.

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS (rappel)

`src/lib/api.ts:62-112` (`apiFetch`) + `src/lib/api.ts:103-105`
(`if (!response.ok) return { error: data.error || ... }`) + le type
`ApiResponse<T>` (forme `{ data?, error? }`) sont **GELÉS** : Phase A les a
NON modifiés, Phase B ne les touche PAS. Décision **DÉFINITIVE** :

- Réponses succès = **`json({ data: ... })`** ; erreurs =
  **`json({ error: '<message>' }, <status>)`** UNIQUEMENT.
- **AUCUN champ `code`** côté retour, jamais. La discrimination d'erreur
  front est un **string-match sur `error`** (ou absence de `data`).
- Manager-B/C ne lisent JAMAIS `result.code`.

### §6.B — DDL exact seq 82 + conventions + best-effort

**Fichier** : `migration-invoice-real-seq82.sql`. **seq = 82**.
**depends_on** : `migration-team-lotC-seq81.sql` (seq 81 — dernière du
manifest avant ce lot ; chaînage d'ordre, aucune dépendance de schéma réelle).
Ligne manifest ajoutée : `docs/migrations-manifest.json` seq 82, objects
`["alter:invoices","table:invoice_items","table:quotes","table:quote_items"]`,
risk `medium`.

STRICTEMENT ADDITIF. Conventions schema.sql respectées : `id TEXT PRIMARY KEY
DEFAULT (lower(hex(randomblob(16))))`, timestamps `TEXT DEFAULT
(datetime('now'))`, PAS d'`unixepoch`, PAS d'INTEGER autoincrement, **AUCUNE
FK** (D1/SQLite : FK ⇒ rebuild ⇒ interdit ; jointures applicatives par
`invoice_id`/`quote_id`/`invoice_id`). AUCUN touch `users` / CHECK role seq
59. AUCUN touch tables E4/E6 régulées (`payments`, `payment_events`,
`payment_provider_config`, `refunds`, `disputes`, `return_requests`).

**Tolérance « duplicate column name »** (en-tête du fichier, comme seq
79/81) : les 9 `ALTER TABLE invoices ADD COLUMN` échouent « duplicate column
name » si seq 82 rejouée ⇒ ATTENDU, NON FATAL. L'exécuteur (Antigravity)
joue **statement-par-statement**, log + CONTINUE. `CREATE TABLE/INDEX IF NOT
EXISTS` idempotents. `scripts/migrate.ts` FIGÉ, non modifié.

DDL :

```sql
-- 1) ALTER invoices (9 colonnes, toutes nullable / DEFAULT NULL)
ALTER TABLE invoices ADD COLUMN invoice_number TEXT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN subtotal REAL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN tax_tps REAL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN tax_tvq REAL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN total REAL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN due_date TEXT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN quote_id TEXT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN tps_number TEXT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN tvq_number TEXT DEFAULT NULL;

-- 2) invoice_items (jointure applicative par invoice_id, PAS de FK)
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  invoice_id TEXT NOT NULL, label TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- 3) quotes (status CHECK draft/sent/accepted/declined/expired ; agency_id
--    pour bornage tenant ; description ajouté par symétrie invoices)
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, lead_id TEXT, agency_id TEXT, quote_number TEXT,
  subtotal REAL, tax_tps REAL, tax_tvq REAL, total REAL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','accepted','declined','expired')),
  valid_until TEXT, accepted_at TEXT, invoice_id TEXT,
  tps_number TEXT, tvq_number TEXT, description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_agency ON quotes(agency_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_lead   ON quotes(lead_id);

-- 4) quote_items (même forme que invoice_items, jointure applicative quote_id)
CREATE TABLE IF NOT EXISTS quote_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  quote_id TEXT NOT NULL, label TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
```

> **Écart vs brief documenté (CODE > brief)** : la colonne `quotes.description`
> a été AJOUTÉE (non listée au brief) par symétrie stricte avec
> `invoices.description` existante (`migration_p3_8.sql:11`) — un devis a
> besoin d'un libellé/note comme une facture. Strictement additif, nullable,
> zéro impact rétro-compat.

### §6.C — Règle de calcul taxes FIGÉE + numérotation + n° d'inscription

**Calcul SERVEUR uniquement.** Le front AFFICHE les champs stockés
(`subtotal`/`tax_tps`/`tax_tvq`/`total`) — il ne les invente JAMAIS. Formule
(Manager-B l'implémente VERBATIM dans `billing.ts` et `quotes.ts`) :

```
line_total = round(qty * unit_price, 2)              // par ligne, stocké
subtotal   = round(Σ(line_total), 2)
tax_tps    = round(subtotal * 0.05, 2)               // TPS 5 %
tax_tvq    = round(subtotal * 0.09975, 2)            // TVQ 9,975 %
total      = round(subtotal + tax_tps + tax_tvq, 2)
```

`round(x, 2)` = arrondi 2 décimales monétaire (`Math.round(x * 100) / 100`).
TPS et TVQ sont **ventilées séparément et stockées** (exigence ARQ ; le
rétro-calcul `amount/1.14975` de `Invoices.tsx:344-356` est ABANDONNÉ —
Manager-C supprime cet affichage faux et lit les colonnes serveur).

**Numérotation séquentielle par tenant/agence.** Décision figée après
lecture du code :

- **Préfixe** : `INV-` (facture) / `QUO-` (devis).
- **Portée du compteur** : par agence si `auth.tenant.agencyId != null`,
  sinon par `client_id` (legacy/mono-tenant). Le scope retenu est la clé
  d'isolation déjà en vigueur (pattern `team.ts handleGetUsers`,
  `tenant-context.ts`).
- **Algo exact (Manager-B)** : numéro =
  `<PREFIX><YYYY>-<NNNN>` où `<NNNN>` = `1 + COUNT(*)` des factures (resp.
  devis) du même scope tenant pour l'année courante, calculé **dans la même
  transaction logique que l'INSERT** (`SELECT COUNT(*) ... WHERE agency_id =
  ? AND invoice_number LIKE 'INV-<YYYY>-%'` puis INSERT). D1 sérialise les
  writes par worker ; en cas de collision improbable, l'unicité n'est pas
  contrainte au niveau SQL (pas d'index UNIQUE — D1 ALTER-safe) : le numéro
  est un libellé d'affichage/PDF, l'identité technique reste `id`
  (randomblob). Documenté comme acceptable (volume PME, write-serialized).
- Pas de table compteur dédiée (évite une 5e table ; le `COUNT(*)` borné
  tenant suffit au volume cible PME — décision figée).

**Où vivent `tps_number` / `tvq_number`** — choix figé après audit code :

> Audit migrations 1→81 + `schema.sql` (cf. en-tête `migration-team-lotC-seq81.sql:12-24`
> qui inventorie les colonnes `clients`) : `clients` possède
> `tax_regime TEXT DEFAULT 'qc'` (seq 72, `migration-sprintER-m2.sql:39`)
> mais **AUCUNE** colonne de n° d'inscription TPS/TVQ. Aucune table de
> settings entreprise/facturation tenant ne stocke ce n°. Il n'existe nulle
> part dans le schéma.

**Décision** : `tps_number` / `tvq_number` sont des **colonnes SUR la pièce**
(`invoices` ET `quotes`, seq 82, nullable). Justification comptable : le n°
d'inscription imprimé sur une facture/un devis doit être celui **valide au
moment de l'émission** (snapshot immuable — si le tenant change de n°, les
pièces déjà émises gardent l'ancien). Mettre le n° uniquement sur `clients`
exposerait à une réécriture rétroactive de pièces comptables. Manager-B
renseigne ces colonnes à la création (depuis un réglage tenant futur ou un
champ saisi — hors périmètre de ce lot ; NULL accepté = n° non configuré,
non bloquant). Aucune colonne ajoutée à `clients` (interdit : touch table
partagée ~1078 réf hors périmètre).

### §6.D — Contrats handlers (signatures FIGÉES, endpoints, bornage)

**Pattern de retour** : succès `json({ data })`, erreur `json({ error }, status)`
(§6.A). **Pattern de bornage tenant** = EXACTEMENT `team.ts handleGetUsers`
(`src/worker/team.ts:87-135`) : legacy/mono-tenant (`!auth?.tenant ||
auth.tenant.agencyId == null`) ⇒ scope complet (endpoints NEUFS ⇒
byte-équivalent à l'absence historique de garde) ; mode agence
(`agencyId != null`) ⇒ `WHERE agency_id = ?` (+ `OR client_id IN
(placeholders accessibleClientIds)` pour les pièces rattachées à un
sous-compte) ; `try/catch` best-effort (table seq 82 absente ⇒ `{ data: [] }`
/ `{ error }`, JAMAIS de throw/500).

**Garde capability** : pattern `capGuard` CONDITIONNEL mode-agence-only DÉJÀ
en place (`src/worker/billing.ts:11-19`, posé LOT B-bis) :

```ts
function capGuard(auth, cap): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;   // legacy/mono-tenant/api-key/tests ⇒ skip ⇒ byte-identique
}
```

`handleCreateInvoice` existant (`billing.ts:45-74`) a DÉJÀ `const cg =
capGuard(auth as never, 'invoices.write'); if (cg) return cg;` —
**Manager-B PRÉSERVE cette garde** en enrichissant le corps. Les mutations
devis (`handleCreateQuote`/`handleUpdateQuote`/`handleAcceptQuote`) doivent
poser la **même garde `capGuard(auth, 'invoices.write')`** (un devis est une
pièce pré-comptable du même domaine ; `invoices.write` réservé `owner` en
mode agence — cf. `docs/LOT-TEAM-BC.md §6.C`). Lectures
(`handleGetInvoice`/`handleGetInvoicePdfData`/`handleListQuotes`/
`handleGetQuote`) : pas de garde bloquante (bornage tenant suffit).

Signatures FIGÉES (Manager-B écrit les corps) :

| Endpoint (worker.ts, bloc `routeProtected`) | Handler | Fichier | Garde |
|---|---|---|---|
| `POST /api/invoices` | `handleCreateInvoice` (ENRICHI) | `billing.ts` (existant, garde déjà posée) | `capGuard 'invoices.write'` |
| `GET /api/invoices` | `handleGetInvoices` (existant, inchangé) | `billing.ts` | — |
| `PATCH /api/invoices/:id/status` | `handleUpdateInvoiceStatus` (existant) | `billing.ts` | `capGuard 'invoices.write'` (déjà) |
| `GET /api/invoices/:id` | `handleGetInvoice(request, env, auth, invoiceId)` | `billing.ts` (STUB Phase A) | — |
| `GET /api/invoices/:id/pdf-data` | `handleGetInvoicePdfData(request, env, auth, invoiceId)` | `billing.ts` (STUB Phase A) | — |
| `POST /api/quotes` | `handleCreateQuote(request, env, auth)` | `quotes.ts` (STUB Phase A) | `capGuard 'invoices.write'` |
| `GET /api/quotes` | `handleListQuotes(request, env, auth)` | `quotes.ts` (STUB) | — |
| `GET /api/quotes/:id` | `handleGetQuote(request, env, auth, quoteId)` | `quotes.ts` (STUB) | — |
| `PATCH /api/quotes/:id` | `handleUpdateQuote(request, env, auth, quoteId)` | `quotes.ts` (STUB) | `capGuard 'invoices.write'` |
| `POST /api/quotes/:id/accept` | `handleAcceptQuote(request, env, auth, quoteId)` | `quotes.ts` (STUB) | `capGuard 'invoices.write'` |

Routes câblées Phase A dans `src/worker.ts` (bloc billing, avant « SaaS
Configurator (P3.9) ») — **worker.ts est GELÉ par Phase A**, Phase B n'y
touche pas. Ordre anti-shadowing respecté : `/api/invoices/:id/pdf-data`
AVANT `/api/invoices/:id` ; `/status` (PATCH) déjà prioritaire ;
`/api/quotes/:id/accept` AVANT `/api/quotes/:id`.

> **Écart vs brief documenté (CODE > brief)** : `billing.ts` reçoit DEUX
> stubs (`handleGetInvoice`, `handleGetInvoicePdfData`) — le brief disait
> « n'ajoute PAS de stub dans billing.ts sauf minimal pour compiler ».
> worker.ts importe ces 2 handlers ⇒ ils DOIVENT exister pour compiler.
> Ce sont des stubs minimaux balisés `// STUB PHASE A → corps réel Phase B
> Manager-B`, sans logique métier, garde capGuard déjà existante préservée
> intacte. Zéro conflit Phase B (Manager-B possède billing.ts entier, §6.H).

> **Écart vs brief documenté (CODE > brief)** : helper `createInvoice`
> ENRICHI ajouté sous le nom **`createInvoiceFull`** (PAS de mutation de
> `createInvoice` existant `api.ts:2208`, consommé par `Invoices.tsx:69` —
> fichier Manager-C, Phase B). Muter la signature actuelle casserait le
> front avant que Manager-C ne migre. `createInvoice`/`getInvoices`/
> `updateInvoiceStatus` legacy INCHANGÉS. Manager-C migre vers
> `createInvoiceFull` quand il refond le formulaire. Type exporté `Invoice`
> (api.ts) ≠ `interface Invoice` locale `Invoices.tsx:18` (symboles
> distincts, aucune collision — la page importe des fonctions, pas le type ;
> Manager-C bascule sur le type api.ts à sa convenance Phase B).

### §6.E — `payment_url` honnête (interdiction URL Stripe factice)

Décision **FIGÉE, NON négociable** : `billing.ts:65-66` forge actuellement
`payment_url = https://pay.intralys.com/checkout/${id}` (Stripe FACTICE, URL
morte rendue cliquable `Invoices.tsx:317-326`). **Manager-B SUPPRIME cette
forge** : à la création, `payment_url = null`. Le statut/instruction de
règlement est porté par les libellés i18n `invoice.payment_offline` /
`invoice.payment_instructions` (« À régler — paiement hors ligne »).
**Manager-C SUPPRIME le lien mort cliquable** (`Invoices.tsx:317-326`) et
affiche à la place le libellé hors-ligne.

E4/E6 régulés (`payments_live_enabled`, provider Stripe
`src/worker/payments/stripe-provider.ts`, tables `payments`/`payment_events`/
`payment_provider_config`/`refunds`/`disputes`) : **JAMAIS touchés, JAMAIS
activés**. `handleStripeWebhook` (`billing.ts`, webhook mock SaaS) : intact,
hors périmètre — ne PAS le re-câbler sur les nouvelles factures.

### §6.F — `handleAcceptQuote` (devis accepté → facture liée)

Corps réel Manager-B (`quotes.ts`). Séquence :

1. Charger le devis (borné tenant §6.D) ; si absent → `json({ error:
   'Devis introuvable' }, 404)` (i18n `quote.error.not_found`).
2. Si `status != 'sent'` et `!= 'draft'` → refuser (déjà accepté/refusé/
   expiré) : `json({ error: ... }, 409)`.
3. INSERT facture liée : nouveau `id` (`inv_<uuid>` — convention existante
   `billing.ts:63`), `quote_id` = id du devis, lignes COPIÉES depuis
   `quote_items` → `invoice_items`, **taxes RECALCULÉES serveur** (§6.C, ne
   pas faire confiance aux montants stockés du devis — recalcul depuis les
   lignes), `payment_url = NULL` (§6.E), `status = 'draft'`,
   `tps_number`/`tvq_number` copiés du devis, `invoice_number` généré (§6.C).
4. `UPDATE quotes SET status = 'accepted', accepted_at = datetime('now'),
   invoice_id = <id facture>, updated_at = datetime('now') WHERE id = ?`.
5. **Option** : si la requête porte `mark_lead_won: true` ET `quotes.lead_id`
   non nul → `UPDATE leads SET status = 'won' WHERE id = ?` **best-effort**
   (try/catch isolé : si pas de lead / colonne absente / valeur de statut
   différente → on n'échoue PAS l'acceptation ; le succès facture prime).
6. Réponse : `json({ data: { invoice_id: <id> } })`.

Tout échec partiel post-INSERT facture ne doit PAS laisser un devis
`accepted` sans `invoice_id` : ordonner INSERT facture → UPDATE quote dans
cet ordre ; le lead-won est la SEULE étape best-effort tolérée.

### §6.G — Listes i18n complètes (4 catalogues, parité STRICTE)

Catalogues VIVANTS = `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (×4, format plat
point-notation, valeurs strings, PAS de `{{var}}`). `src/i18n/*.json` =
**MORT** — NE PAS toucher. **Phase A est SEUL owner i18n** : **44 clés × 4 =
176, parité stricte vérifiée (diff = 0 sur les 3 paires, zéro doublon, zéro
collision avec les clés `invoices.*` plurielles pré-existantes —
namespace neuf `invoice.` singulier + `quote.`)**. Manager-B/C **utilisent**
via `t('<clé>')`, ne touchent JAMAIS les catalogues.

Clés `invoice.*` (22) :
```
invoice.items.title  invoice.items.label  invoice.items.qty
invoice.items.unit_price  invoice.items.line_total  invoice.items.add
invoice.items.remove  invoice.subtotal  invoice.tax_tps  invoice.tax_tvq
invoice.total  invoice.number  invoice.due_date  invoice.tps_number
invoice.tvq_number  invoice.payment_offline  invoice.payment_instructions
invoice.status.draft  invoice.status.sent  invoice.status.paid
invoice.status.cancelled  invoice.error.items_required
```

Clés `quote.*` (22) :
```
quote.title  quote.new  quote.number  quote.status.draft  quote.status.sent
quote.status.accepted  quote.status.declined  quote.status.expired
quote.valid_until  quote.items.title  quote.items.add  quote.accept
quote.decline  quote.accept_confirm  quote.accepted
quote.converted_to_invoice  quote.mark_lead_won  quote.empty
quote.error.create  quote.error.accept  quote.error.not_found
quote.pdf.title
```

Registre : fr-CA = QC pro ; fr-FR = vocabulaire France + qualificatif
« (Québec) » sur les n° d'inscription (calqué sur l'en-tête fr-FR existant
« compliance Québec ») ; en = GST/QST + QC ; es = neutre Latam.

### §6.H — Matrice de propriété fichiers Phase B (disjonction STRICTE)

**Fichiers GELÉS (Phase A — Manager-B/C n'y TOUCHENT PAS)** :
`src/worker.ts` (dispatch + choke-point), `src/lib/api.ts`
(helpers/types + `apiFetch`/`ApiResponse`), `migration-invoice-real-seq82.sql`,
`docs/migrations-manifest.json`, les 4 catalogues
`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, ce `docs/LOT-INVOICE.md`, les **6
pages R** (`Leads`, `Dashboard`, `LeadDetail`, `Tasks`, `Pipeline`,
`Clients`) — **INTERDITES aux deux Managers**.

| Fichier | Owner Phase B | Action |
|---|---|---|
| `src/worker/billing.ts` | **Manager-B** | enrichir `handleCreateInvoice` (lignes invoice_items + taxes serveur §6.C + `payment_url=NULL` §6.E + `invoice_number` §6.C ; **PRÉSERVER `capGuard 'invoices.write'`** déjà posée ligne 50) ; écrire corps réels `handleGetInvoice` + `handleGetInvoicePdfData` (STUBS Phase A). Ne PAS toucher `handleStripeWebhook`. Signatures FIGÉES. |
| `src/worker/quotes.ts` | **Manager-B** | écrire corps réels des 5 handlers (STUBS Phase A) — taxes serveur §6.C, numérotation §6.C, bornage §6.D, `capGuard 'invoices.write'` sur mutations, `handleAcceptQuote` §6.F. Signatures FIGÉES. |
| `src/pages/Invoices.tsx` | **Manager-C** | refondre : formulaire lignes (items) + affichage `subtotal/tax_tps/tax_tvq/total` lus du serveur (SUPPRIMER le rétro-calcul faux `amount/1.14975` lignes 344-356) ; SUPPRIMER le lien mort `payment_url` cliquable (lignes 317-326) → libellé `invoice.payment_offline` ; SUPPRIMER `client_id:'default_client_for_demo'` (ligne 72) ; migrer vers `createInvoiceFull`/`getInvoice`/`getInvoicePdfData`. i18n `invoice.*`. |
| Nouvelle page/onglet Devis | **Manager-C** | créer la page/onglet Devis (liste `listQuotes`, création `createQuote`, détail `getQuote`, `updateQuote`, `acceptQuote` avec confirmation `quote.accept_confirm` + option `mark_lead_won`). i18n `quote.*`. Route à brancher côté front router (fichier router front, hors les 6 pages R / hors worker.ts). |
| Gabarit PDF (`src/lib/pdfExport.ts` existant — réutiliser ; vérifié : `Invoices.tsx:12` importe `triggerPdfExport`) | **Manager-C** | adapter le gabarit PDF facture pour la ventilation TPS/TVQ + n° d'inscription via `getInvoicePdfData`. NE PAS créer un nouveau module si `pdfExport.ts` suffit (MODIFIER > AJOUTER). |

**Disjonction garantie** : Manager-B ⊂ {`billing.ts`, `quotes.ts`}.
Manager-C ⊂ {`Invoices.tsx`, nouvelle page/onglet Devis, `pdfExport.ts` (ou
équivalent existant), fichier router front pour la route Devis}. **Zéro
fichier commun.** worker.ts / api.ts / migrations / manifest / 4 i18n /
docs GELÉS Phase A ⇒ aucune course. Les 6 pages R interdites aux deux.

### §6.I — Garde-fous + suites à NE PAS régresser + invariants

Suites à NE PAS régresser (rétro-compat byte-identique legacy) :
`lot1-*`/`lot2-*`/`lot3-*`/`lot4-*`, `tenant-context`, `teamA-isolation`,
`teamA-invitation`, `ecommerce-multitenant.*`, **suites billing existantes**
(les handlers `handleGetInvoices`/`handleCreateInvoice`/
`handleUpdateInvoiceStatus`/`handleStripeWebhook` gardent leur comportement —
`handleCreateInvoice` enrichi RESTE rétro-compatible : un POST legacy
`{ amount }` sans `items` doit continuer à fonctionner, voir invariant
ci-dessous).

Invariants vérifiables :
- **Rétro-compat lignes `invoices` existantes** : colonnes seq 82 toutes
  nullable / DEFAULT NULL ⇒ lignes legacy (avec seul `amount`) inchangées
  byte-à-byte. Le code (front + PDF) lit **`total ?? amount`** en fallback ;
  `subtotal`/`tax_tps`/`tax_tvq` NULL ⇒ affichage dégradé propre (pas de
  ventilation affichée, montant global `amount`). Manager-B : si
  `handleCreateInvoice` reçoit un POST legacy `{ amount }` SANS `items`, il
  conserve le chemin legacy (insert `amount` seul, `total=NULL`) — zéro
  rupture des appelants existants.
- **Aucun paiement réel activé** : `payment_url` jamais une URL Stripe
  réelle/factice ; E4/E6 régulés non touchés ; `payments_live_enabled`
  jamais lu/écrit par ce lot.
- **Aucune FK** : seq 82 = 9 ALTER ADD COLUMN + 4 CREATE TABLE/INDEX IF NOT
  EXISTS, zéro `FOREIGN KEY`, zéro `DROP`/`RENAME`, jointures applicatives.
- **CHECK role seq 59 intact** : zéro touch `users`, zéro rebuild.
- **apiFetch gelé** : aucune réponse de ce lot ne dépend d'un champ `code`.
- **Choke-point** : worker.ts routes additives, `auth` (CapAuth enrichi
  `userId/role/clientId?/tenant?/capabilities?`) passé tel quel aux nouveaux
  handlers, best-effort, jamais de throw/500.

**§6 LOT FACTURATION-RÉELLE FIGÉ → Phase B (Manager-B ∥ Manager-C) peut démarrer.**
