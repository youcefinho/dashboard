# LOT 1 SaaS — Contrats figés (Phase A → B/C)

> Manager 1 (Phase A SOLO) a figé ce document. **Phase B (M2 ∥ M3) peut
> démarrer.** Les sections §6.1→§6.7 ci-dessous sont le CONTRAT : B et C
> codent contre elles sans les renégocier.

## §6 Contrats figés

**§6.1 résolveur** : `interface TenantContext { userId; role; clientId:string|null; agencyId:string|null; accountLevel:string; accessibleClientIds:string[] }` ; `resolveTenantContext(env,userId,role,requestedSubAccountId?):Promise<TenantContext>`. Règles : requested ∉ accessible → IGNORE, fallback `users.client_id` (JAMAIS throw/500 au choke-point) ; client_id null & 0 jonction → tout null/[] (= legacy strict identique getClientModules:68) ; account_level via try/catch SELECT, absent → `'user'` ; ≤3 req (users ; user_sub_accounts ; clients.agency_id conditionnel). Audit `'agency.subaccount.access'` (resource 'client', {agencyId,viaSwitch:false}) UNIQUEMENT si requestedSubAccountId fourni+résolu+agencyId≠null, best-effort.

**§6.2 getClientModules** : retour `{clientId, modules, agencyId?, accountLevel?, accessibleClientIds?}` — `clientId`/`modules` type+sémantique STRICTEMENT inchangés (114 appelants intacts), additifs optionnels, accepte `ctx?:TenantContext` (réutilise si fourni, sinon legacy exact).

**§6.3 migration seq 78** (SQL EXACT) :
```
ALTER TABLE clients ADD COLUMN agency_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_agency ON clients(agency_id);
CREATE TABLE IF NOT EXISTS user_sub_accounts ( id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), user_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL REFERENCES clients(id), role TEXT DEFAULT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id,client_id) );
CREATE INDEX IF NOT EXISTS idx_usa_user ON user_sub_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_usa_client ON user_sub_accounts(client_id);
ALTER TABLE users ADD COLUMN agency_id TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN account_level TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN parent_user_id TEXT DEFAULT NULL;
INSERT OR IGNORE INTO user_sub_accounts (id,user_id,client_id) SELECT lower(hex(randomblob(16))), id, client_id FROM users WHERE client_id IS NOT NULL AND client_id <> '';
```
En-tête commentaire SQL : documenter que les 3 `ALTER users ADD` peuvent échouer "duplicate column name" si seq 59 a été partiellement réparé → exécution best-effort statement-par-statement (Antigravity), un duplicate = OK continuer. JAMAIS DROP/rebuild.

**§6.4 provisioning** (signature que M2 implémente, M1 l'importe) : `provisionAgencyTenant(env,{email,name,passwordHash}):Promise<{userId,agencyId,clientId}>` — `env.DB.batch([INSERT agencies(id,name,owner_id) ; INSERT clients(id,name,email,agency_id) ; INSERT users(id,email,password_hash,name,role='admin',client_id,account_level='agency',agency_id) ; INSERT user_sub_accounts(id,user_id,client_id) ; INSERT subscriptions(id,client_id,agency_id,plan_name='free',status='active')])` + compensation DELETE en catch. agencies réel = `(id,name,owner_id)` only (pas slug/plan). subscriptions.plan_name='free' (pas de CHECK réel p3_9).

**§6.5 register** : `POST /api/auth/register` publique, body `{email,password(min8),name,company?}`, succès = format IDENTIQUE finishLogin `json({success,token,must_change_password:false,user:{id,name,role:'admin',email}})`, erreurs `{error:<string>,code}` : 400 INVALID_INPUT / 409 EMAIL_TAKEN / 500 PROVISION_FAILED. `audit(env,userId,'auth.register','user',userId,{email})`.

**§6.6 hook audit** : action `'agency.subaccount.access'` (déjà dans §6.1).

**§6.7 i18n** : 2 catalogues PLAT `src/i18n/fr-CA.json`+`en.json` (PAS 4 .ts, PAS `{{var}}`), clés `auth.signup.{title,email_label,password_label,name_label,company_label,submit,email_taken,success,error}` — créées par Manager 3, M1 les LISTE seulement.

---

## Notes d'intégration M1 (pour B/C)

- **Point d'injection worker.ts** : entre `if (auth instanceof Response) return auth;` (ancien :569) et le `try { return await routeProtected(...) }`. `auth` est enrichi en `authCtx = { ...auth, clientId: tenantCtx.clientId ?? undefined, tenant: tenantCtx }` puis passé à `routeProtected`. Champ `clientId` ADDITIF (déjà typé optionnel chez handlers, cf. `leads.ts:133`). `routeProtected` param élargi additivement : `auth: { userId; role; clientId?; tenant?: TenantContext }`.
- **Switch sous-compte** : header HTTP `X-Sub-Account` (optionnel). Absent ⇒ legacy. M3 (UI) peut s'appuyer là-dessus.
- **Register** : route déclarée dans worker.ts juste après `/api/auth/login` (dynamic import `./worker/auth#handleRegister`, style identique à forgot/reset-password). `handleRegister` importe `provisionAgencyTenant` depuis `./provisioning` (fichier **créé par M2**, signature §6.4). `finishLogin` est désormais **exporté** depuis `auth.ts`.
- **RISQUE #0 traité** : seq 59 (`migration-sprintE1-m2-modules-role.sql`) reconstruit `users` en ne gardant QUE `id,email,password_hash,name,role,client_id,is_active,created_at,updated_at` → `agency_id`/`account_level`/`parent_user_id` ABSENTS après seq 59. Migration 78 les ré-ajoute, header SQL documente la tolérance « duplicate column name » (exécution best-effort statement-par-statement par Antigravity ; JAMAIS DROP/rebuild). `users.role` a un CHECK `('admin','broker','store_manager')` — register utilise `role='admin'`, conforme.
- **Rétro-compat dure** : `getClientModules` appelé SANS `ctx` = chemin legacy byte-identique (SELECT client_id FROM users). `agency_id IS NULL` + jonction vide ⇒ `clientId=users.client_id`, `agencyId=null`, comportement mono-tenant inchangé. Le résolveur ne throw jamais (tous SELECT en try/catch).

---

## §6 LOT 2

> Manager 1 (Phase A SOLO) a figé cette section. **Phase B (M2 ∥ M3) peut
> démarrer.** §6.8→§6.12 ci-dessous sont le CONTRAT : B et C codent contre
> elles sans les renégocier. Lot 2 = **0 migration** (consomme la seq 78
> figée Lot 1). Le switch DÉLÈGUE l'appartenance à `resolveTenantContext`
> (Lot 1, §6.1) — jamais réimplémentée.

**§6.8 `POST /api/account/switch`** : garde `requireAuth` (tout user authentifié). Body `{ subAccountId: string }`. Logique : `resolveTenantContext(env, auth.userId, auth.role, subAccountId)` → si `ctx.clientId === subAccountId` → 200, sinon **403 STRICT** (pas de fallback, le résolveur a IGNORÉ le switch car sous-compte non accessible). 200 `json({ data: { activeSubAccount: subAccountId, agencyId: ctx.agencyId, accessibleClientIds: ctx.accessibleClientIds } })`. 403 `json({ error: 'Sous-compte non autorisé', code: 'SUBACCOUNT_FORBIDDEN' }, 403)`. 400 body manquant/vide `json({ error: 'subAccountId requis', code: 'INVALID_INPUT' }, 400)`. **STATELESS** : aucune écriture `admin_sessions`. **Pas de double-audit** : la trace Loi 25 `'agency.subaccount.access'` est émise par le résolveur Lot 1 (best-effort), JAMAIS ré-émise ici.

**§6.9 `GET /api/agency/sub-accounts`** : garde `auth.tenant?.accountLevel === 'agency'` (lu depuis l'`authCtx` injecté worker.ts:589) **ET** `auth.tenant.agencyId` non null, sinon `403 json({ error: 'Réservé aux agences', code: 'AGENCY_ONLY' }, 403)`. `SELECT id, name, email, created_at FROM clients WHERE agency_id = ? ORDER BY created_at DESC` (agence du user). Métriques RÉELLES par sous-compte, **bornées aux ids de CETTE agence** : `SELECT client_id, COUNT(*) FROM leads WHERE client_id IN (<placeholders ids agence>) GROUP BY client_id` (idem `tasks`). Anti-bypass : si 0 sous-compte ⇒ AUCUNE requête métier émise (jamais d'`IN ()` vide ni de SELECT sans clause client_id). 200 `json({ data: [{ id, name, email, created_at, leadsCount, tasksCount }] })`.

**§6.10 `POST /api/agency/sub-accounts`** : garde idem §6.9 (`agency` + `agencyId` non null, sinon 403 `AGENCY_ONLY`). Body `{ name: string; email?: string }`, `sanitizeInput(name, 100)` + `sanitizeInput(email, 200)`, name vide → `400 { error: 'Nom requis', code: 'INVALID_INPUT' }`. Commentaire `// LOT3-QUOTA-GUARD` au point d'insertion (PAS d'enforcement Lot 2). `env.DB.batch([ INSERT clients(id, name, email, agency_id) VALUES(crypto.randomUUID(), name, email||null, auth.tenant.agencyId) ; INSERT user_sub_accounts(id, user_id, client_id) VALUES(crypto.randomUUID(), auth.userId, newClientId) ])`. Puis `audit(env, auth.userId, 'agency.subaccount.create', 'client', newClientId, { agencyId })`. 201 `json({ data: { id: newClientId } }, 201)`.

**§6.11 transport (contrat M2 — M1 ne code pas le front)** : `apiFetch` lit `localStorage.getItem('intralys_active_sub_account')` → ajoute header `X-Sub-Account: <id>` (absent ⇒ legacy). `switchSubAccount(id)` : `POST /api/account/switch` body `{ subAccountId: id }` ; sur **200** → `localStorage.setItem('intralys_active_sub_account', id)` puis recharge le contexte ; sur **403** → NE PAS persister (afficher `agencies.switch.error`). `logout`/`clearToken` retire la clé `intralys_active_sub_account`. Le résolveur worker.ts:583-588 consomme déjà `X-Sub-Account` ⇒ aucune route à câbler côté lecture.

**§6.12 i18n (contrat M3 — M1 propose FR-CA, M3 décline 4 catalogues)** : système réel = `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (PAS `src/i18n/*.json` qui est mort, Lot 4), format `{{var}}`. Clés + valeurs FR-CA proposées :

| Clé | FR-CA |
|---|---|
| `agencies.switch.label` | `Sous-compte actif` |
| `agencies.switch.placeholder` | `Choisir un sous-compte…` |
| `agencies.switch.all` | `Tous les sous-comptes` |
| `agencies.switch.error` | `Ce sous-compte n'est pas accessible.` |
| `agencies.switch.success` | `Sous-compte changé : {{name}}` |
| `agencies.law25.banner` | `Vous consultez le sous-compte « {{name}} ». Cet accès est journalisé (Loi 25).` |
| `agencies.law25.exit` | `Revenir à mon compte` |
| `agencies.kpi.leads_real` | `{{count}} prospects` |
| `agencies.kpi.tasks_real` | `{{count}} tâches` |
| `agencies.table.leads` | `Prospects` |
| `agencies.table.tasks` | `Tâches` |
| `agencies.error.load` | `Impossible de charger les sous-comptes.` |

---

## §6 LOT 3

> Manager 1 (Phase A SOLO) a figé cette section. **Phase B (M2 ∥ M3) peut
> démarrer.** §6.13→§6.17 ci-dessous sont le CONTRAT : B et C codent contre
> elles sans les renégocier. Lot 3 = **0 migration** (`subscriptions` existe
> déjà — migration_p3_9.sql:12-21). Plans EN DUR (zéro Stripe/paiement/webhook),
> niveau AGENCE. E4/E6 paiement (`billing.ts`/`payments_live_enabled`)
> INTOUCHÉ. `requireQuota` DÉLÈGUE l'appartenance agence à l'`agencyId` fourni
> par le caller (issu de `resolveTenantContext` Lot 1) — jamais réimplémentée.

**§6.13 `plans.ts` (structure)** : `export type QuotaKind = 'subAccounts' | 'leads' | 'users'`. `export interface PlanLimits { maxSubAccounts:number; maxLeads:number; maxUsers:number }`. `export const PLANS: Record<string,PlanLimits>` EN DUR : `free {2,500,3}`, `pro {10,10000,25}`, `unlimited {Infinity,Infinity,Infinity}`. `DEFAULT_PLAN='free'` (privé). `export function resolvePlan(planName?:string|null):PlanLimits` ⇒ `PLANS[(planName||'free').toLowerCase()] ?? PLANS.free` (plan inconnu/null/absent ⇒ `free` ; `subscriptions.plan_name` n'a **PAS** de CHECK en base réelle p3_9, tout doit être toléré).

**§6.14 `requireQuota` (signature + comportement EXACT, calque `requireModule` modules.ts:132-151)** : `export async function requireQuota(env:Env, agencyId:string|null|undefined, kind:QuotaKind):Promise<Response|null>`. `return null` = autorisé (caller continue) ; `return json(...,403)` = bloqué (caller `return guard`). Étapes verrouillées :
1. **Garde-fou #1 ABSOLU** : `agencyId` falsy (`null`/`undefined`/`''`) ⇒ `return null` IMMÉDIAT, **AVANT toute requête D1** (flux legacy non-agence JAMAIS bloqué, **0 requête émise**, byte-identique au comportement actuel).
2. `SELECT plan_name FROM subscriptions WHERE agency_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1` en try/catch ⇒ erreur ⇒ `return null` (best-effort, jamais throw/500).
3. `limits = resolvePlan(row?.plan_name)` (abonnement absent ⇒ `free`). Si la limite du `kind` est `Infinity` (`!Number.isFinite`) ⇒ `return null` **SANS émettre de COUNT**.
4. COUNT borné agence en try/catch (erreur ⇒ `return null`) : `subAccounts` = `SELECT COUNT(*) FROM clients WHERE agency_id = ?` ; `leads` = `SELECT COUNT(*) FROM leads WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ?)` ; `users` = `SELECT COUNT(*) FROM user_sub_accounts WHERE client_id IN (SELECT id FROM clients WHERE agency_id = ?)`.
5. `count >= limit` ⇒ `return json({ error:<msg FR en dur>, code:'QUOTA_EXCEEDED', kind, limit, current:count }, 403)` ; sinon `return null`. `>=` (pas `>`) car la garde s'exécute **AVANT l'INSERT**. Le message 403 est FR québécois **EN DUR** dans `plans.ts` (forme `Quota atteint pour le plan « <plan> » (<kind FR> : <limit> max).` — `<kind FR>` = sous-comptes/prospects/utilisateurs), **PAS via t()** côté worker (aucun i18n côté Worker, même convention que modules.ts:142).

**§6.15 `GET /api/agency/plan` (contrat M2 — M1 ne code pas la route)** : garde **IDENTIQUE §6.9** (`auth.tenant?.accountLevel === 'agency'` **ET** `auth.tenant.agencyId` non null, sinon `403 json({ error:'Réservé aux agences', code:'AGENCY_ONLY' }, 403)`). Lit le plan via le même SELECT que §6.14 étape 2 (`resolvePlan` pour les limites) + 3 COUNT bornés agence (mêmes SQL que §6.14 étape 4). Réponse 200 : `json({ data: { plan:<string plan_name||'free'>, limits:{ maxSubAccounts, maxLeads, maxUsers }, usage:{ subAccounts:<n>, leads:<n>, users:<n> } } })`. **Sérialisation `Infinity`** : `Infinity` n'est PAS JSON-valide ⇒ M2 le mappe vers `null` dans le JSON (`limits.maxX === Infinity ? null : maxX`) ; l'UI (M3) interprète `null` = illimité. Route déclarée dans worker.ts près de :1113-1116 (style identique aux routes `/api/agency/*` du Lot 2, dynamic import). Best-effort : panne D1 ⇒ usage à 0 plutôt que 500.

**§6.16 points d'insertion enforcement (contrat M2 — M1 ne touche PAS saas.ts/leads.ts/worker.ts)** :
- **Sous-comptes** : `src/worker/saas.ts:210`, commentaire existant `// LOT3-QUOTA-GUARD` (déjà posé Lot 2, APRÈS la validation `name` :206-208, AVANT `const newClientId = crypto.randomUUID()` :212). M2 insère : `const q = await requireQuota(env, auth.tenant?.agencyId, 'subAccounts'); if (q) return q;`. `auth.tenant.agencyId` est déjà en scope ici (garde §6.10 garantit `agency` + `agencyId` non null ⇒ quota toujours évalué pour une agence).
- **Leads** : `src/worker/leads.ts` `handleCreateLead` (:510). Le SELECT client existant ligne **534** = `SELECT id FROM clients WHERE id = ? AND is_active = 1` → M2 l'**élargit** en `SELECT id, agency_id FROM clients WHERE id = ? AND is_active = 1`. Guard inséré **APRÈS** le `if (!client) return json({ error:'Client introuvable' }, 404)` (:535) et **AVANT** l'`INSERT INTO leads` (:543) : `const q = await requireQuota(env, (client as { agency_id?: string|null }).agency_id, 'leads'); if (q) return q;`. **Rétro-compat dure** : un client sans agence (`agency_id` NULL ⇒ legacy mono-tenant) ⇒ `requireQuota` retourne `null` immédiatement (garde-fou #1) ⇒ `handleCreateLead` **byte-identique** au comportement actuel (0 requête quota, 0 blocage).
- **Users** : **lecture seule, AUCUN blocage Lot 3**. Le quota `users` est exposé en lecture via `GET /api/agency/plan` (§6.15 usage) mais n'est **pas** enforced sur une route de création (pas de point d'insertion `requireQuota(...,'users')` côté write). `requireQuota` supporte `kind:'users'` (utilisable plus tard) mais aucun handler ne l'appelle en write au Lot 3.

**§6.17 i18n (contrat M3 — M1 propose FR-CA, M3 décline les 4 catalogues)** : système réel = `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (PAS `src/i18n/*.json` mort), format `{{var}}`. Namespace **distinct** de l'existant `set.billing.*` (E4/E6 paiement, INTOUCHÉ). Clés + FR-CA proposées (le message 403 worker reste FR en dur §6.14 ; ces clés sont pour l'UI plan/quota M3 côté front uniquement) :

| Clé | FR-CA |
|---|---|
| `billing.plan.title` | `Votre plan` |
| `billing.plan.current` | `Plan actuel : {{plan}}` |
| `billing.plan.free` | `Gratuit` |
| `billing.plan.pro` | `Pro` |
| `billing.plan.unlimited` | `Illimité` |
| `billing.plan.usage` | `Utilisation` |
| `billing.plan.unlimited_value` | `Illimité` |
| `billing.quota.subAccounts` | `Sous-comptes` |
| `billing.quota.leads` | `Prospects` |
| `billing.quota.users` | `Utilisateurs` |
| `billing.quota.of` | `{{current}} / {{limit}}` |
| `billing.quota.exceeded` | `Quota atteint pour le plan « {{plan}} » ({{kind}} : {{limit}} max).` |
| `billing.error.load` | `Impossible de charger les informations du plan.` |

---

## §6 LOT 4

> Manager 1 (Phase A SOLO) a figé cette section. **Phase B (M2 ∥ M3) peut
> démarrer.** §6.18→§6.21 ci-dessous sont le CONTRAT : B et C codent contre
> elles sans les renégocier. **Lot 4 = 0 migration, 0 backend** (`handleRegister`
> + route register figés Lot 1 §6.5, `/api/agency/plan` figé Lot 3 §6.15 —
> consommés tels quels). Système i18n réel = `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`
> (format `{{var}}`). `src/i18n/*.json` sont MORTS/INERTES (0 importeur runtime,
> vérifiés par `lot1-isolation-regression.test.ts:224-261`) — NE PAS toucher.
> Clé plate existante `'auth.signup'` (libellé court `"S'inscrire"`) ≠
> `'auth.signup.title'` : namespaces distincts, aucune collision, NON touchée.
>
> **Écart CODE > mémoire** : la « table §6.18 du Chaman » référencée par le brief
> M1 n'était PAS présente dans ce doc au moment de l'exécution Phase A. M1 a
> donc rédigé les valeurs des 18 clés ×4 langues d'après la spec du brief
> (fr-CA québécois tutoiement / fr-FR vouvoiement / en / es), le contrat register
> §6.5/§6.20 et la voix des blocs `auth.*`/`onboarding.*` existants. Les tables
> §6.18/§6.19 ci-dessous SONT la source de vérité figée (verbatim du code écrit).

**§6.18 — 14 clés `auth.signup.*` (libellés statiques, zéro `{{var}}`)** — insérées après `'auth.remember_me'` dans les 4 catalogues (additif, ordre & clés existantes inchangés) :

| Clé | FR-CA (tu) | FR-FR (vous) | EN | ES |
|---|---|---|---|---|
| `auth.signup.title` | `Crée ton compte Intralys` | `Créez votre compte Intralys` | `Create your Intralys account` | `Cree su cuenta Intralys` |
| `auth.signup.subtitle` | `Lance ton agence en quelques secondes.` | `Lancez votre agence en quelques secondes.` | `Launch your agency in seconds.` | `Lance su agencia en segundos.` |
| `auth.signup.email_label` | `Adresse courriel` | `Adresse e-mail` | `Email address` | `Correo electrónico` |
| `auth.signup.password_label` | `Mot de passe` | `Mot de passe` | `Password` | `Contraseña` |
| `auth.signup.password_hint` | `Au moins 8 caractères.` | `Au moins 8 caractères.` | `At least 8 characters.` | `Al menos 8 caracteres.` |
| `auth.signup.name_label` | `Ton nom` | `Votre nom` | `Your name` | `Su nombre` |
| `auth.signup.company_label` | `Nom de ton agence (optionnel)` | `Nom de votre agence (facultatif)` | `Agency name (optional)` | `Nombre de su agencia (opcional)` |
| `auth.signup.submit` | `Créer mon compte` | `Créer mon compte` | `Create my account` | `Crear mi cuenta` |
| `auth.signup.have_account` | `Tu as déjà un compte ?` | `Vous avez déjà un compte ?` | `Already have an account?` | `¿Ya tiene una cuenta?` |
| `auth.signup.email_taken` | `Ce courriel est déjà utilisé.` | `Cet e-mail est déjà utilisé.` | `This email is already in use.` | `Este correo ya está en uso.` |
| `auth.signup.invalid` | `Vérifie les champs : courriel valide et mot de passe d’au moins 8 caractères.` | `Vérifiez les champs : e-mail valide et mot de passe d’au moins 8 caractères.` | `Check the fields: a valid email and a password of at least 8 characters.` | `Verifique los campos: un correo válido y una contraseña de al menos 8 caracteres.` |
| `auth.signup.success` | `Compte créé. Bienvenue !` | `Compte créé. Bienvenue !` | `Account created. Welcome!` | `Cuenta creada. ¡Bienvenido!` |
| `auth.signup.error` | `Création du compte impossible. Réessaye plus tard.` | `Création du compte impossible. Réessayez plus tard.` | `Could not create the account. Please try again later.` | `No se pudo crear la cuenta. Inténtelo más tarde.` |
| `auth.signup.create_link` | `Créer un compte` | `Créer un compte` | `Create an account` | `Crear una cuenta` |

**§6.19 — 4 clés `onboarding.agency.*`** — insérées après `'onboarding.complete.success'` dans les 4 catalogues. Interpolation réelle `{{subAccounts}}` + `{{leads}}` dans `onboarding.agency.plan` UNIQUEMENT (parité placeholders STRICTE) :

| Clé | FR-CA (tu) | FR-FR (vous) | EN | ES |
|---|---|---|---|---|
| `onboarding.agency.welcome` | `Bienvenue dans ton espace agence` | `Bienvenue dans votre espace agence` | `Welcome to your agency workspace` | `Bienvenido a su espacio de agencia` |
| `onboarding.agency.subaccounts` | `Gère tous tes clients depuis des sous-comptes séparés.` | `Gérez tous vos clients depuis des sous-comptes séparés.` | `Manage all your clients from separate sub-accounts.` | `Gestione todos sus clientes desde subcuentas separadas.` |
| `onboarding.agency.plan` | `Ton plan inclut {{subAccounts}} sous-comptes et {{leads}} prospects.` | `Votre plan inclut {{subAccounts}} sous-comptes et {{leads}} prospects.` | `Your plan includes {{subAccounts}} sub-accounts and {{leads}} leads.` | `Su plan incluye {{subAccounts}} subcuentas y {{leads}} prospectos.` |
| `onboarding.agency.cta` | `Configurer mon agence` | `Configurer mon agence` | `Set up my agency` | `Configurar mi agencia` |

Parité : exactement les **18 clés** ci-dessus dans les 4 catalogues, mêmes placeholders (`onboarding.agency.plan` → `{{subAccounts}}` + `{{leads}}` ; toutes les autres = zéro placeholder). Vérifiée par `src/worker/__tests__/lot4-i18n-signup.test.ts`.

**§6.20 — contrat écran signup (M2)** :
- Route `/signup` **publique** : calque exact de `loginRoute` (App.tsx:140-144) — route non gardée par l'auth guard, accessible déconnecté.
- Composant `src/pages/Signup.tsx` : calque `Login.tsx` (même structure carte/champs/erreurs/i18n). Champs : email, password, name, company (optionnel). Textes via `t('auth.signup.*')`.
- Fonction `register()` **additive** dans `api.ts` : calque `login()` (api.ts:122-156). `POST /auth/register` via `apiFetch`, body `{ email, password, name, company? }` (conforme §6.5 / `registerSchema` auth.ts:140-150 : password min 8, name requis, company optionnelle).
- **Succès** (réponse format finishLogin §6.5 : `{success,token,must_change_password:false,user:{id,name,role:'admin',email}}`) → `setToken(token)` + `localStorage.setItem('intralys_user', JSON.stringify(user))` + `window.location.assign('/dashboard')` (**full reload** pour réhydrater AuthProvider — **PAS** `navigate()` SPA, **PAS** toucher `auth.tsx`/`login()`).
- **Mapping erreurs** (réponse `{error,code}`) : `409 EMAIL_TAKEN` → `auth.signup.email_taken` ; `400 INVALID_INPUT` → `auth.signup.invalid` ; `500 PROVISION_FAILED` / erreur réseau / autre → `auth.signup.error`.
- Liens croisés : Login affiche un lien vers `/signup` (`auth.signup.create_link`) ; Signup affiche un lien retour vers `/login` (`auth.signup.have_account`).
- M2 NE touche PAS : `auth.tsx`, `login()`, le moteur i18n, les catalogues (figés par M1 §6.18/§6.19).

**§6.21 — contrat onboarding agence (M3)** :
- Encart **conditionnel** `isAgency`, détecté en **best-effort** via `GET /api/agency/plan` (route figée Lot 3 §6.15) : réponse **200** = agence ⇒ afficher l'encart ; **403 `AGENCY_ONLY`** / toute erreur / panne ⇒ **PAS d'encart** = chemin legacy **byte-identique** (rétro-compat S8 stricte).
- Rendu **EN HAUT** de l'étape `profile` (ou `team`) du `WelcomeWizard` — **PAS une étape obligatoire** : les 4 étapes CRM figées (profile/industry/goals/team) restent **intouchées**, l'encart est un bloc additif non bloquant.
- Textes : `onboarding.agency.welcome` / `.subaccounts` / `.plan` / `.cta`. Valeurs d'interpolation de `.plan` : `data.limits.maxSubAccounts` → `{{subAccounts}}`, `data.limits.maxLeads` → `{{leads}}` (issus de la réponse `/api/agency/plan` §6.15 ; `null` JSON = illimité côté UI, M3 affiche un libellé « illimité » au choix sans nouvelle clé hors §6.19).
- Best-effort **jamais bloquant** : si l'appel échoue/timeout, le wizard se comporte exactement comme aujourd'hui (aucune régression S8). M3 NE touche PAS le moteur i18n ni les catalogues.

**Rappel INTERDITS Lot 4** : 🚫 `src/i18n/*.json` (morts inertes — le test isolation Lot 1 les vérifie) · `src/lib/i18n.ts` / `src/lib/i18n/index.ts` (moteur figé — QUE des clés aux 4 catalogues `.ts`) · clé plate `'auth.signup'` existante · `lot1-isolation-regression.test.ts` · fichiers M2 (`Signup.tsx`/`api.ts`/`App.tsx`/`Login.tsx`) & M3 (`WelcomeWizard.tsx`) hors leurs phases · `auth.tsx`/`login()` · 6 pages R · E4/E6 · helpers figés · migrations 1-78 (**0 migration Lot 4**) · `mockData` · `wrangler.jsonc` · `src/worker/**` (**Lot 4 = 0 backend**) · §6 Lot 1-3 de ce doc (append-only).

**§6 LOT 4 FIGÉ → Phase B (M2 ∥ M3) peut démarrer.**
