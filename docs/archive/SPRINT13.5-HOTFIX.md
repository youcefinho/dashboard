# Sprint 13.5 — Hotfix audit Sprint 12+13 (~2j)

> Hotfix déclenché par l'audit complet post-Sprint 13 (cf. ANTIGRAVITY-SPRINT13-PLAN.md
> archivé). Corrige les 23 erreurs TS masquées + robustesse webhooks + role mismatch
> API publique + scaffold Zapier app.
> Période : 2026-05-12.

---

## Contexte

Après clôture Sprint 13, un audit complet a révélé que `src/worker.ts` était **exclu
du type-check** dans `tsconfig.json:24`. Conséquence : 23 erreurs TypeScript invisibles
au build CI, dont des imports inexistants, des appels avec mauvaise arité, et des
variables utilisées avant déclaration. Plusieurs routes 500 en silence à l'exécution.

Aussi identifié :
- BYPASS PROVISOIRE auth (volontaire — accès dev Rochdi, à retirer en fin de projet)
- Collision `handleGetSessions` entre `worker/auth.ts` (Sprint 12) et `worker/settings.ts` (Sprint 8) → leak sessions cross-user
- Doublons routes `/api/ai/*` (admin + unreachable)
- Routes `/api/meta/oauth/*` dans bloc public utilisant `auth` avant déclaration
- `publishEvent` fire-and-forget sans `ctx.waitUntil()` → webhooks meurent en prod
- Pas de backoff retry réel (juste `message.retry()` nu)
- Pas de protection replay HMAC
- Role mismatch `/api/public/v1` : handlers admin-only refusaient `role: 'user'` du contexte API key → 403 systématique
- Migration tracker regex `\\D` double-escape → tri non-déterministe

---

## Phases livrées

### Phase A — Retrait worker.ts de l'exclude tsconfig (commit d3e1420)
- `tsconfig.json` : retire `"src/worker.ts"` du exclude
- 23 erreurs TS révélées et corrigées :
  - Imports inexistants (`handleEnrollLead`, `processWorkflowQueue`, `./worker/migrate`)
  - Mauvaise arité (`handleAiGenerate(3 args)` → `(2 args)`)
  - Imports depuis mauvais module (`handleGetAppointments` from `calendar` → `appointments`)
  - `auth` used before declared (meta oauth public block → déplacé routeProtected)
  - Hints unused — cleanup

### Phase B — Webhooks robustes (commit 42c6110)
- `publishEvent()` enveloppé dans `ctx.waitUntil()` (entry point + dispatcher signature)
- `webhooks-queue.ts` : vrai backoff exponential 5 niveaux (60s / 300s / 1800s / 7200s / 43200s)
- Dead-letter automatique après `MAX_ATTEMPTS = 5`
- Auto-désactivation subscription après `DISABLE_THRESHOLD = 100` échecs cumulés
- `sendWebhookDirectly` : `AbortController` + timeout 10s sur fetch
- Header `X-Intralys-Timestamp` ajouté au payload + validation HMAC

### Phase C — Fix role mismatch API publique (commit 9ac0c33)
- `handleGetLeads` accepte `role === 'admin' || role === 'api'`
- Si `role === 'api'` : filtrage automatique par `auth.clientId` (ignore le `?client_id=` query → anti-tampering)
- `handlePatchLead` mêmes ajustements
- `worker.ts` : routes `/api/public/v1/*` injectent désormais `role: 'api'` + `clientId` issus de l'API key

### Phase D — Zapier app scaffold (commit acbfe5c)
- Dossier `zapier-app/` à la racine (ignoré du build front via `vite.config`)
- `package.json` indépendant + `@zapier/cli` typescript template
- Auth API key configurée (test endpoint `GET /api/public/v1/me`)
- 1 trigger `new_lead` (polling `/api/public/v1/leads?since=<cursor>`)
- 1 action `create_lead` (POST `/api/public/v1/leads`)
- `zapier validate` passe

### Phase E — Tests + clôture (commit 1845a65)
- `webhooks-queue.test.ts` (6 tests) : ack delivered, backoff 60s/1800s, dead-letter, auto-disable 100, exception retry
- `leads-api-role.test.ts` (6 tests) : 403 user, 200 api filtrage clientId, anti-tampering query override, handlePatchLead role check
- ROADMAP.md : Sprints 13 + 13.5 dans accomplis, total ~174j cumulés
- Archive `ANTIGRAVITY-SPRINT13-PLAN.md` → `docs/archive/`

---

## Résumé commits

```
1845a65 test(sprint13.5): backoff retry webhooks + role api filtering leads
acbfe5c feat(zapier): scaffold zapier-app/ avec trigger new_lead + action create_lead
9ac0c33 feat(api-public): fix role mismatch — role 'api' accepté, filtrage clientId
42c6110 feat(webhooks): ctx.waitUntil, backoff retry 5 niveaux, AbortController 10s, anti-replay
d3e1420 fix(worker): retire src/worker.ts de l'exclude tsconfig + 23 fixes TS
5c84725 fix(audit): collision handleGetSessions + doublons routes + regex migrate
```

---

## Critères de succès (tous ✅)

- [x] `src/worker.ts` retiré de `tsconfig.json` exclude, build vert
- [x] `bun x tsc --noEmit` → 0 erreurs
- [x] `curl GET /api/public/v1/leads` avec API key valide → 200 + leads du bon client (pas 403)
- [x] Webhooks survivent à un receiver lent (AbortController 10s)
- [x] Backoff retry : 5 niveaux 1m/5m/30m/2h/12h + dead-letter
- [x] `zapier-app/` : `zapier validate` OK
- [x] 158 tests verts (vs cible 150+)

---

## Non-corrigé volontairement

- **BYPASS PROVISOIRE auth** dans `src/worker/auth.ts` (5 occurrences) + `src/lib/api.ts:78`
  → Volontaire pour accès dev de Rochdi sans saisir mot de passe.
  → À retirer en toute fin de projet, juste avant ouverture beta aux 5 premiers clients.

- **CSP `unsafe-inline unsafe-eval`** dans `public/_headers`
  → Toléré pour Vite dev + Swagger UI inline.
  → Durcir post-migration vers React strict mode + CSP nonce.

---

_Plan créé le 2026-05-12 (audit), exécuté le 2026-05-12 (hotfix). Archivé à la clôture._
