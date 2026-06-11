# LOT G10 — Communauté membres (espace social) + commentaires de leçons

> Source de vérité figée Phase A SOLO. Phase B (Manager-B backend) et Phase C
> (Manager-C front) ne lisent QUE ce document + le CODE. Le §6 ci-dessous est
> recopié VERBATIM du cadrage Chaman READ-ONLY (code fait foi).

---

## §0 — AUDIT DISQUE (confirmé Chaman, code fait foi)

- **`member-auth.ts` / `requireMember(request, env)`** retourne
  `MemberContext { memberId, clientId, agencyId }` (lookup member_sessions JOIN
  members UNIQUEMENT, JAMAIS admin_sessions/users). **`member.clientId` (de
  members.client_id) = SEULE racine de confiance tenant côté espace membre.**
  Token via `Authorization: Bearer` OU `?token=`. Best-effort 401 si table
  absente. **G10 réutilise requireMember en LECTURE — ZÉRO modification de
  member-auth.ts.**
- **`reactions.ts` = FRONT-ONLY INUTILISABLE** (localStorage + fetch token
  ADMIN intralys_token). Coupler ça à l'espace membre = interdit. → **réactions
  HORS v1.**
- **ABSENT confirmé** : aucune table community_*/lesson_comments/badge, aucun
  handler forum/comment.
- **MemberSpace.tsx** : page publique `/m/$slug` lazy hors LazyGuard, token
  `localStorage['intralys_member_token']` (DISTINCT admin), helpers passent
  memberToken EXPLICITEMENT, i18n `member.*`/`course.*`.
- **memberships.ts patterns** : `membershipCapGuard(auth)` =
  `requireCapability(caps,'workflows.manage')` ; `rowInTenant(row,auth)` (legacy
  true / agence client_id ∈ accessibleClientIds OR agency_id ==) ;
  `loadGatedLesson` triple borne (client_id == + enrollment + drip) ; handlers
  membre `(env, ..., member)` bornent `member.clientId` ; ApiResponse
  json({data})/json({error},status) jamais code.
- **seq libre = 93** (manifest dernière = 92 affiliate). **Collisions AUCUNE** :
  route `/m/$slug` pris, `/c/$slug` libre (mais on n'ajoute PAS de route) ;
  i18n `community.*` LIBRE (member.*/course.* intacts).

---

## §6.A — ARCHITECTURE (tranché)

- **Q1 v1 RÉDUIT** : (a) commentaires leçons + (b) forum threads/posts PLATS.
  PAS de réactions (Q5), PAS de badges/certifs/lives (v2). Badge « cours
  complété » = cosmétique FRONT dérivé de progress_pct existant, ZÉRO table.
- **Q2/Q7 auth par action** : MEMBRE (requireMember) = créer thread/poster/
  commenter/lire + supprimer SON propre post/comment (`member_id ==
  member.memberId`). PRO (requireAuth + `workflows.manage`) = modérer (supprimer
  n'importe quel post/comment, pin/lock thread) borné rowInTenant.
- **Q3 forum** : `community_threads` + `community_posts` (parent_post_id
  NULLABLE posé mais PLAT v1, réponses imbriquées = v2 sans migration).
- **Q4 comments leçons** : `lesson_comments`
  (lesson_id/course_id/client_id/member_id/body) ; accès via loadGatedLesson
  triple borne avant lecture/écriture.
- **Q6 ISOLATION (CRITIQUE)** : toute table porte client_id. Écriture pose
  `client_id = member.clientId` (JAMAIS valeur du body). Lecture filtre
  `WHERE client_id = member.clientId`. **FLAG #1 : routes par ID re-vérifient
  `row.client_id == member.clientId` AVANT action** (sinon membre tenant B
  supprime post tenant A par id deviné). `member.clientId` = unique racine
  confiance.
- **Q8 capability** : modération PRO réutilise `workflows.manage` (ZÉRO ajout
  ALL_CAPABILITIES). Routes membre `/api/member/:slug/community/*`
  (pré-requireAuth, requireMember interne) + PRO `/api/community/moderate/*`
  (routeProtected + workflows.manage).
- **Q10 badges = v2** sauf badge « cours complété » cosmétique front (libellé
  `community.badge_completed`, zéro table).

---

## §6.B — MIGRATION seq 93 (`migration-community-seq93.sql`, depends 92)

En-tête garde-fous style seq 92. **Timestamps `datetime('now')`.** Mention
« AUTH MEMBRE 100% SÉPARÉE INTOUCHÉE — auteur = member_id (members seq 87),
JAMAIS users ». Zéro FK (jointures applicatives member_id/thread_id/lesson_id/
client_id), zéro CHECK (statuts/flags validés HANDLER), zéro ALTER.

```sql
CREATE TABLE IF NOT EXISTS community_threads (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, agency_id TEXT, site_id TEXT,
  member_id TEXT,
  title TEXT NOT NULL DEFAULT 'Discussion',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, thread_id TEXT, member_id TEXT,
  parent_post_id TEXT,
  body TEXT,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lesson_comments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id TEXT, lesson_id TEXT, course_id TEXT, member_id TEXT,
  body TEXT,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_threads_client ON community_threads(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_community_posts_thread ON community_posts(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lesson_comments_lesson ON lesson_comments(lesson_id, created_at);
```

Manifest :
`{ "seq": 93, "file": "migration-community-seq93.sql", "depends_on": ["migration-affiliate-seq92.sql"], "objects": ["table:community_threads","table:community_posts","table:lesson_comments","index:community_threads","index:community_posts","index:lesson_comments"], "risk": "low" }`.

---

## §6.C — ROUTES worker.ts

**Bloc PUBLIC membre** (zone pré-requireAuth, sous-routes spécifiques d'abord,
anti-shadowing) — chaque route :
`const m = await requireMember(request, env); if (m instanceof Response) return m;`
puis handler bornant `m.clientId` :

- `GET  /api/member/:slug/community/threads`
- `POST /api/member/:slug/community/threads`
- `GET  /api/member/:slug/community/threads/:tid/posts`
- `POST /api/member/:slug/community/threads/:tid/posts`
- `DELETE /api/member/community/posts/:pid` (member_id == m.memberId ET client_id == m.clientId)
- `GET  /api/member/lessons/:id/comments` (loadGatedLesson d'abord)
- `POST /api/member/lessons/:id/comments` (triple borne leçon d'abord)
- `DELETE /api/member/community/comments/:cid`

**Bloc PRO modération** (routeProtected) —
`requireCapability(auth.capabilities,'workflows.manage')` mode-agence-only
(communityCapGuard) + rowInTenant :

- `GET    /api/community/moderate/threads`
- `DELETE /api/community/moderate/posts/:id`
- `DELETE /api/community/moderate/comments/:id`
- `PUT    /api/community/moderate/threads/:id` (pin/lock)

Routes par ID re-bornent client_id avant action (FLAG #1).

---

## §6.D — API helpers (api.ts) — ApiResponse INCHANGÉ jamais code

Helpers membre = **fetch brut + token membre EXPLICITE** (calque
memberRegister/getMemberCourses, JAMAIS apiFetch admin) :
`getCommunityThreads(slug, memberToken)`,
`createCommunityThread(slug, memberToken, {title})`,
`getThreadPosts(slug, threadId, memberToken)`,
`createPost(slug, threadId, memberToken, {body})`,
`deleteOwnPost(postId, memberToken)`,
`getLessonComments(lessonId, memberToken)`,
`createLessonComment(lessonId, memberToken, {body})`,
`deleteOwnComment(commentId, memberToken)`.

Helpers PRO modération = **apiFetch** (token admin) :
`getModerationThreads()`, `moderateDeletePost(id)`, `moderateDeleteComment(id)`,
`moderateThread(id, {is_pinned, is_locked})`.

Types : `CommunityThread {id,title,member_id,is_pinned,created_at}`,
`CommunityPost {id,member_id,body,created_at}`,
`LessonComment {id,member_id,body,created_at}`.

---

## §6.E — i18n `community.*` (22 clés) ×4 catalogues parité STRICTE

`community.title/threads/new_thread/thread_title/post/reply_placeholder/posts/
empty_threads/empty_posts/comments/add_comment/comment_placeholder/
empty_comments/delete/deleted/error/locked/pinned/badge_completed/moderate/
moderate_delete/moderate_pin`. Zéro collision (member.*/course.* intacts).
Ordre fr-CA → fr-FR → en → es. **Compte vérifié Phase A : 22 × 4 = 88.**

---

## §6.F — PAGES (Phase C, PAS Phase A)

MemberSpace.tsx ÉTENDU (commentaires sous leçon + section Communauté
threads/posts) + section modération dans CoursesAdmin.tsx. **ZÉRO route App.tsx
neuve.** 6 pages R exclues.

---

## §6.G — DÉCOUPAGE

- **Phase A SOLO (FAIT)** : migration seq 93 + manifest + stubs
  `src/worker/community.ts` (handlers membre + modération PRO, signatures
  figées, helpers loadGatedLessonForMember/communityCapGuard/rowInTenant/
  rowOwnedByMemberTenant, corps placeholder) + routes worker.ts (membre public
  requireMember + PRO modération) + api.ts helpers (membre token + PRO) + types
  + i18n ×4 + ce doc §6.
- **Phase B Manager-B (backend exclusif)** : corps `community.ts`.
- **Phase B Manager-C (front exclusif)** : MemberSpace.tsx social +
  CoursesAdmin.tsx modération.

---

## §6.H — DISJONCTION

- Exclusifs B : `src/worker/community.ts` (corps).
- Exclusifs C : `src/pages/MemberSpace.tsx`, `src/pages/CoursesAdmin.tsx`.
- Gelés Phase A (INTOUCHÉS Phase B) : worker.ts, api.ts, i18n ×4, migration,
  manifest.
- READ-ONLY ABSOLU : `member-auth.ts`, `memberships.ts`, `reactions.ts`,
  `capabilities.ts`, `crypto.ts`, `App.tsx`, `migration-member-seq87.sql`,
  tables E4-E6.

---

## §6.I — GARDE-FOUS

Additif strict (3 tables, zéro FK/CHECK/ALTER) · CHECK59 intouché · E4-E6
jamais · **auth membre séparée INTACTE (member_id auteur jamais users,
member-auth READ-ONLY)** · 6 pages R exclues · i18n 4 catalogues parité avant
usage · SPA pas SSR · ZÉRO ajout ALL_CAPABILITIES (workflows.manage) ·
ApiResponse inchangé jamais code · **isolation membre cross-site NON négociable
(client_id = member.clientId écriture + filtre lecture + re-borne routes par
ID)** · datetime('now') · jamais git config.

---

## IMPLEMENTATION-LOG — Phase A SOLO (2026-05-20)

### Fichiers créés
- `migration-community-seq93.sql` — 3 tables + 3 index, additif pur, en-tête
  garde-fous calque seq 92, datetime('now'), zéro FK/CHECK/ALTER.
- `src/worker/community.ts` — stub : `CommunityAuth` type, helpers
  `communityCapGuard` (mode-agence-only, calque affiliateCapGuard),
  `rowInTenant` (PRO), `rowOwnedByMemberTenant` (re-borne membre FLAG #1),
  `loadGatedLessonForMember` (triple borne ré-implémentée — memberships.ts NON
  importé/couplé) ; 8 handlers MEMBRE `(request, env, ..., member)` + 4 handlers
  PRO `(request, env, auth, ...)`. Corps placeholder json({data}) — Phase B.
- `docs/LOT-COMMUNITY-G10.md` — ce document.

### Fichiers modifiés
- `docs/migrations-manifest.json` — entrée seq 93 ajoutée après seq 92.
- `src/worker.ts` — import community.ts ; bloc routes PUBLIC membre (8 routes,
  requireMember en amont, anti-shadowing : thread posts > threads, posts/:pid &
  comments/:cid id global sans slug, lessons/:id/comments) inséré après
  `/api/member/progress` ; bloc routes PRO modération (4 routes) inséré après
  `/api/membership-plans`.
- `src/lib/api.ts` — 3 types + 8 helpers membre (fetch brut token explicite) +
  4 helpers PRO (apiFetch) insérés après `createMembershipPlan`.
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 22 clés `community.*` ×4 (parité 88).

### FLAG ISOLATION (#1) — pour Phase B
Toute écriture membre pose `client_id = member.clientId` / `member_id =
member.memberId` (JAMAIS le body). Toute lecture membre filtre
`WHERE client_id = member.clientId`. Toute route MEMBRE par ID
(`deleteOwnPost`, `deleteOwnComment`, `createPost`/`listThreadPosts` via thread)
DOIT appeler `rowOwnedByMemberTenant(row, member)` (et member_id == memberId
pour les delete) AVANT action → sinon 404. Toute route PRO par ID DOIT appeler
`rowInTenant(row, auth)` après `communityCapGuard(auth)`. Les commentaires de
leçon passent par `loadGatedLessonForMember` (triple borne) AVANT lecture ET
écriture.

---

## IMPLEMENTATION-LOG — Phase B Manager-B (2026-05-20)

### Fichier modifié
- `src/worker/community.ts` — **corps réels** des 12 handlers + 1 helper gating
  (signatures Phase A INCHANGÉES — worker.ts/api.ts gelés non touchés). Ajout
  import `sanitizeInput` (helpers.ts existant), constantes `TITLE_MAX=200` /
  `BODY_MAX=5000`, helper local `readJson` (parse best-effort sans throw).

### Helpers corps réels
- **`loadGatedLessonForMember(env, lessonId, member)`** — RÉIMPLÉMENTÉ LOCAL
  (memberships.ts NON importé/modifié), calque LECTURE fidèle de
  `memberships.ts:loadGatedLesson`. **TRIPLE BORNE** : (1) SELECT lessons JOIN
  courses → `lesson.client_id == member.clientId` sinon 404 ; (2)
  `course_enrollments` actif du `member.memberId` sur le course sinon 403 ; (3)
  drip (`enrolled_at + drip_days*86_400_000 ≤ now`, drip_days≤0 → dispo, date
  illisible → ne bloque pas — calque `dripUnlocked`). best-effort try/catch →
  404, jamais 500.
- `communityCapGuard` / `rowInTenant` / `rowOwnedByMemberTenant` — corps Phase A
  déjà réels, INCHANGÉS.

### Handlers MEMBRE (8) — racine de confiance = `member.clientId`
- `handleListThreads` — SELECT WHERE client_id=member.clientId ORDER BY
  is_pinned DESC, created_at DESC.
- `handleCreateThread` — title sanitisé (400 si vide) → INSERT client_id=
  member.clientId, agency_id=member.agencyId||null, member_id=member.memberId.
- `handleListThreadPosts` — re-borne thread via `rowOwnedByMemberTenant` (404)
  → SELECT posts WHERE thread_id=? AND client_id=member.clientId AND
  is_hidden=0 ORDER BY created_at ASC.
- `handleCreatePost` — body sanitisé (400 si vide) → re-borne thread (404) →
  refus is_locked (403) → INSERT client_id=member.clientId, member_id.
- `handleDeleteOwnPost` — load post → 404 si !tenant OU member_id!=memberId →
  DELETE.
- `handleListLessonComments` — `loadGatedLessonForMember` AVANT (403/404) →
  SELECT WHERE lesson_id=? AND client_id=member.clientId AND is_hidden=0.
- `handleCreateLessonComment` — `loadGatedLessonForMember` AVANT → body sanitisé
  (400) → INSERT client_id=member.clientId, course_id=leçon gated, member_id.
- `handleDeleteOwnComment` — load comment → 404 si !tenant OU member_id!=memberId
  → DELETE.

### Handlers PRO modération (4) — `communityCapGuard` + `rowInTenant`
- `handleModerateListThreads` — capGuard → SELECT all → filter rowInTenant.
- `handleModerateDeletePost` — capGuard → load → 404 si !rowInTenant → DELETE.
- `handleModerateDeleteComment` — capGuard → load → 404 si !rowInTenant → DELETE.
- `handleModerateThread` — capGuard → load → 404 si !rowInTenant → UPDATE
  is_pinned/is_locked (flags 0/1 validés HANDLER, 400 si aucun champ).

### Écarts CODE > brief (minimes, conformes)
- DELETE membre/PRO renvoient 503 (panne D1) plutôt que succès silencieux sur
  exception — calque memberships.ts (cohérence ApiResponse, jamais 500 brut).
- 404 indistinct sur cross-tenant/non-propriétaire (ne révèle pas l'existence
  d'une row d'un autre tenant — durcissement FLAG #1).
- Posts/comments n'ont pas de `agency_id` en table (seq 93) ; `rowInTenant`
  retombe sur le match `client_id ∈ accessibleClientIds` (suffisant) — aucun
  faux négatif en mode agence.

### Check ISOLATION FLAG #1 (confirmé)
Écriture : `client_id = member.clientId` + `member_id = member.memberId` posés
depuis `member` (JAMAIS le body) sur threads/posts/comments. Lecture : filtre
`WHERE client_id = member.clientId` partout. Routes par ID re-bornées
(`rowOwnedByMemberTenant` membre / `rowInTenant` PRO) AVANT toute action → un
membre du tenant B ne peut ni lire ni supprimer une row du tenant A par id
deviné (404). Commentaires gated par triple borne avant lecture ET écriture.

### Non touchés (vérifié)
`member-auth.ts`, `memberships.ts`, `reactions.ts`, `capabilities.ts`,
`crypto.ts`, worker.ts, api.ts, i18n ×4, migration seq 93, manifest, App.tsx,
MemberSpace.tsx, CoursesAdmin.tsx, CHECK59, E4-E6, ALL_CAPABILITIES
(workflows.manage RÉUTILISÉ). Additif strict, ApiResponse inchangé (jamais
`code`). **Build délégué Antigravity (VM sans bun/node).**

---

## IMPLEMENTATION-LOG — Phase B Manager-C (front exclusif) (2026-05-20)

### Fichiers modifiés
- `src/pages/MemberSpace.tsx` — ÉTENDU (additif strict, Sprint 6 préservé) :
  - imports G10 (8 helpers membre + 3 types `CommunityThread`/`CommunityPost`/
    `LessonComment`) ;
  - onglets `view: 'courses' | 'community'` au-dessus de la liste cours (auth /
    cours / leçon / vidéo gated INTACTS) ;
  - `<LessonComments>` rendu SOUS le bouton « Marquer terminé » dans la vue leçon
    (liste `getLessonComments` + ajout `createLessonComment` + suppression de SON
    propre commentaire `deleteOwnComment` via `comment.member_id === member.id`) ;
  - `<CommunitySection>` : liste threads (`getCommunityThreads`, épinglées en
    tête côté front), créer thread (`createCommunityThread`), ouvrir thread →
    posts (`getThreadPosts`), poster (`createPost`), supprimer SON post
    (`deleteOwnPost`), badges `pinned`/`locked`, **input réponse désactivé si
    `thread.is_locked`** ;
  - badge cosmétique `community.badge_completed` sur `CourseCard` quand
    `progress_pct === 100` (zéro backend).
  - `memberToken` (localStorage `intralys_member_token`) passé EXPLICITEMENT à
    tous les helpers membre — JAMAIS le token admin.
- `src/pages/CoursesAdmin.tsx` — ÉTENDU (additif strict, gestion cours Sprint 6
  préservée) :
  - imports G10 (4 helpers PRO modération + type `CommunityThread`) ;
  - chargement `getModerationThreads()` au mount (`loadModeration`) ;
  - `<Card>` « Modération communauté » : liste threads (titre + tags
    `pinned`/`locked`), toggle pin/lock par thread (`moderateThread`), suppression
    post / comment par id (`moderateDeletePost` / `moderateDeleteComment`) sous
    `useConfirm({danger:true})` + `useToast` ;
  - apiFetch admin (capability `workflows.manage` enforced worker) — token admin
    distinct du token membre.
- `src/index.css` — bloc append-only `/* === LOT G10 Communauté === */`
  (Stripe-sober) : `.community-tab(/--active)`, `.community-thread-row`,
  `.community-msg`, `.community-tag-pinned/-locked`, `.community-badge-completed`,
  garde `prefers-reduced-motion`.

### Check i18n
Toutes les chaînes UI passent par `t('community.*')` (22 clés Phase A vérifiées
présentes dans fr-CA.ts) + `t('member.*')`/`t('course.*')` existants. **AUCUNE
clé créée.** Aucun fallback inline nécessaire (toutes les clés requises
existent).

### Écarts CODE > brief (props réelles observées)
- `useConfirm` invoqué via `confirm({title, danger:true} as
  Parameters<typeof confirm>[0])` (cast utilisé partout dans le fichier — props
  réelles `title`/`description`/`danger`, pas de `confirmLabel`).
- `Tag` utilise `variant`/`size="xs"` (props réelles ui), pas de prop libre.
- Suppression de post/comment côté modération PRO : saisie d'id via
  `window.prompt` (calque le pattern existant `handleRenameLesson`) — pas de
  liste de posts inline (handler `getModerationThreads` ne retourne que les
  threads ; lister posts/comments par thread = hors signatures Phase A).
- Badge « cours complété » placé dans `CourseCard` (colonne droite, à côté du
  cadenas `enrolled === false`).

### Check préservation Sprint 6 (byte-identique fonctionnel)
Auth membre (login/register, token séparé `intralys_member_token`), liste cours,
ouverture leçon, **vidéo gated via `memberLessonVideoUrl` (proxy worker, jamais
R2 public)**, marquer terminé, logout : INCHANGÉS. Tous les ajouts G10 sont
additifs (nouveaux composants `LessonComments`/`CommunitySection`, nouvel état
`view`/threads/posts) sans modifier la logique existante.

### Check disjonction
ZÉRO modification de `src/worker/community.ts` + tout `src/worker/*`,
`src/worker.ts`, `src/lib/api.ts`, `src/lib/i18n/*`, `src/lib/types.ts`,
migration seq 93, manifest, `src/App.tsx`, et les 6 pages R
(Dashboard/LeadDetail/Pipeline/Tasks/Leads/Inbox). Modifs limitées aux 2 pages
exclusives C + bloc CSS append-only. ApiResponse inchangé (discrimination
string-match sur `error`, jamais `code`). Token membre ≠ token admin respecté.
**Build délégué Antigravity (VM sans bun/node).**
