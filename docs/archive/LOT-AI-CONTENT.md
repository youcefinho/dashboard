# LOT AI CONTENT — atelier IA centralisé (Sprint 12 : la génération IA existe déjà ÉPARPILLÉE → on pose un ATELIER CENTRALISÉ + brand voice multi-presets éditables + persistance bibliothèque & pont IA→templates, 100% ADDITIF, RÉUTILISANT le moteur existant)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-COPILOT-V2.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE des fichiers RÉUTILISÉS,
> jamais le brief).

Sprint **100% ADDITIF**, **migration `migration-aicontent-seq112.sql`** (2 tables
neuves). La génération IA existe DÉJÀ, éparpillée — **à RÉUTILISER, NE PAS
réécrire** :
- `src/worker/ai.ts` : `handleAiGenerate` (12 actions multi-format + rewrite
  inline), `callLLM`, `isAiMockMode`, `generateMockContent`. **READ-ONLY legacy.**
- `src/worker/social-ai.ts` : `handleGenerateSocialPost` (pattern gardé `ai.use`
  + tenant via auth, calque reviews.ts).
- `src/lib/aiDrafts.ts`, `src/worker/ai-chat.ts` : autres consommateurs LLM.

**GAP comblé :**
1. **Atelier centralisé** — aucune page aujourd'hui (génération dispersée).
2. **Brand voice éditable + multi-presets** — la colonne `clients.brand_voice`
   existe mais est INVISIBLE/FIGÉE (consommée par 4 générateurs). On AJOUTE une
   couche de presets éditables (`ai_brand_voices`) **SANS toucher la colonne legacy**.
3. **Persistance** — bibliothèque (`ai_content_items`) + pont IA→templates
   (`use-as-template` → `email_templates` / `sms_templates`).

Alias : imports worker **RELATIFS** (`./...`, `./lib/...`), JAMAIS `@/`. Front `@/`.

---

## §0 — AUDIT DISQUE (le code fait foi — moteur à RÉUTILISER)

### Moteur de génération existant (NE PAS dupliquer/réécrire)

```ts
// ai.ts:15 — Source de vérité du mode mock IA (RÉUTILISÉE).
export function isAiMockMode(env: Env): boolean {
  return env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY;
}

// ai.ts:19 — helper LLM LOCAL (modèle 'claude-haiku-4-5', anthropic-version
// '2023-06-01', max_tokens 1024). Fallback mock sur mock-mode OU erreur.
async function callLLM(env: Env, systemPrompt: string, userPrompt: string): Promise<string>;

// ai.ts:219 — générateur 12 actions (system prompts FR québécois prêts).
export async function handleAiGenerate(request: Request, env: Env): Promise<Response>;
//   body = { action, context?, text?, lead_id?, client_id?, brand_voice? }
//   ⚠ SMELL legacy : ce handler lit client_id DU BODY (NON gardé, pas de capGuard).
//      → NE PAS reproduire. Les NOUVELLES routes /api/ai/content/* sont GARDÉES
//        (auth + capGuard ai.use) et bornent le tenant DEPUIS L'AUTH.
//   ACTIONS (ai.ts:208) : email_followup, email_welcome, sms_followup,
//     social_post, objection_handler, meeting_agenda, proposal_intro, recap_call,
//     improve_text, shorten, formalize, casualize.
//   System prompt de base : « Tu es un assistant IA pour une PME au Québec.
//     Ton du client : ${brandVoice}. … » (ai.ts:260). brandVoice = body.brand_voice
//     OU clients.brand_voice (chargé si client_id) OU défaut.
//   Actions inline rewrite (ai.ts:294) : improve_text / shorten / formalize /
//     casualize — user prompt = « Texte source :\n${text}\n\n… ».
//     ⚠ Le format SOURCE pour les mocks inline est « Texte source :\n… »
//        (generateMockContent ai.ts:63) — à conserver si on réutilise ces mocks.
```

**Manquants côté moteur (à AJOUTER Manager-B, SANS casser l'existant) :**
- Formats **`blog`** et **`landing`** (handleAiGenerate ne couvre pas) → nouveaux
  system prompts dans le générateur centralisé.
- Action rewrite **`expand`** (allonger) — absente des 4 actions inline legacy.

### Helper FACTORISÉ NEUF (gelé Phase A — `src/worker/llm-common.ts`)

```ts
// llm-common.ts (NEUF, gelé A) — le NOUVEAU module Sprint 12 l'importe.
export function isAiContentMockMode(env: Env): boolean; // = USE_MOCKS || !ANTHROPIC_API_KEY (calque ai.ts:15)
export async function callClaude(
  env: Env, system: string, user: string, opts?: { maxTokens?: number },
): Promise<string>; // claude-haiku-4-5, anthropic-version 2023-06-01, fallback mock DÉTERMINISTE, JAMAIS throw/500
```
⚠ `llm-common.ts` ne refactore PAS les 7 appelants existants (rétro-compat DURE).

### Tenant / capability / pattern gardé

- **Capability** `ai.use` ∈ `ALL_CAPABILITIES` (capabilities.ts:48/91) — RÉUTILISÉE,
  **ZÉRO ajout**. Garde : `requireCapability(auth.capabilities, 'ai.use')`.
- **Pattern gardé** (calque social-ai.ts:22) :
  ```ts
  function capGuard(auth): Response | undefined { return requireCapability(auth.capabilities, 'ai.use'); }
  ```
- **Bornage tenant STRICT** : `client_id` = `auth.tenant?.clientId ?? auth.clientId`
  (NULLABLE legacy), `user_id` = `auth.userId`. **JAMAIS depuis le body** (le legacy
  `/api/ai/generate` lit client_id du body = smell à NE PAS reproduire).
- **`clients.brand_voice`** : colonne legacy mono-valeur consommée par 4
  générateurs — **INTOUCHÉE**. Les presets `ai_brand_voices` sont une couche
  ADDITIVE (jamais un remplacement, jamais un ALTER).

### Schémas réutilisés pour `use-as-template` (CRUCIAL Manager-B)

```sql
-- email_templates (migration-phase2.sql) — ⚠ CHECK SQL sur category :
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT,                  -- NULL = template global
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT DEFAULT '',
  variables TEXT DEFAULT '[]',
  category TEXT CHECK (category IN ('welcome','followup','reminder','notification','marketing','general')) DEFAULT 'general',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- ⚠ category EST contrainte par CHECK → l'INSERT DOIT utiliser une valeur valide
--   (ex 'general'). name/subject/body_html sont NOT NULL → fournir des valeurs.

-- sms_templates (migration-sms-whatsapp-seq104.sql) — pas de CHECK :
CREATE TABLE IF NOT EXISTS sms_templates (
  id TEXT PRIMARY KEY,             -- ⚠ PAS de DEFAULT → fournir lower(hex(randomblob(16)))
  client_id TEXT,
  name TEXT,
  body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Tables NEUVES (seq 112 — manifestée)

```sql
ai_content_items (id PK gen, client_id, user_id, format, title, brief, content,
  tone_preset_id, source_action, status DEFAULT 'draft', created_at, updated_at)
ai_brand_voices  (id PK gen, client_id, user_id, name, description, is_default
  DEFAULT 0, created_at, updated_at)
```
Zéro FK / zéro CHECK : `format` (email|sms|social|blog|landing), `status`,
`is_default` validés HANDLER. `description` = prompt de ton injecté dans le system.

---

## §1 — MIGRATION (seq 112, ADDITIVE)

`migration-aicontent-seq112.sql` (racine) — calque seq 91 (`ai_chat_*`) :
2 `CREATE TABLE IF NOT EXISTS` + 2 `CREATE INDEX IF NOT EXISTS`. Zéro FK / CHECK /
DROP / RENAME / ALTER. Manifestée `docs/migrations-manifest.json` seq 112
(`depends_on:["migration-sitebuilder-seq111.sql"]`, risk low). **Manager-B/C n'y
touchent PAS.**

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` **INCHANGÉS**. Succès =
**`json({ data })`** ; erreur = **`json({ error }, status)`**. **JAMAIS de champ
`code`** — discrimination front string-match sur `error` / absence de `data`.
**AUCUN helper n'envoie de `client_id`** (FLAG #1 — tenant re-borné worker-side).

Helpers (FIGÉS Phase A — Phase C les CONSOMME tels quels, Phase B câble les corps) :

```ts
// Génération
generateAiContent({ format: AiContentFormat; brief: string; tone_preset_id?: string })
  : Promise<ApiResponse<{ content: string; source_action?: string }>>   // POST /ai/content/generate
rewriteAiContent({ content: string; mode: AiRewriteMode })
  : Promise<ApiResponse<{ content: string }>>                            // POST /ai/content/rewrite
//   AiRewriteMode = 'improve'|'shorten'|'expand'|'formalize'|'casualize'|'retone'

// Bibliothèque
getAiContentItems(params?: { format?; status? })
  : Promise<ApiResponse<{ items: AiContentItem[] }>>                     // GET  /ai/content/items
saveAiContentItem({ format; content; title?; brief?; tone_preset_id?; source_action?; status? })
  : Promise<ApiResponse<{ item: AiContentItem }>>                        // POST /ai/content/items
deleteAiContentItem(id)
  : Promise<ApiResponse<{ deleted: boolean }>>                          // DELETE /ai/content/items/:id
useAsTemplate(id)
  : Promise<ApiResponse<{ template_id: string; kind: string }>>         // POST /ai/content/items/:id/use-as-template

// Brand voice (presets)
getBrandVoices()
  : Promise<ApiResponse<{ voices: AiBrandVoice[] }>>                     // GET  /ai/content/brand-voices
createBrandVoice({ name; description?; is_default? })
  : Promise<ApiResponse<{ voice: AiBrandVoice }>>                        // POST /ai/content/brand-voices
updateBrandVoice(id, { name?; description?; is_default? })
  : Promise<ApiResponse<{ voice: AiBrandVoice }>>                        // PATCH  /ai/content/brand-voices/:id
deleteBrandVoice(id)
  : Promise<ApiResponse<{ deleted: boolean }>>                          // DELETE /ai/content/brand-voices/:id
```

### §6.B — Types (`src/lib/types.ts`, FIGÉS Phase A) — ApiResponse INCHANGÉ

```ts
export type AiContentFormat = 'email' | 'sms' | 'social' | 'blog' | 'landing';

export interface AiContentItem {
  id: string; client_id?: string | null; user_id?: string | null;
  format: AiContentFormat; title?: string | null; brief?: string | null;
  content: string; tone_preset_id?: string | null; source_action?: string | null;
  status: string; created_at?: string; updated_at?: string;
}

export interface AiBrandVoice {
  id: string; client_id?: string | null; user_id?: string | null;
  name: string; description?: string | null; is_default: boolean;
  created_at?: string; updated_at?: string;
}
```
(`AiRewriteMode` est défini dans `api.ts` aux côtés des helpers.)

### §6.C — Helper Claude commun (`src/worker/llm-common.ts`, NEUF gelé Phase A)

`callClaude(env, system, user, opts?)` + `isAiContentMockMode(env)` (= calque
ai.ts:15). Le générateur centralisé (Manager-B) **les importe** au lieu de
dupliquer `callLLM`. Best-effort : mock déterministe / **jamais 500 brut**.
**NE PAS refactorer** les 7 appelants legacy.

### §6.D — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

Bloc `/api/ai/content/*` placé **APRÈS `requireAuth`** (choke-point worker.ts:1098)
et **APRÈS** le bloc `/api/ai/chat/*`. capGuard `ai.use` appliqué **DANS chaque
handler**. Ordre **anti-shadowing** : collections AVANT `/:id` ; sous-route
`/items/:id/use-as-template` AVANT `/items/:id` générique.

| Route | Méthode | Handler (`./worker/ai-content`) |
|---|---|---|
| `/api/ai/content/generate` | POST | `handleGenerateAiContent(request, env, auth)` |
| `/api/ai/content/rewrite` | POST | `handleRewriteAiContent(request, env, auth)` |
| `/api/ai/content/items` | GET | `handleListAiContentItems(request, env, auth)` |
| `/api/ai/content/items` | POST | `handleSaveAiContentItem(request, env, auth)` |
| `/api/ai/content/items/:id/use-as-template` | POST | `handleUseAsTemplate(request, env, auth, id)` |
| `/api/ai/content/items/:id` | DELETE | `handleDeleteAiContentItem(request, env, auth, id)` |
| `/api/ai/content/brand-voices` | GET | `handleListBrandVoices(request, env, auth)` |
| `/api/ai/content/brand-voices` | POST | `handleCreateBrandVoice(request, env, auth)` |
| `/api/ai/content/brand-voices/:id` | PATCH | `handleUpdateBrandVoice(request, env, auth, id)` |
| `/api/ai/content/brand-voices/:id` | DELETE | `handleDeleteBrandVoice(request, env, auth, id)` |

Imports dynamiques (`await import('./worker/ai-content')`) calque social-ai.

### §6.E — Stubs handlers (`src/worker/ai-content.ts` — owned Manager-B, stubs posés Phase A)

10 handlers, **signatures FIGÉES Phase A**, capGuard `ai.use` câblé, helper
`scopeClientId(auth) = auth.tenant?.clientId ?? auth.clientId ?? null` posé,
corps minimal `json({ data: … })` + `// Manager-B: corps réel`. Calque
social-ai.ts (pattern gardé + tenant). Type auth : `AiContentAuth = CapAuth &
{ capabilities?: Set<string> }`.

### §6.F — Route front (`src/App.tsx`, FIGÉ Phase A)

Lazy `AiContentPage` (export nommé FIGÉ depuis `@/pages/AiContent`) + route
protégée `/ai-content` sous `LazyGuard` (= AuthGuard + Suspense), enregistrée
dans le routeTree (après `socialRoute`). Calque `socialRoute`.

### §6.G — i18n (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, FIGÉ Phase A)

Namespace `aicontent.*` — **32 clés ×4, parité STRICTE** (atelier, formats,
brief, générer, réécrire + 6 modes, bibliothèque, brand voice presets). fr-CA
tutoiement / fr-FR vouvoiement. Clés AVANT usage. **Manager-C les CONSOMME, n'en
AJOUTE PAS** (i18n GELÉ Phase A).

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned : **`src/worker/ai-content.ts` UNIQUEMENT** —
  - **générateur centralisé** : RÉUTILISE les system-prompts/moteur de
    `handleAiGenerate` (ai.ts:219, FR québécois) + AJOUTE formats **`blog`** /
    **`landing`** + action rewrite **`expand`**. Appel via `callClaude` commun
    (llm-common.ts), `isAiContentMockMode`. Charge le preset de ton
    (`ai_brand_voices` tenant-borné) → injecté dans le system. **NE LIT PAS
    `clients.brand_voice`** (legacy intouché ; un fallback éventuel reste optionnel
    et NON mutant) ;
  - **CRUD bibliothèque** `ai_content_items` (list/save/delete, tenant-borné) ;
  - **CRUD `ai_brand_voices`** (list/create/update/delete, unicité du défaut
    applicative) ;
  - **`use-as-template`** : INSERT `email_templates` (category VALIDE p.ex
    'general', name/subject/body_html NOT NULL) OU `sms_templates` (id à générer,
    pas de DEFAULT) depuis un contenu, `client_id = scopeClientId(auth)` ;
  - Tenant **STRICT auth** (jamais le body), **capGuard `ai.use`**, `callClaude`
    commun, `isAiContentMockMode`. **NE PAS casser** ai.ts / social-ai.ts /
    aiDrafts.ts / ai-chat.ts. + tests `__tests__/`.
- **Manager-C (frontend)** owned : **`src/pages/AiContent.tsx`** (NEUF, export
  `AiContentPage`) — atelier : brief → format → preset de ton → générer → éditer
  → réécrire (6 modes) → sauvegarder bibliothèque / use-as-template + panneau
  **Brand Voice CRUD presets**. Style sobre, primitives existantes. Consomme les
  helpers §6.A + i18n `aicontent.*`.
- **INTERDITS aux deux** : migration, manifest, **`src/lib/types.ts`**,
  **`src/lib/api.ts`**, **`src/worker.ts`**, **`src/App.tsx`**, **i18n ×4**,
  **`src/index.css`**, **`src/worker/llm-common.ts`** (tous GELÉS Phase A) ;
  **`src/worker/ai.ts`** / **`social-ai.ts`** / **`aiDrafts.ts`** /
  **`ai-chat.ts`** (RÉUTILISÉS en lecture/import — NON modifiés) ;
  **`clients.brand_voice`** (colonne legacy INTOUCHABLE). `ai-content.ts` =
  **Manager-B** ; `AiContent.tsx` = **Manager-C**. **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **Manifest seq 112** — l'entrée est posée Phase A (NE PAS la modifier). La
   migration est ADDITIVE (calque seq 91).
2. **CHECK / FK INTERDITS** dans la migration (additif pur — format/status/
   is_default validés HANDLER). Zéro DROP / RENAME / ALTER.
3. **NE PAS toucher `clients.brand_voice`** — colonne legacy mono-valeur
   consommée par 4 générateurs. Les presets `ai_brand_voices` sont ADDITIFS.
4. **NE PAS dupliquer le moteur** — RÉUTILISER `handleAiGenerate` (system prompts)
   / `callClaude` commun. AJOUTER seulement blog/landing + rewrite 'expand'.
5. **Tenant depuis l'AUTH, PAS le body** — `scopeClientId(auth)` /
   `auth.userId` partout (FLAG #1). Le legacy `/api/ai/generate` lit client_id du
   body = smell à NE PAS reproduire.
6. **Routes GARDÉES** — auth (choke-point worker.ts) + capGuard `ai.use` DANS
   chaque handler. Contrairement au legacy non gardé.
7. **Flag IA `isAiContentMockMode`** (= USE_MOCKS || !ANTHROPIC_API_KEY) — absent
   ANTHROPIC_API_KEY ⇒ mock déterministe, **jamais 500 brut**. NE PAS inventer
   de nouveau flag.
8. **Capability `ai.use` RÉUTILISÉE** — ZÉRO ajout à `ALL_CAPABILITIES`.
9. **Alias relatifs worker** (`./...`, `./lib/...`), front `@/`.
10. **i18n `.ts` (PAS `.json`)** — `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, parité
    stricte, GELÉE Phase A (Manager-C consomme, n'ajoute pas).
11. **use-as-template** — `email_templates.category` est sous CHECK SQL (valeur
    DOIT ∈ {welcome,followup,reminder,notification,marketing,general}) ;
    `sms_templates.id` n'a PAS de DEFAULT (générer `lower(hex(randomblob(16)))`).

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-22)

Fichiers **créés** :
1. `migration-aicontent-seq112.sql` — 2 tables (`ai_content_items`,
   `ai_brand_voices`) + 2 index, ADDITIF (calque seq 91). Zéro FK/CHECK/ALTER.
2. `src/worker/llm-common.ts` — `callClaude` + `isAiContentMockMode` (NEUF, gelé A).
3. `src/worker/ai-content.ts` — 10 stubs handlers (signatures FIGÉES, capGuard
   `ai.use`, `scopeClientId`, corps `json({data:…})` + `// Manager-B: corps réel`).
4. `docs/LOT-AI-CONTENT.md` — ce document (§6 FIGÉ).

Fichiers **modifiés** (rigoureusement ADDITIFS) :
1. `docs/migrations-manifest.json` — entrée seq 112 (virgule seq 111 ajoutée,
   JSON valide vérifié).
2. `src/lib/types.ts` — `AiContentFormat`, `AiContentItem`, `AiBrandVoice` (NEUFS).
   ApiResponse INCHANGÉ.
3. `src/lib/api.ts` — 11 helpers `/ai/content/*` + `AiRewriteMode` (NEUFS) ;
   import des 3 types ajouté. apiFetch/ApiResponse INCHANGÉS. AUCUN client_id envoyé.
4. `src/worker.ts` — bloc 10 routes `/api/ai/content/*` câblées (imports
   dynamiques `./worker/ai-content`), APRÈS requireAuth + bloc ai/chat,
   anti-shadowing (collections AVANT /:id, /use-as-template AVANT /items/:id).
5. `src/App.tsx` — lazy `AiContentPage` + route protégée `/ai-content`
   (`LazyGuard`) enregistrée au routeTree. Rien d'autre touché.
6. `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — namespace `aicontent.*` (32 clés ×4,
   parité stricte vérifiée, clés AVANT usage, fr-CA tutoiement / fr-FR vouvoiement).

**Migration** : seq 112 ADDITIVE, manifestée. **Build** : non vérifié (VMware sans
bun/node) — **délégué côté hôte**.

### Confirmations garde-fous
- **Migration ADDITIVE** : 2 `CREATE TABLE IF NOT EXISTS` + 2 index, zéro
  FK/CHECK/DROP/RENAME/ALTER. Manifest seq 112 (depends_on seq 111) valide.
- **ApiResponse INCHANGÉ** (`{ data }` / `{ error }`, jamais `code`).
- **`clients.brand_voice`** : INTOUCHÉE (presets `ai_brand_voices` ADDITIFS).
- **Moteur RÉUTILISÉ** : ai.ts/social-ai.ts/aiDrafts.ts/ai-chat.ts INTOUCHÉS ;
  `llm-common.ts` ne refactore aucun appelant existant.
- **`ai.use`** réutilisée — ZÉRO ajout à `ALL_CAPABILITIES`.
- **FLAG #1 (cross-tenant)** : aucun helper front n'envoie de client_id ; tenant
  re-borné worker-side via `scopeClientId(auth)` / `auth.userId` ; les nouvelles
  routes sont GARDÉES (auth + capGuard), contrairement au legacy.
- **Flag IA** : `isAiContentMockMode` (= USE_MOCKS || !ANTHROPIC_API_KEY) —
  absent ANTHROPIC_API_KEY ⇒ mock déterministe, jamais 500 brut.

### Écarts CODE > brief
- `AiRewriteMode` est exporté depuis **`api.ts`** (aux côtés des helpers) plutôt
  que types.ts — calque les `type` co-localisés des autres helpers (ex
  `SocialProvider` consommé). `AiContentFormat`/`AiContentItem`/`AiBrandVoice`
  sont dans types.ts comme demandé.
- `App.tsx` utilise **TanStack Router** (`createRoute` + `LazyGuard` qui enveloppe
  `AuthGuard`+Suspense) — la route `/ai-content` calque EXACTEMENT `socialRoute`
  (le « AuthGuard » du brief = `LazyGuard` ici).
- Routes worker câblées via **imports dynamiques** (`await import('./worker/ai-content')`)
  calque social-ai.ts plutôt qu'import statique en tête (cohérent avec le bloc social).
- `ai_content_items.user_id` / `ai_brand_voices.user_id` sont **NULLABLE** (legacy)
  comme `client_id` — calque la tolérance legacy (le handler borne depuis l'auth).
