# LOT GBP Integration — Sprint 32

> Doc contrat §6 figé. Migration : seq127 — `migration-gbp-integration-seq127.sql`.
> Compagnons : `LOT-OAUTH-G4.md` (Sprint G4 seq95 — table `oauth_connections` + provider Google base), `BINDINGS-SECRETS-S10.md` §« Sprint 32 — GBP scope addition », `RGPD-GBP.md`.

## Objectif

Brancher **Google Business Profile (GBP)** réel sur la stack Intralys, en remplacement du mock historique (`seq110` / `seq109` côté reviews + posts), avec une activation **par tenant** conditionnée à :

1. La présence d'une connexion `oauth_connections` `provider='google_business'` valide pour le tenant (Sprint G4 réutilisé).
2. La validation Google Cloud Console du scope régulé `business.manage` (Brand Verification + App Verification — peut prendre 4-6 semaines, cf. `BINDINGS-SECRETS-S10.md` §Sprint 32).
3. Le flag tenant `GBP_LIVE_ENABLED` levé (override admin, même idiome que Sprint 31 Stripe live).

Tant que la connexion OAuth GBP n'existe pas pour le tenant **ou** que le flag tenant n'est pas levé → tous les endpoints conservent l'idiome `{ success: true, mock: true, reason: 'gbp_not_connected' | 'live_branch_locked' }` (calque Sprint 31).

Périmètre v1 (Sprint 32) :

- **Connect / disconnect** OAuth GBP par tenant.
- **Lister + sélectionner** les locations GBP rattachées au compte connecté.
- **Lecture reviews** + **réponse aux reviews** (write API).
- **Création de posts** (Update / Event / Offer) sur la location active.
- **Lecture insights** (vues, recherches, actions — Business Profile Performance API).
- **Sync cron** 1×/heure max par tenant pour matérialiser reviews + insights en D1 (consommation côté front sans rate-limit Google).

## Sprint 32 vs Sprint G4 OAuth Google (provider distinct `google_business`)

Le Sprint G4 (`LOT-OAUTH-G4.md`, seq95) a posé la table `oauth_connections` et le flow OAuth Google **générique** (Calendar v1, scope `calendar.readonly`). Sprint 32 **n'ajoute pas** de nouvelle table OAuth — il **étend** le pattern existant avec un **provider distinct `google_business`** dans la même table.

| Aspect | Sprint G4 (seq95) | Sprint 32 (seq127) |
|---|---|---|
| Table OAuth | `oauth_connections` (créée) | `oauth_connections` (réutilisée, **aucune ALTER**) |
| Provider | `google_calendar`, `slack` | **`google_business`** (NOUVEAU, distinct) |
| Scopes | `calendar.readonly` | `https://www.googleapis.com/auth/business.manage` |
| OAuth client | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | **Mêmes secrets** (réutilisés) + scope additionnel demandé à Google Cloud Console |
| Verification Google | Aucune (scope `calendar.readonly` = non-sensible) | **Brand Verification + App Verification obligatoires** (scope `business.manage` = sensitive/restricted) |
| Tables métier | Aucune | `gbp_locations`, `gbp_reviews`, `gbp_posts`, `gbp_insights_snapshots` |
| Refresh tokens | LAZY (`getOauthAccessToken` calque GHL) | LAZY **+ cron horaire** par tenant (sync reviews/insights) |
| Activation | Configurer secrets → ON | Secrets + flag tenant `GBP_LIVE_ENABLED` + connexion OAuth tenant établie |

La distinction `provider='google_business'` est **critique** : un tenant peut avoir une connexion `google_calendar` SANS avoir de connexion `google_business`, et vice-versa. Pas de réutilisation transversale des tokens (scopes différents, refresh tokens différents). Index seq95 `idx_oauth_conn_tenant ON (client_id, provider)` couvre déjà le lookup.

## §6 Contrats figés

### §6.1 Migration seq127

Fichier racine : `migration-gbp-integration-seq127.sql`. Manifest entrée seq127 (`docs/migrations-manifest.json`), `depends_on: ["migration-oauth-connections-seq95.sql"]`.

Pattern 100 % ADDITIF, zéro FK / CHECK / ALTER :

- `CREATE TABLE IF NOT EXISTS gbp_locations` — locations GBP rattachées au tenant (`id`, `client_id`, `gbp_location_id` UNIQUE par tenant, `gbp_account_id`, `title`, `address`, `phone`, `website`, `category_primary`, `is_active`, `synced_at`, `created_at`, `updated_at`).
- `CREATE TABLE IF NOT EXISTS gbp_reviews` — reviews matérialisées (`id`, `client_id`, `gbp_location_id`, `gbp_review_id` UNIQUE, `reviewer_name`, `reviewer_photo_url`, `rating` 1-5, `comment`, `reply_text`, `reply_updated_at`, `created_at` review, `updated_at` review, `synced_at`).
- `CREATE TABLE IF NOT EXISTS gbp_posts` — posts publiés via notre worker (`id`, `client_id`, `gbp_location_id`, `gbp_post_id` UNIQUE, `topic_type` `STANDARD|EVENT|OFFER`, `language_code`, `summary`, `media_url`, `call_to_action_type`, `call_to_action_url`, `state` `LIVE|REJECTED|PROCESSING`, `search_url`, `created_at`, `updated_at`).
- `CREATE TABLE IF NOT EXISTS gbp_insights_snapshots` — snapshots quotidiens des insights (`id`, `client_id`, `gbp_location_id`, `snapshot_date` `YYYY-MM-DD`, `views_search`, `views_maps`, `searches_direct`, `searches_discovery`, `actions_website`, `actions_directions`, `actions_phone`, `raw_json`, `created_at`). UNIQUE `(client_id, gbp_location_id, snapshot_date)`.

Index :
- `idx_gbp_locations_tenant ON gbp_locations(client_id, is_active)`
- `idx_gbp_reviews_location ON gbp_reviews(client_id, gbp_location_id, created_at DESC)`
- `idx_gbp_reviews_unanswered ON gbp_reviews(client_id, gbp_location_id) WHERE reply_text IS NULL`
- `idx_gbp_posts_location ON gbp_posts(client_id, gbp_location_id, created_at DESC)`
- `idx_gbp_insights_snapshot ON gbp_insights_snapshots(client_id, gbp_location_id, snapshot_date DESC)`

Aucun CHECK. Validation rating/topic_type/state appartient aux handlers `gbp.ts`. Migration `seq127` réversible logiquement (`DROP TABLE IF EXISTS` sur les 4 tables) — pas en prod si données présentes.

### §6.2 OAuth flow distinct (`provider='google_business'`)

Calque exact du flow Sprint G4 (`src/worker/oauth.ts`) — **aucun nouveau module OAuth** — mais avec :

- **`provider='google_business'`** dans l'URL : `GET /api/oauth/google_business/authorize` → redirect 302 Google avec :
  - `client_id = env.GOOGLE_OAUTH_CLIENT_ID`
  - `redirect_uri = ${origin}/api/oauth/google_business/callback`
  - `scope = 'https://www.googleapis.com/auth/business.manage'`
  - `access_type=offline&prompt=consent` (force refresh_token)
  - `state = <CSRF token>` → posé dans `env.STATE_STORE` KV TTL **600s**, one-time, contient `{ clientId, agencyId, returnUrl }` chiffré minimalement (calque G4 §6.D).
- **Callback `GET /api/oauth/google_business/callback`** (PUBLIC hors-try, calque G4) :
  - Vérifie `state` KV → 400 si absent/expiré (CSRF).
  - Échange `code` contre `access_token + refresh_token` (POST `oauth2.googleapis.com/token`).
  - Upsert `oauth_connections` `(client_id, provider='google_business')` avec tokens **chiffrés** via `encryptToken` (TOKEN_KEY) — fallback clair si TOKEN_KEY absent (limite documentée calque G4 §6.E).
  - Récupère `account_email` via `https://www.googleapis.com/oauth2/v2/userinfo` pour affichage.
  - Redirect navigateur vers `returnUrl` (front affiche `GbpConnectButton` en état connecté).
- **Si `env.GOOGLE_OAUTH_CLIENT_ID` ou `_SECRET` absent** → `authorize` renvoie `{ error: 'google_business OAuth non configuré' }` **400** (calque G4, PAS 500). Callback no-op.
- **Disconnect `DELETE /api/oauth/google_business/connection`** (protégé, `settings.manage`) → UPDATE `oauth_connections SET status='revoked'` + best-effort POST `https://oauth2.googleapis.com/revoke?token=<refresh_token>` (ignore erreur revoke).

### §6.3 Helpers `gbp-client.ts` (Chaman §4.3)

`src/worker/lib/gbp-client.ts` — wrappers SDK-free (fetch direct, calque pattern `gcal.ts` v2-backlog) :

- `isGbpEnabledForTenant(env, clientId): Promise<boolean>` — combinaison flag global (`GOOGLE_OAUTH_CLIENT_ID` présent) + flag tenant (`GBP_LIVE_ENABLED` levé dans `clients.metadata_json.gbp_live_enabled = 1`) + connexion OAuth active (`oauth_connections WHERE client_id=? AND provider='google_business' AND status='active'`).
- `getGbpAccessToken(env, clientId): Promise<string>` — lit token chiffré D1, déchiffre via `decryptToken`, refresh LAZY si `expires_at < now() + 60s` (POST `oauth2.googleapis.com/token` avec `grant_type=refresh_token`), persiste nouveau token chiffré. Calque exact `getOauthAccessToken` Sprint G4.
- `listGbpAccounts(token): Promise<GbpAccount[]>` — GET `https://mybusinessaccountmanagement.googleapis.com/v1/accounts`.
- `listGbpLocations(token, accountName): Promise<GbpLocation[]>` — GET `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri,categories`.
- `listGbpReviews(token, locationName, pageToken?): Promise<{ reviews, nextPageToken }>` — GET `https://mybusiness.googleapis.com/v4/${locationName}/reviews?pageSize=50&pageToken=...` (legacy v4 — toujours seule API reviews disponible côté Google début 2026).
- `replyToGbpReview(token, reviewName, replyText): Promise<GbpReviewReply>` — PUT `https://mybusiness.googleapis.com/v4/${reviewName}/reply` body `{ comment: replyText }`.
- `createGbpPost(token, locationName, payload): Promise<GbpPost>` — POST `https://mybusiness.googleapis.com/v4/${locationName}/localPosts` body `{ topicType, languageCode, summary, media?, event?, offer?, callToAction? }`.
- `getGbpInsights(token, locationName, dateRange): Promise<GbpInsights>` — POST `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries` body `{ dailyMetrics: [BUSINESS_IMPRESSIONS_DESKTOP_SEARCH, BUSINESS_IMPRESSIONS_MOBILE_SEARCH, BUSINESS_IMPRESSIONS_DESKTOP_MAPS, BUSINESS_IMPRESSIONS_MOBILE_MAPS, BUSINESS_DIRECTION_REQUESTS, CALL_CLICKS, WEBSITE_CLICKS], dailyRange: { startDate, endDate } }`.

Tous les helpers **rate-limit-aware** : 429 → `await sleep(parseInt(retryAfter) * 1000)` + 1 retry max. 401 → tentative refresh token puis 1 retry. 403 sur `business.manage` → propage erreur explicite `{ error: 'gbp_scope_not_verified', message: 'App verification Google en attente' }` (sentinel pour front).

### §6.4 Handlers `gbp.ts` (Chaman §4.4 — 9 handlers)

`src/worker/gbp.ts` — handlers Phase A (stubs Manager-B remplira) :

1. `handleGetGbpStatus(env, auth)` — GET `/api/gbp/status` → `{ connected, accountEmail, locationsCount, activeLocationId, scopeVerified, mock? }`. Cap `settings.manage`.
2. `handleListGbpLocations(env, auth)` — GET `/api/gbp/locations` → liste D1 `gbp_locations WHERE client_id=?`. Cap `settings.manage`.
3. `handleSyncGbpLocations(env, auth)` — POST `/api/gbp/locations/sync` → appel `listGbpAccounts` + `listGbpLocations` Google, upsert D1. Cap `settings.manage`. Rate-limit : max 1×/5min par tenant (sentinel KV).
4. `handleSetActiveLocation(request, env, auth)` — POST `/api/gbp/locations/:locationId/activate` → UPDATE `gbp_locations SET is_active=0 WHERE client_id=?` puis SET `is_active=1 WHERE id=?`. Cap `settings.manage`.
5. `handleListGbpReviews(env, auth, locationId)` — GET `/api/gbp/locations/:locationId/reviews?status=all|unanswered&limit=50` → lecture D1 matérialisée (PAS d'appel Google direct). Cap `reviews.view`.
6. `handleReplyGbpReview(request, env, auth, reviewId)` — POST `/api/gbp/reviews/:reviewId/reply` body `{ replyText }` → `replyToGbpReview` Google + UPDATE D1 `gbp_reviews.reply_text + reply_updated_at`. Cap `reviews.manage`.
7. `handleCreateGbpPost(request, env, auth)` — POST `/api/gbp/posts` body `{ locationId, topicType, summary, mediaUrl?, callToAction?, event?, offer? }` → `createGbpPost` Google + INSERT D1 `gbp_posts`. Cap `social.manage`. Validation zod `GbpPostCreateSchema`.
8. `handleListGbpPosts(env, auth, locationId)` — GET `/api/gbp/locations/:locationId/posts?limit=20` → lecture D1. Cap `social.view`.
9. `handleGetGbpInsights(env, auth, locationId)` — GET `/api/gbp/locations/:locationId/insights?days=30` → lecture D1 `gbp_insights_snapshots` agrégée. Cap `reviews.view` (réutilisé, pas de nouveau cap insights v1).

Idiome standard de chaque handler (calque Sprint 31) :

```ts
if (!(await isGbpEnabledForTenant(env, auth.clientId))) {
  return { success: true, mock: true, reason: 'gbp_not_connected' };
}
```

Capabilities **réutilisées** depuis `ALL_CAPABILITIES` : `settings.manage`, `reviews.view`, `reviews.manage`, `social.view`, `social.manage` (toutes existent déjà — voir audit Chaman §4.4). **Zéro nouvelle capability ajoutée.**

### §6.5 Routes worker (11 routes `/api/gbp/*` — Chaman §4.4)

Câblées dans `src/worker.ts` dans le bloc protégé post-`requireAuth`, après le bloc Sprint G4 OAuth (sauf les 2 OAuth GBP qui vont dans le bloc PUBLIC hors-try, calque G4) :

**PUBLIC (hors-try, avant `requireAuth`)** :

```
GET    /api/oauth/google_business/authorize        → handleOauthAuthorize(provider='google_business')
GET    /api/oauth/google_business/callback         → handleOauthCallback(provider='google_business')
```

**PROTÉGÉ (post-`requireAuth`)** :

```
DELETE /api/oauth/google_business/connection                  → handleDisconnectGbp
GET    /api/gbp/status                                        → handleGetGbpStatus
GET    /api/gbp/locations                                     → handleListGbpLocations
POST   /api/gbp/locations/sync                                → handleSyncGbpLocations
POST   /api/gbp/locations/:locationId/activate                → handleSetActiveLocation
GET    /api/gbp/locations/:locationId/reviews                 → handleListGbpReviews
POST   /api/gbp/reviews/:reviewId/reply                       → handleReplyGbpReview
POST   /api/gbp/posts                                         → handleCreateGbpPost
GET    /api/gbp/locations/:locationId/posts                   → handleListGbpPosts
GET    /api/gbp/locations/:locationId/insights                → handleGetGbpInsights
```

Total : **2 PUBLIC OAuth + 9 PROTÉGÉS = 11 routes**. Style `await import('./gbp')` dynamique (calque bloc voisin G4).

### §6.6 Cron sync `gbp-sync.ts` (1×/heure par tenant max)

`src/worker/gbp-sync.ts` — fonction `syncGbpForAllTenants(env): Promise<void>` appelée depuis `scheduled()` worker.ts.

Trigger : cron existant `*/5 * * * *` (déjà déclaré `wrangler.jsonc:45-47`). Pas de nouveau cron — on **filtre par tenant** :

```ts
const tenants = await env.DB.prepare(
  `SELECT DISTINCT oc.client_id
   FROM oauth_connections oc
   WHERE oc.provider = 'google_business' AND oc.status = 'active'
   AND (oc.last_synced_at IS NULL OR datetime(oc.last_synced_at) < datetime('now', '-1 hour'))`
).all();
```

Pour chaque tenant éligible (max 1×/heure) :

1. Liste les locations actives (`gbp_locations WHERE client_id=? AND is_active=1`).
2. Pour chaque location :
   - `listGbpReviews(token, locationName)` → upsert `gbp_reviews` (nouveau review OU update si `updated_at` Google plus récent).
   - `getGbpInsights(token, locationName, { startDate: today-1, endDate: today-1 })` → INSERT OR REPLACE `gbp_insights_snapshots` snapshot jour J-1 (Google a 48h de latence sur insights, on prend J-1 fiable).
3. UPDATE `oauth_connections.last_synced_at = datetime('now')` pour ce tenant.

Garde-fous :
- **Max 10 tenants / tick** (`*/5min`) → évite saturation cron 30s limit Cloudflare.
- **Best-effort** : exception sur 1 tenant → log + skip + continue les autres.
- **Rate-limit Google** : 429 → skip ce tenant pour le tick (retry au tick suivant).
- **Refresh token expiré** (`invalid_grant`) → UPDATE `oauth_connections.status='reauth_required'` + notification admin (réutilise pattern Sprint G4).

Ajouter colonne `last_synced_at TEXT` à `oauth_connections` **uniquement si elle n'existe pas déjà** (vérifier seq95) — sinon ALTER additif idempotent dans seq127.

### §6.7 i18n ~25 clés `gbp.*` × 4 catalogues (Chaman §4.5)

Bloc ajouté en parité stricte dans `fr-CA`, `fr-FR`, `en`, `es` :

```
gbp.connect.title
gbp.connect.description
gbp.connect.cta
gbp.connect.connected_as              {email}
gbp.connect.disconnect
gbp.connect.verification_pending      (scope business.manage en attente Google)
gbp.locations.title
gbp.locations.empty
gbp.locations.sync_cta
gbp.locations.sync_success            {count} locations synchronisées
gbp.locations.activate
gbp.locations.active_badge
gbp.reviews.title
gbp.reviews.empty
gbp.reviews.unanswered_count          {count} sans réponse
gbp.reviews.reply_placeholder
gbp.reviews.reply_cta
gbp.reviews.reply_success
gbp.posts.title
gbp.posts.compose_cta
gbp.posts.topic.standard
gbp.posts.topic.event
gbp.posts.topic.offer
gbp.posts.cta.book / learn_more / order / shop / sign_up / call
gbp.insights.title
gbp.insights.views_search / views_maps / actions_website / actions_directions / actions_phone
gbp.error.not_connected
gbp.error.scope_not_verified          (App verification Google en attente, 4-6 semaines)
gbp.error.rate_limit                  (Réessayez dans quelques minutes)
gbp.error.reply_too_long              (max 4096 caractères)
```

Tutoiement fr-CA (`Connecte ton compte Google Business`, `Tes locations`), vouvoiement fr-FR (`Connectez votre compte Google Business`, `Vos locations`). Parité stricte vérifiée par `bun run test:i18n:parity` (Sprint S6).

### §6.8 Composants frontend

Skeletons à créer dans `src/components/gbp/` (Manager-C remplira) :

- **`GbpConnectButton.tsx`** — bouton CTA initial. État `disconnected` → `Connecter Google Business Profile` (déclenche redirect `/api/oauth/google_business/authorize`). État `connected` → badge `Connecté en tant que {email}` + bouton `Déconnecter`. État `verification_pending` → bandeau info `App verification Google en attente`.
- **`GbpLocationsList.tsx`** — liste des locations rattachées. Empty state → CTA `Synchroniser depuis Google`. Chaque ligne : titre, adresse, badge `Active` (si is_active=1), bouton `Activer` (si pas active).
- **`GbpReviewsTab.tsx`** — tab reviews avec filtre `Toutes | Sans réponse`. Chaque review : étoiles, nom, photo, commentaire, date, réponse existante OU textarea + bouton `Répondre` (4096 char max, compteur live).
- **`GbpPostComposer.tsx`** — modal composer post. Selector `Topic Type` (Standard/Event/Offer), textarea summary (1500 char max), upload media URL, selector CTA type, champ CTA URL. Validation côté front + zod côté worker.
- **`GbpInsightsPanel.tsx`** — graphes line chart 30 derniers jours pour views (search+maps), actions (website/directions/phone). Utilise primitive `Sparkline` existante (Sprint S5).

**Interdit** : tout composant qui collecte directement le `refresh_token` Google côté front (PCI-équivalent pour OAuth). Le flow passe **uniquement** par la redirection `/api/oauth/google_business/authorize`.

## Garde-fous PCI/RGPD

### Tokens chiffrés (calque Sprint G4)

- `access_token` + `refresh_token` GBP stockés dans `oauth_connections` **chiffrés AES-GCM** via `encryptToken(env, plaintext)` (clé `env.TOKEN_KEY`). Fallback clair si `TOKEN_KEY` absent (limite documentée — interdit en prod, cf. `SECRET-STORE-S7.md`).
- Aucun token n'est jamais retourné dans une réponse API au front. Le front consomme uniquement les données dérivées (locations, reviews, posts, insights).
- Logs sanitization : `gbp-client.ts` ne log jamais `ya29.xxx` ou `1//xxx` (refresh tokens) — utiliser `[REDACTED]` (calque audit_log seq121).

### RGPD — données personnelles reviews

- `gbp_reviews.reviewer_name` + `reviewer_photo_url` = **données personnelles tierces** (clients Google qui laissent un avis). Stockage en D1 = traitement RGPD :
  - **Base légale** : intérêt légitime (gestion de la réputation du commerçant tenant).
  - **Durée de conservation** : 5 ans (alignement avec durée commerciale standard, cf. `RGPD-GBP.md`).
  - **Droit d'opposition** : si un reviewer demande la suppression, le tenant doit pouvoir supprimer la ligne D1 (handler v2, hors scope Sprint 32 — pour v1, suppression manuelle via console admin Intralys).
  - **Pas d'enrichissement** : on ne croise jamais `reviewer_name` avec nos contacts/leads (interdit explicite Manager-B).
- `gbp_posts.summary` peut contenir des données publiées par le tenant (pas de PII tierce attendue, validation côté front).

### Rate-limit Google API

- GBP API a un quota strict (1 QPM par minute pour la plupart des endpoints, 10 QPS pour les `accounts.list`).
- Cron sync borné à 10 tenants / tick `*/5min` = max 120 tenants/heure.
- Reply review = action user → no batch, mais idempotent (Google rejette les doublons).
- 429 → backoff exponentiel : 1s, 2s, 4s (max 3 retries) puis abandon avec log.

### Scope `business.manage` — review Google Cloud Console

- Le scope `https://www.googleapis.com/auth/business.manage` est **sensitive/restricted** côté Google :
  1. Brand Verification du domaine `app.intralys.io` requise (DNS TXT).
  2. App Verification (review humaine Google) — peut prendre **4-6 semaines**.
  3. Video demo de l'app montrant l'usage du scope obligatoire.
- En attendant verification :
  - Mode dev/test : Google permet **100 users test** sans verification (à ajouter manuellement dans Google Cloud Console → OAuth consent screen → Test users).
  - Mode prod : Brand Verification + App Verification **requises** avant rollout client beta.
- Détails complets : `BINDINGS-SECRETS-S10.md` §« Sprint 32 — GBP scope addition ».

## Hors-scope

- **Pub/Sub push notifications** Google (reviews/posts/locations real-time) → v2 (requiert Cloud Pub/Sub subscription + endpoint webhook signed). v1 = pull cron horaire suffit pour MVP.
- **Q&A (questions & answers)** — list/answer/delete Q&A sur location → v2 (API séparée, scope identique mais besoin métier non prioritaire MVP).
- **Stripe Tax intégration GBP** (afficher tax info dans posts Offer) → backlog E6 (cf. `LOT-BILLING-STRIPE-LIVE.md` hors-scope).
- **Multi-account Google par tenant** (tenant connecte 2 comptes Google distincts) → v2. v1 = 1 connexion `google_business` par `client_id`.
- **Bulk reply reviews via IA** (suggestions de réponse) → backlog `LOT-AI-CONTENT.md` (intégration post-Sprint 32).
- **Media upload natif** (envoi de photos depuis le composer post) → v2. v1 = URL externe uniquement (`mediaUrl` champ texte).
- **Verified location claim flow** (réclamer une location non encore vérifiée) → hors scope plateforme (action Google Console côté client final).
- **Local Service Ads (LSA) integration** → hors roadmap.

## Validation post-deploy

Checklist Rochdi après `wrangler deploy` Sprint 32 + secrets configurés + flag tenant levé :

1. **Connect** : naviguer `/settings/integrations/gbp` → cliquer `Connecter` → redirect Google → autoriser scope `business.manage` → callback OK → bouton affiche `Connecté en tant que rochdi@intralys.com`.
2. **Location sync** : cliquer `Synchroniser depuis Google` → toast `N locations synchronisées` → la liste affiche les locations réelles du compte. Activer une location → badge `Active` apparaît.
3. **Review reply** : tab Reviews → afficher au moins 1 review existante (lecture D1 OU sync direct) → écrire une réponse 50 caractères → cliquer `Répondre` → vérifier dans Google Maps que la réponse est visible (latence Google ~30s à 5min).
4. **Post creation** : composer un post `Standard` avec summary 200 chars + CTA `learn_more` + URL → vérifier dans le GBP que le post est en `LIVE` (latence ~1min). Tester `Event` (avec start/end date) et `Offer` (avec coupon code).
5. **Insights** : tab Insights → vérifier que les 30 derniers jours affichent des courbes non-vides (si la location a du trafic). Sinon vérifier `gbp_insights_snapshots` en D1 (`SELECT * FROM gbp_insights_snapshots WHERE client_id=? ORDER BY snapshot_date DESC LIMIT 30`).
6. **Disconnect** : cliquer `Déconnecter` → vérifier `oauth_connections.status='revoked'` en D1 → vérifier que les endpoints `/api/gbp/*` retournent `{ mock: true, reason: 'gbp_not_connected' }`.
7. **Cron sync** : attendre le prochain tick `*/5min` après une nouvelle review postée sur Google → vérifier que la review apparaît en D1 (`gbp_reviews`) dans l'heure suivant le post Google.

Si tout est vert → Sprint 32 validé, rollout beta tenants éligibles.

## Cross-references

- `LOT-OAUTH-G4.md` — Sprint G4 seq95 (table `oauth_connections`, flow OAuth Google base, helpers `encryptToken`/`decryptToken`)
- `BINDINGS-SECRETS-S10.md` §« Sprint 32 — GBP scope addition » — réutilisation `GOOGLE_OAUTH_CLIENT_ID/SECRET` + prérequis Google Cloud Console
- `SECRET-STORE-S7.md` — `TOKEN_KEY` AES-GCM (chiffrement tokens GBP)
- `RGPD-GBP.md` — analyse RGPD reviews tierces (base légale + durée conservation + droit opposition)
- `LOT-REPUTATION.md` — composants reviews génériques (réutilisation primitives UI)
- `LOT-SOCIAL-PLANNER.md` — composants posts génériques (réutilisation primitives UI)
- `migrations-manifest.json` seq127 — ordre canonique migration GBP
