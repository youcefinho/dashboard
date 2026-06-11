# LOT TEAM A — fix fuite isolation + cycle invitation

> Phase A SOLO (Manager 1) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (M2 front ∥ M3 i18n). Non exécuté (VM VMware).

---

## §6 Contrats figés

### §6.A — `handleGetUsers` signature + bornes isolation

```ts
handleGetUsers(_request: Request, env: Env, auth?: {
  userId: string; role: string; clientId?: string; tenant?: TenantContext
}): Promise<Response>
```

**Mode legacy/mono-tenant** = `!auth?.tenant || auth.tenant.agencyId == null`.
- SELECT plein scope **byte-identique** à l'ancien code :
  `SELECT id, name, email, role, role_generic, last_login_at, created_at FROM users LIMIT 50`
- `try/catch` → si colonnes seq 79 absentes, fallback **identique à l'historique** :
  `SELECT id, name, email, role, created_at FROM users LIMIT 50`
- AUCUN `WHERE` tenant injecté sur ce chemin.

**Mode agence** = `auth.tenant.agencyId != null` :
- `... FROM users WHERE agency_id = ? OR client_id IN (<placeholders>) LIMIT 50`
  bind `[agencyId, ...accessibleClientIds]` (placeholders = `accessible.map(()=>'?').join(',')`).
- Si `accessibleClientIds` vide → `WHERE agency_id = ?` seul.
- `try/catch` fallback (colonnes pré-78/79 absentes) : **borné aux seuls
  `accessibleClientIds`** (`WHERE client_id IN (...)`), JAMAIS de SELECT plein
  scope ⇒ fuite cross-tenant **impossible** même en dégradé. Si `accessible`
  vide en fallback → `{ data: [] }`.

**`handleUpdateUserRole` / `handleDeleteUser`** : même signature `(request, env, auth?)`.
- Legacy → comportement **byte-identique** (pas de garde).
- Agence → garde tenant minimale : SELECT `agency_id, client_id` du userId cible ;
  si cible ∉ `accessibleClientIds` ET `agency_id ≠ tenant.agencyId` →
  `json({ error: 'Utilisateur introuvable', code: 'NOT_FOUND' }, 404)` (aucun
  UPDATE/DELETE exécuté). Fallback `client_id` seul si `agency_id` absent.

### §6.B — Migration seq 79, token, endpoints, réponses

**Migration** `migration-team-lotA-seq79.sql` (seq 79, depends_on
`migration-sprintLOT1-m1.sql`) — STRICTEMENT ADDITIF, JAMAIS rebuild users :
- `CREATE TABLE IF NOT EXISTS user_invitations (id PK lower(hex(randomblob(16))),
  email, agency_id NOT NULL, scope CHECK('agency'|'subaccount') def 'agency',
  client_id NULL, role NOT NULL def 'member', token_hash NOT NULL, status
  CHECK('pending'|'accepted'|'revoked'|'expired') def 'pending', invited_by NULL,
  expires_at NOT NULL, accepted_at NULL, created_at def datetime('now'))`
  + 3 index (token_hash, agency_id, email).
- `ALTER TABLE users ADD COLUMN role_generic TEXT DEFAULT NULL`
- `ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT NULL`
  (DÉFENSIF : déjà présent via auth.ts:115 ⇒ « duplicate column » **attendu,
  non fatal**, best-effort statement-par-statement Antigravity).
- Back-fill `role_generic` (WHERE role_generic IS NULL) : `admin→owner`,
  `broker→manager`, `store_manager→member`.
- Back-fill `last_login_at` best-effort depuis `MAX(admin_sessions.last_active_at)`.

**Token** : clair = `crypto.randomUUID() + crypto.randomUUID()` (256 bits).
**Jamais persisté ni loggé.** Persisté : `token_hash` = SHA-256 hex
(`crypto.subtle.digest`, 64 chars `[0-9a-f]`). Lien email = `/invite/accept?token=<token clair>`.
`expires_at = datetime('now','+7 days')`.

**Endpoints** :

| Route | Auth | Handler | Réponse succès |
|---|---|---|---|
| `GET /api/team/users` | gardé | `handleGetUsers(req,env,auth)` | `{ data: [...] }` |
| `POST /api/team/invites` | gardé | `handleInviteUser(req,env,auth)` | `json({data:{success:true,message:'Invitation envoyée avec succès'}},201)` |
| `POST /api/team/invites/accept` | **PUBLIC** (pré-requireAuth) | `handleAcceptInvitation(req,env)` | `finishLogin(...)` (`{success,token,must_change_password,user}`) |
| `POST /api/team/invites/:id/revoke` | gardé | `handleRevokeInvitation(req,env,auth)` | `{ data: { success: true } }` |
| `POST /api/team/invites/:id/resend` | gardé | `handleResendInvitation(req,env,auth)` | `{ data: { success: true } }` |
| `PATCH /api/team/users/:id` | gardé | `handleUpdateUserRole(req,env,auth)` | `{ data: { success: true } }` |
| `DELETE /api/team/users/:id` | gardé | `handleDeleteUser(req,env,auth)` | `{ data: { success: true } }` |
| `GET /api/team/roles` | gardé | `handleGetRoles(req,env)` | `{ data: [4 rôles] }` |

**Réponses `{error, code}` normalisées** :
- `{ error: 'Email invalide' }` 400 (invite, email sans `@`)
- `{ error: 'Cet utilisateur existe déjà' }` 400 (verbatim — invite + accept)
- `{ error: 'Sous-compte non autorisé', code: 'INVALID_SCOPE' }` 400
- `{ error: 'Invitation invalide ou expirée', code: 'INVALID_INVITE' }` 400
  (accept token absent/introuvable/expiré/déjà accepté = single-use ; resend non éligible)
- `{ error: 'Mot de passe trop court (min 8 caractères)' }` 400 (accept)
- `{ error: 'Utilisateur introuvable', code: 'NOT_FOUND' }` 404 (update/delete hors tenant)
- `{ error: 'Rôle manquant' }` 400 (update sans role)

**`handleAcceptInvitation` (PUBLIC)** : body `{token, password(≥8), name?}`.
Sécurité = token hashé + `expires_at > datetime('now')` + `status='pending'`
+ single-use (par design, pas de session requise). Flux :
1. lookup `token_hash = SHA256(token) AND status='pending' AND expires_at>datetime('now')`.
2. garde anti-collision email (dup user → 400 « Cet utilisateur existe déjà »).
3. `INSERT INTO users (id,name,email,role,role_generic,password_hash,client_id,agency_id)` :
   `role` = mapping legacy CHECK-valide, `role_generic` = `invite.role`,
   `password_hash` = `hashPassword(password)` (pbkdf2), `client_id` =
   `invite.client_id` si scope subaccount sinon `null`, `agency_id` = `invite.agency_id`.
4. jonction : scope=subaccount → `INSERT OR IGNORE user_sub_accounts (id,user_id,client_id,role)
   VALUES (uuid,userId,invite.client_id,invite.role)` ; scope=agency →
   `INSERT OR IGNORE user_sub_accounts SELECT lower(hex(randomblob(16))),userId,c.id,invite.role
   FROM clients c WHERE c.agency_id = invite.agency_id`.
5. `UPDATE user_invitations SET status='accepted', accepted_at=datetime('now')`.
6. `audit('user.invite.accept', ...)` puis **`return finishLogin(env,userId,
   mappedLegacyRole,name,email,false,ip,ua)`** (contrat Lot1 §6.5).

`handleInviteUser` : **SUPPRIME** le `console.log` mock + l'`INSERT users`
`password_hash='PENDING_INVITE'`. INSERT `user_invitations` uniquement + email
Resend RÉEL (pattern workflows.ts:552, `from:'Intralys CRM <noreply@intralys.com>'`,
garde `if(!env.RESEND_API_KEY){ log; continue }`).

### Mapping rôles (VERROUILLÉ)

| générique (`role_generic`, `user_invitations.role`) | technique (`users.role`, CHECK seq 59) |
|---|---|
| `owner` | `admin` |
| `manager` | `broker` |
| `member` | `store_manager` |
| `viewer` | `store_manager` (lecture seule réelle = permissions composables **LOT B**) |

⚠ JAMAIS de rôle générique dans `users.role` (CHECK
`role IN ('admin','broker','store_manager')`). JAMAIS de rebuild `users`.
`handleGetRoles` retourne les 4 génériques en dur `is_system:true`
(pas de table — système complet = LOT B).

### §6.C — Routes worker.ts (avant / après)

**Avant** (5 lignes, sans auth) :
```ts
if (path === '/api/team/users' && method === 'GET') return handleGetUsers(request, env);
if (path === '/api/team/invites' && method === 'POST') return handleInviteUser(request, env);
const userMatch = path.match(/^\/api\/team\/users\/([^/]+)$/);
if (userMatch && method === 'PATCH') return handleUpdateUserRole(request, env);
if (userMatch && method === 'DELETE') return handleDeleteUser(request, env);
if (path === '/api/team/roles' && method === 'GET') return handleGetRoles(request, env);
```

**Après** — route PUBLIQUE ajoutée dans la zone `/api/auth/register`
(AVANT `requireAuth`) :
```ts
if (path === '/api/team/invites/accept' && method === 'POST') {
  return handleAcceptInvitation(request, env);
}
```
Bloc gardé (dans `routeProtected`, `auth` injecté) :
```ts
if (path === '/api/team/users' && method === 'GET') return handleGetUsers(request, env, auth);
if (path === '/api/team/invites' && method === 'POST') return handleInviteUser(request, env, auth);
const inviteRevokeMatch = path.match(/^\/api\/team\/invites\/([^/]+)\/revoke$/);
if (inviteRevokeMatch && method === 'POST') return handleRevokeInvitation(request, env, auth);
const inviteResendMatch = path.match(/^\/api\/team\/invites\/([^/]+)\/resend$/);
if (inviteResendMatch && method === 'POST') return handleResendInvitation(request, env, auth);
const userMatch = path.match(/^\/api\/team\/users\/([^/]+)$/);
if (userMatch && method === 'PATCH') return handleUpdateUserRole(request, env, auth);
if (userMatch && method === 'DELETE') return handleDeleteUser(request, env, auth);
if (path === '/api/team/roles' && method === 'GET') return handleGetRoles(request, env);
```
Import élargi : `handleAcceptInvitation, handleRevokeInvitation, handleResendInvitation`.

---

## Contrat front M2 (Phase B)

### Page `AcceptInvitation` (route front publique, ex. `/invite/accept`)
- Lit `?token=<token clair>` dans l'URL.
- Form : `password` (≥8, requis), `confirm` (UI seule), `name` (optionnel).
- `POST /api/team/invites/accept` body `{ token, password, name? }`.
- **Succès** = payload `finishLogin` : `{ success:true, token, must_change_password,
  user:{id,name,role,email} }` → persister le `token` de session comme un login
  normal (identique au flux register/login existant) puis rediriger dashboard.
- **Échec** `{ error, code }` : afficher `error`. `code:'INVALID_INVITE'` →
  message « lien invalide ou expiré » + CTA contact admin (pas de retry token).

### `TeamSettings` (page Équipe existante)
- `GET /api/team/users` → liste (champs additifs dispo : `role_generic`,
  `last_login_at` ; peuvent être `null` pré-back-fill).
- Invitation : form `{ email, role?, name?, scope?, client_id?, message? }`
  `POST /api/team/invites`. `role` ∈ `owner|manager|member|viewer`
  (cf. `GET /api/team/roles`). `scope` = `'agency'` (défaut) | `'subaccount'`
  (alors `client_id` requis ∈ sous-comptes accessibles).
  - `code:'INVALID_SCOPE'` → erreur sous le sélecteur de sous-compte.
- Invitations en attente : actions `POST /api/team/invites/:id/revoke` et
  `/api/team/invites/:id/resend` → toast `{ data:{ success:true } }`.
- `PATCH /api/team/users/:id` `{ role }` (rôle **technique**), `DELETE /api/team/users/:id`.
  `code:'NOT_FOUND'` 404 → l'utilisateur n'est pas dans le périmètre (toast).

---

## Clés i18n requises (liste pour M3 — fr-CA + en, format plat point-notation)

```
team.invite.title
team.invite.email_label
team.invite.role_label
team.invite.name_label
team.invite.scope_label
team.invite.scope_agency
team.invite.scope_subaccount
team.invite.subaccount_label
team.invite.message_label
team.invite.submit
team.invite.success
team.invite.error_email
team.invite.error_exists
team.invite.error_scope
team.invite.pending_title
team.invite.action_revoke
team.invite.action_resend
team.invite.revoked
team.invite.resent
team.accept.title
team.accept.password_label
team.accept.confirm_label
team.accept.name_label
team.accept.submit
team.accept.success
team.accept.error_invalid
team.accept.error_password_short
team.roles.owner
team.roles.manager
team.roles.member
team.roles.viewer
team.users.role_label
team.users.last_login
team.users.delete
team.users.not_found
```

⚠ Parité STRICTE fr-CA/en (mêmes clés), valeurs string, pas de `{{var}}`
(cf. test parité LOT 1 §6.7). M3 SEUL touche les catalogues i18n.

---

## Preuves (Phase A)

- **Fix isolation rétro-compat** : `teamA-isolation.test.ts` — legacy
  byte-identique (SELECT plein scope, aucun WHERE tenant) ; agence bornée
  (`agency_id = ? OR client_id IN (...)`, binds `[agencyId,...accessible]`) ;
  fallback agence borné aux `accessibleClientIds` (zéro SELECT plein scope) ;
  update/delete 404 NOT_FOUND hors tenant.
- **Zéro rebuild users + token hashé** : `teamA-invitation.test.ts` — aucun
  `DROP TABLE users` / `RENAME TO users` ; `token_hash` `^[0-9a-f]{64}$` ; token
  clair absent des binds ; `password_hash` `^pbkdf2\$` (jamais `PENDING_INVITE`) ;
  aucun INSERT users côté invite ; single-use (status='pending' filtré).

**§6 LOT A FIGÉ → Phase B (M2 ∥ M3) peut démarrer.**
