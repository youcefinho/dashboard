# LOT WHITE-LABEL APPLY — Sprint 20 « application du branding aux surfaces » (le branding est DÉJÀ STOCKÉ — colonnes `clients.{logo_url,primary_color,accent_color}` seq 81 + colonne `clients.branding` JSON extensible ; `BrandingSettings.tsx` = éditeur complet + autosave + wizard ; `getClientBranding`/`updateClientBranding` clients.manage ; domaine custom `custom_hostnames` seq 94 flag OFF ; `from` custom `resolveFromAddress` flag OFF déjà branché `workflows.ts:600`. MAIS le branding n'est **PAS PROPAGÉ** : `useTheme` ne gère que dark/light, `Sidebar:202` hardcode `<h1>Intralys</h1>`, footer email générique, `index.css:2521` footer PDF hardcodé Intralys, `index.html` favicon/title hardcodés. GAP = **PROPAGATION**. On COMBLE, **100% ADDITIF**, en RÉUTILISANT tout — **AUCUNE migration**, **AUCUNE reconstruction**. DERNIER sprint du LOT 2.)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-MARKETPLACE-SPRINT19.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE des fichiers RÉUTILISÉS,
> jamais le brief).

Sprint **100% ADDITIF**, **AUCUNE migration** (la colonne `clients.branding` est
un JSON EXTENSIBLE qui accueille les nouvelles clés `favicon` / `sender_name` /
`remove_powered_by` SANS aucun `ALTER` ; les couleurs/logo restent sur les
colonnes seq 81 existantes). **Manifest INCHANGÉ** (dernière migration reste
seq 118). **PAS de fichier migration « pour la forme ».** Tout l'existant
white-label est RÉUTILISÉ — **à RÉUTILISER, NE PAS reconstruire** :

- `clients.branding` (JSON), `clients.{logo_url,primary_color,accent_color}`
  (seq 81) — stockage EXISTANT, INTOUCHÉ (aucune colonne ajoutée).
- `src/worker/clients-admin.ts` — `handleGetClientBranding` (l.173) /
  `handleUpdateClientBranding` (l.223), garde **`clients.manage`** +
  `assertClientInTenant`, best-effort. **INTOUCHÉ ce lot.** `resolveFromAddress`
  (l.422, flag `WHITELABEL_DKIM_ENABLED` OFF ⇒ `from` défaut byte-identique) —
  RÉUTILISÉ par Manager-B, le **flag domaine RESTE INACTIF**.
- `src/components/settings/BrandingSettings.tsx` — éditeur complet
  (`buildBrandingBody` l.185 sérialise les méta dans `branding` JSON ;
  `getActiveSubAccount()` l.91 = `client_id` actif). owned **Manager-C** ce lot.
- `src/worker/workflows.ts` — `case 'send_email'` (~l.595-647) +
  `case 'send_internal_email'` (~l.649) ; `resolveFromAddress` DÉJÀ branché
  (l.600). owned **Manager-B** ce lot.
- `src/components/layout/{AppLayout,Sidebar}.tsx`, `src/index.css` — surfaces de
  propagation front. owned **Manager-C** ce lot.
- `src/lib/applyBranding.ts` (**NEUF, FIGÉ Phase A**) + `src/lib/types.ts`
  (`ClientBrandingMeta`/`TenantBranding` ADDITIFS, FIGÉS Phase A) — READ (front).
- `src/lib/api.ts` — `ClientBranding` + `getClientBranding`/`updateClientBranding`
  EXISTANTS, **FIGÉS** (INTOUCHÉS). `src/worker.ts` — routes branding EXISTENT
  (l.1320-1321), **INTOUCHÉ**.

**GAP comblé :**
- **(P1)** couleurs non propagées → `applyTenantBranding` pose `--primary`/`--accent`
  (Manager-C, au boot AppLayout).
- **(P2)** `Sidebar:202` `<h1>Intralys</h1>` hardcodé → logo + nom tenant
  conditionnels, fallback Intralys (Manager-C).
- **(P3)** favicon/title hardcodés → `applyTenantBranding` met à jour
  `<link rel=icon>` + suffixe `document.title` (Manager-C via le helper).
- **(P4)** footer email générique → footer HTML brandé tenant dans le
  `case send_email` (Manager-B), masquable via `remove_powered_by`.
- **(P5)** `index.css:2521` footer PDF hardcodé Intralys → piloté par var/classe
  CSS (`--wl-powered-by`), retrait CONDITIONNEL NON destructif (Manager-C).

Alias : imports worker **RELATIFS** (`./...`), JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi — à RÉUTILISER)

### `src/lib/api.ts` — `ClientBranding` (l.321) + helpers (l.345-358) — **FIGÉS, INTOUCHÉS**

```ts
export interface ClientBranding {
  branding: string | null;       // JSON extensible (méta sérialisées)
  logo_url: string | null;       // colonne seq 81
  primary_color: string | null;  // colonne seq 81
  accent_color: string | null;   // colonne seq 81
}
export async function getClientBranding(id: string): Promise<ApiResponse<ClientBranding>>;
  //   → GET /clients/:id/branding  (garde clients.manage, borné tenant)
export async function updateClientBranding(
  id: string, body: Partial<ClientBranding>,
): Promise<ApiResponse<{ success: boolean }>>;
  //   → PATCH /clients/:id/branding
```

⚠ `ClientBranding` vit dans **`api.ts`** (PAS `types.ts`). `api.ts` est **GELÉ
Phase A** : on n'y touche PAS. La forme du JSON `branding` désérialisé est typée
ADDITIVEMENT dans `types.ts` (§6.B). `ApiResponse` INCHANGÉ : succès `json({data})`,
erreur `json({error},status)`, **JAMAIS `code`**.

### `src/worker/clients-admin.ts` — branding handlers (l.173/223) + `resolveFromAddress` (l.422)

- `handleGetClientBranding(env, auth, clientId)` (l.173) : `requireCapability('clients.manage')`
  + `assertClientInTenant`, `SELECT branding, logo_url, primary_color, accent_color
  FROM clients WHERE id = ?`, best-effort (colonnes absentes ⇒ `{data:{…null}}`).
  **INTOUCHÉ.**
- `handleUpdateClientBranding(request, env, auth, clientId)` (l.223) : même garde,
  patch partiel sur `BRANDING_COLUMNS = ['branding','logo_url','primary_color',
  'accent_color']` (l.246). ⚠ **Seules ces 4 colonnes sont écrites** : les méta
  (favicon/sender_name/remove_powered_by) transitent DANS la colonne `branding`
  JSON (sérialisées par `buildBrandingBody`), PAS en colonnes dédiées. **INTOUCHÉ.**
- `resolveFromAddress(env, clientId)` (l.422) :

```ts
export async function resolveFromAddress(env: Env, clientId: string | null): Promise<string> {
  const DEFAULT_FROM = 'Intralys CRM <noreply@intralys.com>';
  if (env.WHITELABEL_DKIM_ENABLED !== 'true') {
    return DEFAULT_FROM; // FLAG INACTIF (défaut) : from byte-identique, ZÉRO requête D1
  }
  // … corps réel branché Phase B UNIQUEMENT si flag === 'true'
}
```

⚠ **Le flag `WHITELABEL_DKIM_ENABLED` (et `WHITELABEL_PROVISIONING_ENABLED`)
RESTENT OFF ce sprint.** `resolveFromAddress` reste byte-identique au `from`
historique (`'Intralys CRM <noreply@intralys.com>'`, cf. workflows.ts l.621/629).
**E4/E6 réseau/DKIM/provisioning INACTIFS.**

### `src/worker/workflows.ts` — `case 'send_email'` (~l.595-647) — **OWNED Manager-B**

`resolveFromAddress` DÉJÀ appelé l.600 :
```ts
const fromAddress = await resolveFromAddress(env, (lead.client_id as string) || null);
```
Deux chemins : SÉQUENCE (tracké, INSERT messages + injectTracking l.601-625) et
LEGACY (l.626-637, byte-identique à l'origine). Les deux font
`resend.emails.send({ from: fromAddress, to, subject, html: interpolate(tpl.body_html) })`.
`case 'send_internal_email'` (l.649) : `from: 'Intralys System <system@intralys.com>'`,
`html: interpolate(body)`. `interpolate` = helper EXISTANT (variables lead).

### `src/components/settings/BrandingSettings.tsx` — `buildBrandingBody` (l.185) + `getActiveSubAccount` (l.91) — **OWNED Manager-C**

```tsx
const subAccountId = useMemo(() => getActiveSubAccount(), []); // = client_id actif (header X-Sub-Account)
const buildBrandingBody = useCallback(() => ({
  branding: JSON.stringify({ companyName, address, websiteUrl, shortDescription }),
  logo_url: logoFile, primary_color: primary, accent_color: accent,
}), [companyName, address, websiteUrl, shortDescription, logoFile, primary, accent]);
```

⚠ `buildBrandingBody` sérialise actuellement `companyName` (**camelCase**) dans le
JSON `branding`. La lecture (l.160-175) parse `meta.companyName`. **Manager-C
ÉTEND `buildBrandingBody` + le parse** pour ajouter `favicon` / `sender_name` /
`remove_powered_by` au MÊME JSON (clés additionnelles), SANS migration. La
graphie canonique pour la PROPAGATION est `company_name` (snake) ; `ClientBrandingMeta`
tolère les deux en lecture (alias) — voir §6.B/§6.G.

### `src/components/layout/Sidebar.tsx` — `<h1>Intralys</h1>` (l.202) — **OWNED Manager-C**

```tsx
<div className="w-9 h-9 rounded-md … text-white"
  style={{ background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)' }}>I</div>
{!collapsed && (
  <div className="overflow-hidden">
    <h1 className="… text-[var(--primary)] …">Intralys</h1>   {/* ← l.202 HARDCODÉ */}
    <p className="… text-[var(--text-muted)]">CRM</p>
  </div>
)}
```

### `src/components/layout/AppLayout.tsx` — boot (~l.324-381) — **OWNED Manager-C**

`AppLayout` lit `useAuth()` (l.200), a un `useEffect` de boot (l.324, token-gated).
C'est le point d'appel de `applyTenantBranding` : APRÈS résolution du sous-compte
actif → `getClientBranding(getActiveSubAccount())` → fusion couleurs + méta JSON
→ `applyTenantBranding(...)`. `useTheme()` (dark/light) RESTE INTOUCHÉ.

### `src/index.css` — footer PDF hardcodé (l.2520) — **OWNED Manager-C**

```css
body::after {
  content: 'Généré par Intralys CRM — intralys.com';   /* ← l.2521 HARDCODÉ */
  position: fixed; bottom: 0; right: 0; font-size: 8px;
  color: var(--brand-cyan); font-weight: 600; letter-spacing: 0.05em;
}
```
Vars de référence (l.33/39/41) : `--primary:#635BFF`, `--brand-cyan:#009DDB`,
`--brand-gradient`. Manager-C pilote le `content` via une var CSS (ex
`var(--wl-powered-by, 'Généré par Intralys CRM — intralys.com')`) + retrait
CONDITIONNEL NON destructif (var = `''` masque sans casser la règle).

### i18n `whitelabel.*` EXISTANTES (10 clés, INTOUCHÉES) + 5 NEUVES (Phase A)

10 existantes (INTOUCHÉES, NE PAS redéfinir) : `whitelabel.{title, add,
hostname_placeholder, status_pending, status_active, status_failed, dkim_status,
delete, empty, provisioning_disabled}`. 5 NEUVES Phase A : voir §6.E.

---

## §1 — MIGRATION : **AUCUNE** (confirmation explicite)

**AUCUN DDL n'est requis pour ce sprint.** Le branding est DÉJÀ stocké :
- couleurs / logo → colonnes `clients.{primary_color, accent_color, logo_url}`
  (seq 81) EXISTANTES ;
- méta texte → colonne `clients.branding` **JSON EXTENSIBLE** (seq 81)
  EXISTANTE, qui accueille les NOUVELLES clés `favicon` / `sender_name` /
  `remove_powered_by` **sans aucun changement de schéma** (ce sont des clés JSON,
  pas des colonnes).

⇒ **ZÉRO `CREATE TABLE`, ZÉRO `ALTER`, ZÉRO index, ZÉRO fichier
`migration-*.sql`, ZÉRO entrée manifest.** Le **manifest reste à seq 118**
(INCHANGÉ). **PAS de migration « pour la forme ».** Les CHECK/FK existants sont
INTOUCHÉS (aucune contrainte ajoutée). Le domaine custom (`custom_hostnames`
seq 94) et les flags `WHITELABEL_PROVISIONING_ENABLED` / `WHITELABEL_DKIM_ENABLED`
**RESTENT INACTIFS** (zéro réseau, `from` byte-identique).

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS (FIGÉ Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`**. `ClientBranding` + `getClientBranding`/`updateClientBranding`
**EXISTANTS, INTOUCHÉS** (garde `clients.manage`, borné tenant). **NE PAS
modifier `api.ts` (FIGÉ Phase A).** La discrimination erreur côté front =
`res.error || !res.data` (pattern EXISTANT BrandingSettings).

### §6.B — Types (`src/lib/types.ts`, FIGÉS Phase A — ADDITIFS)

`ClientBranding` (couleurs seq 81) reste dans **`api.ts`** (FIGÉ). Dans
`types.ts`, DEUX interfaces ADDITIVES (tout OPTIONNEL, rétro-compat byte) :

```ts
// Forme désérialisée de la colonne `clients.branding` (JSON extensible seq 81).
export interface ClientBrandingMeta {
  company_name?: string;     // graphie canonique propagation
  companyName?: string;      // graphie historique buildBrandingBody (lue en repli)
  favicon?: string | null;
  sender_name?: string | null;
  remove_powered_by?: boolean;
  address?: string; websiteUrl?: string; shortDescription?: string; // méta historiques
}

// Branding prêt à propager front (couleurs seq 81 + méta JSON fusionnée).
export interface TenantBranding {
  primary_color?: string | null;
  accent_color?: string | null;
  logo_url?: string | null;
  company_name?: string;
  favicon?: string | null;
  remove_powered_by?: boolean;
}
```

⚠ **AUCUN champ ici n'est une colonne DB** : `favicon`/`sender_name`/
`remove_powered_by` sont des CLÉS du JSON `branding`. **NE PAS toucher
`ClientBranding` (api.ts) ni `types.ts` (FIGÉ A).**

### §6.C — Helper de propagation front `src/lib/applyBranding.ts` (NEUF, FIGÉ Phase A)

```ts
export function applyTenantBranding(branding: TenantBranding | null | undefined): void;
export function resetTenantBranding(): void;
```

- `applyTenantBranding` : pose `document.documentElement.style.setProperty('--primary', …)`
  + `--accent` **UNIQUEMENT si hex valide** (`/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i`),
  met à jour un `<link rel=icon id="wl-tenant-favicon">` si `branding.favicon`
  (sans toucher les favicons statiques `index.html`), et ajoute un suffixe
  `document.title` `· <company_name>` si présent (idempotent). **NO-OP TOTAL** si
  `branding` null/undefined/vide ⇒ couleurs Intralys (vars `:root`), favicon
  `index.html`, titre INCHANGÉS (**rétro-compat byte**). Robuste : tout en
  try/catch, SSR-safe (`typeof document`), n'émet JAMAIS d'exception.
- `resetTenantBranding` : `removeProperty('--primary'/'--accent')` (rétablit
  `:root`), retire le `<link>` favicon override, retire le suffixe titre.
  Idempotent.

**Corps RÉEL posé par Phase A** (helper simple, complet). Manager-C l'APPELLE,
ne le MODIFIE PAS. **FIGÉ.**

### §6.D — Routes worker (`src/worker.ts`, INTOUCHÉ — AUCUNE nouvelle route)

| Route | Méthode | Handler | Auth |
|---|---|---|---|
| `/api/clients/:id/branding` | GET | `handleGetClientBranding` | **clients.manage** + tenant |
| `/api/clients/:id/branding` | PATCH | `handleUpdateClientBranding` | **clients.manage** + tenant |
| `/api/clients/:id/custom-domain` | GET/POST/DELETE | `handle*CustomDomain*` | **settings.manage** + tenant (FLAG OFF) |

Toutes ces routes EXISTENT (worker.ts l.1320-1321 + bloc custom-domain). **`src/worker.ts`
n'est PAS touché ce lot.** **ZÉRO ajout à `ALL_CAPABILITIES`** (branding =
`clients.manage`, custom-domain = `settings.manage`, FIGÉES). Le footer email
(Manager-B) lit le branding via une requête D1 bornée tenant DANS workflows.ts —
PAS de nouvelle route.

### §6.E — i18n (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, FIGÉ Phase A)

Namespace `whitelabel.*`, **5 clés ADDITIVES ×4, parité STRICTE**, insérées
APRÈS `whitelabel.provisioning_disabled` :
`whitelabel.favicon`, `whitelabel.remove_powered_by`, `whitelabel.sender_name`,
`whitelabel.preview`, `whitelabel.applied`. fr-CA tutoiement / fr-FR vouvoiement.
**Zéro collision avec les 10 existantes ; aucune des 10 redéfinie.**
**Manager-B/C les CONSOMMENT, n'en AJOUTENT PAS** (i18n GELÉ Phase A). Source
VIVANTE = `src/lib/i18n/*.ts` (PAS `.json`).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned : **`src/worker/workflows.ts` UNIQUEMENT** —
  DANS le `case 'send_email'` (et, si trivial, `case 'send_internal_email'`) :
  - Lire le branding du tenant : `SELECT branding, logo_url FROM clients WHERE id = ?`
    bind `lead.client_id` (best-effort, try/catch ⇒ pas de branding ⇒ chemin
    actuel BYTE-IDENTIQUE). Parser le JSON `branding` (clés `company_name` |
    `companyName` en repli, `remove_powered_by`).
  - Ajouter un **footer HTML brandé** au `html` envoyé (concaténé APRÈS
    `interpolate(tpl.body_html)`) : nom commercial (`company_name`) + logo
    (`logo_url`) si présents. La mention « Propulsé par Intralys » est
    GARDÉE par défaut et **MASQUÉE ssi `remove_powered_by === true`**.
  - **GARDÉ BYTE-IDENTIQUE si pas de branding** : aucun `company_name`/`logo_url`
    ET `remove_powered_by` falsy ⇒ `html` INCHANGÉ (footer générique actuel /
    pas de footer ajouté), `from` INCHANGÉ. RÉUTILISER `resolveFromAddress`
    EXISTANT (flag OFF ⇒ `from` défaut). Manager-B PEUT enrichir
    `resolveFromAddress` avec `sender_name` **UNIQUEMENT si trivial ET sans
    activer le flag** (le `from` reste byte-identique tant que flag OFF).
  - **NE TOUCHE PAS** : le flag domaine (`WHITELABEL_*_ENABLED` RESTENT OFF), le
    chemin de tracking séquence (injectTracking), les INSERT messages, la
    signature `executeStep`, le moteur d'ordonnancement.
- **Manager-C (frontend)** owned :
  - **`src/components/layout/AppLayout.tsx`** — au boot (après résolution du
    sous-compte actif `getActiveSubAccount()`) : `getClientBranding(id)` →
    fusionner couleurs (`primary_color`/`accent_color`/`logo_url`) + méta
    désérialisée du JSON `branding` (`company_name`|`companyName`, `favicon`,
    `remove_powered_by`) en `TenantBranding` → **`applyTenantBranding(...)`**.
    Best-effort (jamais de throw, jamais bloquer le boot). `useTheme` (dark/light)
    INTOUCHÉ.
  - **`src/components/layout/Sidebar.tsx`** — remplacer le `<h1>Intralys</h1>`
    (l.202) + le chip logo par logo tenant (`logo_url`) + nom (`company_name`)
    CONDITIONNELS, **fallback Intralys** (gradient + « Intralys » + « CRM ») si
    pas de branding. Borné tenant (sous-compte actif).
  - **`src/components/settings/BrandingSettings.tsx`** — ajouter les champs
    `favicon` (Input/dropzone), toggle `remove_powered_by` (Switch), `sender_name`
    (Input) + un **aperçu** (`t('whitelabel.preview')`). ÉTENDRE `buildBrandingBody`
    + le parse de lecture pour sérialiser ces clés DANS le MÊME JSON `branding`
    (clés additionnelles, AUCUNE migration). Toast `t('whitelabel.applied')` à
    l'application.
  - **`src/index.css`** — piloter le footer PDF (l.2520 `body::after { content }`)
    par une **var CSS** (ex `content: var(--wl-powered-by, 'Généré par Intralys
    CRM — intralys.com')`) ; retrait CONDITIONNEL **NON destructif** (var = `''`
    masque le texte sans supprimer/casser la règle). ⚠ **`index.css` = Manager-C
    EXCLUSIF ce sprint.**
  - **Pages publiques** : branding best-effort SI trivialement disponible dans le
    payload existant ; sinon **STRETCH non bloquant** (documenter, ne pas forcer).
- **INTERDITS aux deux** : **`src/lib/api.ts`** (`ClientBranding` + helpers FIGÉS A),
  **`src/lib/types.ts`** (`ClientBrandingMeta`/`TenantBranding` FIGÉS A),
  **i18n ×4** (5 clés FIGÉES A), **`src/lib/applyBranding.ts`** (NEUF, FIGÉ A —
  Manager-C l'APPELLE, ne l'ÉDITE PAS), **`src/worker.ts`** (AUCUNE route),
  **`App.tsx`**, **migration / manifest** (AUCUNE — voir §1). **`workflows.ts` =
  Manager-B** (Manager-C ne le touche PAS) ; **`AppLayout.tsx` + `Sidebar.tsx` +
  `BrandingSettings.tsx` + `index.css` = Manager-C** (Manager-B ne les touche
  PAS). **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **AUCUNE migration** (§1) : `clients.branding` est un JSON EXTENSIBLE — les
   clés `favicon`/`sender_name`/`remove_powered_by` y vivent SANS `ALTER`.
   **Manifest INCHANGÉ** (reste seq 118). **NE PAS créer de `migration-*.sql`**
   ni d'entrée manifest.
2. **CHECK / FK INTOUCHABLES** : aucune contrainte ajoutée, aucune FK ce lot
   (et zéro DDL).
3. **FLAG DOMAINE INACTIF** : `WHITELABEL_PROVISIONING_ENABLED` /
   `WHITELABEL_DKIM_ENABLED` RESTENT OFF. `resolveFromAddress` ⇒ `from`
   byte-identique. **ZÉRO appel réseau, E4/E6 inactifs.**
4. **BRANDING BORNÉ TENANT — JAMAIS cross-tenant** : la propagation applique le
   branding du SEUL sous-compte actif (`getActiveSubAccount()` front /
   `lead.client_id` worker). `applyTenantBranding` n'applique que ce qu'on lui
   passe. Le footer email lit le branding de `lead.client_id` (borné).
5. **RÉTRO-COMPAT BYTE sans branding** : pas de branding ⇒ couleurs Intralys
   (vars `:root`), Sidebar « Intralys »/« CRM », favicon/title `index.html`,
   footer email générique, footer PDF « Généré par Intralys CRM », `from` défaut
   — TOUS INCHANGÉS. `applyTenantBranding(null/undefined/{})` = NO-OP total.
6. **FOOTER PDF — retrait NON destructif via var CSS** : piloter `content` par
   `var(--wl-powered-by, '<défaut Intralys>')` ; masquer = var `''`. **NE PAS
   supprimer la règle `body::after`** ni le défaut Intralys (fallback). Var
   absente ⇒ défaut Intralys affiché.
7. **CAPABILITY** : branding = **`clients.manage`**, custom-domain =
   **`settings.manage`** (FIGÉES). **ZÉRO ajout à `ALL_CAPABILITIES`.** Le footer
   email ne crée AUCUNE route/garde nouvelle (requête D1 bornée DANS workflows.ts).
8. **ALIAS** : imports worker **RELATIFS** (`./...`) ; front **`@/`**
   (`applyBranding`/`types` via `@/lib/...`). `worker.ts` INTOUCHÉ.
9. **i18n `.ts` (PAS `.json`)** — parité stricte **5 clés ×4**, GELÉE Phase A.
   Les 10 clés `whitelabel.*` existantes INTOUCHÉES (NON redéfinies). fr-CA
   tutoiement / fr-FR vouvoiement.
10. **`useTheme` dark/light INTOUCHÉ** : `applyTenantBranding` agit sur
    `--primary`/`--accent` via `style` inline sur `<html>` (override la cascade),
    SANS toucher `data-theme` ni `useTheme`. Les deux coexistent (le thème gère
    bg/text, le branding la teinte de marque).
11. **VALIDATION HEX** : couleurs posées UNIQUEMENT si `#rgb`/`#rrggbb` valide ;
    sinon var Intralys conservée (jamais de couleur cassée).
12. **`company_name` vs `companyName`** : `buildBrandingBody` sérialise
    historiquement `companyName` (camel). En LECTURE/propagation, accepter les
    deux (`company_name` canonique, `companyName` repli). AUCUNE migration de
    données (lecture tolérante).
13. **RÉUTILISER, PAS RECONSTRUIRE** : stockage seq 81 + JSON `branding`,
    `getClientBranding`/`updateClientBranding`, `resolveFromAddress`,
    `BrandingSettings` (éditeur + autosave + wizard), `getActiveSubAccount` —
    tout est RÉUTILISÉ. On AJOUTE la PROPAGATION (helper + appels + footers).

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `docs/LOT-WHITELABEL-APPLY.md` — ce document (§6 FIGÉ).
2. `src/lib/applyBranding.ts` — helper de propagation front (NEUF, FIGÉ A) :
   `applyTenantBranding` (couleurs `--primary`/`--accent` hex-validées, favicon
   `<link>` override, suffixe `document.title`) + `resetTenantBranding`. NO-OP
   rétro-compat byte si branding vide ; robuste (try/catch, SSR-safe).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `src/lib/types.ts` — interfaces ADDITIVES `ClientBrandingMeta` (forme du JSON
   `branding` désérialisé — tout optionnel, alias `company_name`/`companyName`)
   + `TenantBranding` (forme propagée front). Aucun type existant modifié ;
   `ClientBranding` (api.ts) INTOUCHÉ.
2. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 5 clés ADDITIVES `whitelabel.*`
   (`favicon`, `remove_powered_by`, `sender_name`, `preview`, `applied`) après
   `whitelabel.provisioning_disabled`, parité stricte ×4, fr-CA tutoiement /
   fr-FR vouvoiement. Les 10 clés existantes INTOUCHÉES.

Fichiers **NON touchés** (volontairement) :
- **AUCUNE migration**, **manifest INCHANGÉ** (reste seq 118) — voir §1.
- `src/lib/api.ts` (`ClientBranding` + helpers FIGÉS), `src/worker.ts` (routes
  branding/custom-domain EXISTENT).
- `src/worker/clients-admin.ts` (`resolveFromAddress` + handlers RÉUTILISÉS,
  flag OFF).
- `src/worker/workflows.ts` — owned Manager-B (Phase B).
- `src/components/layout/{AppLayout,Sidebar}.tsx`,
  `src/components/settings/BrandingSettings.tsx`, `src/index.css` — owned
  Manager-C (Phase B).
- `App.tsx`, `src/lib/useTheme.ts` (dark/light) — inchangés.

**Migration** : **AUCUNE** (DDL non requis — JSON `branding` extensible).
**Build** : non vérifié (VMware sans bun/node) — **délégué côté hôte**.

### Confirmations garde-fous
- **AUCUNE migration** : ZÉRO DDL, ZÉRO `migration-*.sql`, ZÉRO entrée manifest,
  manifest reste seq 118. `clients.branding` JSON extensible accueille les
  nouvelles clés. CHECK/FK INTOUCHABLES.
- **Existant INTOUCHÉ** : stockage seq 81 + JSON `branding`, `getClientBranding`/
  `updateClientBranding`, `resolveFromAddress` (flag OFF), `BrandingSettings`
  (éditeur), `useTheme` dark/light, `custom_hostnames` seq 94, les 10 clés i18n.
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **Capability** : branding `clients.manage`, custom-domain `settings.manage`
  (FIGÉES) — **ZÉRO ajout à `ALL_CAPABILITIES`**.
- **Flag domaine INACTIF** : `WHITELABEL_{PROVISIONING,DKIM}_ENABLED` OFF, `from`
  byte-identique, zéro réseau, E4/E6 inactifs.
- **Branding borné tenant** (jamais cross-tenant) : sous-compte actif front /
  `lead.client_id` worker.
- **Rétro-compat byte** : sans branding ⇒ couleurs Intralys, Sidebar « Intralys »,
  favicon/title index.html, footer email/PDF générique, `from` défaut — INCHANGÉS.
  `applyTenantBranding(null)` = NO-OP.
- **Footer PDF** : retrait NON destructif via var CSS (`--wl-powered-by`), défaut
  Intralys conservé en fallback.
- **i18n** : source VIVANTE `src/lib/i18n/*.ts`, parité 5 clés ×4.

### Écarts CODE > brief
- **`ClientBranding` vit dans `api.ts`, PAS `types.ts`** : le brief demandait
  d'« étendre `ClientBranding` (ou le type des métadonnées branding JSON) ». Comme
  `api.ts` est GELÉ Phase A, j'ai typé l'extension dans `types.ts` via DEUX
  interfaces ADDITIVES (`ClientBrandingMeta` = forme du JSON `branding` ;
  `TenantBranding` = forme propagée), SANS toucher `ClientBranding`. Aucun champ
  ajouté n'est une colonne DB — ce sont des clés du JSON extensible.
- **`buildBrandingBody` sérialise `companyName` (camelCase)**, pas `company_name`.
  `ClientBrandingMeta` tolère les DEUX graphies en lecture (alias), et la
  propagation/footer accepte `company_name` || `companyName` — lecture tolérante,
  AUCUNE migration de données. La graphie canonique exposée est `company_name`.
- **`applyTenantBranding` pose un `<link rel=icon id="wl-tenant-favicon">` dédié**
  (et ne réécrit pas un favicon `index.html` existant) : permet un
  `resetTenantBranding` propre sans détruire le favicon Intralys de base
  (rétro-compat byte au reset).
- **Couleur posée seulement si hex valide** (`#rgb`/`#rrggbb`) : un branding
  malformé conserve la couleur Intralys plutôt que de poser une valeur cassée.
