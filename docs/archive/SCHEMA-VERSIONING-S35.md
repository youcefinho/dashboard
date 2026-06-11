# Schema versioning — Sprint 35 Snapshots

> Politique de bump de `SNAPSHOT_SCHEMA_VERSION` (cf. [`src/worker/lib/snapshot-export.ts`](../src/worker/lib/snapshot-export.ts):22), matrice de compatibilité ascendante / descendante, procédure de migration de bundles antérieurs au format courant.
> Date : 2026-05-24. Version : 1.0. Sprint : 35.
> Compagnon de [`LOT-SNAPSHOTS-S35.md`](LOT-SNAPSHOTS-S35.md) §6 (inter-agent contracts). Calque la structure de [`RGPD-CALL-RECORDINGS-S34.md`](RGPD-CALL-RECORDINGS-S34.md).

## §1 Vue d'ensemble

Le mécanisme Snapshots (Sprint 35) produit un **bundle JSON portable signé SHA-256** qui transporte la configuration multi-table d'un tenant (27 entités whitelistées) d'un sous-compte vers un autre. Pour garantir la pérennité du format à mesure que le CRM évolue, deux invariants sont posés dès la v1 :

1. **`schema_version` est un entier monotone**. Il est figé à `1` Sprint 35 (cf. [`SNAPSHOT_SCHEMA_VERSION = 1`](../src/worker/lib/snapshot-export.ts):22). Tout bump est strict (`+1`) et explicite — aucun versionnage sémantique mineur/patch côté bundle.
2. **`magic` est figé à `intralys-snapshot-v1`**. Ce header reste tel quel même quand `schema_version` bumpera à `2`, `3`, etc. Il sert uniquement à reconnaître qu'un payload est bien un bundle Intralys (anti-confusion avec d'autres formats JSON). La distinction de version se lit **exclusivement** dans `schema_version`.

### Politique forward / backward compat

| Bundle | Importé par worker v1 | Importé par worker v(N>1) |
|---|---|---|
| v1 | ✅ accepté | ✅ accepté (migration v1 → vN à la volée) |
| v(N>1) | ❌ rejeté `unsupported_schema_version` (400) | ✅ accepté |

Règle d'or : **un worker plus récent doit toujours pouvoir importer un bundle plus ancien**. Un worker plus ancien rejette un bundle plus récent (il n'a pas connaissance des nouveaux champs / nouvelles entités). C'est ce qui rend la matrice asymétrique.

## §2 Format du bundle JSON v1

### 2.1 Schéma canonique

```json
{
  "magic": "intralys-snapshot-v1",
  "schema_version": 1,
  "generated_at": "2026-05-24T14:32:11.847Z",
  "source": {
    "client_id": "client_abc123",
    "agency_id": "agency_xyz",
    "name": "Config courtage QC v3",
    "description": "Pipelines + workflows + templates SMS/email cabinet hypothécaire"
  },
  "entities": {
    "pipelines": [ /* rows */ ],
    "pipeline_stages": [ /* rows */ ],
    "lost_reasons": [ /* rows */ ],
    "custom_field_defs": [ /* rows */ ],
    "smart_lists": [ /* rows */ ],
    "workflow_folders": [ /* rows */ ],
    "workflows": [ /* rows */ ],
    "workflow_steps": [ /* rows */ ],
    "trigger_links": [ /* rows */ ],
    "template_folders": [ /* rows */ ],
    "email_templates": [ /* rows */ ],
    "sms_templates": [ /* rows */ ],
    "snippets": [ /* rows */ ],
    "forms": [ /* rows */ ],
    "form_field_options": [ /* rows */ ],
    "lead_segments": [ /* rows */ ],
    "task_templates": [ /* rows */ ],
    "booking_event_types": [ /* rows */ ],
    "calendars": [ /* rows */ ],
    "availability_rules": [ /* rows */ ],
    "catalog_items": [ /* rows */ ],
    "ai_brand_voices": [ /* rows */ ],
    "ivr_menus": [ /* rows */ ],
    "quick_replies": [ /* rows */ ],
    "saved_replies": [ /* rows */ ],
    "report_templates": [ /* rows */ ],
    "reputation_settings": [ /* rows */ ]
  },
  "signature": {
    "algo": "sha256",
    "hash_hex": "9f3b…c1e2"
  }
}
```

### 2.2 Whitelist 27 entités

La liste est figée dans [`SNAPSHOTTABLE_ENTITIES`](../src/worker/lib/snapshot-export.ts):26-54. Elle est **fermée** (ajout d'une entité = bump `schema_version`). Toute clé `entities.X` absente de la whitelist déclenche `malformed_bundle` (400) côté import — anti-injection table arbitraire (cf. [`validateBundleSchema`](../src/worker/lib/snapshot-import.ts):232-274).

| Catégorie | Entités |
|---|---|
| CRM noyau | `pipelines`, `pipeline_stages`, `lost_reasons`, `custom_field_defs`, `smart_lists`, `lead_segments` |
| Automation | `workflow_folders`, `workflows`, `workflow_steps`, `trigger_links` |
| Templates / contenus | `template_folders`, `email_templates`, `sms_templates`, `snippets` |
| Forms / capture | `forms`, `form_field_options` |
| Calendrier / booking | `task_templates`, `booking_event_types`, `calendars`, `availability_rules` |
| Catalog / commerce | `catalog_items` |
| IA / voix | `ai_brand_voices`, `ivr_menus`, `quick_replies`, `saved_replies` |
| Reporting | `report_templates`, `reputation_settings` |

Exclu **explicitement** (jamais snapshotté, jamais bumpé) : `leads`, `messages`, `conversations`, `appointments`, `invoices`, `payments`, `oauth_connections`, `api_keys`, `integration_secrets`, `audit_log`, `files`, `users`, `members`. Cf. [LOT-SNAPSHOTS-S35.md §6.4](LOT-SNAPSHOTS-S35.md).

### 2.3 Signature SHA-256 deterministe

L'algorithme de sérialisation utilisé pour le hash est **JSON canonique à clés triées récursivement** (cf. [`deterministicStringify`](../src/worker/lib/snapshot-export.ts):79-93). Garantit la reproductibilité : deux bundles logiquement identiques produisent EXACTEMENT la même string → même SHA-256, peu importe l'ordre d'insertion JS / D1.

```ts
// Pseudo-code
const unsigned = { magic, schema_version, generated_at, source, entities };
const serialized = deterministicStringify(unsigned);
const hash_hex = sha256Hex(serialized);
const bundle = { ...unsigned, signature: { algo: 'sha256', hash_hex } };
```

À l'import, on **re-sérialise sans `signature`** + SHA-256 + compare strictement (cf. [`verifySignature`](../src/worker/lib/snapshot-import.ts):281-297). Mismatch → `signature_mismatch` (400).

## §3 Évolution v1 → v2 (procédure future)

### 3.1 Quand bumper v2

Le bump est **obligatoire** dans les cas suivants :

- **Ajout d'une nouvelle entité au snapshot.** Exemple : Sprint 40 ajoute `product_reviews` à la whitelist (28e entité). Un worker v1 ne sait pas désérialiser ce champ → rejet préventif via `unsupported_schema_version`.
- **Changement structurel d'une entité existante.** Exemple : ajout d'une nouvelle FK applicative à remapper (`workflows.parent_workflow_id` pour hiérarchie multi-niveau). Le `remapEntityIds` v1 ne connaît pas ce champ → FK orpheline silencieuse côté target.
- **Changement de l'algorithme de signature.** Exemple : passage à `HMAC-SHA256(secret_per_agency)` pour distribution cross-agence (marketplace public). Bundle v2 a `signature.algo = 'hmac-sha256'` au lieu de `'sha256'`, le worker v1 le verifie en sha256 brut → mismatch.
- **Changement du format `magic`.** Cas théorique extrême (ex: passage à un format binaire `application/x-intralys-snapshot`). En pratique, on évite — le `magic` reste `intralys-snapshot-v1` même si `schema_version` bumpe.
- **Renommage / déplacement de champ obligatoire.** Exemple : `source.client_id` → `source.tenant_id`. Worker v1 lit `source.client_id` undefined → crash ou rejet.

### 3.2 Quand NE PAS bumper

Le bump est **superflu** dans les cas suivants (forward-compat naturel via "additive optional") :

- **Ajout d'une colonne nullable à une table existante déjà snapshotée.** Exemple : `pipelines` gagne une colonne `pipelines.color` nullable seq140. Le worker v1 a déjà sérialisé toutes les colonnes via `SELECT *` ([`collectSnapshotPayload`](../src/worker/lib/snapshot-export.ts):128) ; à l'import, [`buildInsertSql`](../src/worker/lib/snapshot-import.ts):389-414 itère sur `Object.keys(row)` donc inclut automatiquement `color`. Si la migration target n'a pas encore la colonne → INSERT failed → ligne marquée `action: 'failed'` dans le log (gracieux, pas de crash global).
- **Bug fix dans serialize/sign sans changement de hash final.** Exemple : refactor de `deterministicStringify` pour gain perf, mais résultat string identique au caractère près. Aucune incidence sur les hashes existants → aucun bump.
- **Ajout d'un endpoint API ou d'un champ UI.** Pas de lien avec le format du bundle.
- **Changement de la borne `SNAPSHOT_BUNDLE_MAX_BYTES`.** C'est une politique runtime, pas une propriété du bundle. Pas de bump.

### 3.3 Décision pratique (arbre)

```
Le changement modifie-t-il…
├── …le shape JSON du bundle (clés, types, structure imbriquée) ?         → BUMP
├── …l'algorithme de signature ou la sémantique du hash ?                 → BUMP
├── …la liste SNAPSHOTTABLE_ENTITIES (ajout/retrait) ?                    → BUMP
├── …une FK applicative remappée par remapEntityIds ?                     → BUMP
├── …seulement une colonne nullable ajoutée à une entité existante ?      → PAS DE BUMP
├── …seulement du code interne sans incidence sur le hash final ?         → PAS DE BUMP
└── …seulement la politique runtime (taille max, retention) ?             → PAS DE BUMP
```

## §4 Procédure upgrade v1 → v2

Étapes ordonnées (à dérouler dans un seul PR atomique pour éviter un état worker incohérent en prod) :

### 4.1 Migration D1 (rarement)

Créer `migration-snapshot-v2-seqXXX.sql` **uniquement si** les tables `snapshots` / `snapshot_imports` doivent évoluer (ex: ajout d'une colonne `migration_log_json` qui trace la conversion v1 → v2 par bundle). Manifest entrée seqXXX dans [`docs/migrations-manifest.json`](../docs/migrations-manifest.json), `depends_on: ["migration-snapshots-seq130.sql"]`. 100 % ADDITIF, calque [LOT-SNAPSHOTS-S35.md §2](LOT-SNAPSHOTS-S35.md).

Dans la majorité des cas, **aucune migration n'est nécessaire** : le bump v1 → v2 ne touche que le code worker, pas la DDL.

### 4.2 Bump constante worker

```ts
// src/worker/lib/snapshot-export.ts
- export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
+ export const SNAPSHOT_SCHEMA_VERSION = 2 as const;
```

Mettre à jour le type `SnapshotBundle.schema_version` :

```ts
- schema_version: 1;
+ schema_version: 1 | 2;
```

### 4.3 Étendre `validateBundleSchema`

```ts
// src/worker/lib/snapshot-import.ts
- if (typeof bundle.schema_version !== 'number' ||
-     bundle.schema_version > 1 ||
-     bundle.schema_version < 1) {
-   return { ok: false, error: 'unsupported_schema_version' };
- }
+ if (typeof bundle.schema_version !== 'number' ||
+     bundle.schema_version > 2 ||
+     bundle.schema_version < 1) {
+   return { ok: false, error: 'unsupported_schema_version' };
+ }
```

### 4.4 Ajouter helper `migrateBundleV1ToV2`

```ts
// src/worker/lib/snapshot-migrate.ts (nouveau)
import type { SnapshotBundle } from './snapshot-export';
import { signPayload } from './snapshot-export';

export async function migrateBundleV1ToV2(bundle: SnapshotBundle): Promise<SnapshotBundle> {
  if (bundle.schema_version === 2) {
    return bundle; // passthrough
  }
  // Upgrade in-memory : bumper la version + injecter les nouveaux champs
  // attendus (defaults pour les entités neuves, par exemple).
  const upgraded = {
    magic: bundle.magic,
    schema_version: 2 as const,
    generated_at: bundle.generated_at,
    source: bundle.source,
    entities: {
      ...bundle.entities,
      product_reviews: [], // exemple : nouvelle entité v2 — vide pour bundles v1
    },
  };
  // Re-signer après migration (le hash change avec la nouvelle structure).
  return signPayload(upgraded);
}
```

### 4.5 Brancher la migration dans le pipeline d'import

```ts
// src/worker/snapshots-import.ts (handleImportSnapshot)
const parsed = parseBundle(raw);
if (!parsed.ok) return json({ error: parsed.error }, 400);

const v1Validated = validateBundleSchema(parsed.bundle);
if (!v1Validated.ok) return json({ error: v1Validated.error }, 400);

// NOUVEAU : migration v1 → v2 avant verifySignature côté worker v2
const migrated = parsed.bundle.schema_version === 1
  ? await migrateBundleV1ToV2(parsed.bundle)
  : parsed.bundle;

// Note : signature recalculée par migrateBundleV1ToV2 → verifySignature passe.
const verified = await verifySignature(migrated);
if (!verified.ok) return json({ error: 'signature_mismatch' }, 400);

// applyImport opère sur migrated (forme v2)
const result = await applyImport(env, migrated, options);
```

### 4.6 Tests d'anti-régression CI

```ts
describe('schema versioning', () => {
  it('v1 bundle imported by v2 worker → applyImport succeeds + hash recalculé', async () => {
    const v1Bundle = await buildV1Fixture();
    const result = await handleImportSnapshot(/* …v1Bundle… */);
    expect(result.summary.totals.product_reviews).toBeDefined();
    // Le bundle a été migré in-memory → totaux v2-shape.
  });

  it('v2 bundle imported by v1 worker → 400 unsupported_schema_version', async () => {
    const v2Bundle = { ...v1Bundle, schema_version: 2 };
    const result = validateBundleSchemaV1(v2Bundle);
    expect(result).toEqual({ ok: false, error: 'unsupported_schema_version' });
  });
});
```

## §5 Backward compat rules

### 5.1 Règles strictes

| Acteur | Version bundle | Action attendue |
|---|---|---|
| Worker v2 | v1 | ✅ Migrate in-memory v1 → v2 via `migrateBundleV1ToV2` → re-sign → import normal. |
| Worker v2 | v2 | ✅ Import direct. |
| Worker v2 | v3 (futur) | ❌ Reject `unsupported_schema_version` (400). |
| Worker v1 | v1 | ✅ Import direct. |
| Worker v1 | v2 | ❌ Reject `unsupported_schema_version` (400). |

### 5.2 Tests CI obligatoires

Pour chaque bump `N → N+1`, le PR DOIT inclure 4 tests d'anti-régression :

1. **Forward compat OK** : bundle v(N) importé par worker v(N+1) → succès + migration in-memory.
2. **Same-version OK** : bundle v(N+1) importé par worker v(N+1) → succès direct.
3. **Backward incompat OK** : bundle v(N+1) importé par worker v(N) → reject `unsupported_schema_version`.
4. **Hash recalculé après migration** : assert que `signature.hash_hex` du bundle migré ≠ celui du bundle d'origine.

Sans ces 4 tests, le PR ne peut pas merge.

## §6 Stockage migration trace

La colonne [`snapshot_imports.schema_version`](../migration-snapshots-seq130.sql) capture la version du bundle **au moment de l'import**. Permet l'audit historique :

```sql
SELECT id, snapshot_id, target_client_id, schema_version, mode, status, started_at
  FROM snapshot_imports
 WHERE target_client_id = ?
 ORDER BY started_at DESC;
```

Exemple de lecture :

| id | snapshot_id | target | schema_version | mode | status | started_at |
|---|---|---|---|---|---|---|
| `imp_a1` | `snp_x9` | `client_acme` | `1` | `commit` | `completed` | 2026-05-24 |
| `imp_b2` | `snp_x9` | `client_acme` | `1` | `commit` | `completed` | 2026-06-15 |
| `imp_c3` | `snp_y2` | `client_acme` | `2` | `dry_run` | `completed` | 2026-09-10 |

→ Audit : "ce bundle v1 a été importé en commit le 2026-05-24" / "à partir du 2026-09-10, le tenant a reçu un bundle v2".

Utilité opérationnelle :

- **Forensic** : si un tenant rapporte un bug post-import, on retrouve immédiatement la version du bundle et donc le code de migration appliqué.
- **Rollback ciblé** : si une migration v1 → v2 introduit un bug, on liste tous les imports `schema_version = 1 AND started_at > date_du_bug` pour rejouer.
- **Métriques de transition** : suivi de l'adoption v2 (% imports en v2 / total).

## §7 Tampered bundle detection

### 7.1 Mécanisme

La signature est **recalculée à l'import** ([`verifySignature`](../src/worker/lib/snapshot-import.ts):281-297) :

1. Copie le bundle SANS la propriété `signature`.
2. `deterministicStringify(copie)` → string canonique.
3. `sha256Hex(string)` → hash recalculé.
4. Comparaison stricte avec `bundle.signature.hash_hex`.

Toute modification d'un seul caractère dans `entities`, `source`, `generated_at`, `magic`, ou `schema_version` change la string canonique → change le hash → mismatch → reject `signature_mismatch` (400).

### 7.2 Limites v1 — intégrité ≠ authenticité

La signature SHA-256 v1 garantit **uniquement l'intégrité** (le bundle n'a pas été modifié depuis la signature). Elle ne garantit PAS l'**authenticité** (qui a produit ce bundle) — n'importe qui peut forger un bundle valide en recalculant le hash sur un payload arbitraire.

Conséquence : v1 est suffisante pour un **workflow intra-agence** (export par un admin → import par un autre admin de la même agence, transit fichier de confiance). Elle est **insuffisante pour un marketplace public** agence-to-agence où un attaquant pourrait distribuer un bundle malveillant signé.

### 7.3 Évolution v2 — HMAC tenant

Pour un futur marketplace cross-agence (Sprint 40+ hypothétique), le format v2 introduirait :

```json
{
  "signature": {
    "algo": "hmac-sha256",
    "key_id": "agency_xyz_signing_key_v1",
    "hash_hex": "…"
  }
}
```

Avec un secret HMAC dérivé par agence (rotation possible via `key_id`). Le worker v2 vérifie la signature contre la clé publique de l'agence émettrice (table `agency_signing_keys` à créer). Permet :

- **Révocation** : on retire la clé compromise, tous les bundles signés deviennent invalides.
- **Audit attribution** : on sait quelle agence a signé quel bundle.
- **Distribution publique** : les agences peuvent partager des snapshots de référence (templates métier) avec garantie d'origine.

Hors-scope v1 (cf. §10).

## §8 Exemples concrets

### 8.1 Bundle v1 valide (extrait)

```json
{
  "magic": "intralys-snapshot-v1",
  "schema_version": 1,
  "generated_at": "2026-05-24T14:32:11.847Z",
  "source": {
    "client_id": "client_abc123",
    "agency_id": "agency_xyz",
    "name": "Config courtage QC v3",
    "description": "Pipelines + workflows + templates SMS/email"
  },
  "entities": {
    "pipelines": [
      {
        "id": "pip_001",
        "client_id": "client_abc123",
        "name": "Hypothèque résidentielle",
        "created_at": "2026-01-15T08:00:00Z"
      }
    ],
    "pipeline_stages": [
      {
        "id": "stg_001",
        "pipeline_id": "pip_001",
        "client_id": "client_abc123",
        "name": "Demande reçue",
        "sort_order": 1
      },
      {
        "id": "stg_002",
        "pipeline_id": "pip_001",
        "client_id": "client_abc123",
        "name": "Pré-qualifié",
        "sort_order": 2
      }
    ],
    "email_templates": [
      {
        "id": "tpl_001",
        "client_id": "client_abc123",
        "name": "Bienvenue prospect",
        "subject": "Bienvenue chez {{agency.name}}",
        "html_body": "<p>Bonjour {{lead.first_name}}…</p>"
      }
    ]
  },
  "signature": {
    "algo": "sha256",
    "hash_hex": "9f3b2a8d4e1c7f6b5a3e2d1c0b9a8f7e6d5c4b3a2918f7e6d5c4b3a29180c1e2"
  }
}
```

### 8.2 Bundle v1 tampered → mismatch

Scénario : un attaquant modifie `pipeline_stages[0].name` de `"Demande reçue"` à `"Demande reçue ATTAQUE"` sans recalculer le hash.

```
serialized_original = deterministicStringify({…, name: "Demande reçue", …})
serialized_tampered = deterministicStringify({…, name: "Demande reçue ATTAQUE", …})

sha256(serialized_original) = 9f3b…c1e2    ← stocké dans bundle.signature.hash_hex
sha256(serialized_tampered) = a8c4…f7d1    ← recalculé à l'import

a8c4…f7d1 !== 9f3b…c1e2  → reject 400 signature_mismatch
```

L'attaquant DEVRAIT recalculer le hash pour avoir un bundle valide. C'est possible en v1 (signature = intégrité only, cf. §7.2). En v2 HMAC, l'attaquant ne pourrait pas re-signer sans le secret agency.

### 8.3 Bundle v2 hypothétique (Sprint 40+)

```json
{
  "magic": "intralys-snapshot-v1",
  "schema_version": 2,
  "generated_at": "2026-09-10T12:00:00Z",
  "source": {
    "client_id": "client_abc123",
    "agency_id": "agency_xyz",
    "name": "Config courtage QC v3 + reviews",
    "description": "Migration v1 → v2 : intégration product_reviews"
  },
  "entities": {
    "pipelines": [ /* … */ ],
    "pipeline_stages": [ /* … */ ],
    "/* …25 entités v1… */": [],
    "product_reviews": [
      {
        "id": "rev_001",
        "client_id": "client_abc123",
        "catalog_item_id": "cat_007",
        "rating": 5,
        "title": "Excellent service",
        "body": "…"
      }
    ]
  },
  "signature": {
    "algo": "hmac-sha256",
    "key_id": "agency_xyz_signing_key_v1",
    "hash_hex": "…"
  }
}
```

Différences v2 vs v1 :

- `schema_version: 2`
- 28e entité `product_reviews` dans `entities` (cf. §3.1)
- `signature.algo: 'hmac-sha256'` + `signature.key_id` (cf. §7.3)
- Tout le reste reste compatible.

## §9 Outils de migration

### 9.1 CLI / endpoint admin (TODO Sprint 40+)

Si un besoin réel apparaît (ex: agence avec 200 bundles v1 archivés à migrer en bulk vers v2 avant déploiement), prévoir :

```bash
intralys snapshot migrate \
  --from-v1 \
  --to-v2 \
  --input  bundle.json \
  --output bundle-v2.json \
  --sign-key agency_xyz_signing_key_v1
```

Ou endpoint authed admin :

```http
POST /api/admin/snapshots/migrate
Content-Type: application/json

{
  "bundle": { /* v1 bundle */ },
  "target_version": 2
}
→ 200 { data: { bundle: /* v2 bundle */ } }
```

Pas câblé Sprint 35. La migration v1 → v2 se fait de toute façon **à la volée** côté import worker v2 (§4.5) — pas besoin de pré-migrer des fichiers sur disque dans la majorité des cas.

### 9.2 Validation d'un bundle hors import

Helper futur exposable côté UI (Settings → Snapshots → "Vérifier un fichier") :

```ts
export async function validateBundleStandalone(raw: string): Promise<{
  ok: true;
  version: number;
  entity_count: number;
  size_bytes: number;
}> | { ok: false; error: string };
```

Permet à un admin de tester l'intégrité d'un bundle avant de tenter un import (`dry_run` en local). Pas câblé Sprint 35, posé en TODO Phase C v2.

## §10 Limitations et hors-scope v1

- **Pas de marketplace public agence-to-agence**. La signature SHA-256 v1 garantit l'intégrité mais pas l'authenticité (§7.2). Pour un partage cross-agence sans confiance préalable, il faut HMAC tenant (v2 hypothétique §7.3). Sprint 35 cible le workflow intra-agence + intra-tenant uniquement.
- **Pas de delta-snapshots**. Un bundle = export FULL à l'instant T (les 27 entités + toutes leurs rows). Pas de mécanisme « depuis le dernier export, voici ce qui a changé ». Pour la sauvegarde incrémentale, utiliser les outils D1 natifs (Cloudflare backups). Le scope Snapshots = portage de config, pas backup.
- **Pas d'encryption at-rest du `payload_json`**. La whitelist 27 entités **exclut explicitement** tout secret / token / PII ([LOT-SNAPSHOTS-S35.md §6.4](LOT-SNAPSHOTS-S35.md)) — le payload est par construction sans donnée sensible. D1 est chiffré at-rest par Cloudflare (AES-256), ce qui suffit. Pas de chiffrement applicatif additionnel (vs. tokens OAuth chiffrés AES-GCM Sprint 33).
- **Pas de rollback automatique post-import**. Une fois `applyImport(mode='commit')` exécuté, les INSERT sont persistés. Le `id_mapping_json` stocké dans `snapshot_imports` permet un **rollback manuel** (SELECT les new_id du mapping, DELETE chez target) — pas de bouton « Annuler import » dans l'UI. Acceptable car le `dry_run` obligatoire avant `commit` (wizard 3 étapes [LOT-SNAPSHOTS-S35.md §5](LOT-SNAPSHOTS-S35.md)) prévient les imports accidentels.
- **Pas de validation cross-entity sémantique au schema validation**. [`validateBundleSchema`](../src/worker/lib/snapshot-import.ts):232-274 vérifie la **structure** (clés, types, whitelist) mais pas la **cohérence métier** (ex: `pipeline_stages[i].pipeline_id` doit exister dans `pipelines`). Les FK applicatives sont résolues au moment du remap ([`remapEntityIds`](../src/worker/lib/snapshot-import.ts):311-382) — si une FK orpheline existe, elle est conservée telle quelle (pas de remap car pas dans le globalMap). Le INSERT côté target peut alors échouer si la table cible a une CHECK / FK (très rare D1 Intralys, cf. [LOT-SNAPSHOTS-S35.md §2](LOT-SNAPSHOTS-S35.md) "ZÉRO CHECK / FK") — auquel cas la ligne tombe en `action: 'failed'`, log propre, pas de crash global.
- **Pas de versioning sémantique des entités individuelles**. Le `schema_version` couvre le **format du bundle entier**, pas chaque entité indépendamment. Si on veut versionner `workflows` séparément (ex: workflows v1 vs v2), il faut bumper le bundle entier. Acceptable car le format reste simple et monolithique en v1.

---

**Cross-references** :
- [`LOT-SNAPSHOTS-S35.md`](LOT-SNAPSHOTS-S35.md) — contrat Sprint 35 §6 inter-agent (idempotence, dry_run vs commit, whitelist, bornage tenant)
- [`RGPD-CALL-RECORDINGS-S34.md`](RGPD-CALL-RECORDINGS-S34.md) — pattern doc précédent (calque structure §1-§10)
- [`src/worker/lib/snapshot-export.ts`](../src/worker/lib/snapshot-export.ts) — `SNAPSHOT_SCHEMA_VERSION`, `SNAPSHOT_MAGIC_HEADER`, `SNAPSHOTTABLE_ENTITIES`, `deterministicStringify`, `signPayload`
- [`src/worker/lib/snapshot-import.ts`](../src/worker/lib/snapshot-import.ts) — `validateBundleSchema` (rejette `schema_version > 1`), `verifySignature`, `remapEntityIds`, `applyImport`
- [`migration-snapshots-seq130.sql`](../migration-snapshots-seq130.sql) — DDL tables `snapshots` + `snapshot_imports` (col `schema_version` capturée par import)
- [`docs/migrations-manifest.json`](../docs/migrations-manifest.json) — manifest entrée seq130
