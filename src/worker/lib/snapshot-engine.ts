// ── Sprint 35 — snapshot-engine.ts — Helpers PURS réutilisables (renforcement) ──
// 100% ADDITIF. Ne casse pas snapshot-export.ts ni snapshot-import.ts.
//
// Pourquoi ce fichier alors que snapshot-export.ts + snapshot-import.ts
// existent déjà ?
//   - Les deux fichiers actuels mélangent helpers PURS + accès D1 + logique
//     handler-spécifique. Ce moteur extrait UNIQUEMENT les helpers purs +
//     ajoute 3 capacités neuves (HMAC anti-tampering, topo sort par
//     dépendance, codes d'erreur stables) qui peuvent être réutilisés par :
//       a) handlers REST (`snapshots.ts`, `snapshots-import.ts`)
//       b) CLI futurs (export disk bundle, import depuis CI)
//       c) tâches scheduled (auto-snapshot quotidien, GC vieux snapshots)
//
// Contrat (FIGÉ pour Phase B + extensible) :
//   - SNAPSHOT_MAX_BUNDLE_BYTES = 10 MiB (cap anti-DoS plus permissif que
//     les 5 MiB historiques pour les bundles signés HMAC qui ajoutent ~64 B
//     de header + signature; existing SNAPSHOT_BUNDLE_MAX_BYTES inchangé).
//   - HMAC SHA-256 = anti-tampering renforcé vs simple SHA-256.
//   - constant-time compare = anti-timing-attack sur la vérification.
//   - topo sort = ordre dépendance strict (parent AVANT enfant) pour insert.
//
// Pas de dépendance circulaire : ce fichier importe `SNAPSHOTTABLE_ENTITIES`
// + `SNAPSHOT_MAGIC_HEADER` depuis snapshot-export.ts (déjà figés), et
// définit ses propres helpers HMAC / topo / codes — sans import inverse.

import {
  SNAPSHOTTABLE_ENTITIES,
  SNAPSHOT_MAGIC_HEADER,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotBundle,
  type SnapshottableEntity,
} from './snapshot-export';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes publiques
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cap dur anti-DoS pour bundles HMAC-signés (10 MiB). Plus permissif que
 * SNAPSHOT_BUNDLE_MAX_BYTES (5 MiB historique) pour absorber l'overhead
 * éventuel d'un wrap HMAC + métadata supplémentaires. NE remplace pas
 * `validateBundleSize` (qui reste à 5 MiB pour compatibilité Phase A).
 */
export const SNAPSHOT_MAX_BUNDLE_BYTES = 10 * 1024 * 1024;

/**
 * Codes d'erreur stables pour le moteur. Documenter en réponse REST permet
 * au frontend (Manager UI Sprint 35) de mapper sur des i18n strings ciblés
 * au lieu de parser des messages humains qui peuvent dériver.
 *
 * Garantie de stabilité : ces codes sont COMMITTED. Une release future
 * peut AJOUTER de nouveaux codes, mais ne renommera ni ne supprimera jamais
 * un code existant (semver patch-safe pour le contract client/handler).
 */
export const SNAPSHOT_ERROR_CODES = {
  INVALID_JSON: 'invalid_json',
  MALFORMED_BUNDLE: 'malformed_bundle',
  INVALID_MAGIC: 'invalid_magic',
  UNSUPPORTED_SCHEMA_VERSION: 'unsupported_schema_version',
  MISSING_SIGNATURE: 'missing_signature',
  SIGNATURE_MISMATCH: 'signature_mismatch',
  BUNDLE_TOO_LARGE: 'bundle_too_large',
  ENTITY_NOT_WHITELISTED: 'entity_not_whitelisted',
  ENTITY_NOT_ARRAY: 'entity_not_array',
  EMPTY_SECRET: 'empty_secret',
} as const;

export type SnapshotErrorCode =
  (typeof SNAPSHOT_ERROR_CODES)[keyof typeof SNAPSHOT_ERROR_CODES];

/**
 * Ordre de dépendance entre les 27 entités (parent → enfant). Un INSERT
 * d'un enfant échouera si le parent référencé n'existe pas encore côté
 * target. Cette table est utilisée par `topologicalSort()` pour ré-ordonner
 * les entities[] avant un import.
 *
 * Convention : la clé est l'enfant, la valeur la liste des parents requis.
 * Une entity ABSENTE de cette table = pas de dépendance externe (peut être
 * insérée en premier).
 */
const ENTITY_DEPENDENCIES: Readonly<
  Partial<Record<SnapshottableEntity, readonly SnapshottableEntity[]>>
> = {
  // workflows → workflow_folders (folder_id)
  workflows: ['workflow_folders'],
  // workflow_steps → workflows (workflow_id)
  workflow_steps: ['workflows'],
  // pipeline_stages → pipelines (pipeline_id)
  pipeline_stages: ['pipelines'],
  // form_field_options → forms (form_id)
  form_field_options: ['forms'],
  // availability_rules → calendars (calendar_id)
  availability_rules: ['calendars'],
  // email_templates / sms_templates → template_folders (folder_id)
  email_templates: ['template_folders'],
  sms_templates: ['template_folders'],
  // forms → template_folders (folder_id optionnel)
  forms: ['template_folders'],
  // trigger_links peuvent référencer workflows (mais souvent libre)
  trigger_links: ['workflows'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Sérialisation deterministe (réplique snapshot-export.ts en pur local pour
// éviter dépendance circulaire et garantir reproductibilité cross-call)
// ─────────────────────────────────────────────────────────────────────────────

function deterministicStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(deterministicStringify).join(',') + ']';
  }
  const keys = Object.keys(value as object).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          deterministicStringify((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HMAC SHA-256 (Web Crypto, Workers native)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode un Uint8Array en hex lower-case.
 */
function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Importe une clé HMAC SHA-256 depuis une string secret (UTF-8). Réservé
 * usage interne (signBundle / verifyBundleSignature).
 */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Signe `content` (string sérialisée) avec HMAC SHA-256 + clé secrète tenant.
 * Renvoie l'hex lower-case (64 caractères). Anti-tampering : sans la clé,
 * l'attaquant ne peut PAS produire une signature valide pour un payload
 * altéré.
 *
 * Usage typique :
 *   const sig = await signBundle(serializeBundle(bundle), tenantSecret);
 *   bundle.signature.hmac_sha256_hex = sig;
 *
 * @throws Si `secret` est vide (anti-mésusage : clé vide = pas de sécurité).
 */
export async function signBundle(
  content: string,
  secret: string,
): Promise<string> {
  if (!secret || secret.length === 0) {
    throw new Error(SNAPSHOT_ERROR_CODES.EMPTY_SECRET);
  }
  const key = await importHmacKey(secret);
  const encoder = new TextEncoder();
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(content));
  return bytesToHex(new Uint8Array(sigBuffer));
}

/**
 * Compare deux strings hex en CONSTANT TIME (XOR byte-à-byte). Évite les
 * timing attacks sur la vérification de signature (un attaquant ne peut pas
 * deviner la signature en mesurant les divergences de temps).
 *
 * Si les longueurs diffèrent → return false IMMÉDIATEMENT (pas une fuite,
 * la length d'une signature SHA-256 est publique = 64).
 */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Vérifie qu'une signature HMAC SHA-256 (hex) correspond au `content` signé
 * avec `secret`. Constant-time compare. Retourne `false` si :
 *   - secret vide
 *   - signature mal formée (longueur ≠ 64 ou caractères non-hex)
 *   - signature ne match pas
 *
 * @returns true si valide, false sinon. Pas d'exception sur input mal formé
 *          (pour ne pas révéler la nature de l'échec à un attaquant).
 */
export async function verifyBundleSignature(
  content: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!secret || secret.length === 0) return false;
  if (typeof signature !== 'string' || signature.length !== 64) return false;
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = await signBundle(content, secret);
  return constantTimeEqualHex(expected.toLowerCase(), signature.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation structure bundle (version + entities + signature)
// ─────────────────────────────────────────────────────────────────────────────

export interface BundleStructureOk {
  ok: true;
  bundle: SnapshotBundle;
}

export interface BundleStructureFail {
  ok: false;
  error: string;
  code: SnapshotErrorCode;
}

export type BundleStructureResult = BundleStructureOk | BundleStructureFail;

/**
 * Validation structurelle d'un bundle parsé (déjà passé par JSON.parse). Plus
 * stricte que `validateBundleSchema` de snapshot-import.ts : ajoute des codes
 * d'erreur stables + accepte des bundles avec `entities` vide pour permettre
 * un round-trip "snapshot template" minimal.
 *
 * Codes possibles :
 *   - INVALID_JSON              raw === null / non-object
 *   - INVALID_MAGIC             magic absent ou ≠ SNAPSHOT_MAGIC_HEADER
 *   - UNSUPPORTED_SCHEMA_VERSION  version absent, NaN, hors range [1, current]
 *   - MISSING_SIGNATURE         signature absente ou hash_hex absent
 *   - MALFORMED_BUNDLE          source / entities absent
 *   - ENTITY_NOT_WHITELISTED    clé entities.* hors SNAPSHOTTABLE_ENTITIES
 *   - ENTITY_NOT_ARRAY          entities.X n'est pas un array
 */
export function validateBundleStructure(raw: unknown): BundleStructureResult {
  if (raw === null || typeof raw !== 'object') {
    return {
      ok: false,
      error: 'raw input is not an object',
      code: SNAPSHOT_ERROR_CODES.INVALID_JSON,
    };
  }

  const bundle = raw as Partial<SnapshotBundle>;

  if (bundle.magic !== SNAPSHOT_MAGIC_HEADER) {
    return {
      ok: false,
      error: `magic header mismatch (expected ${SNAPSHOT_MAGIC_HEADER})`,
      code: SNAPSHOT_ERROR_CODES.INVALID_MAGIC,
    };
  }

  const version = bundle.schema_version;
  if (
    typeof version !== 'number' ||
    !Number.isFinite(version) ||
    version < 1 ||
    version > SNAPSHOT_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      error: `schema_version ${String(version)} unsupported (current ${SNAPSHOT_SCHEMA_VERSION})`,
      code: SNAPSHOT_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
    };
  }

  if (!bundle.source || typeof bundle.source !== 'object') {
    return {
      ok: false,
      error: 'source object missing',
      code: SNAPSHOT_ERROR_CODES.MALFORMED_BUNDLE,
    };
  }

  if (!bundle.entities || typeof bundle.entities !== 'object') {
    return {
      ok: false,
      error: 'entities object missing',
      code: SNAPSHOT_ERROR_CODES.MALFORMED_BUNDLE,
    };
  }

  // Validation entities : whitelist + array
  const allowedSet: Set<string> = new Set(SNAPSHOTTABLE_ENTITIES);
  for (const key of Object.keys(bundle.entities)) {
    if (!allowedSet.has(key)) {
      return {
        ok: false,
        error: `entity '${key}' is not in the whitelist`,
        code: SNAPSHOT_ERROR_CODES.ENTITY_NOT_WHITELISTED,
      };
    }
    const rows = (bundle.entities as Record<string, unknown>)[key];
    if (!Array.isArray(rows)) {
      return {
        ok: false,
        error: `entities.${key} must be an array`,
        code: SNAPSHOT_ERROR_CODES.ENTITY_NOT_ARRAY,
      };
    }
  }

  if (!bundle.signature || typeof bundle.signature !== 'object') {
    return {
      ok: false,
      error: 'signature object missing',
      code: SNAPSHOT_ERROR_CODES.MISSING_SIGNATURE,
    };
  }
  if (
    typeof bundle.signature.hash_hex !== 'string' ||
    bundle.signature.hash_hex.length === 0
  ) {
    return {
      ok: false,
      error: 'signature.hash_hex missing or empty',
      code: SNAPSHOT_ERROR_CODES.MISSING_SIGNATURE,
    };
  }

  return { ok: true, bundle: bundle as SnapshotBundle };
}

// ─────────────────────────────────────────────────────────────────────────────
// ID mapping & topological sort
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forme acceptée pour les entities d'un bundle (subset / Record / structure
 * complète SnapshotBundle.entities). Permet à `buildIdMapping` et
 * `topologicalSort` d'être polyvalents (bundle complet OU subset partiel).
 */
export type EntityRecord = Partial<
  Record<SnapshottableEntity, Array<Record<string, unknown>>>
>;

/**
 * Construit un mapping `old_id → new_uuid` GLOBAL pour toutes les rows de
 * toutes les entités passées. Utilise `crypto.randomUUID()` (RFC 4122 v4).
 *
 * Garantie d'unicité : chaque old_id distinct est mappé sur un new_uuid
 * unique. Si la MÊME old_id apparaît dans plusieurs entités (collision
 * cross-table), elle est mappée UNE seule fois sur UNE seule new_uuid
 * (premier passé gagne). C'est volontaire : un old_id partagé indique une
 * FK applicative et doit pointer vers le même new_id partout.
 *
 * Rows sans `id` (ou id non-string ou empty) sont SILENCIEUSEMENT ignorées.
 */
export function buildIdMapping(entities: EntityRecord): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    const rows = entities[entity];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const oldId = (row as Record<string, unknown>).id;
      if (typeof oldId !== 'string' || oldId.length === 0) continue;
      if (!mapping[oldId]) {
        mapping[oldId] = crypto.randomUUID();
      }
    }
  }
  return mapping;
}

/**
 * Métadata d'une entité après topological sort. Permet aux callers d'itérer
 * dans l'ordre dépendance-safe sans connaître la table ENTITY_DEPENDENCIES.
 */
export interface SortedEntity {
  entity: SnapshottableEntity;
  rows: Array<Record<string, unknown>>;
  depth: number; // 0 = pas de parent, 1 = enfant direct, etc.
}

/**
 * Trie les 27 entités selon leur ordre de dépendance (parent AVANT enfant).
 * Algo Kahn's (topological sort). Garantit qu'au moment d'insérer un enfant,
 * son parent est déjà inséré côté target (pas de FK orpheline transitoire).
 *
 * Les entités sans dépendance (workflow_folders, template_folders, calendars,
 * etc.) ont depth=0. Les enfants directs (workflows → folders) depth=1.
 * Les petits-enfants (workflow_steps → workflows → folders) depth=2.
 *
 * Entités présentes dans `entities` mais inconnues de SNAPSHOTTABLE_ENTITIES
 * sont SILENCIEUSEMENT ignorées (anti-injection — c'est le job de
 * validateBundleStructure de signaler ces clés ailleurs).
 */
export function topologicalSort(entities: EntityRecord): SortedEntity[] {
  // Calcul depth par BFS depuis les roots (entités sans dependency).
  const depth = new Map<SnapshottableEntity, number>();
  const computeDepth = (entity: SnapshottableEntity, visiting: Set<SnapshottableEntity>): number => {
    if (depth.has(entity)) return depth.get(entity)!;
    if (visiting.has(entity)) {
      // Cycle (ne devrait pas arriver vu ENTITY_DEPENDENCIES figée) → 0.
      return 0;
    }
    const deps = ENTITY_DEPENDENCIES[entity];
    if (!deps || deps.length === 0) {
      depth.set(entity, 0);
      return 0;
    }
    visiting.add(entity);
    let maxDep = 0;
    for (const parent of deps) {
      const parentDepth = computeDepth(parent, visiting);
      if (parentDepth + 1 > maxDep) maxDep = parentDepth + 1;
    }
    visiting.delete(entity);
    depth.set(entity, maxDep);
    return maxDep;
  };

  for (const entity of SNAPSHOTTABLE_ENTITIES) {
    computeDepth(entity, new Set());
  }

  const sorted: SortedEntity[] = SNAPSHOTTABLE_ENTITIES
    .filter((entity) => Array.isArray(entities[entity]))
    .map((entity) => ({
      entity,
      rows: entities[entity] ?? [],
      depth: depth.get(entity) ?? 0,
    }));

  // Tri stable : depth ASC puis ordre d'origine dans SNAPSHOTTABLE_ENTITIES.
  // L'index sert de tiebreaker pour garantir un ordre déterministe.
  const indexOf = (e: SnapshottableEntity) => SNAPSHOTTABLE_ENTITIES.indexOf(e);
  sorted.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return indexOf(a.entity) - indexOf(b.entity);
  });

  return sorted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse signature mismatch (extraction depuis message d'erreur handler)
// ─────────────────────────────────────────────────────────────────────────────

export interface SignatureMismatchPair {
  expected: string;
  actual: string;
}

/**
 * Extrait `{ expected, actual }` depuis un message d'erreur handler du genre
 * "signature_mismatch: expected=<hex64> actual=<hex64>" OU depuis un objet
 * JSON `{ error, meta: { expected, actual } }` sérialisé en string.
 *
 * Retourne null si le format ne match aucun pattern connu (le caller doit
 * gérer le fallback "signature_mismatch sans détail").
 *
 * Patterns reconnus :
 *   1) "expected=<hex64> actual=<hex64>"     (handler text format)
 *   2) "expected: <hex64>, actual: <hex64>"  (variante avec deux-points)
 *   3) JSON contenant {"expected":"<hex>","actual":"<hex>"}
 */
export function parseSignatureMismatch(
  input: string | Error,
): SignatureMismatchPair | null {
  const msg = input instanceof Error ? input.message : String(input ?? '');
  if (!msg) return null;

  // Pattern 1 : "expected=<hex> actual=<hex>"
  const eq = msg.match(/expected\s*=\s*([0-9a-f]{64}).*?actual\s*=\s*([0-9a-f]{64})/i);
  if (eq && eq[1] && eq[2]) {
    return { expected: eq[1].toLowerCase(), actual: eq[2].toLowerCase() };
  }

  // Pattern 2 : "expected: <hex>, actual: <hex>"
  const colon = msg.match(/expected\s*:\s*"?([0-9a-f]{64})"?.*?actual\s*:\s*"?([0-9a-f]{64})"?/i);
  if (colon && colon[1] && colon[2]) {
    return { expected: colon[1].toLowerCase(), actual: colon[2].toLowerCase() };
  }

  // Pattern 3 : JSON
  try {
    const parsed = JSON.parse(msg) as Record<string, unknown>;
    const meta =
      (parsed.meta as Record<string, unknown> | undefined) ?? parsed;
    const exp = meta.expected;
    const act = meta.actual;
    if (
      typeof exp === 'string' &&
      typeof act === 'string' &&
      /^[0-9a-f]{64}$/i.test(exp) &&
      /^[0-9a-f]{64}$/i.test(act)
    ) {
      return { expected: exp.toLowerCase(), actual: act.toLowerCase() };
    }
  } catch {
    /* not JSON, fall through */
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cap anti-DoS — validation taille bundle moteur (10 MiB, ≠ Phase A 5 MiB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vérifie que la taille sérialisée ne dépasse pas SNAPSHOT_MAX_BUNDLE_BYTES.
 * Distincte de `validateBundleSize` de snapshot-export.ts (5 MiB historique)
 * pour permettre aux callers du moteur d'opter pour la borne plus permissive
 * si leur cas d'usage le justifie (bundle multi-tenant agency batch, etc.).
 */
export function validateEngineBundleSize(
  serialized: string,
): { ok: true } | { ok: false; code: SnapshotErrorCode; error: string } {
  if (typeof serialized !== 'string') {
    return {
      ok: false,
      code: SNAPSHOT_ERROR_CODES.MALFORMED_BUNDLE,
      error: 'serialized must be a string',
    };
  }
  if (serialized.length > SNAPSHOT_MAX_BUNDLE_BYTES) {
    return {
      ok: false,
      code: SNAPSHOT_ERROR_CODES.BUNDLE_TOO_LARGE,
      error: `bundle exceeds ${SNAPSHOT_MAX_BUNDLE_BYTES} bytes`,
    };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports pratiques (pour ne pas obliger les callers à importer 2 fichiers)
// ─────────────────────────────────────────────────────────────────────────────

export { deterministicStringify as engineDeterministicStringify };
export {
  SNAPSHOT_MAGIC_HEADER,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOTTABLE_ENTITIES,
  type SnapshotBundle,
  type SnapshottableEntity,
};
