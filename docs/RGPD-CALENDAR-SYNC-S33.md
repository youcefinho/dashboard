# RGPD Calendar Sync — Sprint 33

> Cartographie des flux de données entre Intralys et les fournisseurs de calendriers externes (Google Calendar, Microsoft Outlook/Graph) pour conformité Loi 25 (Québec) + RGPD (EU).
> Date : 2026-05-24. Version : 1.0. Sprint : 33.
> Calque la structure de `docs/COMPLIANCE-GBP-S32.md` (Sprint 32).

## §1 Data residency

- **Google Calendar API** : datacenters Google Cloud Platform principalement US, certains workloads EU. Hébergement événements géré par Google.
- **Microsoft Graph (Outlook Calendar)** : datacenters Azure régionaux **variables selon tenant Microsoft 365** (Canada Central/East, US East, EU West, etc.). La région est définie par la politique du tenant Microsoft 365 du user externe — Intralys n'a pas de contrôle direct sur la résidence des événements côté Microsoft.
- **Intralys D1** : Cloudflare D1, région principale **Amérique du Nord (Canada)** pour la base de production, avec éventuelles répliques edge.
- **Tokens OAuth (access + refresh) Google + Outlook** : stockés dans `oauth_connections` (seq95), **chiffrés AES-GCM** côté Worker avant insertion D1 (clé `OAUTH_TOKEN_KEK` env secret).
- **Transfert transfrontalier** :
  - USA via Google : encadré par **DPA Google Cloud** (Article 28 RGPD + clauses contractuelles type Commission EU).
  - Région variable via Microsoft : encadré par **DPA Microsoft Online Services Terms** (OST) + DPF (Data Privacy Framework).
- **Loi 25 art. 17** : transfert hors-Québec autorisé via évaluation des facteurs (faite via DPA Google + DPA Microsoft + chiffrement at-rest tokens).

## §2 Données partagées avec les fournisseurs externes

### 2.1 Tokens OAuth (chiffrés D1)
- `access_token` : court terme (~1h Google, ~1h Microsoft), refresh automatique côté Worker.
- `refresh_token` : long terme, **chiffré AES-GCM** dans `oauth_connections.encrypted_refresh_token` (seq95).
- `scope` Google : `https://www.googleapis.com/auth/calendar.events` + `https://www.googleapis.com/auth/calendar.readonly` (scopes minimaux).
- `scope` Microsoft : `Calendars.ReadWrite` + `User.Read` (scopes minimaux).
- `expires_at` : timestamp expiration access_token.
- Provider stocké dans `oauth_connections.provider` : `google_calendar` | `outlook`.

### 2.2 Compte calendrier externe (`calendar_connections`)
- `calendar_connections.id` : identifiant interne Intralys de la connexion.
- `calendar_connections.provider` : `google_calendar` | `outlook`.
- `calendar_connections.external_account_email` : email du compte externe (ex `andrew@gmail.com`, `mathis@cabinet.com`) — **PII directe**, peuplée au callback OAuth.
- `calendar_connections.external_calendar_name` : nom affiché du calendrier (ex « Calendrier principal », « Rendez-vous courtage »).
- `calendar_connections.status` : `active` | `revoked` | `error`.
- `calendar_connections.last_pull_at` : timestamp dernière synchronisation entrante.

### 2.3 Événements externes synchronisés (`calendar_external_events`)
- `calendar_external_events.summary` : titre de l'événement (peut contenir PII — ex « RDV Jean Tremblay 514-555-1234 »).
- `calendar_external_events.description` : description événement (peut contenir PII — notes courtier, contexte client).
- `calendar_external_events.location` : lieu rendez-vous (peut être adresse personnelle client → PII).
- `calendar_external_events.attendees` : liste invités JSON (peut contenir emails clients → PII directe).
- `calendar_external_events.start_time`, `end_time`, `status` : métadonnées temporelles non-PII.
- **Mise en garde PII** : tout champ libre saisi par le user externe sur son calendrier peut contenir des renseignements personnels de tiers (clients, prospects). Intralys est sous-traitant au sens Loi 25 art. 18.3 pour ces données importées.

### 2.4 Mapping rendez-vous internes (`appointment_sync`)
- `appointment_sync.appointment_id` : référence appointment local Intralys.
- `appointment_sync.external_event_id` : référence event Google/Outlook côté externe.
- `appointment_sync.sync_status` : `synced` | `pending` | `error` | `conflict`.
- `appointment_sync.last_synced_at` : timestamp dernière propagation.
- **PAS de PII directe** dans cette table (que des IDs de mapping).

### 2.5 Données JAMAIS partagées avec Google / Microsoft
- Données contacts/leads Intralys (CRM tenant) — sauf si volontairement ajoutées par le user à un événement.
- Données paiements (Stripe — flow séparé Sprint 31).
- Données utilisateurs admin Intralys (mots de passe, sessions, audit_log interne).
- Données GBP / reviews (Sprint 32 — flow séparé).
- Cookies / consent tracking utilisateurs visiteurs du site.

## §3 Rétention

| Donnée | Google / Microsoft | Intralys D1 |
|---|---|---|
| `oauth_connections` (tokens chiffrés) | jusqu'à révocation user | **indéfini tant que tenant actif** (purge à RTBF ou disconnect) |
| `calendar_connections` | jusqu'à révocation OAuth | **indéfini** tant que tenant actif (purge à RTBF ou disconnect manuel) |
| `calendar_external_events` (cache) | indéfini côté provider | **90 jours rolling** — cache miroir, purge auto via cron (**TODO Sprint cleanup** — cron pas encore implémenté Sprint 33, à planifier) |
| `appointment_sync` | n/a | **conservé tant que l'appointment local existe** (cascade au DELETE de l'appointment parent) |

**Note Sprint 33** : la purge automatique 90j de `calendar_external_events` est **prévue mais pas encore livrée** — le cron de cleanup sera implémenté dans un sprint dédié. À l'intervalle, le volume est borné par les pulls périodiques et reste raisonnable.

## §4 RTBF (Right To Be Forgotten — Loi 25 art. 28.1 + RGPD art. 17)

### 4.1 Déclenchement
1. User clique **"Supprimer mon compte"** dans Settings → DataPrivacyPanel (Sprint 23).
2. Soft-delete 30j (`account_deletion_requests` status='pending', seq121).
3. À J+30 (cron `handleScheduledAccountDeletion`), exécution cascade finale ; les tokens et données sensibles sont purgés **dès la création** de la demande (early revocation préférée pour réduire la fenêtre d'exposition tokens).

### 4.2 Cascade Calendar Sync (Sprint 33 — ajoutée à `me-privacy.ts`)

Exécutée à l'intérieur de `handleRequestAccountDeletion` (best-effort, swallow erreurs SQL) :

```sql
-- 1) Purge mapping appointments ↔ external events
DELETE FROM appointment_sync         WHERE client_id = ?;

-- 2) Purge cache événements externes importés
DELETE FROM calendar_external_events WHERE client_id = ?;

-- 3) Purge connexions calendriers
DELETE FROM calendar_connections     WHERE client_id = ?;

-- 4) Purge tokens OAuth chiffrés Google Calendar + Outlook
DELETE FROM oauth_connections
  WHERE client_id = ? AND provider IN ('google_calendar', 'outlook');
```

### 4.3 Best-effort revoke côté providers externes

Optionnellement (commenté par défaut — exige access_token déchiffré au moment du delete) :

```ts
// Best-effort revoke Google OAuth — ne pas bloquer la cascade si réseau KO
// fetch('https://oauth2.googleapis.com/revoke?token=' + accessToken).catch(() => {});

// Best-effort revoke Microsoft Graph
// fetch('https://login.microsoftonline.com/common/oauth2/v2.0/logout', { ... }).catch(() => {});
```

Si la révocation échoue :
- Google : user révoque manuellement via [https://myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- Microsoft : user révoque manuellement via [https://account.live.com/consent/Manage](https://account.live.com/consent/Manage) ou portail Azure AD pour comptes work/school.

### 4.4 Suppression d'un tenant complet (vs. user solo)

Si une AGENCE (tenant) entière demande dissolution :
- Tous les `users` de l'agence anonymisés.
- Cascade Calendar identique mais bornée par `client_id` du tenant entier (pas par `user_id`).
- `oauth_connections` du tenant pour providers `google_calendar` + `outlook` purgés en totalité.
- Audit `audit_log` action `tenant.calendar.cascade_deleted` immuable.

## §5 Export user-data (Loi 25 art. 27 + RGPD art. 15)

### 5.1 Sprint 33 ajoute au handler `handleGetMyDataExport`

Le payload retourné par `GET /api/me/export-data` inclut désormais **3 nouvelles tables** :

```json
{
  "calendar_connections": [
    {
      "id": "...",
      "provider": "google_calendar",
      "external_account_email": "...",
      "external_calendar_name": "...",
      "status": "active",
      "last_pull_at": "...",
      "created_at": "..."
    }
  ],
  "calendar_external_events": [
    {
      "id": "...",
      "summary": "...",
      "start_time": "...",
      "end_time": "...",
      "status": "confirmed"
    }
  ],
  "appointment_sync": [
    {
      "id": "...",
      "appointment_id": "...",
      "sync_status": "synced",
      "last_synced_at": "..."
    }
  ]
}
```

### 5.2 Données EXCLUES de l'export
- Tokens OAuth chiffrés (`oauth_connections.encrypted_*`) : secrets non-exportables (sécurité).
- `calendar_external_events.description` + `.location` + `.attendees` : exclus du payload pour limiter la volumétrie et éviter de ré-exfiltrer des PII de tiers (les events restent accessibles côté Google/Outlook directement par le user via son interface native).
- `calendar_external_events` au-delà de 200 lignes : tronqué (`ORDER BY start_time DESC LIMIT 200`) pour borner la taille du payload export.

### 5.3 Portabilité (RGPD art. 20)

L'export JSON `me/export-data` reste portable et inclut maintenant le snapshot calendar minimal nécessaire pour comprendre les connexions actives et le mapping appointments. Les événements complets restent disponibles via Google Takeout / Microsoft Graph natif pour portabilité brute exhaustive.

## §6 Notification incident (Loi 25 art. 3.5 + RGPD art. 33)

En cas d'incident de confidentialité présumé sur les tokens OAuth Calendar ou les événements importés :

1. **Notification interne Rochdi sous 24h.**
2. **Évaluation impact** : nombre de tenants touchés, scope tokens compromis, risque accès non-autorisé événements externes (qui peuvent contenir PII tiers — clients).
3. **Révocation immédiate** des tokens compromis côté Google (`oauth2.googleapis.com/revoke`) + Microsoft (logout endpoint Graph), et purge `oauth_connections` impactés.
4. **Notification Commission d'accès à l'information du Québec (CAI)** sous **72h** si risque sérieux (Loi 25 art. 3.5).
5. **Notification utilisateurs concernés** sous 72h.
6. **Si breach détecté côté Google ou Microsoft** (notification provider → Intralys) : application du même protocole + référence ticket provider dans audit_log.
7. **Audit** `audit_log` action `incident.calendar.notified` avec horodatage + scope (provider, nombre de connexions).

## §7 Contact DPO

- **Email** : accessibilite@intralys.com
- **Délai réponse cible** : 5 jours ouvrables.
- **Délai résolution cible** : 30 jours.
- **Référence Loi 25** : Responsable de la protection des renseignements personnels (RPRP).

## §8 Sous-traitants DPA

- **Google LLC / Google Cloud EMEA Limited** : sous-traitant inscrit registre DPA Intralys.
  - **DPA Google Cloud** : [https://cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum)
  - **Google Calendar API ToS** : [https://developers.google.com/calendar/api/guides/auth](https://developers.google.com/calendar/api/guides/auth)
- **Microsoft Corporation / Microsoft Ireland Operations Ltd** : sous-traitant inscrit registre DPA Intralys.
  - **DPA Microsoft** : [https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA](https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA)
  - **Microsoft Graph ToS** : [https://learn.microsoft.com/graph/terms-of-use](https://learn.microsoft.com/graph/terms-of-use)
- **Engagement** : Google + Microsoft respectent clauses contractuelles type Commission EU + DPF (Data Privacy Framework, successeur Privacy Shield).
- **Notification breach** : les deux providers notifient Intralys sans délai déraisonnable (typiquement <72h).

## §9 Scope OAuth & principe de minimisation

Intralys demande **uniquement** les scopes OAuth strictement nécessaires :

### Google Calendar
- `https://www.googleapis.com/auth/calendar.events` : création/lecture/update events propres à Intralys.
- `https://www.googleapis.com/auth/calendar.readonly` : lecture événements existants pour détection conflits.

### Microsoft Graph (Outlook)
- `Calendars.ReadWrite` : gestion événements calendar utilisateur.
- `User.Read` : email + nom affichage uniquement (peuplement `external_account_email`).

**NON demandés** :
- Gmail / Outlook Mail (lecture/écriture emails).
- Drive / OneDrive.
- Contacts complets (People API Google, Contacts.Read Graph).
- Tasks.
- Files.
- Sites SharePoint.

Principe de minimisation RGPD art. 5(1)(c) + Loi 25 art. 5 respecté.

## §10 Révision

Cette doc est révisée à chaque sprint touchant la sync calendrier, OAuth Google Calendar / Microsoft Graph, ou flow données rendez-vous.
- **Sprint 33 (2026-05-24)** : création doc — cascade Calendar Sync RTBF + export 3 nouvelles tables user-data.
- **Prochaine révision** : Sprint implémentant le cron de purge 90j `calendar_external_events`, ou changement scope OAuth Google/Microsoft, ou ajout d'un 3ème provider (CalDAV / Apple Calendar / etc.).
