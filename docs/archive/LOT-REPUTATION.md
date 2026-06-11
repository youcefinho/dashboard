# LOT REPUTATION — collecte 1st-party + routing intelligent (Sprint 8 : invitation par token → page PUBLIQUE de dépôt d'avis hébergée Intralys → routing intelligent note ≥ seuil → Google/FB public ∥ note < seuil → feedback privé interne → déclenchement AUTO via action workflow `request_review`)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-STOREFRONT-CHECKOUT.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE, jamais le brief).

Sprint resserré, **100% ADDITIF**. Le module Reviews EXISTE et reste INTACT
(`src/worker/reviews.ts` : demande d'avis email Resend + bulk + agrégation
`handleGetReviewStats` + réponse IA + CASL via `isLeadDnd` + anti-doublon 30j ;
`src/pages/Reviews.tsx` ; tables `review_requests` / `reviews_cache` seq 12 ; 7
routes `/api/reviews/*`). **Gaps = le différenciateur GHL :**
(a) page **PUBLIQUE** de dépôt d'avis hébergée Intralys (aucune route `/api/r/`,
aucun `PublicReview.tsx`) ; (b) **routing intelligent** (note ≥ seuil → redirige
vers Google/FB public ; note < seuil → feedback privé interne) ; (c)
**déclenchement AUTO** (action workflow `request_review` depuis `order_paid`/RDV).
Ce lot pose ces 3 pièces en **RÉUTILISANT** le pattern reviews.ts (Resend + token
+ CASL) et le pattern public form/booking (route par token). Google Business
Profile / Facebook restent **INACTIFS** (`_v2-backlog`, routes 404 — **NON
réactivés**) : le « public » se fait par **URL CONFIGURÉE**
(`reputation_settings.public_redirect_url` ou `clients.google_place_id`), JAMAIS
par une API GBP/FB live.

Architecture figée (NE PAS réinventer) :
- Migration seq **109** = STRICTEMENT ADDITIVE : 3 tables neuves
  (`review_invitations`, `private_feedback`, `reputation_settings`) en `CREATE
  TABLE IF NOT EXISTS` + 1 colonne `ALTER TABLE reviews_cache ADD COLUMN
  source_origin TEXT` (NULL, sans CHECK) + 2 index de lecture. Zéro
  CHECK/FK/DROP/RENAME/rebuild. `reviews_cache` (seq 12) N'EST PAS rebâtie.
- **CHECK / tables existants INTOUCHABLES** : `reviews_cache` n'est complétée que
  par un `ADD COLUMN` additif ; `review_requests` n'est PAS touchée ; les liens
  `client_id`/`lead_id`/`invitation_id` restent **APPLICATIFS** (zéro FK).
- Routes publiques = **AUCUNE auth, AUCUNE capability** (par token, bornage STRICT
  par l'invitation résolue). **ZÉRO ajout à `ALL_CAPABILITIES`.** Settings PRO =
  capability EXISTANTE `settings.manage` (réutilisée — calque
  storefront/SMS/WhatsApp/IVR/OAuth ; reviews.ts gate aussi par `auth.role ===
  'admin'`).
- CASL/DND : tout nouvel envoi de demande d'avis (action workflow
  `request_review`) RÉUTILISE `isLeadDnd` + l'anti-doublon 30j (calque EXACT
  `reviews.ts:handleCreateReviewRequest`).
- NE PAS casser / NE PAS modifier : `reviews.ts`, `review_requests` /
  `reviews_cache`, les 7 routes `/api/reviews/*`, le moteur workflows
  (`processWorkflowQueue` / `advanceEnrollment` / `autoEnrollForTrigger`). Le flux
  1st-party est SÉPARÉ.
- Alias : imports worker **RELATIFS** (`./worker/...`, `../lib/...`), JAMAIS `@/`.
  Front `@/`.

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` (`src/lib/types.ts`) **GELÉS**.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error` /
  absence de `data` (calque `PublicBooking.tsx` / `PublicFunnel.tsx`).
- ⚠ Les helpers **PUBLICS** utilisent **`fetch` BRUT** contre `${API_BASE}/...`
  (calque EXACT `getPublicFunnel` / `submitPublicFunnel` : retour normalisé
  `{ data } | { error }`, `t('api.unavailable')` sur exception). **JAMAIS
  `apiFetch`** (qui injecte le token ADMIN — fuite d'auth interdite sur des routes
  publiques). Le **token d'invitation** est porté DANS l'URL (`/r/:token`). Les
  helpers **PRO** utilisent `apiFetch` (token admin, capability worker).

Helpers ADDITIFS posés Phase A dans `src/lib/api.ts` — **FIGÉS**, signatures
EXACTES (Phase C les CONSOMME tels quels, Phase B câble les corps des routes) :

```ts
// PUBLICS — fetch BRUT, sans auth (calque getPublicFunnel).
getPublicReviewPage(token): ApiResponse<PublicReviewPage>
submitPublicReview(token, { rating, comment? }): ApiResponse<{ routed: string; redirect_url?: string|null; message?: string }>
// PRO — apiFetch (auth CRM, capability 'settings.manage' worker).
getReputationSettings(): ApiResponse<ReputationSettings>
updateReputationSettings(payload: Partial<ReputationSettings>): ApiResponse<ReputationSettings>
getPrivateFeedback(): ApiResponse<PrivateFeedback[]>
```

### §6.B — Types (`src/lib/types.ts`, FIGÉS Phase A)

- `ReviewInvitation` (id, client_id?, lead_id?, token, channel?, status,
  rating_submitted?, comment_submitted?, routed_to?, submitted_at?, created_at?)
- `PrivateFeedback` (id, client_id?, lead_id?, invitation_id?, rating?, comment?,
  status, created_at?)
- `ReputationSettings` (client_id?, rating_threshold, public_redirect_url?,
  widget_enabled?, notify_on_review?, updated_at?)
- `PublicReviewPage` (business_name, message?, status?) — **ce que la page
  PUBLIQUE reçoit. N'EXPOSE JAMAIS le seuil de routing** (`rating_threshold` reste
  serveur — sinon un déposant pourrait deviner le routing).

**Action workflow** : `'request_review'` AJOUTÉ au tableau `STEP_TYPES`
(`src/lib/types.ts`) — additif, valeurs existantes INTOUCHÉES. C'est la nouvelle
action de déclenchement AUTO de la demande d'avis (voir §6.H Manager-B).

### §6.C — Pattern reviews.ts RÉUTILISÉ (envoi email + token + CASL — CRUCIAL Manager-B)

Le `case 'request_review'` (Manager-B, dans `executeStep`) doit RÉUTILISER le
pattern EXACT de `reviews.ts:handleCreateReviewRequest` (vérifié dans le CODE) :

1. **CASL/DND** : `const dnd = await isLeadDnd(env, lead.id, 'email'); if (dnd)
   return 'main';` (calque `case 'send_email'` qui fait déjà ce check ; reviews.ts
   le fait aussi avant l'envoi).
2. **Anti-doublon 30j** : reviews.ts vérifie
   `SELECT id FROM review_requests WHERE lead_id = ? AND created_at > datetime(
   'now', '-30 days')`. Pour `request_review`, faire le MÊME garde sur
   `review_invitations` (par `lead_id`, fenêtre 30j) avant de créer une nouvelle
   invitation (best-effort).
3. **Création invitation + token** :
   `const id = crypto.randomUUID(); const token = crypto.randomUUID();`
   `INSERT INTO review_invitations (id, client_id, lead_id, token, channel,
   status) VALUES (?, ?, ?, ?, 'email', 'sent')`. Le `client_id` vient du
   `lead.client_id` (calque reviews.ts).
4. **Lien public** : l'email pointe vers la page hébergée Intralys
   `https://<app>/r/<token>` (route publique App.tsx `/r/$token`), PAS directement
   vers Google — c'est la page Intralys qui appliquera le routing intelligent.
5. **Envoi Resend** (calque reviews.ts l.88-116 / workflows.ts `case 'send_email'`) :
   `const resend = new Resend(env.RESEND_API_KEY);` (garde `if
   (!env.RESEND_API_KEY) return 'main';`) →
   `await resend.emails.send({ from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com',
   to: [lead.email], subject, html });` — sujet/HTML calqués reviews.ts (ton
   québécois, bouton « Laisser un avis » vers `/r/<token>`).
6. **Best-effort** : tout `try/catch` autour de l'envoi (calque reviews.ts) ;
   échec → log dans `workflow_execution_log` (calque `case 'send_internal_email'`),
   `return 'main';` (ne casse JAMAIS l'enrôlement).

⚠ Manager-B câble ce case DANS `src/worker/workflows.ts` (le SEUL fichier partagé
que Manager-B touche ce sprint — case ADDITIF, `default` inchangé). Manager-A n'a
PAS touché `workflows.ts` (seul `STEP_TYPES` dans `types.ts`).

### §6.D — Routes worker (`src/worker.ts`, FIGÉ Phase A — dispatch câblé)

**PUBLIQUES (AVANT `requireAuth`)** — invitation résolue par token côté handler,
AUCUNE auth. Sous-route SPÉCIFIQUE `/submit` câblée AVANT le GET générique
(anti-shadowing) :
- `POST /api/r/:token/submit` → `handlePublicSubmitReview(request, env, token)`
- `GET /api/r/:token` → `handlePublicGetReviewPage(env, token)`

**PRO (PROTÉGÉES, capability `settings.manage` DANS le handler — bloc reviews ~2072)** :
- `GET /api/reputation/settings` → `handleGetReputationSettings(env, auth)`
- `PATCH /api/reputation/settings` → `handleUpdateReputationSettings(request, env, auth)`
- `GET /api/reputation/private-feedback` → `handleGetPrivateFeedback(env, auth)`

Imports : publics depuis `./worker/reputation-public`, PRO depuis
`./worker/reputation`.

### §6.E — Handlers (`src/worker/reputation-public.ts` / `reputation.ts`, NEUFS — owned Manager-B)

**`reputation-public.ts`** — helper de bornage tenant **FIGÉ Phase A** (le SEUL
point d'entrée tenant public) :
```ts
resolveInvitationToken(env: Env, token: string): Promise<ResolvedInvitation | null>
//   SELECT … FROM review_invitations WHERE token = ?. null ⇒ 404 (anti-fuite
//   cross-tenant). Le client_id vient de l'invitation, JAMAIS d'un auth.userId.
```
Stubs Phase A (signatures FIGÉES, corps réels Manager-B) :
`handlePublicGetReviewPage(env, token)` · `handlePublicSubmitReview(request, env, token)`.

**`reputation.ts`** — stubs PRO (signatures FIGÉES) :
`handleGetReputationSettings(env, auth)` · `handleUpdateReputationSettings(request,
env, auth)` · `handleGetPrivateFeedback(env, auth)`. `capGuard(auth)` =
`requireCapability(auth.capabilities, 'settings.manage')` ; clientId résolu via
`resolveProClientId` (calque storefront-public.ts).

### §6.F — Pages (`src/pages/PublicReview.tsx` NEUF / `src/pages/Reviews.tsx` étendu — owned Manager-C)

Route publique `src/App.tsx` (FIGÉ Phase A) HORS `LazyGuard`/auth (calque EXACT
`publicBookingRoute` / `publicFunnelRoute`) :
- `/r/$token` → `PublicReviewPage` (export nommé FIGÉ) : sélecteur étoiles +
  commentaire, calque `PublicForm.tsx`/`PublicBooking.tsx`. **Après submit** : si
  `routed === 'public'` et `redirect_url` présent → `window.location.href =
  redirect_url` (redirection vers Google/FB) ; sinon écran remerciement
  (`pubreview.thanks_*`).

Modèle : `PublicBooking.tsx` (spinner loading, écran succès, discrimination
erreur = absence `data` / champ `error`, JAMAIS de `code`). i18n 100%
`t('pubreview.*')` (clés FIGÉES Phase A — AUCUNE création Phase C). Le front
n'invente JAMAIS le routing — tout vient de `submitPublicReview`.

`src/pages/Reviews.tsx` (étendu Manager-C) : ajoute onglet « Réglages »
(`getReputationSettings` / `updateReputationSettings` — seuil, URL publique,
notif) + onglet « Feedback privé » (`getPrivateFeedback`). i18n
`t('reputation.*')`.

### §6.G — Migration & manifest

`migration-reputation-seq109.sql` (racine) : `CREATE TABLE IF NOT EXISTS
review_invitations` / `private_feedback` / `reputation_settings` + `ALTER TABLE
reviews_cache ADD COLUMN source_origin TEXT` + `CREATE INDEX IF NOT EXISTS
idx_review_invitations_token` / `idx_private_feedback_client`. Entrée manifest
seq 109 (`docs/migrations-manifest.json`, depends_on seq 108, objects
`["table:review_invitations","table:private_feedback","table:reputation_settings",
"alter:reviews_cache","index:review_invitations","index:private_feedback"]`, risk
low). ⚠ `ADD COLUMN` non idempotent — jouer UNE SEULE FOIS.

### §6.H — Répartition DISJOINTE

- **Manager-B (backend)** owned :
  - **`src/worker/reputation-public.ts`** — corps réels. `handlePublicGetReviewPage`
    (page publique par token : business name + message, JAMAIS le seuil) ;
    **`handlePublicSubmitReview` avec ROUTING INTELLIGENT** : charge
    `reputation_settings.rating_threshold` du client (défaut 4) ; **si rating ≥
    threshold** → `routed='public'` : `INSERT reviews_cache (… source_origin=
    'internal')` + renvoie `redirect_url` (`reputation_settings.public_redirect_url`,
    sinon URL Google construite depuis `clients.google_place_id`, sinon null) ;
    **si rating < threshold** → `routed='private'` : `INSERT private_feedback` +
    message remerciement privé (aucune URL renvoyée) ; dans les 2 cas marque
    `review_invitations` (status='submitted', rating_submitted, comment_submitted,
    routed_to, submitted_at). Anti-rejeu : invitation déjà 'submitted' ⇒ 409/idempotent.
  - **`src/worker/reputation.ts`** — settings CRUD (`reputation_settings`, UPSERT
    borné client_id, défauts si absent) + liste `private_feedback` borné client_id
    + notif (`notify_on_review`).
  - **`src/worker/workflows.ts`** — **UNIQUEMENT** ajouter le `case
    'request_review'` dans `executeStep` (crée `review_invitation` + token, envoie
    email via le pattern reviews.ts/Resend, CASL `isLeadDnd` + anti-doublon 30j —
    cf. §6.C). Case ADDITIF, `default` INCHANGÉ, signature `executeStep` INCHANGÉE,
    moteur d'ordonnancement INTOUCHÉ. ⚠ **Manager-B EXCLUSIF sur `workflows.ts` ce
    sprint** (Manager-A n'y a pas touché ; Manager-C n'y touche pas).
- **Manager-C (frontend)** owned :
  - **`src/pages/PublicReview.tsx`** (NEUF, export `PublicReviewPage`) : sélecteur
    étoiles + commentaire (calque `PublicForm`/`PublicBooking`) ; après submit, si
    routé public → redirige vers l'URL renvoyée, sinon écran remerciement.
  - **`src/pages/Reviews.tsx`** : ajoute onglets « Réglages » réputation
    (`getReputationSettings`/`updateReputationSettings`) + « Feedback privé »
    (`getPrivateFeedback`).
- **INTERDITS aux deux** : migration, manifest, `src/lib/types.ts`,
  `src/lib/api.ts`, `src/worker.ts`, `src/App.tsx`, i18n×4, `index.css`, et
  **`src/worker/reviews.ts`** (existant — NE PAS modifier, le nouveau flux
  1st-party est SÉPARÉ : il LIT `clients.google_place_id` / `reviews_cache` et
  INSÈRE dans `reviews_cache`/`private_feedback`, sans toucher reviews.ts ni les 7
  routes `/api/reviews/*`). `reputation-public.ts` / `reputation.ts` /
  `workflows.ts`(case) = **Manager-B** ; `PublicReview.tsx` / `Reviews.tsx` =
  **Manager-C**. **Zéro fichier partagé B/C.**

### §6.I — Pièges (à relire AVANT de coder)

1. **CHECK / tables existants INTOUCHABLES** — `reviews_cache` (seq 12) n'est
   complétée que par `ADD COLUMN source_origin` (NULL, sans CHECK) ;
   `review_requests` n'est PAS touchée. AUCUN rebuild. N'ajoute AUCUN CHECK.
2. **Manifest seq 109 OBLIGATOIRE** — sinon le runner peut sauter la migration.
3. **FK INTERDITES** (rebuild SQLite) — liens `client_id`/`lead_id`/`invitation_id`
   restent APPLICATIFS (bornés serveur).
4. **Page publique par TOKEN** (calque `/api/form/:slug` / `/api/p/:slug`) —
   `resolveInvitationToken(token)` borne le tenant ; token inconnu ⇒ 404. AUCUNE
   auth, AUCUNE capability sur les routes publiques. Helpers publics = `fetch`
   BRUT (JAMAIS `apiFetch`).
5. **Le SEUIL ne fuit JAMAIS au front** — `PublicReviewPage` ne contient PAS
   `rating_threshold`. Le routing est décidé SERVEUR au submit.
6. **CASL `isLeadDnd` + anti-doublon 30j** — tout envoi `request_review` réutilise
   `isLeadDnd(env, lead.id, 'email')` + le garde 30j (calque reviews.ts). Ne casse
   rien.
7. **Routing par URL CONFIGURÉE, PAS d'API GBP/FB live** — Google Business
   Profile / Facebook sont INACTIFS (`_v2-backlog`, routes 404). Le « public » =
   `reputation_settings.public_redirect_url` ou `clients.google_place_id`
   (construction d'URL `search.google.com/local/writereview?placeid=…` calque
   reviews.ts l.69). AUCUN appel externe GBP/FB.
8. **Ne PAS casser reviews.ts ni le moteur workflows** — flux 1st-party SÉPARÉ.
   `case 'request_review'` ADDITIF, `default` inchangé.
9. **`source_origin='internal'`** pour tout avis 1st-party inséré dans
   `reviews_cache` (vs 'google'/'facebook' réservés au backlog).
10. **Alias relatifs worker** (`./...`, `../lib/...`), front `@/`.
