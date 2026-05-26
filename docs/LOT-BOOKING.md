# LOT BOOKING — moteur de réservation client pro (niveau GHL / Calendly)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> disjoints — §6.H). Non exécuté (VM VMware sans bun/node) — Antigravity
> buildera côté hôte. Modèle : `docs/LOT-FUNNEL.md`. **Phase B/C ne lisent
> QUE ce document** (+ le CODE, jamais le brief).

Architecture figée par le Chaman (NE PAS réinventer) :
- Tables `booking_pages` + `bookings` EXISTENT (seq **7**,
  `migration-phase7.sql`) — NON recréées. `appointments` EXISTE (seq **4**
  `migration-phase4.sql`, enrichie seq **32** `migration-phase24.sql`).
  `availability_rules` / `date_overrides` / `calendars` EXISTENT (seq **32**).
- Migration seq **84** = STRICTEMENT ADDITIVE (ALTER ADD COLUMN + 1 table
  neuve `booking_event_types`). Le CHECK status `bookings` seq 7
  (`confirmed|cancelled|completed|no_show`, SANS `pending`) est
  **INTOUCHABLE** (modifier un CHECK ⇒ rebuild ⇒ INTERDIT). CHECK role
  seq 59 INTOUCHÉ. Zéro FK / DROP / RENAME. `price_cents` POSÉ INACTIF.
- Moteur de créneaux = fichier **NEUF/ISOLÉ** `src/worker/booking-public.ts`
  (n'étend PAS `bookings.ts`). `src/worker/calendar.ts:handleGetAvailability`
  (vue interne `Calendar.tsx`) reste **INTACT** — zéro régression.
- Capability = **RÉUTILISE `workflows.manage`** (déjà dans
  `ALL_CAPABILITIES`). NE PAS ajouter de capability (liste FIGÉE seq 80).
- Booking→lead = **RÉUTILISE le pipeline `src/worker/forms.ts`** (helpers
  cités §6.F). NE PAS dupliquer la logique dedup.
- Page publique = SPA `/book/$slug` (calque EXACT `publicFunnelRoute
  /p/$slug` — hors LazyGuard/auth). Réglages `/booking-settings` PROTÉGÉ
  (calque `settingsRoute`).

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS (rappel)

`src/lib/api.ts:62-112` (`apiFetch`) + le type `ApiResponse<T>`
(`src/lib/types.ts:510` — forme `{ data?, error?, success? }`) sont **GELÉS**.
Phase A ne les a PAS modifiés ; Phase B/C ne les touchent PAS. Décision
**DÉFINITIVE** :

- Réponses succès = **`json({ data: ... })`** ; erreurs =
  **`json({ error: '...' }, status)`**. **JAMAIS de champ `code`** — la
  discrimination front est string-match sur `error`.
- Helpers PROTÉGÉS (CRUD types de RDV) : via `apiFetch` (auth Bearer +
  `X-Sub-Account` injectés).
- Helpers PUBLICS (`/book/:slug...`) : via `fetch` brut `${API_BASE}/book/...`
  (calque EXACT `getPublicFunnel`/`submitPublicFunnel` `src/lib/api.ts` —
  pas d'auth, retour normalisé `{ data } | { error }`, `t('api.unavailable')`
  sur exception).

Helpers ADDITIFS créés Phase A dans `src/lib/api.ts` (section « LOT
BOOKING », juste après `getBookings`) — signatures FIGÉES, Phase C les
CONSOMME tels quels :

```
getBookingAvailability(slug, date, eventTypeId?): ApiResponse<{slots:string[]}>     GET  /book/:slug/availability?date=&event_type_id=  (public)
createPublicBooking(slug, {event_type_id?,start_time,guest_name,guest_email,guest_phone?,notes?,data?}): ApiResponse<PublicBooking>  POST /book/:slug   (public)
cancelPublicBooking(slug, {booking_id,reason?}): ApiResponse<{success}>             POST /book/:slug/cancel       (public)
reschedulePublicBooking(slug, {booking_id,start_time}): ApiResponse<PublicBooking>  POST /book/:slug/reschedule   (public)
getBookingEventTypes(bookingPageId?): ApiResponse<BookingEventType[]>               GET  /booking-event-types     (protégé)
createBookingEventType(data): ApiResponse<{id}>                                     POST /booking-event-types     (protégé)
updateBookingEventType(id, updates): ApiResponse<{success}>                         PUT  /booking-event-types/:id (protégé)
deleteBookingEventType(id): ApiResponse<{success}>                                  DELETE /booking-event-types/:id (protégé)
```

Types ADDITIFS figés `src/lib/api.ts` (section LOT BOOKING) :
`BookingEventType`, `BookingSlot`, `PublicBooking` — gelés, Phase C les
importe, NE crée AUCUN type concurrent. `BookingEventType.price_cents` =
champ POSÉ mais **INACTIF** (aucun usage paiement front/back v1).

### §6.B — DDL seq 84 + conventions + tables réutilisées

Fichier : `migration-booking-seq84.sql` — seq **84**,
`depends_on: migration-funnel-seq83.sql`. Entrée manifest ajoutée
(`docs/migrations-manifest.json` seq 84, risk `low`,
`objects: ["alter:booking_pages","alter:bookings","table:booking_event_types"]`).

Conventions (calque seq 83) : id `TEXT PK DEFAULT (lower(hex(randomblob(16))))`,
timestamps `TEXT DEFAULT (datetime('now'))`, **zéro FK**, `IF NOT EXISTS`
idempotent (table neuve), PAS d'unixepoch/INTEGER autoincrement. STRICTEMENT
additif : `ALTER ... ADD COLUMN` + 1 `CREATE TABLE/INDEX IF NOT EXISTS`.
AUCUN ALTER de contrainte / DROP / RENAME / rebuild. Tolérance
duplicate-column / best-effort (header du fichier verbatim).

**Tables EXISTANTES réutilisées (seq lues sur disque — NON recréées)** :

- **`booking_pages`** (seq 7, `migration-phase7.sql:5-23`) : `id, client_id,
  slug UNIQUE, title, description, duration_minutes, buffer_minutes,
  max_bookings_per_day, available_days, available_hours, **timezone DEFAULT
  'America/Toronto'**, confirmation_message, notification_email, is_active,
  color, created_at, updated_at`. Index `idx_booking_slug` /
  `idx_booking_client`. **+ seq 84 ALTER ADD COLUMN** : `agency_id TEXT`,
  `redirect_url TEXT`, `owner_user_id TEXT`.
- **`bookings`** (seq 7, `migration-phase7.sql:28-46`) : `id, booking_page_id
  (REFERENCES booking_pages — FK PRÉ-EXISTANTE seq 7, NON ajoutée par nous),
  client_id, lead_id, guest_name, guest_email, guest_phone, start_time,
  end_time, **status TEXT CHECK (status IN ('confirmed','cancelled',
  'completed','no_show')) DEFAULT 'confirmed'** — ⚠ INTOUCHABLE, PAS de
  'pending', PAS d'ALTER du CHECK, notes, cancelled_reason, created_at`.
  Index `idx_bookings_page` / `idx_bookings_time` / `idx_bookings_status`.
  **+ seq 84 ALTER ADD COLUMN** : `agency_id TEXT`, `event_type_id TEXT`,
  `reminder_sent_at TEXT`, `rescheduled_from TEXT`.
- **`appointments`** (seq 4 `migration-phase4.sql:5-20` + seq 32
  `migration-phase24.sql:35-43`) : `id, lead_id, client_id, title,
  description, start_time, end_time, location, type, status TEXT CHECK
  (status IN ('scheduled','confirmed','cancelled','completed','no_show')),
  calendly_event_id, notes, created_at, updated_at` + seq 32 :
  `calendar_id, assignee_user_id, attendees_json, conference_link,
  reminder_minutes, buffer_before_min, buffer_after_min, recurring_rule,
  parent_appointment_id`. **NON modifiée par seq 84.**
- **`availability_rules`** (seq 32 `migration-phase24.sql:15-22`) : `id,
  user_id, day_of_week (0=dim..6=sam), start_time ('09:00'), end_time
  ('17:00'), is_active`. **NON modifiée.**
- **`date_overrides`** (seq 32 `migration-phase24.sql:25-32`) : `id,
  user_id, date ('YYYY-MM-DD'), is_available (0=bloqué), reason,
  created_at`. Jours fériés QC pré-seedés (St-Jean, Fête du Canada).
  **NON modifiée.**
- **`calendars`** (seq 32) : non requis par le moteur v1 (lecture
  optionnelle Phase B si besoin). **NON modifiée.**

**Table NEUVE seq 84** (jointures **APPLICATIVES** par colonnes TEXT,
jamais de FK) :

- **`booking_event_types`** : `id TEXT PK lower(hex(randomblob(16))),
  client_id, agency_id, booking_page_id, name DEFAULT 'Rendez-vous',
  description, duration_minutes INT DEFAULT 30, buffer_before_min INT
  DEFAULT 0, buffer_after_min INT DEFAULT 0, **price_cents INT DEFAULT 0 —
  POSÉ INACTIF (aucune logique paiement, v2 sous revue PCI/légale)**,
  slot_step_min INT DEFAULT 30, min_notice_min INT DEFAULT 0, is_active INT
  DEFAULT 1, created_at, updated_at`. Index : client / agency /
  booking_page_id.

Bornage tenant : `client_id` (calque `booking_pages.client_id` seq 7) +
`agency_id` (calque `funnels.agency_id` seq 83 / `quotes.agency_id`
seq 82). `owner_user_id` sur `booking_pages` = utilisateur dont les
disponibilités pilotent le moteur (§6.C).

E4/E6 régulés : **AUCUNE activation paiement**. `price_cents` posé pour
schéma futur uniquement ; v1 n'a NI endpoint paiement, NI lecture de cette
colonne dans un flux transactionnel. Activation = lot ultérieur après revue
PCI/RGPD (`docs/PCI-RGPD-GOLIVE-checklist.md`).

### §6.C — Algorithme de calcul des créneaux (CONTRAT CLÉ)

Fichier `src/worker/booking-public.ts`, fonction
`handleGetBookingAvailability(env, url, slug)`. Le moteur EXISTANT
`bookings.ts:34-39` (calcul anti-conflit en UTC naïf) et
`calendar.ts:132-133` (`new Date(`${dateStr}T${rule.start_time}:00Z`)` —
heure locale traitée comme UTC) sont **FAUX en fuseau**. Le moteur ci-dessous
est NEUF, isolé, CORRECT DST. `calendar.ts:handleGetAvailability` (vue
interne) **reste tel quel** — on ne le corrige PAS (hors périmètre, zéro
régression Calendar.tsx).

**Entrée** : `slug` (path) + `date` (query `YYYY-MM-DD`) + `event_type_id?`
(query, optionnel).

**Résolution** :
1. `booking_pages` WHERE `slug = ? AND is_active = 1` → `page` (404
   `t-equivalent 'booking.public.not_found'` / `{error}` si absente).
2. `event_type` : si `event_type_id` fourni → `booking_event_types` WHERE
   `id = ? AND booking_page_id = page.id AND is_active = 1` ; sinon le
   premier `booking_event_types` actif de la page ; sinon **fallback
   dérivé de la page** (`duration_minutes = page.duration_minutes`,
   `buffer_before_min = 0`, `buffer_after_min = page.buffer_minutes ?? 0`,
   `slot_step_min = 30`, `min_notice_min = 0`).
3. `ownerUserId = page.owner_user_id` ; si NULL → best-effort : premier
   `users.id` rattaché à `page.client_id` (calque résolution admin
   `bookings.ts:60`), sinon set vide ⇒ `{ slots: [] }`.
4. `clientId = page.client_id`. `tz = page.timezone || 'America/Toronto'`.

**Règles de disponibilité** (heure **locale** du fuseau `tz`) :
- `day_of_week` = jour de semaine de `date` **dans `tz`** (0=dim..6=sam).
- `availability_rules` WHERE `user_id = ownerUserId AND day_of_week = ?
  AND is_active = 1` → fenêtres locales `[start_time, end_time]` (ex.
  `'09:00'`–`'17:00'`).
- `date_overrides` WHERE `user_id = ownerUserId AND date = ?` : si trouvé
  et `is_available = 0` ⇒ `{ slots: [] }` (jour bloqué — congé/férié QC).

**Soustraction des occupations** (intervalle `[from,to)` en UTC) sur la
journée `date` :
- `bookings` WHERE `booking_page_id = page.id AND status = 'confirmed'`
  (énumération seq 7 — JAMAIS 'pending') chevauchant le jour.
- `appointments` WHERE `assignee_user_id = ownerUserId AND status IN
  ('confirmed','scheduled')` chevauchant le jour.
- `date_overrides` partiels : v1 = bloc jour entier (binaire
  `is_available`). Pas de plage horaire d'override en v1 (champ absent du
  schéma seq 32). Documenté ainsi — PAS d'extension de schéma.

**Génération** :
- Pas = `event_type.slot_step_min`. Durée du RDV =
  `event_type.duration_minutes`. Tampons =
  `event_type.buffer_before_min` / `buffer_after_min`.
- Pour chaque fenêtre de règle : créneaux candidats à `start_local`
  espacés de `slot_step_min`, tels que
  `start_local + buffer_before` ≥ début fenêtre **et**
  `start_local + duration + buffer_after` ≤ fin fenêtre.
- Rejet si l'intervalle **élargi** `[start - buffer_before,
  start + duration + buffer_after)` (en UTC) chevauche une occupation
  (booking/appointment) OU un override jour bloqué.
- `min_notice_min` : rejet de tout `start` tel que
  `start_utc < now_utc + min_notice_min * 60_000`.

**Conversion locale ↔ UTC DÉTERMINISTE (DST géré)** : NE PAS faire
`new Date(`${date}T${hh}:mm:00Z`)` (bug actuel). Construire l'instant UTC
correspondant à une heure-mur locale `tz` via `Intl.DateTimeFormat` :
calculer l'offset effectif du `tz` à la date considérée
(`Intl.DateTimeFormat('en-US',{timeZone:tz,timeZoneName:'shortOffset'...})`
ou la technique « format les composantes d'une date UTC candidate dans
`tz`, ajuste le delta »), de sorte que `localWallTime(tz)` ↔ `utcInstant`
soit exact aux frontières d'heure d'été (America/Toronto : -05:00 hiver /
-04:00 été). Fonction utilitaire interne au fichier (pas de dépendance
externe — Workers runtime fournit `Intl` avec timeZone).

**Sortie** : `json({ data: { slots: string[] } })` — chaque slot =
`startInstant.toISOString()` (ISO8601 UTC, `…Z`), trié croissant, sans
doublon. Le front re-localise pour l'affichage (§6.G).

**Pseudo-code figé** :
```
page = SELECT * FROM booking_pages WHERE slug=? AND is_active=1            -- 404 si null
et   = resolveEventType(page, event_type_id)                              -- ou fallback page
owner= page.owner_user_id ?? firstUserOf(page.client_id)                  -- {slots:[]} si null
tz   = page.timezone || 'America/Toronto'
dow  = weekdayInTz(date, tz)
ov   = SELECT * FROM date_overrides WHERE user_id=owner AND date=?
if ov && ov.is_available==0 -> return {slots:[]}
rules= SELECT start_time,end_time FROM availability_rules
        WHERE user_id=owner AND day_of_week=dow AND is_active=1
if rules empty -> return {slots:[]}
busy = bookings(status='confirmed', booking_page_id=page.id, jour=date)
     ∪ appointments(assignee_user_id=owner, status IN(confirmed,scheduled), jour=date)
slots=[]
for r in rules:
  winStart = utcInstant(date, r.start_time, tz)
  winEnd   = utcInstant(date, r.end_time,   tz)
  for s = winStart; s + (dur+bufAfter) <= winEnd; s += step:
     if s - bufBefore < winStart: continue
     if s < now + minNotice: continue
     if overlapsAny([s-bufBefore, s+dur+bufAfter), busy): continue
     slots.push(isoZ(s))
return {slots: sortUnique(slots)}
```
(durée/step/buffers en ms ; `dur,step,bufBefore,bufAfter,minNotice`
dérivés de `et`.)

### §6.D — Contrats handlers backend (`src/worker/booking-public.ts`)

Signatures FIGÉES Phase A (worker.ts GELÉ les câble). Phase B écrit
UNIQUEMENT les corps balisés `// STUB PHASE A → corps réel Phase B
Manager-B`, SANS changer signatures ni forme de Response.

**Publics (pré-`requireAuth`, slug résolu côté handler)** :
- `handleGetBookingAvailability(env: Env, url: URL, slug: string)` —
  `GET /api/book/:slug/availability` → `{ data:{ slots:string[] } }`
  (algo §6.C). Best-effort : page absente / owner null ⇒ `{ slots:[] }`
  ou `{error}` 404.
- `handlePublicCreateBookingV2(request: Request, env: Env, slug: string)` —
  `POST /api/book/:slug` → `{ data: PublicBooking }` 201. Vérifie la dispo
  via §6.C (anti double-booking en fuseau), INSERT `bookings` (status
  `'confirmed'` — seq 7), wiring CRM §6.F, projection appointments
  lecture-seule §6.F. Conflit ⇒ `{error}` 409
  (`'booking.error.slot_taken'`-equivalent).
- `handlePublicCancelBooking(request: Request, env: Env, slug: string)` —
  `POST /api/book/:slug/cancel`, body `{booking_id,reason?}` → `{ data:
  {success:true} }`. `UPDATE bookings SET status='cancelled',
  cancelled_reason=? WHERE id=? AND booking_page_id IN (pages du slug)`
  (énumération seq 7). Best-effort.
- `handlePublicRescheduleBooking(request: Request, env: Env, slug: string)`
  — `POST /api/book/:slug/reschedule`, body `{booking_id,start_time}` →
  `{ data: PublicBooking }`. Vérifie nouvelle dispo §6.C, crée le nouveau
  créneau, lie `rescheduled_from` ; l'ancien passe `status='cancelled'`
  (seq 7).

**Protégés (capability `workflows.manage`)** :
- `handleListEventTypes(env, auth, url)` — `GET /api/booking-event-types`
  → `{ data: BookingEventType[] }`.
- `handleCreateEventType(request, env, auth)` —
  `POST /api/booking-event-types` → `{ data:{id} }` 201.
- `handleUpdateEventType(request, env, auth, eventTypeId)` —
  `PUT /api/booking-event-types/:id` → `{ data:{success:true} }`.
- `handleDeleteEventType(env, auth, eventTypeId)` —
  `DELETE /api/booking-event-types/:id` → `{ data:{success:true} }`.

`auth` = `BookingAuth = CapAuth & { capabilities?: Set<string> }` (calque
`FunnelAuth` `funnels.ts:41`). En tête de chaque handler protégé :
`const denied = requireCapability(auth.capabilities, 'workflows.manage');
if (denied) return denied;` (calque `funnels.ts:capGuard` /
`clients-admin.ts`). **Réutilise `workflows.manage`** — AUCUN ajout à
`ALL_CAPABILITIES` (`capabilities.ts:36-49` FIGÉ).

**Bornage tenant** (calque `clients-admin.ts:isLegacy` +
`assertClientInTenant` `clients-admin.ts:30-60` ; cible =
`booking_event_types` / `booking_pages`) :
- Legacy/mono-tenant (`!auth.tenant || auth.tenant.agencyId == null`) →
  PAS de garde nouvelle (endpoints NEUFS, rétro-compat byte-équivalente à
  l'absence historique de borne).
- Mode agence (`agencyId != null`) → l'objet doit avoir
  `client_id ∈ auth.tenant.accessibleClientIds` OU `agency_id ==
  auth.tenant.agencyId`, sinon `json({error:'Introuvable'},404)`.
- best-effort : table/colonne absente → réponse propre (404 / `{data:[]}`),
  JAMAIS de 500/throw.

**Réponses** : `json({data})` / `json({error},status)` UNIQUEMENT (§6.A —
jamais de champ `code`).

### §6.E — Confirmations & rappels (RÉUTILISE l'existant, PAS de scheduler v1)

v1 = **réutilisation stricte** de l'infra existante. **AUCUN nouveau
scheduler**, **PAS de table `booking_reminders`**.

- **Confirmation immédiate** : à la création (`handlePublicCreateBookingV2`),
  notification interne via `createNotification` (déjà importé `bookings.ts:3`,
  calque `bookings.ts:60-63`) + courriel via le helper Resend existant
  (`helpers.ts` — même chemin que les autres envois) et/ou
  `helpers.ts:sendSms` si téléphone fourni. i18n
  `booking.public.confirmed*` / `booking.reminder.*`.
- **Rappels = modèle « workflow-as-reminder »** : le trigger
  `appointment_booked` est DÉJÀ câblé (`bookings.ts:58`
  `autoEnrollForTrigger(env,'appointment_booked',leadId)` ;
  `workflows.ts:328` string-match libre). Un workflow client de type
  `wait` (délai) → `send_sms` / `send_email` joue le rôle de rappel via le
  scheduler EXISTANT (`processWorkflowQueue` / `scheduled()` dans
  `worker.ts`). `bookings.reminder_sent_at` (seq 84) sert d'idempotence si
  un rappel direct minimal est ajouté Phase B (best-effort, optionnel).
- **NE PAS** créer `processBookingReminders` ni de cron dédié en v1.
  **Option B documentée HORS v1** : table `booking_reminders` +
  `processBookingReminders` planifié = lot ultérieur si le modèle
  workflow-as-reminder s'avère insuffisant. Hors périmètre Sprint 3.

### §6.F — Wiring booking → CRM (RÉUTILISE forms.ts, zéro dup dedup)

`handlePublicCreateBookingV2` RÉUTILISE le pipeline canonique de
`src/worker/forms.ts:76-131` (vérifié sur disque) — **PAS de duplication**
de la logique dedup/attribution/consent :

- `applyLeadMapping` — `import('./lead-mapping')` (calque `forms.ts:78,80`) :
  utm_*/gclid/fbclid/referrer + consent depuis le payload.
- `resolveDedup` / `mergeIntoLead` — `import('./lead-dedup')` (calque
  `forms.ts:87-98`) : clé `'email_phone'`, `clientId = page.client_id`.
  Merge enrichit, skip = idempotent, création conservée.
- `logIngestConsent` — `import('./leads')` (calque `forms.ts:79,102,115`).
- INSERT `leads` borné `client_id = page.client_id`, **`source='booking'`**
  (≠ `'form'` / `'funnel'`), colonnes utm/consent comme `forms.ts:105-113`.
- `autoEnrollForTrigger(env, 'appointment_booked', leadId)` — trigger
  EXISTANT déjà câblé (`bookings.ts:58` ; `workflows.ts:328` string-match).
  **RIEN à câbler côté `workflows.ts`** (fichier INTERDIT — §6.H).
- `UPDATE bookings SET lead_id = ? WHERE id = ?` après résolution du lead.

**Réalignement `bookings.ts:51-58`** (Phase B Manager-B, fichier owned) :
l'`INSERT OR IGNORE INTO leads (... 'booking','qualified',
'pipeline-default','stage-qualified')` BRUT sans dedup
(`bookings.ts:52-56`) est remplacé par le pipeline ci-dessus (dedup +
attribution + consent). Comportement legacy `handlePublicCreateBooking`
(ancien endpoint `/api/book` POST) conservé fonctionnellement (rétro-compat)
mais alimente désormais le même pipeline propre. Le statut booking reste
`'confirmed'` (seq 7).

**Projection appointments (lecture-seule, optionnelle, §6.G)** : pour la
visibilité du RDV dans `Calendar.tsx` (vue interne), Phase B PEUT INSERT
une ligne `appointments` (`assignee_user_id = page.owner_user_id`,
`client_id = page.client_id`, `lead_id`, `title`, `start_time`,
`end_time`, `type='meeting'`, `status='confirmed'`) — INSERT pur, **NE
MODIFIE PAS `Calendar.tsx`** (Calendar lit déjà `appointments`). Jointure
applicative, pas de FK.

### §6.G — Fuseaux horaires

- **Source de vérité** : `booking_pages.timezone` (DEFAULT
  `'America/Toronto'`, seq 7). `owner_user_id` (seq 84) désigne
  l'utilisateur dont `availability_rules` / `date_overrides` /
  `appointments` pilotent le moteur.
- **Stockage** : tout instant en **UTC ISO8601** (`bookings.start_time` /
  `end_time`, `appointments.*`) — convention existante.
- **Calcul** : règles de dispo interprétées en heure-mur **locale** du
  `tz`, converties en instants UTC de façon **déterministe DST** (§6.C —
  `Intl.DateTimeFormat`, jamais `…T..:..Z` naïf).
- **Affichage** (front Phase C) : re-localiser les slots ISO UTC dans le
  `tz` de la page (`Intl.DateTimeFormat` côté client), libellé
  `booking.public.timezone_note`.

### §6.H — Matrice de propriété des fichiers Phase B (disjonction STRICTE)

**Manager-B (backend) — owned, EXCLUSIF** :
- `src/worker/booking-public.ts` — CORPS des 8 handlers (stubs Phase A).
- `src/worker/bookings.ts` — UNIQUEMENT le réalignement
  `bookings.ts:51-58` du wiring lead (§6.F). NE PAS toucher les autres
  handlers (`handleGetBookingPages`/Create/Update/Delete/GetBookings) au-
  delà du strict §6.F.

**Manager-C (front) — owned, EXCLUSIF** :
- `src/pages/PublicBooking.tsx` — corps réel (stub Phase A).
- `src/pages/BookingSettings.tsx` — corps réel (stub Phase A).

**GELÉS Phase A — INTERDITS aux deux Managers** (lecture seule) :
`src/worker.ts`, `src/lib/api.ts`, `src/lib/types.ts`, `src/App.tsx`,
`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`, `docs/migrations-manifest.json`,
`migration-booking-seq84.sql`, **`docs/LOT-BOOKING.md`**.

**INTERDITS ABSOLUS aux deux Managers** (zéro régression) :
`src/pages/Calendar.tsx`, `src/worker/workflows.ts`,
`src/worker/calendar.ts` (y compris `handleGetAvailability` — lecture
autorisée, modification INTERDITE), `src/worker/capabilities.ts`
(`ALL_CAPABILITIES` FIGÉ), `src/i18n/*.json` (mort), les 6 pages R.

**Disjonction** : Manager-B ⊂ {backend booking-public.ts + bookings.ts
§6.F} ∥ Manager-C ⊂ {2 pages front}. Aucun fichier partagé entre B et C ⇒
parallélisation sûre, zéro race.

### §6.I — Garde-fous + suites à ne pas régresser

- Strictement ADDITIF. Rétro-compat byte-identique legacy
  (`handlePublicBookingPage` / `handlePublicCreateBooking` /
  `handleGetBookingPages` etc. inchangés sauf wiring §6.F).
- CHECK status `bookings` seq 7 INTOUCHABLE (jamais 'pending', jamais
  d'ALTER du CHECK). CHECK role seq 59 intact. Aucun touch `users`. Zéro
  FK / DROP / RENAME. E4/E6 jamais activés (`price_cents` inactif).
- `apiFetch` / `ApiResponse` GELÉS. NE PAS ajouter à `ALL_CAPABILITIES`
  (réutilise `workflows.manage`). NE PAS dupliquer le pipeline lead
  (réutilise forms.ts §6.F).
- `calendar.ts:handleGetAvailability` (vue interne `Calendar.tsx` via
  `api.ts`) INTACT — le moteur public est NEUF/isolé.
- Suites à ne pas régresser : `src/worker/__tests__/calendar.test.ts`,
  + suites `bookings` / `calendar` / `workflows` / `tenant-context` /
  `forms` / `funnels` (réutilise helpers forms.ts §6.F). Pas de
  build/test côté VM (VMware sans bun/node) — Antigravity buildera/testera
  côté hôte. NE PAS prétendre « vert ».

---

## État Phase A (livré)

Fichiers créés :
- `migration-booking-seq84.sql` — DDL additif (3 ALTER booking_pages +
  4 ALTER bookings + table neuve `booking_event_types` + 3 index).
- `src/worker/booking-public.ts` — 8 stubs signatures FIGÉES.
- `src/pages/PublicBooking.tsx` — stub lazy (export `PublicBookingPage`).
- `src/pages/BookingSettings.tsx` — stub lazy (export `BookingSettingsPage`).
- `docs/LOT-BOOKING.md` — ce document (§6 A→I FIGÉ).

Fichiers modifiés (GELÉS pour Phase B/C ensuite) :
- `docs/migrations-manifest.json` — entrée seq 84.
- `src/worker.ts` — import booking-public + 4 routes publiques (avant le
  GET générique `/api/book/`) + 4 routes protégées booking-event-types.
- `src/lib/api.ts` — section LOT BOOKING : 3 types + 8 helpers
  (`apiFetch`/`ApiResponse` inchangés).
- `src/App.tsx` — 2 lazy imports + `bookingSettingsRoute` (PROTÉGÉ) +
  `publicBookingRoute` `/book/$slug` (public, calque publicFunnelRoute) +
  enregistrement routeTree.
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 58 clés `booking.*` par
  catalogue, parité STRICTE 4 catalogues.

Non touché : `Calendar.tsx`, `workflows.ts`, `calendar.ts`,
`capabilities.ts` (ALL_CAPABILITIES), bookings.ts (réalignement = Phase B),
6 pages R. Non exécuté (VM) — Antigravity build/test côté hôte.
