# LOT MEMBER 6 — Memberships / Cours / Espace client (Sprint 6)

> Statut : **Phase A SOLO FIGÉE** (socle partagé + §6 verrouillé). Phase B
> (Manager-B backend) ∥ Phase C (Manager-C front) débloquées sur fichiers
> DISJOINTS (matrice §6.H). CODE-COMPLETE only — build/tests délégués au
> hôte Antigravity (VM sans bun/node).

Objectif produit : memberships & cours en ligne niveau Kajabi/Podia entrée
de gamme — **auth membre SÉPARÉE** (login distinct du CRM), cours
modules→leçons (texte + vidéo R2 gated), drip release, progression, espace
membre PUBLIC + gestion PRO. **SANS paiement réel** (E4/E6 jamais activés ;
`price_cents` posé INACTIF).

Principe directeur : **socle 100% NEUF et ISOLÉ, byte-équivalent côté
existant**. L'auth membre (`members` / `member_sessions`) est strictement
DISTINCTE de l'auth CRM (`users` / `admin_sessions`). On RÉUTILISE par
CALQUE (sans modifier) : `crypto.ts:hashPassword/verifyPassword` (pbkdf2),
`api-public-auth.ts:requireApiKey` (pattern Bearer→table→contexte typé),
`auth.ts:finishLogin/handleLogout` (pattern session — calque, jamais
touché), `documents.ts:handleGetFile` (pattern R2 `env.FILES`),
`funnels.ts:handlePublicFunnelGet` (pattern slug→tenant),
`booking-public.ts:capGuard/rowInTenant` (calque fichier neuf isolé).
AUCUN nouveau scheduler, AUCUNE FK, ZÉRO touch `users`/`workflow_enrollments`.

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS

`apiFetch` / `ApiResponse` (`src/lib/api.ts:62`) INCHANGÉS — jamais de
champ `code`, contrat `{ data }` / `{ error }` strict. Helpers ADDITIFS
posés Phase A (signatures FIGÉES — Manager-C consomme tel quel) :

Espace membre PUBLIC (fetch brut, **token membre SÉPARÉ** passé
explicitement — JAMAIS le token admin de `apiFetch` ; clé localStorage
front Phase C `intralys_member_token`, distincte de `intralys_token`) :

- `memberRegister(slug, {email,password,name?})` → `ApiResponse<MemberAuthResult>`
- `memberLogin(slug, {email,password})` → `ApiResponse<MemberAuthResult>`
- `memberLogout(slug, memberToken)` → `ApiResponse<{success}>`
- `getMemberCourses(slug, memberToken)` → `ApiResponse<MemberCourse[]>`
- `getMemberLesson(lessonId, memberToken)` → `ApiResponse<Lesson>`
- `memberLessonVideoUrl(lessonId, memberToken)` → `string` (URL proxy
  worker GATED ; token en query car `<video>` n'envoie pas de header
  Authorization ; **JAMAIS d'URL R2 publique**)
- `setMemberProgress(memberToken, {lesson_id,status})` →
  `ApiResponse<{success, progress_pct?}>`

Gestion PRO (`apiFetch` — auth CRM, capability `workflows.manage` côté
worker) : `getCourses` / `createCourse` / `getCourse` / `updateCourse` /
`deleteCourse` / `getCourseModules` / `createCourseModule` /
`createLesson` / `updateLesson` / `deleteLesson` / `getMembershipSites` /
`createMembershipSite` / `getMembershipPlans` / `createMembershipPlan`.

Types ADDITIFS dans `src/lib/api.ts` : `MembershipSite`, `MembershipPlan`,
`Course`, `CourseModule`, `Lesson` (champ `has_video?` — la clé R2 n'est
JAMAIS exposée), `MemberAuthResult`, `MemberCourse`. `MembershipPlan.price_cents`
est typé mais **POSÉ INACTIF** (aucune UI/logique paiement — §6.B).

### §6.B — DDL seq 87 (`migration-member-seq87.sql`)

`depends_on: ["migration-emailseq-seq86.sql"]` (chaînage SÉQUENTIEL ;
seq 86 = dernière du manifest avant ce lot — vérifié manifest ligne 97 ;
manifest ligne 98 ajoutée seq 87). STRICTEMENT ADDITIF — **9 tables
NEUVES** `CREATE TABLE IF NOT EXISTS`, **AUCUN `ALTER`** sur table
existante :

- `members` (id, client_id, agency_id, email, password_hash, name,
  status TEXT def 'active', lead_id nullable, plan_id nullable, created_at)
- `member_sessions` (id, member_id, token, expires_at, ip, user_agent,
  created_at)
- `membership_sites` (id, client_id, agency_id, slug, name,
  is_active def 1, created_at)
- `membership_plans` (id, client_id, agency_id, name,
  **price_cents INTEGER def 0 — POSÉ INACTIF**, created_at)
- `courses` (id, client_id, agency_id, site_id, plan_id nullable, title,
  description, is_published def 0, created_at)
- `course_modules` (id, course_id, title, sort_order def 0, created_at)
- `lessons` (id, module_id, course_id, title,
  content_type TEXT def 'text' [text|video, **PAS de CHECK**], body_html,
  r2_key nullable, drip_days INTEGER def 0, sort_order def 0, created_at)
- `course_enrollments` (id, member_id, course_id, client_id,
  enrolled_at def now, status TEXT def 'active') — ⚠ **NAMESPACE DISTINCT
  de `workflow_enrollments`** (seq 3 / rebuild seq 73), JAMAIS touché/lu
- `lesson_progress` (id, member_id, lesson_id, course_id,
  status TEXT [started|completed, **PAS de CHECK**], completed_at nullable,
  created_at)

Index `IF NOT EXISTS` : `idx_member_sessions_token`, `idx_members_email`
`(client_id,email)`, `idx_membership_sites_slug`,
`idx_course_enrollments_member`, **`idx_lesson_progress_member` UNIQUE
`(member_id,lesson_id)`** (porte l'upsert ON CONFLICT §6.F),
`idx_lessons_module`.

Conventions : id `lower(hex(randomblob(16)))`, timestamps `datetime('now')`,
**ZÉRO FK**, zéro `unixepoch`/autoincrement. En-tête garde-fous +
tolérance `table exists` recopiés VERBATIM (calque
`migration-booking-seq84.sql` / `migration-emailseq-seq86.sql`).

**`price_cents` (membership_plans) POSÉ INACTIF** — stocké mais AUCUNE
logique paiement (E4/E6 jamais activés). **AUCUN touch `users` /
`admin_sessions` / CHECK role seq 59.** AUCUN touch
`workflow_enrollments` (course_enrollments est DISTINCT). AUCUN touch
tables E4/E6 régulées (`payments`, `payment_events`,
`payment_provider_config`, `refunds`, `disputes`, `return_requests`).
**Zéro FK / DROP / RENAME / modif-CHECK.** PAS de CHECK sur
`members.status` / `lessons.content_type` / `course_enrollments.status` /
`lesson_progress.status` (additif pur — ajouter un CHECK plus tard ⇒
rebuild ⇒ on ne s'enferme pas).

### §6.C — Contrat AUTH MEMBRE SÉPARÉE (`member-auth.ts`)

L'auth membre est **100% SÉPARÉE** du CRM. Corps réels Phase B Manager-B
SOLO sur `member-auth.ts` (signatures FIGÉES Phase A, stubs balisés
`// STUB PHASE A → corps réel Phase B Manager-B`).

- **`requireMember(request, env)` → `Response | MemberContext`** : calque
  EXACT `api-public-auth.ts:requireApiKey`. Lit le header
  `Authorization: Bearer <token>` (les routes vidéo acceptent AUSSI
  `?token=` car `<video>` n'envoie pas de header — voir §6.E). Résout le
  token dans **`member_sessions` UNIQUEMENT**
  (`SELECT ... WHERE token = ? AND expires_at > datetime('now')`), joint
  `members` pour `client_id`/`agency_id`, retourne
  `MemberContext { memberId, clientId, agencyId }` ou une **Response 401**
  (token manquant/invalide/expiré). **NE LIT JAMAIS `admin_sessions` /
  `users` / `requireAuth`.**
- **`handleMemberLogin(request, env, slug)`** : résout le tenant via
  **`membership_sites.slug`** (`SELECT client_id, agency_id FROM
  membership_sites WHERE slug = ? AND is_active = 1` — calque
  `funnels.ts:702 funnel_publications`), charge `members`
  (`WHERE client_id = ? AND email = ?` — index `idx_members_email`),
  vérifie via `crypto.ts:verifyPassword` (pbkdf2 RÉUTILISÉ), crée la
  session (token `crypto.randomUUID()`, `INSERT member_sessions` — calque
  `auth.ts:120 finishLogin` SANS y toucher). Succès :
  **`json({ data: { token, member: { id, email, name } } })`**.
- **`handleMemberRegister(request, env, slug)`** : résout le tenant via
  `membership_sites.slug`, refuse si email déjà pris pour ce tenant
  (idx `members(client_id,email)`), hash via `crypto.ts:hashPassword`,
  `INSERT members` (status 'active'), puis session (idem login). Wiring
  CRM OPTIONNEL §6.G. Succès : format login.
- **`handleMemberLogout(request, env, slug)`** :
  `DELETE FROM member_sessions WHERE token = ?` (calque
  `auth.ts:217 handleLogout`). Best-effort, `json({ data:{ success:true } })`.

Garde-fous : aucune ref `users`/`admin_sessions`/`requireAuth` dans
`member-auth.ts`. Token membre = `crypto.randomUUID()`. Mot de passe via
`crypto.ts` (pbkdf2 EXISTANT — JAMAIS dupliqué). Tenant TOUJOURS résolu
par `membership_sites.slug` (jamais déduit du token). best-effort : table
seq 87 absente → 401/{error} propre, JAMAIS de 500.

### §6.D — Handlers / endpoints / bornage / capability

**Routes câblées Phase A (`worker.ts` — GELÉ) :**

PUBLIQUES (pré-`requireAuth`, bloc juste après `/api/p/:slug`, AVANT
« Trigger Links ») — sous-routes spécifiques AVANT génériques :

| Méthode + path | Handler |
|---|---|
| `POST /api/member/:slug/register` | `handleMemberRegister(request, env, slug)` |
| `POST /api/member/:slug/login` | `handleMemberLogin(request, env, slug)` |
| `POST /api/member/:slug/logout` | `handleMemberLogout(request, env, slug)` |
| `GET /api/member/lessons/:id/video` | `requireMember` → `handleMemberLessonVideo(request, env, id, member)` |
| `GET /api/member/lessons/:id` | `requireMember` → `handleMemberLesson(request, env, id, member)` |
| `GET /api/member/:slug/courses` | `requireMember` → `handleMemberCourses(request, env, slug, member)` |
| `POST /api/member/progress` | `requireMember` → `handleMemberProgress(request, env, member)` |

(`requireMember` appelé AU CHOKE-POINT public — calque du pattern
`/api/notifications/ws` token-en-amont `worker.ts` ; le `MemberContext`
est injecté au handler. Si `requireMember` renvoie une Response 401, elle
est retournée telle quelle.)

PRO (`routeProtected`, après le bloc LOT FUNNEL — auth CRM injecté,
garde `workflows.manage` DANS les handlers) :

| Méthode + path | Handler (`memberships.ts`) |
|---|---|
| `GET /api/courses` | `handleListCourses(env, auth, url)` |
| `POST /api/courses` | `handleCreateCourse(request, env, auth)` |
| `GET\|POST /api/courses/:id/modules` | `handleCourseModules(request, env, auth, id)` |
| `GET /api/courses/:id` | `handleGetCourse(env, auth, id)` |
| `PUT /api/courses/:id` | `handleUpdateCourse(request, env, auth, id)` |
| `DELETE /api/courses/:id` | `handleDeleteCourse(env, auth, id)` |
| `POST /api/lessons` | `handleCreateLesson(request, env, auth)` |
| `PUT /api/lessons/:id` | `handleUpdateLesson(request, env, auth, id)` |
| `DELETE /api/lessons/:id` | `handleDeleteLesson(env, auth, id)` |
| `GET\|POST /api/membership-sites` | `handleMembershipSites(request, env, auth, url)` |
| `GET\|POST /api/membership-plans` | `handleMembershipPlans(request, env, auth, url)` |

(`/courses/:id/modules` matché AVANT `/courses/:id` générique — ordre
voulu, calque du pattern funnels `worker.ts`.)

Capability : **RÉUTILISE `workflows.manage`** (`capabilities.ts:45`) via
`memberships.ts:membershipCapGuard(auth)` = `requireCapability(
auth.capabilities, 'workflows.manage')` — calque EXACT
`booking-public.ts:57 capGuard`. En legacy/mono-tenant le set est LARGE
(`capabilities.ts:legacyCapsFromRole`) ⇒ pas de régression ; bridage
actif en mode agence uniquement. **ZÉRO ajout à `ALL_CAPABILITIES`**
(`capabilities.ts:36-49` FIGÉE). **`ModuleId` (`modules.ts:14`) INTOUCHÉ.**

Bornage tenant (Phase B) : calque EXACT `booking-public.ts:67 rowInTenant`
— legacy/mono-tenant (`!tenant || agencyId == null`) → pas de garde
nouvelle (rétro-compat byte-équivalente) ; mode agence → `client_id ∈
accessibleClientIds` OU `agency_id == auth.tenant.agencyId`, sinon 404
'Introuvable'. `client_id`/`agency_id` POSÉS depuis le tenant à la
création (calque `booking-public.ts:1081`).

### §6.E — Service vidéo R2 GATED (`handleMemberLessonVideo`)

Corps réel Phase B Manager-B. Calque **EXACT
`documents.ts:52-68 handleGetFile`** :

```
const r2Object = await env.FILES.get(lesson.r2_key);
if (!r2Object) return json({ error: 'Vidéo non trouvée' }, 404);
return new Response(r2Object.body, {
  headers: { 'Content-Type': ..., 'Cache-Control': 'private' },
});
```

Binding : `env.FILES` (vérifié `wrangler.jsonc:17-20` `r2_buckets`
binding `FILES` bucket `intralys-files` ; `types.ts:19 FILES: R2Bucket`).
Le SEUL fichier qui écrit/lit R2 aujourd'hui = `documents.ts` (pattern
de référence : `documents.ts:37 env.FILES.put`, `documents.ts:58
env.FILES.get`, `documents.ts:61 new Response(r2Object.body,...)`).

**Triple borne OBLIGATOIRE AVANT `env.FILES.get`** (sinon 403/404, jamais
le flux) :

1. `member.client_id == lesson.client_id` (la leçon appartient au tenant
   du membre — `lesson.course_id` → `courses.client_id`) ;
2. le `memberId` a un `course_enrollments` actif sur le `course_id` de la
   leçon (`SELECT ... WHERE member_id = ? AND course_id = ? AND status =
   'active'`) — ⚠ JAMAIS `workflow_enrollments` ;
3. drip débloqué : `enrolled_at + lesson.drip_days (jours) ≤ now` (§6.F).

`Cache-Control: private` impératif. **JAMAIS d'URL R2 publique / signée
exposée au front** : la vidéo transite UNIQUEMENT par le proxy worker
(`memberLessonVideoUrl` → `/api/member/lessons/:id/video?token=`). Le
token membre est lu en query (les `<video>` n'envoient pas de header
Authorization) PUIS validé par `requireMember`. best-effort : table/clé
absente → 404 propre, jamais 500.

### §6.F — Drip + progression

- **Drip** : une leçon est débloquée pour un membre si
  `enrolled_at (course_enrollments) + lesson.drip_days jours ≤
  datetime('now')`. `drip_days = 0` ⇒ disponible dès l'inscription
  (legacy/défaut). Calcul applicatif (pas de cron).
- **Progression** : upsert `lesson_progress`
  `ON CONFLICT(member_id, lesson_id) DO UPDATE` (porté par l'index UNIQUE
  `idx_lesson_progress_member` seq 87 — calque du pattern
  `auth.ts:269-273 ON CONFLICT(user_id,channel,event_type)`). `status`
  ∈ {started, completed} (PAS de CHECK). `completed_at` posé quand
  status='completed'. **% de complétion = COUNT applicatif**
  (`COUNT(lesson_progress completed) / COUNT(lessons du cours)`), borné
  au `memberId`. JAMAIS de jointure vers `workflow_enrollments`.

### §6.G — Wiring CRM OPTIONNEL (SANS coupler les auth)

`members.lead_id` est **nullable** — le lien CRM est OPTIONNEL et
n'altère JAMAIS le flux d'auth membre. À l'inscription membre (Phase B,
`handleMemberRegister`), best-effort APRÈS la création du membre/session :
résoudre/créer un `lead` borné `client_id` (pattern
`applyLeadMapping`-like calqué `booking-public.ts:511 wireBookingLead` —
RÉUTILISE `lead-mapping`/`lead-dedup`/`leads`, ZÉRO dup dedup), poser
`members.lead_id`, puis `autoEnrollForTrigger(env, 'member_signup',
leadId)` (trigger workflow EXISTANT — orthogonal à l'auth). Tout échec du
wiring CRM = avalé (best-effort) — l'auth membre RESTE fonctionnelle. Les
deux systèmes d'auth ne sont **JAMAIS couplés** (un membre sans lead
fonctionne intégralement ; un échec lead ne bloque jamais le login).

### §6.H — Matrice de propriété Phase B/C (disjonction STRICTE)

| Fichier | Propriétaire | Règle |
|---|---|---|
| `src/worker/member-auth.ts` (corps des stubs) | **Manager-B** | requireMember/login/register/logout RÉELS (calque api-public-auth/auth/crypto/funnels) — SANS toucher ces fichiers |
| `src/worker/memberships.ts` (corps des stubs) | **Manager-B** | CRUD PRO + endpoints espace membre + vidéo R2 gated (calque documents.ts handleGetFile) + drip + progression + wiring CRM optionnel |
| `src/pages/MemberSpace.tsx` (corps) | **Manager-C** | corps réel du stub lazy (`MemberSpacePage`) — auth membre token SÉPARÉ |
| `src/pages/CoursesAdmin.tsx` (corps) | **Manager-C** | corps réel du stub lazy (`CoursesAdminPage`) — auth CRM |
| `src/worker.ts` · `src/lib/api.ts` · `src/App.tsx` · `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` · `docs/migrations-manifest.json` · `migration-member-seq87.sql` · `docs/LOT-MEMBER6.md` | **Phase A — GELÉS** | B/C ne les modifient PAS |
| `src/worker/documents.ts` · `api-public-auth.ts` · `auth.ts` · `crypto.ts` · `funnels.ts` · `booking-public.ts` · `capabilities.ts` · `modules.ts` | **READ-ONLY** | **INTERDITS en écriture** à B ET C (calques/références — réutilisés tels quels) |
| `workflow_enrollments` (table) | — | **INTERDIT** touch/lecture (course_enrollments est DISTINCT) |
| `users` / `admin_sessions` / CHECK seq 59 / tables E4-E6 régulées | — | **INTERDIT** touch (auth membre 100% séparée ; price_cents inactif) |
| Les 6 pages « R » (Leads/LeadDetail/Pipeline/Tasks/Inbox/Calendar) · `src/i18n/*.json` (mort) | — | **INTERDITES** hors scope |

Disjonction stricte : Manager-B (`member-auth.ts` + `memberships.ts`) et
Manager-C (`MemberSpace.tsx` + `CoursesAdmin.tsx`) n'ont **AUCUN fichier
en commun**. Aucun fichier READ-ONLY n'est modifié (calque uniquement).
`workflow_enrollments` INTERDIT à TOUS — `course_enrollments` est un
namespace neuf DISTINCT.

### §6.I — Garde-fous + suites à ne pas régresser

Garde-fous DURS : strictement ADDITIF ; **auth membre 100% SÉPARÉE**
(`members`/`member_sessions` ≠ `users`/`admin_sessions` — `member-auth.ts`
ne référence JAMAIS `users`/`admin_sessions`/`requireAuth`) ; ZÉRO
touch/lecture `workflow_enrollments` (`course_enrollments` distinct) ;
ZÉRO touch `users`/CHECK seq 59 ; **E4/E6 régulés JAMAIS activés/touchés**
(`price_cents` posé INACTIF, aucune logique paiement) ; zéro FK / DROP /
RENAME / modif-CHECK ; **ZÉRO ajout à `ALL_CAPABILITIES`**
(`workflows.manage` réutilisée) ; **`ModuleId` (`modules.ts:14`)
INTOUCHÉ** ; vidéo R2 = proxy worker GATED (triple borne AVANT
`env.FILES.get`), JAMAIS d'URL R2 publique ; `documents.ts` /
`api-public-auth.ts` / `auth.ts` / `crypto.ts` / `funnels.ts` /
`booking-public.ts` / `capabilities.ts` / `modules.ts` READ-ONLY (calques
seulement) ; `apiFetch`/`ApiResponse` GELÉS (jamais `code`) ; i18n parité
STRICTE ×4 (34 clés `member.*`/`course.*` ×4, zéro doublon, zéro modif
existant, format plat point-notation, pas de `{{var}}`) ; rétro-compat
byte-identique (tables NEUVES uniquement ⇒ comportement existant
strictement inchangé).

Suites à NE PAS régresser (Phase B/C, build côté hôte Antigravity) :
`auth.*` (auth CRM — l'auth membre ne doit RIEN y changer),
`tenant-context.*` (isolation `client_id`), `capabilities.*`
(`ALL_CAPABILITIES`/`ModuleId` non modifiés), `workflows.*`
(`workflow_enrollments` JAMAIS touché — `course_enrollments` distinct),
`ecommerce-*` (E4/E6 régulés non touchés), `documents.*`/`booking-*`
(calques READ-ONLY) + nouvelles suites `member-auth.*` / `memberships.*`
éventuelles. Aucun chemin existant n'est modifié (socle 100% neuf).

## Écarts CODE vs cadrage

Aucun écart structurel. Précisions issues de la lecture du CODE :

1. **`api-public-auth.ts:requireApiKey` n'a PAS de paramètre `slug`** — il
   lit `api_keys`. `requireMember` est un calque du *pattern*
   (Bearer→table→contexte typé), pas une signature identique : il prend
   `(request, env)` et résout le tenant côté handler via
   `membership_sites.slug` (le slug vient de l'URL du handler appelant,
   pas de `requireMember`). Conforme au cadrage (« calque EXACT le
   pattern »).
2. **`requireMember` câblé AU CHOKE-POINT public** (pas dans le handler) —
   calque du pattern `/api/notifications/ws` (`worker.ts:548`) qui valide
   le token en amont puis injecte `userId`. Le `MemberContext` est passé
   en dernier paramètre des handlers espace membre authentifiés. Cohérent
   avec `booking-public` (auth injecté au choke-point).
3. **Vidéo `<video>` & header Authorization** : une balise `<video src>`
   n'envoie pas de header `Authorization`. Le contrat §6.A/§6.E acte le
   token membre en **query string** (`?token=`) pour la SEULE route vidéo
   (calque du pattern WS `?token=` `worker.ts:549`) — validé par
   `requireMember` qui lit header OU query. Le reste de l'espace membre
   utilise le header Bearer standard.
4. **Route PRO `/api/courses/:id` en `PUT`** (pas `PATCH`) + `/lessons/:id`
   en `PUT` — suit le cadrage (« CRUD ») et le précédent
   `booking-event-types` (`PUT` `worker.ts:1053`) ; `api.ts`
   `updateCourse`/`updateLesson` alignés en `PUT`. Disjoint des routes
   existantes (zéro conflit de path).
5. **Route gestion PRO front = `/courses-admin`** (pas `/courses` qui
   pourrait shadow une route future) — calque `bookingSettingsRoute`
   `/booking-settings` (route PRO sous `LazyGuard`). Aucune collision dans
   le routeTree existant (vérifié `App.tsx:811`).
6. **`lessons.course_id` dupliqué** (en plus de `module_id`) — choix
   assumé : permet la triple borne vidéo (§6.E) et le % progression (§6.F)
   par jointure applicative DIRECTE leçon→cours sans passer par
   `course_modules`, sans FK. Documenté dans le DDL.
7. **34 clés i18n** (pas 35) — `member.*` (17) + `course.*` (17) = 34
   clés uniques, parité STRICTE ×4 vérifiée (diff identique fr-CA/fr-FR/
   en/es, zéro doublon dans le catalogue complet, zéro `{{var}}`).
