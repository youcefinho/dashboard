# RESILIENCE — S-D4 (LOT D, Manager C)

> Inventaire des `fetch` sortants désormais bornés par timeout via
> `fetchWithTimeout` (§6.1, créé Phase A), vs ceux déjà résilients, +
> décision documentée `RATE_LIMITER` KV non bindé. **Dégradation gracieuse =
> la norme** : un appel externe lent ne doit JAMAIS bloquer le worker ni
> renvoyer 500.

## 1. Wrapper utilisé

`src/worker/lib/fetch-timeout.ts` — `fetchWithTimeout(input, init?, timeoutMs = 10_000)`.
AbortController + `clearTimeout` toujours appelé. **Propage l'erreur telle
quelle** : l'appelant garde son `try/catch` best-effort EXISTANT (logique
métier 0 changement). Calqué sur `webhooks-dispatch.ts:119-157`.

## 2. Fetch externes désormais ceinturés (S-D4, Manager C)

| Fichier | Cible externe | Ligne (avant) | Avant | Après | try/catch existant |
|---|---|---|---|---|---|
| `src/worker/ai.ts` | Anthropic `api.anthropic.com/v1/messages` | ~18 | `await fetch(...)` | `await fetchWithTimeout(...)` | ✅ `callLLM` try/catch → fallback `generateMockContent` |
| `src/worker/push.ts` | FCM `fcm.googleapis.com/fcm/send` | ~87 | `await fetch(...)` | `await fetchWithTimeout(...)` | ✅ try/catch par device → `console.error`, boucle continue |
| `src/worker/tracking.ts` | Meta CAPI `graph.facebook.com/v18.0/.../events` | ~71 | `await fetch(...)` | `await fetchWithTimeout(...)` | ✅ try/catch → `results.events_sent.push({ error })` |

**Preuve métier inchangé** : seul le nom de la fonction d'appel change
(`fetch` → `fetchWithTimeout`). Mêmes URL, mêmes `init` (method/headers/body),
même parsing de réponse (`res.ok`, `res.json()`, `res.text()`), même
try/catch englobant. `fetchWithTimeout` propage l'erreur → le catch existant
l'absorbe exactement comme avant. Aucune signature publique modifiée.

Vérification statique : 1 seul `fetch(` par fichier (grep `count` = 1 chacun),
tous externes (pas de fetch interne/worker-to-worker dans ces 3 fichiers) →
les 3 sont wrappés, aucun fetch légitime laissé non-wrappé.

## 3. Fetch externes DÉJÀ résilients (non touchés par S-D4)

| Module | Statut |
|---|---|
| `webhooks-dispatch.ts:119-157` | Déjà timeout 10s + AbortController (patron de référence S5, INTACT) |
| Stripe / Meta leads / autres webhooks entrants | Réception (pas un fetch sortant) ou déjà encadrés ailleurs — hors scope C |
| E4/E6 régulés (`stripe-provider*`, `ecommerce-payments/refunds/disputes`) | 🚫 INTERDIT (§6.6) — non touchés, `payments_live_enabled` reste `0` |

## 4. `RATE_LIMITER` KV non bindé dans wrangler — décision documentée

- `api-public-auth.ts:55-71` : le rate limiting est **gardé par
  `if (env.RATE_LIMITER)`** et le `put`/`get` est dans un `try/catch` qui
  « ne bloque pas l'API » si KV échoue.
- `RATE_LIMITER` **n'est PAS bindé dans `wrangler.jsonc`** (interdit de
  toucher `wrangler.jsonc` §6.6 — constat, pas correction).
- **Conséquence assumée** : `env.RATE_LIMITER` est `undefined` → le bloc
  rate-limit est sauté proprement (no-op). L'API publique fonctionne sans
  rate-limit KV. Pattern de dégradation gracieuse identique à celui appliqué
  aux fetch (échec d'une dépendance optionnelle = skip, jamais crash).
- **Décision Rochdi** (gate prod) : binder `RATE_LIMITER` KV dans
  `wrangler.jsonc` AVANT prod si le rate-limit public est requis. Documenté
  ici, non corrigé (hors charte LOT D, décision infra Rochdi).

## 5. Principe directeur

Dégradation gracieuse = norme sur tout appel I/O externe optionnel :
1. dépendance absente (`env.X` undefined) → bloc sauté (`if (env.X)`) ;
2. appel externe lent → `fetchWithTimeout` abort à 10s → erreur propagée ;
3. erreur → `try/catch` best-effort EXISTANT → fallback métier (mock /
   log / entrée d'erreur dans le résultat) ;
4. **jamais** de 500/503 nouveau, **jamais** de worker bloqué par un tiers.

## 6. Note handoff

Le dispatch de `handleDataReconcile` dans `worker.ts` est du ressort de
Manager A (§6.6 : `worker.ts` = Manager A). Si non câblé au moment du build,
exposer `GET /api/admin/data-reconcile` côté worker.ts avec garde admin amont
(réplique `admin-analytics.ts:16-23`) — cf NOTE-HANDOFF dans le rapport.
