# Outlook OAuth Setup — Sprint 33

> Guide d'installation Azure pour activer l'intégration Microsoft Outlook / Microsoft 365 Calendar dans Intralys.
> Compagnon : `LOT-CALENDAR-SYNC-S33.md` (contrat §6 figé), `BINDINGS-SECRETS-S10.md` §« Sprint 33 — Calendar Sync bindings ».
> Prérequis : compte Microsoft 365 Business ou Azure AD (perso `outlook.com` accepté pour test, multi-tenant production = recommandé).

---

## §1. Créer une app Azure AD

1. Aller sur [https://portal.azure.com](https://portal.azure.com) et se connecter avec un compte admin Azure / M365.
2. Naviguer : **Azure Active Directory** → **App registrations** → **+ New registration** (bouton en haut).
3. Remplir le formulaire :
   - **Name** : `Intralys Calendar Sync` (sera visible par l'utilisateur final lors du consentement OAuth).
   - **Supported account types** :
     - Recommandé : **Accounts in any organizational directory (Any Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)** — permet à n'importe quel utilisateur M365 OU compte Microsoft perso (outlook.com, hotmail.com, live.com) de se connecter sans rebuild de l'app par tenant.
     - Single-tenant : si l'app doit servir uniquement les utilisateurs d'une organisation M365 spécifique (cas où Intralys déploie une instance dédiée pour un client enterprise), choisir **Accounts in this organizational directory only**.
   - **Redirect URI** : choisir type **Web**, valeur : `https://app.intralys.io/api/oauth/outlook/callback`
     - (Voir §2 pour ajout des autres redirect URIs après création.)
4. Cliquer **Register**.
5. Noter le **Application (client) ID** affiché sur la page Overview (UUID format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) → ce sera `MS_OAUTH_CLIENT_ID`.
6. Noter le **Directory (tenant) ID** affiché également sur Overview → utile pour single-tenant (`MS_OAUTH_TENANT`). Pour multi-tenant, utiliser la valeur littérale `common` à la place du tenant ID.

---

## §2. Configurer les redirect URIs

1. Sur la page de l'app, menu gauche → **Authentication**.
2. Section **Platform configurations** → si **Web** n'existe pas, cliquer **+ Add a platform** → **Web**.
3. Section **Redirect URIs**, ajouter (cliquer **Add URI** pour chaque) :
   - `https://app.intralys.io/api/oauth/outlook/callback` (production)
   - `http://localhost:8787/api/oauth/outlook/callback` (dev local wrangler)
   - `http://localhost:5173/api/oauth/outlook/callback` (dev local Vite si proxy vers worker)
   - Optionnel staging : `https://staging.intralys.io/api/oauth/outlook/callback`
4. Section **Implicit grant and hybrid flows** : **NE PAS** cocher `Access tokens` ni `ID tokens` (on utilise authorization code flow + PKCE-like via state KV, pas implicit).
5. Section **Advanced settings** :
   - **Allow public client flows** : **No** (on a un confidential client avec secret côté worker).
   - **Supported account types** : refléter le choix §1.
6. Cliquer **Save** en haut.

---

## §3. Configurer les API permissions

1. Menu gauche → **API permissions**.
2. Par défaut, `Microsoft Graph > User.Read` est déjà présent (delegated). Garder cette permission.
3. Cliquer **+ Add a permission** → **Microsoft Graph** → **Delegated permissions** (pas Application).
4. Rechercher et cocher :
   - **Calendars.ReadWrite** (catégorie Calendars) — lecture + écriture + suppression des événements du calendrier de l'utilisateur connecté.
   - **offline_access** (catégorie OpenId permissions) — autorise la délivrance d'un `refresh_token` (sinon le `access_token` expire après 1h sans renouvellement possible).
   - **User.Read** (catégorie User) — déjà présent par défaut, sert à récupérer `email` + `id` de l'utilisateur via `GET /me`.
5. Cliquer **Add permissions** en bas.
6. Vérifier que les 3 permissions affichent **Status** vide (= pas d'admin consent requis pour `Calendars.ReadWrite` en delegated + `offline_access` + `User.Read` sur la plupart des tenants).
7. Si l'organisation M365 cible exige admin consent (cas enterprise stricte) → voir §6 ci-dessous.

**Permissions résultantes** (delegated, scope OAuth):
```
https://graph.microsoft.com/Calendars.ReadWrite
https://graph.microsoft.com/User.Read
offline_access
```

---

## §4. Generate client secret

1. Menu gauche → **Certificates & secrets** → onglet **Client secrets**.
2. Cliquer **+ New client secret**.
3. Description : `Intralys Calendar Sync — production` (ou `staging`, `dev` selon environnement).
4. **Expires** : choisir **24 months** (recommandé — éviter `Never` qui n'existe plus depuis 2021 et oblige rotation max 24 mois Azure policy).
5. Cliquer **Add**.
6. **Copier IMMÉDIATEMENT la valeur du secret** affichée dans la colonne **Value** (PAS la colonne `Secret ID` !) — cette valeur n'est affichée **qu'une seule fois**, plus jamais récupérable ensuite. Format : `abc~XyZ...` (~40 chars alphanumeric).
7. Coller cette valeur dans le secret store Cloudflare Worker :

```bash
wrangler secret put MS_OAUTH_CLIENT_SECRET
# Coller la valeur quand prompted, puis Enter
```

8. (Pour staging/dev local) ajouter aussi dans `.dev.vars` :
```
MS_OAUTH_CLIENT_SECRET=abc~XyZ...
```
9. Noter la date d'expiration dans `BINDINGS-SECRETS-S10.md` ou un calendrier admin pour rotation (alerte T-30 jours avant expiration).

---

## §5. Tenant — `'common'` vs tenant ID spécifique

Le choix du `tenant` dans les URLs OAuth (`https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`) détermine quels comptes peuvent se connecter :

| Valeur `MS_OAUTH_TENANT` | Comportement |
|---|---|
| `common` | **Multi-tenant + comptes personnels Microsoft** (outlook.com, hotmail.com, live.com). Recommandé pour Intralys multi-client. |
| `organizations` | Multi-tenant **mais uniquement** comptes work/school M365 (pas de personnels). |
| `consumers` | Uniquement comptes personnels Microsoft (outlook.com etc.), pas M365. |
| `{tenant-id}` (UUID format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) | Single-tenant — uniquement les utilisateurs de cette organisation M365 spécifique. Cas usage : déploiement Intralys dédié à un client enterprise. |
| `{tenant-name}.onmicrosoft.com` | Single-tenant via nom de domaine M365 (ex : `acmecorp.onmicrosoft.com`). Équivalent au UUID. |

**Recommandation Intralys** : `MS_OAUTH_TENANT=common` (default si non défini dans `wrangler.jsonc` `"vars"`).

Configuration côté worker `wrangler.jsonc` :
```json
"vars": {
  "MS_OAUTH_TENANT": "common"
}
```

Override par client enterprise (si tenant Intralys dédié) :
```bash
wrangler secret put MS_OAUTH_TENANT
# Coller le tenant UUID ou nom de domaine
```

> **Cohérence §1** : le choix de `tenant` dans les URLs OAuth doit être compatible avec le `Supported account types` configuré sur l'app Azure (§1). Si l'app est single-tenant (`Accounts in this organizational directory only`) → `MS_OAUTH_TENANT` doit valoir le UUID de ce tenant, pas `common` (sinon erreur `AADSTS50194: Application is not configured as a multi-tenant application`).

---

## §6. Admin consent (si requis par l'organisation M365 cible)

Certaines organisations M365 exigent l'**admin consent** pour toute app tierce demandant des permissions Microsoft Graph, même delegated (politique tenant `Block users from consenting to apps`). Dans ce cas, le flow OAuth utilisateur retourne erreur `AADSTS65001: The user or administrator has not consented to use the application`.

**Workaround** : faire valider l'app par un admin M365 du tenant cible une fois pour toutes les permissions, après quoi les utilisateurs finaux n'auront plus de consentement à donner.

Lien direct admin consent (à envoyer à l'admin M365 du tenant client) :

```
https://login.microsoftonline.com/{tenant}/adminconsent?client_id={client_id}&redirect_uri={redirect_uri}&state=admin_consent
```

Où :
- `{tenant}` = tenant ID du client (UUID) OU `common` (multi-tenant).
- `{client_id}` = `MS_OAUTH_CLIENT_ID` (Application ID Azure).
- `{redirect_uri}` = URL de retour après admin consent (réutiliser `https://app.intralys.io/api/oauth/outlook/callback` ou page custom `/settings/integrations/outlook/admin-consent-success`).

Exemple concret :
```
https://login.microsoftonline.com/acmecorp.onmicrosoft.com/adminconsent?client_id=12345678-abcd-efgh-ijkl-9876543210mn&redirect_uri=https%3A%2F%2Fapp.intralys.io%2Fapi%2Foauth%2Foutlook%2Fcallback&state=admin_consent
```

Après que l'admin a cliqué le lien + s'est authentifié + a accepté → le tenant M365 sera marqué comme ayant consenti à l'app, et tous les utilisateurs de ce tenant pourront se connecter via le flow user standard sans consentement individuel.

> **Note** : pour Intralys multi-tenant en production, l'admin consent n'est pas obligatoire par défaut. Il devient nécessaire UNIQUEMENT si le client final reporte l'erreur `AADSTS65001`. Documenter ce cas dans la KB client `kb_articles` (Sprint helpdesk-seq89) avec le template du lien admin consent à personnaliser.

---

## §7. Variables d'environnement requises

Configurer les 3 bindings côté Cloudflare Worker (cf. `BINDINGS-SECRETS-S10.md` §« Sprint 33 ») :

```bash
# Production worker
wrangler secret put MS_OAUTH_CLIENT_ID
# Coller la valeur Application (client) ID (§1.5)

wrangler secret put MS_OAUTH_CLIENT_SECRET
# Coller la valeur du secret (§4.6)

# MS_OAUTH_TENANT : recommandé en var (pas secret) si valeur = 'common'
# Modifier wrangler.jsonc → "vars": { "MS_OAUTH_TENANT": "common" }
# OU pour single-tenant override :
wrangler secret put MS_OAUTH_TENANT
# Coller le UUID tenant ou {nom}.onmicrosoft.com
```

Pour `.dev.vars` (dev local) :
```
MS_OAUTH_CLIENT_ID=12345678-abcd-efgh-ijkl-9876543210mn
MS_OAUTH_CLIENT_SECRET=abc~XyZ...
MS_OAUTH_TENANT=common
```

Vérification post-configuration :
```bash
wrangler secret list
# Doit afficher : MS_OAUTH_CLIENT_ID, MS_OAUTH_CLIENT_SECRET (et MS_OAUTH_TENANT si secret)
```

Si l'un des 3 secrets est absent → l'endpoint `GET /api/oauth/outlook/authorize` retourne `400 { error: 'outlook OAuth non configuré' }` (calque Sprint G4/GBP, PAS 500).

---

## §8. Test end-to-end

Une fois Azure app créée + secrets configurés + worker déployé (`wrangler deploy`) :

1. Naviguer sur `https://app.intralys.io/settings/integrations/calendar-sync`.
2. Cliquer le bouton **Connecter Outlook**.
3. Le browser redirige vers `https://app.intralys.io/api/oauth/outlook/authorize` → puis 302 vers `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=...&redirect_uri=...&scope=...&response_type=code&state=...`.
4. Sur la page Microsoft :
   - Si déjà connecté à un compte M365/Outlook dans le navigateur → choisir le compte ou cliquer `Utiliser un autre compte`.
   - Sinon → se connecter avec un compte M365 / outlook.com de test.
5. Écran de **consentement** affiche :
   - `Intralys Calendar Sync` voudrait :
     - Lire et écrire dans vos calendriers (Calendars.ReadWrite)
     - Maintenir l'accès aux données auxquelles vous lui avez donné accès (offline_access)
     - Vous connecter et lire votre profil (User.Read)
   - Cliquer **Accept**.
6. Microsoft redirige vers `https://app.intralys.io/api/oauth/outlook/callback?code=...&state=...`.
7. Le worker :
   - Vérifie `state` KV → OK.
   - Échange `code` contre `access_token + refresh_token` via POST `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`.
   - Récupère `email + id` via `GET https://graph.microsoft.com/v1.0/me`.
   - Upsert `oauth_connections (client_id, provider='outlook', account_email, encrypted_access_token, encrypted_refresh_token, expires_at, status='active')`.
   - Redirect navigateur vers `/settings/integrations/calendar-sync?connected=outlook`.
8. La page front re-fetch `GET /api/calendar/connections` → affiche le badge `Connecté en tant que rochdi@example.onmicrosoft.com` + bouton `Déconnecter`.
9. Cliquer **Liste des calendriers Outlook** (selector) → vérifier qu'au moins `Calendar` (primary) apparaît + tout calendrier custom créé dans Outlook.
10. Créer un mapping `Calendar` (Outlook) ↔ `Calendrier test` (Intralys) avec `sync_direction=bidirectional` → vérifier création du webhook subscription (POST `https://graph.microsoft.com/v1.0/subscriptions` avec validation handshake `validationToken`).
11. Suivre les étapes 5-12 du **Plan validation** dans `LOT-CALENDAR-SYNC-S33.md` pour valider push/pull/conflict/disconnect.

---

## Annexe — Erreurs courantes

| Erreur | Cause | Fix |
|---|---|---|
| `AADSTS50011: The redirect URI ... does not match` | Redirect URI dans la requête ≠ ceux configurés §2 | Re-vérifier que l'URI EXACTE (avec scheme http/https, port, path) est listée dans Authentication → Web → Redirect URIs |
| `AADSTS65001: The user or administrator has not consented` | Tenant M365 bloque consentement user | Demander admin consent via §6 lien direct |
| `AADSTS70011: The provided value for scope is invalid` | Scope mal formaté | Vérifier `scope=https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access` (URLs complètes + offline_access en clair) |
| `invalid_client: AADSTS7000215` | Secret expiré ou mauvaise valeur | Régénérer le secret §4, mettre à jour `wrangler secret put MS_OAUTH_CLIENT_SECRET` |
| `AADSTS50194: Application not configured as multi-tenant` | App single-tenant + `MS_OAUTH_TENANT=common` | Soit changer §1 supported account types en multi-tenant, soit changer `MS_OAUTH_TENANT` en UUID tenant |
| Webhook subscription POST retourne `Webhook validation request failed` | Worker pas réachable publiquement OU validation handshake ne répond pas le `validationToken` dans les 10s | Vérifier que `/api/webhooks/calendar-sync/outlook` est PUBLIC (hors `requireAuth`) ET répond `validationToken` en `text/plain 200 OK` quand `?validationToken=...` présent |
| `Subscription expirationDateTime is too far in the future` | MS Graph limite expiration à ~4230 minutes (≈3 jours) | Renewal cron toutes les 6h, expiration max `now() + 3 days - 1h` |

---

## Cross-references

- `LOT-CALENDAR-SYNC-S33.md` — contrat §6 figé Sprint 33 (handlers, helpers, engine, routes)
- `BINDINGS-SECRETS-S10.md` §« Sprint 33 — Calendar Sync bindings » — inventaire `MS_OAUTH_*` + `GCAL_SYNC_OAUTH_*`
- `LOT-OAUTH-G4.md` — pattern OAuth générique réutilisé (state KV, encryptToken)
- `SECRET-STORE-S7.md` — `TOKEN_KEY` AES-GCM (chiffrement refresh_token Microsoft)
- Documentation Microsoft Graph : [https://learn.microsoft.com/en-us/graph/auth-v2-user](https://learn.microsoft.com/en-us/graph/auth-v2-user)
- Documentation Microsoft Graph Calendars : [https://learn.microsoft.com/en-us/graph/api/resources/calendar](https://learn.microsoft.com/en-us/graph/api/resources/calendar)
- Documentation Microsoft Graph Subscriptions : [https://learn.microsoft.com/en-us/graph/api/resources/subscription](https://learn.microsoft.com/en-us/graph/api/resources/subscription)
