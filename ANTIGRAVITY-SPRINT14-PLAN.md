# Sprint 14 — GHL Migration importer (~15j)

> **Objectif :** Importer les données d'un compte GoHighLevel existant vers Intralys CRM.
> Approche hybride : **CSV** pour contacts (gros volume, robuste, pas de dépendance API),
> **OAuth GHL API** pour conversations + messages live + appointments (besoin temps réel).
> Périmètre complet (contacts, tags, custom fields, conversations, messages, pipelines,
> opportunities, calendars, appointments). Workflows GHL exclus (logique trop différente).
> Ref : `_v2-backlog/migrate.ts` (skeleton de types déjà drafté en Sprint Consolidation).

**Contexte spécifique** : pas de client beta réel à migrer pour l'instant.
Le code sera testé avec un compte GHL sandbox + fixtures JSON. Le mode bidirectionnel,
les conflicts resolution avancées, et l'UI client self-serve sont **reportés** —
on construit l'os, on ajoutera la chair quand un vrai client demandera la migration.

---

## Phase A — Foundation OAuth GHL + table de mapping (3j)

**A.1 — OAuth GHL flow (1j)** 🔴
- Route `GET /api/migration/ghl/oauth/start` → redirige vers `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=<GHL_CLIENT_ID>&scope=contacts.readonly conversations.readonly opportunities.readonly calendars.readonly&redirect_uri=<INTRALYS_HOST>/api/migration/ghl/oauth/callback`
- Route `GET /api/migration/ghl/oauth/callback` → échange code contre token, stocke dans `ghl_tokens` table
- Refresh token automatique avant expiration (cron 1h)
- Env vars : `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_REDIRECT_URI`

**A.2 — GHL API client wrapper (1j)** 🔴
- Fichier `src/worker/migration-ghl-client.ts`
- Méthodes : `getContacts(locationId, cursor?)`, `getConversations(locationId, cursor?)`, `getMessages(conversationId, cursor?)`, `getOpportunities(locationId, cursor?)`, `getCalendars(locationId)`, `getAppointments(calendarId, startDate, endDate)`, `getCustomFields(locationId)`
- Rate limit aware : header `X-Ratelimit-Remaining` < 10 → throttle 2s
- Retry sur 429/503 avec backoff (1s, 5s, 30s)
- AbortController timeout 30s

**A.3 — Migration sessions table (0.5j)** 🟠
- `migration-phase40.sql` :
  - `migration_sessions (id, client_id, source, status, started_at, finished_at, total_records, imported_records, error_count, error_log_json, current_phase)`
  - `migration_id_map (intralys_resource, intralys_id, external_source, external_id, client_id, created_at)` → idempotence
  - Index sur `(intralys_resource, external_source, external_id)` UNIQUE
- Source : `'ghl_csv'` | `'ghl_api'`
- Status : `'pending' | 'running' | 'completed' | 'failed' | 'cancelled'`

**A.4 — Migrate types finalisés (0.5j)** 🟡
- Sortir `src/worker/_v2-backlog/migrate.ts` vers `src/worker/migration-ghl-types.ts` (types only)
- Compléter types manquants (GhlNote, GhlTask, GhlFile)
- Pas de logique métier ici, juste contrats TypeScript stricts

---

## Phase B — Mappers GHL → Intralys (3j)

**B.1 — Contact mapper (0.75j)** 🔴
- `mapGhlContact(ghl: GhlContact, clientId: string): IntralysLead`
- `firstName + lastName` → `name` ; `dateOfBirth` → `metadata.dob`
- `tags[]` → `lead_tags` rows
- `customFields[]` → `lead_custom_field_values` (besoin de pré-mapping CF def, cf. B.4)
- `dndSettings` → `dnd` + `dnd_settings_json` (préserve les sous-canaux email/sms/call)
- `source` par défaut → `'migration_ghl'`
- Skip si email + phone vides

**B.2 — Conversation + message mapper (0.75j)** 🔴
- `mapGhlConversation(c: GhlConversation): IntralysConversation`
- `mapGhlMessage(m: GhlMessage): IntralysMessage`
- Type code → channel : `1='sms' | 3='call' | 4='email' | 25='facebook' | 26='instagram' | 29='webchat'` (extension liste GHL)
- `direction` : `'inbound' | 'outbound'`
- Body preserve HTML pour emails, plain pour SMS

**B.3 — Pipeline + opportunity mapper (0.5j)** 🟠
- `mapGhlPipeline(p: GhlPipeline): IntralysPipeline`
- `stages[]` → `pipeline_stages` (préserve `position` → `sort_order`)
- `mapGhlOpportunity(o: GhlOpportunity): IntralysDeal`
- `status` GHL → Intralys lead status (`'open' → 'qualified'`, `'won' → 'won'`, `'lost' → 'lost'`, `'abandoned' → 'lost'`)
- `monetaryValue` → `deal_value`

**B.4 — Custom fields mapper (0.5j)** 🟠
- `mapGhlCustomField(cf: GhlCustomField, clientId: string): IntralysCustomFieldDef`
- `dataType` GHL → Intralys : `'TEXT' → 'text' | 'NUMERICAL' → 'number' | 'PHONE' → 'phone' | 'DATE' → 'date' | 'SINGLE_OPTIONS' → 'select' | 'CHECKBOX' → 'checkbox' | 'TEXTAREA' → 'textarea' | 'FILE_UPLOAD' → 'file'`
- `picklistOptions[]` → `options_json`
- Génère un mapping CF GHL_id → Intralys CF def_id stocké dans la session

**B.5 — Calendar + appointment mapper (0.5j)** 🟠
- `mapGhlCalendar(c: GhlCalendar): IntralysCalendar`
- `mapGhlAppointment(a: GhlCalendarEvent): IntralysAppointment`
- `startTime/endTime` → `starts_at/ends_at` (ISO 8601)
- `contactId` GHL → `lead_id` Intralys (lookup via migration_id_map)
- Status `'confirmed' | 'cancelled' | 'no-show' | 'completed'`

---

## Phase C — Import CSV contacts (2j)

**C.1 — Parser CSV robuste (0.5j)** 🔴
- Réutiliser `parseCsvLine` existant dans `worker/dashboard.ts` (Sprint Consolidation CSV import)
- Détection automatique du séparateur (`,` `;` `\t`)
- Encoding UTF-8 BOM + fallback latin-1 si parse fail
- Validation : doit avoir au moins `email` OU `phone`

**C.2 — Dry-run preview (0.5j)** 🟠
- Endpoint `POST /api/migration/ghl/csv/preview` (admin only)
- Body : `{ client_id, csv_data (base64), field_mapping? }`
- Retourne : `{ rows_total, rows_valid, rows_skipped, sample_first_10, custom_fields_detected, conflicts: { duplicate_emails: [], existing_contacts: [] } }`
- Pas d'écriture en BDD

**C.3 — Mapping suggested + override (0.5j)** 🟠
- Auto-détection mappings header CSV → champs Intralys
- Headers GHL standards : `First Name, Last Name, Email, Phone, Tags, ...`
- Custom fields détectés via colonnes non-standards → propose création
- Endpoint accepte `field_mapping: { 'CSV Header': 'intralys_field_or_cf_slug' }` pour override

**C.4 — Import flow complet (0.5j)** 🔴
- Endpoint `POST /api/migration/ghl/csv/run` (admin only)
- Crée `migration_sessions` row status=`'running'`
- Streaming : batches de 100 contacts, commit per batch (resumable)
- Pour chaque contact : check duplicate (email + client_id) → skip si exists, sinon INSERT + `migration_id_map`
- Update session stats en temps réel
- Audit log

---

## Phase D — Import live API (4j)

**D.1 — Pagination GHL aware (0.5j)** 🟠
- Helper `paginatedFetch(env, url, locationId, cursor?)` qui suit le pattern GHL cursor-based
- Limit max 100 records per page (GHL hard limit)
- Retour : `{ items, nextCursor }`

**D.2 — Resumable state (0.75j)** 🟠
- Chaque pull stocke `migration_sessions.current_phase` + `current_cursor`
- Sur reprise (status=`'running'` + last_activity > 1min → orphelin) : reprend depuis cursor
- Cron 5min vérifie sessions orphelines, marque `'failed'` après 30min d'inactivité

**D.3 — Pull conversations + messages (1.25j)** 🔴
- Endpoint `POST /api/migration/ghl/api/run` (admin only, body `{ client_id, location_id, scopes: ['conversations', 'opportunities', ...] }`)
- Pour chaque conversation : tirage tous les messages (paginé)
- Map via B.1+B.2, INSERT avec `migration_id_map`
- Skip messages déjà importés (UNIQUE constraint protect)
- Update progress per 100 messages

**D.4 — Pull pipelines + opportunities (0.75j)** 🟠
- Tirage pipelines + stages first (création des analogues Intralys)
- Tirage opportunities, link à lead via migration_id_map
- Si lead pas trouvé : créer placeholder + log warning

**D.5 — Pull calendars + appointments (0.75j)** 🟠
- Calendars d'abord (création des analogues Intralys)
- Appointments par calendar, période config par défaut = -90j à +180j

---

## Phase E — Idempotence + reconciliation + tests + clôture (3j)

**E.1 — Idempotence end-to-end (0.5j)** 🔴
- Re-run d'une migration déjà complétée → 0 doublon
- Vérifier via UNIQUE constraint `(intralys_resource, external_source, external_id, client_id)`
- Test : run migration fixtures 2x, count rows identique

**E.2 — Migration report (0.5j)** 🟠
- Endpoint `GET /api/migration/sessions/:id` → détails session + stats
- Endpoint `GET /api/migration/sessions/:id/errors` → liste détaillée des skips/échecs
- Schema report : `{ contacts: {total, imported, skipped, errors[]}, conversations: {...}, ... }`

**E.3 — Tests mappers + import (1j)**
- `src/worker/__tests__/migration-mappers.test.ts` : 1 test par mapper (B.1-B.5)
- `src/worker/__tests__/migration-csv.test.ts` : parser + dry-run + idempotence
- `src/worker/__tests__/migration-api.test.ts` : pagination + resumable + pull conversation
- Fixtures JSON dans `src/worker/__tests__/fixtures/ghl-*.json`
- Cible : 25+ nouveaux tests → 183+ total (vs 158 actuels)

**E.4 — Docs MIGRATION-GHL.md (0.5j)**
- `docs/MIGRATION-GHL.md` : flow utilisateur (admin), prérequis (OAuth app GHL approuvée),
  limitations (workflows non importés, calendar availability rules non mappées),
  troubleshooting (errors fréquents)

**E.5 — Build vert + clôture (0.5j)**
- `bun run build` → 0 erreurs (worker.ts désormais type-checké)
- `bun run test --run` → 183+ tests verts
- ROADMAP.md : Sprint 14 → accomplis
- `git mv ANTIGRAVITY-SPRINT14-PLAN.md docs/archive/`

---

## Résumé effort

| Phase | Effort | Items |
|---|---|---|
| A — Foundation OAuth + types + DB | 3j | OAuth flow, API client, migration_sessions, types |
| B — Mappers GHL → Intralys | 3j | Contact, conversation/message, pipeline/opp, CF, calendar/appt |
| C — Import CSV contacts | 2j | Parser, dry-run, mapping override, run flow |
| D — Import live API | 4j | Pagination, resumable, conversations, pipelines, calendars |
| E — Idempotence + tests + docs | 3j | UNIQUE constraints, reports, 25+ tests, MIGRATION-GHL.md |
| **Total** | **~15j** | **5 phases, ~25 items** |

---

## Critères de succès Sprint 14

- [ ] Un admin peut connecter un compte GHL via OAuth (token stocké, refresh OK)
- [ ] Un admin peut uploader un CSV GHL contacts → preview + import + report
- [ ] Une migration API live pull conversations + messages + pipelines + appointments d'un compte GHL sandbox sans crash
- [ ] Une migration re-run produit 0 doublon (idempotence vérifiée)
- [ ] Session orpheline > 30min → marquée 'failed' automatiquement
- [ ] 183+ tests verts (vs 158 baseline)
- [ ] `bun run build` vert avec worker.ts type-checké

---

## Hors scope (V2 / quand un client réel demande)

- **UI client self-serve** dans Settings (actuellement admin-only, accessible via curl/dashboard admin)
- **Migration bidirectionnelle** (sync continue Intralys ↔ GHL pendant N semaines)
- **Workflows GHL → Intralys** (logique trop différente, conversion manuelle au cas par cas)
- **Forms/surveys GHL** (à mapper avec notre système Forms après usage réel)
- **Files/attachments GHL** (besoin R2 sync + URL rewrite)
- **Notes GHL** (à mapper si client demande)

---

_Plan créé le 2026-05-12. Sera archivé dans docs/archive/ à la fin du sprint._
