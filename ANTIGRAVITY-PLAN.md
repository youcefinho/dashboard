# ANTIGRAVITY-PLAN.md — Plan d'action CRM Intralys

> Rédigé le 2026-05-10 par Antigravity après audit du working tree + lecture `ANTIGRAVITY-TODO.md`.

---

## A. Auto-audit des 5 chantiers à 90%

### P0.1 — CORS restreint + wrangler.jsonc

**État réel confirmé :**
- ✅ `wrangler.jsonc` : `vars.ALLOWED_ORIGINS` + `triggers.crons` ajoutés
- ✅ `Env` : `ALLOWED_ORIGINS: string` ajouté
- ✅ `corsHeaders(request, env)` : refactoré avec restriction par origin
- ✅ Preflight `OPTIONS` passe `(request, env)`
- ⚠️ `database_id` = placeholder `"<METTRE_LE_VRAI_ID_ICI>"`

**Reste à faire :**
1. **Retirer le fallback `*`** — ligne ~86 `worker.ts` : `allowed[0] || '*'` → `allowed[0] || ''`
2. **Retirer la branche sans args** — lignes 95-99 : le `if (!request || !env)` retourne `*`. Cette branche doit devenir un empty-origin qui bloque les requêtes non-origin.
3. **Propager `(request, env)` à tous les callsites `json()`** — actuellement ~80 des ~100 `json()` retournent des réponses avec CORS `*` par défaut (car `request`/`env` ne sont pas passés). **Problème majeur.** Solution : refactorer `json()` pour que `request`+`env` soient obligatoires (ou utiliser un context pattern — voir risque R2).
4. **`database_id`** — attente Rochdi (question bloquante Q1).

**Shortcuts pris :**
- Fallback `*` sur CORS si `request`/`env` non fournis → toute la chaîne auth/webhook envoie `*`
- `database_id` vide empêche le deploy

---

### P0.2 — Auth PBKDF2 par utilisateur

**État réel confirmé :**
- ✅ `hashPassword()` + `verifyPassword()` PBKDF2-SHA256, 210k iter, constant-time compare
- ✅ `handleLogin` refait : bootstrap admin + fallback migration + PBKDF2 verify
- ✅ `finishLogin` helper factorisé
- ✅ `handleChangePassword` endpoint + `changePassword()` api.ts
- ✅ `migration-phase5.sql` : tables `audit_log`, `notifications`, `tasks`, colonnes `totp_*`, `must_change_password`, `last_login_at`
- ✅ `package.json` : script `db:migrate:phase5`

**Reste à faire :**
1. **`must_change_password` ignoré dans `finishLogin`** — la réponse JSON ne retourne pas le flag. Le frontend ne sait pas quand forcer le changement.
   - Fichier : `src/worker.ts` L509 — ajouter `must_change_password: 1` dans l'INSERT bootstrap
   - Fichier : `src/worker.ts` L536-550 — lire `must_change_password` depuis users, l'inclure dans la réponse `finishLogin`
2. **Page `ChangePassword.tsx`** — n'existe pas encore
   - Créer `src/pages/ChangePassword.tsx`
   - Router dans `src/App.tsx`
3. **Hook post-login** — dans `src/pages/Login.tsx`, si la réponse contient `must_change_password === 1` → redirect vers `/change-password`

**Shortcuts pris :**
- Bootstrap admin ne set pas `must_change_password = 1` → premier compte ne force pas le changement
- `handleChangePassword` fait un cast `(env as Env)` inutile (code smell)

---

### P0.3 — Routes /api/tasks (CRUD)

**État réel confirmé :**
- ✅ Routes GET/POST/PATCH/DELETE dans `routeApi()`
- ✅ `handleGetTasks` avec filtres (status, priority, lead_id) + contrôle par rôle
- ✅ `handleCreateTask` avec `sanitizeInput` + UUID
- ✅ `handlePatchTask` avec updates dynamiques
- ✅ `handleDeleteTask`
- ✅ `DEMO_TASKS` supprimé de `Tasks.tsx`, state initialisé à `[]`
- ✅ `useEffect` charge depuis l'API

**Reste à faire :**
1. **Tester end-to-end** — vérifier que le frontend fonctionne réellement avec le backend (création, toggle statut, suppression, filtres)
2. **`handleDeleteTask` sans contrôle de rôle** — un broker peut supprimer n'importe quelle tâche. Ajouter vérification `assigned_to = auth.userId || auth.role === 'admin'`

**Shortcuts pris :**
- `_auth` préfixé underscore dans `handlePatchTask` et `handleDeleteTask` → pas de contrôle d'accès

---

### P0.4 — Workflow engine cron

**État réel confirmé :**
- ✅ `scheduled()` handler exporté
- ✅ `processWorkflowQueue` — lit enrollments dus, exécute en batch de 50
- ✅ `advanceEnrollment` — avance au step suivant, gère `wait` delays
- ✅ `executeStep` — 8 types : `wait`, `send_email`, `send_sms`, `add_tag`, `remove_tag`, `change_status`, `notify`, `webhook`
- ✅ `autoEnroll` helper
- ✅ Auto-enroll `lead_created` dans `handleWebhookLead`
- ✅ Trigger `status_changed` dans `handlePatchLead`

**Reste à faire :**
1. **Impossible de tester en local** — `wrangler dev` ne déclenche pas les crons. Créer un endpoint debug temporaire `GET /api/debug/run-cron` (protégé par auth admin, à retirer avant prod).
2. **Pas de guard contre double-enrollment concurrent** — si 2 crons overlappent, un lead peut être enrollé 2 fois. Mitigation : ajouter `ON CONFLICT` ou check `SELECT ... FOR UPDATE` (non supporté D1 → la mitigation existante `if (exists) return` dans `autoEnroll` suffit si le cron est ≤1/min).
3. **`executeStep` send_email — pas de gestion d'erreur Resend** — si Resend retourne une erreur, on l'ignore silencieusement. Ajouter un `try/catch` et logger dans `workflow_execution_log` avec `status='failed'`.

**Shortcuts pris :**
- `send_sms` est un no-op (TODO P1 Twilio)
- `webhook` step ne vérifie pas le status code de réponse
- Pas de retry sur failure

---

### P1.4 — Notifications réelles

**État réel confirmé :**
- ✅ Routes GET/read/read-all dans le worker
- ✅ `AppLayout.tsx` charge depuis l'API avec poll 30s
- ✅ Trigger insertion sur nouveau lead (webhook → notif pour admins)
- ✅ `createNotification` helper
- ✅ Affichage temps relatif dans le dropdown

**Reste à faire :**
1. **Trigger sur changement de statut** — quand un lead passe à `signed`/`closed`, notifier l'admin
2. **Trigger tâche overdue** — un cron job pourrait créer des notifications pour les tâches en retard (à faire dans `processWorkflowQueue` ou un second cron)
3. **Tester end-to-end** — créer un lead via webhook → notification visible dans la cloche

---

## B. Plan d'action en 2 phases

### Phase 1 — Boucler les P0 (priorité absolue)

**Ordre d'exécution :**

#### 1. P0.1 — Finir CORS (30 min)
- [ ] Retirer fallback `*` dans `corsHeaders()` → retourner `''` si origin non autorisé
- [ ] Supprimer la branche `corsHeaders()` sans args — rendre `request` et `env` obligatoires
- [ ] Propager `(request, env)` à tous les callsites : refactorer les handlers pour passer request/env au lieu de les omettre. **Alternative pragmatique :** stocker request/env dans une closure ou variable module-level au début de `fetch()`, et les référencer dans `json()` automatiquement.
- [ ] `database_id` — ⛔ bloqué en attente Rochdi

#### 2. P0.2 — Finir auth (1h30)
- [ ] Retourner `must_change_password` dans `finishLogin` (lecture de la colonne `users.must_change_password`)
- [ ] Set `must_change_password = 1` dans le bootstrap INSERT
- [ ] Créer `src/pages/ChangePassword.tsx` (formulaire : ancien + nouveau + confirmation)
- [ ] Ajouter route `/change-password` dans `src/App.tsx`
- [ ] Dans `Login.tsx` : si réponse login contient `must_change_password`, redirect

#### 3. P0.3 — Finir tasks (30 min)
- [ ] Ajouter contrôle d'accès dans `handleDeleteTask` (admin ou owner)
- [ ] Test manuel end-to-end : créer, modifier, filtrer, supprimer

#### 4. P0.4 — Finir workflow (30 min)
- [ ] Ajouter endpoint debug `GET /api/debug/run-cron` (admin only)
- [ ] Ajouter `try/catch` dans `executeStep` case `send_email` avec log failure
- [ ] Test manuel via endpoint debug

#### 5. P1.4 — Finir notifications (30 min)
- [ ] Ajouter trigger sur `handlePatchLead` quand status → signed/closed
- [ ] Test end-to-end

#### 6. Commits (20 min)
Découpage pragmatique en 2 commits comme suggéré dans STATUS LIVE :
```bash
# Commit A : infra + auth
git add wrangler.jsonc package.json migration-phase5.sql
# + staged hunks from src/worker.ts (Env, CORS, auth, change-password)
# + src/lib/api.ts (changePassword)
# + src/pages/ChangePassword.tsx (nouveau)
# + src/App.tsx (route change-password)
# + src/pages/Login.tsx (redirect must_change)
git commit -m "feat(infra+auth): CORS allowlist, cron config, PBKDF2 password hashing per user"

# Commit B : features
git add src/pages/Tasks.tsx src/components/layout/AppLayout.tsx
# + reste worker.ts (tasks + workflow + notifications)
git commit -m "feat(crm): tasks CRUD + workflow execution engine + real notifications"
```

**Procédure de test manuelle par P0 :**
- P0.1 : `bun run dev` → fetch depuis localhost → CORS headers présents
- P0.2 : login → `must_change_password` flag → redirect → change password → re-login OK
- P0.3 : page Tasks → créer tâche → refresh → persiste → supprimer → disparaît
- P0.4 : endpoint debug cron → vérifier `workflow_execution_log` non vide
- P1.4 : webhook lead → notification visible dans la cloche

---

### Phase 2 — P1 (après Phase 1 verte)

**Ordre justifié :**

| # | ID | Tâche | Durée | Justification ordre |
|---|---|---|---|---|
| 1 | P1.6 | Audit log middleware | 1h | Fondation — toutes les actions suivantes doivent logger |
| 2 | P1.3 | Validation Zod | 2h | Sécurité — sanitise tous les inputs de manière déclarative |
| 3 | P1.5 | Pagination cursor | 1h30 | Performance — évite les OFFSET lents sur grosses tables |
| 4 | P1.7 | Bulk actions Leads | 1h30 | UX — dépend de P1.6 (bulk doit logger chaque action) |
| 5 | P1.1 | Twilio SMS bidirectionnel | 2h | Feature — nécessite clés Twilio + 10DLC (dépend de Rochdi) |
| 6 | P1.2 | Email inbound webhook | 1h30 | Feature — nécessite config Resend webhook |
| 7 | P1.8 | Multi-pipelines | 3h | Archi — migration lourde, fait en dernier car casse le modèle `status` global |

---

## C. Réponses aux 4 questions bloquantes

### Q1. `database_id` D1

**Recommandation par défaut :** je lance `npx wrangler d1 create intralys-crm` moi-même et remplis l'ID.

**Impact si mauvaise décision :** si une DB existe déjà avec des données, on la perdrait en en créant une nouvelle. Risque **low** (projet en dev, pas de données prod).

**Action :** je crée la DB sauf si Rochdi dit qu'elle existe déjà.

---

### Q2. Domaine Resend `noreply@intralys.com`

**Recommandation par défaut :** utiliser `noreply@intralys.com` comme configuré. Si non vérifié, les emails seront rejetés par Resend silencieusement.

**Impact si mauvaise décision :** les workflows `send_email` et les notifications nouveau lead n'enverront rien. Risque **medium** — fonctionnalité dégradée mais pas de crash.

**Action :** laisser le code tel quel. Rochdi vérifie dans sa console Resend.

---

### Q3. Cron `* * * * *` vs `*/5 * * * *`

**Recommandation par défaut :** garder `* * * * *` pour la démo/dev. Passer à `*/5 * * * *` en prod.

**Impact si mauvaise décision :**
- `* * * * *` sur Free Tier : ~43 200 invocations/mois juste pour le cron (le free tier est 100K/jour, donc ça passe largement)
- `*/5 * * * *` : 1 workflow step pourrait avoir 5 min de latence max

**Action :** je laisse `* * * * *` pour le moment, avec un commentaire `// TODO: passer à */5 en prod`.

---

### Q4. Force change-password au premier login

**Recommandation par défaut :** **Banner discret** en haut de page avec lien vers `/change-password`, pas de redirection forcée. Raison : en phase dev, forcer le changement à chaque reset de DB serait pénible.

**Impact si mauvaise décision :**
- Redirection forcée → friction dev, mais plus sécurisé en prod
- Banner discret → risque qu'un admin ignore et garde ADMIN_PASSWORD

**Action :** j'implémente le banner + la page `/change-password`, avec un flag `FORCE_CHANGE_PASSWORD` dans le localStorage pour ne pas re-afficher après dismissal. En prod, on pourra activer la redirection forcée.

---

## D. Risques techniques identifiés

### R1 — CORS effectivement `*` sur ~80% des réponses
**Sévérité : HIGH**
La majorité des `json()` calls ne passent pas `request`/`env`, donc le fallback `*` s'applique.

**Mitigation :** Refactorer `corsHeaders()` pour stocker `request`/`env` dans des variables au début du handler `fetch()`, et les référencer dans `json()` sans avoir à les passer manuellement. Pattern : closure ou module-scoped `let currentRequest/currentEnv`.

**Décision :** Refactor obligatoire en Phase 1, item P0.1.

---

### R2 — Race condition workflow concurrent enrollments
**Sévérité : LOW**
Si le cron tourne toutes les minutes et un step prend >60s, le prochain tick pourrait re-traiter le même enrollment.

**Mitigation :** Le `WHERE next_action_at <= now` + l'update de `next_action_at` après exécution crée une fenêtre de ~quelques ms. Probabilité très faible sur D1 (single-writer SQLite). Le check `autoEnroll` existe déjà.

**Décision :** Laisser comme c'est. Ajouter un `status = 'processing'` intermédiaire si on passe à scale (P2).

---

### R3 — Worker monolithique de 2000+ lignes
**Sévérité : MEDIUM**
Le fichier `worker.ts` fait maintenant ~2000 lignes. Lisibilité en baisse, refactor risqué car tout est dans un seul scope.

**Mitigation :** À refactorer en P2 : extraire les handlers par domaine (`auth.ts`, `tasks.ts`, `workflows.ts`). Pour l'instant, le router pattern est clair et le build passe.

**Décision :** Laisser pour Phase 1, prévoir split en Phase 2.

---

### R4 — `send_email` dans workflow ne gère pas les erreurs Resend
**Sévérité : MEDIUM**
Si Resend retourne 429/500, le step est marqué `executed` alors qu'il a échoué.

**Mitigation :** Wrapper l'appel Resend dans `try/catch`, logger `status='failed'` dans `workflow_execution_log`.

**Décision :** Fix en Phase 1, item P0.4.

---

### R5 — Bundle size 888KB (chunk warning Vite)
**Sévérité : LOW**
Dépasse le seuil de 500KB. Impact : temps de chargement initial plus long sur mobile.

**Mitigation :** Code splitting avec `React.lazy()` + `Suspense` sur les pages secondaires (WorkflowBuilder, Reports, Templates).

**Décision :** P2 — pas bloquant fonctionnellement.

---

## E. Estimation

### Phase 1 — Finir P0 : **~4h**

| Tâche | Durée |
|---|---|
| P0.1 CORS fix complet | 45 min |
| P0.2 Auth finish (page + redirect + must_change) | 1h30 |
| P0.3 Tasks access control + test | 30 min |
| P0.4 Debug endpoint + error handling | 30 min |
| P1.4 Notifications triggers | 30 min |
| Commits + push | 15 min |
| **Total** | **~4h** |

### Phase 2 — P1 : **~12h30**

| Tâche | Durée |
|---|---|
| P1.6 Audit log middleware | 1h |
| P1.3 Validation Zod | 2h |
| P1.5 Pagination cursor | 1h30 |
| P1.7 Bulk actions Leads | 1h30 |
| P1.1 Twilio SMS bidirectionnel | 2h |
| P1.2 Email inbound webhook | 1h30 |
| P1.8 Multi-pipelines | 3h |
| **Total** | **~12h30** |
