# PERF-S9 — Sprint S9 « Perf à l'échelle » (Manager A, Phase A)

> Doc additif. Phase A SOLO (Manager A) : contrats figés transmis VERBATIM aux
> Managers B/C en Phase B. Le **§6 ci-dessous est la source de vérité** — toute
> divergence vs proposition Chaman est justifiée et tracée.
>
> Statut : contrats ARRÊTÉS. Tests écrits NON exécutés (VM VMware).

## 1. Périmètre livré (Manager A)

| Fichier | Type | Résumé |
|---|---|---|
| `migration-sprintS9-m1.sql` | NOUVEAU (seq 77) | 8 index (leads ×5, tasks ×2, order_items ×1) + table `web_vitals` + 2 index. 100% additif `IF NOT EXISTS`. |
| `docs/migrations-manifest.json` | APPEND seq 77 | entrée seq 77 (seq 1-76 intacts). |
| `docs/MIGRATIONS-INVENTORY.md` | APPEND 1 ligne | ligne sprintS9-m1. |
| `docs/MIGRATIONS-ORDER.md` | APPEND 1 ligne | ligne seq 77. |
| `src/worker/leads.ts` | MODIF chirurgicale | pagination opt-in additive sur `handleGetClientLeads` UNIQUEMENT. `handleGetLeads` admin INTOUCHÉ. |
| `src/worker/telemetry.ts` | NOUVEAU | `handlePostWebVitals` (beacon best-effort). |
| `src/worker.ts` | MODIF 1 bloc | dispatch `POST /api/telemetry/web-vitals` en zone publique neutre (après `/api/health`, avant webhooks — hors blocs R/ecommerce/admin). |
| `src/worker/__tests__/s9-backend.test.ts` | NOUVEAU | rétro-compat pagination + beacon. |

---

## 6. Contrats figés (transmis VERBATIM B/C)

### 6.1 Migration `migration-sprintS9-m1.sql` (seq 77, 100% additif)

**Preuves d'existence des colonnes indexées (grep ligne-à-ligne, source réelle) :**

| Colonne | Existence vérifiée | Index existant ? |
|---|---|---|
| `leads.client_id` | `schema.sql:37` — `client_id TEXT NOT NULL REFERENCES clients(id)` | NON |
| `leads.status` | `schema.sql:44` — `status TEXT CHECK (...) DEFAULT 'new'` | NON |
| `leads.created_at` | `schema.sql:66` — `created_at TEXT DEFAULT (datetime('now'))` (bloc table leads 35-…) | NON |
| `tasks.client_id` | `migration-phase5.sql:43` — `client_id TEXT` | NON (existants : assigned_to, status, due_date, lead_id — phase5:49-52) |
| `tasks.created_at` | `migration-phase5.sql:46` — `created_at TEXT DEFAULT (datetime('now'))` | NON |
| `order_items.variant_id` | `migration-sprintE1-m1-ecommerce-schema.sql:198` — `variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL` | NON (seul `idx_order_items_order` sur order_id, E1-m1:209) |
| ~~`order_items.product_id`~~ | **ABSENTE** — `order_items` (E1-m1:195-207) = id, order_id, variant_id, *_snapshot, *_cents, quantity, created_at. **AUCUN product_id.** | — |

**⚠️ ÉCART vs proposition Chaman (justifié) :** la proposition demandait
`idx_order_items_product (order_items.product_id)`. La colonne **`product_id`
n'existe pas** dans `order_items`. Un `CREATE INDEX` sur colonne inexistante
fait échouer **TOUTE** la migration D1. → ligne **retirée**, remplacée par
`idx_order_items_variant ON order_items(variant_id)` (colonne réelle E1-m1:198,
sémantiquement équivalente pour les jointures produit via `product_variants`).

**SQL final (copiable) — corps exécutable de `migration-sprintS9-m1.sql` :**

```sql
-- ── 1. Index leads (handleGetClientLeads + reports.ts) ──────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_client_id   ON leads(client_id);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_client_created ON leads(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_client_status  ON leads(client_id, status);

-- ── 2. Index tasks (filtres tenant + tri chrono) ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tasks_client_id  ON tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- ── 3. Index order_items (variant_id — product_id N'EXISTE PAS) ─────────────
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items(variant_id);

-- ── 4. Télémétrie Web Vitals (cible POST /api/telemetry/web-vitals) ─────────
CREATE TABLE IF NOT EXISTS web_vitals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  metric_name TEXT NOT NULL,
  value REAL NOT NULL,
  rating TEXT,
  url TEXT,
  session_id TEXT,
  client_id TEXT REFERENCES clients(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_web_vitals_created_at ON web_vitals(created_at);
CREATE INDEX IF NOT EXISTS idx_web_vitals_metric     ON web_vitals(metric_name);
```

Conventions : `id TEXT PK lower(hex(randomblob(16)))`, `created_at TEXT DEFAULT
(datetime('now'))` (JAMAIS unixepoch). `web_vitals.client_id` NULL autorisé
(beacon best-effort). FK `clients(id)` = bootstrap schema.sql (hors tracker).

**Entrée manifest finale (déjà appliquée, seq 1-76 intacts) :**

```json
{ "seq": 77, "file": "migration-sprintS9-m1.sql", "depends_on": ["migration-phase5.sql", "migration-sprintE1-m1-ecommerce-schema.sql"], "objects": ["index:leads", "index:tasks", "index:order_items", "table:web_vitals"], "risk": "low" }
```

> `depends_on` = tables tracker requises : `tasks` ← `migration-phase5.sql`
> (seq 5), `order_items` ← `migration-sprintE1-m1-ecommerce-schema.sql`
> (seq 58). `leads` + `clients` = bootstrap `schema.sql` (hors tracker, db:init)
> → pas de dépendance migration listée pour eux (convention manifest existante).

---

### 6.2 Pagination `handleGetClientLeads` (RÉTRO-COMPAT STRICTE, opt-in)

**Route :** `GET /api/clients/:clientId/leads` (`src/worker.ts:646`).
**Signature handler :** `handleGetClientLeads(env, auth, clientId, url: URL)` —
INCHANGÉE (le 4e param `url` existait déjà).

**Query params optionnels additifs :**

- `?limit=<n>` — borné `[1 .. 200]`. Hors borne → clampé. Absent (et offset
  absent) → comportement historique.
- `?offset=<n>` — `>= 0`. Négatif/NaN → `0`.
- Filtres existants `status` / `type` / `search` : INCHANGÉS, cumulables.

**Constantes :** `MAX_LIMIT = 200`, `DEFAULT_LIMIT = 200` (préserve le cap
historique dur de 200). Pattern `parsePaging` répliqué LOCALEMENT (aucun import
cross-module — aligné `ecommerce-orders.ts:81`).

**Forme de réponse :**

- `limit` ET `offset` **absents tous les deux** → chemin historique
  **byte-identique** : SQL `... ORDER BY created_at DESC LIMIT 200` (pas
  d'OFFSET, pas de COUNT), réponse :

  ```json
  { "data": [ /* Lead[] */ ] }
  ```

  (champs `total`/`limit`/`offset` **ABSENTS** — aucune régression front.)

- `limit` OU `offset` présent → mode paginé : SQL `... ORDER BY created_at DESC
  LIMIT ? OFFSET ?` + un `SELECT COUNT(*) FROM (<query filtré>)`, réponse :

  ```json
  { "data": [ /* Lead[] */ ], "total": 57, "limit": 20, "offset": 40 }
  ```

  `data` TOUJOURS présent, identique en forme. `total`/`limit`/`offset` =
  champs **additifs** (jamais à la place de `data`).

**Exemple avant / après :**

| Requête | Réponse |
|---|---|
| `GET /api/clients/c1/leads` | `{ "data": [...≤200] }` (inchangé vs avant S9) |
| `GET /api/clients/c1/leads?status=new` | `{ "data": [...≤200] }` (inchangé) |
| `GET /api/clients/c1/leads?limit=20&offset=40` | `{ "data": [...≤20], "total": 57, "limit": 20, "offset": 40 }` |
| `GET /api/clients/c1/leads?offset=10` | `{ "data": [...≤200], "total": N, "limit": 200, "offset": 10 }` |

> `handleGetLeads` (admin, `leads.ts:99-168`, cursor-based) : **NON TOUCHÉ.**

---

### 6.3 Endpoint `POST /api/telemetry/web-vitals`

**Route :** `POST /api/telemetry/web-vitals` — dispatch `src/worker.ts` zone
publique neutre (juste après `/api/health`, avant le bloc webhooks).
**Non authentifié** (sendBeacon ne porte pas le cookie de session de façon
fiable). Handler : `handlePostWebVitals(request, env)` dans
`src/worker/telemetry.ts`.

**Body accepté :** `WebVitalMetric` (`src/lib/webVitals.ts:18-31`) =
`{ name, value, rating, delta, id, navigationType }`. Seuls `name` et `value`
sont requis fonctionnellement ; le reste est best-effort.

**Validation INLINE défensive** (PAS de `schemas.ts` — helper figé) :

- `name` ∈ `{ LCP, CLS, INP, TTFB, FCP }` (whitelist `webVitals.ts:14`) — sinon
  drop silencieux.
- `value` → `Number(...)`, doit être fini, **clampé** `[0 .. 600000]` — sinon
  drop si non fini.
- `rating` ∈ `{ good, needs-improvement, poor }` sinon `NULL`.
- `id` (≤128 car.) → `session_id`. URL → `Referer` header (≤512 car.) sinon
  `NULL`. `client_id` best-effort → `NULL` (table l'autorise).

**Persistance :** `INSERT INTO web_vitals (metric_name, value, rating, url,
session_id, client_id) VALUES (?,?,?,?,?,?)` — **best-effort, try/catch
silencieux** (table absente / DB down → avalé).

**Réponse :** **`204` systématique** dans TOUS les cas (succès, payload
invalide, JSON illisible, DB throw). Un beacon ne reçoit JAMAIS d'erreur
exploitable. (Le body `{ok:true}` est joint mais non lu par sendBeacon.)

---

## 7. Travaux Phase B délégués

### 7.1 Manager C — `src/lib/api.ts` (`getClientLeads`)

État actuel (`api.ts:741-752`) : `getClientLeads(clientId, params?: { status?,
type?, search? }): Promise<ApiResponse<Lead[]>>`. Lit `.data` via `apiFetch`.

**À faire (additif, rétro-compat) :**

- Étendre `params` avec `limit?: number` et `offset?: number` OPTIONNELS.
- Si présents : `searchParams.set('limit', String(params.limit))` /
  `set('offset', String(params.offset))`.
- **NE PAS** changer le type de retour de base : continuer à lire `.data`
  (`ApiResponse<Lead[]>`). `total`/`limit`/`offset` arrivent dans la réponse
  brute — si un appelant en a besoin, exposer une variante typée, mais **le
  contrat `.data` reste la lecture par défaut** (rétro-compat absolue front).
- Aucun appelant existant ne passe `limit`/`offset` → comportement inchangé.

### 7.2 Manager B/C — `src/main.tsx` (câblage report front existant)

`src/lib/webVitals.ts` est **figé (lecture seule)**. `reportToBackend` /
`initWebVitalsWithAlerts` POSTent déjà vers `/api/telemetry/web-vitals` (le
stub TODO `webVitals.ts:217-219,261`). L'endpoint existe maintenant.

**À faire :** vérifier dans `src/main.tsx` que le report Web Vitals front est
bien câblé sur le helper qui POST (`initWebVitalsWithAlerts` ou
`initWebVitals` + `reportToBackend`). Si déjà câblé → RAS (l'endpoint le
recevra). Si non câblé → câbler vers le helper existant **sans modifier
`webVitals.ts`**. NE PAS toucher `vite.config.ts` ni `webVitals.ts`.

---

## 8. INTERDICTIONS (rappel B/C — non négociable)

- 🚫 **JAMAIS** ouvrir en écriture : `src/pages/{Leads,Dashboard,LeadDetail,
  Tasks,Pipeline,Clients}.tsx` (6 pages bloquées sprint R — collision
  destructive).
- 🚫 **AUCUNE** clé i18n sous `leads.* / dashboard.* / tasks.* / pipeline.* /
  clients.* / leadDetail.*`.
- 🚫 NE PAS modifier helpers figés : `schemas.ts`+`validate()`,
  `validate-response.ts`, `error-response.ts`, `logger.ts`, `audit()`
  (`helpers.ts:70-86`), mock D1 `_helpers.ts`, `webVitals.ts`,
  `vite.config.ts`.
- 🚫 Zones E4/E6 paiement : intouchées.
- Migration : UNIQUEMENT `CREATE INDEX/TABLE IF NOT EXISTS`. Zéro ALTER/DROP.

---

## Activation (Rochdi)

> VM VMware = aucune commande jouée ici. Build/tests/migration NON exécutés.
> Étapes manuelles à faire sur la machine hôte, dans l'ordre, via les 5 gates
> du programme de renforcement.

1. **Build TypeScript** : `bun run build` — vérifier 0 erreur TS (nouveaux
   fichiers `telemetry.ts`, modifs `leads.ts` / `worker.ts`).
2. **Tests** : `bun run test src/worker/__tests__/s9-backend.test.ts` —
   rétro-compat pagination + beacon. (Écrits non exécutés.)
3. **Migration seq 77** (additif, idempotent, rejouable) :
   `npx wrangler d1 execute intralys-crm --file=migration-sprintS9-m1.sql --remote`
   ⚠️ Le runner `scripts/migrate.ts` n'ordonne PAS `migration-sprintS9-*`
   (bug runner connu, cf MIGRATIONS-ORDER.md §3 — patch = S2). Jouer en
   manuel `--remote` jusqu'au correctif runner.
4. **Vérif index appliqués** :
   `npx wrangler d1 execute intralys-crm --command "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_leads_%' OR name LIKE 'idx_tasks_%' OR name LIKE 'idx_order_items_variant' OR name LIKE 'idx_web_vitals_%';" --remote`
5. **Points testables réels (post-deploy worker) :**
   - `GET /api/clients/<id>/leads` (sans params) → réponse `{ data }` seule,
     identique à avant S9 (non-régression front).
   - `GET /api/clients/<id>/leads?limit=10&offset=0` → `{ data, total, limit,
     offset }`, `data.length ≤ 10`.
   - `POST /api/telemetry/web-vitals` body `{"name":"LCP","value":2400,
     "rating":"good"}` → `204`. Puis `SELECT COUNT(*) FROM web_vitals;` > 0.
   - `POST /api/telemetry/web-vitals` body `{"name":"FOO","value":1}` → `204`,
     aucune ligne insérée (whitelist).
   - Charger l'app en prod, ouvrir devtools réseau : un beacon
     `web-vitals` part au chargement et reçoit `204`.
6. **Gate régression perf (optionnel)** : `EXPLAIN QUERY PLAN` sur
   `SELECT * FROM leads WHERE client_id=? ORDER BY created_at DESC LIMIT 200;`
   doit montrer `USING INDEX idx_leads_client_created` (au lieu de
   `SCAN leads`).

---

## 9 Suivi Phase B (Manager C)

> Section APPEND-only Manager C. Le §6 figé de A n'est pas édité.
> Scope C = §7.1 (`api.ts getClientLeads`) + §7.2 (vérif câblage `main.tsx`).
> VM VMware : tests écrits NON exécutés.

### 9.1 Fichiers livrés (Manager C)

| Fichier | Type | Résumé |
|---|---|---|
| `src/lib/api.ts` | MODIF additive | `getClientLeads` : params `limit?`/`offset?` optionnels + interface `PaginatedLeadsResponse extends ApiResponse<Lead[]>` (champs `total/limit/offset` optionnels). Émission opt-in via `!== undefined` (offset/limit `0` émis). |
| `src/main.tsx` | **NON MODIFIÉ** | Câblage Web Vitals **déjà présent** (l.128-131 `initWebVitalsWithAlerts({})`). RAS — voir 9.3. |
| `src/worker/__tests__/s9-frontend.test.ts` | NOUVEAU | Rétro-compat `getClientLeads` + contrat câblage telemetry. Collecté par glob vitest existant (`src/worker/__tests__/**/*.test.ts`). |
| `docs/PERF-S9.md` | APPEND §9 | Présent bloc. §6 figé intact. |

### 9.2 Rétro-compat `getClientLeads` — preuve appelants

- **Grep exhaustif `getClientLeads`** : 1 seul appelant front =
  `src/pages/ClientLeads.tsx:21` (PAS une des 6 pages R bloquées).
- `ClientLeads.tsx` lit uniquement `result.data` (l.26-27) et `result.error`
  ailleurs — il **ne passe jamais** `limit`/`offset` ⇒ query historique
  inchangée ⇒ réponse `{ data }` seule (byte-identique §6.2).
- Type retour `PaginatedLeadsResponse extends ApiResponse<Lead[]>` : strict
  super-type (ajoute seulement `total?/limit?/offset?` optionnels), assignable
  partout où `ApiResponse<Lead[]>` était attendu. Zéro rupture TS.
- `apiFetch` renvoie le JSON brut (`api.ts:67-73`) : `total/limit/offset`
  traversent déjà sans cast ; le typage les rend juste exploitables.

### 9.3 Statut câblage `main.tsx` (§7.2) — DÉJÀ CÂBLÉ, RAS

- `src/main.tsx:128` `import { initWebVitalsWithAlerts } from './lib/webVitals';`
- `src/main.tsx:129-131` `initWebVitalsWithAlerts({ /* sampleRate post-beta */ });`
- `webVitals.ts:224-267` `initWebVitalsWithAlerts` → `initWebVitals(cb)` → `cb`
  appelle `reportToBackend(m)` (l.264) → POST/`sendBeacon` vers
  `/api/telemetry/web-vitals` (l.189-207). L'endpoint de A reçoit le beacon.
- **`webVitals.ts` NON modifié** (figé lecture seule). `main.tsx` NON modifié
  (déjà correct). Aucune action C requise hormis vérification.

### 9.4 Sampling prod web-vitals — laissé tel quel (documenté)

`initWebVitalsWithAlerts` défaut `sampleRate = 100` (`webVitals.ts:232`,
100 % du trafic en beta). `main.tsx:130` garde le commentaire prêt
`// sampleRate: 10` à activer post-beta si trafic > ~1k DAU (cost/noise).
**Décision : ne rien changer maintenant** (beta = besoin de données pleines) ;
réglage opérationnel post-launch, hors scope code S9.

### 9.5 Gates Rochdi (rappel migration seq 77) + backlog post-R

5 gates programme de renforcement avant prod (cf §Activation 1-5) :

1. [ ] `bun run build` 0 erreur TS (inclut `api.ts` étendu + `s9-frontend.test.ts`).
2. [ ] `bun run test src/worker/__tests__/s9-frontend.test.ts` (+ `s9-backend`).
3. [ ] Migration seq 77 manuelle `--remote` (runner ne trie pas `sprintS9-*`,
       bug connu MIGRATIONS-ORDER.md §3 — patch S2).
4. [ ] Vérif index appliqués (`SELECT name FROM sqlite_master ...`).
5. [ ] Points testables post-deploy (§Activation 5) : `{ data }` seul sans
       params, `{ data,total,limit,offset }` avec params, beacon `204`.

**Backlog reporté post-R (NON fait sprint S9, collision 6 pages R) :**

- PageHero des 6 pages R (`Leads/Dashboard/LeadDetail/Tasks/Pipeline/Clients`)
  → reporté tant que sprint R verrouille ces fichiers.
- Namespaces i18n `leads.* / dashboard.* / tasks.* / pipeline.* / clients.* /
  leadDetail.*` → reporté (interdiction §8, débloqué après prérequis dur R).
- Consommation UI de `total/limit/offset` (pagination réelle dans
  `ClientLeads.tsx` ou pages R) → reporté : S9 livre le **transport** typé
  rétro-compat, le câblage UI viendra avec un sprint pagination dédié.
