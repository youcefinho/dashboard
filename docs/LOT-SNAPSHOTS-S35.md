# LOT Snapshots — Sprint 35

> Doc contrat §6 figé. Migration : seq130 — `migration-snapshots-seq130.sql`.
> Compagnons : `SCHEMA-VERSIONING-S35.md` (à compléter par C4 Phase B —
> politique de bump de `schema_version`), `LOT-TEAM-BC.md` (capabilities
> figées seq80 — réutilisation `settings.manage`), `LOT-CALENDAR-SYNC-S33.md`
> (calque pattern handler + i18n + manifest).

## §1 Contexte

GoHighLevel propose un mécanisme **« Snapshot »** central : exporter en un
fichier la configuration complète d'un sous-compte (pipelines, workflows,
templates, formulaires, calendriers, etc.) puis la réimporter dans un autre
sous-compte ou agence. C'est le pilier de leur scalabilité agence : on
configure UN compte de référence, on snapshote, on réimporte partout.

**Gap actuel Intralys** : on a `exports-extra.ts` (CSV bornés à 3 entités
admin-only : leads / orders / conversations) et `migration-ghl-csv.ts`
(import unidirectionnel depuis GHL). **Aucun mécanisme app-level
multi-table, portable, signé**, qui permette de :

- exporter la configuration d'un tenant ENTIER (27 entités whitelistées) ;
- re-jouer cette configuration sur un autre tenant (dry-run + commit) ;
- garantir l'intégrité (signature SHA-256 deterministe anti-altération) ;
- versioner le format (bump `schema_version` à chaque breaking change) ;
- borner la taille (5 MiB max pour éviter dump massif accidentel).

Sprint 35 pose ce mécanisme **côté app uniquement** (R2 / D1, ZÉRO appel
externe), sans toucher aux 27 tables métier (seules INSERT côté target).

## §2 Migrations — seq130 (DDL résumé)

Fichier racine : `migration-snapshots-seq130.sql`. Manifest entrée seq130
(`docs/migrations-manifest.json`), `depends_on:
["migration-twilio-voice-seq129.sql"]` (chaînage strict avec la dernière
migration LOT 3).

100 % ADDITIF, zéro CHECK / FK / ALTER / DROP / RENAME :

- `CREATE TABLE IF NOT EXISTS snapshots` — bundle exporté (id PK random,
  client_id, agency_id, name NOT NULL, description, version, schema_version
  NOT NULL, payload_json NOT NULL, payload_hash_sha256 NOT NULL,
  payload_size_bytes NOT NULL, tables_summary_json, status DEFAULT
  `'draft'` enum HANDLER `draft|published|archived`, created_by NOT NULL,
  created_at, updated_at).
- `CREATE TABLE IF NOT EXISTS snapshot_imports` — trace d'un import (id PK,
  snapshot_id, source_client_id, target_client_id NOT NULL,
  target_agency_id, mode NOT NULL enum HANDLER `dry_run|commit`, status
  DEFAULT `'pending'` enum HANDLER `pending|running|completed|failed`,
  payload_hash_sha256 NOT NULL, schema_version NOT NULL, id_mapping_json,
  log_json, summary_json, started_by NOT NULL, started_at, completed_at).

5 indexes :

- `idx_snapshots_client (client_id, created_at)` — listing tenant.
- `idx_snapshots_agency (agency_id, status)` — vue agence par statut.
- `idx_snapshot_imports_target (target_client_id, started_at)` — historique
  imports d'un tenant cible.
- `idx_snapshot_imports_snapshot (snapshot_id)` — réconciliation
  snapshot → imports descendants.
- `idx_snapshot_imports_status (status)` — workers polling running/pending.

Validation enums (`status`, `mode`) faite SIDE-HANDLER (snapshots.ts /
snapshots-import.ts) — calque LOT-CALENDAR-SYNC-S33 §6.1 et tous les
sprints LOT 1/2/3 récents (pas de CHECK = pas de rebuild SQLite jamais).

## §3 Routes (8 AUTHED)

Toutes câblées dans `src/worker.ts` à l'intérieur du bloc `routeProtected`
(après le bloc calendar-integrations Sprint 33, vers la ligne 2660).
Garde `requireAuth` au choke-point + garde capability **`settings.manage`**
(FIGÉE seq80) appliquée DANS chaque handler.

ORDRE ANTI-SHADOWING strict : routes spécifiques (`/import`,
`/:id/download|publish|archive`) AVANT `/:id` générique.

| Méthode | Chemin                            | Handler                                  | Fichier              |
|--------:|-----------------------------------|------------------------------------------|----------------------|
| POST    | `/api/snapshots/import`           | `handleImportSnapshot`                   | snapshots-import.ts  |
| POST    | `/api/snapshots`                  | `handleCreateSnapshot`                   | snapshots.ts         |
| GET     | `/api/snapshots`                  | `handleListSnapshots`                    | snapshots.ts         |
| GET     | `/api/snapshots/:id/download`     | `handleDownloadSnapshotBundle`           | snapshots.ts         |
| POST    | `/api/snapshots/:id/publish`      | `handlePublishSnapshot`                  | snapshots.ts         |
| POST    | `/api/snapshots/:id/archive`      | `handleArchiveSnapshot`                  | snapshots.ts         |
| GET     | `/api/snapshots/:id`              | `handleGetSnapshot`                      | snapshots.ts         |
| DELETE  | `/api/snapshots/:id`              | `handleDeleteSnapshot`                   | snapshots.ts         |

Réponses normalisées **`{ data }`** / **`{ error }`** (PAS de champ
`code` — contrat GELÉ docs/LOT-TEAM-BC.md §6.A). Statut HTTP transporté
par le 2e arg de `json()`. Phase A renvoie `501` partout (`Phase B not
yet implemented`) pour câbler la matrice routes/handlers sans casser le
worker.

## §4 Handlers (signatures FIGÉES)

`src/worker/snapshots.ts` :

```ts
export async function handleCreateSnapshot(request: Request, env: Env, auth: SnapshotsAuth): Promise<Response>
export async function handleListSnapshots(env: Env, auth: SnapshotsAuth, url: URL): Promise<Response>
export async function handleGetSnapshot(env: Env, auth: SnapshotsAuth, id: string): Promise<Response>
export async function handleDownloadSnapshotBundle(env: Env, auth: SnapshotsAuth, id: string): Promise<Response>
export async function handlePublishSnapshot(env: Env, auth: SnapshotsAuth, id: string): Promise<Response>
export async function handleArchiveSnapshot(env: Env, auth: SnapshotsAuth, id: string): Promise<Response>
export async function handleDeleteSnapshot(env: Env, auth: SnapshotsAuth, id: string): Promise<Response>
```

`src/worker/snapshots-import.ts` :

```ts
export async function handleImportSnapshot(request: Request, env: Env, auth: SnapshotsImportAuth): Promise<Response>
```

`src/worker/lib/snapshot-export.ts` — exports FIGÉS :

```ts
export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const SNAPSHOT_BUNDLE_MAX_BYTES = 5 * 1024 * 1024;
export const SNAPSHOT_MAGIC_HEADER = 'intralys-snapshot-v1' as const;
export const SNAPSHOTTABLE_ENTITIES = [...] as const;   // 27 entités
export type SnapshottableEntity = (typeof SNAPSHOTTABLE_ENTITIES)[number];
export interface SnapshotBundle { magic; schema_version; generated_at; source; entities; signature }
export async function collectSnapshotPayload(env, clientId, options?): Promise<Omit<SnapshotBundle, 'signature'>>;
export async function sha256Hex(input: string): Promise<string>;
export async function signPayload(unsignedBundle): Promise<SnapshotBundle>;
export function serializeBundle(bundle: SnapshotBundle): string;
export function validateBundleSize(serialized: string): { ok: true } | { ok: false; error: string };
```

`src/worker/lib/snapshot-import.ts` — exports FIGÉS :

```ts
export interface ImportLogEntry { entity; action; old_id; new_id; reason? }
export interface ImportSummary { total_entities; totals; id_mapping }
export function parseBundle(raw: string): { ok: true; bundle } | { ok: false; error };
export function validateBundleSchema(bundle): { ok: true } | { ok: false; error };
export async function verifySignature(bundle): Promise<{ ok: true } | { ok: false; expected; actual }>;
export function remapEntityIds(bundle): { remapped; mapping };
export async function applyImport(env, bundle, options): Promise<{ summary; log }>;
export async function appendImportLog(env, importId, entries): Promise<void>;
```

Phase B Manager-B remplit les corps. Aucune signature ne doit bouger.

## §5 Frontend components (4 fichiers Phase B Manager-C)

Manager-C produira **dans le même run que Manager-B** (fichiers DISJOINTS) :

- `src/pages/Snapshots.tsx` — page principale (route `/snapshots`, déjà
  consommée par les helpers `getSnapshots()` / `createSnapshot()` /
  `downloadSnapshot()` / `publishSnapshot()` / `archiveSnapshot()` /
  `deleteSnapshot()` ajoutés Phase A).
- `src/components/snapshots/SnapshotsList.tsx` — table + actions par ligne
  (download / publish / archive / delete + badge `status`).
- `src/components/snapshots/SnapshotCreateModal.tsx` — formulaire name +
  description, call `createSnapshot()`, toast `snapshots.toast.created`.
- `src/components/snapshots/SnapshotImportWizard.tsx` — wizard 3 étapes
  (upload → preview dry-run → commit), 3 colonnes (created/skipped/failed)
  alimentées par `importSnapshot({ mode: 'dry_run' })` puis `commit`.

i18n clés `snapshots.*` (28 par catalogue, parité STRICTE sur 4 fichiers
`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`) déjà posées Phase A.

## §6 SCOPE FIGÉ — Inter-agent contracts

1. **Signature SHA-256 deterministe.** `serializeBundle()` produit un JSON
   **avec clés triées récursivement**. Garantit que `sha256Hex(serialize(b1))
   === sha256Hex(serialize(b2))` pour `b1` et `b2` logiquement identiques,
   peu importe l'ordre d'insertion JavaScript. Vérification à l'import :
   re-sérialise SANS la `signature` + SHA-256 + comparaison stricte avec
   `bundle.signature.hash_hex` → mismatch ⇒ `snapshots.error.signature_
   mismatch` (400).

2. **Idempotence par `(client_id, name)`.** L'import skip silencieusement
   une entité dont le `name` (ou clé naturelle équivalente : `key` pour
   custom_field_defs, `slug` pour forms, etc.) existe déjà côté target.
   ⇒ Réimporter 2 fois le même snapshot = 0 doublon, 27 entités skipped au
   2e passage. `id_mapping` reste résolu (mapping ancien_id → id existant
   côté target) pour préserver les FK applicatives internes au bundle.

3. **dry_run vs commit.** `dry_run` = mode preview pur : aucun INSERT, on
   produit seulement `log` + `summary` (3 colonnes UI created/skipped/
   failed). `commit` = INSERT (jamais UPDATE) avec nouveaux IDs target.
   L'UI Phase C force `dry_run` AVANT `commit` (wizard 3 étapes).

4. **Whitelist 27 entités — ZÉRO PII / secrets / tokens.** Inclus :
   pipelines, pipeline_stages, lost_reasons, custom_field_defs, smart_
   lists, workflow_folders, workflows, workflow_steps, trigger_links,
   template_folders, email_templates, sms_templates, snippets, forms,
   form_field_options, lead_segments, task_templates, booking_event_types,
   calendars, availability_rules, catalog_items, ai_brand_voices,
   ivr_menus, quick_replies, saved_replies, report_templates, reputation_
   settings. **Exclu explicitement** : leads, messages, conversations,
   appointments, invoices, payments, oauth_connections, api_keys,
   integration_secrets, audit_log, files, users, members. Aucune donnée
   nominative, aucun token, aucun secret ne quitte jamais un tenant via
   un snapshot.

5. **Taille bornée 5 MiB.** `SNAPSHOT_BUNDLE_MAX_BYTES = 5 * 1024 * 1024`.
   `validateBundleSize()` est appelée APRÈS sérialisation, AVANT INSERT
   `snapshots.payload_json`. Dépassement ⇒ `snapshots.error.bundle_too_
   large` (400). Évite un dump pathologique (10k workflows × 200 steps).

6. **Bornage tenant strict.** Tous les SELECT côté export filtrent
   `WHERE client_id = auth.clientId`. Tous les INSERT côté import forcent
   `client_id = options.targetClientId` (jamais issu du bundle source).
   Defense-in-depth IDOR : un attaquant qui forge un bundle avec
   `source.client_id = "victim"` ne peut pas écrire chez `victim` — seul
   `targetClientId` (passé en body, validé contre `auth.tenant.
   accessibleClientIds`) est utilisé.

## §7 Capabilities

Garde unique : **`settings.manage`** (FIGÉE seq80 — voir
`src/worker/capabilities.ts:36-49` pour la liste des 12 capabilities
verrouillées). **ZÉRO ajout à `ALL_CAPABILITIES`**. Les snapshots étant
une opération sensible (export config tenant complet + import cross-
tenant), `settings.manage` est cohérent avec le reste du panneau admin
(SMTP/branding/intégrations/téléphonie). Pour un futur RBAC plus fin
(viewer snapshots vs editor snapshots), passer par
`user_capability_overrides` (seq80) sans toucher à `ALL_CAPABILITIES`.

## §8 Variables d'environnement requises

**Aucune nouvelle variable**. Le bundle est stocké dans D1
(`snapshots.payload_json`), pas dans R2 — la borne 5 MiB le permet (D1
TEXT support up to ~1 GiB par cellule, on reste TRÈS en deçà). Si un
besoin futur de bundles > 5 MiB apparaît, R2 (`env.FILES` déjà existant
Sprint 11) est l'option naturelle — Phase B peut le poser en `Phase 2`
optionnel SANS bouger la migration ni les routes.

Crypto : `crypto.subtle.digest('SHA-256', ...)` (Web Crypto API native
Workers, zéro dépendance npm).
