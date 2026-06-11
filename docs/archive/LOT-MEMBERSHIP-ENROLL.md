# LOT MEMBERSHIP ENROLL — fermeture boucle inscription (Sprint 6 : endpoint d'inscription membre + PRO, affichage arbre modules→leçons, correction navigation leçon)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> DISJOINTS — §6.H). Non exécuté (filesystem VMware Z: sans bun/node/wrangler) —
> validation/build côté hôte plus tard. Modèle : `docs/LOT-FORMS-XL.md`.
> **Phase B/C ne lisent QUE ce document** (+ le CODE, jamais le brief).

Sprint resserré, **100% ADDITIF**. Le module Memberships (seq 87 : members /
courses / modules / lessons / course_enrollments / lesson_progress +
`member-auth.ts` + `memberships.ts` 841 l. + `MemberSpace.tsx` + `CoursesAdmin.tsx`)
est ABOUTI mais **MORT** :

1. **AUCUN endpoint d'inscription** — `INSERT INTO course_enrollments` n'existe
   NULLE PART ⇒ `loadGatedLesson` (memberships.ts:685-691, borne 2 = enrollment
   actif) renvoie **403 à TOUS les membres**. Toute la chaîne leçon/vidéo/progress
   est inaccessible.
2. **Navigation leçon cassée** — `MemberSpace.tsx:764` `onOpenLesson(course.id)`
   passe un **id de COURS** à `getMemberLesson` qui attend un **id de LEÇON**.
3. **Pas de gestion membres/inscriptions côté PRO** — impossible de lister les
   membres ni d'inscrire/voir les inscrits depuis `CoursesAdmin.tsx`.

Ce lot pose le SOCLE pour fermer la boucle. **Inscription GRATUITE** (E4 inactif —
`membership_plans.price_cents` reste cosmétique ; AUCUN paiement ce sprint).

Architecture figée (NE PAS réinventer) :
- Les 9 tables seq 87 EXISTENT — NON recréées, NON altérées. Migration seq **107**
  = STRICTEMENT ADDITIVE (3 `CREATE INDEX IF NOT EXISTS`, lecture pure). Zéro
  table/colonne/ALTER/CHECK/FK/DROP/RENAME.
- **CHECK INTOUCHABLES** (VOLONTAIREMENT sans CHECK seq 87) : `members.status`,
  `lessons.content_type`, `course_enrollments.status`, `lesson_progress.status`.
  Ne JAMAIS en ajouter (rebuild SQLite INTERDIT).
- Auth membre = `requireMember` (member-auth.ts, `member_sessions`, Bearer header
  OU `?token=`). NE JAMAIS lire `admin_sessions` / `users` pour les routes membre.
  Le portail client seq 101 (`portal_users` / `portal_sessions`) est une auth
  **DISTINCTE** — ne PAS la mêler.
- Capability PRO = **`workflows.manage`** réutilisée via `membershipCapGuard`
  EXISTANT (memberships.ts:55). ZÉRO ajout à `ALL_CAPABILITIES`.
- `course_enrollments` ≠ `workflow_enrollments` (namespace DISTINCT).

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS + helpers (FIGÉS Phase A)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` (`src/lib/types.ts`) **GELÉS**.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error`.
- ⚠ Les helpers **MEMBRE** utilisent **`fetch` brut + token membre EXPLICITE**
  (`Authorization: Bearer <memberToken>`), JAMAIS `apiFetch` (qui injecte le token
  ADMIN). Calque EXACT des helpers membre existants (`getMemberCourses` /
  `setMemberProgress`). Les helpers **PRO** utilisent `apiFetch` (token admin).

Helpers ADDITIFS posés Phase A dans `src/lib/api.ts` — **FIGÉS**, signatures
EXACTES (Phase C les CONSOMME tels quels, Phase B câble les corps des routes) :

```ts
// MEMBRE — fetch BRUT + token membre EXPLICITE (calque getMemberCourses).
enrollInCourse(slug: string, memberToken: string, courseId: string):
    Promise<ApiResponse<{ success: boolean; enrolled: boolean }>>
                              // POST /member/:slug/courses/:courseId/enroll
getMemberCourseDetail(slug: string, memberToken: string, courseId: string):
    Promise<ApiResponse<MemberCourseDetail>>
                              // GET  /member/:slug/courses/:courseId

// PRO — apiFetch (token admin, membershipCapGuard côté handler).
getMembers(): Promise<ApiResponse<MemberLite[]>>                 // GET  /members
enrollMember(courseId: string, memberId: string):
    Promise<ApiResponse<{ success: boolean; enrolled: boolean }>>
                              // POST /courses/:id/enroll  body { member_id }
getCourseEnrollments(courseId: string): Promise<ApiResponse<CourseEnrollment[]>>
                              // GET  /courses/:id/enrollments
```

Helpers membre/cours EXISTANTS réutilisés tels quels — **INCHANGÉS** :
`memberLogin` / `memberRegister` / `memberLogout`, `getMemberCourses`,
`getMemberLesson`, `memberLessonVideoUrl`, `setMemberProgress` (membre) ;
`getCourses` / `getCourse` / `createCourse` / `updateCourse` / `deleteCourse`,
`createLesson` / `updateLesson` / `deleteLesson`, `getCourseModules` /
`createCourseModule`, `getMembershipSites` / `getMembershipPlans` (PRO).

### §6.B — Types front ADDITIFS (`src/lib/api.ts`, FIGÉS Phase A)

Posés dans `api.ts` (les types membership y vivent déjà — `MemberCourse` /
`Course` / `Lesson` / `CourseModule` — PAS dans `types.ts`). NEUFS :

```ts
interface MemberLesson {            // leçon vue côté membre, état drip+progress
  id: string; module_id?: string|null; course_id?: string|null;
  title: string; content_type: string; has_video?: boolean;
  drip_days: number; sort_order: number;
  unlocked: boolean;                // drip débloqué (enrolled_at + drip_days ≤ now)
  status?: string|null;             // progression membre : 'started'|'completed'|null
}
interface MemberModule { id: string; course_id?: string|null; title: string; sort_order: number; }
interface MemberCourseDetail {      // réponse de getMemberCourseDetail
  id: string; title: string; description?: string|null;
  enrolled: boolean; enrolled_at?: string|null;
  progress_pct: number; lessons_total: number; lessons_completed: number;
  modules: MemberModule[];          // modules du cours, triés sort_order
  lessons: MemberLesson[];          // PLAT — chaque leçon porte module_id pour regroupement
}
interface MemberLite { id: string; email: string; name?: string|null; status?: string|null; created_at?: string; }
interface CourseEnrollment {        // inscription listée côté PRO
  id: string; member_id?: string|null; course_id?: string|null;
  email?: string|null; name?: string|null;   // joints membre (jointure applicative)
  status: string; enrolled_at?: string|null;
}
```

### §6.B-bis — STRUCTURE EXACTE de réponse de `handleMemberCourseDetail` (CRUCIAL Manager-C)

GET `/api/member/:slug/courses/:courseId` → `json({ data: MemberCourseDetail })`.
La forme s'aligne sur les requêtes EXISTANTES `handleGetCourse` (PRO — arbre
modules+lessons, l.168-200), `handleMemberCourses` (membre — état
enrolled/progress, l.584-653) et `loadGatedLesson` (drip, l.657-699). **Forme
EXACTE** :

```jsonc
{
  "data": {
    "id": "<courses.id>",
    "title": "<courses.title>",
    "description": "<courses.description | null>",
    "enrolled": true,                  // course_enrollments status='active' du memberId
    "enrolled_at": "2026-05-21 14:00:00", // datetime('now') SQLite (null si non inscrit)
    "progress_pct": 40,                // round(lessons_completed / lessons_total * 100)
    "lessons_total": 5,                // COUNT lessons WHERE course_id
    "lessons_completed": 2,            // COUNT lesson_progress status='completed' (memberId)
    "modules": [                       // course_modules WHERE course_id, ORDER sort_order, created_at
      { "id": "<m.id>", "course_id": "<courses.id>", "title": "Module 1", "sort_order": 0 }
    ],
    "lessons": [                       // lessons WHERE course_id, ORDER sort_order, created_at — PLAT
      {
        "id": "<l.id>",
        "module_id": "<l.module_id | null>",   // regroupement front (null = hors module)
        "course_id": "<courses.id>",
        "title": "Leçon 1",
        "content_type": "text",        // 'text' | 'video'
        "has_video": false,            // (r2_key IS NOT NULL AND r2_key != '') — clé R2 JAMAIS exposée (§6.E seq87)
        "drip_days": 0,
        "sort_order": 0,
        "unlocked": true,              // dripUnlocked(enrolled_at, drip_days) — false si drip pas écoulé
        "status": "completed"          // lesson_progress du membre : 'started'|'completed'|null
      }
    ]
  }
}
```

**Règles Manager-B pour ce handler** :
- Borne tenant : `course.client_id == member.clientId` (calque `handleMemberCourses`
  l.594 + `loadGatedLesson` borne 1 l.679). Cours absent / hors tenant → 404.
- `enrolled` = existence d'une row `course_enrollments` `status='active'` pour
  `(member.memberId, courseId)` (calque `loadGatedLesson` borne 2 l.685-691).
- **Si NON inscrit → renvoyer 403** `json({ error: 'Accès non autorisé' }, 403)`
  (le front affiche alors « S'inscrire » via `course.enroll`). NE PAS lister les
  leçons d'un cours auquel le membre n'est pas inscrit. (Manager-B PEUT, au choix,
  renvoyer le détail avec `enrolled:false` + `lessons:[]` si l'UX préfère afficher
  le cours grisé — mais le contrat front gère le 403 comme « non inscrit ».
  **Choix figé : 403 si non inscrit.**)
- `unlocked` par leçon = `dripUnlocked(enrolled_at, drip_days)` (helper EXISTANT
  memberships.ts:95). `status` par leçon = lookup `lesson_progress` du membre
  (`status` ou null).
- `progress_pct` / `lessons_total` / `lessons_completed` = COUNT applicatif borné
  memberId (calque `handleMemberCourses` l.619-647 / `handleMemberProgress`
  l.817-834). **NE PAS casser** `loadGatedLesson` / `handleMemberCourses` /
  `handleMemberProgress` (LECTURE des mêmes tables).

### §6.C — DDL seq 107 + schéma RÉEL (conventions)

Fichier : `migration-member-enroll-seq107.sql` — seq **107**,
`depends_on: migration-forms-xl-seq106.sql` (dernière migration du manifest = seq
106, chaînage SÉQUENTIEL, AUCUNE dépendance de schéma réelle). Entrée manifest
ajoutée Phase A (`docs/migrations-manifest.json` seq 107, risk `low`,
`objects: ["index:course_enrollments","index:courses"]`, JSON validé, virgule
seq 106 ajoutée).

> ⚠ `migration-member-*` ∈ `FALLBACK_UNSUPPORTED_PATTERNS` de `scripts/migrate.ts`
> ⇒ l'entrée manifest seq 107 est **OBLIGATOIRE** (sinon STOP en erreur dure).
> Ajoutée Phase A.

**Objets ajoutés (additif pur — index de LECTURE)** :
```sql
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_member ON course_enrollments(member_id); -- déjà posé seq 87 (idempotent)
CREATE INDEX IF NOT EXISTS idx_courses_site ON courses(site_id);
```
Aucune table/colonne/ALTER/CHECK/FK. Les liens restent APPLICATIFS (TEXT, borne
serveur).

**Schéma RÉEL des tables seq 87 (Manager-B code contre CES colonnes — VÉRIFIÉ
sur `migration-member-seq87.sql`)** :
```
course_enrollments : id TEXT PK, member_id TEXT, course_id TEXT, client_id TEXT,
                     enrolled_at TEXT DEFAULT (datetime('now')),
                     status TEXT NOT NULL DEFAULT 'active'   ← PAS de CHECK (intouchable)
courses            : id TEXT PK, client_id, agency_id, site_id, plan_id,
                     title, description, is_published INTEGER DEFAULT 0, created_at
course_modules     : id TEXT PK, course_id TEXT, title, sort_order INTEGER, created_at
lessons            : id TEXT PK, module_id TEXT, course_id TEXT, title,
                     content_type TEXT DEFAULT 'text'  ← PAS de CHECK (intouchable),
                     body_html, r2_key, drip_days INTEGER, sort_order INTEGER, created_at
lesson_progress    : id TEXT PK, member_id TEXT, lesson_id TEXT, course_id TEXT,
                     status TEXT DEFAULT 'started'  ← PAS de CHECK, completed_at, created_at
                     (index UNIQUE idx_lesson_progress_member (member_id, lesson_id))
members            : id TEXT PK, client_id, agency_id, email NOT NULL, password_hash NOT NULL,
                     name, status TEXT DEFAULT 'active'  ← PAS de CHECK, lead_id, plan_id, created_at
membership_sites   : id TEXT PK, client_id, agency_id, slug NOT NULL, name, is_active, created_at
```

### §6.D — Règles d'inscription (CRUCIAL Manager-B)

**`handleMemberEnroll`** (POST `/api/member/:slug/courses/:courseId/enroll`,
MEMBRE) :
- Charge le cours `courseId` ; **borne** `course.client_id == member.clientId`,
  cours `is_published = 1`. Sinon 404 / 403 propre.
- **IDEMPOTENT** : SELECT existant `course_enrollments WHERE member_id=? AND
  course_id=? AND status='active'` AVANT INSERT. Si déjà inscrit ⇒ succès
  `{ success:true, enrolled:true }` SANS double INSERT.
- INSERT `course_enrollments (id, member_id, course_id, client_id, status, enrolled_at)`
  avec `id = crypto.randomUUID()`, `member_id = member.memberId`,
  `client_id = member.clientId`, `status = 'active'`, `enrolled_at` = DEFAULT
  `datetime('now')`. **GRATUIT** (E4 inactif — AUCUN paiement, AUCUN check
  Stripe).

**`handleAdminEnroll`** (POST `/api/courses/:id/enroll`, PRO, body `{ member_id }`) :
- `membershipCapGuard(auth)` en tête ; re-borne le cours via `rowInTenant` AVANT
  action (calque `handleDeleteCourse` l.272-279). Vérifier `member_id` ∈ tenant
  (member.client_id ∈ accessible OU agency).
- IDEMPOTENT (même vérif). INSERT identique (status 'active', GRATUIT).

> ⚠ Si l'inscription devenait PAYANTE un jour : early-return
> `{ success:false, mock:true }` si `!env.STRIPE_*` (idiome `telephony.ts:85`).
> **Pour CE sprint l'inscription est GRATUITE** — ne PAS câbler de paiement.

### §6.E — Routes (worker.ts, FIGÉ Phase A)

Toutes câblées Phase A dans `worker.ts` (Phase B/C NE TOUCHENT PAS worker.ts).
Sous-routes spécifiques AVANT les génériques (anti-shadowing) :

```
// MEMBRE (requireMember en amont, contexte membre injecté). AVANT le générique
// GET /api/member/:slug/courses (memCoursesMatch).
POST /api/member/:slug/courses/:courseId/enroll → requireMember → handleMemberEnroll(request, env, slug, courseId, member)
GET  /api/member/:slug/courses/:courseId        → requireMember → handleMemberCourseDetail(request, env, slug, courseId, member)

// PRO (membershipCapGuard DANS le handler). /api/members = route NEUVE (aucun
// conflit). Sous-routes /courses/:id/{enroll,enrollments} AVANT /courses/:id générique.
GET  /api/members                  → handleListMembers(env, auth, url)
POST /api/courses/:id/enroll       → handleAdminEnroll(request, env, auth, courseId)
GET  /api/courses/:id/enrollments  → handleListEnrollments(env, auth, courseId)
```

### §6.F — Stubs handlers neufs (`src/worker/memberships.ts`, FIGÉ Phase A)

Phase A a ajouté **UNIQUEMENT 5 stubs en FIN de fichier** (zone stubs balisée
`LOT MEMBERSHIP ENROLL — 5 STUBS`, après `handleMemberProgress`). Manager-B
remplit les corps réels — **signatures FIGÉES** (calquées sur les handlers
EXISTANTS : membre = `(request, env, slug?, courseId?, member: MemberContext)` ;
PRO = `(… , auth: MembershipAuth, …)` + `membershipCapGuard` + `rowInTenant`,
accès `env.DB`) :

```ts
handleMemberEnroll(_request, _env, _slug, _courseId, _member): Promise<Response>
                                   // MEMBRE. stub: json({data:{success:true,enrolled:true}})
handleMemberCourseDetail(_request, _env, _slug, _courseId, _member): Promise<Response>
                                   // MEMBRE. stub: json({data:{...MemberCourseDetail vide}})
handleListMembers(_env, auth, _url): Promise<Response>
                                   // PRO capGuard. stub: json({data:[]})
handleAdminEnroll(_request, _env, auth, _courseId): Promise<Response>
                                   // PRO capGuard. stub: json({data:{success:true,enrolled:true}})
handleListEnrollments(_env, auth, _courseId): Promise<Response>
                                   // PRO capGuard. stub: json({data:[]})
```

Les stubs PRO appellent DÉJÀ `membershipCapGuard(auth)` en tête (FIGÉ — Manager-B
garde ce garde + ajoute `rowInTenant`). Les stubs compilent et renvoient une
réponse valide best-effort. **Lignes touchées par A dans memberships.ts** : bloc
ajouté en fin de fichier (après l'ancienne dernière ligne 841 = fin de
`handleMemberProgress`), section commentée `LOT MEMBERSHIP ENROLL`. **AUCUNE autre
ligne du fichier modifiée.**

### §6.G — i18n (POSÉ Phase A — parité STRICTE 4 catalogues)

8 clés posées Phase A dans `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (parité STRICTE
vérifiée — mêmes 8 clés partout, valeurs traduites, insérées après
`course.new_course`). Phase C les CONSOMME, n'en crée AUCUNE :
```
course.enroll          (« S'inscrire »)
course.enrolled        (« Inscrit »)
course.enroll_success  (« Inscription réussie »)
member.lessons         (« Leçons »)
member.no_enrollment   (« Inscris-toi pour accéder au contenu »)
member.modules         (« Modules »)
members.title          (« Membres » — liste PRO)
members.enroll_action  (« Inscrire à ce cours »)
```

### §6.H — Répartition DISJOINTE Phase B/C (ZÉRO fichier partagé)

**Manager-B (backend) — owned EXCLUSIF : `src/worker/memberships.ts` UNIQUEMENT**
(corps réels des 5 handlers stub) :
- **`handleMemberEnroll`** : INSERT `course_enrollments (member_id, course_id,
  client_id, status 'active', enrolled_at)`, borné `member.clientId ==
  course.client_id`, cours `is_published = 1`, **IDEMPOTENT** (vérif existant
  AVANT INSERT), **GRATUIT** (E4 inactif). §6.D.
- **`handleMemberCourseDetail`** : renvoie cours + modules + leçons bornés membre
  avec état drip (`dripUnlocked(enrolled_at, drip_days)`) + progress par leçon
  (`lesson_progress`). RÉUTILISE la logique de `loadGatedLesson` /
  `handleMemberCourses`, **NE les CASSE PAS**. 403 si non inscrit. §6.B-bis.
- **`handleListMembers`** : PRO, `membershipCapGuard`, `rowInTenant`, SELECT
  members SANS `password_hash`.
- **`handleAdminEnroll`** : PRO, `membershipCapGuard`, `rowInTenant` (re-borne le
  cours AVANT action), member_id ∈ tenant, INSERT idempotent (status 'active'),
  GRATUIT. §6.D.
- **`handleListEnrollments`** : PRO, `membershipCapGuard`, `rowInTenant`, SELECT
  `course_enrollments` du cours JOIN `members` (jointure applicative member_id).

**Manager-C (front) — owned EXCLUSIF : `src/pages/MemberSpace.tsx` +
`src/pages/CoursesAdmin.tsx`** :
- `src/pages/MemberSpace.tsx` :
  - Bouton **« S'inscrire »** (clé `course.enroll`) si `enrolled === false` →
    `enrollInCourse(slug, memberToken, courseId)`.
  - Après inscription, `getMemberCourseDetail(slug, memberToken, courseId)` →
    afficher l'**arbre modules→leçons** (regrouper `lessons` par `module_id`
    contre `modules`, clés `member.modules` / `member.lessons`).
  - **CORRIGER `onOpenLesson`** pour passer un **`lessonId` RÉEL** (bug
    `MemberSpace.tsx:764` : `onOpenLesson(course.id)` passe un id de COURS).
    Ouvrir une leçon depuis l'arbre détail = `onOpenLesson(lesson.id)` →
    `getMemberLesson(lesson.id, memberToken)`. Respecter `unlocked` (drip) :
    leçon verrouillée → afficher `member.no_enrollment` / état verrouillé, ne pas
    appeler `getMemberLesson`.
- `src/pages/CoursesAdmin.tsx` :
  - Section **« Membres »** (clé `members.title`) via `getMembers()`.
  - Action **« Inscrire à ce cours »** (clé `members.enroll_action`) via
    `enrollMember(courseId, memberId)`.
  - Liste des inscrits via `getCourseEnrollments(courseId)`.

**INTERDITS aux DEUX Managers** (FIGÉS Phase A, lecture seule) :
- `migration-member-enroll-seq107.sql`, `docs/migrations-manifest.json`,
  `src/lib/types.ts`, `src/lib/api.ts`, `src/worker.ts`,
  `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, `src/index.css`,
  `src/worker/member-auth.ts`, `src/worker/community.ts`, tout fichier `portal*`,
  **`docs/LOT-MEMBERSHIP-ENROLL.md`**.
- ⚠ `src/worker/memberships.ts` = **Manager-B exclusif** (Phase A n'y a ajouté que
  les 5 stubs en fin de fichier). Les 2 pages (`MemberSpace.tsx`,
  `CoursesAdmin.tsx`) = **Manager-C exclusif**. **AUCUN fichier partagé entre B et
  C** ⇒ parallélisation sûre.

### §6.I — Pièges / garde-fous

- **CHECK INTOUCHABLES** — `members.status`, `lessons.content_type`,
  `course_enrollments.status`, `lesson_progress.status` VOLONTAIREMENT sans CHECK.
  Ne JAMAIS en ajouter (rebuild SQLite INTERDIT). Aucun ALTER de CHECK.
- **Manifest seq 107 OBLIGATOIRE** — `migration-member-*` ∈
  `FALLBACK_UNSUPPORTED_PATTERNS` de `migrate.ts` ⇒ sans l'entrée manifest,
  `migrate.ts` STOPPE. Ajoutée Phase A (JSON validé, virgule seq 106).
- **FK INTERDITES** — `course_enrollments.course_id` ↔ `courses(id)`,
  `course_enrollments.member_id` ↔ `members(id)`, `courses.site_id` ↔
  `membership_sites(id)` restent APPLICATIFS (TEXT, borne serveur). Aucune FK.
- **3 auth DISTINCTES** — membre (`requireMember` / `member_sessions`), PRO/CRM
  (`requireAuth` + `membershipCapGuard`), portail client (`portal_sessions`,
  seq 101). NE JAMAIS les mêler : routes membre ne lisent JAMAIS
  `admin_sessions`/`users` ; ne pas toucher au portail.
- **E4 inactif** — `price_cents` cosmétique. Inscription **GRATUITE** ce sprint
  (aucun paiement). Si payant un jour : early-return `{success:false, mock:true}`
  si `!env.STRIPE_*` (idiome `telephony.ts:85`).
- **Enroll IDEMPOTENT** — vérifier l'inscription active existante AVANT INSERT
  (membre ET PRO). Pas de doublon `course_enrollments`.
- **NE PAS casser `loadGatedLesson`** — c'est le LECTEUR de `course_enrollments`
  (borne 2). Une fois l'enroll posé, le 403 universel se résout. NE PAS modifier
  `loadGatedLesson` / `handleMemberCourses` / `handleMemberLesson` /
  `handleMemberProgress` / `handleMemberLessonVideo` (LECTURE des mêmes rows).
- **Bug nav leçon** — `MemberSpace.tsx:764` passe `course.id` à `onOpenLesson`
  (attendu : `lesson.id`). Manager-C corrige (§6.H).
- **Helpers MEMBRE = fetch BRUT + token EXPLICITE** — JAMAIS `apiFetch` (token
  admin). Calque `getMemberCourses` / `setMemberProgress`.
- **Capability PRO** — `membershipCapGuard` → `workflows.manage` EXISTANT. ZÉRO
  ajout à `ALL_CAPABILITIES`. `rowInTenant` re-borne AVANT action (PRO).
- **Imports worker RELATIFS** (`./types`, `./helpers`, `./capabilities`,
  `./member-auth`) — PAS d'alias `@/`. Front utilise `@/`.
- **Parité i18n STRICTE** sur les 4 catalogues (8 clés vérifiées).
- best-effort partout : table/colonne seq 87 absente ⇒ réponse propre
  (404 / {data:[]}), JAMAIS de 500/throw non maîtrisé.
- Pas de build/test côté VM (filesystem Z: sans bun/node) — build/test côté hôte.
  NE PAS prétendre « vert ».

---

## État Phase A (livré)

Fichiers créés :
- `migration-member-enroll-seq107.sql` — DDL additif (3 CREATE INDEX, lecture
  pure). Zéro table/colonne/ALTER/CHECK/FK/DROP.
- `docs/LOT-MEMBERSHIP-ENROLL.md` — ce document (§6 A→I FIGÉ).

Fichiers modifiés (GELÉS pour Phase B/C ensuite) :
- `docs/migrations-manifest.json` — entrée seq 107 (+ virgule seq 106).
- `src/lib/api.ts` — types `MemberLesson` / `MemberModule` / `MemberCourseDetail`
  / `MemberLite` / `CourseEnrollment` (NEUFS) + helpers membre `enrollInCourse` /
  `getMemberCourseDetail` (fetch brut + token explicite) + helpers PRO
  `getMembers` / `enrollMember` / `getCourseEnrollments` (apiFetch). Helpers
  existants NON recréés.
- `src/worker.ts` — import des 5 handlers ; routes membre
  `POST /api/member/:slug/courses/:courseId/enroll` +
  `GET /api/member/:slug/courses/:courseId` (AVANT le générique
  `/courses`) ; routes PRO `GET /api/members`, `POST /api/courses/:id/enroll`,
  `GET /api/courses/:id/enrollments` (sous-routes AVANT `/courses/:id` générique).
- `src/worker/memberships.ts` — UNIQUEMENT les 5 stubs `handleMemberEnroll` /
  `handleMemberCourseDetail` / `handleListMembers` / `handleAdminEnroll` /
  `handleListEnrollments` en FIN DE FICHIER (= Manager-B exclusif pour les corps
  réels).
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 8 clés `course.enroll*` / `member.*` /
  `members.*`, parité STRICTE 4 catalogues.

Non touché : `member-auth.ts` (`requireMember` / login / register / logout
INCHANGÉS), `loadGatedLesson` / `handleMemberCourses` / `handleMemberLesson` /
`handleMemberProgress` / `handleMemberLessonVideo` (LECTEURS — INCHANGÉS), CHECK
seq 87 (intouchables), `community.ts`, `portal*`, `ALL_CAPABILITIES`, `index.css`,
`MemberSpace.tsx` / `CoursesAdmin.tsx` (= Phase C), corps réels des 5 handlers
(= Phase B). Non exécuté (VM) — build/test côté hôte.
