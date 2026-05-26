# LOT 3 — Sprint 21 : Onboarding durci

> Doc contrat §6 figé. Implémentation : Phase A (socle) + Phase B (Manager-B backend ∥ Manager-C frontend).
> Migration : seq119 — `migration-onboarding-harden-seq119.sql`.

## Objectif

Durcir le parcours d'onboarding existant (Sprint S8 unifié CRM+e-comm, seq76) :
- persister la checklist côté serveur (au lieu de localStorage seul)
- tracer les events de completion/skip pour analytics
- enrichir les empty states pages clés (Leads, Pipeline) avec guidage contextuel
- ajouter une page dédiée `/getting-started` regroupant la checklist enrichie
- auto-compléter les items CRM quand l'user fait l'action réelle (hook idempotent)

## Hors-scope (renvoyé)

- Stripe billing / plans → Sprint 22
- Audit trail étendu → Sprint 23
- Observabilité métriques → Sprint 24
- Refonte EmptyState global → Sprint 29

## §6 Contrats figés

### 6.1 SQL `migration-onboarding-harden-seq119.sql`

```sql
-- Sprint 21 — Onboarding durci : checklist serveur + events analytics
-- (2026-05-22). Durcit le parcours d'onboarding existant (S8 seq76) en
-- persistant la checklist côté serveur (au lieu de localStorage seul) et en
-- traçant les events de completion/skip pour analytics.
--
-- 100% ADDITIF : ALTER TABLE ADD COLUMN nullable sans DEFAULT non-constant,
-- CREATE TABLE IF NOT EXISTS. AUCUN CHECK modifié, AUCUN rebuild, AUCUN DROP.
-- Conventions : id TEXT DEFAULT (lower(hex(randomblob(16)))), timestamps
-- TEXT DEFAULT (datetime('now')) — JAMAIS unixepoch. Enums validés HANDLER.
--
-- Dépend de seq76 (migration-sprintS8-m1.sql) pour les colonnes additionnelles
-- sur onboarding_state, et chaîne sur seq118 (migration-catalog-seq118.sql).

-- Colonnes additives sur onboarding_state (seq76). Toutes nullables, pas de
-- DEFAULT non-constant ⇒ pas de rebuild SQLite, pas de CHECK touché.
ALTER TABLE onboarding_state ADD COLUMN checklist_items_json TEXT;
ALTER TABLE onboarding_state ADD COLUMN skipped_items_json TEXT;
ALTER TABLE onboarding_state ADD COLUMN skipped_at TEXT;
ALTER TABLE onboarding_state ADD COLUMN dismissed_at TEXT;
ALTER TABLE onboarding_state ADD COLUMN last_active_at TEXT;

-- Audit léger des transitions checklist. Enums (event_type, item_key) validés
-- côté HANDLER worker (pas de CHECK SQL — rétro-compat additive).
CREATE TABLE IF NOT EXISTS onboarding_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  item_key TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_onbevents_client ON onboarding_events(client_id);
CREATE INDEX IF NOT EXISTS idx_onbevents_user ON onboarding_events(user_id);
CREATE INDEX IF NOT EXISTS idx_onbevents_type ON onboarding_events(event_type);
```

### Manifest entry

```json
{ "seq": 119, "file": "migration-onboarding-harden-seq119.sql", "depends_on": ["migration-sprintS8-m1.sql", "migration-catalog-seq118.sql"], "objects": ["alter:onboarding_state", "table:onboarding_events", "index:onboarding_events"], "risk": "low" }
```

### 6.2 Types (`src/lib/types.ts`)

```ts
// Sprint 21 — Onboarding durci : items checklist côté serveur
export type OnboardingChecklistItemKey =
  | 'profile_completed'
  | 'leads_imported'
  | 'pipeline_configured'
  | 'team_invited'
  | 'integration_connected'
  | 'docs_visited'
  | 'ecommerce_catalog'
  | 'ecommerce_first_product'
  | 'ecommerce_channel';

export interface OnboardingChecklistItemState {
  done: boolean;
  skipped: boolean;
  completedAt: string | null;
  skippedAt: string | null;
  skipReason?: string;
}

export interface OnboardingChecklistResponse {
  items: Partial<Record<OnboardingChecklistItemKey, OnboardingChecklistItemState>>;
  total: number;
  completed: number;
  skipped: number;
  pct: number;
  lastActiveAt: string | null;
}
```

### 6.3 Schemas (`src/lib/schemas.ts`)

```ts
export const onboardingChecklistCompleteSchema = z.object({
  itemKey: z.string().min(1).max(60),
});
export const onboardingChecklistSkipSchema = z.object({
  itemKey: z.string().min(1).max(60),
  reason: z.string().max(280).optional(),
});
```

### 6.4 Routes worker à câbler dans `src/worker.ts`

```
GET  /api/onboarding/checklist             → 200 json({ data: OnboardingChecklistResponse })
POST /api/onboarding/checklist/complete    body { itemKey }            → 200 json({ data })
POST /api/onboarding/checklist/skip        body { itemKey, reason? }   → 200 json({ data })
POST /api/onboarding/checklist/reset                                   → 200 json({ data })
```

Toutes : `requireAuth` + `capGuard(auth, 'settings.manage')` (mode-agence-only — réutilise pattern `src/worker/catalog.ts:38-49`). Imports relatifs `./worker/onboarding`.

### 6.5 API front (`src/lib/api.ts`)

```ts
export async function getOnboardingChecklist(): Promise<ApiResponse<OnboardingChecklistResponse>>;
export async function completeOnboardingItem(itemKey: OnboardingChecklistItemKey): Promise<ApiResponse<OnboardingChecklistResponse>>;
export async function skipOnboardingItem(itemKey: OnboardingChecklistItemKey, reason?: string): Promise<ApiResponse<OnboardingChecklistResponse>>;
export async function resetOnboardingChecklist(): Promise<ApiResponse<OnboardingChecklistResponse>>;
```

### 6.6 Clés i18n (24 par catalogue × 4 = 96)

```
onboarding.checklist.crm_profile.label
onboarding.checklist.crm_profile.desc
onboarding.checklist.crm_leads.label
onboarding.checklist.crm_leads.desc
onboarding.checklist.crm_pipeline.label
onboarding.checklist.crm_pipeline.desc
onboarding.checklist.crm_team.label
onboarding.checklist.crm_team.desc
onboarding.checklist.crm_integration.label
onboarding.checklist.crm_integration.desc
onboarding.checklist.crm_docs.label
onboarding.checklist.crm_docs.desc
onboarding.checklist.action_skip
onboarding.checklist.action_complete
onboarding.checklist.action_reset
onboarding.checklist.empty_done
onboarding.guided_empty.step_label
onboarding.guided_empty.tips_title
onboarding.getting_started.title
onboarding.getting_started.subtitle
onboarding.getting_started.section_first_steps
onboarding.getting_started.section_go_further
onboarding.getting_started.section_explore
onboarding.getting_started.continue_setup
```

Parité stricte 4 catalogues : `fr-CA` (tutoiement), `fr-FR` (vouvoiement), `en`, `es`.

### 6.7 Stubs handlers worker (`src/worker/onboarding.ts`)

4 stubs ajoutés (Phase A) — Manager-B complétera la persistance D1 + audit events :

- `handleGetChecklist` → renvoie `EMPTY_CHECKLIST` (best-effort dégradé si migration seq119 absente).
- `handleCompleteChecklistItem` → valide body via `onboardingChecklistCompleteSchema`, vérifie `itemKey` ∈ `VALID_ITEM_KEYS`, renvoie `EMPTY_CHECKLIST`.
- `handleSkipChecklistItem` → idem, schéma `onboardingChecklistSkipSchema`.
- `handleResetChecklist` → renvoie `EMPTY_CHECKLIST`.

## Garde-fous

- Rétro-compat S8 absolue : `GET/PUT /api/onboarding/state` shape inchangée.
- `ALL_CAPABILITIES` figées : on réutilise `settings.manage`.
- Migration 100% additive : ALTER ADD COLUMN nullable, CREATE TABLE IF NOT EXISTS.
- i18n parité stricte 24 clés × 4 catalogues.
- E4/E6 = flag off (non concerné par Sprint 21).
- Best-effort dégradé : si la migration seq119 n'est pas jouée, les handlers retournent un shape vide valide (PAS 500).
