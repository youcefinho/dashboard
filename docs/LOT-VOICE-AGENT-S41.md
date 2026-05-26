# LOT AI Voice Agent — Sprint 41

> Doc contrat §6 figé. Migration : seq136 — `migration-voice-agent-seq136.sql`.
> Compagnons : `LOT-TWILIO-VOICE-S34.md` (module parent — inbound voice + recording +
> voicemail RGPD/CRTC), `LOT-TEAM-BC.md` (capabilities figées seq80 — réutilisation
> `settings.manage`), `LOT-CHAT-WIDGET-S36.md` (calque pattern handler stub Phase A +
> i18n + manifest + ordre anti-shadowing).

## §1 Contexte

La TÉLÉPHONIE 2-WAY + VOICEMAIL + RECORDING **EXISTENT DÉJÀ** dans Intralys
(livré Sprint 34, seq129). Composants en place :

- `src/worker/twilio-twiml.ts` — TwiML inbound (welcome + voicemail + dial-out).
- `src/worker/lib/twilio-voice.ts` — helpers Twilio (REST, signature, recording).
- `src/worker/voice.ts` — voicemail entrant prod (DO `VoiceRoom` + transcription).
- Tables seq102 `call_logs` + seq116 `disposition/notes` + seq129 `voicemails` +
  `call_recordings_metadata` (audit RGPD/CRTC + retention 90j).

**Sprint 41 = ENRICHISSEMENT, PAS reconstruction**. On NE TOUCHE PAS au TwiML
flow, au DO voicemail, au helper twilio-voice. On ajoute la couche **AI Voice
Agent** :

1. Multi-script par tenant (`voice_agent_scripts` table NEUVE).
2. Détection d'intent via Claude Haiku (Workers AI `env.AI`) → fallback keyword
   matching si binding absent.
3. Réponse TTS Twilio `<Say>` via template interpolé `{{visitor_name}}` etc.
4. Escalade vers humain si confidence < threshold OU demande explicite ("agent",
   "humain", "real person", "hablar con persona").
5. Audit complet via `voice_agent_calls` table NEUVE (intent + confidence +
   transcript + escalation_reason).
6. UI dashboard (Phase C frontend) : liste scripts CRUD, test sandbox, history calls.

L'INTÉGRATION au TwiML existant se fera Phase B via route OPTIONNELLE additive
(jamais en modifiant le code TwiML existant). Si le tenant n'a pas activé l'AI
agent, le TwiML actuel reste 100 % fonctionnel et inchangé.

## §2 Migrations — seq136 (DDL résumé)

Fichier racine : `migration-voice-agent-seq136.sql`. Manifest entrée seq136
(`docs/migrations-manifest.json`), `depends_on: ["migration-product-reviews-abandoned-seq135.sql",
"migration-twilio-voice-seq129.sql"]` (chaînage strict sur dernière migration
LOT 4 + parent module Sprint 34).

100 % ADDITIF, zéro CHECK / FK destructrice / ALTER destructeur / DROP / RENAME :

- `CREATE TABLE IF NOT EXISTS voice_agent_scripts` : id PK, client_id, name,
  intent_keywords_json (JSON-array DEFAULT '[]'), response_template, escalation_threshold
  (REAL DEFAULT 0.7), is_active (INTEGER DEFAULT 1), created_at, updated_at.
- `CREATE TABLE IF NOT EXISTS voice_agent_calls` : id PK, call_log_id (FK applicative
  → call_logs.id), client_id, script_id (FK applicative → voice_agent_scripts.id,
  NULL = no match), intent_detected, confidence (REAL), response_text, escalated
  (INTEGER DEFAULT 0), escalation_reason (enum HANDLER), duration_sec, transcript_full,
  created_at.
- 2 `ALTER TABLE call_logs ADD COLUMN` : `agent_handled` (INTEGER DEFAULT 0),
  `agent_script_id` (TEXT NULL).
- 3 indexes : `idx_voice_agent_scripts_client` (client_id, is_active),
  `idx_voice_agent_calls_call_log` (call_log_id),
  `idx_voice_agent_calls_client_created` (client_id, created_at).

Validation enums (`escalation_reason` ∈ `low_confidence|user_request|no_match|error`)
faite SIDE-HANDLER (`voice-agent.ts` + `lib/voice-agent-engine.ts`) — calque
LOT-SNAPSHOTS-S35 §6 + LOT-CHAT-WIDGET-S36 §6 (pas de CHECK = pas de rebuild
SQLite jamais).

## §3 Routes (7 AUTHED + 0 PUBLIC Phase A)

Toutes câblées dans `src/worker.ts` à l'intérieur du bloc `routeProtected`,
APRÈS le bloc S40 abandoned-carts (~l.3080), AVANT le bloc Sprint 23 sécurité
(~l.3082). Garde `requireAuth` au choke-point + garde capability **`settings.manage`**
(FIGÉE seq80) appliquée DANS chaque handler.

ORDRE ANTI-SHADOWING strict : `/scripts/:id/test` (le + spécifique segment-wise)
AVANT `/scripts/:id` (générique) AVANT collection `/scripts` AVANT `/calls/:id`
AVANT `/calls`.

| Méthode | Chemin                                          | Handler                       | Fichier         |
|--------:|-------------------------------------------------|-------------------------------|-----------------|
| GET     | `/api/voice-agent/scripts`                      | `handleListScripts`           | voice-agent.ts  |
| POST    | `/api/voice-agent/scripts`                      | `handleCreateScript`          | voice-agent.ts  |
| POST    | `/api/voice-agent/scripts/:id/test`             | `handleTestScript`            | voice-agent.ts  |
| PATCH   | `/api/voice-agent/scripts/:id`                  | `handleUpdateScript`          | voice-agent.ts  |
| DELETE  | `/api/voice-agent/scripts/:id`                  | `handleDeleteScript`          | voice-agent.ts  |
| GET     | `/api/voice-agent/calls`                        | `handleListCalls`             | voice-agent.ts  |
| GET     | `/api/voice-agent/calls/:id`                    | `handleGetCallDetail`         | voice-agent.ts  |

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ `code` —
contrat GELÉ docs/LOT-TEAM-BC.md §6.A). Statut HTTP transporté par le 2e arg
de `json()`. Phase A renvoie `501` partout (`Phase B not yet implemented`)
pour câbler la matrice routes/handlers sans casser le worker — calque
LOT-CHAT-WIDGET-S36 Phase A + LOT-SNAPSHOTS-S35 Phase A.

**Routes TwiML inbound voice `/twilio/voice/*` INCHANGÉES**. Sprint 41 Phase B
ajoutera OPTIONNELLEMENT une route `/api/voice-agent/handle-call` (hook depuis
TwiML callback). Tant qu'elle n'est pas câblée, le TwiML flow reste 100 %
inchangé et fonctionnel.

## §4 Handlers (signatures FIGÉES Phase A — Phase B Manager-B remplit)

### `src/worker/voice-agent.ts` (7 handlers AUTHED)

```ts
export async function handleListScripts(env: Env, auth: VoiceAgentAuth): Promise<Response>
export async function handleCreateScript(request: Request, env: Env, auth: VoiceAgentAuth): Promise<Response>
export async function handleUpdateScript(request: Request, env: Env, auth: VoiceAgentAuth, id: string): Promise<Response>
export async function handleDeleteScript(env: Env, auth: VoiceAgentAuth, id: string): Promise<Response>
export async function handleTestScript(request: Request, env: Env, auth: VoiceAgentAuth, id: string): Promise<Response>
export async function handleListCalls(env: Env, auth: VoiceAgentAuth, url: URL): Promise<Response>
export async function handleGetCallDetail(env: Env, auth: VoiceAgentAuth, id: string): Promise<Response>
```

### `src/worker/lib/voice-agent-engine.ts` (3 helpers — Phase A fonctionnels minimum-safe)

```ts
export async function detectIntent(
  env: Env,
  scripts: VoiceAgentScript[],
  userInput: string,
): Promise<{ scriptId: string | null; intent: string | null; confidence: number }>
//   Phase A : keyword matching (fallback fonctionnel sans env.AI binding)
//   Phase B : Workers AI Haiku via env.AI.run('@cf/anthropic/claude-3-haiku', ...)

export function buildResponse(
  script: VoiceAgentScript,
  context: { visitor_name?: string; intent?: string },
): string
//   Interpolation textuelle stricte (replaceAll), JAMAIS innerHTML / eval

export function shouldEscalate(
  confidence: number,
  threshold: number,
  userRequest?: string,
): boolean
//   Escalade si confidence < threshold OU userRequest contient
//   keyword universel ("humain", "agent", "real person", "hablar con")
```

## §5 Types `src/lib/api.ts` (FIGÉS Phase A)

```ts
export type VoiceAgentEscalationReason =
  | 'low_confidence' | 'user_request' | 'no_match' | 'error'

export interface VoiceAgentScript         // 9 champs (id, client_id, name,
                                          //  intent_keywords[], response_template,
                                          //  escalation_threshold, is_active,
                                          //  created_at, updated_at)
export interface VoiceAgentCall           // 11 champs
export interface VoiceAgentScriptInput    // 5 champs optionnels (PATCH/POST)
export interface VoiceAgentCallFilters    // escalated, script_id, from, to, limit, cursor
export interface VoiceAgentCallDetail extends VoiceAgentCall { script?: VoiceAgentScript | null }
export interface VoiceAgentTestResult     // matched, intent, confidence,
                                          //  response_preview, would_escalate,
                                          //  escalation_reason
```

Helpers async exportés :

- `listVoiceAgentScripts()`, `createVoiceAgentScript(input)`,
  `updateVoiceAgentScript(id, input)`, `deleteVoiceAgentScript(id)`
- `getVoiceAgentCalls(filters?)`, `getVoiceAgentCallDetail(id)`
- `testVoiceAgentScript(scriptId, sampleInput)`

## §6 Contrat inter-agent FIGÉ — Phase B B/C ne peuvent PAS modifier

1. **Migrations** : seq136 verrou. Aucun champ supplémentaire en Phase B sans
   nouvelle seq (137+). Aucun CHECK ajouté (rebuild SQLite interdit). Aucune FK
   destructrice (call_logs FK = interdit). `voice_agent_calls.call_log_id` reste
   FK applicative, jointures côté handler.
2. **Routes** : 7 chemins/méthodes AUTHED figés (§3). Aucun renommage. L'ordre
   anti-shadowing dans `worker.ts` est invariant : `/scripts/:id/test` AVANT
   `/scripts/:id`. Aucune modification des routes TwiML `/twilio/voice/*`
   existantes (Sprint 34). Hook OPTIONNEL `/api/voice-agent/handle-call` peut
   être ajouté en Phase B comme route AUTHED supplémentaire — pas dans le scope
   Phase A.
3. **Capabilities** : `settings.manage` (seq80) uniquement. AUCUN ajout à
   `ALL_CAPABILITIES`.
4. **Contrat réponses** : `json({ data })` succès / `json({ error }, status)`
   erreur. PAS de champ `code`. PAS de wrapping supplémentaire.
5. **Types `src/lib/api.ts`** : noms et signatures FIGÉS (§5). Manager-C peut
   ajouter des `interface` supplémentaires côté front s'il les expose, mais
   ne renomme PAS les exports listés.
6. **Bornage tenant** : `WHERE client_id = ?` dans tout SELECT/UPDATE/DELETE
   `voice_agent_scripts` et `voice_agent_calls` (defense-in-depth IDOR sur
   `:id`). `resolveClientId()` via `getClientModules(env, auth.userId)` —
   calque chat-widgets.ts:26 / snapshots.ts:33.
7. **Pas de modification du TwiML** `src/worker/twilio-twiml.ts`, du helper
   `src/worker/lib/twilio-voice.ts`, du DO voicemail `src/worker/voice.ts`. Si
   Phase B a besoin d'un hook depuis le TwiML flow, ajouter une route additive
   `/api/voice-agent/handle-call` qui sera APPELÉE par le TwiML callback (jamais
   en modifiant le code TwiML existant).
8. **AI Engine** : Workers AI Haiku via `env.AI.run('@cf/anthropic/claude-3-haiku', ...)`
   UNIQUEMENT. AUCUNE API key externe (Anthropic SDK / OpenAI / Mistral). Si
   `env.AI` binding absent → fallback keyword matching automatique (`detectIntent`
   gère le fallback silencieux, JAMAIS d'erreur jetée).
9. **Escalation policy** : `shouldEscalate(confidence, threshold, userRequest)`
   retourne `true` si `confidence < threshold` OU si `userRequest` contient un
   keyword d'escalation universel (liste fixe `ESCALATION_KEYWORDS` dans
   `voice-agent-engine.ts`, multi-langue FR/EN/ES). Phase B ne MODIFIE PAS cette
   liste — l'enrichir uniquement par ajout (jamais suppression / renommage).
10. **i18n** : 18 clés ajoutées dans 4 catalogues (`fr-CA`, `fr-FR`, `en`, `es`),
    parité STRICTE. Manager-C ne change PAS le nom des clés. `};` final
    PRÉSERVÉ dans chaque catalogue. fr-CA tutoiement, fr-FR vouvoiement.

## §7 Découpe Phase B (Manager-B backend ∥ Manager-C frontend)

- **Manager-B** : remplit les 7 handlers AUTHED + câble réellement
  `detectIntent` sur Workers AI Haiku via `env.AI.run()` (avec timeout 5s +
  fallback keyword) + rate-limit par tenant (réutilise `rate-limit.ts` seq121)
  + cron job optionnel pour cleanup `voice_agent_calls` > 90j (calque retention
  RGPD seq129 `call_recordings_metadata`).
- **Manager-C** : page `/settings/voice-agent` (liste scripts CRUD + form
  inline keywords/template/threshold + test sandbox interactif + history
  calls avec filtre escalated + drill-down transcript), intégration des 18
  clés i18n. ZÉRO fichier partagé avec B (`api.ts` est en lecture pour C).

## §8 Sécurité Loi 25 / RGPD

`voice_agent_calls.transcript_full` contient potentiellement des données
personnelles (identité, demandes santé, finance). Politique de rétention :

- 90 jours par défaut (calque `call_recordings_metadata.retention_days` seq129).
- Soft-delete via `voice_agent_calls.deleted_at` (Phase B ajout colonne dans
  seq137+ si besoin — pas dans scope seq136).
- Export RGPD portable : Phase B handler additif `/api/me/voice-agent-export`
  (calque me-privacy.ts existant).
- Anonymisation : `transcript_full` purgé après 90j via cron Phase B
  (UPDATE voice_agent_calls SET transcript_full = NULL WHERE created_at < ...).

## §9 Vérifications Phase A (checklist sortie)

- [x] Manifest JSON valide (seq136 ajouté, `depends_on` correctement chaîné).
- [x] Migration 100% additive (zéro CHECK / FK destructrice / DROP / RENAME).
- [x] 7 routes câblées worker.ts avec ordre anti-shadowing correct.
- [x] 7 handlers stubs `voice-agent.ts` retournent 501 standardisé.
- [x] 3 helpers `voice-agent-engine.ts` fonctionnels Phase A (keyword fallback).
- [x] Types `api.ts` figés (VoiceAgentScript + VoiceAgentCall + 5 helpers async).
- [x] 18 clés i18n × 4 catalogues (parité STRICTE, `};` final préservé).
- [x] AUCUN touch `twilio-twiml.ts` / `lib/twilio-voice.ts` / `voice.ts`.
