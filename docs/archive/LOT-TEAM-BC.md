# LOT TEAM B + C — capabilities composables + sous-comptes / branding / rapports agence

> Phase A SOLO (Manager unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B ∥ Manager-C, fichiers disjoints).
> Non exécuté (VM VMware sans bun/node) — Antigravity buildera côté hôte.
> Modèle : `docs/LOT-TEAM-A.md`. Phase B ne lit QUE ce document pour B/C.

---

## §6 Contrats figés

### §6.A — Dette (a) close : `apiFetch` GELÉ

`src/lib/api.ts:103-105` (`if (!response.ok) return { error: data.error || ... }`)
et le type `ApiResponse<T>` sont **GELÉS** et ne sont PAS modifiés par B/C.
Justification : **378 appelants** dépendent de la forme `{ data?, error? }` ;
toute mutation = rétro-compat dure cassée. Décision **DÉFINITIVE** :

- La discrimination d'erreur côté front reste un **string-match sur `error`**
  (pattern acté LOT A : ex. `result.error?.includes('expirée')`).
- **AUCUN endpoint B/C ne renvoie ni n'exige un champ `code`** côté front.
  Les réponses d'erreur B/C sont **`json({ error: '<message>' }, <status>)`**
  uniquement. `setToken`/`login`/`register`/`acceptInvitation` INCHANGÉS.
- Manager-B/C : ne JAMAIS lire `result.code`. Discriminer sur le HTTP status
  (via absence de `data` + présence de `error`) ou le texte de `error`.

### §6.B — `handleListInvitations` (LOT B)

**Fichier** : `src/worker/team.ts` (Manager-B édite ce fichier — il y remplace
le **STUB PHASE A** par le corps réel ; la signature et l'endpoint sont FIGÉS).

```ts
handleListInvitations(_request: Request, env: Env, auth?: TeamAuth): Promise<Response>
```

- **Endpoint** (déjà câblé worker.ts, bloc gardé `routeProtected`) :
  `GET /api/team/invites` → `handleListInvitations(request, env, auth)`.
  (Le `POST /api/team/invites` existant — `handleInviteUser` — est conservé
  tel quel ; seul le verbe GET est ajouté, AVANT la ligne POST.)
- **Bornes** = EXACTEMENT le pattern `handleGetUsers` (LOT A §6.A) :
  - **Legacy/mono-tenant** (`isLegacy(auth)` = `!auth?.tenant ||
    auth.tenant.agencyId == null`) : `SELECT id, email, role, scope,
    client_id, status, expires_at, created_at FROM user_invitations
    ORDER BY created_at DESC LIMIT 50` — aucun WHERE tenant (byte-équivalent
    à l'absence historique de garde, endpoint NEUF).
  - **Mode agence** (`agencyId != null`) : `... FROM user_invitations
    WHERE agency_id = ? ORDER BY created_at DESC LIMIT 50`
    bind `[auth.tenant.agencyId]`.
  - `try/catch` best-effort : si table seq 79 absente → `{ data: [] }`
    (jamais de throw, jamais de fuite).
- **Réponse succès** : `json({ data: [...] })` (pattern `handleGetUsers`).
- **Helper api** (déjà figé `src/lib/api.ts`) : `getTeamInvites()` →
  `ApiResponse<TeamInvite[]>` (type `TeamInvite` exporté).
- STUB PHASE A actuel renvoie `json({ data: [] })` (bien formé, zéro
  régression — endpoint NEUF). Manager-B substitue le SELECT borné.

### §6.C — Schéma seq 80 (LOT B capabilities) + liste FIGÉE

**Migration** `migration-team-lotB-seq80.sql` (seq 80, depends_on
`migration-team-lotA-seq79.sql`). STRICTEMENT ADDITIF. **Aucune FK vers
`users`** (D1/SQLite : FK ⇒ rebuild au moindre ALTER ; jointure user→caps
est APPLICATIVE dans `capabilities.ts`). JAMAIS touche `users` / CHECK seq 59.

DDL exact :

```sql
CREATE TABLE IF NOT EXISTS role_capabilities (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  role_generic TEXT NOT NULL,
  capability TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_role_caps_role ON role_capabilities(role_generic);
CREATE UNIQUE INDEX IF NOT EXISTS ux_role_caps_role_cap
  ON role_capabilities(role_generic, capability);

CREATE TABLE IF NOT EXISTS user_capability_overrides (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_cap_ovr_user ON user_capability_overrides(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_cap_ovr_user_cap
  ON user_capability_overrides(user_id, capability);
```

Seed `role_capabilities` (INSERT idempotents `WHERE NOT EXISTS` sur la clé
logique `(role_generic, capability)`).

**Liste FIGÉE des 12 capabilities** (`domaine.action`) — source de vérité
unique, reflétée dans `ALL_CAPABILITIES` (`src/worker/capabilities.ts`) :

| capability | sémantique |
|---|---|
| `leads.read` | lire les contacts/leads |
| `leads.write` | créer/éditer contacts/leads |
| `leads.delete` | supprimer/trash contacts/leads |
| `export` | exporter des données |
| `team.manage` | inviter/gérer l'équipe & rôles |
| `billing.view` | consulter facturation/plan/quotas |
| `clients.manage` | CRUD sous-comptes + branding |
| `reports.view` | consulter rapports/analytics |
| `workflows.manage` | créer/éditer automatisations |
| `invoices.write` | créer/éditer des factures |
| `settings.manage` | modifier réglages sensibles |
| `ai.use` | utiliser les fonctions IA |

**Seed par rôle générique (FIGÉ)** :

| rôle | capabilities seedées |
|---|---|
| `owner` | **les 12** (toutes) |
| `manager` | `leads.read`, `leads.write`, `leads.delete`, `export`, `team.manage`, `billing.view`, `clients.manage`, `reports.view`, `workflows.manage`, `ai.use` — **PAS** `settings.manage` ni `invoices.write` (réservés owner) |
| `member` | `leads.read`, `leads.write`, `ai.use`, `reports.view` |
| `viewer` | `leads.read`, `reports.view` (**lecture seule STRICTE**) |

Arbitrage `settings.manage` + `invoices.write` réservés `owner` : ce sont
les deux capabilities à plus fort impact (config destructive / pièces
comptables) ; un `manager` PME ne doit pas reconfigurer le système ni
émettre des factures sans le propriétaire. Documenté ici comme décision
définitive.

### §6.D — `resolveCapabilities` / `requireCapability` (LOT B)

**Fichier** : `src/worker/capabilities.ts` — créé Phase A avec STUBS de
contrat ; **Manager-B écrit le corps réel** de `resolveCapabilities`
(le squelette best-effort + le filet legacy sont DÉJÀ posés et FIGÉS ;
Manager-B ne change PAS la signature ni le contrat de dégradation).

```ts
resolveCapabilities(env: Env, auth: CapAuth): Promise<Set<string>>
requireCapability(caps: Set<string> | undefined, cap: Capability): Response | undefined
handleGetMyCapabilities(_request, env, auth): Promise<Response>   // RÉEL Phase A (figé)
```

`CapAuth = { userId; role; clientId?; tenant?: TenantContext }`.

**Contrat de dégradation (FIGÉ, byte-équivalent legacy)** :
- **Legacy/mono-tenant** (`!auth.tenant || auth.tenant.agencyId == null`)
  → `legacyCapsFromRole(role)` : `admin` ⇒ **toutes** ; tout autre rôle
  technique ⇒ set opérationnel LARGE (`leads.*`, `export`, `team.manage`,
  `billing.view`, `clients.manage`, `reports.view`, `workflows.manage`,
  `ai.use`). **AUCUNE requête, AUCUNE garde nouvelle** ⇒ zéro régression
  des suites `lot1..4` / `tenant-context` / `teamA-*` /
  `ecommerce-multitenant`.
- **Tenant agence** (`agencyId != null`) : rôle générique =
  `users.role_generic` (fallback mapping inverse `legacyRoleToGeneric` :
  `admin→owner`, `broker→manager`, `store_manager→member`) ; `owner`/`admin`
  ⇒ **toutes** ; sinon caps de `role_capabilities` PUIS overrides
  (`granted=1` ajoute, `granted=0` retire). Toute erreur SQL / table seq 80
  absente / seed vide ⇒ **DÉGRADE `legacyCapsFromRole`** (jamais de blocage
  d'accès = jamais de régression).

**Injection choke-point** (FAIT Phase A, `src/worker.ts`) : après
`resolveTenantContext`, `const capabilities = await
resolveCapabilities(env, baseAuthCtx); const authCtx = { ...baseAuthCtx,
capabilities };`. Best-effort, **AUCUNE garde bloquante posée au
choke-point** ni sur les chemins legacy testés.

**Handlers sensibles où Manager-B doit brancher `requireCapability`**
(UNIQUEMENT le bloc gardé `routeProtected` ; pattern : early-return
`const g = requireCapability(auth.capabilities, '<cap>'); if (g) return g;`).
⚠ Ne JAMAIS appeler `requireCapability` sur un chemin legacy testé sans
garde : en legacy, `capabilities` est volontairement LARGE, donc l'appel
**ne régresse pas** (le set legacy contient déjà ces caps pour
admin/broker/store_manager) — c'est sûr, mais le bénéfice (viewer bridé)
n'opère qu'en mode agence. Capabilities cibles recommandées :

| domaine handler | capability |
|---|---|
| `leads.write` / `handleCreateLead` / `handlePatchLead` / `handleBulkLeads` | `leads.write` |
| trash / hard-delete lead | `leads.delete` |
| exports CSV/PDF (leads, reports) | `export` |
| `/api/team/*` mutations (invite/role/delete) | `team.manage` |
| `/api/clients` CRUD + branding (LOT C) | `clients.manage` |
| `/api/reports/*` lecture | `reports.view` |
| workflows create/update | `workflows.manage` |
| invoices create/update | `invoices.write` |
| settings sensibles | `settings.manage` |
| endpoints IA | `ai.use` |

Manager-B applique ces gardes de façon **incrémentale et défensive** :
chaque garde doit laisser le legacy byte-identique (set large) — vérifier
qu'aucune suite `teamA-*`/`lot*`/`tenant-context`/`ecommerce-multitenant`
ne casse. En cas de doute → NE PAS brancher la garde, documenter.

### §6.E — `handleGetRoles` enrichi (LOT B)

**Fichier** : `src/worker/team.ts`. Signature FIGÉE Phase A :

```ts
handleGetRoles(_request: Request, _env: Env, _auth?: TeamAuth): Promise<Response>
```

Endpoint déjà recâblé : `GET /api/team/roles` →
`handleGetRoles(request, env, auth)`. Corps actuel = 4 rôles génériques
`is_system:true` (rétro-compat). **Manager-B enrichit le corps** : pour
chaque rôle (`owner|manager|member|viewer`), joindre les capabilities lues
de `role_capabilities` (seq 80) → ajouter un champ
`capabilities: string[]`. Réponse : `json({ data: [{ id, name,
description, is_system:true, capabilities:[...] }, ...] })`. Mapping
VERROUILLÉ rappelé : `owner→admin`, `manager→broker`,
`member→store_manager`, `viewer→store_manager` (JAMAIS de générique dans
`users.role` / CHECK seq 59 ; JAMAIS de rebuild `users`). Helper api figé :
`getRolesWithCaps()` → `ApiResponse<TeamRoleWithCaps[]>`
(`capabilities?: string[]` optionnel = rétro-compat tant que non enrichi).

### §6.F — Endpoints LOT C (sous-comptes / branding / rapports agence)

**Fichier handlers** : `src/worker/clients-admin.ts` (créé Phase A avec
STUBS 501 ; **Manager-C écrit les corps réels**). Signatures FIGÉES :

```ts
handleUpdateClient(request, env, auth, clientId): Promise<Response>
handleDeleteClient(request, env, auth, clientId): Promise<Response>   // SOFT
handleGetClientBranding(env, auth, clientId): Promise<Response>
handleUpdateClientBranding(request, env, auth, clientId): Promise<Response>
handleGetAgencyReports(env, auth, url): Promise<Response>
```

`auth` = `CapAuth` enrichi (`userId, role, clientId?, tenant?,
capabilities?`). Endpoints déjà câblés worker.ts (ordre `/branding` AVANT
`/:id` pour éviter le shadowing ; `/leads` reste prioritaire) :

| Route | Handler | Bornage |
|---|---|---|
| `PATCH /api/clients/:id` | `handleUpdateClient` | `id ∈ auth.tenant.accessibleClientIds` OU `clients.agency_id == auth.tenant.agencyId` (pattern `team.ts:assertTargetInTenant`) ; sinon `json({ error:'Sous-compte introuvable' },404)` |
| `DELETE /api/clients/:id` | `handleDeleteClient` | idem bornage ; **SOFT** = `UPDATE clients SET is_active = 0 WHERE id = ?` (colonne `is_active` EXISTE DÉJÀ, schema.sql:27, DEFAULT 1 — JAMAIS de DELETE dur) |
| `GET /api/clients/:id/branding` | `handleGetClientBranding` | idem bornage ; `SELECT branding, logo_url, primary_color, accent_color FROM clients WHERE id = ?` (colonnes seq 81) |
| `PATCH /api/clients/:id/branding` | `handleUpdateClientBranding` | idem bornage ; `UPDATE clients SET branding=?, logo_url=?, primary_color=?, accent_color=? WHERE id = ?` |
| `GET /api/reports/agency` | `handleGetAgencyReports` | agrégat borné `WHERE client_id IN (auth.tenant.accessibleClientIds)` (placeholders) ; si vide → `{ data: [] }` |

**Garde capability** : `handleUpdateClient`/`handleDeleteClient`/
`handleUpdateClientBranding` → `requireCapability(auth.capabilities,
'clients.manage')` ; `handleGetClientBranding` → `'clients.manage'` (lecture
config sensible) ; `handleGetAgencyReports` → `requireCapability(...,
'reports.view')`. En legacy le set est large ⇒ pas de régression (endpoints
NEUFS de toute façon). **Réponses d'erreur `{ error }` UNIQUEMENT** (PAS de
`code`, §6.A). Best-effort : table/colonnes absentes → réponse propre
(404/`{ data:[] }`), jamais de 500/throw. Helpers api figés :
`updateClient`, `deleteClient`, `getClientBranding`,
`updateClientBranding`, `getAgencyReports` (types `ClientBranding` exporté).

### §6.G — Listes i18n complètes B + C (4 catalogues, parité STRICTE)

Catalogues VIVANTS = `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (×4, format plat
point-notation, valeurs strings, PAS de `{{var}}`). `src/i18n/*.json` est
**MORT** — NE PAS toucher. **Phase A est SEUL owner i18n** : toutes les
clés B+C sont DÉJÀ créées, parité stricte vérifiée (**59 clés × 4 =
identiques, zéro diff, zéro doublon, zéro modif d'existant**). Manager-B/C
**utilisent** ces clés via `t('<clé>')` et **ne touchent JAMAIS** les
catalogues.

Clés `caps.*` (LOT B — 23) :
```
caps.matrix.title  caps.matrix.subtitle  caps.matrix.role_col
caps.matrix.capability_col  caps.matrix.granted  caps.matrix.denied
caps.matrix.system_role  caps.matrix.loading  caps.matrix.error
caps.matrix.empty  caps.leads.read  caps.leads.write  caps.leads.delete
caps.export  caps.team.manage  caps.billing.view  caps.clients.manage
caps.reports.view  caps.workflows.manage  caps.invoices.write
caps.settings.manage  caps.ai.use  caps.denied_message
```
(Total = **23** clés `caps.*` — `caps.matrix.*` ×10 + `caps.<capability>` ×12 + `caps.denied_message`.)

Clés `subacct.*` (LOT C — 20) :
```
subacct.title  subacct.coming_soon  subacct.subtitle  subacct.col_name
subacct.col_email  subacct.col_status  subacct.col_actions
subacct.status_active  subacct.status_inactive  subacct.action_edit
subacct.action_delete  subacct.action_branding  subacct.confirm_delete
subacct.deleted  subacct.updated  subacct.empty  subacct.loading
subacct.error  subacct.save  subacct.cancel
```

Clés `agrep.*` (LOT C — 9) :
```
agrep.title  agrep.subtitle  agrep.col_subaccount  agrep.col_leads
agrep.col_conversion  agrep.total  agrep.loading  agrep.error  agrep.empty
```

Clés `branding.subaccount.*` (LOT C — 7) :
```
branding.subaccount.title  branding.subaccount.logo_label
branding.subaccount.primary_color_label
branding.subaccount.accent_color_label  branding.subaccount.save
branding.subaccount.saved  branding.subaccount.error
```
(Préfixe `branding.subaccount.*` choisi pour ZÉRO collision : aucune clé
`branding.*` pré-existante dans les catalogues — vérifié.)

### §6.H — Matrice de propriété fichiers Phase B (disjonction STRICTE)

**Fichiers GELÉS (Phase A — Manager-B/C n'y TOUCHENT PAS)** :
`src/worker.ts` (dispatch + choke-point), `src/lib/api.ts` (helpers/types
B+C + `apiFetch`/`ApiResponse`), `src/pages/Settings.tsx` (onglets +
switch), `docs/migrations-manifest.json`, `migration-team-lotB-seq80.sql`,
`migration-team-lotC-seq81.sql`, les 4 catalogues
`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, les **6 pages R**
(`Leads/Dashboard/LeadDetail/Tasks/Pipeline/Clients`), `docs/LOT-TEAM-A.md`.

| Fichier | Owner Phase B | Action |
|---|---|---|
| `src/worker/team.ts` | **Manager-B** | remplacer STUB `handleListInvitations` par corps réel (§6.B) ; enrichir corps `handleGetRoles` avec capabilities `role_capabilities` (§6.E). Ne PAS toucher LOT A (`handleGetUsers`/invite/accept/revoke/resend/update/delete — figés). Ne PAS changer signatures. |
| `src/worker/capabilities.ts` | **Manager-B** | écrire/finaliser corps réel `resolveCapabilities` (squelette + contrat dégradation DÉJÀ figés Phase A — ne PAS changer signature ni le filet legacy). `requireCapability`/`handleGetMyCapabilities` = figés Phase A (ne PAS toucher). Brancher `requireCapability` dans les handlers sensibles **uniquement via worker.ts ? NON** — worker.ts gelé : Manager-B ajoute la garde **à l'intérieur des handlers métier concernés** (leads.ts/workflows.ts/etc.) en early-return, sans casser le legacy (§6.D). |
| `src/components/settings/RolesPermissionsSettings.tsx` | **Manager-B** | réécrire en matrice rôles×capabilities réelle via `getRolesWithCaps()` + `getMyCapabilities()` ; **corriger le `fetch` brut sans token (~ligne 11)** → utiliser le helper `apiFetch`/`getRolesWithCaps` (jamais de `fetch` direct). i18n `caps.*`. |
| `src/components/settings/TeamSettings.tsx` | **Manager-B** | brancher revoke/resend sur les **ids réels** de `getTeamInvites()` (remplacer la liste mockée). N'altère QUE ce composant. |
| `src/worker/clients-admin.ts` | **Manager-C** | écrire corps réels des 5 handlers (§6.F) — bornage tenant + soft-delete `is_active` + colonnes branding seq 81 + agrégat reports. Signatures FIGÉES. |
| `src/components/settings/BrandingSettings.tsx` | **Manager-C** | câbler l'endpoint réel (`getClientBranding`/`updateClientBranding`) à la place du mock localStorage. i18n `branding.subaccount.*`. |
| `src/components/settings/SubAccountsSettings.tsx` | **Manager-C** | réécrire le STUB Phase A en composant réel (liste `GET /api/clients`, `updateClient`/`deleteClient`, membres par sous-compte). i18n `subacct.*` / `agrep.*`. |

**Disjonction garantie** : Manager-B ⊂ {team.ts, capabilities.ts,
RolesPermissionsSettings.tsx, TeamSettings.tsx, + gardes capability dans
handlers métier (leads/workflows/...) }. Manager-C ⊂ {clients-admin.ts,
BrandingSettings.tsx, SubAccountsSettings.tsx}. **Zéro fichier commun.**
Seul point d'attention : si Manager-B ajoute des gardes `requireCapability`
dans des handlers métier partagés, ces fichiers ne sont PAS touchés par
Manager-C (Manager-C ne touche que clients-admin/Branding/SubAccounts) →
disjonction tenue. worker.ts/api.ts/Settings.tsx GELÉS ⇒ aucune course.

### §6.I — Preuves attendues / garde-fous

Suites à NE PAS régresser (rétro-compat byte-identique legacy) :
`teamA-isolation`, `teamA-invitation`, `tenant-context`,
`lot1-isolation-regression`, `lot2-*`, `lot3-*`, `lot4-*`,
`ecommerce-multitenant.*`. Invariants vérifiables :
- Migrations seq 80/81 **strictement additives** : zéro `DROP`/`RENAME` sur
  `users`/`clients` ; seq 80 sans FK vers `users` ; seq 81 = 4 ALTER ADD
  COLUMN (branding/logo_url/primary_color/accent_color), **pas** de
  `is_active` (déjà présent schema.sql:27).
- `resolveCapabilities` legacy = set large dérivé du rôle, **aucune requête
  D1** ⇒ aucune nouvelle garde sur chemins legacy testés.
- Aucune réponse B/C ne dépend d'un champ `code` (apiFetch gelé §6.A).
- Choke-point : `capabilities` ADDITIF, best-effort, jamais de throw/500.

**§6 LOT B/C FIGÉ → Phase B (Manager-B ∥ Manager-C) peut démarrer.**
