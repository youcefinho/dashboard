# Compliance GBP — Sprint 32

> Cartographie des flux de données entre Intralys et Google Business Profile (GBP) pour conformité Loi 25 (Québec) + RGPD (EU).
> Date : 2026-05-24. Version : 1.0. Sprint : 32.
> Calque la structure de `docs/STRIPE-DATA-FLOW.md` (Sprint 31).

## §1 Data residency

- **Google Cloud Platform** : datacenters US + EU (Google Business Profile API hébergée principalement aux USA, certains workloads UE).
- **Intralys D1** : Cloudflare D1 (région principale Amérique du Nord, éventuellement réplique EU).
- **Tokens OAuth (access + refresh)** : stockés dans `oauth_connections` (seq95), **chiffrés AES-GCM** côté Worker avant insertion D1 (clé `OAUTH_TOKEN_KEK` env secret).
- **Transfert transfrontalier** : USA via Google. Encadré par **DPA Google Cloud** (Article 28 RGPD + clauses contractuelles type Commission EU).
- **Loi 25 art. 17** : transfert hors-Québec autorisé via évaluation des facteurs (faite via DPA Google + chiffrement at-rest tokens).

## §2 Données partagées avec Google

### 2.1 Tokens OAuth (chiffrés D1)
- `access_token` : court terme (~1h), refresh automatique côté Worker.
- `refresh_token` : long terme, **chiffré AES-GCM** dans `oauth_connections.encrypted_refresh_token` (seq95).
- `scope` : `https://www.googleapis.com/auth/business.manage` (scope minimal nécessaire).
- `expires_at` : timestamp expiration access_token.

### 2.2 Compte GBP (peuplés au callback OAuth)
- `gbp_connections.gbp_account_id` : identifiant compte Google Business (ex `accounts/123456`).
- `gbp_connections.gbp_account_name` : nom légal du compte business (ex « Cabinet Mathis Guimont »).
- `gbp_connections.business_email` : email administrateur GBP (peuplé via Google People API au callback).
- `gbp_connections.status` : `active` | `revoked` | `error`.

### 2.3 Locations GBP (fiches business)
- `gbp_locations.gbp_location_id` : identifiant fiche (ex `accounts/123456/locations/789`).
- `gbp_locations.location_title` : nom public de la fiche.
- `gbp_locations.primary_phone` : téléphone affiché publiquement.
- `gbp_locations.primary_category` : catégorie GBP (ex `mortgage_broker`).
- `gbp_locations.address_json` : adresse postale publique (déjà publique côté Google Maps).

### 2.4 Reviews fetched (`gbp_reviews_sync`)
- Auteurs **publics** uniquement (nom affiché par l'auteur sur sa review Google Maps).
- **PAS de PII privée** : pas d'email auteur, pas d'IP auteur, pas d'identifiant Google interne.
- Texte review tel que publié publiquement.
- Note (1-5), date publication, langue.

### 2.5 Posts publiés (`gbp_posts_sync`)
- Contenu publié par le tenant via Intralys → Google → public.
- Audit trail (qui a publié, quand, payload exact envoyé à Google).
- **PAS de** : données utilisateur final visiteur de la fiche.

### 2.6 Données JAMAIS partagées avec Google
- Données contacts/leads Intralys (CRM tenant).
- Données paiements (Stripe — flow séparé Sprint 31).
- Données utilisateurs admin Intralys.
- Cookies / consent tracking utilisateurs visiteurs.

## §3 Rétention

| Donnée | Google | Intralys D1 |
|---|---|---|
| `oauth_connections` (tokens chiffrés) | jusqu'à révocation user | indéfini tant que tenant actif (purge à RTBF ou disconnect) |
| `gbp_connections` | indéfini (compte GBP côté Google) | indéfini tant que tenant actif |
| `gbp_locations` | indéfini | indéfini (snapshot resync) |
| `gbp_reviews_sync` | indéfini (reviews publics côté Google Maps) | indéfini (cache public) |
| `gbp_posts_sync` | selon politique Google | **5 ans** (audit publication, conformité publicitaire AMF/OACIQ) |
| `reviews_cache` (origin=google) | n/a | indéfini, anonymisé à RTBF |

## §4 RTBF (Right To Be Forgotten — Loi 25 art. 28.1 + RGPD art. 17)

### 4.1 Déclenchement
1. User clique **"Supprimer mon compte"** dans Settings → DataPrivacyPanel (Sprint 23).
2. Soft-delete 30j (`account_deletion_requests` status='pending', seq121).
3. À J+30 (cron `handleScheduledAccountDeletion`), exécution cascade :

### 4.2 Cascade GBP (Sprint 32 — ajoutée à `me-privacy.ts`)

Exécutée à l'intérieur de `handleRequestAccountDeletion` (best-effort, swallow erreurs SQL) :

```sql
-- 1) Purge sync history (audit publication conservé via audit_log immuable)
DELETE FROM gbp_reviews_sync WHERE client_id = ?;
DELETE FROM gbp_posts_sync   WHERE client_id = ?;

-- 2) Purge fiches GBP référencées
DELETE FROM gbp_locations    WHERE client_id = ?;
DELETE FROM gbp_connections  WHERE client_id = ?;

-- 3) Purge tokens OAuth chiffrés
DELETE FROM oauth_connections WHERE client_id = ? AND provider = 'google_business';

-- 4) Anonymisation reviews_cache (préserve agrégats publics, retire reply tenant)
UPDATE reviews_cache SET reply_text = NULL, reply_author = NULL
  WHERE client_id = ? AND source_origin = 'google';
```

### 4.3 Best-effort revoke côté Google

Optionnellement (commenté par défaut — exige access_token déchiffré au moment du delete) :

```ts
// Best-effort revoke Google OAuth — ne pas bloquer la cascade si réseau KO
// fetch('https://oauth2.googleapis.com/revoke?token=' + accessToken).catch(() => {});
```

Note : si la révocation Google échoue, le user peut révoquer manuellement via [https://myaccount.google.com/permissions](https://myaccount.google.com/permissions).

### 4.4 Suppression d'un tenant complet (vs. user solo)

Si une AGENCE (tenant) entière demande dissolution :
- Tous les `users` de l'agence anonymisés.
- Cascade GBP identique mais bornée par `client_id` du tenant entier (pas par `user_id`).
- `oauth_connections` du tenant purgés en totalité.
- Audit `audit_log` action `tenant.gbp.cascade_deleted` immuable.

## §5 Export user-data (Loi 25 art. 27 + RGPD art. 15)

### 5.1 Sprint 32 ajoute au handler `handleGetMyDataExport`

Le payload retourné par `GET /api/me/export-data` inclut désormais :

```json
{
  "gbp_connections": [
    {
      "id": "...",
      "gbp_account_id": "accounts/...",
      "gbp_account_name": "...",
      "status": "active",
      "last_sync_at": "...",
      "created_at": "..."
    }
  ],
  "gbp_locations": [
    {
      "id": "...",
      "gbp_location_id": "accounts/.../locations/...",
      "location_title": "...",
      "primary_phone": "...",
      "primary_category": "..."
    }
  ]
}
```

### 5.2 Données EXCLUES de l'export
- Tokens OAuth chiffrés (`oauth_connections.encrypted_*`) : secrets non-exportables (sécurité).
- `gbp_reviews_sync` complet : volumétrie + déjà accessible côté user via Google Maps.
- `gbp_posts_sync` complet : disponible via audit_log filtré (qui couvre déjà les publications).

### 5.3 Portabilité (RGPD art. 20)

L'export JSON `me/export-data` reste portable et inclut maintenant le snapshot GBP minimal nécessaire pour migrer vers un autre prestataire.

## §6 Notification incident (Loi 25 art. 3.5 + RGPD art. 33)

En cas d'incident de confidentialité présumé sur les tokens OAuth GBP ou les fiches GBP :

1. **Notification interne Rochdi sous 24h.**
2. **Évaluation impact** : nombre de tenants touchés, scope tokens compromis, risque accès non-autorisé fiches GBP.
3. **Révocation immédiate** des tokens compromis côté Google (`oauth2.googleapis.com/revoke`) et purge `oauth_connections` impactés.
4. **Notification Commission d'accès à l'information du Québec (CAI)** sous **72h** si risque sérieux (Loi 25 art. 3.5).
5. **Notification utilisateurs concernés** sous 72h.
6. **Si breach détecté côté Google** (notification Google → Intralys) : application du même protocole + référence ticket Google dans audit_log.
7. **Audit** `audit_log` action `incident.gbp.notified` avec horodatage + scope.

## §7 Contact DPO

- **Email** : accessibilite@intralys.com
- **Délai réponse cible** : 5 jours ouvrables.
- **Délai résolution cible** : 30 jours.
- **Référence Loi 25** : Responsable de la protection des renseignements personnels (RPRP).

## §8 Sous-traitant DPA

- **Google LLC / Google Cloud EMEA Limited** : sous-traitant inscrit registre DPA Intralys.
- **DPA Google Cloud** : [https://cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum)
- **Google Business Profile API ToS** : [https://developers.google.com/my-business/content/policies](https://developers.google.com/my-business/content/policies)
- **Engagement** : Google respecte clauses contractuelles type Commission EU + Privacy Shield successeur (DPF).
- **Notification breach** : Google notifie Intralys sans délai déraisonnable (typiquement <72h).

## §9 Scope OAuth & principe de minimisation

Intralys demande **uniquement** le scope OAuth strictement nécessaire :

- `https://www.googleapis.com/auth/business.manage` : gestion fiches GBP du tenant.

**NON demandés** :
- `userinfo.email` (au-delà du callback initial pour peupler `business_email`).
- `userinfo.profile`.
- Drive / Gmail / Calendar.
- Analytics.

Principe de minimisation RGPD art. 5(1)(c) + Loi 25 art. 5 respecté.

## §10 Révision

Cette doc est révisée à chaque sprint touchant GBP, OAuth Google, ou flow données utilisateurs.
- **Sprint 32 (2026-05-24)** : création doc — cascade GBP RTBF + export GBP user-data.
- **Prochaine révision** : Sprint touchant GBP réviews/posts ou changement scope OAuth.
