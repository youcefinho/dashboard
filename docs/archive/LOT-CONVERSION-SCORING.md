# LOT CONVERSION SCORING — scoring prédictif CALIBRÉ tenant (Sprint 13 : le scoring existe DÉJÀ avec coefficients UNIVERSELS codés en dur → on AJOUTE une calibration sur l'historique won/lost RÉEL du tenant + on câble la carte LeadPredictionCard + tri leads chauds, 100% ADDITIF, RÉUTILISANT lead-predict.ts EN LECTURE)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-AI-CONTENT.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE des fichiers RÉUTILISÉS,
> jamais le brief).

Sprint **100% ADDITIF**, **migration `migration-conversion-scoring-seq113.sql`**
(2 tables neuves). Le scoring lead existe DÉJÀ — **à RÉUTILISER EN LECTURE, NE PAS
réécrire** :
- `src/worker/scoring.ts` : règles de scoring (RÉUTILISÉ en lecture).
- `src/worker/lead-score.ts` : score 6 signaux (RÉUTILISÉ en lecture).
- `src/worker/lead-predict.ts` : proba conversion 30j déterministe + cache D1
  `lead_predictions` (seq 54). **READ-ONLY.**
- `src/worker/proactive-ai.ts` : pattern cron best-effort + bornage tenant +
  `leadProbability30d` (réplique déterministe). **READ-ONLY.**

**GAP comblé :** le scoring de conversion est aujourd'hui UNIVERSEL — les
coefficients `SOURCE_COEFFICIENTS` / `statusToProbability` sont **codés en dur,
identiques pour TOUS les tenants**. On AJOUTE une couche de **CALIBRATION par
tenant** : on agrège l'historique won/lost RÉEL du tenant (DÉTERMINISTE,
offline-safe, ZÉRO LLM) dans `conversion_baselines`, puis on AJUSTE la proba
déterministe existante par le taux de conversion observé. On **câble** la carte
`LeadPredictionCard` (existe, branchée nulle part) + un **tri « leads chauds »**.

Alias : imports worker **RELATIFS** (`./...`), JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi — à RÉUTILISER EN LECTURE)

### `src/worker/lead-predict.ts` (Sprint 49 M2.1 — cache `lead_predictions` seq 54)

```ts
// ⚠ TOUS MODULE-PRIVÉS (NON exportés) — Manager-B RÉPLIQUE la logique UNE fois
//   dans conversion-engine.ts (read-only), OU les utilise comme FALLBACK fixe.
//   proactive-ai.ts a DÉJÀ fait cette réplique (leadProbability30d) → s'en
//   inspirer (NE PAS l'importer : c'est aussi une réplique privée).

const SOURCE_COEFFICIENTS: Record<string, number> = {   // PRIVÉ, non exporté
  referral: 18, call: 14, email: 10, form: 8, webchat: 8,
  facebook_ads: 6, google_ads: 6, cold: -4,
};
function statusToProbability(status: string): number {  // PRIVÉ, non exporté
  // new:10 contacted:25 qualified:60 won:100 closed:100 lost:0 ; défaut 20
}
async function computeDeterministic(env, lead)           // PRIVÉ, non exporté
  : Promise<{ prediction: LeadPrediction; msgCount; tasksDone }>;
//   → lit messages (COUNT) + tasks done (COUNT), pondère activité/engagement/
//     stage/deal/source/tags, freshness exp(-days/14). probability30d clampé 0..100.

// SEUL export public :
export async function handleGetLeadPredict(env, auth, leadId): Promise<Response>;
//   GET /api/leads/:id/score-predict → { data: { probability30d, confidence,
//   suggestedActions, factors, computed_at, cached } }. Cache lead_predictions
//   (seq 54) TTL 6h. refineWithLLM optionnel (skip si USE_MOCKS/!ANTHROPIC_API_KEY).
```

⚠ **Le cache `lead_predictions` (seq 54) est INTOUCHABLE** — `conversion-engine.ts`
écrit dans une table NEUVE DISTINCTE `conversion_predictions` (seq 113).

### `src/worker/proactive-ai.ts` (seq 99 — pattern cron + réplique déterministe)

```ts
// Pattern cron best-effort RÉUTILISABLE comme modèle (NE PAS importer, répliquer) :
export async function runProactiveBatch(env): Promise<void>;
//   SELECT DISTINCT client_id FROM leads WHERE client_id IS NOT NULL LIMIT 50
//   → par tenant (try/catch isolé, WHERE client_id = ? partout). NE THROW JAMAIS.
async function leadProbability30d(env, lead): Promise<number>;  // réplique privée
//   réplique 1:1 computeDeterministic (ZÉRO LLM) — modèle pour Manager-B.
export { resolveAgencyId as resolveProactiveAgencyId };  // exporté (réutilisable)
```

### `src/components/panels/LeadPredictionCard.tsx` (existe — branchée NULLE PART)

```tsx
// PROPS ATTENDUES (CRUCIAL Manager-C — ne PAS changer la signature sans raison) :
interface LeadPredictionCardProps {
  leadId: string;
  localInput: Parameters<typeof predictLeadLocal>[0];  // fallback local déterministe
}
// La carte FETCH elle-même GET /api/leads/:id/score-predict (fetchLeadPredict du
// lib @/lib/leadPredict) au montage, fallback predictLeadLocal(localInput) si
// backend KO. Affiche : gauge proba, badge confiance, top-3 facteurs, 3 actions.
// i18n consommé : namespace 'panels.predict_*' (existant).
```
⚠ Cette carte cible aujourd'hui l'endpoint **`/score-predict`** (Sprint 49). Le
NOUVEL endpoint **`/conversion-score`** (Sprint 13) renvoie la proba CALIBRÉE
(`{ probability, calibrated, factors, confidence? }`). **Manager-C** câble la
carte dans `LeadDetail.tsx` et peut l'éditer pour AFFICHER la calibration (badge
`conversion.calibrated`, facteur « taux historique »).

### Tables NEUVES (seq 113 — manifestée)

```sql
conversion_baselines (id PK gen, client_id, agency_id, dimension, dimension_value,
  won_count DEFAULT 0, lost_count DEFAULT 0, conversion_rate REAL DEFAULT 0,
  sample_size INTEGER DEFAULT 0, computed_at)
conversion_predictions (id PK gen, lead_id, client_id, probability REAL DEFAULT 0,
  calibrated INTEGER DEFAULT 0, factors_json, computed_at)
```
Zéro FK / zéro CHECK : `dimension` (source|status|score_bucket|overall) validé
HANDLER. `calibrated` 0|1 validé HANDLER.

---

## §1 — MIGRATION (seq 113, ADDITIVE)

`migration-conversion-scoring-seq113.sql` (racine) — calque seq 99 (`churn_scores`)
/ seq 112 : 2 `CREATE TABLE IF NOT EXISTS` + 2 `CREATE INDEX IF NOT EXISTS`. id
randomblob, timestamps `datetime('now')`, client_id, **ZÉRO FK, ZÉRO CHECK, ZÉRO
DROP/RENAME/ALTER**. Index : `idx_conversion_baselines_client(client_id,
dimension)`, `idx_conversion_predictions_lead(lead_id)`. Manifestée
`docs/migrations-manifest.json` seq 113 (`depends_on:["migration-aicontent-seq112.sql"]`,
risk low). ⚠ **NE PAS écraser `lead_predictions` (seq 54)** — table NEUVE
DISTINCTE. **Manager-B/C n'y touchent PAS.**

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`**. **AUCUN helper n'envoie de `client_id`** (tenant re-borné worker-side).

```ts
// Score de conversion CALIBRÉ d'un lead (signature FIGÉE Phase A).
getLeadConversionScore(leadId: string)
  : Promise<ApiResponse<ConversionPrediction>>          // GET /leads/:id/conversion-score
// (Optionnel) baselines agrégées du tenant.
getConversionBaselines()
  : Promise<ApiResponse<{ baselines: ConversionBaseline[] }>>  // GET /conversion/baselines
```

### §6.B — Types (`src/lib/types.ts`, FIGÉS Phase A) — ApiResponse INCHANGÉ

```ts
export interface ConversionBaseline {
  id: string; client_id?: string | null; agency_id?: string | null;
  dimension: string; dimension_value: string;
  won_count: number; lost_count: number;
  conversion_rate: number; sample_size: number; computed_at?: string;
}
export interface ConversionPrediction {
  probability: number;          // 0..100, calibrée
  calibrated: number;           // 1 = base tenant a servi, 0 = fallback fixe
  factors: ConversionFactor[];
  confidence?: 'low' | 'medium' | 'high';
}
export interface ConversionFactor { label: string; impact: number; }
```

### §6.C — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

| Route | Méthode | Handler (`./worker/conversion-engine`) |
|---|---|---|
| `/api/leads/:id/conversion-score` | GET | `handleGetConversionScore(env, auth, leadId)` |

Placée **APRÈS `requireAuth`** (choke-point) et **juste après** la route Sprint 49
`/score-predict` (~worker.ts 2046, calque l'ordre des routes leads). Import
STATIQUE en tête (calque `handleGetLeadPredict`). capGuard `ai.use` appliqué
**DANS le handler** (pas dans le routeur). La route `/api/conversion/baselines`
(optionnelle) n'est **PAS** câblée Phase A — Manager-B peut l'ajouter à
`conversion-engine.ts` SI il pose aussi le dispatch (sinon laisser le helper
front inactif, sans erreur).

### §6.D — Cron (`src/worker.ts` `scheduled()`, FIGÉ Phase A)

```ts
ctx.waitUntil(
  import('./worker/conversion-engine')
    .then((m) => m.recomputeConversionBaselines(env))
    .then(() => undefined)
    .catch(() => undefined),
);
```
Placé juste après le bloc `proactive-ai` (calque EXACT). Best-effort : un échec
n'altère NI le cron NI les autres jobs.

### §6.E — Stubs (`src/worker/conversion-engine.ts` — owned Manager-B, stubs posés Phase A)

Signatures **FIGÉES Phase A**, corps Phase B. Type auth :
`ConversionAuth = CapAuth & { capabilities?: Set<string>; id?: string }`. Garde
`conversionCapGuard(auth, 'ai.use')` (mode-agence-only, calque
`proactiveCapGuard`). `resolveClientId(auth)` posé.

```ts
recomputeConversionBaselines(env): Promise<void>        // no-op best-effort → corps B
computeCalibratedProbability(env, lead)
  : Promise<{ probability: number; calibrated: number; factors: {label;impact}[] }>
handleGetConversionScore(env, auth, leadId): Promise<Response>
//   capGuard ai.use + corps stub json({ data: { probability:0, calibrated:0, factors:[] } })
//   + // Manager-B: corps réel
```

### §6.F — i18n (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, FIGÉ Phase A)

Namespace `conversion.*` — **9 clés ×4, parité STRICTE** : `probability`,
`calibrated`, `hot_leads`, `why`, `historical_rate`, `confidence_low`,
`confidence_medium`, `confidence_high`, `sample_size`. fr-CA tutoiement / fr-FR
vouvoiement. Clés AVANT usage. **Manager-C les CONSOMME, n'en AJOUTE PAS** (i18n
GELÉ Phase A). ⚠ Source VIVANTE = `src/lib/i18n/*.ts` (PAS `src/i18n/*.json`
legacy).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned : **`src/worker/conversion-engine.ts` UNIQUEMENT** :
  - **`recomputeConversionBaselines(env)`** : par tenant
    (`SELECT DISTINCT client_id FROM leads ... LIMIT 50`), agrège won/lost RÉELS
    (`GROUP BY source` / `status` / score_bucket) → conversion_rate + sample_size,
    **UPSERT idempotent** dans `conversion_baselines`
    (UNIQUE(client_id, dimension, dimension_value) — à créer/garantir côté UPSERT
    `ON CONFLICT`, ou stratégie delete+insert bornée tenant), **DÉTERMINISTE SQL
    pur** ;
  - **`computeCalibratedProbability(env, lead)`** : repart de la base déterministe
    lead-predict **EN LECTURE** (réplique `computeDeterministic` /
    `statusToProbability` / `SOURCE_COEFFICIENTS` UNE fois ici — comme
    `leadProbability30d` de proactive-ai —, ZÉRO LLM), **ajuste** par le
    `conversion_rate` observé du tenant pour la source / le bucket de score,
    **fallback** coefficients fixes si `sample_size < 10` (`calibrated = 0`),
    explicabilité **+facteur « taux historique source X% »** ;
  - **`handleGetConversionScore(env, auth, leadId)`** : lecture lead borné tenant
    + cache `conversion_predictions` (lookup / upsert, sérialise `factors_json`).
  - Borné tenant (`WHERE client_id = ?`), **best-effort**, **ZÉRO LLM dur**.
    capGuard `ai.use`. **NE PAS casser** scoring.ts / lead-score.ts /
    lead-predict.ts / proactive-ai.ts ni triggers `lead_score_changed` /
    `score_threshold` ni cache `lead_predictions` (seq 54). + tests `__tests__/`.
- **Manager-C (frontend)** owned :
  - **câbler `src/components/panels/LeadPredictionCard.tsx`** (existante) dans
    **`src/pages/LeadDetail.tsx`** via `getLeadConversionScore` (Manager-C PEUT
    éditer `LeadPredictionCard.tsx` si besoin d'afficher la calibration — badge
    `conversion.calibrated`, facteur « taux historique ») ;
  - **badge proba + tri « leads chauds »** dans **`src/pages/Leads.tsx`** +
    **`src/pages/Pipeline.tsx`**. Consomme les helpers §6.A + i18n `conversion.*`.
- **INTERDITS aux deux** : migration, manifest, **`src/lib/types.ts`**,
  **`src/lib/api.ts`**, **`src/worker.ts`**, **i18n ×4**, **`src/index.css`**,
  **`src/i18n/*.json`** (legacy) ; **scoring.ts** / **lead-score.ts** /
  **lead-predict.ts** / **proactive-ai.ts** (RÉUTILISÉS en lecture/import — NON
  modifiés) ; cache **`lead_predictions`** (seq 54, INTOUCHABLE). E4/E6 inactifs.
  `conversion-engine.ts` = **Manager-B** ;
  `LeadDetail.tsx` / `Leads.tsx` / `Pipeline.tsx` / `LeadPredictionCard.tsx` =
  **Manager-C**. **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **Manifest seq 113 — chemin MANIFEST-DRIVEN, PAS le fallback.** L'entrée
   seq 113 est posée Phase A (NE PAS la modifier). `scripts/migrate.ts` est FIGÉ :
   le fichier `migration-conversion-scoring-seq113.sql` DOIT figurer au manifest
   (sinon erreur DURE « ABSENT du manifest » ou fallback 5-buckets qui ne sait pas
   l'ordonner). ✔ vérifié : virgule seq 112 ajoutée, JSON valide.
2. **CHECK / FK INTERDITS** dans la migration (additif pur — `dimension` /
   `calibrated` validés HANDLER). Zéro DROP / RENAME / ALTER.
3. **NE PAS écraser le cache `lead_predictions` (seq 54)** — la table NEUVE
   `conversion_predictions` est DISTINCTE.
4. **DÉTERMINISTE, offline-safe** : ZÉRO dépendance LLM dure (pas de
   refineWithLLM, pas d'appel Claude obligatoire). Mock/fallback déterministe,
   jamais 500 brut.
5. **Cron best-effort, borné tenant** : `.then(()=>undefined).catch(()=>undefined)`,
   `WHERE client_id = ?`, `LIMIT 50`. NE THROW JAMAIS.
6. **RÉUTILISER, PAS TRIPLER la base déterministe** : `computeDeterministic` est
   PRIVÉ ⇒ Manager-B le RÉPLIQUE UNE seule fois dans conversion-engine.ts (modèle
   `leadProbability30d` de proactive-ai), puis CALIBRE par-dessus. NE PAS dupliquer
   ailleurs.
7. **Capability `ai.use` RÉUTILISÉE** — ZÉRO ajout à `ALL_CAPABILITIES`.
8. **Alias relatifs worker** (`./...`), front `@/`.
9. **i18n `.ts` (PAS `.json`)** — `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, parité
   stricte (9 clés ×4), GELÉE Phase A.

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `migration-conversion-scoring-seq113.sql` — 2 tables (`conversion_baselines`,
   `conversion_predictions`) + 2 index, ADDITIF (calque seq 99/112). Zéro
   FK/CHECK/ALTER. Ne touche PAS `lead_predictions` (seq 54).
2. `src/worker/conversion-engine.ts` — 3 stubs (`recomputeConversionBaselines`,
   `computeCalibratedProbability`, `handleGetConversionScore`), signatures FIGÉES,
   capGuard `ai.use`, `conversionCapGuard` / `resolveClientId` posés, corps stub
   `json({ data: { probability:0, calibrated:0, factors:[] } })` +
   `// Manager-B: corps réel`. Calque proactive-ai.ts.
3. `docs/LOT-CONVERSION-SCORING.md` — ce document (§6 FIGÉ).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `docs/migrations-manifest.json` — entrée seq 113 (virgule seq 112 ajoutée,
   JSON valide vérifié, `depends_on:["migration-aicontent-seq112.sql"]`).
2. `src/lib/types.ts` — `ConversionBaseline`, `ConversionPrediction`,
   `ConversionFactor` (NEUFS). ApiResponse INCHANGÉ.
3. `src/lib/api.ts` — `getLeadConversionScore` + `getConversionBaselines` (NEUFS) ;
   import des 2 types ajouté. apiFetch/ApiResponse INCHANGÉS. AUCUN client_id envoyé.
4. `src/worker.ts` — import statique `handleGetConversionScore` + route GET
   `/api/leads/:id/conversion-score` (après `/score-predict`) + cron
   `recomputeConversionBaselines` dans `scheduled()` (après proactive-ai,
   best-effort).
5. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — namespace `conversion.*` (9 clés ×4,
   parité stricte vérifiée, clés AVANT usage, fr-CA tutoiement / fr-FR vouvoiement).

**Migration** : seq 113 ADDITIVE, manifestée (manifest-driven). **Build** : non
vérifié (VMware sans bun/node) — **délégué côté hôte**.

### Confirmations garde-fous
- **Migration ADDITIVE** : 2 `CREATE TABLE IF NOT EXISTS` + 2 index, zéro
  FK/CHECK/DROP/RENAME/ALTER. Manifest seq 113 (depends_on seq 112) valide,
  manifest-driven (pas le fallback).
- **`lead_predictions` (seq 54)** : INTOUCHÉ — `conversion_predictions` DISTINCTE.
- **Scoring RÉUTILISÉ** : scoring.ts/lead-score.ts/lead-predict.ts/proactive-ai.ts
  INTOUCHÉS (lecture/réplique uniquement) ; triggers lead_score_changed /
  score_threshold INTOUCHÉS.
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **`ai.use`** réutilisée — ZÉRO ajout à `ALL_CAPABILITIES`.
- **Déterministe, offline-safe** : ZÉRO LLM dur ; cron best-effort
  `.catch(()=>undefined)` borné tenant `WHERE client_id = ?` LIMIT 50.
- **i18n** : source VIVANTE `src/lib/i18n/*.ts` (PAS `src/i18n/*.json` legacy).

### Écarts CODE > brief
- `computeDeterministic` / `statusToProbability` / `SOURCE_COEFFICIENTS` de
  lead-predict.ts sont **MODULE-PRIVÉS (NON exportés)** — Manager-B doit les
  **RÉPLIQUER** dans conversion-engine.ts (modèle existant : `leadProbability30d`
  de proactive-ai, qui est aussi une réplique privée). Aucun import direct possible.
- Route worker câblée via **import STATIQUE** en tête (calque
  `handleGetLeadPredict` Sprint 49), tandis que le **cron** utilise un **import
  dynamique** `import('./worker/conversion-engine')` (calque EXACT proactive-ai).
- `getConversionBaselines()` (helper optionnel) est posé côté front, mais la route
  `/api/conversion/baselines` n'est **PAS** câblée Phase A (Manager-B la pose s'il
  en a besoin, avec son dispatch).
- `conversion_predictions.lead_id` n'a **pas** d'index UNIQUE Phase A (calque le
  brief : index simple `(lead_id)`). Manager-B gère l'idempotence du cache par
  delete+insert OU ajoute son `ON CONFLICT` applicatif sans ALTER de schéma.
