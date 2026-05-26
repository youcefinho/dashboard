# ESC-POS-PRINTER — Sprint 37 POS retail caisse

> Politique d'impression thermique 80mm / 58mm pour reçus POS du Sprint 37.
> Date : 2026-05-24. Version : 1.0. Sprint : 37.
> Compagnon de [`LOT-POS-S37.md`](LOT-POS-S37.md) (§6 contrat inter-agent), [`LOT-TEAM-BC.md`](LOT-TEAM-BC.md) (capabilities `clients.manage` + `reports.view` figées seq80) et [`EMBED-SECURITY-S36.md`](EMBED-SECURITY-S36.md) (structure calquée).
> Référence pour `buildEscPosBytes` / `buildReceiptHtml` / `buildReceiptPdfStub` / `uploadReceiptToR2` ([`src/worker/lib/pos-receipt.ts`](../src/worker/lib/pos-receipt.ts), Phase A SOCLE A2 implémenté 2026-05-24).

---

## §1 Vue d'ensemble

Le sous-système d'impression POS Sprint 37 sert **trois objectifs distincts** à partir d'un même `ReceiptPayload` typé :

- **Aperçu écran + email HTML** — preview avant impression dans la modale `POSReceiptPreview`, et corps d'email pour l'envoi reçu client (consent Loi 25 requis).
- **Impression thermique réseau IP** — flux binaire ESC/POS envoyé directement à une imprimante thermique 80mm (ou 58mm) sur LAN tenant, port 9100 (raw TCP socket protocol standard).
- **Téléchargement PDF + archive R2** — stub PDF (HTML bytes UTF-8 en Phase A — vraie génération PDF Sprint 40+) destiné au download client et à l'archive fiscale 6 ans dans R2.

**Format reçu thermique 80mm = 42 colonnes ESC/POS** (largeur de référence Epson TM-T20III / TM-T88VI / Star TSP143). Variante 58mm = 32 colonnes (Bixolon SRP-150, mobile printers Bluetooth). Le choix de largeur est driven par `pos_registers.printer_config_json.width_mm`.

**Charset français** : CP858 (multilingual Latin-1 + €, supporté par toutes les imprimantes ESC/POS modernes) est le défaut. Fallback CP1252 (Bixolon SRP-330II) ou UTF-8 natif (Star TSP143IIIU en Star Mode) selon `printer_config_json.charset`. La conversion UTF-8 → CP858 n'est PAS encore implémentée en Phase A (TextEncoder Web Worker ne fait que UTF-8 spec WHATWG) — les caractères ASCII passent intacts, les accentués passent en UTF-8 multi-byte (l'imprimante peut afficher des mojibake si elle est en mode CP858 strict).

**Régression-zéro ecommerce** : aucune dépendance à `ecommerce-orders.ts` / `ecommerce-tax-engine.ts`. La lib pos-receipt **reçoit** un `ReceiptPayload` déjà calculé par Manager-B (lui-même issu de `createOrderCore` + `commitOrderSale` + `computeTax({regime:'qc'})` verbatim).

---

## §2 Architecture `pos-receipt.ts`

Fichier source : [`src/worker/lib/pos-receipt.ts`](../src/worker/lib/pos-receipt.ts) (Phase A SOCLE A2 — contrat FIGÉ §6 `LOT-POS-S37.md`).

### 2.1 Exports

| Fonction | Input | Output | Usage |
|----------|-------|--------|-------|
| `buildReceiptHtml` | `ReceiptPayload` + `ReceiptLocale` | `string` (HTML CSS inline) | Preview écran modale `POSReceiptPreview` + email body reçu client |
| `buildEscPosBytes` | `ReceiptPayload` | `Uint8Array` | Envoi imprimante thermique IP port 9100 (chemin B avancé) ou WebUSB (chemin A) |
| `buildReceiptPdfStub` | `ReceiptPayload` + `ReceiptLocale` | `Promise<Uint8Array>` | PDF download (stub : HTML bytes UTF-8 en attendant `pdf-lib` WASM Sprint 40+) |
| `uploadReceiptToR2` | `env` + `clientId` + `txId` + `pdfBytes` | `Promise<{ r2Key }>` | Upload R2 best-effort archive reçus 6 ans fiscal QC |

### 2.2 Types contrat figés

```ts
interface ReceiptItem {
  title: string;
  variant_title?: string;
  sku?: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

interface ReceiptTaxLine {
  label: string;        // ex: "TPS 5%", "TVQ 9.975%"
  rate: number;         // ex: 0.05, 0.09975
  amount_cents: number;
}

interface ReceiptPayload {
  tenantName: string;
  transactionId: string;
  orderNumber: string;
  placedAt: string;     // ISO 8601
  items: ReceiptItem[];
  subtotalCents: number;
  taxLines: ReceiptTaxLine[];
  totalCents: number;
  paymentMethod: 'cash' | 'card_terminal' | 'gift_card' | 'other' | 'split';
  tenderedCents?: number;
  changeCents?: number;
  cashierName: string;
  registerName: string;
}

type ReceiptLocale = 'fr-CA' | 'fr-FR' | 'en' | 'es';
```

### 2.3 i18n labels

Hardcodé local (4 locales × 16 clés = 64 entrées) dans `LABELS` constant. Fallback `fr-CA` si locale inconnue. Parité STRICTE des 4 dictionnaires — la suppression / renommage d'une clé est BREAKING.

### 2.4 Helpers privés

- `escapeHtml(input)` — anti-XSS strict sur tous champs visiteur (calque `sanitizeHtml()` de `helpers.ts`, isolé pour autonomie de la lib).
- `formatCents(cents, locale)` — formatte en `"X,XX$"` (fr) ou `"X.XX$"` (en), symbole `$` à droite (convention QC/CA), 2 décimales.
- `formatDate(iso, locale)` — formatte ISO 8601 en `"DD/MM/YYYY HH:mm"` (fr/es) ou `"YYYY-MM-DD HH:mm"` (en), sans dépendance `Intl` (Worker-safe).

---

## §3 Commandes ESC/POS implémentées

`buildEscPosBytes` génère un flux binaire séquentiel via des `Uint8Array` chunks concaténés. Les commandes ESC/POS suivantes sont émises :

| Commande | Bytes | Description |
|----------|-------|-------------|
| Reset (init imprimante) | `0x1B 0x40` (ESC @) | Réinitialise l'imprimante (purge tampon, reset mode) |
| Charset CP858 | `0x1B 0x74 0x13` (ESC t 19) | Sélectionne codepage 19 = CP858 (multilingual Latin-1 + €) |
| Align left | `0x1B 0x61 0x00` (ESC a 0) | Texte aligné à gauche |
| Align center | `0x1B 0x61 0x01` (ESC a 1) | Texte centré |
| Align right | `0x1B 0x61 0x02` (ESC a 2) | Texte aligné à droite (non utilisé en Phase A) |
| Bold ON | `0x1B 0x45 0x01` (ESC E 1) | Activation gras |
| Bold OFF | `0x1B 0x45 0x00` (ESC E 0) | Désactivation gras |
| Feed line | `0x0A` (LF) | Saut de ligne simple |
| Cut paper full | `0x1D 0x56 0x00` (GS V 0) | Coupe complète du papier (cutter automatique) |

### 3.1 Commandes ESC/POS non encore utilisées (Phase B+)

| Commande | Bytes | Usage futur |
|----------|-------|-------------|
| Double height/width | `0x1B 0x21 n` (ESC ! n, n=0x30 = 2x both) | TOTAL en 2x hauteur sur grands montants |
| Cut partial | `0x1D 0x56 0x01` (GS V 1) | Coupe partielle (laisse un point d'attache) |
| Margin left | `0x1D 0x4C nL nH` (GS L) | Marge gauche pour reçus encadrés |
| Barcode 1D CODE128 | `0x1D 0x6B 0x49 ...` (GS k 73 ...) | Code-barres transaction sur reçu |
| QR code 2D | `0x1D 0x28 0x6B ...` (GS ( k ...) | QR de retour produit ou pourboire |
| Drawer kick | `0x1B 0x70 0x00 ...` (ESC p 0 ...) | Ouverture tiroir-caisse électronique |
| Bitmap logo | `0x1D 0x76 0x30 ...` (GS v 0 ...) | Logo tenant en raster (à uploader 1x via init) |

### 3.2 Séquence canonique Phase A

```
ESC @                          ; reset
ESC t 19                       ; charset CP858
ESC a 1                        ; center align
ESC E 1                        ; bold ON
"<tenantName>\n"
ESC E 0                        ; bold OFF
"\n"
ESC a 0                        ; left align
"<L.transaction>: <id>\n"
"<L.order>: <num>\n"
"<L.date>: <DD/MM/YYYY HH:mm>\n"
"------------------------------------------\n"

; Par item
"<title>[ (variant)]\n"
"  <qty> x <unit>           <total>\n"

"------------------------------------------\n"
"<L.subtotal>                       <subtotal>\n"
"<TPS 5%>                              <tps>\n"
"<TVQ 9.975%>                          <tvq>\n"
"------------------------------------------\n"
ESC E 1                        ; bold ON
"<L.totalDue>                          <total>\n"
ESC E 0                        ; bold OFF
"------------------------------------------\n"

"<L.payment>                         <method>\n"
; Si cash :
"<L.tendered>                        <tendered>\n"
"<L.change>                          <change>\n"

"------------------------------------------\n"
ESC a 1                        ; center align
"<L.cashier>: <name>\n"
"<L.register>: <name>\n"
"<DD/MM/YYYY HH:mm>\n"
"\n\n\n"                       ; feed 3 lines

GS V 0                         ; full cut
```

---

## §4 Workflow d'impression

### 4.1 Flow nominal (vente cash)

1. POS terminal Phase C finalise la transaction côté UI :
   - User entre tendered cash dans modale paiement.
   - `POST /api/pos/transactions` avec body `{ session_id, payment_method: 'cash', tendered_cents, items, ... }`.
2. Handler back `handleCreatePosTransaction` (Phase B Manager-B) :
   - Appelle `createOrderCore()` + `commitOrderSale()` (verbatim ecommerce E1).
   - Insère `pos_transactions` row.
   - Construit `ReceiptPayload` à partir de l'order finalisé.
   - Optionnel : appelle `buildReceiptPdfStub` + `uploadReceiptToR2` → `receipt_url` stocké en DB.
   - Retourne `{ data: { transaction, receipt_url, receipt_html } }` au front.
3. Frontend ouvre `POSReceiptPreview` modal :
   - Affiche le HTML preview via `dangerouslySetInnerHTML` (HTML pré-escaped par `buildReceiptHtml`, safe).
   - 3 boutons : **Imprimer**, **Email client**, **Télécharger PDF**.
4. User click **Imprimer** → 2 chemins possibles :

### 4.2 Chemin A — `window.print()` CSS @media print (Phase A wired)

**Recommandé pour le démarrage.** Aucune dépendance hardware, aucun secret tenant à configurer, marche avec n'importe quelle imprimante OS (USB, réseau standard, AirPrint, Bluetooth driver).

- Le HTML du reçu est encapsulé dans une `iframe` cachée, ou injecté dans un `window.open()`.
- CSS `@media print` scope le rendu à 80mm de large via `@page { size: 80mm auto; margin: 0; }`.
- `window.print()` déclenche le dialogue d'impression OS.
- User sélectionne son imprimante installée (thermique ou laser/inkjet — le rendu fonctionne sur les deux).

**Avantages** : zero config tenant, marche cross-OS, marche cross-imprimante, debug visuel facile.

**Limites** : dialogue d'impression visible (~2-3s pour user), pas de cut auto sur imprimante laser, pas de drawer kick.

### 4.3 Chemin B — POST worker `/api/pos/print` + raw TCP socket (avancé, TODO Sprint Observabilité)

**Pour usage production retail intensif.** Impression "silencieuse" sans dialogue, cut auto, drawer kick possible.

- Frontend POST `/api/pos/print` avec body `{ transaction_id, register_id }`.
- Worker lit `pos_transactions.receipt_url` (R2) + `pos_registers.printer_config_json` (IP + port + charset).
- Worker reconstruit le `ReceiptPayload` depuis l'order/transaction, appelle `buildEscPosBytes(payload)`.
- Worker ouvre un raw TCP socket vers `${printer_config.ip}:${printer_config.port}` via [Cloudflare Workers TCP API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) (`connect()` de `cloudflare:sockets`).
- Worker envoie les bytes ESC/POS, attend ACK (ou timeout 3s), ferme la socket.
- Retourne `{ data: { success: true, bytes_sent: N } }`.

**Avantages** : impression silencieuse, cut auto, performances retail.

**Limites** : nécessite IP statique imprimante + port 9100 ouvert + worker TCP API enabled (binding `compatibility_flags: ["nodejs_compat", "tcp_socket"]`).

### 4.4 Statut Phase A

**Seul chemin A (`window.print()`) est wired en Sprint 37.** Le chemin B est documenté ici mais n'est PAS implémenté — TODO Sprint Observabilité (S38+). La lib `buildEscPosBytes` existe et est testable unitairement, mais aucun consommateur worker n'est câblé.

---

## §5 Configuration imprimante (`printer_config_json`)

### 5.1 Stockage

Colonne `pos_registers.printer_config_json TEXT DEFAULT '{}'` (migration seq132, lignes 35-37). JSON arbitraire parsé côté handler (validation enums SIDE-HANDLER — calque LOT-CHAT-WIDGET-S36 §6).

### 5.2 Format proposé

```json
{
  "type": "thermal_ip",
  "ip": "192.168.1.100",
  "port": 9100,
  "width_mm": 80,
  "charset": "cp858",
  "auto_cut": true,
  "drawer_kick": false,
  "logo_uploaded": false,
  "vendor_id": "0x04b8",
  "product_id": "0x0e15"
}
```

### 5.3 Champs

| Champ | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `'thermal_ip' \| 'thermal_usb' \| 'browser_print'` | `'browser_print'` | Mode de sortie principal pour cette caisse |
| `ip` | `string` | — | IP statique imprimante LAN (si `type=thermal_ip`) |
| `port` | `number` | `9100` | Port TCP raw socket ESC/POS standard |
| `width_mm` | `58 \| 80` | `80` | Largeur papier — détermine COLS (32 ou 42) |
| `charset` | `'cp858' \| 'cp1252' \| 'utf8'` | `'cp858'` | Codepage envoyé via `ESC t n` |
| `auto_cut` | `boolean` | `true` | Émet `GS V 0` (full cut) ou `GS V 1` (partial) en fin de reçu |
| `drawer_kick` | `boolean` | `false` | Émet `ESC p 0 ...` pour ouvrir tiroir-caisse électronique |
| `logo_uploaded` | `boolean` | `false` | Si `true`, émet `FS p 1 0` (print logo stocké en NVRAM) en début de reçu |
| `vendor_id` / `product_id` | `string` (hex) | — | Identifiants WebUSB (si `type=thermal_usb`, Phase C frontend) |

### 5.4 Fallback

Si `printer_config_json` est `'{}'` (default) ou `type='browser_print'` ou invalide → **fallback `window.print()`** (chemin A, §4.2). Aucune erreur ne remonte au user — le bouton "Imprimer" fonctionne toujours, juste avec un dialogue OS au lieu d'une impression silencieuse.

---

## §6 Spec PDF future

### 6.1 Stub actuel (Phase A SOCLE A2)

`buildReceiptPdfStub` retourne **les bytes UTF-8 du HTML** du reçu — pas un vrai PDF. Permet de :

- Wire le pipeline complet (frontend bouton "Télécharger PDF" → blob download → user save).
- Tester `uploadReceiptToR2` (l'upload R2 fonctionne avec des bytes arbitraires).
- Valider le flow end-to-end sans bloquer Sprint 37 sur la dépendance `pdf-lib`.

Le navigateur télécharge le fichier `.pdf` mais l'ouverture montrerait du HTML (selon le visualiseur). En attendant la vraie implémentation, on peut renommer en `.html` côté UI download si l'expérience est jugée trop trompeuse.

### 6.2 Implémentation cible Sprint 40+

**Option recommandée : `pdf-lib` WASM-compatible Worker**

- Lib : [`pdf-lib`](https://pdf-lib.js.org/) — pure JS, ~150 KB gzipped, Worker-compatible.
- Approche : générer le PDF à partir du `ReceiptPayload` (texte, lignes, montants, logo optionnel) directement sans passer par HTML.
- Format : 80mm × hauteur dynamique (estimée ~120-200mm selon nombre d'items).
- Police : embeddée (`StandardFonts.Helvetica` ou `StandardFonts.Courier` pour le look reçu thermique).
- Signature : remplace `buildReceiptPdfStub` par `buildReceiptPdf` (même signature, vrai PDF bytes).

**Option alternative : browser print to PDF**

- Côté frontend uniquement : `window.print()` avec `<meta media="print">` + le user sélectionne "Save as PDF" dans le dialogue OS.
- Avantage : zero dépendance backend.
- Limite : nécessite action user manuelle, pas adapté à l'archive R2 automatique post-transaction.

**Option fallback : service externe**

- API HTML-to-PDF (Browserless, CloudConvert, etc.) — proscrit pour PII Loi 25 (le payload contient nom + email visiteur).

### 6.3 Migration Phase A → vraie PDF

Zéro breaking change côté API : la signature `buildReceiptPdfStub` retourne déjà `Promise<Uint8Array>`. Le rename en `buildReceiptPdf` + l'implémentation `pdf-lib` se fait en backward-compat — les consommateurs n'auront qu'à changer le nom d'import.

---

## §7 ESC/POS pour 58mm (variant)

### 7.1 Différences avec 80mm

| Paramètre | 80mm | 58mm |
|-----------|------|------|
| Largeur papier | 80mm | 58mm |
| Caractères / ligne (police normale) | **42** | **32** |
| Caractères / ligne (police condensée `ESC M 1`) | 56 | 42 |
| Imprimantes typiques | Epson TM-T20III/T88VI, Star TSP143, Bixolon SRP-330 | Bixolon SRP-150, Star SM-S210i, Sewoo LK-P21 |
| Usage | Retail desktop fixe | Mobile / vendor bluetooth / pop-up store |

### 7.2 Implémentation Phase A

`buildEscPosBytes` hardcode `const COLS = 42;` (ligne 324 de `pos-receipt.ts`). **Phase B C4 à étendre** :

```ts
export function buildEscPosBytes(
  payload: ReceiptPayload,
  config?: { width_mm?: 58 | 80; charset?: 'cp858' | 'cp1252' | 'utf8' },
): Uint8Array {
  const COLS = config?.width_mm === 58 ? 32 : 42;
  const CHARSET_BYTE = config?.charset === 'cp1252' ? 16 : 19;  // 19 = CP858
  // ... reste identique
}
```

### 7.3 Layout 58mm — adaptations

- **Header tenant** : si nom > 32 chars, wrap sur 2 lignes ou activer condensé `ESC M 1` (12 cpi au lieu de 10 cpi).
- **Items** : title sur 1 ligne tronquée à 32 chars (vs 42), qty/unit/total sur ligne suivante (déjà le cas en Phase A).
- **Totaux** : labels raccourcis (`"S-Total"` au lieu de `"Sous-total"`, `"Mon."` au lieu de `"Monnaie"`) si nécessaire — TODO Phase B.

### 7.4 Helper séparé ou paramètre ?

**Décision Phase A** : paramètre optionnel `config` sur `buildEscPosBytes` (calque l'idiome `formatCents(cents, locale)`). Évite la duplication de 90% du code entre `buildEscPosBytes` et un hypothétique `buildEscPosBytes58mm`.

---

## §8 Tests imprimante terrain

Checklist tenant déploiement (avant activation production d'une caisse retail) :

- [ ] **Imprimante connectée** au même réseau LAN que le device POS (caisse iPad / laptop / PC Windows). Test ping : `ping <imprimante-ip>` depuis le device POS.
- [ ] **IP statique configurée** sur l'imprimante (via DHCP reservation côté routeur OU configuration manuelle de l'imprimante). Une IP dynamique qui change casse l'impression silencieuse.
- [ ] **Port 9100 ouvert** (TCP raw socket protocol standard ESC/POS). Vérifier firewall LAN + firewall de l'imprimante elle-même. Test : `nc -v <ip> 9100` doit ouvrir la connexion.
- [ ] **Test impression via curl/nc** :
  ```bash
  printf '\x1B@Hello, monde !\n\x1DV\x00' | nc 192.168.1.100 9100
  ```
  Doit imprimer "Hello, monde !" puis couper. Si rien ne sort → vérifier IP/port. Si caractères mojibake → vérifier charset.
- [ ] **Charset CP858 vs Latin-1 vérifié** — imprimer un reçu de test contenant `é à ç ô ù €`. Tous les caractères doivent s'afficher correctement (pas de `?` ni de `Ã©`).
- [ ] **Cutter testé** — papier coupé proprement après chaque reçu (pas de blocage, pas de papier déchiré).
- [ ] **Vitesse acceptable** — un reçu de 10 items doit s'imprimer en < 3 secondes (Epson TM-T20III : 200 mm/s, TM-T88VI : 350 mm/s).
- [ ] **Test multi-reçus consécutifs** — imprimer 5 reçus d'affilée, vérifier qu'il n'y a pas de tampon plein / freeze imprimante.
- [ ] **Test reprise après coupure** — éteindre/rallumer l'imprimante, relancer impression immédiate. Doit fonctionner sans relancer le worker.
- [ ] **Drawer kick (si applicable)** — si tiroir-caisse électronique branché RJ11/RJ12 sur l'imprimante, vérifier `printer_config_json.drawer_kick: true` et tester l'ouverture sur transaction cash.

---

## §9 Erreurs courantes

| Erreur | Symptôme | Cause | Fix |
|--------|----------|-------|-----|
| Texte mojibake | `é` → `Ã©` ou `?` ou caractère bloc | Charset incompatible entre stream et imprimante | Vérifier ESC `t 19` (CP858) avant texte. Si imprimante ne supporte que CP1252, basculer `printer_config_json.charset: 'cp1252'` (envoie `ESC t 16`). Si Star Mode UTF-8 natif, basculer `'utf8'` et skip `ESC t`. |
| Pas de coupe papier | Reçu imprimé mais papier non coupé, file d'attente | `GS V 0` absent ou imprimante sans cutter automatique | Vérifier `printer_config_json.auto_cut: true`. Vérifier modèle d'imprimante (certains low-end Bixolon n'ont pas de cutter). Si pas de cutter hardware, désactiver `auto_cut` pour éviter erreur. |
| Imprimante muette | Aucune impression, pas d'erreur visible | IP ou port incorrect / firewall / imprimante éteinte / câble Ethernet débranché | `curl` test (§8) pour isoler. Check firewall LAN. Check IP statique vs DHCP. Check imprimante power on + ready light. |
| Reçu trop large / coupé sur le côté | Texte tronqué, alignement cassé | `width_mm` mauvais (80 envoyé à 58mm ou vice-versa) | Ajuster `printer_config_json.width_mm` à la vraie largeur du papier installé. Recalcul automatique de `COLS` (32 ou 42). |
| Reçu vide ou ne fait que sortir du papier | Bytes envoyés mais flux non interprété | Imprimante en mode "raw text" au lieu de "ESC/POS" (cas Star) | Pour Star : vérifier que l'imprimante est en mode ESC/POS via DIP switches arrière, pas Star Mode. Sinon : utiliser le binaire Star spécifique. |
| Erreur TCP socket "connection refused" | Worker error log `connect ECONNREFUSED 192.168.1.100:9100` | Port 9100 fermé / imprimante en veille profonde | Réveiller imprimante (envoyer un job test depuis OS). Si en veille auto, désactiver la veille dans config imprimante. |
| Pages blanches en sortie | Plusieurs pages vides après le reçu | Trop de `\n` en fin avant `GS V 0` | Limiter à 3 line feeds (`\n\n\n`) avant le cut, pas 10 (calque Phase A `pos-receipt.ts:406`). |
| Drawer ne s'ouvre pas | Pas d'ouverture tiroir-caisse sur cash | RJ11/RJ12 non câblé ou commande non émise | Vérifier câble physique RJ11 imprimante ↔ tiroir. Vérifier `printer_config_json.drawer_kick: true`. Tester avec `printf '\x1B\x70\x00\x32\x96' | nc <ip> 9100`. |

---

## §10 Sécurité réseau

### 10.1 TCP raw socket = trafic plaintext

Le protocole ESC/POS sur port 9100 est **non chiffré**. Les bytes du reçu (donc nom client si présent, montant, items) transitent en clair sur le LAN tenant. Acceptable si :

- Le réseau LAN tenant est sécurisé (Wi-Fi WPA2+ ou Ethernet câblé).
- Aucun device tiers non-fiable n'est sur le même VLAN que l'imprimante.

### 10.2 Pas d'auth côté imprimante

Les imprimantes thermiques ESC/POS n'ont **pas de mécanisme d'authentification réseau**. N'importe quel device sur le LAN peut envoyer des bytes au port 9100 et imprimer. **Mitigations** :

- Isoler les imprimantes sur un VLAN dédié POS, accessible uniquement depuis les devices POS et le worker Cloudflare (via tunnel si chemin B activé).
- Désactiver les imprimantes hors-heures via switch managé (cron LAN admin).
- Auditer les jobs imprimés via logs imprimante (Epson firmware expose un endpoint statut).

### 10.3 Cloud printers / internet printers

**Hors scope Sprint 37.** Pour imprimer depuis Cloudflare worker vers une imprimante située sur un LAN tenant distant (sans tunnel direct), utiliser un service relais :

- **PrintNode** — service cloud commercial, agent local installable, API HTTP propre. ~$10/mois par imprimante.
- **Google Cloud Print** — **DEPRECATED 2020**, ne pas utiliser.
- **CUPS web interface + tunnel Cloudflare** — option self-hosted complexe.
- **Star CloudPRNT** — protocole pull-based propriétaire Star, l'imprimante poll un endpoint HTTPS pour récupérer ses jobs.

Recommandé pour Sprint 38+ si besoin client cloud printing : intégrer PrintNode (handler dédié `/api/pos/print/printnode` qui POST sur `https://api.printnode.com/printjobs` avec le PDF en base64).

### 10.4 Données reçu = PII Loi 25

Le `ReceiptPayload` contient `cashierName` (= prénom employé) et potentiellement `orderNumber` lié à un `orders.id` qui contient `customer_email`. **Pas de PII brute dans les logs worker** :

- `audit(env, ..., 'pos.receipt.printed', 'pos_transaction', tx_id, { register_id, payment_method })` — pas de `cashierName` ni `customerEmail` en clair.
- Les bytes ESC/POS envoyés sur le LAN sont éphémères (pas stockés worker-side après émission).
- Le PDF archivé en R2 contient les PII (nécessaire pour archive fiscale 6 ans QC) — protégé par URL signée 5 min (`uploadReceiptToR2` retourne `r2Key`, l'URL signée est générée à la demande).

### 10.5 Checklist sécurité réseau

- [ ] VLAN POS isolé des autres VLANs tenant (guest Wi-Fi, IoT).
- [ ] Pas d'imprimante exposée sur internet (test : `nmap -p 9100 <ip-publique-tenant>` doit retourner closed/filtered).
- [ ] Firewall worker → imprimante : whitelist IP source worker uniquement (si chemin B activé via Cloudflare Tunnel).
- [ ] Logs imprimante revus mensuellement (firmware Epson : `http://<ip>/PRESENTATION/ADVANCED/LIST/TOP`).
- [ ] PDFs R2 accédés uniquement via URLs signées 5 min (pas de bucket public).
- [ ] Audit log POS purgé selon politique tenant (rétention 6 ans pour audit fiscal QC, ensuite delete).

---

## §11 Références

- [`LOT-POS-S37.md`](LOT-POS-S37.md) — Contrat inter-agent Sprint 37 + matrice routes/handlers + types figés.
- [`EMBED-SECURITY-S36.md`](EMBED-SECURITY-S36.md) — Structure markdown calquée (§1-§11).
- [`src/worker/lib/pos-receipt.ts`](../src/worker/lib/pos-receipt.ts) — Implémentation Phase A SOCLE A2 (4 exports figés).
- [`migration-pos-seq132.sql`](../migration-pos-seq132.sql) — Schéma `pos_registers.printer_config_json` (ligne 37).
- [`src/worker/ecommerce-orders.ts`](../src/worker/ecommerce-orders.ts) — `createOrderCore` + `commitOrderSale` (verbatim, jamais modifié Sprint 37).
- [`src/worker/ecommerce-tax-engine.ts`](../src/worker/ecommerce-tax-engine.ts) — `computeTax({regime:'qc'})` (TPS 5% + TVQ 9.975% séparés).
- [Cloudflare Workers TCP API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) — `connect()` de `cloudflare:sockets` (chemin B futur).
- [ESC/POS Command Reference (Epson)](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/index.html) — Référence officielle ESC/POS canonique.
- [`pdf-lib`](https://pdf-lib.js.org/) — Lib PDF Worker-compatible (cible Sprint 40+ pour `buildReceiptPdf` vraie impl).
- [PrintNode API](https://www.printnode.com/en/docs/api/curl) — Service cloud printing recommandé pour Sprint 38+.
- [Loi 25 (Québec) art. 12 et 27-28](https://www.legisquebec.gouv.qc.ca/fr/document/lc/p-39.1) — PII reçus + rétention fiscale 6 ans.
