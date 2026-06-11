# LOT G4 — OAuth natives (squelette transverse)

**Sprint** : Plateforme-Pro · **Date** : 2026-05-20
**Méthode** : Chaman READ-ONLY → Phase A SOLO (ce doc) → Phase B B∥C
**seq migration** : 95 (`migration-oauth-connections-seq95.sql`, depends_on seq 94 G9)

Connexions OAuth **natives par tenant** : Google Calendar + Slack (v1).
Gmail send-as / Microsoft 365 = v2 (hors scope).

---

## §0 audit (Chaman READ-ONLY)

- **OAuth LIVE à calquer** : `src/worker/migration-ghl-oauth.ts` = GOLD STANDARD
  (authorize 302, callback public, state CSRF via `env.STATE_STORE` KV TTL 600s
  one-time, chiffrement AES-GCM `encryptToken`/`decryptToken` avec `env.TOKEN_KEY`
  fallback no-op si absent, table dédiée, refresh cron `refreshExpiringGhlTokens`
  dans `scheduled()` worker.ts). `src/worker/meta-leadgen.ts` = pattern CRUD
  connexions multi-tenant (upsert, bornage client_id).
- **Backlog** : `src/worker/_v2-backlog/gcal.ts` = flow Google OAuth COMPLET
  (authUrl/callback/getAccessToken refresh/events lecture/sync) MAIS stocke les
  tokens dans `users.permissions` (PAS borné tenant, PAS chiffré) → on copie la
  **LOGIQUE** flow/scopes/refresh, PAS le module ; **il n'est PAS importé.**
- Config prête : `Env` (types.ts) avait `GOOGLE_*` commentés (gcal V2), `TOKEN_KEY`
  l.30, `STATE_STORE` l.31. wrangler cron `*/5` actif.
- Manifest dernière seq = 94 (G9 white-label) → **95 libre**.

---

## §6.A archi (tranché)

- **Table NEUVE `oauth_connections`** (id, client_id, agency_id, provider,
  access_token, refresh_token, expires_at, scopes, status, account_email,
  created_at, updated_at). Zéro FK.
- **v1 = Google Calendar + Slack** (Gmail send-as / M365 = v2).
- **Flag PAR PROVIDER via env var** : `GOOGLE_OAUTH_CLIENT_ID/SECRET`,
  `SLACK_CLIENT_ID/SECRET`. Si absent → `authorize` renvoie `{error:'... non
  configuré'}` **400** (PAS 500, calque gcal.ts:28), `callback` no-op.
  Activation = Rochdi pose les secrets via `wrangler secret put`.
- **Tokens CHIFFRÉS** via `encryptToken`/`decryptToken` RÉUTILISÉS (AES-GCM /
  TOKEN_KEY) ; fallback clair si TOKEN_KEY absent (limite documentée, calque GHL).
- Capability `settings.manage` (ZÉRO ajout à ALL_CAPABILITIES). Bornage tenant
  strict.
- Refresh = **LAZY v1** (`getOauthAccessToken` refresh si expiré, calque
  `getGcalAccessToken`). Cron optionnel best-effort.
- Google Cal = connexion + **LECTURE v1** (events). Sync 2-way écriture = v2.

---

## §6.B migration seq 95

`migration-oauth-connections-seq95.sql`, depends_on `migration-whitelabel-seq94.sql`.
En-tête calque seq 93/94. Timestamps `datetime('now')`. Zéro FK/CHECK/ALTER.
provider/status validés HANDLER.

```sql
CREATE TABLE IF NOT EXISTS oauth_connections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT,
  provider TEXT,
  access_token TEXT, refresh_token TEXT, expires_at TEXT,
  scopes TEXT, status TEXT DEFAULT 'active', account_email TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_conn_tenant ON oauth_connections(client_id, provider);
```

Manifest :
```json
{ "seq": 95, "file": "migration-oauth-connections-seq95.sql", "depends_on": ["migration-whitelabel-seq94.sql"], "objects": ["table:oauth_connections","index:oauth_connections"], "risk": "low" }
```

---

## §6.C routes worker.ts

- **PUBLIC hors-try** (après GHL callback) :
  `GET /api/oauth/:provider/callback` (échange code, state KV valide, tenant
  depuis state — pas d'auth JWT car retour navigateur).
- **PROTÉGÉ post-requireAuth** :
  - `GET /api/oauth/:provider/authorize` (URL + state KV, capGuard settings.manage)
  - `GET /api/oauth/connections` (liste tenant-bornée)
  - `DELETE /api/oauth/connections/:id` (re-borne tenant)
  - `GET /api/oauth/gcal/events` (lecture v1)
- Régex `:provider` whitelistée `(google|slack)`. Préfixe `/api/oauth/*` neuf
  (ne chevauche ni `/api/meta/oauth` ni `/api/migration/ghl/oauth`).

---

## §6.D api.ts

`getOauthConnections()`, `deleteOauthConnection(id)`, `oauthAuthorizeUrl(provider)`
(redirection authorize via `window.location.href`, calque bouton Meta
Integrations.tsx:668). **ApiResponse INCHANGÉ.** Type `OauthConnection`
(projection SANS tokens).

---

## §6.E i18n

Namespace `integrations.*` étendu de 4 clés (parité ×4 : en/es/fr-FR/fr-CA) :
`integrations.oauth.connect` / `.disconnect` / `.connected_as` (param `{email}`)
/ `.not_configured`.

---

## §6.F pages (Phase B Manager-C)

`Integrations.tsx` : basculer Slack + nouveau Google Calendar de
`availability:'soon'` → OAuth (bouton `window.location.href =
oauthAuthorizeUrl('google')`) + panneau connexions actives (`getOauthConnections`).

---

## §6.G découpage

- **Phase A SOLO (CE LOT)** : migration seq 95 + manifest + `src/worker/oauth.ts`
  NEUF (stubs signatures FIGÉES : `handleOauthAuthorize`/`handleOauthCallback`/
  `handleListOauthConnections`/`handleDeleteOauthConnection`/`handleOauthGcalEvents`
  + helpers `getOauthAccessToken`, `providerCredentials`, corps placeholder/stub)
  + routes worker.ts (callback public + protégé) + Env vars types.ts + api.ts
  helpers + type `OauthConnection` + i18n ×4 + ce doc.
- **Phase B Manager-B** : corps `oauth.ts` (flow réel, `encrypt`/`decrypt`
  réutilisés, refresh lazy, flag par provider). Signatures NE CHANGENT PAS.
- **Phase B Manager-C** : `Integrations.tsx`.

---

## §6.I garde-fous

- Flag inactif (credentials absents = **400 propre / no-op, JAMAIS 500**).
- Tokens chiffrés AES-GCM (TOKEN_KEY ; limite clair documentée si absent).
- Bornage tenant strict (`oauth_connections.client_id` depuis auth/state
  **JAMAIS body** ; DELETE re-borne ; state KV porte le tenant, jamais
  cross-tenant).
- E4-E6 / CHECK59 jamais touchés · ZÉRO ajout à ALL_CAPABILITIES · ApiResponse
  inchangé · zéro FK · `datetime('now')` · `_v2-backlog/gcal.ts` reste DÉBRANCHÉ
  (zéro import) · git jamais.

---

## État Phase A (livré)

| Élément | Fichier | État |
|---|---|---|
| Migration seq 95 | `migration-oauth-connections-seq95.sql` | ✅ créé |
| Manifest entry | `docs/migrations-manifest.json` | ✅ seq 95 ajouté |
| Module backend | `src/worker/oauth.ts` | ✅ stubs signatures figées |
| Routes callback public | `src/worker.ts` (hors-try) | ✅ |
| Routes protégées | `src/worker.ts` (routeProtected) | ✅ |
| Env vars | `src/worker/types.ts` | ✅ GOOGLE_OAUTH_* + SLACK_* |
| api.ts helpers + type | `src/lib/api.ts`, `src/lib/types.ts` | ✅ |
| i18n ×4 | `src/lib/i18n/{en,es,fr-FR,fr-CA}.ts` | ✅ 4 clés / catalogue |

**Stubs Phase A** : `authorize`/`callback`/`delete`/`getOauthAccessToken`
renvoient 501 / null en placeholder (flag inactif renvoie déjà le 400 réel) ;
`connections`/`gcal/events` renvoient `{data:[]}`. Manager-B remplace les corps
SANS toucher aux signatures (worker.ts gelé).

---

## IMPLEMENTATION-LOG — Phase B Manager-C (UI Integrations)

**Date** : 2026-05-20 · **Périmètre EXCLUSIF** : `src/pages/Integrations.tsx`,
bloc CSS sentinellé G4 dans `src/index.css`, ce doc. **DISJOINT** de Manager-B
(`src/worker/oauth.ts`) — zéro touch worker/api/types/i18n/migration.

### Fichiers modifiés
| Fichier | Nature |
|---|---|
| `src/pages/Integrations.tsx` | Branchement OAuth Slack + Google Calendar + panneau connexions actives |
| `src/index.css` | Bloc `/* === LOT G4 OAuth === */` … `/* === Fin LOT G4 === */` (1 classe `.oauth-config-hint`) |
| `docs/LOT-OAUTH-G4.md` | Ce log |

### UI livrée
1. **Cartes OAuth connectables** :
   - `slack` basculé `availability:'soon'`→`'live'` + `oauthProvider:'slack'`, `fields:[]` (champ webhook_url retiré, remplacé par OAuth).
   - `google_calendar` AJOUTÉ (catégorie `calendar`, icône 📆, `oauthProvider:'google'`).
   - Nouvelle prop `oauthProvider?: 'google' | 'slack'` sur `IntegrationConfig`.
   - Bouton **Connecter** (`integrations.oauth.connect`) → `window.location.href = oauthAuthorizeUrl(provider)` (calque EXACT bouton Meta l.668).
   - **Hint d'honnêteté** `integrations.oauth.not_configured` visible sous la description (le backend renvoie 400/`?error=not_configured` proprement si credentials serveur absents).
2. **Panneau `OauthConnectionsPanel`** : `getOauthConnections()` au montage (+ refresh via `reloadKey` au retour OAuth). Liste provider (icône+nom) + `integrations.oauth.connected_as {email}` + Tag statut. Bouton **Déconnecter** (`integrations.oauth.disconnect`) → `useConfirm` (danger) → `deleteOauthConnection(id)` → toast + reload. Panneau masqué si zéro connexion (anti-bruit).
3. **Retour flow OAuth** : `useEffect` au montage lit `?connected=<provider>` (toast succès + reload panneau) / `?error=` (toast erreur, `not_configured` traduit), puis `history.replaceState` nettoie l'URL (pas de re-toast au refresh).

### Checks
- **i18n** : 4 clés Phase A câblées (`connect`/`disconnect`/`connected_as {email}`/`not_configured`). **AUCUNE clé créée.** (Réutilise aussi `integrations.status.connected` et `integrations.kpi.connected` existantes pour les libellés annexes.)
- **Intégrations existantes préservées** : Facebook/Google Lead Ads (LeadAdsConfigPanel), GHL/Resend/webchat/meta_messaging/Zapier/Apollo/Twilio/Calendly INCHANGÉS. Bouton Meta `/api/meta/oauth/start` intact. Webhook universel + LeadSourcesCallout + doc API intacts.
- **Disjonction** : zéro touch `src/worker/*`, `worker.ts`, `api.ts`, `types.ts`, i18n, migration. Helpers/type/clés consommés tels quels (signatures vérifiées : `oauthAuthorizeUrl('google'|'slack')`, `getOauthConnections()→ApiResponse<OauthConnection[]>`, `deleteOauthConnection(id)`).
- **CSS** : 1 seul bloc sentinellé G4 en fin de fichier (après G9). Reste = primitives existantes (Card/Button/Tag/Icon).
- **ApiResponse** : inchangé — string-match sur `res.error`.

### Écarts / notes
- La carte slack perd son champ manuel `webhook_url` (remplacé par OAuth natif, cohérent avec l'intention LOT G4). Modif additive sinon : aucune autre intégration touchée.
- `OauthConnection.status` typé `string` (pas d'union) → comparaison `=== 'active'` pour le variant Tag, sinon affiche la valeur brute.
- Le panneau ne s'affiche que s'il y a ≥1 connexion (évite un panneau vide permanent tant que les credentials serveur ne sont pas posés).

---

## IMPLEMENTATION-LOG — Phase B Manager-B (backend exclusif)

**Date** : 2026-05-20 · **Périmètre écrit** : `src/worker/oauth.ts` UNIQUEMENT
(+ ce log). `Integrations.tsx` (Manager-C) NON touché. worker.ts / api.ts /
types.ts / i18n / migration seq 95 / manifest GELÉS — zéro touch.

### Corps réels écrits (5 handlers + getter)

| Symbole | Comportement réel |
|---|---|
| `handleOauthAuthorize` | capGuard `settings.manage` → `providerCredentials` null ⇒ **400** (jamais 500) → tenant strict (`auth.tenant.clientId`, sans tenant ⇒ 400) → nonce CSRF (2× randomUUID) stocké KV `oauth_state:<nonce>` TTL 600s avec `{client_id, agency_id, provider, origin}` → authUrl (Google `access_type=offline&prompt=consent` ; Slack `chat:write,channels:read`) → **`Response.redirect(authUrl, 302)`** (worker.ts retourne tel quel). KV absent ⇒ 503. |
| `handleOauthCallback` | PUBLIC. creds null ⇒ **redirect `/integrations?error=not_configured`** (zéro réseau, contrat front Manager-C). State KV **lecture PUIS delete** (one-time anti-replay) ; `provider` du state re-vérifié = URL ; `exchangeCode` ; **encryptToken** access+refresh AVANT stockage ; DELETE+INSERT borné `(client_id DU STATE, provider)` ; `account_email` via userinfo Google / `team.name` Slack. **Toujours redirect 302** `?connected=<provider>` (succès) / `?error=<provider>_<raison>` (échec). try/catch global ⇒ **jamais 500 brut**. |
| `handleListOauthConnections` | capGuard → SELECT borné `client_id = auth.tenant.clientId` · **PROJECTION SANS TOKENS** (`id, provider, status, account_email, expires_at, created_at`) · `{data}`. |
| `handleDeleteOauthConnection` | capGuard → SELECT par id → **re-vérifie `client_id === tenant`** (404 sinon) → DELETE `WHERE id=? AND client_id=?` · `{data:{deleted:true}}`. |
| `handleOauthGcalEvents` | capGuard → `getOauthAccessToken(env, auth, 'google')` (null ⇒ `{data:{events:[]}}`) → GET Calendar v3 `primary/events` (timeMin=now, max 50) → events normalisés · `{data:{events}}`. Best-effort. |
| `getOauthAccessToken(env, auth, provider)` | **signature FIGÉE respectée** (lookup connexion EN INTERNE par tenant). `decryptToken(access)` ; valide (marge 60s) ⇒ tel quel ; expiré + refresh_token ⇒ POST refresh → `encryptToken` + UPDATE borné `(id, client_id)`. refresh KO ⇒ ancien token (best-effort). null si creds/tenant/connexion absent. |

### Helpers privés ajoutés (oauth.ts interne)
- `tenantOf(auth)` → `{clientId, agencyId}` depuis `auth.tenant` (fallback `auth.clientId`). **Jamais le body.**
- `redirectUri(origin, provider)` → `<origin>/api/oauth/<provider>/callback`.
- `exchangeCode(...)` → normalise Google (authorization_code + userinfo email) / Slack (oauth.v2.access, bot token, team.name). null si échec.
- types `OauthState` (forme KV) + `TokenExchange`.

### Garde-fous CONFIRMÉS
- **Flag inactif** : credentials absents ⇒ authorize **400** / callback **redirect `error=not_configured`** — **ZÉRO appel réseau**, jamais 500.
- **Tokens chiffrés** : `encryptToken` AES-GCM avant tout stockage ; `decryptToken` à la lecture/refresh. Liste = projection **sans aucun token**.
- **Bornage tenant** : `client_id` du STATE KV (callback) / `auth.tenant` (autres) — **jamais body** ; DELETE re-borne (404 cross-tenant) ; state KV **one-time** ; UPDATE refresh borné `(id, client_id)`.
- **`_v2-backlog/gcal.ts` NON importé** : logique calquée, zéro import.
- ApiResponse / apiFetch inchangés (`{data}`/`{error}`, pas de champ `code`). Aucun ajout `ALL_CAPABILITIES`. E4-E6 / CHECK59 jamais touchés.

### Écarts vs brief
- Brief décrivait `getOauthAccessToken(env, connection)` ; **signature réelle Phase A = `(env, auth, provider)`** (gelée) → respectée, lookup connexion en interne.
- Callback creds-absent : brief disait « no-op 400 » ; aligné sur **redirect `?error=not_configured`** (navigation navigateur + contrat front Manager-C) plutôt qu'un JSON 400 brut.
- gcal events sans connexion : `{data:{events:[]}}` (best-effort, UI sereine) plutôt qu'un 401 — capGuard couvre déjà l'autorisation.
- UPSERT : table seq 95 sans contrainte UNIQUE ⇒ **DELETE+INSERT** borné `(client_id, provider)` (idempotence) au lieu d'`ON CONFLICT`.

**Disjonction** : `src/pages/Integrations.tsx` (Manager-C) **ZÉRO touch**.
**Build délégué Antigravity** (VM sans bun/node).
