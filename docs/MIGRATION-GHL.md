# Guide de Migration GoHighLevel (GHL) vers Intralys

Ce document décrit le fonctionnement et l'utilisation de l'outil de migration hybride (CSV + API OAuth) intégré dans Intralys CRM. Cet outil a été développé lors du **Sprint 14**.

## Approche Hybride

Intralys propose deux méthodes de migration qui peuvent être utilisées séparément ou combinées :
1. **Import CSV (Offline)** : Recommandé pour des imports ponctuels ou massifs de contacts purs.
2. **Import API (OAuth)** : Recommandé pour une reprise complète (Contacts, Conversations, Opportunités, Calendriers).

L'outil garantit une **idempotence absolue** : vous pouvez relancer une migration 10 fois, aucun doublon ne sera créé.

---

## 1. Prérequis (Configuration)

Pour utiliser la migration API, votre instance Cloudflare Workers (`intralys-dashboard`) doit posséder ces variables d'environnement (secrets) :
- `GHL_CLIENT_ID` : L'ID de votre application GHL Marketplace.
- `GHL_CLIENT_SECRET` : Le secret de l'application GHL.
- `GHL_REDIRECT_URI` : URL de callback exacte (ex: `https://intralys-api.com/api/migration/ghl/oauth/callback`).

*Note : Ces identifiants se trouvent dans votre GHL Marketplace Dashboard.*

---

## 2. Implémentation de l'Idempotence (Anti-Doublons)

Toutes les importations (CSV et API) passent par une table centrale : `migration_id_map`.

**Clé Unique :**
`(client_id, intralys_resource, external_source, external_id)`

- `intralys_resource` : `lead`, `conversation`, `message`, `pipeline`, `appointment`, `calendar`
- `external_source` : `ghl_csv` ou `ghl` (API)
- `external_id` : L'ID distant (ex: ID du contact GHL, ou l'email/téléphone pour le CSV)

Lorsqu'un enregistrement est importé, son ID GHL est lié à son ID Intralys. Si le script rencontre le même ID GHL lors d'un run ultérieur, la ligne est ignorée (ou mise à jour, selon la ressource).

---

## 3. Flow de Migration API (OAuth)

### A. Connexion OAuth
1. L'admin déclenche `GET /api/migration/ghl/oauth/start?client_id=...`
2. Il est redirigé vers la mire GHL. Il choisit le sous-compte (Location).
3. GHL redirige vers le `/callback` avec un code.
4. Intralys stocke le `access_token` et `refresh_token` dans la table `ghl_tokens`.

### B. Lancement du Run
1. L'admin appelle `POST /api/migration/ghl/api/run` avec `{ client_id, scopes: ['contacts', 'conversations', 'opportunities', 'calendars'] }`.
2. Le Worker crée une `migration_sessions` (statut = `running`) et rend la main immédiatement (réponse 200).
3. Un job asynchrone (`ctx.waitUntil`) s'exécute en arrière-plan.

### C. Reprise Pagée (Resumable State)
Comme Cloudflare Workers limite le temps CPU, le job peut être suspendu par la plateforme.
- À chaque page récupérée depuis GHL (par lots de 100), la session met à jour `current_phase` (ex: `contacts`) et `current_cursor`.
- Un Cron (exécuté toutes les 5 mins) repère les sessions `running` inactives depuis 30 minutes et les marque comme `failed`.
- L'admin peut rappeler `/run` : le script reprendra exactement à `current_phase` et `current_cursor` sans perte.

---

## 4. Flow de Migration CSV

### A. Preview (Dry-Run)
- Appel : `POST /api/migration/ghl/csv/preview`
- Fournit une vue d'ensemble : total de lignes, doublons d'emails anticipés, détection automatique des colonnes (GHL standards) et détection de champs personnalisés.
- Ne modifie pas la base de données.

### B. Exécution
- Appel : `POST /api/migration/ghl/csv/run`
- Mêmes mécanismes que l'API : création de session de migration pour suivi des erreurs.
- Les champs non reconnus (ex: `Mon Champ`) déclenchent la **création à la volée** de `custom_field_defs` (`slug = cf_mon_champ`) et l'insertion des valeurs dans `custom_field_values`.

---

## 5. Limitations Actuelles et Roadmap

Conformément aux directives Intralys (V1 MVP) :
- **Exclus** : Workflows (Automations), Formulaires (définitions), Notes, Fichiers attachés (Files). Ces éléments seront réévalués en V2 si un besoin client réel se présente.
- **Limitation d'opportunités** : GHL permet qu'un contact ait plusieurs opportunités. Les mappers Intralys actuels lient l'état global du contact (`status`, `deal_value`) selon la dernière opportunité traitée.

---

## 6. Endpoints de Suivi

Les administrateurs peuvent suivre l'état de la migration avec :
- `GET /api/migration/sessions/:id` : Pour connaître le statut (`running`, `completed`, `failed`), le nombre d'imports et d'erreurs.
- `GET /api/migration/sessions/:id/errors` : Retourne un tableau JSON listant les causes précises des rejets ligne par ligne.
