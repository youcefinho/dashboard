# LOT BOOKING REMINDERS — rappels auto + self-service + no-show (Booking pro completion)

> Phase A SOLO (Manager-A unique) — point irréversible. **§6 FIGÉ** ci-dessous,
> transmis verbatim à Phase B (Manager-B backend ∥ Manager-C front, fichiers
> disjoints — §6.H). Non exécuté (VM VMware sans bun/node) — Antigravity
> buildera/testera côté hôte. Modèle : `docs/LOT-BOOKING.md`. **Phase B/C ne
> lisent QUE ce document** (+ le CODE, jamais le brief).

Sprint resserré, **100% ADDITIF**, qui ferme 3 gaps du moteur de réservation
(seq 84, `docs/LOT-BOOKING.md`) :

1. **Rappels automatiques avant RDV** via **cron dédié**
   (`processBookingReminders`) — offset + canal configurés PAR TYPE DE RDV.
2. **Liens self-service cancel/reschedule** dans l'email de confirmation
   (GAP #2 — implémenté par Manager-B DANS `booking-public.ts`).
3. **No-show tracking** côté `bookings` (horodatage + endpoint protégé).

Architecture figée (NE PAS réinventer) :
- Tables `bookings` (seq 7) + `booking_event_types` (seq 84) EXISTENT — NON
  recréées. `appointments` / `availability_rules` / `date_overrides` (seq 4/32)
  INTACTES.
- Migration seq **103** = STRICTEMENT ADDITIVE (`ALTER ADD COLUMN` seulement).
  Le CHECK status `bookings` seq 7 (`confirmed|cancelled|completed|no_show`,
  SANS `pending`) est **INTOUCHABLE** et **contient DÉJÀ `no_show`** ⇒ le
  no-show tracking n'exige AUCUN ALTER de CHECK, juste `no_show_at`.
- `bookings.reminder_sent_at` EXISTE DÉJÀ (seq 84) ⇒ **réutilisé** pour
  l'idempotence du rappel, NON ré-ajouté.
- Capability = **RÉUTILISE `workflows.manage`** (seq 80). NE PAS ajouter de
  capability (liste FIGÉE seq 80).
- Cron rappels = NOUVEAU job best-effort dans `worker.ts:scheduled()` (calque
  EXACT broadcasts / scheduled-reports / proactive-ai).
- E4/E6 INACTIFS : `price_cents` jamais touché, aucune logique paiement,
  aucune activation Google/Outlook.

---

## §6 Contrats figés

### §6.A — `apiFetch` / `ApiResponse` GELÉS (rappel)

`src/lib/api.ts` (`apiFetch`) + `ApiResponse<T>` (`src/lib/types.ts`) **GELÉS**.
Phase A ne les a PAS modifiés ; Phase B/C ne les touchent PAS.
- Succès = **`json({ data })`** ; erreur = **`json({ error }, status)`**.
  **JAMAIS de champ `code`** — discrimination front string-match sur `error`.
- Helper protégé `markNoShow` (CRUD no-show) via `apiFetch` (auth Bearer +
  `X-Sub-Account` injectés).

Helpers/Types ADDITIFS posés Phase A dans `src/lib/api.ts` — **FIGÉS**, Phase C
les CONSOMME tels quels :

```
markNoShow(bookingId): ApiResponse<{success:boolean}>     POST /bookings/:id/no-show  (protégé)
```

Type `BookingEventType` (déjà défini `src/lib/api.ts` section LOT BOOKING)
**ÉTENDU Phase A** par 2 champs FIGÉS :

```
reminder_offset_min: number          // minutes AVANT le RDV (0 = pas de rappel)
reminder_channel: string | null      // 'email' | 'sms' | 'both' | null
```

Les helpers CRUD `createBookingEventType(data: Partial<BookingEventType>)` /
`updateBookingEventType(id, updates: Partial<BookingEventType>)` (déjà FIGÉS
LOT BOOKING) transportent automatiquement ces 2 champs (Partial). Phase C
branche les champs de formulaire sur ces helpers tels quels — AUCUN nouveau
helper CRUD.

### §6.B — DDL seq 103 + conventions

Fichier : `migration-booking-reminders-seq103.sql` — seq **103**,
`depends_on: migration-telephony-seq102.sql` (dernière migration du manifest =
seq 102, chaînage SÉQUENTIEL, AUCUNE dépendance de schéma réelle). Entrée
manifest ajoutée Phase A (`docs/migrations-manifest.json` seq 103, risk `low`,
`objects: ["alter:booking_event_types","alter:bookings"]`).

> ⚠ `scripts/migrate.ts` STOPPE en erreur dure (§2-D trou 1) sur tout fichier
> `migration-booking-*` présent sur disque mais ABSENT du manifest. L'entrée
> seq 103 est OBLIGATOIRE et a été ajoutée Phase A.

Conventions (calque seq 84) : `ALTER ... ADD COLUMN` purs, timestamps `TEXT`,
compteurs `INTEGER NOT NULL DEFAULT`, **zéro FK**, PAS d'unixepoch/autoincrement.
AUCUN ALTER de contrainte / DROP / RENAME / rebuild. Tolérance duplicate-column
best-effort (motif bénin reconnu par `scripts/migrate.ts:21-30`).

**Colonnes ajoutées (additif pur)** :

- **`booking_event_types`** (seq 84, jointure applicative par
  `bookings.event_type_id`) :
  - `reminder_offset_min INTEGER NOT NULL DEFAULT 0` — minutes AVANT le RDV
    (0 = pas de rappel ; >0 = rappel actif).
  - `reminder_channel TEXT` — `NULL | 'email' | 'sms' | 'both'`.
- **`bookings`** (seq 7, CHECK status INTOUCHABLE — `no_show` déjà présent) :
  - `no_show_at TEXT` — horodatage UTC du marquage no-show.
  - `reminder_sent_at` (seq 84) **NON ré-ajouté** — réutilisé pour
    l'idempotence.

E4/E6 régulés : **AUCUNE activation paiement**, `price_cents` jamais touché.

### §6.C — Cron rappels (`worker.ts:scheduled()`, FIGÉ Phase A)

Job best-effort ajouté Phase A dans `scheduled()`, calque EXACT du pattern
broadcasts / scheduled-reports / proactive-ai :

```
ctx.waitUntil(
  import('./worker/booking-reminders')
    .then((m) => m.processBookingReminders(env))
    .then(() => undefined)
    .catch(() => undefined),
);
```

Échec isolé ⇒ ne casse PAS le cron ni les autres jobs (`waitUntil` + `.catch`).
Phase B NE TOUCHE PAS `worker.ts` — uniquement le CORPS de
`processBookingReminders` dans `booking-reminders.ts`.

### §6.D — Contrats `src/worker/booking-reminders.ts` (signatures FIGÉES)

Fichier NEUF/ISOLÉ. Imports RELATIFS uniquement (`./types`, `./helpers`,
`./capabilities`, `./workflows`) — PAS d'alias `@/`. Signatures FIGÉES Phase A
(worker.ts GELÉ les câble). Phase B écrit UNIQUEMENT les corps balisés
`// Manager-B: corps réel`, SANS changer signatures ni forme de retour.

```
export async function processBookingReminders(env: Env): Promise<void>
export async function markBookingNoShow(env: Env, bookingId: string, auth: BookingReminderAuth): Promise<{ ok: boolean }>
export async function handleMarkNoShow(env: Env, auth: BookingReminderAuth, bookingId: string): Promise<Response>
export type BookingReminderAuth = CapAuth & { capabilities?: Set<string> }
```

> NB conventions repo : `markBookingNoShow` prend `(env, bookingId, auth)` —
> `env` puis l'id puis l'`auth` enrichi (calque l'ordre `(env, auth, id)` /
> `(env, id, auth)` des handlers booking-public.ts ; le D1 est accédé via
> `env.DB`, PAS un `db` séparé). `handleMarkNoShow` est le wrapper Response que
> worker.ts appelle (réponses `{data}`/`{error}` §6.A).

**`processBookingReminders(env)`** — STUB Phase A (SELECT borné + boucle vide).
Corps réel Phase B (CONTRAT FIGÉ) :
- `SELECT ... FROM bookings WHERE status = 'confirmed' AND reminder_sent_at IS
  NULL ORDER BY start_time ASC LIMIT 50` (bornage strict, énumération seq 7).
- Jointure **APPLICATIVE** `booking_event_types` (via `event_type_id`) pour
  `reminder_offset_min` (>0 = actif) + `reminder_channel`
  (`email`|`sms`|`both`|NULL). Skip si offset ≤ 0 ou canal NULL.
- Si `now >= start_time - reminder_offset_min*60000` → envoi email/SMS via les
  **mêmes chemins** que `booking-public.ts:sendBookingConfirmation` (Resend
  `env.RESEND_API_KEY` / `helpers.ts:sendSms`).
- `UPDATE bookings SET reminder_sent_at = datetime('now') WHERE id = ?`
  (idempotence — un booking rappelé n'est plus re-sélectionné).
- best-effort intégral : échec d'envoi isolé NE bloque PAS la boucle ;
  table/colonne absente ⇒ retour silencieux. JAMAIS de throw non maîtrisé.

**`markBookingNoShow(env, bookingId, auth)`** — corps minimal FONCTIONNEL posé
Phase A (Manager-B PEUT enrichir logs/notifications, signature INCHANGÉE) :
- Garde `requireCapability(auth.capabilities, 'workflows.manage')`.
- Charge la row, bornage tenant (`rowInTenant`, calque
  booking-public.ts:rowInTenant — legacy → true ; agence → `client_id ∈
  accessibleClientIds` OU `agency_id == tenant.agencyId`).
- `UPDATE bookings SET status='no_show', no_show_at=datetime('now') WHERE id=?`
  (status seq 7 — `no_show` DÉJÀ dans le CHECK, AUCUN ALTER). Repli rétro-compat
  si `no_show_at` (seq 103) pas encore appliquée.
- `autoEnrollForTrigger(env, 'appointment_no_show', lead_id)` si lead lié
  (calque appointments.ts:177). best-effort.
- Retour FIGÉ `{ ok: boolean }`.

### §6.E — Route no-show (`worker.ts`, FIGÉ Phase A)

```
POST /api/bookings/:id/no-show   → handleMarkNoShow(env, auth, id)   (protégé, 'workflows.manage')
```

Préfixe `/api/bookings/` DISJOINT de `/api/booking-pages/` &
`/api/booking-event-types/` ⇒ zéro shadowing. Câblé dans `routeProtected`
juste après le CRUD `booking-event-types`. Succès `json({data:{success:true}})`,
échec `json({error},status)` (§6.A).

### §6.F — GAP #2 self-service (Manager-B, DANS booking-public.ts)

Enrichir UNIQUEMENT `sendBookingConfirmation` (booking-public.ts) pour inclure
dans l'email de confirmation les liens self-service :
- annulation : `…/book/{slug}?booking_id={id}&action=cancel`
- reprogrammation : `…/book/{slug}?booking_id={id}&action=reschedule`

Le slug et l'id du booking sont disponibles dans le contexte de
`handlePublicCreateBookingV2`. Manager-B passe ces valeurs à
`sendBookingConfirmation` (ajustement de signature INTERNE au fichier autorisé).
**B ne touche RIEN d'autre dans booking-public.ts** (les 8 handlers existants
restent intacts au-delà de cet enrichissement).

### §6.G — i18n (POSÉ Phase A — parité STRICTE 4 catalogues)

8+ clés posées Phase A dans `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (parité
STRICTE, mêmes clés partout, valeurs traduites). Phase C les CONSOMME, n'en
crée AUCUNE :

```
booking.event_type.reminder_offset
booking.event_type.reminder_channel
booking.reminder.channel.email
booking.reminder.channel.sms
booking.reminder.channel.both
booking.reminder.channel.none
booking.noshow.action
booking.noshow.confirm
booking.noshow.done
```

### §6.H — Répartition DISJOINTE Phase B/C (zéro fichier partagé)

**Manager-B (backend) — owned EXCLUSIF** :
- `src/worker/booking-reminders.ts` — **corps réel** :
  - `processBookingReminders` : SELECT `bookings status='confirmed' AND
    reminder_sent_at IS NULL`, jointure applicative `booking_event_types`
    (offset/canal), si `now >= start_time - offset_min` → envoi email/SMS via
    les mêmes chemins que `booking-public.ts:sendBookingConfirmation`, puis
    `UPDATE bookings SET reminder_sent_at=datetime('now')`. Borné LIMIT 50,
    best-effort, idempotent.
  - `markBookingNoShow` : corps réel (UPDATE borné tenant + trigger).
- `src/worker/booking-public.ts` — **UNIQUEMENT** enrichir
  `sendBookingConfirmation` avec les liens cancel/reschedule (GAP #2, §6.F).
  RIEN d'autre.

**Manager-C (front) — owned EXCLUSIF** :
- `src/pages/BookingSettings.tsx` — ajoute au Modal de type de RDV :
  - champ nombre `reminder_offset_min`
    (label `booking.event_type.reminder_offset`),
  - select `reminder_channel` (`email`/`sms`/`both`/`none` →
    `booking.reminder.channel.*`),
  branchés sur les helpers FIGÉS A (`createBookingEventType` /
  `updateBookingEventType`, `Partial<BookingEventType>`). Classes/primitives
  existantes uniquement.

**INTERDITS aux DEUX Managers** (FIGÉS Phase A ou hors scope, lecture seule) :
- `src/worker.ts`, `src/lib/api.ts`, `src/lib/types.ts`,
  `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`,
  `migration-booking-reminders-seq103.sql`, `docs/migrations-manifest.json`,
  **`docs/LOT-BOOKING-REMINDERS.md`**.
- `src/index.css` (**ZÉRO touche**), `src/pages/Calendar.tsx`,
  `src/worker/calendar.ts`, `src/worker/workflows.ts`,
  `src/worker/capabilities.ts` (`ALL_CAPABILITIES` FIGÉ).

**Disjonction** : Manager-B ⊂ {`booking-reminders.ts` + enrichissement
`sendBookingConfirmation` de `booking-public.ts`} ∥ Manager-C ⊂
{`BookingSettings.tsx`}. **Aucun fichier partagé entre B et C** ⇒
parallélisation sûre, zéro race.

### §6.I — Pièges / garde-fous

- **CHECK status `bookings` seq 7 INTOUCHABLE** — `no_show` y est DÉJÀ ;
  jamais d'ALTER de CHECK, jamais `pending`. CHECK role seq 59 intact.
- **Manifest OBLIGATOIRE** — entrée seq 103 ajoutée ; sans elle
  `scripts/migrate.ts` STOPPE en erreur dure (fichier `migration-booking-*`
  non manifesté).
- **FK INTERDITES** — jointure booking↔event_type APPLICATIVE (TEXT).
  Zéro DROP/RENAME/rebuild.
- **Imports worker RELATIFS** (`./types`, `./helpers`, `./workflows`,
  `./capabilities`) — PAS d'alias `@/` (tsconfig.worker.json).
- **Parité i18n STRICTE** sur les 4 catalogues — clés AVANT tout usage.
- **AUCUNE capability ajoutée** — réutilise `workflows.manage` (seq 80).
- **E4/E6 OFF** — `price_cents` jamais touché, aucune logique paiement, pas
  d'activation Google/Outlook.
- best-effort partout (cron + endpoints) : table/colonne absente ⇒ réponse
  propre, JAMAIS de 500/throw non maîtrisé.
- Pas de build/test côté VM (VMware sans bun/node) — Antigravity build/test
  côté hôte. NE PAS prétendre « vert ».

---

## État Phase A (livré)

Fichiers créés :
- `migration-booking-reminders-seq103.sql` — DDL additif (2 ALTER
  booking_event_types + 1 ALTER bookings).
- `src/worker/booking-reminders.ts` — `processBookingReminders` (stub cron) +
  `markBookingNoShow` (corps minimal) + `handleMarkNoShow` (wrapper Response)
  + type `BookingReminderAuth`. Signatures FIGÉES.
- `docs/LOT-BOOKING-REMINDERS.md` — ce document (§6 A→I FIGÉ).

Fichiers modifiés (GELÉS pour Phase B/C ensuite) :
- `docs/migrations-manifest.json` — entrée seq 103
  (`depends_on: migration-telephony-seq102.sql`).
- `src/worker.ts` — import `handleMarkNoShow` + job cron
  `processBookingReminders` dans `scheduled()` + route protégée
  `POST /api/bookings/:id/no-show`.
- `src/lib/api.ts` — `BookingEventType` étendu (`reminder_offset_min`,
  `reminder_channel`) + helper `markNoShow`.
- `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` — 9 clés rappels/no-show, parité
  STRICTE 4 catalogues.

Non touché : `Calendar.tsx`, `workflows.ts`, `calendar.ts`, `capabilities.ts`
(ALL_CAPABILITIES), `index.css`, `BookingSettings.tsx` (corps = Phase C),
corps réels `booking-reminders.ts` / GAP #2 `booking-public.ts` (= Phase B).
Non exécuté (VM) — Antigravity build/test côté hôte.
