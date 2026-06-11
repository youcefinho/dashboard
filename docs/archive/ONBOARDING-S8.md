# Sprint S8 — Onboarding unifié CRM + e-commerce

Manager A (Phase A solo). Ce document fige les contrats partagés. La section
`## §6 Contrats figés` est transmise **verbatim** aux Managers B et C : tout y
est EXACT et copiable. Phase B (B + C) ne démarre qu'après lecture du §6.

## Contexte

L'onboarding (`WelcomeWizard.tsx`, Sprint 45) ne persistait RIEN côté serveur :
`handleWelcomeOnboarding` échouait silencieusement le payload (seuls
`users.name/email` + `onboarding_step`). L'état (étape, opt-in e-commerce,
payload) vivait uniquement en localStorage ⇒ perdu au changement d'appareil.

S8 ajoute, **strictement additif** :
- table `onboarding_state` (migration seq 76) ;
- `GET`/`PUT /api/onboarding/state` (reprise multi-appareil) ;
- persistance additive du payload dans `POST /api/onboarding` (réponse legacy
  **inchangée** — rétro-compat front Sprint 45 absolue) ;
- API front `getOnboardingState`/`putOnboardingState`.

Zones régulées : `ecommerce_opted_in` est un simple opt-in module. **Aucune
activation paiement** (E4/E6, `payments_live_enabled=0` jamais touché).

---

## §6 Contrats figés

> Section transmise verbatim à B et C. Tout est final.

### 6.1 — Schéma SQL `onboarding_state` (migration-sprintS8-m1.sql, seq 76)

`depends_on` = `migration-sprintE1-m2-modules-role.sql` (seq 59 — cette
migration RECONSTRUIT la table `users` via `rebuild:users`, donc la FK
`users(id)` doit pointer la table finale). FK `clients(id)` = table bootstrap
`schema.sql` (hors tracker), même cible que `migration-sprintS7-m1.sql:28`.

```sql
CREATE TABLE IF NOT EXISTS onboarding_state (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT NOT NULL REFERENCES clients(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  current_step INTEGER DEFAULT 0,
  completed_steps_json TEXT DEFAULT '[]',
  payload_json TEXT,
  ecommerce_opted_in INTEGER DEFAULT 0,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(client_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_onbstate_client ON onboarding_state(client_id);
CREATE INDEX IF NOT EXISTS idx_onbstate_user ON onboarding_state(user_id);
```

Entrée manifest (`docs/migrations-manifest.json`, APPEND seq 76 — déjà fait) :

```json
{ "seq": 76, "file": "migration-sprintS8-m1.sql", "depends_on": ["migration-sprintE1-m2-modules-role.sql"], "objects": ["table:onboarding_state"], "risk": "low" }
```

### 6.2 — Routes API + shape JSON exacte

Wirées dans `src/worker.ts` juste après `POST /api/onboarding` (Sprint 45).
Auth : `auth.userId`. Tenant résolu via `getClientModules(env, userId)` →
`{ clientId }` (pattern projet, multi-tenant strict). Filtre TOUJOURS
`(client_id, user_id)`.

**`GET /api/onboarding/state`** → `200`

```json
{ "data": {
  "currentStep": 0,
  "completedSteps": [],
  "ecommerceOptedIn": false,
  "completedAt": null,
  "payload": null
} }
```

Défaut exact ci-dessus si aucune ligne OU pas de tenant (jamais d'erreur sur
GET ; dégrade proprement si la migration n'est pas jouée).

**`PUT /api/onboarding/state`** body (tous champs optionnels, patch partiel
non destructif ; corps vide = no-op idempotent renvoyant l'état courant) :

```json
{ "currentStep": 2, "completedSteps": ["profile"], "ecommerceOptedIn": true, "payload": { } }
```

→ `200` : **même shape que GET** (`{ data: { currentStep, completedSteps,
ecommerceOptedIn, completedAt, payload } }`).
- Validation : `validate(onboardingStateSchema, body)` → si échec
  `validationError(v.error)` ⇒ `400 { error:<string>, code:'VALIDATION', fields?:[] }`.
- Pas de tenant ⇒ `400 { error:'Client introuvable', message:... }` (`error`
  reste **string** racine — rétro-compat front prouvée).
- Audit : `audit(env, userId, 'onboarding.state.update', 'onboarding_state',
  <row.id|clientId>, { currentStep, completedSteps:<count>, ecommerceOptedIn })`
  — **JAMAIS** le payload dans `details` (peut contenir email/nom).
- Upsert via `INSERT ... ON CONFLICT(client_id, user_id) DO UPDATE`.

**`POST /api/onboarding`** (Sprint 45) — ÉTENDU additivement : persiste
`payload_json` (= echo brut du body) + `ecommerce_opted_in`
(`businessType ∈ {'shop','hybrid'}` ⇒ 1, sinon 0) dans `onboarding_state`
(best-effort, catch silencieux si table absente). **La réponse
`{ data: { success:true, echo:{...} } }` ne change PAS de shape.**

### 6.3 — Schéma zod (src/lib/schemas.ts) — figé

```ts
export const onboardingStateSchema = z.object({
  currentStep: z.number().int().min(0).max(50).optional(),
  completedSteps: z.array(z.string().max(60)).max(50).optional(),
  ecommerceOptedIn: z.boolean().optional(),
  payload: z.unknown().optional(),
}).passthrough();
```

### 6.4 — API front (src/lib/api.ts) — signatures figées

`API_BASE` inclut déjà `/api` (chemins relatifs sans `/api`). `ApiResponse<T>`
= `{ data?: T; error?: string }` (le front lit `data.error` string brute).

```ts
export interface OnboardingState {
  currentStep: number;
  completedSteps: string[];
  ecommerceOptedIn: boolean;
  completedAt: string | null;
  payload: Record<string, unknown> | null;
}

export async function getOnboardingState(): Promise<ApiResponse<OnboardingState>>;
export async function putOnboardingState(
  patch: Partial<OnboardingState>,
): Promise<ApiResponse<OnboardingState>>;
```

Côté worker, le même shape est exporté : `import type { OnboardingStateShape }
from './onboarding'` (alias structurel identique à `OnboardingState`).

### 6.5 — Clés i18n racine RÉSERVÉES S8 (à peupler par Manager C)

Manager C peuple ces clés dans les **4 catalogues** :
`src/lib/i18n/fr-CA.ts`, `src/lib/i18n/fr-FR.ts`, `src/lib/i18n/en.ts`,
`src/lib/i18n/es.ts`.

**Nouvelles clés S8 (à CRÉER, namespace `onboarding.*` uniquement) :**

| Clé | Usage |
|---|---|
| `onboarding.step.region` | Libellé étape « Région » |
| `onboarding.step.ecommerce` | Libellé étape « Boutique » |
| `onboarding.step.channels` | Libellé étape « Canaux » |
| `onboarding.region.title` / `onboarding.region.description` | Écran région |
| `onboarding.region.*` | Sous-clés région (libellés pays/régime, libres) |
| `onboarding.ecommerce.title` / `onboarding.ecommerce.description` | Écran e-comm |
| `onboarding.ecommerce.payment_note` | **Mention obligatoire** : opt-in n'active aucun paiement |
| `onboarding.ecommerce.*` | Sous-clés e-commerce |
| `onboarding.channels.title` / `onboarding.channels.description` | Écran canaux |
| `onboarding.channels.shopify` / `onboarding.channels.woo` | Libellés canaux |
| `onboarding.channels.*` | Sous-clés canaux |
| `onboarding.checklist.*` | Checklist post-onboarding |
| `onboarding.resume.*` | Bandeau « reprendre où tu en étais » |

**Clés EXISTANTES à RÉUTILISER (NE PAS recréer — `fr-CA.ts:360-378`) :**
`onboarding.welcome`, `onboarding.subtitle`,
`onboarding.step.{profile,industry,goals,team}`,
`onboarding.{profile,industry,goals,team,demo}.{title,description}`,
`onboarding.complete.{start,import,success}`.

**Namespaces INTERDITS** (régression i18n CRM sprint R en cours — NE PAS
toucher, NE PAS ajouter de clés sous) :
`leads.*`, `dashboard.*`, `tasks.*`, `pipeline.*`, `clients.*`, `leadDetail.*`.

### 6.6 — Props `WelcomeWizard` figées (pour Manager B)

Fichier `src/components/onboarding/WelcomeWizard.tsx`. Props ACTUELLES à
**garder telles quelles** (rétro-compat) :

```ts
interface WelcomeWizardProps {
  open: boolean;
  onComplete: (payload: WelcomePayload) => void;
  initialEmail?: string;
  initialName?: string;
}
```

**Ajout autorisé pour B (optionnel, rétro-compat) :**

```ts
  initialState?: OnboardingState;   // hydrate la reprise (GET /onboarding/state)
```

`WelcomePayload` ACTUEL (à NE PAS casser ; champs existants conservés) :

```ts
export interface WelcomePayload {
  profile: WelcomeProfile;
  industry: WelcomeIndustry;
  businessType: WelcomeBusinessType;   // déjà présent (Sprint E1 M2.4)
  goals: WelcomeGoal[];
  teamSize: WelcomeTeamSize;
  invitedEmails: string[];
  withDemoData: boolean;
}
```

**Extension autorisée pour B (champs OPTIONNELS uniquement — rétro-compat) :**

```ts
  region?: string;                                              // code/région choisi
  channels?: { type: 'shopify' | 'woo'; shopDomain?: string }[]; // canaux pré-déclarés
```

Le backend `POST /api/onboarding` echo déjà le body entier dans `payload_json`
(les nouveaux champs sont persistés sans modification serveur supplémentaire).
`businessType ∈ {'shop','hybrid'}` reste le seul déclencheur de
`ecommerce_opted_in=1`.

---

## Activation (Rochdi)

Migration **seq 76** `migration-sprintS8-m1.sql` à jouer via le runner (après
correctif runner M1 / S2) ou manuellement :

```
npx wrangler d1 execute intralys-crm --file=migration-sprintS8-m1.sql --remote
```

Garde-fous (5 gates Rochdi avant prod — inchangés) :
- Migration **additive** (`CREATE IF NOT EXISTS`, aucun ALTER, aucune
  réécriture d'historique). `seq 75` (S7 `integration_secrets`) intact.
- E4/E6 régulés : `ecommerce_opted_in` n'active **aucun** paiement.
- Rétro-compat front Sprint 45 : `POST /api/onboarding` réponse inchangée ;
  GET/PUT dégradent proprement si la table n'existe pas (front garde son
  fallback localStorage).

**Points testables réels (délégués) :**
- `bun run build` (TS) — la VM ne build pas.
- `bun test src/worker/__tests__/onboarding-s8.test.ts` (vitest).
- E2E : reprise multi-appareil (PUT puis GET autre session même user/tenant
  → état restitué) ; fuite cross-tenant (user d'un autre `client_id` ne voit
  jamais l'état) ; `businessType:'shop'` ⇒ `ecommerce_opted_in=1`.
