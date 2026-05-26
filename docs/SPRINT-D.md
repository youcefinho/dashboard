# SPRINT-D — LOT D « Robustesse / Data / Observabilité / Perf »

> GIGA-PLAN-V2 §3 LOT D (S-D1→S-D4). Méthode 18 agents.
> Phase A = Manager A (ce doc + `lib/fetch-timeout.ts` + dispatch worker.ts).
> Phase B = Manager B (observabilité) ∥ Manager C (data/résilience), DISJOINTS.
> VM VMware : fichiers seulement. Build/tests délégués Antigravity — JAMAIS
> prétendre vert sans exécution réelle.

---

## État Phase A (livré par Manager A)

| Fichier | Action |
|---|---|
| `src/worker/lib/fetch-timeout.ts` | **CRÉÉ** — wrapper fetch borné AbortController (pur, 0 dep cross-module) |
| `src/worker.ts` | **MODIFIÉ** — import `handleAdminWebVitals` + dispatch `GET /api/admin/web-vitals` (garde admin LOCALE) |
| `docs/SPRINT-D.md` | **CRÉÉ** — ce doc, §6 figé |
| `src/worker/__tests__/sd-a-backend.test.ts` | **CRÉÉ** — tests fetchWithTimeout + garde 403 (NON exécutés, VM) |

**Décision migration : AUCUNE.** Preuve : `migration-sprintS9-m1.sql:65-77`
crée `web_vitals(metric_name TEXT, value REAL, created_at TEXT, ...)` AVEC
`idx_web_vitals_created_at` + `idx_web_vitals_metric` (lignes 76-77). L'endpoint
web-vitals groupe par `metric_name` filtré sur `created_at` → les deux colonnes
sont déjà indexées par S9. Aucun index additif utile. `feature_events`
(`migration-sprint46-m2.sql:23-25`) déjà indexé feature/user/time — non touché.
**Seq 1-77 INTACTS. LOT D = 0-migration** (comme LOT B).

**Handoff dispatch** : au moment de l'écriture, `src/worker/observability-ops.ts`
**n'existe pas encore** (créé par Manager B en Phase B). L'import et le dispatch
dans `worker.ts` sont écrits selon la signature contractuelle §6.3 ci-dessous.
→ Le build sera ROUGE tant que Manager B n'a pas créé `observability-ops.ts`
exportant `handleAdminWebVitals`. C'est attendu : Phase B le résout.

---

## §6 Contrats figés

> Copiable VERBATIM. B et C consomment cette section, ne la modifient JAMAIS.

### §6.1 — `fetchWithTimeout` (importé par B et C)

Module : `src/worker/lib/fetch-timeout.ts` (créé Phase A, FIGÉ).

```ts
export async function fetchWithTimeout(
  input: RequestInfo,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<Response>
```

- Import depuis B/C : `import { fetchWithTimeout } from './lib/fetch-timeout';`
  (chemin relatif depuis `src/worker/*` ; depuis `src/worker/lib/*` →
  `'./fetch-timeout'`).
- Résout la `Response` si le fetch aboutit avant `timeoutMs`.
- Rejette (`throw new Error`) si réseau KO **ou** timeout (`AbortError` →
  message `Timeout après <timeoutMs>ms`).
- `clearTimeout` TOUJOURS appelé (succès + échec). Zéro timer fuyant.
- **Propage l'erreur telle quelle. L'APPELANT garde son `try/catch`
  best-effort existant — ZÉRO changement de logique métier.**
- Pur : aucune dépendance cross-module, aucun accès DB/env.

### §6.2 — Erreurs & JSON (transverse B/C)

- Format d'erreur : `{ error: <string>, code? }` — le front lit `data.error`
  string brute. JAMAIS d'objet imbriqué dans `error`.
- Réutiliser `json()` de `src/worker/helpers.ts` (FIGÉ) :
  `import { json } from './helpers';`. Ne PAS réimplémenter de Response JSON.
- Convention DB (rappel) : `id TEXT DEFAULT (lower(hex(randomblob(16))))`,
  timestamps `TEXT DEFAULT (datetime('now'))`, JAMAIS `unixepoch()`.

### §6.3 — Endpoint `GET /api/admin/web-vitals` (Manager B implémente)

**Manager B crée** `src/worker/observability-ops.ts` exportant :

```ts
export async function handleAdminWebVitals(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response>
```

Contrat OBLIGATOIRE (le dispatch worker.ts est déjà câblé sur cette signature) :

- **Garde admin** : `auth.role ∈ {'admin','owner'}` sinon
  `json({ error: 'Accès réservé aux administrateurs.' }, 403)`.
  (Le dispatch worker.ts rend DÉJÀ la 403 en amont — réplique locale du patron
  `admin-analytics.ts:16-23`. B re-vérifie : défense en profondeur, jamais
  supprimer la garde côté handler.)
- **Paramètre** : `?period=24h|7d|30d`, défaut `7d`, valeur invalide → `7d`.
- **Source** : table `web_vitals` (créée S9 `migration-sprintS9-m1.sql:65`).
  Colonnes réelles : `metric_name TEXT`, `value REAL`, `created_at TEXT`
  (`datetime('now')`). Filtrer par `created_at >= datetime('now', '-N ...')`.
  Agréger : `COUNT(*)`, `AVG(value)`, p75 (approx acceptable via
  `ORDER BY value` + offset, ou bucketisation — au choix de B, documenter).
- **Réponse succès** (status 200) :
  ```json
  {
    "data": {
      "metrics": [
        { "metric_name": "LCP", "count": 0, "avg": 0, "p75": 0 }
      ],
      "period": "7d",
      "since": "2026-05-10T00:00:00Z"
    }
  }
  ```
- **Robustesse** : table absente / DB throw → `json({ data: { metrics: [],
  period, since } })` (200). **JAMAIS 500, JAMAIS 503.** try/catch best-effort.
- Pas de mutation. Lecture seule. Garde admin LOCALE (pas d'import
  cross-module du `requireAdmin` de admin-analytics.ts — copier le pattern).

### §6.4 — `/api/health` (Manager B — additif best-effort UNIQUEMENT)

Shape S10 FIGÉ (`src/worker/health.ts`, lu Phase A) — **INCHANGÉ** :

```
{ status, db, version: '2.1.0', uptime_s }   (+ migrations_count déjà additif S10)
```

- Manager B peut ajouter des champs **strictement additifs best-effort**
  (try/catch, champ OMIS si échec). JAMAIS modifier/supprimer `status`, `db`,
  `version`, `uptime_s`, `migrations_count`. JAMAIS 503 nouveau. JAMAIS
  changer le code HTTP du chemin succès.
- **Par défaut : NE RIEN AJOUTER** si pas de valeur ops claire et bon marché.
  Tout ajout = même garde-fou que `migrations_count` (health.ts:18-33).

### §6.5 — Manager C (data intégrité + résilience)

- **Crée** `src/worker/data-reconcile.ts` NEW : job **READ-ONLY** de
  réconciliation (FK orphelines, rapport `COUNT(*)`). Garde admin LOCALE
  (`auth.role ∈ {admin,owner}` → 403 sinon, format §6.2). **ZÉRO mutation**
  (aucun INSERT/UPDATE/DELETE). Réponse `{ data: { orphans: [...] } }` (200),
  table absente → liste vide jamais 500. Réutiliser `json()`.
- **Wrap `fetch` chirurgical** via `fetchWithTimeout` (§6.1) dans `ai.ts`,
  `push.ts`, `tracking.ts` : remplacer l'appel `fetch(...)` par
  `fetchWithTimeout(...)` SANS toucher au reste. Le `try/catch` best-effort
  EXISTANT de chaque module est PRÉSERVÉ tel quel (il capte l'erreur
  propagée). Logique métier 100% inchangée. Aucune signature publique modifiée.
- **Docs** : `docs/DATA-INTEGRITY-S-D2.md`, `docs/RESILIENCE-S-D4.md`.

### §6.6 — Interdits (tous Managers LOT D)

- 🚫 Toucher migrations 1-77, `scripts/migrate.ts`, `schema.sql` (ALTER/DROP),
  `wrangler.jsonc`, `vite.config.*`.
- 🚫 Toucher helpers figés : `schemas.ts`+`validate()`, `validate-response.ts`,
  `error-response.ts`, `logger.ts`, `audit()`, `secret-store.ts`,
  `webVitals.ts`, `telemetry.ts`, `migrate.ts`, `_helpers.ts`.
- 🚫 E4/E6 régulés : `stripe-provider*`, `ecommerce-payments/refunds/disputes`,
  `payments_live_enabled` reste `0`.
- 🚫 6 pages CRM restaurées (zone R), i18n (LOT D = backend, 0 texte i18n),
  `mockData.ts`, `api.ts` fallback.
- 🚫 Manager A n'écrit PAS les fichiers de B/C ; B/C n'écrivent PAS hors de
  leur scope §6. 1 seul agent par fichier.
- Migration (si jamais nécessaire) : `CREATE INDEX/TABLE IF NOT EXISTS` only,
  prouver la colonne existe par grep. ALTER/DROP interdit. **LOT D recommandé
  0-migration** (S9 a déjà tout indexé — décision Phase A confirmée).

---

**§6 FIGÉ → Phase B peut démarrer** (Manager B ∥ Manager C, fichiers disjoints).
