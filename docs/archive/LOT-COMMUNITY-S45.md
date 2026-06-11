# LOT COMMUNITY S45 — Forum tenant interne (seq140)

**Sprint 45 / Phase A SOLO (Manager-A) — scaffolding additif (2026-05-25)**

Forum interne au tenant : membres connectés (auth STD users + admin_sessions)
peuvent créer threads, comments nested 1 level, upvotes, modération. Feature
signature anti-Mighty-Networks / Circle pour vertical coaching/training.

---

## 1. Architecture

| Couche | Fichier | État Phase A |
|---|---|---|
| Migration SQL | `migration-community-seq140.sql` | LIVRÉ |
| Manifest entry | `docs/migrations-manifest.json` (seq140) | LIVRÉ |
| Types/helpers TS | `src/lib/api.ts` (append, ~22 helpers) | LIVRÉ |
| Routes worker | `src/worker.ts` (13 routes, après bloc S44) | LIVRÉ |
| Engine | `src/worker/lib/community-engine.ts` (3 stubs) | LIVRÉ |
| Handlers | `src/worker/community-forum.ts` (14 stubs 501) | LIVRÉ |
| i18n × 4 catalogues | `src/lib/i18n/{en,fr-CA,fr-FR,es}.ts` (22 clés) | LIVRÉ |

---

## 2. Tables (préfixe `c45_*`)

`community_threads`, `community_comments`, `community_votes`,
`community_moderation_actions` — implémentées sous préfixe `c45_*` pour éviter
collision intentionnelle avec **seq93 G10** (`community_threads`,
`community_posts`, `lesson_comments` — AUTH MEMBRE SÉPARÉE seq 87). Pattern
strictement calque sprint 44 (`fb_*` seq139 vs `funnels` seq83).

| Table | Colonnes-clé |
|---|---|
| `c45_threads` | client_id NOT NULL, author_user_id, title, body, category, is_pinned, is_locked, status (open/hidden/deleted), upvotes_count, comments_count, last_activity_at, created_at, updated_at |
| `c45_comments` | thread_id NOT NULL, author_user_id, parent_comment_id (NULL = racine, 1 level reply), body, status (visible/hidden/deleted), upvotes_count, created_at, updated_at |
| `c45_votes` | target_type (thread/comment), target_id, voter_user_id, voter_ip_hash, created_at |
| `c45_moderation_actions` | target_type, target_id, action (hide/delete/warn/ban), moderator_user_id, reason, client_id, created_at |

**ALTER users** : `community_role TEXT DEFAULT 'member'` + `community_banned_at TEXT NULL`.

**Index** : `idx_community_threads_client_status`, `idx_community_threads_category`,
`idx_community_comments_thread`, `uniq_community_votes` (UNIQUE),
`idx_community_moderation_target`.

---

## 3. Routes (worker.ts, ordre anti-shadowing FIGÉ)

```
/api/community/moderation                   GET POST   (cap settings.manage)
/api/community/vote                         POST       (cap leads.write)
/api/community/threads                      GET POST   (cap leads.write)
/api/community/threads/:id/comments         GET POST   (cap leads.write)
/api/community/threads/:id/pin              POST       (cap settings.manage)
/api/community/threads/:id/lock             POST       (cap settings.manage)
/api/community/threads/:id                  GET PATCH DELETE (cap leads.write)
/api/community/comments/:id                 PATCH DELETE (cap leads.write)
```

Sous-routes (`/comments`, `/pin`, `/lock`) **AVANT** `/:id` générique — anti-shadowing strict.

---

## 4. Engine helpers (lib/community-engine.ts)

- `recordVote(env, targetType, targetId, voterId, voterIpHash, direction)` —
  INSERT OR IGNORE `c45_votes` + UPDATE atomic `upvotes_count`.
- `moderateContent(env, body, locale)` — PUR. Réutilise S40
  `lib/review-moderation` (`computeSpamScore` + `containsBadWords` FR/EN/ES).
  Retourne `{ spamScore, badWords, autoHide }`. `autoHide=true` si badWords ||
  spamScore >= 50.
- `bumpThreadActivity(env, threadId)` — UPDATE `last_activity_at` +
  `comments_count++` à chaque INSERT comment.

---

## 5. i18n (~22 clés × 4 catalogues, parité STRICTE)

Namespace **`community_forum.*`** (distinct du G10 `community.*` seq93) :
`title`, `threads.{title,create,empty,category,pinned,locked}`,
`comments.{title,create,reply,empty}`, `vote.{upvote,removed}`,
`moderation.{queue,hide,delete,warn,ban,reason}`,
`errors.{banned,locked,duplicate_vote}`.

---

## 6. RÈGLES FIGÉES — §6 (PHASE B/C NE LISENT QUE CECI + LE CODE)

1. **100% ADDITIF** — `CREATE TABLE/INDEX IF NOT EXISTS` + `ALTER TABLE ADD
   COLUMN` only. AUCUN DROP / RENAME / rebuild / ALTER de contrainte existante.
2. **ZÉRO CHECK** — toutes les enums (`status`, `community_role`,
   `target_type`, `action`) validées HANDLER, jamais SQL.
3. **ZÉRO FK** — jointures APPLICATIVES (par colonne TEXT). FK ⇒ rebuild
   SQLite ⇒ interdit.
4. **Imports RELATIFS** uniquement (`./types`, `./capabilities`, `./helpers`,
   `./lib/community-engine`, `./lib/review-moderation`).
5. **Capabilities FIGÉES** (AUCUN ajout à `ALL_CAPABILITIES` seq 80) :
   - **`leads.write`** — membres (create/read threads/comments + vote)
   - **`settings.manage`** — modération admin (pin/lock/hide/delete/warn/ban)
6. **Anti-spam** — `lib/community-engine.moderateContent` réutilise **S40**
   `lib/review-moderation` (`computeSpamScore` + `containsBadWords`). AUCUN
   dictionnaire dupliqué, AUCUN nouveau lexique badwords.
7. **i18n parité STRICTE 4 catalogues** (`en.ts`, `fr-CA.ts`, `fr-FR.ts`,
   `es.ts`). Toute clé ajoutée doit être présente dans les 4 (jamais 3/4).
8. **Préfixe table `c45_*`** — alias TS logiques `CommunityThread`,
   `CommunityComment`, `CommunityVote`, `CommunityModerationAction` côté
   `src/lib/api.ts`. Pattern calque seq139 (`fb_*` + alias `FunnelBuilder`).
9. **Contrat réponses** — `json({ data })` succès / `json({ error }, status)`
   erreur. **JAMAIS** de champ `code` (apiFetch / ApiResponse FIGÉS).
10. **Bornage tenant** — `client_id NOT NULL` forum, `resolveClientId(env,
    auth)` HANDLER AVANT tout INSERT/SELECT. Routes par ID **RE-VÉRIFIENT**
    `row.client_id === currentClientId` AVANT toute action (defense-in-depth
    IDOR).
11. **Soft-delete** — statuts `deleted` / `hidden`, JAMAIS de `DELETE FROM`
    (sauf cascade explicite handler `deleteThread → DELETE FROM c45_comments
    WHERE thread_id = ?`).
12. **Ban check** — handler refuse create/comment/vote si
    `users.community_banned_at IS NOT NULL` avec erreur
    `community_forum.errors.banned`.

---

## 7. Phase B — Manager-B SOLO

- Corps réels `src/worker/community-forum.ts` (14 handlers — signatures FIGÉES
  Phase A, ne PAS modifier).
- Corps réels `src/worker/lib/community-engine.ts` (3 helpers — signatures
  FIGÉES Phase A).
- Tests `src/worker/__tests__/community-forum.test.ts` (cap guards, ban check,
  duplicate vote, soft-delete cascade, moderation queue filtres).

## 8. Phase C — UI (Manager-C SOLO)

- Page `/community` — list threads + filtres category/search.
- Page `/community/threads/:id` — détail + comments nested + vote buttons.
- Page `/community/moderation` — queue admin (cap settings.manage).
- Composants : `ThreadCard`, `ThreadComposer`, `CommentList`, `CommentItem`,
  `VoteButton`, `ModerationQueue`, `ModerationActionModal`.
- i18n via `useT('community_forum.*')` (helpers `src/i18n/index.ts`).
