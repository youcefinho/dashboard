# Observabilité du Worker — logger, error-handling, audit_log

> État au **Sprint S4 (Lot 2)**. Source de vérité : `src/worker/lib/logger.ts`
> (M1), `src/worker/lib/error-response.ts` (M1), helper figé `audit()` de
> `src/worker/helpers.ts` (table `audit_log`, schéma figé S5 migration).
>
> **Principe transversal** : tout est *strictement additif* et *best-effort*.
> Aucune brique d'observabilité ne change la logique métier ni le format des
> réponses succès/erreur. Aucune ne peut faire échouer le chemin nominal.
> **Loi 25 (non négociable)** : zéro PII / secret / token / body brut dans
> les logs et l'audit — métadonnées sûres uniquement.

---

## 1. Logger structuré (`src/worker/lib/logger.ts` — S4 M1)

### Signature

```ts
createLogger(env: unknown): Logger          // borné par env.LOG_LEVEL
logger: Logger                              // défaut (seuil 'warn')

interface Logger {
  info(msg: string, ctx?: LogContext): void
  warn(msg: string, ctx?: LogContext): void
  error(msg: string, ctx?: LogContext): void
}
```

### Comportement

- Émet **une ligne JSON unique** (`{ lvl, msg, ts, ...ctx }`) sur le bon
  canal `console.*` — parseable par les logs Cloudflare / observabilité.
- **Ne throw jamais** : un `console.*` ou une sérialisation impossible
  (ctx circulaire) dégrade en silence (`log-serialize-failed`), jamais
  d'exception remontée au handler appelant.

### `LOG_LEVEL`

Binding Wrangler **optionnel**, lu défensivement (pas dans l'interface
`Env` figée). Valeurs : `error` < `warn` < `info` (sévérité décroissante).
**Défaut = `warn`** (discret en prod : seuls `error`+`warn` passent). Une
valeur inconnue retombe sur `warn`.

### Règle zéro-PII (appelant)

Le logger sérialise `ctx` tel quel — **aucune introspection / scrub**.
C'est à l'appelant de ne passer QUE des métadonnées sûres : route,
méthode, status, nom/type/message d'erreur. **Jamais** : body de requête,
token, en-tête `Authorization`, mot de passe, PII (email/téléphone/nom
client), secret, stack avec chemins/valeurs sensibles. Le seul appelant
prévu (`error-response.ts`) respecte cette règle.

---

## 2. Error-handling (`src/worker/lib/error-response.ts` — S4 M1)

### Signature

```ts
errorResponse(e: unknown, env: unknown, route?: string): Response  // HTTP 500
```

### Usage

Centralise les **2 catch racine** de `src/worker.ts` (bloc public +
enveloppe `routeProtected`) qui faisaient un `console.error` brut + 500 nu.

```ts
try { return await routeProtected(...); }
catch (err) { return errorResponse(err, env, path); }
```

### Format (rétro-compatible front — prouvé S3)

```
HTTP 500 : { error: "Erreur serveur interne", code: "INTERNAL" }
```

`error` reste une **STRING racine** (le front lit `data.error` comme
string brute — `src/lib/api.ts`). `code` est **additif** (ignoré par les
lecteurs actuels — même philosophie que `validate-response.ts` / S3).

### Garanties

- Idempotent (aucun état). **Ne throw jamais** (log entouré d'un
  try/catch interne : un échec de logging ne masque pas le 500).
- Zéro PII/secret : seuls `name` + `message` (tronqué 500 car) de
  l'exception + une `route` optionnelle. **Stack non incluse**.
- Réutilise le helper figé `json()` (0 modif).

---

## 3. `audit_log` — traçabilité des mutations sensibles

### Table figée (`migration-phase5.sql:5-14`)

Schéma **immuable** : `user_id, action, resource_type, resource_id,
details (JSON string), ip, user_agent, created_at`. Ne pas altérer.

### Helper figé (`src/worker/helpers.ts:70-86`)

```ts
audit(env, userId, action, resourceType, resourceId, details = {}): Promise<void>
```

- **Best-effort** : try/catch interne — un échec d'insertion ne bloque
  JAMAIS l'action métier. `ip`/`user_agent` dérivés du contexte requête.
- Réutilisé tel quel (0 modif). 34 fichiers worker l'appellent (état S4).

### Convention `action` / `resource_type` / `details`

- `action` = `verbe.action` en minuscules (`user.invite`,
  `apikey.revoke`, `webhook.create`, `compliance.update`).
- `resource_type` = nom logique de l'entité (`user`, `api_key`,
  `webhook`, `client`).
- `details` = **métadonnées seulement** : id ciblé, rôle, label, scope,
  flags booléens. **JAMAIS** : clé API brute (`rawKey`), hash de clé
  (`keyHash`), secret webhook (`whsec_…`), mot de passe, contenu de
  certificat AMF, token. Loi 25 — l'audit trace *l'action*, pas la
  *valeur secrète*.

### Mutations couvertes après S4 (Lot 2 — M3)

| Handler | Fichier | `action` | `resource_type` | `details` (sûr) |
|---|---|---|---|---|
| `handleInviteUser` | `team.ts` | `user.invite` | `user` | `{ role, email }` |
| `handleUpdateUserRole` | `team.ts` | `user.role_change` | `user` | `{ role }` |
| `handleDeleteUser` | `team.ts` | `user.remove` | `user` | `{}` |
| `handleUpdateClientCompliance` | `settings.ts` | `compliance.update` | `client` | `{ amf_disclaimer_required, has_certificate:bool }` |
| `handleCreateApiKey` | `settings.ts` | `apikey.create` | `api_key` | `{ name, scopes, client_id }` |
| `handleRevokeApiKey` | `settings.ts` | `apikey.revoke` | `api_key` | `{}` |
| `handleCreateWebhook` | `settings.ts` | `webhook.create` | `webhook` | `{ url, events, client_id }` |
| `handleDeleteWebhook` | `settings.ts` | `webhook.delete` | `webhook` | `{}` |
| `handlePublicCreateWebhook` | `settings.ts` | `webhook.create` | `webhook` | `{ url, events, source:'public_api' }` |
| `handlePublicDeleteWebhook` | `settings.ts` | `webhook.delete` | `webhook` | `{ source:'public_api' }` |

> **Acteur de l'audit** : `team.ts` / `settings.ts` n'ont pas de
> paramètre `auth` (signatures publiques figées). L'acteur est dérivé du
> header `X-User-Id` (convention déjà en place dans `settings.ts`),
> fallback `'system'` — helper local `auditActor(request)`, **purement
> additif**, aucune signature publique modifiée. Les variantes publiques
> Zapier (`handlePublic*Webhook`) utilisent le `clientId` authentifié
> comme acteur.

### Prudence config paiement (zones régulées E4/E6)

`settings.ts` ne contient **aucune mutation de config paiement régulée**
(`payments_live_enabled`, clés Stripe). `handleUpdateClientCompliance`
touche la conformité **AMF courtier** (certificat + flag disclaimer), pas
le paiement : auditer cette action = bonne traçabilité, et `details`
n'expose que `has_certificate` (booléen), jamais la valeur du certificat.
Règle générale : si une future mutation touchait une config paiement
régulée → auditer l'action reste OK (traçabilité), mais **ne jamais
changer** la logique ni l'état ; en cas de doute, documenter ici et ne
pas instrumenter cette mutation précise.

---

## 4. Backlog observabilité (Lot 3+)

- Audit `auth.ts` (login/reset/changePassword — événements sécurité).
- Audit `compliance.ts` (écritures `consent_log` Loi 25 / CASL).
- Audit `lead-notes.ts` (reporté S5 — collision M2 évitée en S4).
- Audit `custom-fields.ts`, `lead-sources.ts` (tokens d'ingestion),
  `webhooks-dispatch.ts` (dispatch sortant).
- Brancher `errorResponse()` sur d'éventuels nouveaux catch racine.
