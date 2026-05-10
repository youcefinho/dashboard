# ANTIGRAVITY-TODO.md — Plan d'exécution clone GoHighLevel

> **Pour Antigravity (Gemini) :** ce document est un plan d'attaque ordonné, audité par Claude Opus 4.7 le 2026-05-10.
> Lis tout, puis exécute dans l'ordre. Ne saute pas un P0. Commits atomiques par tâche.
> Owner humain : Rochdi (intralys.dev@gmail.com).

---

## ⚠️ STATUS LIVE — mis à jour le 2026-05-10 par Claude après audit du working tree

Antigravity a déjà avancé sur les P0 **avant commit**. État vérifié dans la working copy :

| ID | Tâche | État réel | Reste à faire |
|---|---|---|---|
| P0.1 | wrangler.jsonc + CORS | 🟡 80% — `vars`+`triggers.crons` ajoutés, `corsHeaders(req,env)` refactoré | (a) remplir le vrai `database_id` (besoin `wrangler d1 create`), (b) **retirer le fallback `*` ligne ~95 de worker.ts** et passer `(request, env)` à TOUS les `corsHeaders()` callsites |
| P0.2 | Auth PBKDF2 | 🟡 90% — `hashPassword`/`verifyPassword` + `handleLogin` + `handleChangePassword` + migration5 + `changePassword` côté api.ts | (a) créer la page `src/pages/ChangePassword.tsx`, (b) router `/change-password` dans `App.tsx`, (c) hook post-login : si `must_change_password === 1` → redirect, (d) ajouter retour `must_change_password` dans la réponse `/auth/login` |
| P0.3 | Routes /api/tasks | 🟡 90% — routes GET/POST/PATCH/DELETE présentes, `DEMO_TASKS` retiré de Tasks.tsx | (a) vérifier que `getTasks/createTask/updateTask/deleteTask` côté frontend fonctionnent vraiment, (b) tester création + filtre par statut + suppression |
| P0.4 | Workflow engine cron | 🟡 90% — `scheduled` handler + `processWorkflowQueue`/`advanceEnrollment`/`executeStep`/`autoEnroll` + auto-enroll triggers `lead_created` & `status_changed` | (a) tester en local via endpoint debug temporaire (cron ne tourne pas en `wrangler dev`), (b) vérifier que `step_type='wait'` skippe correctement l'exécution mais avance bien `next_action_at` |
| P1.4 | Notifications réelles | 🟡 90% — routes `/api/notifications` GET/read/read-all présentes, AppLayout poll 30s, trigger insertion sur nouveau lead | (a) tester end-to-end : créer un lead → notif visible dans la cloche, (b) ajouter trigger d'insertion sur changement de statut + tâche overdue |

**Build :** `bun run build` PASSE ✅ (vérifié 2026-05-10, 888kb gzippé — chunk warning à régler en P2 via code-splitting).
**Commits :** ❌ rien de poussé. Tout est dans le working tree.

### Action immédiate suggérée (ordre)

1. **Commit ce qui marche déjà** — tu as un gros block non-committé. Découpe en 4 commits atomiques (un par P0) pour respecter la convention. Voir §STATUS-COMMITS ci-dessous.
2. **Finir les "reste à faire"** ci-dessus (5 petites tâches, ~2-3h).
3. **Demander à Rochdi le `database_id`** (cf. question bloquante).
4. **Avancer sur P1** uniquement après que les 4 P0 soient verts (commits poussés + tests manuels OK).

### STATUS-COMMITS — découpage suggéré du working tree actuel

`worker.ts` ayant été touché par 5 features distinctes (CORS+Env / auth / tasks / workflow engine / notifications), `git add -p` est nécessaire pour des commits propres. Si trop pénible, version pragmatique en 2 commits :

```bash
# Commit A : infra + auth
git add wrangler.jsonc package.json migration-phase5.sql src/lib/api.ts
# + via git add -p src/worker.ts : hunks Env / corsHeaders / json / hashPassword / verifyPassword / handleLogin / handleChangePassword / route /api/auth/change-password
git commit -m "feat(infra+auth): CORS allowlist, cron config, PBKDF2 password hashing per user"

# Commit B : features (tasks + workflow engine + notifications)
git add src/pages/Tasks.tsx src/components/layout/AppLayout.tsx
# + reste du diff src/worker.ts (tasks routes + scheduled + processWorkflowQueue/advanceEnrollment/executeStep + notifications routes)
git commit -m "feat(crm): tasks CRUD + workflow execution engine + real notifications"
```

Version 4-commits propre (recommandée si tu veux un historique clean) : voir guide `git add -p` officiel + scinde par scope (`chore(infra)` / `feat(auth)` / `feat(tasks)` / `feat(workflows)` / `feat(notifications)`).

### Questions bloquantes pour Rochdi (à résoudre avant déploiement)

1. **`database_id` D1** — dois-je lancer `npx wrangler d1 create intralys-crm` moi-même ou la DB existe déjà ? (si oui, fournir l'ID)
2. **Domaine Resend** — `noreply@intralys.com` est-il vérifié dans Resend ?
3. **Le cron `* * * * *` (toutes les minutes)** est cher en wall-time CPU sur Cloudflare Free Tier. OK pour la démo ; à passer à `*/5 * * * *` en prod ?
4. **Force change-password au premier login** — affichage immédiat ou banner discret ?

---

## 0. Contexte projet

**Mission :** cloner GoHighLevel pour vendre une plateforme + app mobile aux courtiers immobiliers/hypothécaires QC.
**Stack figée :** Vite 8 + React 19 + TanStack Router + Tailwind v4 (OKLCH) + Cloudflare Workers + D1 (SQLite) + Resend.
**État actuel :** 18 pages, 1 worker monolithique (1 549 lignes), 4 migrations SQL phasées (Phase 1→4 déjà créées).
**Branche :** `master`. Dernier commit : `ca2a0dd checkpoint: Phase 1 MVP`.

**Règle d'or :** ne casse pas le build. `bun run build` doit passer après chaque commit.

---

## 1. Audit résumé (à mémoriser)

### Forces existantes — NE PAS DÉTRUIRE
- Worker.ts pattern router lisible — garde le style
- Design tokens OKLCH cohérents dans `src/index.css` — n'introduis pas de couleurs en dur
- Types stricts `as const` dans `src/lib/types.ts` — single source of truth
- `sanitizeInput` partout dans worker — applique-le sur tout nouvel endpoint
- HTML escape sur emails Resend — idem
- Activity log automatique — log toutes les nouvelles actions

### Faiblesses CRITIQUES à corriger (P0)
1. **Workflow engine inexistant** — `workflow_enrollments.next_action_at` posé mais aucun Cron Trigger ne l'exécute → workflows créés mais jamais déclenchés.
2. **Tasks API absente côté worker** — frontend appelle `/api/tasks` qui n'existe pas. La page Tasks tourne sur `DEMO_TASKS` hardcodé.
3. **Auth = mot de passe global unique** `ADMIN_PASSWORD` partagé entre tous les users. Colonne `password_hash` existe mais inutilisée.
4. **CORS `*` + `database_id` non rempli** dans `wrangler.jsonc`.
5. **SMS jamais envoyé réellement** — `status='sent'` posé sans appel Twilio.
6. **Inbox = outbox seulement** — pas de webhook entrant Resend.
7. **Notifications mockées** — `DEMO_NOTIFICATIONS` hardcoded dans `AppLayout.tsx`.

---

## 2. Anti-collision avec Claude Code

Si tu vois un commit récent par `youcefinho` qui touche un fichier marqué ci-dessous, **stoppe et lis-le avant de continuer**.

| Fichier | Owner par défaut |
|---|---|
| `src/worker.ts` | Antigravity (toi) — gros refactor à faire |
| `src/lib/types.ts` | Claude (extensions ponctuelles seulement) |
| `src/lib/api.ts` | Antigravity |
| `src/pages/*.tsx` | Antigravity |
| `migration-phase5.sql` et + | Antigravity (à créer) |
| `wrangler.jsonc` | Antigravity |
| `package.json` | Demande à Rochdi avant ajout de deps lourdes |
| `ANTIGRAVITY-TODO.md` | Lecture seule (mis à jour par Claude) |

Format commit : `feat(scope):`, `fix(scope):`, `chore(scope):`. Un commit = une tâche du plan.

---

## 3. P0 — À FAIRE EN PREMIER (ordre strict)

### P0.1 — Remplir `wrangler.jsonc` + restreindre CORS

**Fichier :** `wrangler.jsonc`

**Pourquoi :** déploiement impossible sans `database_id`, et CORS `*` + Authorization header = vol de token possible.

**Actions :**
1. Lance `npx wrangler d1 create intralys-crm` si pas déjà fait, copie le `database_id` retourné dans `wrangler.jsonc`.
2. Ajoute la section suivante dans `wrangler.jsonc` :
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "intralys-dashboard",
  "main": "src/worker.ts",
  "compatibility_date": "2025-04-01",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "intralys-crm",
      "database_id": "<METTRE_LE_VRAI_ID_ICI>"
    }
  ],
  "vars": {
    "ALLOWED_ORIGINS": "https://crm.intralys.com,https://intralys-dashboard.pages.dev"
  },
  "triggers": {
    "crons": ["* * * * *"]
  }
}
```

3. Modifie `corsHeaders()` dans `src/worker.ts` :
```ts
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret, X-Client-Id',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}
```
Mets à jour les ~5 callsites de `corsHeaders()` pour passer `(request, env)`.

4. Ajoute `ALLOWED_ORIGINS: string;` dans l'interface `Env`.

**Test :** `bun run build` passe + en local, fetch depuis un autre origin → bloqué.
**Commit :** `chore(infra): fill database_id and restrict CORS to allowed origins`

---

### P0.2 — Auth bcrypt par utilisateur (retirer mot de passe global)

**Fichiers :** `src/worker.ts` + nouvelle migration `migration-phase5.sql`

**Pourquoi :** `ADMIN_PASSWORD` global dans `handleLogin` = tout le monde a le même mot de passe. Inacceptable en prod.

**Actions :**

1. Crée `migration-phase5.sql` :
```sql
-- Migration Phase 5 — Auth real password hashing
-- Run: bun wrangler d1 execute intralys-crm --local --file=migration-phase5.sql

-- Audit log admin (pour 2FA + traçabilité plus tard)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT DEFAULT '{}',
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);

-- Notifications réelles (pour P1.4)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  client_id TEXT,
  icon TEXT DEFAULT '🔔',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  link TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(user_id, is_read);

-- Tasks (pour P0.3)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date TEXT,
  priority TEXT CHECK (priority IN ('high','medium','low')) DEFAULT 'medium',
  status TEXT CHECK (status IN ('todo','in_progress','done')) DEFAULT 'todo',
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  client_id TEXT,
  assigned_to TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_id);

-- 2FA (TOTP) - colonnes nullable, activation optionnelle
ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
```

Ajoute le script dans `package.json` :
```json
"db:migrate:phase5": "wrangler d1 execute intralys-crm --local --file=migration-phase5.sql"
```

2. Implémente PBKDF2 dans `src/worker.ts` (Web Crypto API natif Workers, pas besoin de dep) :
```ts
// ── Password hashing (PBKDF2-SHA256, 210k iterations OWASP 2023) ─────
const PBKDF2_ITERATIONS = 210_000;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  );
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltB64 = btoa(String.fromCharCode(...salt));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('pbkdf2$')) return false;
  const [, iterStr, saltB64, hashB64] = stored.split('$');
  if (!iterStr || !saltB64 || !hashB64) return false;
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: parseInt(iterStr), hash: 'SHA-256' },
    key, 256
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(bits)));
  // Constant-time compare
  if (computed.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashB64.charCodeAt(i);
  }
  return diff === 0;
}
```

3. Refais `handleLogin` :
```ts
async function handleLogin(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  // ... rate limit (garde l'existant) ...

  const body = await request.json() as { email?: string; password?: string };
  const email = sanitizeInput(body.email, 200).toLowerCase();
  const password = body.password || '';

  await env.DB.prepare(
    "INSERT INTO login_attempts (ip, attempted_at) VALUES (?, datetime('now'))"
  ).bind(ip).run();

  if (!email || !password) {
    return json({ error: 'Email et mot de passe requis' }, 400, request, env);
  }

  const user = await env.DB.prepare(
    'SELECT id, name, role, client_id, password_hash, is_active FROM users WHERE email = ?'
  ).bind(email).first() as { id: string; name: string; role: string; client_id: string | null; password_hash: string; is_active: number } | null;

  // Bootstrap : premier login Rochdi crée le compte admin avec ADMIN_PASSWORD comme seed
  if (!user) {
    if (password !== env.ADMIN_PASSWORD) {
      return json({ error: 'Identifiants incorrects' }, 401, request, env);
    }
    const userId = crypto.randomUUID();
    const hash = await hashPassword(password);
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, name, role, must_change_password) VALUES (?, ?, ?, 'Rochdi', 'admin', 1)"
    ).bind(userId, email, hash).run();
    return finishLogin(env, userId, 'admin', 'Rochdi', email, request);
  }

  if (!user.is_active) return json({ error: 'Compte désactivé' }, 401, request, env);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return json({ error: 'Identifiants incorrects' }, 401, request, env);

  await env.DB.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run();
  return finishLogin(env, user.id, user.role, user.name, email, request);
}

async function finishLogin(env: Env, userId: string, role: string, name: string, email: string, request: Request) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO admin_sessions (token, user_id, role, created_at, expires_at) VALUES (?, ?, ?, datetime('now'), ?)"
  ).bind(token, userId, role, expiresAt).run();
  return json({ success: true, token, user: { id: userId, name, role, email } }, 200, request, env);
}
```

4. Ajoute endpoint `POST /api/auth/change-password` :
```ts
if (path === '/api/auth/change-password' && method === 'POST') {
  return handleChangePassword(request, env);
}
// ...
async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth instanceof Response) return auth;
  const body = await request.json() as { current?: string; next?: string };
  if (!body.current || !body.next || body.next.length < 8) {
    return json({ error: 'Mot de passe actuel + nouveau (min 8 chars) requis' }, 400, request, env);
  }
  const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(auth.userId).first() as { password_hash: string } | null;
  if (!user || !await verifyPassword(body.current, user.password_hash)) {
    return json({ error: 'Mot de passe actuel incorrect' }, 401, request, env);
  }
  const hash = await hashPassword(body.next);
  await env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?").bind(hash, auth.userId).run();
  return json({ success: true }, 200, request, env);
}
```

5. Mets à jour `src/lib/api.ts` :
```ts
export async function changePassword(current: string, next: string): Promise<ApiResponse<{ success: boolean }>> {
  return apiFetch<{ success: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current, next }),
  });
}
```

6. Crée la page `src/pages/ChangePassword.tsx` (formulaire simple) + redirige vers elle si `must_change_password === 1` après login.

**Test :**
- `bun run db:migrate:phase5`
- Login avec ADMIN_PASSWORD → crée compte + force change-password
- Logout, login avec nouveau password → succès

**Commit :** `feat(auth): pbkdf2 password hashing per user + change-password endpoint`

---

### P0.3 — Routes /api/tasks (CRUD complet)

**Fichier :** `src/worker.ts`

La table `tasks` est créée dans P0.2 migration-phase5. Ajoute les routes :

```ts
// Dans routeApi(), après les routes appointments :
if (path === '/api/tasks' && method === 'GET') return handleGetTasks(env, auth, url);
if (path === '/api/tasks' && method === 'POST') return handleCreateTask(request, env, auth);
const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
if (taskMatch && method === 'PATCH') return handlePatchTask(request, env, auth, taskMatch[1]!);
if (taskMatch && method === 'DELETE') return handleDeleteTask(env, auth, taskMatch[1]!);
```

Implémentations (style cohérent avec le reste du worker) :

```ts
async function handleGetTasks(env: Env, auth: { userId: string; role: string }, url: URL): Promise<Response> {
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const leadId = url.searchParams.get('lead_id');

  let query = `SELECT t.*, l.name as lead_name FROM tasks t
               LEFT JOIN leads l ON t.lead_id = l.id WHERE 1=1`;
  const params: string[] = [];

  // Brokers : seulement leurs tasks (assigned_to OU created_by)
  if (auth.role !== 'admin') {
    query += ' AND (t.assigned_to = ? OR t.created_by = ?)';
    params.push(auth.userId, auth.userId);
  }
  if (status && ['todo','in_progress','done'].includes(status)) { query += ' AND t.status = ?'; params.push(status); }
  if (priority && ['high','medium','low'].includes(priority)) { query += ' AND t.priority = ?'; params.push(priority); }
  if (leadId) { query += ' AND t.lead_id = ?'; params.push(sanitizeInput(leadId, 100)); }

  query += ' ORDER BY (CASE t.status WHEN \'done\' THEN 1 ELSE 0 END), t.due_date ASC LIMIT 200';

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

async function handleCreateTask(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const title = sanitizeInput(body.title as string, 200);
  if (!title) return json({ error: 'Titre requis' }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO tasks (id, title, description, due_date, priority, status, lead_id, client_id, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, title,
    sanitizeInput(body.description as string, 1000),
    sanitizeInput(body.due_date as string, 30) || null,
    sanitizeInput(body.priority as string, 10) || 'medium',
    sanitizeInput(body.status as string, 20) || 'todo',
    body.lead_id as string || null,
    body.client_id as string || null,
    sanitizeInput(body.assigned_to as string, 100) || auth.userId,
    auth.userId,
  ).run();

  return json({ data: { id } }, 201);
}

async function handlePatchTask(request: Request, env: Env, auth: { userId: string; role: string }, taskId: string): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | null)[] = [];
  if (body.title) { updates.push('title = ?'); params.push(sanitizeInput(body.title as string, 200)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description as string, 1000)); }
  if (body.due_date !== undefined) { updates.push('due_date = ?'); params.push(sanitizeInput(body.due_date as string, 30) || null); }
  if (body.priority) { updates.push('priority = ?'); params.push(sanitizeInput(body.priority as string, 10)); }
  if (body.status) { updates.push('status = ?'); params.push(sanitizeInput(body.status as string, 20)); }
  if (body.assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(sanitizeInput(body.assigned_to as string, 100)); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(taskId);
  await env.DB.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  return json({ data: { success: true } });
}

async function handleDeleteTask(env: Env, auth: { userId: string; role: string }, taskId: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
  return json({ data: { success: true } });
}
```

Puis dans `src/pages/Tasks.tsx`, **supprime le `DEMO_TASKS`** et démarre `tasks` à `[]`. La fonction `useEffect` qui charge `getTasks()` doit suffire.

**Test :** créer 2 tâches, change statut, refresh → persistance OK.
**Commit :** `feat(tasks): full CRUD API + remove demo data fallback`

---

### P0.4 — Workflow engine via Cron Trigger

**Fichiers :** `src/worker.ts` + `wrangler.jsonc` (déjà fait dans P0.1)

**Pourquoi :** sans cron, `workflow_enrollments` reste figé. C'est LE différenciateur GHL.

**Actions :**

1. Ajoute le handler `scheduled` dans `src/worker.ts` (export par défaut) :

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // ... existant ...
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processWorkflowQueue(env));
  },
} satisfies ExportedHandler<Env>;
```

2. Ajoute `processWorkflowQueue` (place-le après les routes workflows) :

```ts
// ── Workflow execution engine (cron) ────────────────────────

async function processWorkflowQueue(env: Env): Promise<void> {
  const now = new Date().toISOString();

  // 1. Lire les enrollments dont next_action_at est dépassé
  const { results: due } = await env.DB.prepare(
    `SELECT * FROM workflow_enrollments
     WHERE status = 'active' AND next_action_at IS NOT NULL AND next_action_at <= ?
     ORDER BY next_action_at ASC LIMIT 50`
  ).bind(now).all();

  for (const e of (due || []) as Array<Record<string, unknown>>) {
    try {
      await advanceEnrollment(env, e);
    } catch (err) {
      console.error('Workflow step failed', e.id, err);
      await env.DB.prepare(
        `INSERT INTO workflow_execution_log (enrollment_id, step_id, status, result)
         VALUES (?, ?, 'failed', ?)`
      ).bind(e.id as string, e.current_step_id as string || '', JSON.stringify({ error: String(err) })).run();
    }
  }
}

async function advanceEnrollment(env: Env, enrollment: Record<string, unknown>): Promise<void> {
  const enrollmentId = enrollment.id as string;
  const workflowId = enrollment.workflow_id as string;
  const leadId = enrollment.lead_id as string;
  const currentStepId = enrollment.current_step_id as string | null;

  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) {
    await env.DB.prepare("UPDATE workflow_enrollments SET status = 'cancelled' WHERE id = ?").bind(enrollmentId).run();
    return;
  }

  // Step actuel
  const step = currentStepId
    ? await env.DB.prepare('SELECT * FROM workflow_steps WHERE id = ?').bind(currentStepId).first() as Record<string, unknown> | null
    : null;

  if (step) {
    await executeStep(env, step, lead, enrollmentId);
    await env.DB.prepare(
      `INSERT INTO workflow_execution_log (enrollment_id, step_id, status) VALUES (?, ?, 'executed')`
    ).bind(enrollmentId, step.id as string).run();
  }

  // Step suivant
  const currentOrder = (step?.step_order as number) || 0;
  const nextStep = await env.DB.prepare(
    'SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1'
  ).bind(workflowId, currentOrder).first() as Record<string, unknown> | null;

  if (!nextStep) {
    await env.DB.prepare(
      "UPDATE workflow_enrollments SET status = 'completed', completed_at = datetime('now'), next_action_at = NULL WHERE id = ?"
    ).bind(enrollmentId).run();
    return;
  }

  // Calcule next_action_at selon le type du step suivant
  let nextAt: string;
  if (nextStep.step_type === 'wait') {
    let delay = 0;
    try { delay = (JSON.parse(nextStep.config as string) as { delay_minutes?: number }).delay_minutes || 0; } catch { /* */ }
    nextAt = new Date(Date.now() + delay * 60_000).toISOString();
  } else {
    nextAt = new Date().toISOString(); // exécution immédiate au prochain tick
  }

  await env.DB.prepare(
    "UPDATE workflow_enrollments SET current_step_id = ?, next_action_at = ? WHERE id = ?"
  ).bind(nextStep.id as string, nextAt, enrollmentId).run();
}

async function executeStep(env: Env, step: Record<string, unknown>, lead: Record<string, unknown>, enrollmentId: string): Promise<void> {
  const stepType = step.step_type as string;
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(step.config as string); } catch { /* */ }

  const interpolate = (s: string): string =>
    s.replace(/\{\{(\w+)\}\}/g, (_, key) => String(lead[key] ?? ''));

  switch (stepType) {
    case 'wait':
      // déjà géré par next_action_at, no-op
      return;

    case 'send_email': {
      if (!env.RESEND_API_KEY) return;
      const tplId = config.template_id as string;
      const tpl = tplId
        ? await env.DB.prepare('SELECT subject, body_html FROM email_templates WHERE id = ?').bind(tplId).first() as { subject: string; body_html: string } | null
        : null;
      if (!tpl) return;
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Intralys CRM <noreply@intralys.com>',
        to: [lead.email as string],
        subject: interpolate(tpl.subject),
        html: interpolate(tpl.body_html),
      });
      // Log dans messages
      await env.DB.prepare(
        `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by)
         VALUES (?, ?, ?, 'outbound', 'email', ?, ?, 'sent', 'workflow')`
      ).bind(crypto.randomUUID(), lead.id as string, lead.client_id as string, interpolate(tpl.subject), interpolate(tpl.body_html)).run();
      return;
    }

    case 'send_sms':
      // TODO P1 quand Twilio sera branché
      return;

    case 'add_tag':
      if (config.tag) {
        await env.DB.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag) VALUES (?, ?)')
          .bind(lead.id as string, String(config.tag).toLowerCase()).run();
      }
      return;

    case 'remove_tag':
      if (config.tag) {
        await env.DB.prepare('DELETE FROM lead_tags WHERE lead_id = ? AND tag = ?')
          .bind(lead.id as string, String(config.tag).toLowerCase()).run();
      }
      return;

    case 'change_status':
      if (config.status && ['new','contacted','meeting','signed','closed','lost'].includes(config.status as string)) {
        await env.DB.prepare("UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(config.status as string, lead.id as string).run();
        await env.DB.prepare(
          "INSERT INTO activity_log (lead_id, client_id, action, details) VALUES (?, ?, 'status_change', ?)"
        ).bind(lead.id as string, lead.client_id as string, JSON.stringify({ to: config.status, by: 'workflow' })).run();
      }
      return;

    case 'notify':
      // Crée notification pour l'admin du client (P1.4 doit avoir tourné)
      await env.DB.prepare(
        `INSERT INTO notifications (user_id, client_id, icon, title, description, link)
         SELECT id, ?, '🔔', 'Workflow', ?, ?
         FROM users WHERE (client_id = ? OR role = 'admin') AND is_active = 1`
      ).bind(
        lead.client_id as string,
        interpolate(String(config.message || 'Action requise')),
        `/leads/${lead.id}`,
        lead.client_id as string,
      ).run();
      return;

    case 'webhook': {
      const url = String(config.url || '');
      if (!url || !url.startsWith('https://')) return;
      const method = String(config.method || 'POST');
      try {
        await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead, enrollment_id: enrollmentId }),
        });
      } catch (err) {
        console.warn('Webhook step failed', err);
      }
      return;
    }

    default:
      return;
  }
}
```

3. Modifie `handleEnrollLead` pour que `next_action_at` soit `now()` si le premier step n'est PAS un wait (pour exécution au prochain cron tick) :
```ts
// Dans handleEnrollLead, remplace le bloc "Si le premier step est un 'wait'..."
let nextActionAt: string = new Date().toISOString();
if (firstStep?.step_type === 'wait') {
  try {
    const cfg = JSON.parse(firstStep.config) as { delay_minutes?: number };
    nextActionAt = new Date(Date.now() + (cfg.delay_minutes || 0) * 60_000).toISOString();
  } catch { /* */ }
}
```

4. Ajoute trigger automatique sur création lead — dans `handleWebhookLead` (et où un lead est créé), juste après l'INSERT :
```ts
// Auto-enroll dans tous les workflows actifs avec trigger 'lead_created'
const { results: triggers } = await env.DB.prepare(
  "SELECT id FROM workflows WHERE is_active = 1 AND trigger_type = 'lead_created' AND (client_id IS NULL OR client_id = ?)"
).bind(clientId).all();
for (const wf of (triggers || []) as Array<{ id: string }>) {
  await autoEnroll(env, wf.id, id);
}
```

Et la helper `autoEnroll` (factorise la logique de `handleEnrollLead`) :
```ts
async function autoEnroll(env: Env, workflowId: string, leadId: string): Promise<void> {
  const exists = await env.DB.prepare(
    "SELECT id FROM workflow_enrollments WHERE workflow_id = ? AND lead_id = ? AND status = 'active'"
  ).bind(workflowId, leadId).first();
  if (exists) return;
  const firstStep = await env.DB.prepare(
    'SELECT id, config, step_type FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC LIMIT 1'
  ).bind(workflowId).first() as { id: string; config: string; step_type: string } | null;
  if (!firstStep) return;
  let nextAt = new Date().toISOString();
  if (firstStep.step_type === 'wait') {
    try { nextAt = new Date(Date.now() + ((JSON.parse(firstStep.config) as { delay_minutes?: number }).delay_minutes || 0) * 60_000).toISOString(); } catch { /* */ }
  }
  await env.DB.prepare(
    `INSERT INTO workflow_enrollments (id, workflow_id, lead_id, current_step_id, status, next_action_at)
     VALUES (?, ?, ?, ?, 'active', ?)`
  ).bind(crypto.randomUUID(), workflowId, leadId, firstStep.id, nextAt).run();
}
```

5. Ajoute aussi le trigger `status_changed` dans `handlePatchLead` :
```ts
// Après l'UPDATE leads, si status a changé :
if (body.status !== undefined) {
  const { results: wfs } = await env.DB.prepare(
    "SELECT id, trigger_config FROM workflows WHERE is_active = 1 AND trigger_type = 'status_changed'"
  ).all();
  for (const wf of (wfs || []) as Array<{ id: string; trigger_config: string }>) {
    let cfg: { to_status?: string; from_status?: string } = {};
    try { cfg = JSON.parse(wf.trigger_config); } catch { /* */ }
    if (!cfg.to_status || cfg.to_status === body.status) {
      await autoEnroll(env, wf.id, leadId);
    }
  }
}
```

**Test :**
- `wrangler dev` (en local, pas de cron — test manuel : POST `/api/workflows/wf-new-lead-followup/enroll` avec un lead, puis appelle manuellement `processWorkflowQueue` via un endpoint de debug temporaire).
- Sur Cloudflare prod : déploie, crée un lead via webhook, attends 1 min, vérifie `workflow_execution_log`.

**Commit :** `feat(workflows): cron-driven execution engine + auto-enroll on lead_created/status_changed`

---

## 4. P1 — Important (faire après les P0)

### P1.1 — Twilio SMS bidirectionnel
- Ajoute deps : `bun add twilio` (côté worker → utilise leur API REST direct sans SDK pour rester léger).
- Vars : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
- Endpoint outbound dans `handleSendMessage` cas `'sms'` :
```ts
if (channel === 'sms' && env.TWILIO_ACCOUNT_SID) {
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: lead.phone as string, From: env.TWILIO_FROM_NUMBER, Body: messageBody }),
  });
  const data = await resp.json() as { sid?: string; error_message?: string };
  if (data.sid) { externalId = data.sid; status = 'sent'; }
  else { status = 'failed'; }
}
```
- Endpoint inbound `POST /api/webhook/sms` (Twilio webhook) :
  - Vérifie signature `X-Twilio-Signature`
  - Trouve le lead par `From` (numéro), insère message `direction='inbound'`.
- Compliance 10DLC à activer dans console Twilio (Rochdi le fait manuellement).

### P1.2 — Email inbound (Resend webhook)
- Configure webhook Resend → endpoint `POST /api/webhook/email`.
- Parse `In-Reply-To` / `References` headers pour threader.
- Insère message `direction='inbound'`.

### P1.3 — Validation Zod sur tous les endpoints
- `bun add zod`
- Crée `src/worker-schemas.ts` avec un schéma par endpoint.
- Wrap chaque `handle*` qui parse un body avec `schema.safeParse`.

### P1.4 — Notifications réelles (table créée en P0.2)
- Routes :
  - `GET /api/notifications` (paginé, filtre `unread`)
  - `PATCH /api/notifications/:id/read`
  - `POST /api/notifications/read-all`
- Frontend : remplace `DEMO_NOTIFICATIONS` dans `AppLayout.tsx` par un poll toutes les 30s.
- Trigger d'insertion : à chaque nouveau lead → notif pour l'admin + le broker du client.

### P1.5 — Pagination cursor-based
- Sur `/api/leads`, `/api/messages`, `/api/activity`, `/api/notifications` :
  - Param `?cursor=<created_at>&limit=50`
  - WHERE `created_at < ?` ORDER BY `created_at DESC`
  - Retourne `{ data: [...], next_cursor: lastCreatedAt }`

### P1.6 — Audit log middleware
- Helper `await audit(env, auth.userId, 'lead.update', 'lead', leadId, details, request)`.
- Appelle dans tous les handlers PATCH/DELETE.

### P1.7 — Bulk actions sur Leads
- Frontend : checkboxes sur table Leads + barre d'action en bas.
- Endpoint `POST /api/leads/bulk` avec `{ ids: [...], action: 'change_status'|'add_tag'|'assign'|'delete', value: ... }`.

### P1.8 — Multi-pipelines
- Nouvelle table `pipelines (id, client_id, name, stages JSON)`.
- Lead a `pipeline_id` + `stage` au lieu de `status` global.
- Migration soft : crée pipeline "Achat" et "Vente" par défaut, mappe l'existant.

---

## 5. P2 — Nice-to-have (faire quand P0+P1 sont stables)

- Form builder visuel (TipTap-like) + endpoint embed `<script src=".../widget.js">`
- Public booking pages `/book/{slug}` (Calendly clone)
- Sync Google Calendar (OAuth2)
- Email broadcast + suppression list (CASL compliance QC)
- Bulk import CSV avec field mapping
- Reputation : Google Business Profile API (review monitoring)
- Reports : CPL/CPA par source + Facebook CAPI server-side
- Sub-accounts hierarchy (agency → location → user, 3 niveaux)
- Snapshots (cloner setup d'un sub-account)
- White-label total
- AI bot conversationnel (qualif lead via SMS/web) — utilise Claude API ou OpenAI
- 2FA TOTP (colonnes déjà ajoutées en P0.2 — implémente UI + verify endpoint)

---

## 6. Mobile app

**Court terme (V1) :** Capacitor wrapper du frontend Vite existant.
- `bun add -D @capacitor/cli @capacitor/core @capacitor/ios @capacitor/android`
- `npx cap init intralys-crm com.intralys.crm`
- `bun run build && npx cap sync`
- Push notifications via `@capacitor/push-notifications` + Firebase.

**Long terme (V2) :** React Native + Expo si besoin de :
- Click-to-call answer in-app (Twilio Voice SDK)
- Offline sync (SQLite + queue)
- Background tasks
- Vrai app store branding par sub-account (white-label)

---

## 7. Convention de travail

**Build avant commit :**
```bash
bun run build && git add -A && git commit -m "..."
```

**Format commit :**
- `feat(auth): ...` nouvelle feature
- `fix(workflows): ...` correction bug
- `chore(infra): ...` config/build
- `refactor(worker): ...` refactor
- `docs(antigravity): ...` ce fichier ou docs

**Anti-collision :**
- Avant de toucher un fichier, `git pull --rebase` puis `git log --oneline -5 <fichier>` pour voir si Claude a poussé récemment.
- Si conflit : ne force jamais. Pull, résous main → branche, recommit.

**Question existentielle :** si tu hésites entre 2 approches sur une décision d'architecture (ex: choix DB séparée par tenant vs schéma multi-tenant), **stop et demande à Rochdi** au lieu d'inventer.

---

## 8. Checklist de validation avant de marquer une tâche "done"

- [ ] `bun run build` passe sans erreur TS
- [ ] Code respecte le style worker existant (`sanitizeInput`, `json()`, `requireAuth`)
- [ ] Si nouvelle table SQL → migration créée + script `db:migrate:phaseN` ajouté à `package.json`
- [ ] Si nouvelle route → ajoutée à `src/lib/api.ts` avec types
- [ ] Si nouvelle env var → documentée dans cette section ↓
- [ ] Commit atomique avec message clair

### Variables d'environnement attendues

```
ADMIN_PASSWORD          # bootstrap initial, à retirer après P0.2
RESEND_API_KEY          # email outbound + (P1) inbound webhook signature
WEBHOOK_SECRET          # X-Webhook-Secret pour /api/webhook/lead
NOTIFICATION_EMAIL      # email Rochdi pour notifications nouveau lead
ALLOWED_ORIGINS         # CSV des origins autorisés CORS (P0.1)
TWILIO_ACCOUNT_SID      # P1.1
TWILIO_AUTH_TOKEN       # P1.1
TWILIO_FROM_NUMBER      # P1.1
TWILIO_WEBHOOK_SECRET   # P1.1 (validation HMAC)
```

Set en prod via : `npx wrangler secret put <NAME>`.

---

## 9. Status tracker (à mettre à jour par Antigravity)

| ID | Tâche | Status | Commit |
|---|---|---|---|
| P0.1 | CORS restreint + database_id | ✅ done | 8434753 |
| P0.2 | Auth PBKDF2 + change-password | ✅ done | 8434753 |
| P0.3 | Routes /api/tasks | ✅ done | 8434753 |
| P0.4 | Workflow engine cron | ✅ done | 8434753 |
| P1.1 | Twilio SMS bidirectionnel | ✅ done | fe885c2 |
| P1.2 | Email inbound webhook | ✅ done | fe885c2 |
| P1.3 | Validation Zod | ✅ done | f635d54 |
| P1.4 | Notifications réelles | ✅ done | 8434753 |
| P1.5 | Pagination cursor | ✅ done | ff02fb9 |
| P1.6 | Audit log middleware | ✅ done | c51b78d |
| P1.7 | Bulk actions Leads | ✅ done | c0f34b2 |
| P1.8 | Multi-pipelines | ✅ done | fe885c2 |

Mets `🟡 in-progress` quand tu démarres, `✅ done` quand commit poussé. Mets le hash court du commit dans la dernière colonne.

---

## 10. Si bloqué

1. Re-lis le contexte (sections 0-2).
2. Cherche dans `src/worker.ts` un pattern existant similaire.
3. Si vraiment bloqué → laisse une note dans le tableau status `⛔ blocked: <raison>` et passe à la tâche suivante. Rochdi reviendra dessus.

**Ne jamais :** désactiver des tests existants, force-push, modifier `.env` ou secrets, supprimer une migration appliquée, push sur `main` sans PR.

---

_Document généré le 2026-05-10 par Claude Opus 4.7 (1M context) suite à audit complet de l'arbo `intralys-dashboard`. Version 1.0._
