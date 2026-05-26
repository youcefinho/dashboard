# LOT Calendar Sync — Sprint 33

> Doc contrat §6 figé. Migration : seq128 — `migration-calendar-sync-seq128.sql`.
> Compagnons : `LOT-GBP-S32.md` (Sprint 32 seq127 — provider Google `google_business`, calque OAuth), `LOT-OAUTH-G4.md` (Sprint G4 seq95 — table `oauth_connections` + provider Google `google_calendar` readonly), `OUTLOOK-OAUTH-SETUP-S33.md` (setup Azure App registration), `BINDINGS-SECRETS-S10.md` §« Sprint 33 — Calendar Sync bindings ».

## Objectif

Brancher une **synchronisation bidirectionnelle** des `appointments` Intralys (table `appointments` seq4 + `calendars` seq32) avec deux providers externes :

1. **Google Calendar** (write — distinct du provider `google_calendar` Sprint G4 qui reste readonly).
2. **Microsoft Outlook / Microsoft 365 Calendar** (Microsoft Graph `/me/events`, NOUVEAU provider `outlook`).

Synchro **push** (Intralys → external) à chaque mutation `appointments` (create/update/delete) + **pull** (external → Intralys) via webhook push notifications (Google Calendar `watch` channels, Microsoft Graph subscriptions) avec fallback cron horaire (resync incrémentale par `syncToken` / `deltaToken`).

Politique de résolution de conflits : **Last-Write-Wins (LWW)** par défaut, **conservatif Intralys gagne en cas d'égalité** (timestamp `updated_at` identique au seconde près = Intralys gagne) — garantit un comportement déterministe et favorise la source de vérité interne.

Périmètre v1 (Sprint 33) :

- **Connect / disconnect** OAuth Google Calendar write + OAuth Outlook par tenant.
- **Lister + sélectionner** les calendriers externes rattachés au compte connecté.
- **Mapping bidirectionnel** : un calendrier Intralys (`calendars.id`) ↔ un calendrier externe (`external_calendar_id`).
- **Push** : à chaque `INSERT/UPDATE/DELETE` sur `appointments`, propagation vers le calendrier externe lié.
- **Pull** : webhook push notifications + cron horaire de réconciliation (incremental sync via tokens).
- **Conflict resolver UI** : liste des conflits détectés (mutation simultanée des deux côtés dans une fenêtre 30s) + résolution manuelle ou auto LWW.
- **Audit log** : chaque mutation push/pull horodatée dans `audit_log` (seq5 + seq121) avec `source ∈ {intralys, gcal, outlook}`.

## Distinction provider `'google'` (G4 readonly) vs `'google_calendar'` (write) vs `'outlook'` (nouveau)

Le Sprint G4 (`LOT-OAUTH-G4.md`, seq95) a posé la table `oauth_connections` avec un provider Google **readonly** initial. Sprint 33 distingue **trois providers Google/Microsoft** coexistant dans la même table `oauth_connections` :

| Aspect | Sprint G4 (seq95) | Sprint 32 (seq127) | Sprint 33 GCal write (seq128) | Sprint 33 Outlook (seq128) |
|---|---|---|---|---|
| Provider | `google` (alias historique readonly) | `google_business` | **`google_calendar`** (NOUVEAU, write) | **`outlook`** (NOUVEAU) |
| Scope | `calendar.readonly` | `business.manage` | `https://www.googleapis.com/auth/calendar` (full read/write) | `Calendars.ReadWrite offline_access User.Read` |
| OAuth provider | Google | Google | Google | Microsoft (Azure AD v2 endpoint) |
| OAuth client | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | mêmes secrets (réutilisés) | **`GCAL_SYNC_OAUTH_CLIENT_ID` / `_SECRET`** (optionnels, fallback `GOOGLE_OAUTH_CLIENT_ID`) | **`MS_OAUTH_CLIENT_ID` / `_SECRET` / `_TENANT`** (NOUVEAUX) |
| Auth endpoint | `accounts.google.com/o/oauth2/v2/auth` | idem | idem | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` |
| Token endpoint | `oauth2.googleapis.com/token` | idem | idem | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` |
| Verification Google/MS | Aucune | Brand+App verif | Aucune (`calendar` non-sensible si app interne) | Admin consent si org M365 demande |
| Tables métier | Aucune | `gbp_*` × 4 | `calendar_connections`, `calendar_external_events`, `appointment_sync` (partagées Outlook) | mêmes 3 tables (partagées) |
| Webhook push | N/A | N/A | Google Calendar `events.watch` channels (renewal 7 jours max) | Microsoft Graph `/subscriptions` (renewal 3 jours max) |
| Activation | secrets posés → ON | secrets + flag tenant + connexion | OAuth GCal séparé (recommandé) + connexion tenant | Azure App + connexion tenant |

La distinction `provider` est **critique** : un tenant peut avoir une connexion `google_calendar` (write) en parallèle d'une connexion `google` (readonly Sprint G4) — scopes différents, refresh tokens différents, écritures séparées. Pas de réutilisation transversale des tokens. Index seq95 `idx_oauth_conn_tenant ON (client_id, provider)` couvre déjà le lookup multi-provider.

> **Recommandation forte** : créer une app Google Cloud Console **dédiée** au sync write (`GCAL_SYNC_OAUTH_CLIENT_ID` distinct) pour isoler le rate-limit + l'OAuth consent screen affichant explicitement `Calendar full access` — évite la confusion utilisateur côté écran de consentement Google. Fallback : si `GCAL_SYNC_OAUTH_CLIENT_ID` absent, le code retombe sur `GOOGLE_OAUTH_CLIENT_ID` (Sprint G4) et ajoute le scope `calendar` à l'app existante (nécessite ré-consent utilisateur).

## §6 Contrats figés

### §6.1 Migration seq128

Fichier racine : `migration-calendar-sync-seq128.sql`. Manifest entrée seq128 (`docs/migrations-manifest.json`), `depends_on: ["migration-gbp-seq127.sql", "migration-oauth-connections-seq95.sql", "migration-phase24.sql"]` (seq32 = `appointments` + `calendars` + `availability_rules`).

Pattern 100 % ADDITIF, zéro FK / CHECK / ALTER :

- `CREATE TABLE IF NOT EXISTS calendar_connections` — mapping connexion OAuth ↔ calendrier Intralys (`id`, `client_id`, `provider` `google_calendar|outlook`, `oauth_connection_id` REF logique `oauth_connections.id`, `account_email`, `external_account_id` `null` pour Google / `id` Microsoft Graph User, `intralys_calendar_id` REF logique `calendars.id` seq32, `external_calendar_id` `primary` ou ID custom, `external_calendar_summary`, `sync_direction` `push|pull|bidirectional` défaut `bidirectional`, `webhook_channel_id` (Google) ou `subscription_id` (Outlook), `webhook_expiration_ts` int unix, `last_sync_token` text (Google `syncToken` / Outlook `deltaLink`), `last_synced_at`, `status` `active|paused|reauth_required|revoked`, `created_at`, `updated_at`). UNIQUE `(client_id, provider, intralys_calendar_id, external_calendar_id)`.
- `CREATE TABLE IF NOT EXISTS calendar_external_events` — événements externes matérialisés (`id`, `client_id`, `calendar_connection_id` REF logique, `external_event_id` UNIQUE par connexion, `external_etag` (ETag/changeTag pour pull incremental), `appointment_id` REF logique `appointments.id` (NULL si pas encore mappé), `summary`, `description`, `start_ts` unix, `end_ts` unix, `location`, `attendees_json`, `recurrence_rule`, `is_cancelled` `0|1`, `external_updated_at` ISO 8601 (timestamp source pour LWW), `raw_json` (payload Google/MS Graph brut), `created_at`, `updated_at`).
- `CREATE TABLE IF NOT EXISTS appointment_sync` — table de mapping bidirectionnel + état dernier sync par appointment (`id`, `appointment_id` REF logique, `calendar_connection_id` REF logique, `external_event_id` (corrélation Google/MS), `last_pushed_at` ISO (dernière fois où Intralys a poussé vers external), `last_pulled_at` ISO (dernière fois où external a poussé vers Intralys), `last_known_external_etag` (snapshot pour détection conflit), `last_known_intralys_updated_at` (snapshot pour détection conflit), `conflict_status` `none|detected|resolved_intralys|resolved_external|resolved_manual` défaut `none`, `conflict_resolved_at`, `conflict_resolved_by_user_id` REF logique `users.id`, `last_error`, `last_error_at`, `created_at`, `updated_at`). UNIQUE `(appointment_id, calendar_connection_id)`.

Index :
- `idx_calendar_connections_tenant ON calendar_connections(client_id, provider, status)`
- `idx_calendar_connections_intralys_cal ON calendar_connections(client_id, intralys_calendar_id)`
- `idx_calendar_external_events_conn ON calendar_external_events(calendar_connection_id, external_updated_at DESC)`
- `idx_calendar_external_events_appt ON calendar_external_events(appointment_id) WHERE appointment_id IS NOT NULL`
- `idx_appointment_sync_appt ON appointment_sync(appointment_id, calendar_connection_id)`
- `idx_appointment_sync_conflicts ON appointment_sync(calendar_connection_id, conflict_status) WHERE conflict_status != 'none'`

Aucun CHECK. Validation `provider` / `sync_direction` / `conflict_status` appartient aux handlers `calendar-integrations.ts`. Migration `seq128` réversible logiquement (`DROP TABLE IF EXISTS` sur les 3 tables) — pas en prod si données présentes.

### §6.2 OAuth flows distincts (`gcal-oauth.ts` + `outlook-oauth.ts`)

**Pas de réutilisation directe** du module OAuth Sprint G4 (`src/worker/oauth.ts`) parce que les flows divergent significativement (endpoints Microsoft vs Google, format `client_assertion`, `tenant` segment d'URL). On crée **deux modules dédiés** qui partagent le même contrat (helper `encryptToken`/`decryptToken` réutilisé, table `oauth_connections` réutilisée).

#### `src/worker/lib/gcal-oauth.ts`

- **`GET /api/oauth/google_calendar/authorize`** (PROTÉGÉ — `settings.manage`) → redirect 302 Google avec :
  - `client_id = env.GCAL_SYNC_OAUTH_CLIENT_ID ?? env.GOOGLE_OAUTH_CLIENT_ID`
  - `redirect_uri = ${origin}/api/oauth/google_calendar/callback`
  - `scope = 'https://www.googleapis.com/auth/calendar'` (full read/write)
  - `access_type=offline&prompt=consent` (force refresh_token + ré-consent même si déjà autorisé pour upgrade scope)
  - `state = <CSRF token>` → posé dans `env.STATE_STORE` KV TTL **600s**, one-time, contient `{ clientId, agencyId, returnUrl, provider: 'google_calendar' }` chiffré minimalement (calque G4 §6.D).
- **`GET /api/oauth/google_calendar/callback`** (PUBLIC hors-try, calque G4) :
  - Vérifie `state` KV → 400 si absent/expiré (CSRF).
  - Échange `code` contre `access_token + refresh_token` (POST `oauth2.googleapis.com/token`).
  - Upsert `oauth_connections` `(client_id, provider='google_calendar')` avec tokens **chiffrés** via `encryptToken(env, plaintext)` (clé `env.TOKEN_KEY`) — fallback clair si TOKEN_KEY absent (limite documentée calque G4 §6.E).
  - Récupère `account_email` via `https://www.googleapis.com/oauth2/v2/userinfo`.
  - Redirect navigateur vers `returnUrl` (front affiche `CalendarConnectButtons` en état connecté Google).
- **Disconnect `DELETE /api/oauth/google_calendar/connection`** (PROTÉGÉ — `settings.manage`) → UPDATE `oauth_connections SET status='revoked' WHERE client_id=? AND provider='google_calendar'` + UPDATE `calendar_connections SET status='revoked' WHERE oauth_connection_id=?` + best-effort POST `https://oauth2.googleapis.com/revoke?token=<refresh_token>` (ignore erreur revoke) + arrêt des channels `events.watch` actifs (`POST /channels/stop`).

#### `src/worker/lib/outlook-oauth.ts`

- **`GET /api/oauth/outlook/authorize`** (PROTÉGÉ — `settings.manage`) → redirect 302 Microsoft avec :
  - `client_id = env.MS_OAUTH_CLIENT_ID`
  - `redirect_uri = ${origin}/api/oauth/outlook/callback`
  - `scope = 'https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access'`
  - `response_type=code&response_mode=query&prompt=consent` (force ré-consent)
  - `state = <CSRF token>` → posé dans `env.STATE_STORE` KV TTL **600s**, one-time, contient `{ clientId, agencyId, returnUrl, provider: 'outlook' }`.
  - URL base : `https://login.microsoftonline.com/${env.MS_OAUTH_TENANT ?? 'common'}/oauth2/v2.0/authorize`.
- **`GET /api/oauth/outlook/callback`** (PUBLIC hors-try) :
  - Vérifie `state` KV → 400 si absent/expiré.
  - Échange `code` contre `access_token + refresh_token` (POST `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` avec `grant_type=authorization_code`, body urlencoded `client_id + client_secret + code + redirect_uri + scope`).
  - Upsert `oauth_connections` `(client_id, provider='outlook')` avec tokens **chiffrés** via `encryptToken`.
  - Récupère `account_email + external_account_id` via `GET https://graph.microsoft.com/v1.0/me` (`mail` ou `userPrincipalName` + `id`).
  - Redirect navigateur vers `returnUrl`.
- **Si `env.MS_OAUTH_CLIENT_ID` ou `_SECRET` absent** → `authorize` renvoie `{ error: 'outlook OAuth non configuré' }` **400** (calque G4, PAS 500). Callback no-op.
- **Disconnect `DELETE /api/oauth/outlook/connection`** (PROTÉGÉ — `settings.manage`) → UPDATE `oauth_connections SET status='revoked' WHERE provider='outlook'` + UPDATE `calendar_connections SET status='revoked'` + DELETE subscription via `DELETE https://graph.microsoft.com/v1.0/subscriptions/{id}` (ignore erreur) + best-effort POST revoke MS Graph (pas d'endpoint officiel, omis).

#### Helpers partagés `oauth_connections`

- `getCalendarOauthAccessToken(env, clientId, provider): Promise<string>` — lit token chiffré D1, déchiffre via `decryptToken`, refresh LAZY si `expires_at < now() + 60s` :
  - Google : POST `oauth2.googleapis.com/token` avec `grant_type=refresh_token`.
  - Outlook : POST `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` avec `grant_type=refresh_token + scope` (Microsoft exige le scope ré-explicité au refresh).
  - Persiste nouveau token chiffré + `expires_at`. Calque exact `getOauthAccessToken` Sprint G4.

### §6.3 Helpers `gcal-client.ts` + `outlook-client.ts` (signatures)

`src/worker/lib/gcal-client.ts` — wrappers fetch SDK-free (calque pattern `gbp-client.ts` Sprint 32) :

```ts
// Liste les calendriers Google rattachés au compte connecté.
listGcalCalendars(token: string): Promise<GcalCalendar[]>
// GET https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false

// Push : crée un événement dans le calendrier external à partir d'un appointment Intralys.
createGcalEvent(token: string, calendarId: string, event: GcalEventPayload): Promise<GcalEvent>
// POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events
// Body: { summary, description, start: { dateTime, timeZone }, end: { dateTime, timeZone }, location, attendees: [{ email }] }

// Push : update un événement existant.
updateGcalEvent(token: string, calendarId: string, eventId: string, event: GcalEventPayload, etag?: string): Promise<GcalEvent>
// PUT https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}
// Header If-Match: "etag" si fourni (détection conflit côté Google → 412 Precondition Failed)

// Push : supprime.
deleteGcalEvent(token: string, calendarId: string, eventId: string): Promise<void>
// DELETE https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}

// Pull incremental : liste les changements depuis dernier syncToken (ou full list initiale).
listGcalEvents(token: string, calendarId: string, opts: { syncToken?: string, pageToken?: string }): Promise<{ items: GcalEvent[], nextSyncToken?: string, nextPageToken?: string }>
// GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events?syncToken=...
// Note: 410 Gone si syncToken expiré (>30 jours) → refaire full sync et stocker nouveau syncToken.

// Webhook : crée un channel push notifications (renewal max 7 jours).
createGcalWatchChannel(token: string, calendarId: string, opts: { channelId: string, webhookUrl: string, expirationMs: number }): Promise<{ resourceId: string, expiration: string }>
// POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/watch
// Body: { id: channelId, type: 'web_hook', address: webhookUrl, token: env.WEBHOOK_SECRET, expiration: expirationMs }

// Arrêt channel.
stopGcalWatchChannel(token: string, channelId: string, resourceId: string): Promise<void>
// POST https://www.googleapis.com/calendar/v3/channels/stop
```

`src/worker/lib/outlook-client.ts` — wrappers Microsoft Graph fetch SDK-free :

```ts
// Liste les calendriers Outlook de l'utilisateur connecté.
listOutlookCalendars(token: string): Promise<OutlookCalendar[]>
// GET https://graph.microsoft.com/v1.0/me/calendars

// Push : crée un événement.
createOutlookEvent(token: string, calendarId: string, event: OutlookEventPayload): Promise<OutlookEvent>
// POST https://graph.microsoft.com/v1.0/me/calendars/{calendarId}/events
// Body: { subject, body: { contentType: 'HTML', content }, start: { dateTime, timeZone }, end: { dateTime, timeZone }, location: { displayName }, attendees: [{ emailAddress: { address }, type: 'required' }] }

// Push : update (PATCH partial, garde les autres champs intacts).
updateOutlookEvent(token: string, eventId: string, event: Partial<OutlookEventPayload>, etag?: string): Promise<OutlookEvent>
// PATCH https://graph.microsoft.com/v1.0/me/events/{eventId}
// Header If-Match: etag si fourni → 412 si conflit serveur.

// Push : delete.
deleteOutlookEvent(token: string, eventId: string): Promise<void>
// DELETE https://graph.microsoft.com/v1.0/me/events/{eventId}

// Pull incremental via deltaLink (Microsoft Graph delta query).
listOutlookEventsDelta(token: string, calendarId: string, deltaLink?: string): Promise<{ value: OutlookEvent[], '@odata.deltaLink'?: string, '@odata.nextLink'?: string }>
// GET https://graph.microsoft.com/v1.0/me/calendars/{calendarId}/events/delta (initial)
// OU GET <deltaLink> directement (incremental)

// Webhook : crée une subscription (renewal max 4230 minutes = ~3 jours).
createOutlookSubscription(token: string, calendarId: string, opts: { webhookUrl: string, clientState: string, expirationDateTime: string }): Promise<{ id: string, expirationDateTime: string }>
// POST https://graph.microsoft.com/v1.0/subscriptions
// Body: { changeType: 'created,updated,deleted', notificationUrl, resource: `/me/calendars/${calendarId}/events`, expirationDateTime, clientState }
// clientState = secret partagé (HMAC validé au webhook), réutilise env.WEBHOOK_SECRET.

// Renewal subscription (à appeler avant expiration, idéalement T-12h).
renewOutlookSubscription(token: string, subscriptionId: string, newExpiration: string): Promise<void>
// PATCH https://graph.microsoft.com/v1.0/subscriptions/{id}
// Body: { expirationDateTime: newExpiration }

// Delete subscription.
deleteOutlookSubscription(token: string, subscriptionId: string): Promise<void>
// DELETE https://graph.microsoft.com/v1.0/subscriptions/{id}
```

**Rate-limit-aware** (calque GBP) : 429 → `await sleep(parseInt(retryAfter) * 1000)` + 1 retry max. 401 → tentative refresh token puis 1 retry. 412 Precondition Failed (ETag mismatch) → marquer conflit dans `appointment_sync.conflict_status='detected'` au lieu de retry.

### §6.4 Engine `calendar-sync.ts` (push, pull, LWW, webhooks)

`src/worker/lib/calendar-sync.ts` — moteur central de synchronisation. Trois fonctions principales :

#### `pushAppointmentToExternal(env, appointment, connection): Promise<{ pushed: boolean, externalEventId?: string, conflict?: boolean }>`

Appelée à chaque `INSERT/UPDATE/DELETE` sur `appointments` (hook posé dans `src/worker/appointments.ts` après commit D1) :

1. Vérifie `connection.sync_direction in ['push', 'bidirectional']` → sinon skip.
2. **Anti-loop guard** : lit `appointment_sync.last_pulled_at` pour ce couple `(appointment_id, calendar_connection_id)`. Si `last_pulled_at > now() - 30s` → SKIP (l'appointment vient d'être pull-é, le push créerait une boucle).
3. Charge le mapping `appointment_sync` :
   - Si `external_event_id` existe + mutation = `UPDATE` → `updateGcalEvent` ou `updateOutlookEvent` avec ETag stocké → si 412 conflict → marquer `conflict_status='detected'` + return `{ pushed: false, conflict: true }`.
   - Si `external_event_id` existe + mutation = `DELETE` → `deleteGcalEvent` ou `deleteOutlookEvent`.
   - Sinon (`INSERT` ou pas de mapping) → `createGcalEvent` ou `createOutlookEvent` + INSERT `appointment_sync` + INSERT `calendar_external_events`.
4. UPDATE `appointment_sync.last_pushed_at = now()`, `last_known_intralys_updated_at = appointment.updated_at`, `last_known_external_etag = response.etag`.
5. INSERT `audit_log` `{ entity: 'appointment', entity_id, action: 'push_to_external', source: 'intralys', target: provider, status: 'success' }`.

#### `pullExternalToAppointments(env, connection): Promise<{ pulled: number, conflicts: number }>`

Appelée par webhook handler OU cron horaire :

1. Si `connection.last_sync_token` existe → incremental sync (`listGcalEvents({ syncToken })` ou `listOutlookEventsDelta(deltaLink)`).
   - Google 410 Gone (token >30 jours) → fallback full list + stocker nouveau `nextSyncToken`.
2. Sinon → full list initiale (max 250 events / page) + stocker `nextSyncToken` / `@odata.deltaLink`.
3. Pour chaque event externe retourné :
   - **Anti-loop guard** : lookup `appointment_sync` par `external_event_id`. Si `last_pushed_at > now() - 30s` → SKIP (Intralys vient de push, on recevrait juste l'echo du push).
   - **LWW conflict detection** : compare `event.external_updated_at` avec `last_known_external_etag` stocké.
     - Si event existe déjà côté Intralys ET `appointment.updated_at > event.external_updated_at` (Intralys plus récent) ET pas d'égalité parfaite → SKIP (Intralys gagne, on attendra le prochain push).
     - Si égalité parfaite seconde-près `appointment.updated_at == event.external_updated_at` → SKIP (Intralys gagne par convention, conservatif).
     - Sinon (external plus récent OU pas encore mappé) → procéder.
   - UPSERT `calendar_external_events` (insert si nouveau, update sinon).
   - Mapping :
     - Si event nouveau côté Intralys → INSERT `appointments` (mapping `summary→title`, `start/end→start_at/end_at`, `attendees→participants_json`, etc.) + INSERT `appointment_sync(appointment_id, calendar_connection_id, external_event_id)`.
     - Si event existe + delta détecté → UPDATE `appointments` correspondant.
     - Si `event.isCancelled === true` ou `event.deleted === true` → UPDATE `appointments SET status='cancelled'` (soft-delete, pas DELETE hard pour préserver historique).
   - UPDATE `appointment_sync.last_pulled_at = now()`, `last_known_external_etag = event.etag`.
   - INSERT `audit_log` `{ entity: 'appointment', entity_id, action: 'pull_from_external', source: provider, target: 'intralys', status: 'success' }`.
4. UPDATE `calendar_connections.last_sync_token = nextSyncToken`, `last_synced_at = now()`.
5. Return `{ pulled: N, conflicts: M }`.

#### LWW (Last-Write-Wins) — conservatif Intralys gagne en cas d'égalité

Règle figée :

- Comparaison faite sur `appointment.updated_at` (ISO 8601 second-precision côté Intralys, normalisé UTC) vs `event.external_updated_at` (ISO 8601 normalisé UTC).
- **Si `intralys > external`** → Intralys gagne, push prioritaire au prochain tick.
- **Si `external > intralys`** → External gagne, pull applique le changement.
- **Si `intralys == external` (seconde près)** → **Intralys gagne** (conservatif). Logique : la source de vérité interne est privilégiée, évite les flips imprévisibles si race condition réseau.
- En cas de conflit **détecté** (mutation simultanée des deux côtés dans une fenêtre 30s, détectée via comparaison `last_known_external_etag` ≠ `event.etag` ET `appointment.updated_at` ≠ `last_known_intralys_updated_at`) → `appointment_sync.conflict_status='detected'`, mutation SKIPPED, surfaced dans `handleListConflicts` pour résolution manuelle UI.

#### Webhooks push notifications

- **Google Calendar `events.watch`** :
  - Channel créé à la connexion + renewal cron quotidien (T-24h avant expiration max 7 jours).
  - Webhook receiver `POST /api/webhooks/calendar-sync/google` (PUBLIC, hors-try) :
    - Vérifie header `X-Goog-Channel-Token === env.WEBHOOK_SECRET` → 401 si mismatch.
    - Lookup `calendar_connections` par `webhook_channel_id = X-Goog-Channel-ID` → 404 si absent.
    - Trigger `pullExternalToAppointments(env, connection)` async (ne bloque pas la réponse webhook — Google retry si 5xx, on répond 200 immédiat).
    - Return 200 OK.
- **Microsoft Graph Subscriptions** :
  - Subscription créée à la connexion + renewal cron toutes les 6h (T-12h avant expiration max 3 jours).
  - Webhook receiver `POST /api/webhooks/calendar-sync/outlook` (PUBLIC, hors-try) :
    - **Validation initiale** : si query `?validationToken=...` présent (handshake MS Graph) → return `validationToken` en text/plain 200 OK dans les 10 secondes.
    - Sinon body `{ value: [{ subscriptionId, clientState, resource, changeType, ... }] }` :
      - Vérifie `clientState === env.WEBHOOK_SECRET` → 401 si mismatch.
      - Lookup `calendar_connections` par `webhook_channel_id = subscriptionId` → 404.
      - Trigger `pullExternalToAppointments(env, connection)` async.
      - Return 202 Accepted.

### §6.5 Handlers `calendar-integrations.ts` (6 handlers)

`src/worker/calendar-integrations.ts` :

1. **`handleListConnections(env, auth)`** — GET `/api/calendar/connections` → liste D1 `calendar_connections WHERE client_id=?` avec join `oauth_connections.account_email`. Retourne `{ connections: [{ id, provider, account_email, intralys_calendar_id, external_calendar_id, external_calendar_summary, sync_direction, status, last_synced_at }] }`. Cap `settings.manage`.

2. **`handleDisconnect(request, env, auth, connectionId)`** — DELETE `/api/calendar/connections/:connectionId` :
   - Lookup `calendar_connections.id = ? AND client_id=?` → 404 si absent.
   - Stop webhook (Google `channels/stop` OU MS Graph `DELETE /subscriptions/{id}`) — best-effort.
   - UPDATE `calendar_connections SET status='revoked', updated_at=now()`.
   - Si c'est la dernière connexion pour ce `(client_id, provider)` → UPDATE `oauth_connections SET status='revoked'` + revoke OAuth provider.
   - INSERT `audit_log` `{ action: 'calendar_disconnect' }`.
   - Cap `settings.manage`.

3. **`handleListExternalCalendars(env, auth, provider)`** — GET `/api/calendar/external-calendars?provider=google_calendar|outlook` :
   - Lookup `oauth_connections WHERE client_id=? AND provider=?` → 400 `{ error: 'not_connected' }` si absent.
   - Refresh token via `getCalendarOauthAccessToken`.
   - Appel `listGcalCalendars(token)` ou `listOutlookCalendars(token)`.
   - Retourne `{ calendars: [{ id, summary, primary, accessRole }] }` (format normalisé).
   - Cap `settings.manage`.

4. **`handleSyncNow(request, env, auth, connectionId)`** — POST `/api/calendar/connections/:connectionId/sync-now` :
   - Lookup `calendar_connections.id = ? AND client_id=?`.
   - Rate-limit : max 1×/2min par connexion (sentinel KV `RATE_LIMITER`).
   - Trigger synchrone `pullExternalToAppointments(env, connection)`.
   - Retourne `{ pulled: N, conflicts: M, last_synced_at }`.
   - Cap `settings.manage`.

5. **`handleListConflicts(env, auth)`** — GET `/api/calendar/conflicts?status=detected|all&limit=50` :
   - Lookup `appointment_sync WHERE conflict_status != 'none'` joint à `appointments` + `calendar_external_events` pour reconstituer les deux versions.
   - Retourne `{ conflicts: [{ id, appointment, external_event, last_pushed_at, last_pulled_at, detected_at, provider }] }`.
   - Cap `settings.manage`.

6. **`handleResolveConflict(request, env, auth, syncId)`** — POST `/api/calendar/conflicts/:syncId/resolve` body `{ resolution: 'keep_intralys' | 'keep_external' | 'merge_manual', merged_event? }` :
   - Lookup `appointment_sync.id = ?` → 404 si absent.
   - `keep_intralys` → force push `pushAppointmentToExternal` ignorant ETag (force overwrite côté external). UPDATE `conflict_status='resolved_intralys'`.
   - `keep_external` → applique `calendar_external_events → appointments` (UPDATE Intralys depuis l'external version). UPDATE `conflict_status='resolved_external'`.
   - `merge_manual` (avec body `merged_event`) → UPDATE `appointments` avec `merged_event` + push vers external. UPDATE `conflict_status='resolved_manual'`.
   - UPDATE `conflict_resolved_at=now()`, `conflict_resolved_by_user_id=auth.userId`.
   - INSERT `audit_log` `{ action: 'calendar_conflict_resolved', metadata: { resolution } }`.
   - Cap `settings.manage`.

Idiome standard de chaque handler (calque Sprint 32) :

```ts
const connection = await env.DB.prepare(
  `SELECT * FROM calendar_connections WHERE id=? AND client_id=? AND status='active'`
).bind(connectionId, auth.clientId).first();
if (!connection) return { success: false, error: 'connection_not_found' };
```

Capabilities **réutilisées** depuis `ALL_CAPABILITIES` : `settings.manage` (toutes les routes). **Zéro nouvelle capability ajoutée.**

### §6.6 Routes worker (8 authed + 4 PUBLIC : 2 callbacks + 2 webhooks)

Câblées dans `src/worker.ts` dans le bloc protégé post-`requireAuth`, sauf les 2 OAuth callbacks + 2 webhooks qui vont dans le bloc PUBLIC hors-try (calque G4/GBP) :

**PUBLIC (hors-try, avant `requireAuth`)** :

```
GET    /api/oauth/google_calendar/callback                       → handleOauthCallback(provider='google_calendar')
GET    /api/oauth/outlook/callback                               → handleOauthCallback(provider='outlook')
POST   /api/webhooks/calendar-sync/google                        → handleGcalWebhookNotification
POST   /api/webhooks/calendar-sync/outlook                       → handleOutlookWebhookNotification (gère validationToken handshake)
```

**PROTÉGÉ (post-`requireAuth`)** :

```
GET    /api/oauth/google_calendar/authorize                      → handleOauthAuthorize(provider='google_calendar')
GET    /api/oauth/outlook/authorize                              → handleOauthAuthorize(provider='outlook')
DELETE /api/oauth/google_calendar/connection                     → handleDisconnect(provider='google_calendar')
DELETE /api/oauth/outlook/connection                             → handleDisconnect(provider='outlook')
GET    /api/calendar/connections                                 → handleListConnections
DELETE /api/calendar/connections/:connectionId                   → handleDisconnect
GET    /api/calendar/external-calendars                          → handleListExternalCalendars
POST   /api/calendar/connections/:connectionId/sync-now          → handleSyncNow
GET    /api/calendar/conflicts                                   → handleListConflicts
POST   /api/calendar/conflicts/:syncId/resolve                   → handleResolveConflict
POST   /api/calendar/connections                                 → handleCreateConnection (associe oauth_connections → calendar_id Intralys + external_calendar_id)
```

Total : **4 PUBLIC (2 callbacks + 2 webhooks) + 11 PROTÉGÉS** dont 8 spécifiques sync calendar + 4 OAuth-related (2 authorize + 2 disconnect — l'item §6.5 « 6 handlers » couvre les handlers métier, les 2 authorize + 2 disconnect réutilisent les handlers OAuth génériques).

Style `await import('./calendar-integrations')` dynamique (calque bloc voisin G4/GBP).

### §6.7 i18n ~18 clés `calendar_sync.*` × 4 catalogues

Bloc ajouté en parité stricte dans `fr-CA`, `fr-FR`, `en`, `es` :

```
calendar_sync.connect.title
calendar_sync.connect.description
calendar_sync.connect.google.cta
calendar_sync.connect.outlook.cta
calendar_sync.connect.connected_as              {email}
calendar_sync.connect.disconnect
calendar_sync.calendars.select_external         (Choisir le calendrier externe à synchroniser)
calendar_sync.calendars.select_intralys         (Choisir le calendrier Intralys à mapper)
calendar_sync.calendars.create_mapping_cta
calendar_sync.status.synced                     {time} (synchronisé il y a X min)
calendar_sync.status.syncing
calendar_sync.status.error
calendar_sync.status.reauth_required            (Reconnexion requise)
calendar_sync.sync_now_cta
calendar_sync.sync_now_success                  {pulled} événements synchronisés
calendar_sync.conflicts.title
calendar_sync.conflicts.empty
calendar_sync.conflicts.count                   {count} conflit(s) à résoudre
calendar_sync.conflicts.detected_at             {time}
calendar_sync.conflicts.keep_intralys           (Garder la version Intralys)
calendar_sync.conflicts.keep_external           (Garder la version {provider})
calendar_sync.conflicts.merge_manual            (Fusionner manuellement)
calendar_sync.conflicts.resolved
calendar_sync.error.not_connected
calendar_sync.error.webhook_unreachable
calendar_sync.error.rate_limit                  (Réessayez dans quelques minutes)
calendar_sync.error.token_expired               (Reconnectez votre compte)
```

Tutoiement fr-CA (`Connecte ton Google Calendar`, `Tes conflits`), vouvoiement fr-FR (`Connectez votre Google Calendar`, `Vos conflits`). Parité stricte vérifiée par `bun run test:i18n:parity` (Sprint S6).

### §6.8 Composants frontend

Skeletons à créer dans `src/components/calendar-sync/` (Manager-C remplira) :

- **`CalendarConnectButtons.tsx`** — boutons CTA dual provider. État `disconnected` → bouton `Connecter Google Calendar` + bouton `Connecter Outlook`. État `connected` (par provider) → badge `Connecté en tant que {email}` + bouton `Déconnecter`. Déclenche redirect `/api/oauth/google_calendar/authorize` ou `/api/oauth/outlook/authorize`.
- **`CalendarSyncStatusBadge.tsx`** — pastille d'état pour chaque mapping calendar. États : `synced il y a X min` (vert), `syncing` (jaune spinner), `error` (rouge avec tooltip raison), `reauth_required` (orange avec CTA reconnect).
- **`CalendarSyncSettings.tsx`** — panneau settings global :
  - Liste des mappings actifs (`CalendarSyncStatusBadge` × N).
  - Pour chaque mapping : selector `intralys_calendar_id` (liste `calendars` Intralys) ↔ selector `external_calendar_id` (liste retournée par `handleListExternalCalendars`), toggle `sync_direction` (push/pull/bidirectional), bouton `Synchroniser maintenant` (déclenche `handleSyncNow`), bouton `Supprimer mapping` (déclenche `handleDisconnect`).
  - Bouton `+ Créer un nouveau mapping` → modal de sélection (provider → external_calendar → intralys_calendar → sync_direction).
- **`CalendarConflictResolver.tsx`** — modal/page de résolution des conflits :
  - Liste des conflits (`handleListConflicts`).
  - Pour chaque conflit : affichage side-by-side de la version Intralys (`appointments` row) vs la version externe (`calendar_external_events` row) avec diff visuel sur les champs divergents (summary, start, end, location, attendees).
  - Boutons `Garder Intralys` / `Garder {provider}` / `Fusionner manuellement` (déclenche form de merge avec champs éditables) → POST `/api/calendar/conflicts/:syncId/resolve`.

**Interdit** : tout composant qui collecte directement le `refresh_token` Google/Microsoft côté front (PCI-équivalent pour OAuth). Le flow passe **uniquement** par les redirections `/api/oauth/{google_calendar|outlook}/authorize`.

## Garde-fous

### Anti-loop guard 30 secondes

Pivot critique pour éviter les boucles infinies push↔pull :

- **Push side** : avant chaque `pushAppointmentToExternal`, vérifier `appointment_sync.last_pulled_at > now() - 30s` → SKIP. Logique : si l'appointment vient juste d'être pull-é depuis l'external, le push correspondant créerait l'echo qui re-pull (boucle).
- **Pull side** : avant d'appliquer chaque `calendar_external_events` à `appointments`, vérifier `appointment_sync.last_pushed_at > now() - 30s` → SKIP. Logique : si Intralys vient juste de push, le pull recevra l'echo du push lui-même (les webhooks Google/MS Graph notifient même les mutations issues du même OAuth token).
- Fenêtre 30s = compromise entre fiabilité (assez pour absorber le round-trip réseau + propagation Google/MS Graph) et réactivité (assez court pour ne pas bloquer une mutation user légitime intervenant >30s après le pull initial).

### LWW conservatif (Intralys gagne égalité)

Voir §6.4 LWW. Justification : si `intralys.updated_at == external.updated_at` à la seconde près, c'est une race condition serveur (les deux ont muté quasi-simultanément). Trancher en faveur d'Intralys = comportement déterministe + privilégie la source de vérité interne (workflows Intralys, validations, hooks). L'utilisateur garde toujours la possibilité de résoudre manuellement via `CalendarConflictResolver` s'il préfère la version external.

### Webhook signature / clientState validation

- **Google Calendar webhook** : header `X-Goog-Channel-Token` doit matcher `env.WEBHOOK_SECRET` (configuré au moment du `createGcalWatchChannel`). Mismatch → 401 + log `audit_log { action: 'webhook_signature_invalid', source: 'gcal' }`.
- **Microsoft Graph webhook** : body `clientState` doit matcher `env.WEBHOOK_SECRET` (configuré au moment du `createOutlookSubscription`). Mismatch → 401 + log identique.
- **Anti-replay** : pas de nonce/timestamp dans Google/MS Graph notifications (limitation upstream) — protection limitée à la rotation périodique du `WEBHOOK_SECRET` (recommandée 1×/an, ré-création de tous les channels/subscriptions à ce moment-là).
- **Validation initiale MS Graph** : si webhook reçoit `?validationToken=` (handshake initial à la création de subscription), répondre le token tel quel en `text/plain 200 OK` dans les 10 secondes — sinon Microsoft refuse la création de subscription.

### Audit log toute mutation

Chaque mutation push/pull/conflict resolved INSERT dans `audit_log` (seq5 + seq121 indexes) :

```sql
INSERT INTO audit_log (client_id, user_id, entity_type, entity_id, action, source, target, status, metadata_json, created_at)
VALUES (?, ?, 'appointment', ?, 'push_to_external'|'pull_from_external'|'conflict_detected'|'conflict_resolved_intralys'|'conflict_resolved_external'|'conflict_resolved_manual',
        'intralys'|'gcal'|'outlook', 'intralys'|'gcal'|'outlook', 'success'|'failure', ?, datetime('now'));
```

`source` / `target` permet de tracer la direction du flux. `metadata_json` contient l'ETag avant/après, le `external_event_id`, le diff de champs (pour debugging).

### Refresh tokens chiffrés + logs sanitization

- `access_token` + `refresh_token` Google/Outlook stockés dans `oauth_connections` **chiffrés AES-GCM** via `encryptToken(env, plaintext)` (clé `env.TOKEN_KEY`). Fallback clair si `TOKEN_KEY` absent (limite documentée — interdit en prod, cf. `SECRET-STORE-S7.md`).
- Logs sanitization : `gcal-client.ts` + `outlook-client.ts` ne log jamais `ya29.xxx` (Google access token), `1//xxx` (Google refresh token), ni `EwBwA...` (MS Graph access token) — utiliser `[REDACTED]` (calque audit_log seq121).

### Rate-limit external API

- **Google Calendar API** : quota 1M requests/jour/projet OAuth + 10 QPS user. Cron pull borné 10 tenants/tick `*/5min`. 429 → backoff exponentiel 1s/2s/4s max 3 retries.
- **Microsoft Graph** : limites variables par tenant (typique 10000 requests/10min/user). 429 retourné avec header `Retry-After` → respecter strictly.
- **Webhook receivers** : pas de rate-limit applicatif (Google/MS Graph se charge du throttling upstream), mais log les volumes pour détection d'anomalie.

## Hors-scope

- **Multi-comptes par provider et par tenant** (1 tenant connecte 2 comptes Google Calendar distincts ou 2 comptes Outlook distincts) → v2. v1 = 1 connexion `google_calendar` + 1 connexion `outlook` par `client_id`.
- **iCal / CalDAV générique** (autres providers que Google/Microsoft) → v2 ou v3.
- **Conflict UI avancée** (merge field-by-field side-by-side avec history timeline, suggestions IA de fusion, undo) → v2. v1 = `CalendarConflictResolver` simple keep_intralys / keep_external / merge_manual basique.
- **Working hours sync** (synchro des `availability_rules` seq32 Intralys vers les working hours Google/Outlook) → v2. v1 = sync events uniquement, pas working hours.
- **Recurring events fidélité 100%** : `recurrence_rule` (RRULE iCalendar) est stocké brut côté `calendar_external_events` mais le mapping bidirectionnel des exceptions / overrides récurrents n'est pas garanti 100% v1 (cas edge déclaré known-issue, à raffiner v2).
- **All-day events vs timed events distinction stricte** : v1 traite tout comme `dateTime` (timed). Si event externe est `date`-only (all-day Google) → converti en `00:00:00 → 23:59:59` tenant timezone. v2 introduira distinction native.
- **Calendar sharing / délégation** (Google delegate calendars, Outlook shared calendars) → v2.
- **Free/busy queries** vers external (pour scheduling intelligence avec dispo external visible) → v2.
- **Real-time notification UI** quand un pull arrive (toast `Nouveau RDV ajouté depuis Google`) → v2 (utilise WebSocket DO `NOTIFICATION_ROOMS` Sprint 46 M3.4 si présent).
- **Conflict resolution policy par tenant** (override LWW par tenant : `intralys_always_wins` vs `external_always_wins` vs `manual_only`) → v2. v1 = LWW conservatif Intralys gagne hardcodé.

## Plan validation (12 étapes du Chaman §6)

Checklist Rochdi après `wrangler deploy` Sprint 33 + secrets configurés + Azure App créé + GCal write app créé (ou scope ajouté à app existante) :

1. **OAuth Google Calendar connect** : naviguer `/settings/integrations/calendar-sync` → cliquer `Connecter Google Calendar` → redirect Google → autoriser scope `calendar` (vérifier que l'écran affiche bien `Full read/write access`, pas juste `Read-only`) → callback OK → badge `Connecté en tant que rochdi@intralys.com`.
2. **OAuth Outlook connect** : cliquer `Connecter Outlook` → redirect Microsoft → connexion compte M365 → consent `Calendars.ReadWrite + offline_access + User.Read` → callback OK → badge `Connecté en tant que rochdi@intralys-tenant.onmicrosoft.com`.
3. **List external calendars** : pour chaque provider, ouvrir le selector → vérifier que la liste des calendriers retournée correspond à ceux visibles dans Google Calendar / Outlook (incluant `Primary` + tout calendrier custom).
4. **Create mapping** : sélectionner `Primary` (external) ↔ `calendar Intralys` test, `sync_direction=bidirectional` → cliquer `Créer mapping` → `calendar_connections` row INSERTed avec `status='active'` + webhook subscription créée (vérifier en D1).
5. **Push test (Intralys → external)** : créer un appointment dans Intralys (`/appointments/new`) `Test Push 1`, start dans 1h, end dans 2h. Vérifier dans Google Calendar / Outlook que l'event apparaît en <30s.
6. **Pull test (external → Intralys)** : créer un event manuellement dans Google Calendar `Test Pull 1` (ou Outlook). Vérifier que l'appointment apparaît dans Intralys en <2min (latence webhook + cron fallback).
7. **Update push** : modifier l'appointment `Test Push 1` côté Intralys (changer le summary). Vérifier que l'update propage côté external en <30s.
8. **Update pull** : modifier l'event `Test Pull 1` côté external (changer le start). Vérifier que l'appointment Intralys reflète le nouveau start en <2min.
9. **Delete push** : supprimer un appointment côté Intralys. Vérifier event disparaît côté external.
10. **Conflict détection** : modifier le même event simultanément des deux côtés (race window <30s) — Intralys side changer summary, external side changer location, sauvegarder les deux dans la même seconde. Vérifier que `appointment_sync.conflict_status='detected'` + l'item apparaît dans `/calendar/conflicts`.
11. **Conflict resolution** : ouvrir `CalendarConflictResolver` → choisir `Keep Intralys` → vérifier que la version Intralys est ré-poussée vers external (force overwrite) + `conflict_status='resolved_intralys'` + audit_log entry présent.
12. **Disconnect cleanup** : cliquer `Déconnecter` Google Calendar → vérifier `calendar_connections.status='revoked'` + webhook channel stoppé (vérifier `https://www.googleapis.com/calendar/v3/channels/stop` retourne 204) + `oauth_connections.status='revoked'` + best-effort revoke OAuth token côté Google passée. Répéter pour Outlook (DELETE `/subscriptions/{id}`).

Si tout est vert → Sprint 33 validé, rollout beta tenants éligibles ayant déjà un compte Google ou M365 actif.

## Cross-references

- `LOT-OAUTH-G4.md` — Sprint G4 seq95 (table `oauth_connections`, flow OAuth Google base provider `google`, helpers `encryptToken`/`decryptToken`)
- `LOT-GBP-S32.md` — Sprint 32 seq127 (provider Google `google_business`, calque OAuth callback pattern, helpers `getOauthAccessToken` réutilisés)
- `BINDINGS-SECRETS-S10.md` §« Sprint 33 — Calendar Sync bindings » — `MS_OAUTH_CLIENT_ID/SECRET/TENANT` (NEW) + `GCAL_SYNC_OAUTH_CLIENT_ID/SECRET` (NEW optionnels)
- `OUTLOOK-OAUTH-SETUP-S33.md` — guide setup Azure App registration step-by-step
- `SECRET-STORE-S7.md` — `TOKEN_KEY` AES-GCM (chiffrement tokens Google/Outlook calendar)
- `migrations-manifest.json` seq128 — ordre canonique migration calendar sync
- `migration-phase24.sql` seq32 — table `calendars` + `appointments` + `availability_rules` (parent tables)
