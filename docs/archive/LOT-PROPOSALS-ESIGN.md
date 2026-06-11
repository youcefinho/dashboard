# LOT PROPOSALS-ESIGN — Proposals e-sign : pont devis↔signature (Sprint 17 : l'e-signature existe DÉJÀ — `documents.ts` seq 11 (`handleCreateDocument` token+expires, `handleSendDocument` email, `handleSendSigningSms`, route PUBLIQUE `/api/sign/:token` `handlePublicGetDocument` sent→viewed + `handlePublicSignDocument` capture IP/UA/horodatage/hash SHA-256/audit_trail/notif, statut `'won'`=signé) + `SignDocument.tsx` `/sign/$token` + table `documents` seq 11 (status SANS CHECK, token UNIQUE, audit_trail, expires_at) + 15 clés `sign.*` ×4 ; les DEVIS existent DÉJÀ — `quotes.ts` seq 82 (`handleCreateQuote`/`handleUpdateQuote`/`handleGetQuote`/`handleAcceptQuote`→facture, `quote_items`, taxes TPS/TVQ, `quotes.status` CHECK FIGÉ `draft/sent/accepted/declined/expired`) + `pdfExport` `kind:'quote'`. On COMBLE le GAP = LE PONT, 100% ADDITIF, RÉUTILISANT l'existant — PAS de table `proposals` neuve)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-TELEPHONY-DISPOSITION.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE des fichiers RÉUTILISÉS,
> jamais le brief).

Sprint **100% ADDITIF**, **migration `migration-proposals-esign-seq117.sql`**
(3 `ALTER TABLE … ADD COLUMN` NULLABLES + 1 index, sur les tables EXISTANTES
`documents` seq 11 et `quotes` seq 82). L'e-signature ET les devis existent
DÉJÀ — **à RÉUTILISER, NE PAS reconstruire, PAS de table `proposals`** :

- `src/worker/documents.ts` (seq 11) — owned Manager-B (§6.H). Pièces RÉUTILISÉES :
  - **`handleCreateDocument`** (l.214) : crée un document signable (génère
    `token = crypto.randomUUID()`, `expires_at` = +30 jours, interpole les
    variables, `INSERT INTO documents (… token, expires_at, created_by)`, renvoie
    `{ id, token, sign_url:'/sign/'+token }`, 201). **À RÉUTILISER (logique)**
    pour créer le document lié au devis (avec `quote_id`).
  - **`handleSendDocument`** (l.337) : envoi email (Resend) du lien `/sign/:token`,
    UPDATE `status='sent', sent_at`. **RÉUTILISÉ pour l'envoi.**
  - **`handleSendSigningSms`** (l.515) : envoi SMS (Twilio) du lien, UPDATE
    `status='sent'` si draft. **RÉUTILISÉ (option SMS).**
  - **`handlePublicGetDocument`** (l.391) : PUBLIC, `SELECT … WHERE token = ? AND
    status IN ('sent','viewed')`, vérifie expiration (410), marque `viewed`.
    **GELÉ — NE PAS casser le filtre sent/viewed.**
  - **`handlePublicSignDocument`** (l.423) : PUBLIC, capture
    IP/UA/horodatage/hash SHA-256/audit_trail, UPDATE `status='won', signed_at,
    signature_data, audit_trail`, notif créateur + email confirmation. statut
    **`'won'`=signé** (documents.status LIBRE). **À ÉTENDRE (Manager-B) : SI
    `doc.quote_id` → accepter le devis (facture).**
  - `interpolateVars` (l.7) — réutilisable pour le rendu HTML.
- `src/worker/quotes.ts` (seq 82) — owned Manager-B (§6.H). Pièces RÉUTILISÉES :
  - **`handleAcceptQuote`** (l.393) : devis `sent`/`draft` → INSERT facture liée
    (recalcul taxes SERVEUR depuis `quote_items`, jamais les montants stockés) +
    `invoice_items`, puis UPDATE `quotes SET status='accepted', accepted_at,
    invoice_id`, option `mark_lead_won`. Renvoie `{ invoice_id }`. **Appelable
    MANUELLEMENT (route /accept) ET depuis la signature (Manager-B câble la
    logique dans `handlePublicSignDocument`). NE PAS casser.**
  - **`loadQuoteScoped`** (l.254) : charge un devis borné tenant (legacy = libre ;
    mode agence = `agency_id` OU `client_id ∈ accessibleClientIds`). **RÉUTILISÉ.**
  - **`computeTotals`** (l.77) : recalcul SERVEUR lignes + taxes (TPS 5 %, TVQ
    9,975 %). **RÉUTILISÉ pour le pricing du devis.**
  - **`capGuard`** (l.52) : `requireCapability('invoices.write')` mode-agence-only
    (legacy/mono-tenant/api-key/tests ⇒ skip). **RÉUTILISÉ.**
  - `quote_items` (jointure applicative par `quote_id`, PAS de FK) — lignes du
    devis pour la pricing table.
- `src/lib/api.ts` — `Document` interface (l.2937, ÉTENDUE Phase A : `+quote_id`
  `+declined_at`), `Quote` interface (l.3055, ÉTENDUE Phase A : `+document_id`),
  helpers `getQuote`/`listQuotes`/`acceptQuote`/`getDocuments`/`sendDocument`
  EXISTANTS. **READ/IMPORT (front).**
- `src/pages/SignDocument.tsx` — page PUBLIQUE `/sign/$token` EXISTANTE (charge via
  `apiFetch('/sign/'+token)`, canvas + nom + submit `apiFetch('/sign/'+token,
  {POST})`). **À ÉTENDRE (Manager-C).**
- `src/pages/Quotes.tsx` — page devis EXISTANTE. **À ÉTENDRE (Manager-C).**
- `src/lib/pdfExport.ts` — `kind:'quote'` (`exportPiecePdf`). **READ/IMPORT.** NON
  modifié par ce lot.

**GAP comblé = LE PONT :**
- **(A)** aucun moyen d'**envoyer un devis chiffré pour signature** → route NEUVE
  `POST /api/quotes/:id/send-for-signature` + helper `sendQuoteForSignature` +
  colonnes `documents.quote_id` / `quotes.document_id` (lien bidirectionnel).
- **(B)** la **signature ne déclenche pas l'acceptation du devis** →
  `handlePublicSignDocument` étendu (Manager-B) : SI `doc.quote_id` → logique
  `handleAcceptQuote` (devis→facture+notif) borné tenant, best-effort.
- **(C)** pas de **refus** côté signataire → route PUBLIQUE NEUVE
  `POST /api/sign/:token/decline` + helper `declinePublicDocument` +
  `handlePublicDeclineDocument` (`documents.status='declined'`, `declined_at` ; si
  `quote_id` → `quotes.status='declined'`).

Alias : imports worker **RELATIFS** (`./...`), JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi — à RÉUTILISER)

### `src/worker/documents.ts` — `handleCreateDocument` (l.214, logique RÉUTILISÉE Manager-B)

```ts
export async function handleCreateDocument(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response>;
//   role admin requis (auth.role !== 'admin' → 403). Lit body { template_id?,
//   lead_id, title, body_html? }. lead_id REQUIS → charge lead + client pour
//   interpolation. token = crypto.randomUUID(). expires_at = +30 jours ISO.
//   INSERT INTO documents (id, template_id, lead_id, client_id, title,
//     body_html, token, expires_at, created_by) VALUES (…)
//   status = DEFAULT 'draft'. Renvoie json({ data:{ id, token,
//     sign_url:'/sign/'+token } }, 201).
```
⚠ **Manager-B NE crée PAS un nouveau handler de doc** pour le devis — il
RÉUTILISE cette LOGIQUE dans `handleSendQuoteForSignature` (quotes.ts) en
renseignant en plus `quote_id`. Le `body_html` du document = la **pricing table**
rendue depuis le devis (voir §6.G). `lead_id` du document = `quote.lead_id`
(peut être null ⇒ adapter : le devis n'a pas toujours de lead ; dans ce cas
fournir un `body_html` direct sans interpolation lead, ou un lead_id vide selon
le schéma — `documents.lead_id` est NULLABLE seq 11).

### `src/worker/documents.ts` — `handlePublicSignDocument` (l.423, À ÉTENDRE Manager-B)

```ts
export async function handlePublicSignDocument(
  request: Request, env: Env, token: string
): Promise<Response>;
//   PUBLIC (hors auth, worker.ts ~893). SELECT … WHERE token = ? AND status IN
//     ('sent','viewed'). Expiration → 410. body { signature, signer_name? }.
//   Capture ip (CF-Connecting-IP / X-Forwarded-For), user_agent, timestamp ISO.
//   docHash = SHA-256(body_html). audit_trail.push({ action:'won', ip,
//     user_agent, timestamp, document_hash, signer_name }).
//   UPDATE documents SET status='won', signed_at, signature_data, audit_trail
//     WHERE id = ?. Notif créateur (best-effort) + email confirmation (Resend).
//   Renvoie json({ data:{ success:true, signed_at, document_hash } }).
```
⚠ **Manager-B AJOUTE** : APRÈS l'UPDATE `status='won'` réussi, **SI
`doc.quote_id`** → appliquer la **logique de `handleAcceptQuote`** (charger le
devis borné tenant, recalcul taxes serveur depuis `quote_items`, INSERT facture +
`invoice_items`, UPDATE `quotes SET status='accepted', accepted_at, invoice_id`,
notif). **best-effort** (try/catch — si la facture échoue, la signature reste un
succès ; ne PAS jeter, GARDER la réponse publique `{ data:{ success:true,
signed_at, document_hash } }`). ⚠ **`quotes.status='accepted'` est DÉJÀ dans le
CHECK seq 82** — AUCUNE valeur neuve. NE PAS casser le flux signature sans devis
(`quote_id` null ⇒ comportement seq 11 INCHANGÉ).

### `src/worker/quotes.ts` — `handleAcceptQuote` (l.393, logique RÉUTILISÉE Manager-B)

```ts
export async function handleAcceptQuote(
  request: Request, env: Env, auth: QuoteAuth, quoteId: string
): Promise<Response>;
//   capGuard 'invoices.write'. loadQuoteScoped (borné tenant) → 404 si absent.
//   Refuse si status ∉ {'sent','draft'} → 409. Recalcul taxes SERVEUR depuis
//   quote_items (computeTotals) — JAMAIS les montants stockés. nextNumber
//   'INV-'. INSERT invoices (status 'draft', payment_url NULL, quote_id, …) +
//   invoice_items. PUIS UPDATE quotes SET status='accepted', accepted_at,
//   invoice_id, updated_at. Option body.mark_lead_won → UPDATE leads (best-eff).
//   Renvoie json({ data:{ invoice_id } }).
```
⚠ Appelable **MANUELLEMENT** (route `/api/quotes/:id/accept` POST, INTOUCHÉE) ET
depuis la signature. Depuis le webhook public de signature il n'y a PAS de
`QuoteAuth` (pas d'auth applicative) → Manager-B borne par le devis lui-même
(`quote.id` issu de `doc.quote_id`, tenant = celui du document/devis), PAS via
`capGuard`. Réutiliser la **logique** (recalc taxes serveur + INSERT facture +
UPDATE devis), pas forcément le handler tel quel.

### `src/worker/quotes.ts` — `loadQuoteScoped` (l.254) / `computeTotals` (l.77) / `capGuard` (l.52)

`loadQuoteScoped(env, quoteId, auth)` → row bornée tenant ou null.
`computeTotals(rawItems)` → `{ lines, subtotal, tax_tps, tax_tvq, total }` (TPS
5 %, TVQ 9,975 %, round2). `capGuard(auth, 'invoices.write')` mode-agence-only.
**NE PAS réécrire — réutiliser.**

### Colonnes ADDITIVES (seq 117 — manifestée)

```sql
ALTER TABLE documents ADD COLUMN quote_id    TEXT;   -- lien → devis, NULLABLE
ALTER TABLE documents ADD COLUMN declined_at TEXT;   -- horodatage refus, NULLABLE
ALTER TABLE quotes    ADD COLUMN document_id TEXT;    -- lien retour, NULLABLE
CREATE INDEX IF NOT EXISTS idx_documents_quote ON documents(quote_id);
```
Zéro CHECK / FK / DROP / RENAME / rebuild. **CHECK `quotes.status` (seq 82)
INTOUCHÉ** (`accepted`/`declined` DÉJÀ permis, réutilisés). `documents.status`
LIBRE (`'won'`=signé conservé). Lien quote↔document APPLICATIF (TEXT, PAS de FK).

---

## §1 — MIGRATION (seq 117, ADDITIVE)

`migration-proposals-esign-seq117.sql` (racine) — calque l'en-tête seq 116 :
3 `ALTER TABLE … ADD COLUMN` (NULLABLES, sans DEFAULT non-NULL, sans CHECK, sans
FK) + 1 `CREATE INDEX IF NOT EXISTS idx_documents_quote(quote_id)`. **ZÉRO CHECK,
ZÉRO FK, ZÉRO DROP/RENAME/rebuild, ZÉRO `CREATE TABLE documents`/`CREATE TABLE
quotes`, ZÉRO touch du CHECK `quotes.status`.** Manifestée
`docs/migrations-manifest.json` seq 117
(`depends_on:["migration-telephony-disposition-seq116.sql"]`, objects
`["alter:documents","alter:quotes","index:documents"]`, risk low). ⚠ **NE touche
NI leads NI clients NI invoices NI quote_items NI notifications NI activity_log.**

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉ Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`**. **AUCUN helper n'envoie de `client_id`** (tenant re-borné worker-side).

```ts
// Envoyer un devis pour signature (signature FIGÉE Phase A).
sendQuoteForSignature(
  quoteId: string,
): Promise<ApiResponse<{ document_id: string; sign_url: string }>>
//   → apiFetch('/quotes/'+quoteId+'/send-for-signature', { method:'POST' })

// Refus PUBLIC d'un document (signature FIGÉE Phase A). Calque l'appel public
// de signature de SignDocument.tsx (apiFetch sur /sign/:token → worker public
// /api/sign/:token). reason optionnel.
declinePublicDocument(
  token: string,
  payload?: { reason?: string },
): Promise<ApiResponse<{ success: boolean }>>
//   → apiFetch('/sign/'+token+'/decline',
//              { method:'POST', body: JSON.stringify(payload || {}) })
```
⚠ **`declinePublicDocument` utilise `apiFetch`** (pas `fetch` brut) — c'est
EXACTEMENT le pattern de l'appel public existant de `SignDocument.tsx`
(`apiFetch('/sign/'+token, …)` → route worker publique `/api/sign/:token`, hors
auth). `apiFetch` préfixe `${API_BASE}` (`/api`) → cible bien `/api/sign/:token/
decline`. Le 401-redirect d'`apiFetch` ne se déclenche pas (route publique 200/4xx
applicatif). **NE PAS modifier `api.ts` (FIGÉ Phase A).**

### §6.B — Types `Document` / `Quote` (`src/lib/api.ts`, ÉTENDUS Phase A) — ApiResponse INCHANGÉ

```ts
export interface Document {
  …                          // champs seq 11 INCHANGÉS
  quote_id?: string | null;     // ← ADDITIF seq 117 (lien → devis)
  declined_at?: string | null;  // ← ADDITIF seq 117 (horodatage refus)
}
export interface Quote {
  …                          // champs seq 82 INCHANGÉS (status: QuoteStatus FIGÉ)
  document_id?: string | null;  // ← ADDITIF seq 117 (lien retour → document)
}
```
⚠ `Quote.status` reste `QuoteStatus` (`draft|sent|accepted|declined|expired`) —
CHECK seq 82 FIGÉ. La signature passe le devis en `'accepted'`, le refus en
`'declined'` — **AUCUNE valeur `'signed'`/`'viewed'` ajoutée à `quotes.status`**.

### §6.C — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

| Route | Méthode | Handler | Module | Auth | capGuard |
|---|---|---|---|---|---|
| `/api/quotes/:id/send-for-signature` | POST | `handleSendQuoteForSignature(request, env, auth, id)` | `./worker/quotes` | requireAuth | `invoices.write` (dans handler) |
| `/api/sign/:token/decline` | POST | `handlePublicDeclineDocument(request, env, token)` | `./worker/documents` | **PUBLIC** (hors auth) | aucun (token-borné) |

- **`send-for-signature`** : placée dans la section devis (APRÈS `/accept`
  spécifique, AVANT le générique `/api/quotes/:id` GET/PATCH). Path EXACT
  (`/^\/api\/quotes\/[a-zA-Z0-9_-]+\/send-for-signature$/`) — pas de chevauchement.
  Import dynamique `await import('./worker/quotes')` (calque `/accept`). capGuard
  **DANS le handler**.
- **`decline`** : déclarée **AVANT** le `/api/sign/:token` générique (l.887-889),
  dans le bloc PUBLIC pré-`requireAuth`. Path EXACT
  (`/^\/api\/sign\/([^/]+)\/decline$/`) — le générique `([^/]+)$` ne matche pas
  `/decline` (anti-shadowing garanti), mais on la pose AVANT par sûreté. Import
  dynamique `await import('./worker/documents')`.
- ⚠ Les routes `/api/quotes` (GET/POST), `/api/quotes/:id` (GET/PATCH),
  `/api/quotes/:id/accept`, `/api/sign/:token` (GET/POST), `/api/documents*`,
  `/api/sign-sms*` sont **INTOUCHÉES**.

### §6.E — Stubs (owned Manager-B, posés Phase A)

Signatures **FIGÉES Phase A**, corps Phase B.

```ts
// src/worker/quotes.ts — capGuard 'invoices.write' (mode-agence-only),
//   corps stub json({ data:{ document_id:'', sign_url:'' } }) + // Manager-B: corps réel
handleSendQuoteForSignature(request, env, auth: QuoteAuth, quoteId: string): Promise<Response>

// src/worker/documents.ts — PUBLIC (hors auth, calque handlePublicSignDocument),
//   PAS de capGuard, PAS de resolveClientId (token-borné),
//   corps stub json({ data:{ success:true } }) + // Manager-B: corps réel
handlePublicDeclineDocument(request, env, token: string): Promise<Response>
```

### §6.F — i18n (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, FIGÉ Phase A)

6 clés ADDITIVES ×4, **parité STRICTE**, insérées APRÈS `sign.warn.no_name` :
`sign.decline`, `sign.decline_confirm`, `proposal.send_for_sign`,
`proposal.sent_for_sign`, `proposal.signed`, `proposal.declined`. fr-CA
tutoiement / fr-FR vouvoiement. **Manager-B/C les CONSOMMENT, n'en AJOUTENT
PAS** (i18n GELÉ Phase A). ⚠ **NE PAS modifier les 15 clés `sign.*` existantes
ni les dupliquer.** Source VIVANTE = `src/lib/i18n/*.ts` (PAS `.json`).

### §6.G — Pricing HTML du devis (CRUCIAL Manager-B)

Dans `handleSendQuoteForSignature` (quotes.ts), Manager-B construit le `body_html`
du document de signature = une **pricing table** rendue SERVEUR depuis le devis :
- charger `loadQuoteScoped(env, quoteId, auth)` (borné tenant) + `SELECT * FROM
  quote_items WHERE quote_id = ?` ;
- recalculer/relire les totaux (`computeTotals` sur les lignes — TPS 5 %, TVQ
  9,975 %) ;
- rendre un HTML statique (table : 1 `<tr>` par ligne `label / qty / unit_price /
  line_total`, puis lignes **sous-total**, **TPS**, **TVQ**, **total**) — calque
  visuel `exportPiecePdf` `kind:'quote'` (`pdfExport.ts`, READ seulement, NON
  importé côté worker) ;
- créer le document via la **logique de `handleCreateDocument`** :
  `token = crypto.randomUUID()`, `expires_at` = +30 j, `INSERT INTO documents
  (… body_html=<pricing>, token, expires_at, quote_id=quoteId, created_by)`,
  status DEFAULT 'draft' ;
- `UPDATE quotes SET document_id = ?, status = 'sent', updated_at = datetime('now')
  WHERE id = ?` (⚠ `'sent'` DÉJÀ dans le CHECK seq 82) ;
- (option) appeler la logique de `handleSendDocument` / `handleSendSigningSms`
  pour expédier le lien email/SMS ;
- renvoyer `json({ data:{ document_id, sign_url:'/sign/'+token } })`.
- best-effort, bornage tenant, jamais 500 brut.

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned : **`src/worker/quotes.ts`** + **`src/worker/documents.ts`** —
  - **`quotes.ts` `handleSendQuoteForSignature`** (corps réel du stub) : charge le
    quote + items + taxes borné tenant (`loadQuoteScoped`), rend un `body_html`
    (pricing table : lignes, sous-total, TPS/TVQ, total — §6.G), crée un document
    lié via la logique de `handleCreateDocument` (`quote_id=quoteId`, token,
    expires), `UPDATE quotes SET document_id=?, status='sent'`. Renvoie
    `{ document_id, sign_url }`. Réutilise `handleSendDocument`/
    `handleSendSigningSms` pour l'envoi. capGuard `invoices.write` (déjà dans le
    stub). best-effort, jamais 500 brut.
  - **`documents.ts` `handlePublicSignDocument`** (ÉTENDRE) : SI `doc.quote_id` →
    APRÈS la signature (status `'won'`), appliquer la logique de
    `handleAcceptQuote` (accepte le devis → crée facture + `invoice_items` + notif)
    borné tenant. **best-effort** (try/catch ; échec facture ⇒ signature reste un
    succès), GARDER la réponse publique. ⚠ `quote_id` null ⇒ flux seq 11 INCHANGÉ.
  - **`documents.ts` `handlePublicDeclineDocument`** (corps réel du stub) : charge
    le doc par token (`status IN ('sent','viewed')`), vérifie expiration, `UPDATE
    documents SET status='declined', declined_at=datetime('now'), audit_trail` =
    append `{ action:'declined', ip, user_agent, timestamp, reason }` ; SI
    `doc.quote_id` → `UPDATE quotes SET status='declined', updated_at` (valeur DÉJÀ
    dans le CHECK seq 82) best-effort. PUBLIC, token-borné, PAS de capGuard, jamais
    500 brut. **NE PAS casser** le filtre sent/viewed de `handlePublicGetDocument`.
  - **NE PAS casser** : `handleCreateQuote`/`handleUpdateQuote`/`handleGetQuote`/
    `handleAcceptQuote` (appelable manuellement), `handleCreateDocument`/
    `handleSendDocument`/`handleSendSigningSms`/`handlePublicGetDocument`/
    `handlePublicSignDocument` (flux signature sans devis). `computeTotals`/
    `loadQuoteScoped`/`capGuard`/`nextNumber` réutilisés. + tests `__tests__/`.
- **Manager-C (frontend)** owned : **`src/pages/Quotes.tsx`** ∥ **`src/pages/SignDocument.tsx`** —
  - **`Quotes.tsx`** : bouton « Envoyer pour signature » (`proposal.send_for_sign`)
    → `sendQuoteForSignature(quoteId)` ; afficher le statut signature
    (`proposal.sent_for_sign`/`proposal.signed`/`proposal.declined`) + le lien
    public (`sign_url`) + le document lié (`quote.document_id`). **Additif — NE PAS
    casser la liste/édition de devis existante.**
  - **`SignDocument.tsx`** : afficher le **bloc pricing** si le document est issu
    d'un devis (`doc.quote_id` / données du `body_html` déjà rendu serveur) ;
    bouton « Refuser » (`sign.decline`, confirmation `sign.decline_confirm`) →
    `declinePublicDocument(token, { reason? })`. **Additif — NE PAS casser le
    canvas/signature existant.**
- **INTERDITS aux deux** : migration, manifest, **`src/lib/api.ts`** (`Document`/
  `Quote` types + `sendQuoteForSignature`/`declinePublicDocument` FIGÉS),
  **`src/lib/types.ts`**, **`src/worker.ts`**, **i18n ×4**, **`src/index.css`**,
  **`src/lib/pdfExport.ts`** / **`src/pages/Invoices.tsx`** /
  **`src/worker/conversations.ts`** (lecture/import SEULEMENT).
  **`quotes.ts` + `documents.ts` = Manager-B** (Manager-C ne les touche PAS) ;
  **`Quotes.tsx` + `SignDocument.tsx` = Manager-C** (Manager-B ne les touche PAS).
  **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **`quotes.status` CHECK FIGÉ (seq 82)** : `draft|sent|accepted|declined|expired`.
   La signature passe le devis en **`accepted`**, le refus en **`declined`** —
   valeurs **DÉJÀ permises**, RÉUTILISÉES. **JAMAIS `signed`/`viewed`** dans
   `quotes.status`, JAMAIS toucher le CHECK.
2. **`documents.status` LIBRE** (pas de CHECK, seq 11) : `'won'`=signé conservé.
   Le refus = `'declined'`. **NE PAS casser** le filtre `status IN ('sent',
   'viewed')` de `handlePublicGetDocument`/`handlePublicSignDocument`.
3. **Manifest seq 117 — chemin MANIFEST-DRIVEN.** Entrée seq 117 posée Phase A
   (NE PAS la modifier). `scripts/migrate.ts` FIGÉ. ✔ vérifié : virgule seq 116
   ajoutée, JSON valide.
4. **`ALTER TABLE … ADD COLUMN`, PAS de rebuild.** 3 colonnes TEXT NULLABLES, sans
   DEFAULT non-NULL, sans CHECK, sans FK ⇒ ajout in-place (zéro rebuild
   `documents`/`quotes`). **JAMAIS `CREATE TABLE documents`/`CREATE TABLE quotes`.**
5. **FK INTERDITES** : lien quote↔document APPLICATIF (`quote_id`/`document_id`
   TEXT). Zéro DROP / RENAME.
6. **Page publique = TOKEN** (calque `SignDocument.tsx`/`/api/sign/:token`, hors
   auth). `declinePublicDocument` via `apiFetch` (pattern public existant). PAS de
   resolveClientId/capGuard sur les routes publiques.
7. **Capture native Loi 25** : signature = canvas + nom + IP + UA + horodatage +
   hash SHA-256 + audit_trail (déjà en place dans `handlePublicSignDocument`).
   **PAS de DocuSign.** Le refus append aussi `{ action:'declined', ip, ua,
   timestamp }` à l'audit_trail.
8. **RÉUTILISER** `handleAcceptQuote` (logique : recalc taxes serveur depuis
   `quote_items` + INSERT facture + UPDATE devis ; appelable manuellement ET
   depuis la signature) / `handleCreateDocument` (token+expires) /
   `handleSendDocument`/`handleSendSigningSms` (envoi). **NE rien reconstruire,
   PAS de table `proposals`.**
9. **Signature→accept = best-effort** : si `doc.quote_id` et la facture échoue, la
   signature reste un succès — GARDER la réponse publique, jamais throw.
10. **BORNAGE TENANT** : `handleSendQuoteForSignature` via `loadQuoteScoped`
    (`resolveClientId`-équivalent, JAMAIS body). Routes publiques (sign/decline)
    bornées par token. UPDATE devis depuis la signature bornés par l'id du devis
    issu de `doc.quote_id`.
11. **Alias relatifs worker** (`./...`), front `@/`. Routes worker = import
    dynamique (calque `/api/quotes` / `/api/sign`).
12. **i18n `.ts` (PAS `.json`)** — parité stricte 6 clés ×4, GELÉE Phase A. **Les
    15 clés `sign.*` existantes INTOUCHÉES, NON dupliquées.**
13. **Capability** : `invoices.write` (devis = pièce pré-comptable). **ZÉRO ajout
    à `ALL_CAPABILITIES`.** Routes publiques sans capability (token-bornées).

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `migration-proposals-esign-seq117.sql` — 3 `ALTER TABLE ADD COLUMN`
   (`documents.quote_id`, `documents.declined_at`, `quotes.document_id` — TEXT
   NULLABLES, sans DEFAULT/CHECK/FK) + index `idx_documents_quote(quote_id)`,
   ADDITIF (calque en-tête seq 116). Zéro CHECK/FK/DROP/RENAME/rebuild. CHECK
   `quotes.status` INTOUCHÉ. Ne touche NI leads NI clients NI invoices NI
   quote_items.
2. `docs/LOT-PROPOSALS-ESIGN.md` — ce document (§6 FIGÉ).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `docs/migrations-manifest.json` — entrée seq 117 (virgule seq 116 ajoutée,
   JSON valide, `depends_on:["migration-telephony-disposition-seq116.sql"]`,
   objects `["alter:documents","alter:quotes","index:documents"]`, risk low).
2. `src/lib/api.ts` — `Document` ÉTENDU (`+quote_id` `+declined_at`) ; `Quote`
   ÉTENDU (`+document_id`) ; `sendQuoteForSignature(quoteId)` NEUF (POST
   `/quotes/:id/send-for-signature`) ; `declinePublicDocument(token, { reason? })`
   NEUF (POST `/sign/:token/decline` via apiFetch — pattern public existant).
   apiFetch/ApiResponse INCHANGÉS. AUCUN client_id envoyé.
3. `src/worker.ts` — 1 route protégée `POST /api/quotes/:id/send-for-signature`
   → `handleSendQuoteForSignature` (import dynamique, capGuard dans handler, path
   exact APRÈS `/accept`) ; 1 route PUBLIQUE `POST /api/sign/:token/decline` →
   `handlePublicDeclineDocument` (import dynamique, AVANT `/api/sign/:token`
   générique). Routes existantes INTOUCHÉES.
4. `src/worker/quotes.ts` — stub `handleSendQuoteForSignature(request, env, auth,
   quoteId)` (signature FIGÉE, capGuard `invoices.write`, corps stub
   `json({ data:{ document_id:'', sign_url:'' } })` + `// Manager-B: corps réel`).
   RÉUTILISE `capGuard` existant. Reste du fichier INTOUCHÉ.
5. `src/worker/documents.ts` — stub `handlePublicDeclineDocument(request, env,
   token)` (signature FIGÉE, PUBLIC sans capGuard, corps stub
   `json({ data:{ success:true } })` + `// Manager-B: corps réel`). Reste du
   fichier INTOUCHÉ.
6. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 6 clés ADDITIVES (`sign.decline`,
   `sign.decline_confirm`, `proposal.send_for_sign`, `proposal.sent_for_sign`,
   `proposal.signed`, `proposal.declined`) après `sign.warn.no_name`, parité
   stricte ×4, fr-CA tutoiement / fr-FR vouvoiement. Les 15 clés `sign.*`
   existantes INTOUCHÉES.

**Migration** : seq 117 ADDITIVE, manifestée (manifest-driven). **Build** : non
vérifié (VMware sans bun/node) — **délégué côté hôte**.

### Confirmations garde-fous
- **Migration ADDITIVE** : 3 `ALTER ADD COLUMN` (TEXT NULLABLES) + 1 index, zéro
  CHECK/FK/DROP/RENAME/rebuild, zéro `CREATE TABLE`, CHECK `quotes.status`
  INTOUCHÉ. Manifest seq 117 (depends_on seq 116) valide.
- **Existant INTOUCHÉ** : devis (`handleCreateQuote`/`handleUpdateQuote`/
  `handleGetQuote`/`handleAcceptQuote`) + e-signature (`handleCreateDocument`/
  `handleSendDocument`/`handleSendSigningSms`/`handlePublicGetDocument`/
  `handlePublicSignDocument`) + `pdfExport`/`Invoices.tsx` — lecture/réutilisation.
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **Capability** `invoices.write` (devis) RÉUTILISÉE — **ZÉRO ajout à
  `ALL_CAPABILITIES`**. Routes publiques token-bornées sans capability.
- **Loi 25** : capture native (canvas+nom+IP+UA+horodatage+hash SHA-256+
  audit_trail) déjà en place — PAS de DocuSign.
- **i18n** : source VIVANTE `src/lib/i18n/*.ts`, parité 6 clés ×4, 15 clés `sign.*`
  existantes intouchées et non dupliquées.

### Écarts CODE > brief
- **`declinePublicDocument` utilise `apiFetch`, PAS `fetch` brut** : le brief
  suggérait « fetch BRUT public », mais le CODE réel de `SignDocument.tsx` appelle
  la signature publique via `apiFetch('/sign/'+token, …)` (et non `fetch` brut sur
  `${API_BASE}`). Pour CALQUER fidèlement le helper public de signature existant,
  `declinePublicDocument` utilise `apiFetch` (qui préfixe `/api`, cible la route
  publique `/api/sign/:token/decline`, hors auth). CODE > brief, parité avec
  l'appel public existant.
- **`documents.lead_id` NULLABLE / devis sans lead** : `handleCreateDocument`
  exige `lead_id` ; un devis peut ne pas avoir de `lead_id`. Manager-B RÉUTILISE
  la LOGIQUE (token+expires+INSERT), pas le handler tel quel, et gère le cas
  `quote.lead_id` null (body_html direct sans interpolation lead — `documents.
  lead_id` NULLABLE seq 11).
- **Signature→accept sans `QuoteAuth`** : le webhook public de signature n'a pas
  d'auth applicative → Manager-B borne par le devis (`quote.id` issu de
  `doc.quote_id`), PAS via `capGuard` ; il réutilise la LOGIQUE de
  `handleAcceptQuote` (recalc taxes serveur + facture + UPDATE devis), best-effort.
- **Route `decline` placée AVANT `/api/sign/:token`** : le générique `([^/]+)$` ne
  matche techniquement pas `/decline`, mais la route exacte est posée AVANT par
  sûreté (anti-shadowing explicite, conforme au brief).
- **Stub `handleSendQuoteForSignature` retourne 200** (`{ data:{ document_id:'',
  sign_url:'' } }`) ; le corps réel pourra renvoyer 200 (le document est créé mais
  l'action est un « envoi », pas une création de ressource REST canonique côté
  devis — choix Manager-B).
