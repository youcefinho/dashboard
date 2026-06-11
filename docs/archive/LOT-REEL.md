# LOT RÉEL — Anti-démo-ware front (Intralys)

Objectif : retirer le démo-ware visible (faux MRR, faux actifs, IA muette sans
signal, pagination leads inexistante côté UI, import GHL non exposé) **sans**
toucher la logique métier ni les contrats backend déjà figés.

Méthode 18 agents. Manager A (ce doc) porte les contrats partagés en Phase A
SOLO. **Le §6 ci-dessous est FIGÉ** — B et C consomment, ne renégocient pas.

---

## État Phase A (Manager A) — LIVRÉ

| Fichier | Action |
|---|---|
| `src/worker/ai.ts` | + `export function isAiMockMode(env)` (factorisé : `callLLM` réutilise `isAiMockMode`, logique IA inchangée) |
| `src/worker/health.ts` | + champ `ai_mock` dans `base` (propagé aux 2 retours succès), import `./ai` |
| `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` | + 32 clés (bloc additif fin de catalogue, parité stricte, `{{var}}`) |
| `src/worker/__tests__/health.test.ts` | + 3 tests `ai_mock` (assertions existantes intactes) |
| `src/worker/__tests__/ai.test.ts` | + 4 tests `isAiMockMode` (bloc additif) |
| `docs/LOT-REEL.md` | NEW (ce doc) |

Tests NON exécutés (VM VMware : fichiers seulement, build/tests délégués Antigravity).

---

## §6 Contrats figés

### §6.0 — Contrats Manager A (déjà livrés, B/C consomment tels quels)

**Signature `isAiMockMode`** (`src/worker/ai.ts`, exporté) :

```ts
export function isAiMockMode(env: Env): boolean {
  return env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY;
}
```

**Champ health** (`GET /api/health`, réponse succès JSON) — ADDITIF, snake_case, boolean :

```jsonc
{ "status": "ok", "db": "ok", "version": "2.1.0", "uptime_s": 12,
  "ai_mock": true,                 // ← NOUVEAU. true = IA en mode mock
  "migrations_count": 17 }         // (déjà existant, best-effort, peut être omis)
```

`ai_mock` est présent dans **les deux** retours succès (branche `migrations_count`
ET retour `base` simple). Le retour d'erreur 503 (`status:'error'`) est INCHANGÉ
(pas de `ai_mock`). Aucun champ existant retiré/renommé.

---

### §6.A — Manager B (Pagination leads + bannière IA mock)

**Fichiers EXCLUSIFS Manager B** : `src/lib/api.ts`, `src/pages/Leads.tsx`,
`src/components/ui/LoadMore.tsx` (NEW), + sa SmartBanner IA (composant à lui).

#### B.1 — `api.ts` : `getLeads` AJOUT params optionnels (ADDITIF strict)

Signature actuelle (NE PAS retirer de champs) :
```ts
export async function getLeads(params?: {
  status?: string; search?: string; source?: string;
  client_id?: string; tag?: string; sort?: string;
}): Promise<ApiResponse<Lead[]>>
```

AJOUTER deux params optionnels + élargir le retour :
```ts
export async function getLeads(params?: {
  status?: string; search?: string; source?: string;
  client_id?: string; tag?: string; sort?: string;
  limit?: number;        // NOUVEAU — passé en ?limit= si défini
  cursor?: string;       // NOUVEAU — passé en ?cursor= si défini
}): Promise<ApiResponse<Lead[]> & { next_cursor?: string | null }>
```

Rétro-compat ABSOLUE :
- `limit`/`cursor` ABSENTS → comportement actuel **byte-identique** (`.data`
  inchangé, aucun `?limit`/`?cursor` dans l'URL).
- Le backend `handleGetLeads` (`worker/leads.ts:133-201`) est **DÉJÀ**
  cursor-based (`cursor`/`limit`, renvoie `{ data, next_cursor }`). **NE PAS
  toucher le backend** — il est figé et fonctionnel.
- `next_cursor` se lit du JSON brut (champ additif). `result.data` inchangé.
  `next_cursor === null` ou absent ⇒ plus de page.
- Conserver le fallback `IS_DEV_BYPASS` MOCK_LEADS existant tel quel
  (pas de pagination sur le mock dev — acceptable).

⚠️ NE PAS confondre avec `getClientLeads` / `handleGetClientLeads` (offset-based,
contrat S9 `docs/PERF-S9.md` FIGÉ — interdit de toucher) ni `PaginatedLeadsResponse`
(typage offset existant — laisser tel quel, ne pas réutiliser pour le cursor).

#### B.2 — `api.ts` : `getAiStatus()` (NEW fonction)

```ts
export async function getAiStatus(): Promise<{ ai_mock: boolean }>
```
GET `/api/health` (réutilise `apiFetch`/fetch existant), lit `.ai_mock` de la
réponse JSON. Si réponse KO/champ absent ⇒ retourner `{ ai_mock: false }`
(défaut prudent : ne PAS afficher la bannière si on ne sait pas).

#### B.3 — `LoadMore` primitive (NEW `src/components/ui/LoadMore.tsx`)

Props EXACTES :
```ts
interface LoadMoreProps {
  onLoadMore: () => void;
  loading: boolean;
  hasMore: boolean;
  loadedCount: number;
  label?: string;        // défaut : t('leads.pagination.load_more')
}
```
Rendu attendu (libellés via i18n §6.D, jamais hardcodé) :
- `hasMore && !loading` → bouton `load_more` + sous-texte `loaded {{shown:loadedCount}}`
- `loading` → texte `loading`
- `!hasMore` → texte `all_loaded`

#### B.4 — `Leads.tsx` modif ADDITIVE contrainte

- ZÉRO `t()` existant touché/déplacé/supprimé. ZÉRO logique métier modifiée.
- AJOUT uniquement : (a) état pagination (cursor + accumulateur leads),
  (b) `<LoadMore>` en bas de liste, (c) `<SmartBanner>` IA mock en tête
  (visible seulement si `getAiStatus().ai_mock === true`, libellés
  `ai.mock.banner_title`/`ai.mock.banner_desc`, badge `ai.mock.badge`).
- `Leads.tsx` est la SEULE des 6 pages "R" autorisée à être modifiée
  (contrainte B), et UNIQUEMENT pour pagination + bannière IA.

---

### §6.C — Manager C (Import wizard GHL + analytics honnête)

**Fichiers EXCLUSIFS Manager C** : `src/worker/admin-analytics.ts`,
`src/pages/AdminOverview.tsx`, `src/pages/Settings.tsx`,
`src/components/settings/*` (composant import wizard NEW).

#### C.1 — Import wizard GHL (réutilise `<Wizard>` existant)

`<Wizard>` (`src/components/ui/Wizard.tsx`) EXISTE — l'utiliser tel quel
(`steps: WizardStep[]`, prop `embedded?: boolean` pour rendu intégré dans un
onglet Settings, persistKey/onStepChange dispo). **NE PAS recréer de wizard.**

4 steps : `upload` → `mapping` → `preview` → `confirm` (libellés
`migration_import.step.*`). API client à câbler dans `api.ts`… NON : `api.ts`
est exclusif Manager B. ⇒ **Manager C ajoute ses 2 fns dans son propre module**
(ex. `src/lib/migrationApi.ts` NEW, ou inline dans le composant via `apiFetch`).
Endpoints backend (DÉJÀ figés, NE PAS toucher `migration-ghl-csv.ts`) :

`ghlCsvPreview(clientId, csvData, fieldMapping?)`
→ POST `/api/migration/ghl/csv/preview`
body `{ client_id, csv_data, field_mapping? }`
réponse `{ data: { rows_total, rows_valid, rows_skipped, sample_first_10,
custom_fields_detected, conflicts: { duplicate_emails_in_csv, existing_contacts },
mapping_used } }`

`ghlCsvRun(clientId, csvData, fieldMapping)`
→ POST `/api/migration/ghl/csv/run`
body `{ client_id, csv_data, field_mapping }`
réponse `{ data: { session_id, imported, skipped, errors, log } }`

⚠️ Endpoint `/api/leads/import` : **NE PAS l'utiliser** — le chemin canonique
est `/api/migration/ghl/csv/{preview,run}`. Admin-only (403 sinon) — la
sélection client est obligatoire (`migration_import.client_required`).

#### C.2 — `Settings.tsx` : 1 onglet ADDITIF

Ajout STRICTEMENT additif d'un onglet `migration_import` :
- union de type des onglets : ajouter `'migration_import'` (ne renomme/retire
  aucun onglet existant) ;
- tableau TABS : ajouter une entrée (`label: t('migration_import.tab_label')`,
  `desc: t('migration_import.tab_desc')`) ;
- `switch`/`case` de rendu : ajouter `case 'migration_import'` → wizard import.
- ZÉRO onglet existant déplacé. Conformité Loi 25/CASL, TPS/TVQ Invoices,
  Mapbox Properties = NE PAS toucher.

#### C.3 — `admin-analytics.ts` : analytics RÉEL (retirer le démo-ware)

État actuel démo-ware confirmé (`handleAdminOverview`) :
- `:97` `activeMonthly: Math.floor((totalUsers || runningUsers) * 0.68)` ← FAUX
- `:100` `mrr: 8420` ← INVENTÉ

À remplacer (logique RÉELLE, additif sur le reste du handler) :
- `activeMonthly` = `SELECT COUNT(DISTINCT user_id) FROM feature_events
  WHERE event_time >= :since`. Si table `feature_events` absente / erreur ⇒
  `activeMonthly: null` (honnête, JAMAIS un proxy inventé). `since` = début du
  mois courant (epoch ms cohérent avec `event_time` INTEGER —
  cf `docs/TIMESTAMP-CONSISTENCY-MAP`).
- `leadsConversions` : déjà calculé réellement (`GROUP BY date(created_at)` sur
  leads, lignes 79-91) — **garder tel quel**, ne pas régresser.
- `mrr` (et tout delta/MRR dérivé) ⇒ `null` tant qu'aucune source de
  facturation réelle. JAMAIS un nombre en dur. Le front affiche
  `admin.mrr_unavailable` quand `mrr === null`.
- Ne pas inventer de deltas (% croissance) : `null` si non calculable réellement.

#### C.4 — `AdminOverview.tsx` : état honnête (retirer fallback silencieux)

- Retirer le fallback `generateMockOverview` **silencieux** : si l'API renvoie
  des champs `null`, afficher un état honnête (`admin.no_data_yet` /
  `admin.mrr_unavailable`) au lieu de fabriquer des chiffres.
- Quand les données sont réelles & présentes : badge `admin.data_real_badge`.
- Ne PAS supprimer l'affichage des métriques qui SONT réelles
  (`leadsConversions`, totaux leads) — seulement les fausses.

---

### §6.D — Clés i18n (FIGÉES, parité ×4, format `{{var}}`)

Les 32 clés existent **déjà** dans `fr-CA / fr-FR / en / es` (livrées Phase A,
bloc additif fin de catalogue). B/C les **consomment via `t()`**, n'en ajoutent
AUCUNE, n'en modifient AUCUNE. Toute nouvelle clé éventuelle = repasser par
Manager A (préserver la parité ×4 — leçon régression R).

**Pagination (Manager B)**
- `leads.pagination.load_more`
- `leads.pagination.loading`
- `leads.pagination.loaded` → `'{{shown}} leads chargés'`
- `leads.pagination.all_loaded`

**IA mock (Manager B)**
- `ai.mock.banner_title`
- `ai.mock.banner_desc`
- `ai.mock.badge`

**Import wizard (Manager C)**
- `migration_import.tab_label`
- `migration_import.tab_desc`
- `migration_import.step.upload`
- `migration_import.step.mapping`
- `migration_import.step.preview`
- `migration_import.step.confirm`
- `migration_import.upload.cta`
- `migration_import.upload.hint`
- `migration_import.client_required`
- `migration_import.preview.rows` → `'{{valid}} valides · {{skipped}} ignorées sur {{total}}'`
- `migration_import.preview.conflicts` → `'{{count}} doublons détectés'`
- `migration_import.run.success` → `'{{imported}} leads importés · {{skipped}} ignorés'`
- `migration_import.run.error`
- `migration_import.empty_title`
- `migration_import.error_title`
- `migration_import.next`
- `migration_import.back`
- `migration_import.finish`

**Analytics honnête (Manager C)**
- `admin.mrr_unavailable`
- `admin.no_data_yet`
- `admin.data_real_badge`

Interpolation : **`{{var}}`** uniquement (jamais `{var}` — bug attrapé LOT C).

---

### §6.E — INTERDITS (ne franchir sous aucun prétexte)

- 🚫 Les 6 pages "R" — **SAUF `Leads.tsx`** (Manager B, modif ADDITIVE
  pagination + bannière IA UNIQUEMENT, zéro `t()` existant touché).
- 🚫 Code stratégique : auth / signup / billing / provisioning / webhook.
- 🚫 E4 / E6 (régulés non-cleared-prod).
- 🚫 Helpers figés, migrations, `mockData.ts`, `wrangler.jsonc`.
- 🚫 Backend pagination leads : `worker/leads.ts` `handleGetLeads` /
  `handleGetClientLeads` (curseur + offset S9 déjà OK et figés).
- 🚫 Backend `worker/migration-ghl-csv.ts` (preview/run figés, fonctionnels).
- 🚫 Endpoint `/api/leads/import` — utiliser `/api/migration/ghl/csv/*`.
- 🚫 Fichiers exclusifs croisés : B ne touche pas `admin-analytics.ts` /
  `AdminOverview.tsx` / `Settings.tsx` / `components/settings/*` ;
  C ne touche pas `api.ts` / `Leads.tsx` / `components/ui/LoadMore.tsx`.
- 🚫 Catalogues i18n : seul Manager A y écrit (parité ×4 stricte).

---

**§6 FIGÉ → Phase B peut démarrer.**
