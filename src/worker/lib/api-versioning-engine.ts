// ── api-versioning-engine.ts — Sprint 96 (seq191) ───────────────────────────
// Versioning strict d'API publique avec compat transformers.
//
// Couvre :
//   - Parsing de version depuis le path (/v1/leads, /v2/leads)
//   - Vérification de support et dépréciation
//   - Construction de headers de versioning (X-API-Version, Deprecation, Sunset)
//   - Transformation de payloads entre versions (compat layer)
//   - Registre des breaking changes v1→v2
//
// ZÉRO I/O. Helpers purs pour le routeur worker.ts.

// ── Versions supportées ───────────────────────────────────────────────────

export const API_VERSIONS = Object.freeze(['v1', 'v2'] as const);
export type ApiVersion = (typeof API_VERSIONS)[number];

const VERSION_SET: ReadonlySet<string> = new Set<string>(API_VERSIONS);

/** Version courante (dernière stable). */
export const CURRENT_API_VERSION: ApiVersion = 'v2';

/** Versions dépréciées (toujours servies mais avec header Deprecation). */
export const DEPRECATED_VERSIONS: ReadonlySet<ApiVersion> = new Set<ApiVersion>(['v1']);

/** Date de fin de support pour les versions dépréciées. */
export const SUNSET_DATES: Readonly<Record<string, string>> = Object.freeze({
  v1: '2027-06-01',
});

// ── Parsing de path ───────────────────────────────────────────────────────

export interface ParsedApiPath {
  /** Version détectée (v1, v2). */
  version: ApiVersion;
  /** Ressource demandée (leads, tasks, etc.). */
  resource: string;
  /** ID optionnel de la ressource. */
  id?: string;
  /** Reste du path après la ressource/id. */
  rest?: string;
}

const API_PATH_RE = /^\/api\/(?:public\/)?(?:(v[12])\/)(\w+)(?:\/([^/]+))?(?:\/(.+))?$/;

/** Parse un path d'API versionné.
 *  `/api/v1/leads/abc123` → `{ version: 'v1', resource: 'leads', id: 'abc123' }`
 *  `/api/public/v2/forms/xyz` → `{ version: 'v2', resource: 'forms', id: 'xyz' }`
 *  Retourne null si le path ne match pas le pattern versionné. */
export function parseApiVersion(path: string): ParsedApiPath | null {
  if (typeof path !== 'string') return null;
  const match = path.match(API_PATH_RE);
  if (!match) return null;

  const [, version, resource, id, rest] = match;
  if (!version || !resource) return null;
  if (!VERSION_SET.has(version)) return null;

  const result: ParsedApiPath = {
    version: version as ApiVersion,
    resource,
  };
  if (id) result.id = id;
  if (rest) result.rest = rest;
  return result;
}

// ── Vérifications de support ──────────────────────────────────────────────

/** Vérifie si une version est supportée (même dépréciée). */
export function isVersionSupported(version: string): boolean {
  return VERSION_SET.has(version);
}

/** Vérifie si une version est dépréciée (toujours fonctionnelle mais bientôt retirée). */
export function isVersionDeprecated(version: string): boolean {
  return DEPRECATED_VERSIONS.has(version as ApiVersion);
}

// ── Headers de versioning ─────────────────────────────────────────────────

/** Construit les headers de versioning pour une réponse API.
 *  Inclut `X-API-Version`, et pour les versions dépréciées :
 *  `Deprecation: true` + `Sunset: <date>` (RFC 8594). */
export function buildVersionHeaders(version: ApiVersion): Record<string, string> {
  const headers: Record<string, string> = {
    'X-API-Version': version,
  };

  if (DEPRECATED_VERSIONS.has(version)) {
    headers['Deprecation'] = 'true';
    const sunset = SUNSET_DATES[version];
    if (sunset) {
      headers['Sunset'] = new Date(sunset).toUTCString();
    }
    headers['X-API-Migration'] = `Migrer vers /${CURRENT_API_VERSION}/ avant le ${sunset ?? 'TBD'}`;
  }

  return headers;
}

// ── Transformation de payloads ────────────────────────────────────────────

/** Registre des transformations de noms de champs v1→v2.
 *  v1 utilise camelCase (héritage), v2 utilise snake_case (standard REST). */
export const V1_TO_V2_FIELD_MAP = Object.freeze({
  // Leads
  firstName: 'first_name',
  lastName: 'last_name',
  phoneNumber: 'phone_number',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  dealValue: 'deal_value',
  leadScore: 'lead_score',
  propertyType: 'property_type',
  // Tasks
  dueDate: 'due_date',
  assignedTo: 'assigned_to',
  completedAt: 'completed_at',
  // Pipeline
  stageId: 'stage_id',
  pipelineId: 'pipeline_id',
  movedAt: 'moved_at',
} as const);

const V2_TO_V1_FIELD_MAP: Record<string, string> = {};
for (const [k, v] of Object.entries(V1_TO_V2_FIELD_MAP)) {
  V2_TO_V1_FIELD_MAP[v] = k;
}

/** Transforme un payload d'une version à une autre.
 *  Renomme les champs selon le registre de mapping.
 *  Les champs non-mappés sont conservés tels quels. */
export function transformPayload(
  data: Record<string, unknown>,
  fromVersion: ApiVersion,
  toVersion: ApiVersion,
): Record<string, unknown> {
  if (fromVersion === toVersion) return data;
  if (!data || typeof data !== 'object') return data;

  const fieldMap =
    fromVersion === 'v1' && toVersion === 'v2'
      ? V1_TO_V2_FIELD_MAP
      : fromVersion === 'v2' && toVersion === 'v1'
        ? V2_TO_V1_FIELD_MAP
        : null;

  if (!fieldMap) return data;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const mappedKey = (fieldMap as Record<string, string>)[key] ?? key;
    result[mappedKey] = value;
  }
  return result;
}

// ── Breaking changes documentation ────────────────────────────────────────

export interface BreakingChange {
  version: ApiVersion;
  description: string;
  migration: string;
}

/** Registre des changements cassants documentés entre versions. */
export const BREAKING_CHANGES: readonly BreakingChange[] = Object.freeze([
  {
    version: 'v2',
    description: 'Tous les noms de champs passent de camelCase à snake_case',
    migration: 'Utiliser le transformateur automatique ou mettre à jour les mappings client',
  },
  {
    version: 'v2',
    description: 'Les dates retournent en format ISO 8601 strict (avec timezone Z)',
    migration: 'Parser les dates avec Date.parse() ou new Date()',
  },
  {
    version: 'v2',
    description: 'Les IDs numériques sont remplacés par des UUIDs v4',
    migration: 'Utiliser les UUIDs comme identifiants (type TEXT)',
  },
  {
    version: 'v2',
    description: 'Pagination : offset/limit → cursor-based (next_cursor)',
    migration: 'Utiliser le champ next_cursor au lieu de page/offset',
  },
]);
