# LOT G9 — White-label custom domain (squelette transverse)

> Source de vérité figée Phase A SOLO. Phase B (Manager-B backend) et Phase C
> (Manager-C front) ne lisent QUE ce document + le CODE. Le §6 ci-dessous est
> recopié VERBATIM du cadrage Chaman READ-ONLY (le code fait foi).

---

## §0 — AUDIT DISQUE (confirmé, code fait foi)

- `clients.branding / logo_url / primary_color / accent_color` existent (seq 81
  LOT C), gérés par `clients-admin.ts` (`handleGetClientBranding` /
  `handleUpdateClientBranding`, routes `worker.ts:941-943`). **INTOUCHÉ.**
- `agencies.custom_domain` existe (seq 19) mais legacy NON-ROUTÉ — **NON TOUCHÉ.**
  Le mapping white-label v1 vit dans la table compagnon NEUVE `custom_hostnames`.
- from email hardcodé `Intralys CRM <noreply@intralys.com>` (`workflows.ts:614,622`).
  **INTOUCHÉ Phase A** — branchement `resolveFromAddress` gardé flag = Phase B.
- Résolution tenant (POINT CHAUD) : `worker.ts:811-835` `requireAuth` →
  `resolveTenantContext(env, userId, role, X-Sub-Account)` — par IDENTITÉ user,
  JAMAIS hostname. `tenant-context.ts` NE THROW JAMAIS (dégrade legacy).
- Flags : `Env` (`types.ts:4`) héberge flags string. Namespace i18n `whitelabel.*`
  LIBRE (confirmé, zéro collision). Onglet Settings `branding` = point d'extension UI.
- seq libre = **94** (manifest dernière = 93 community).

---

## §6.A — ARCHITECTURE (tranché)

- Table compagnon ADDITIVE `custom_hostnames(id, client_id, agency_id, hostname,
  status TEXT DEFAULT 'pending', dkim_status TEXT DEFAULT 'pending', provider_ref,
  created_at, updated_at)`. Stockage sur le tenant (`client_id`), `agency_id`
  nullable. **Zéro FK.**
- **Provisioning Cloudflare for SaaS = FLAG INACTIF** `env.WHITELABEL_PROVISIONING_ENABLED` :
  si `!== 'true'` → statut reste `pending`, AUCUN appel réseau (helper
  `provisionCustomHostname` = no-op retournant `{status:'pending'}`).
- **DKIM / from par tenant = FLAG INACTIF** `env.WHITELABEL_DKIM_ENABLED` :
  helper `resolveFromAddress(env, clientId)` → si flag off OU pas de hostname
  active → from défaut `Intralys CRM <noreply@intralys.com>` (byte-identique).
- Capability `settings.manage` RÉUTILISÉE (ZÉRO ajout `ALL_CAPABILITIES`).
  Bornage `assertClientInTenant` (`clients-admin.ts:42`).
- UI = étendre onglet `branding` / `BrandingSettings.tsx` (Phase B Manager-C).
  Pas de page / route neuve.

---

## §6.B — MIGRATION seq 94 (`migration-whitelabel-seq94.sql`, depends 93)

En-tête garde-fous calque seq 93 (community). Timestamps `datetime('now')`.
Zéro FK / CHECK / ALTER. Table `custom_hostnames` + 2 index
(`idx_custom_hostnames_hostname`, `idx_custom_hostnames_client`).

Manifest :
`{ "seq": 94, "file": "migration-whitelabel-seq94.sql", "depends_on": ["migration-community-seq93.sql"], "objects": ["table:custom_hostnames","index:custom_hostnames"], "risk": "low" }`.

---

## §6.C — ROUTES worker.ts + middleware (RISQUE #1 ROUTING)

- **NE PAS toucher `requireAuth` / `resolveTenantContext` en profondeur.**
  Phase A : param optionnel `hostHeader?: string` AJOUTÉ à la signature de
  `resolveTenantContext` (corps lookup = Phase B). Le hostname est un fallback
  DERNIER RECOURS, atteint UNIQUEMENT si `clientId === null` à la fin (jamais
  pour un user existant → byte-identique). Au choke-point `worker.ts:821`,
  `request.headers.get('host')` est transmis.
  - **Phase A : `hostHeader` est `void`-é (no-op explicite) dans
    `resolveTenantContext`. ZÉRO changement de comportement.**
- Routes neuves (`routeProtected`, AVANT le `/:id` générique, calque `/branding`) :
  - `GET    /api/clients/:id/custom-domain`        → `handleGetCustomDomains`
  - `POST   /api/clients/:id/custom-domain`        → `handleAddCustomDomain`
  - `DELETE /api/clients/:id/custom-domain/:hid`   → `handleDeleteCustomDomain`
  - Garde `settings.manage` + `assertClientInTenant`. Handlers stubs dans
    `clients-admin.ts`. Ordre : la route DELETE `/:hid` est matchée AVANT la
    collection `/custom-domain` (spécifique avant générique).

---

## §6.D — api.ts + types

- Helpers (calque `getWhitelabel` / `updateWhitelabel`, `src/lib/api.ts`) :
  `getCustomDomains(clientId)`, `addCustomDomain(clientId, hostname)`,
  `deleteCustomDomain(clientId, hostId)`.
- Type `CustomHostname` dans `src/lib/types.ts`. **ApiResponse INCHANGÉ.**

---

## §6.E — i18n `whitelabel.*` ×4

10 clés × 4 catalogues (`fr-CA`, `fr-FR`, `en`, `es`) — parité stricte :
`whitelabel.title / add / hostname_placeholder / status_pending / status_active /
status_failed / dkim_status / delete / empty / provisioning_disabled`.

---

## §6.F — PAGES

Phase B Manager-C : Card « Domaine personnalisé » dans `BrandingSettings.tsx`.
**Pas Phase A.** (api.ts / types déjà posés Phase A.)

---

## §6.G — DÉCOUPAGE

- **Phase A SOLO (ce lot)** : migration + manifest + stubs `clients-admin.ts`
  (3 handlers signatures figées + 2 helpers no-op
  `provisionCustomHostname` / `resolveFromAddress`) + routes `worker.ts` + param
  `hostHeader` signature `resolveTenantContext` (void no-op) + flags `Env`
  (`types.ts`) + helpers api.ts + type `CustomHostname` + i18n ×4 + cette doc.
- **Phase B Manager-B** : corps des 3 handlers + lookup hostname fallback
  `tenant-context.ts` (UNIQUEMENT si `clientId === null`) + branchement
  `resolveFromAddress` dans `workflows.ts:614,622` (gardé flag DKIM).
- **Phase B Manager-C** : `BrandingSettings.tsx` Card domaine (api.ts / types
  déjà Phase A).

---

## §6.I — GARDE-FOUS

- Flag inactif (zéro fetch réseau si flag off) · E4-E6 jamais · CHECK59
  intouché (zéro ALTER users) · bornage `assertClientInTenant` strict · zéro
  ajout `ALL_CAPABILITIES` (`settings.manage` réutilisée) · `ApiResponse`
  inchangé · zéro FK · `datetime('now')` · **routing tenant byte-identique
  pour tout user existant (hostname = fallback jamais atteint si clientId
  résolu)** · jamais git.

---

## IMPLEMENTATION-LOG — Phase B Manager-B (backend, 2026-05-20)

Corps réels backend écrits. Périmètre EXCLUSIF respecté ; aucun touch
`BrandingSettings.tsx` (Manager-C) ni fichiers gelés Phase A
(worker.ts / api.ts / types.ts / i18n / migration / manifest).

### 1) `src/worker/clients-admin.ts` — 3 handlers + 2 helpers

- `handleGetCustomDomains(env, auth, clientId)` : garde `settings.manage` +
  `assertClientInTenant` → `SELECT id, hostname, status, dkim_status,
  provider_ref, created_at FROM custom_hostnames WHERE client_id = ? ORDER BY
  created_at DESC`. Best-effort : table absente → `{ data: [] }`.
- `handleAddCustomDomain(request, env, auth, clientId)` : garde + bornage →
  parse body → `isValidHostname` (trim + lowercase + regex domaine basique,
  ≤253) sinon 400 → `agency_id` lu de `auth.tenant.agencyId` (null en legacy) →
  appel `provisionCustomHostname` (gardé flag, no-op `pending` si off) →
  `INSERT custom_hostnames (id, client_id, agency_id, hostname, status,
  provider_ref)` → `{ data: { id, status } }`. Best-effort table absente → 404.
- `handleDeleteCustomDomain(env, auth, clientId, hostId)` : garde + bornage →
  re-borne par ID (`SELECT id WHERE id = ? AND client_id = ?`, 404 si
  introuvable / pas au tenant) → `DELETE WHERE id = ? AND client_id = ?`.
  Best-effort table absente → 404.
- `provisionCustomHostname(env, hostname)` : **flag `WHITELABEL_PROVISIONING_ENABLED
  !== 'true'` → retour `{ status: 'pending' }` SANS aucun réseau.** Flag `'true'`
  → lit `CF_API_TOKEN` / `CF_ZONE_ID` (cast best-effort d'Env) ; **si absents →
  `pending` (toujours zéro réseau tant que secrets non posés)** ; sinon POST
  `api.cloudflare.com/.../custom_hostnames` dans try/catch → `pending` sur tout
  échec. Jamais de throw.
- `resolveFromAddress(env, clientId)` : **flag `WHITELABEL_DKIM_ENABLED !== 'true'`
  → retour `'Intralys CRM <noreply@intralys.com>'` BYTE-IDENTIQUE, ZÉRO requête
  D1.** Flag `'true'` → `SELECT hostname WHERE client_id = ? AND status =
  'active' ORDER BY created_at DESC LIMIT 1` → `noreply@<hostname>` ; fallback
  défaut si pas de clientId / pas de hostname / panne D1 (try/catch). Jamais de throw.

### 2) `src/worker/tenant-context.ts` — lookup hostname fallback (chirurgical)

- `void hostHeader` Phase A supprimé. Bloc fallback inséré JUSTE AVANT le retour
  legacy-strict (`!clientId && accessibleClientIds.length === 0`) :
  **gardé `clientId === null && hostHeader`** → host normalisé (trim, lowercase,
  strip port) → `SELECT client_id FROM custom_hostnames WHERE hostname = ? AND
  status = 'active' LIMIT 1` en try/catch silencieux → si résolu, assigne
  `clientId` + ajoute à `accessibleClientIds`. La résolution `agency_id`
  conditionnelle existante (`if (clientId && (agencyId === null || switched))`)
  prend ensuite le relais naturellement.
- **Routing byte-identique** : pour tout user dont l'identité résout un
  `client_id` (cas de TOUT user existant), `clientId !== null` ⇒ le bloc n'est
  JAMAIS atteint. Jamais de throw (contrat dur préservé).

### 3) `src/worker/workflows.ts` — branchement `resolveFromAddress`

- Import `resolveFromAddress` depuis `./clients-admin` (aucun cycle :
  clients-admin n'importe pas workflows).
- Dans `case 'send_email'`, au début du `try` d'envoi :
  `const fromAddress = await resolveFromAddress(env, (lead.client_id as string)
  || null);`. Les deux `from: 'Intralys CRM <noreply@intralys.com>'` (chemin
  séquence ~614 + chemin legacy ~622) remplacés par `from: fromAddress`.
- **Flag DKIM off (défaut) → `resolveFromAddress` retourne le défaut →
  byte-identique** aux deux envois historiques. `send_internal_email`
  (`system@intralys.com`) hors scope, INTOUCHÉ.

### 4) Confirmations garde-fous

- **Flag OFF = ZÉRO réseau** : `provisionCustomHostname` retourne `pending`
  avant toute branche fetch ; même flag ON sans secrets = `pending` sans réseau.
- **From byte-identique flag off** : `resolveFromAddress` retourne le from
  défaut avant toute requête D1.
- **Routing byte-identique** : lookup hostname atteint UNIQUEMENT si
  `clientId === null` (jamais pour un user existant).
- Bornage `assertClientInTenant` sur les 3 handlers + re-borne par ID au DELETE.
- Zéro ajout `ALL_CAPABILITIES` (`settings.manage` réutilisée). `ApiResponse`
  inchangé. Best-effort partout (jamais de 500/throw). E4-E6/CHECK59 intouchés.
- Non touchés : `BrandingSettings.tsx`, `leads.ts`, worker.ts, api.ts, types.ts,
  i18n, migration, manifest, capabilities.ts, 6 pages R cœur.

---

## IMPLEMENTATION-LOG — Phase B Manager-C (front exclusif, 2026-05-20)

### Périmètre touché (écriture)
- `src/components/settings/BrandingSettings.tsx` — Card « Domaine personnalisé » ADDITIVE.
- `src/index.css` — bloc sentinellé `/* === LOT G9 White-label === */ … /* === Fin LOT G9 === */`
  (append fin de fichier, après `/* === Fin LOT G2 === */`). 7 classes neuves.
- `docs/LOT-WHITELABEL-G9.md` — ce log.

### UI livrée (BrandingSettings.tsx)
- Nouvelle `<Card className="settings-card">` rendue APRÈS la Card branding existante,
  AVANT le `<Wizard>` (modif strictement additive, branding 100% préservé).
- En-tête `t('whitelabel.title')` + icône `Link2` (Lucide, primary).
- Liste `custom_hostnames` chargée via `getCustomDomains(subAccountId)` :
  - `hostname` (font 600, tabular, ellipsis) + ligne meta `dkim_status` (`whitelabel.dkim_status`).
  - Badge statut color-coded via `<Tag>` + helper `domainStatusTag(status)` :
    `pending → variant="warning"` · `active → variant="success"` · `failed → variant="danger"`,
    libellés `whitelabel.status_pending/active/failed`, `statusIcon` auto (CheckCircle2/Clock/XCircle).
  - Bouton supprimer `<Button variant="ghost">` (icône `Trash2`) → `useConfirm({danger:true})`
    puis `deleteCustomDomain(subAccountId, host.id)`.
- Empty state `whitelabel.empty` quand `domains.length === 0`.
- Rangée d'ajout : `<Input>` (`whitelabel.hostname_placeholder`, submit sur Enter) +
  `<Button variant="primary">` (icône `Plus`, `whitelabel.add`) → `addCustomDomain(subAccountId, hostname)`.
  Bouton disabled si vide ou requête en cours (`domainBusy`).
- Helper text discret `whitelabel.provisioning_disabled` sous le tout (note flag :
  provisioning auto inactif → domaine reste 'pending').
- `clientId` = `getActiveSubAccount()` (réutilise le `subAccountId` memo déjà présent ;
  null en legacy → effets/handlers `return` early, aucune erreur).

### Check i18n
- 10 clés `whitelabel.*` Phase A CÂBLÉES (title/add/hostname_placeholder/status_pending/
  status_active/status_failed/dkim_status/delete/empty/provisioning_disabled).
- **ZÉRO clé créée.** i18n GELÉ (catalogues non touchés).

### Check branding préservé
- Aucune ligne de la Card branding existante / Wizard 4 steps / autosave / dropzone
  modifiée. Seuls ajouts : 3 imports helpers api + type `CustomHostname` + `useConfirm`/`Tag` +
  3 icônes Lucide (Link2/Trash2/Plus) + état/handlers domaine + la Card.

### Check disjonction
- ZÉRO touch `src/worker/*` (Manager-B), `worker.ts`, `api.ts`, `types.ts`, i18n,
  migration (tous READ-ONLY). ApiResponse inchangé (discrimination `res.error || !res.data`,
  jamais `res.code`). CSS uniquement bloc G9 sentinellé.

### Écarts / props réelles confirmées
- `useConfirm()` retourne directement la fn `confirm({title, description?, confirmLabel?, danger?})`
  (pas d'objet `{confirm}`) — câblé en conséquence.
- `Tag` : variants `success|warning|danger` valides ; `statusIcon` (bool) auto-mappe l'icône Lucide.
- `Button` variants `primary|ghost` valides ; `leftIcon`/`disabled`/`size` supportés.
- `Input` étend `InputHTMLAttributes` → `onKeyDown` passé en props natif (Enter = submit).
- Helper local `domainStatusTag` ajouté au niveau module (pas de clé i18n custom).
