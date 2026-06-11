// ── offline-sync-engine.ts — Sprint 97 (seq192) ────────────────────────────
// Mode hors-ligne mobile : synchronisation bidirectionnelle avec détection
// et résolution de conflits.
//
// Couvre :
//   - Types d'entités synchronisables (leads, tasks, appointments, messages)
//   - Construction de manifeste de sync (upload/download/conflits)
//   - Détection de conflits (timestamps + hash)
//   - Stratégies de résolution (last_write_wins, local_priority, remote_priority)
//   - Payload de sync compact pour envoi batch
//   - Validation de réponse de sync
//
// ZÉRO I/O. Helpers purs — le caller gère IndexedDB/SQLite et les appels réseau.

// ── Types d'entités ───────────────────────────────────────────────────────

export const SYNC_ENTITY_TYPES = Object.freeze([
  'leads',
  'tasks',
  'appointments',
  'messages',
] as const);

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];


// ── Stratégies de résolution ──────────────────────────────────────────────

export const CONFLICT_STRATEGIES = Object.freeze([
  'last_write_wins',
  'local_priority',
  'remote_priority',
] as const);

export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];

// ── Codes d'erreur ────────────────────────────────────────────────────────

export const SYNC_ERROR_CODES = Object.freeze({
  ENTITY_TYPE_INVALID: 'SYNC_ENTITY_TYPE_INVALID',
  MANIFEST_INVALID: 'SYNC_MANIFEST_INVALID',
  CONFLICT_UNRESOLVABLE: 'SYNC_CONFLICT_UNRESOLVABLE',
  PAYLOAD_TOO_LARGE: 'SYNC_PAYLOAD_TOO_LARGE',
  RESPONSE_INVALID: 'SYNC_RESPONSE_INVALID',
} as const);

export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[keyof typeof SYNC_ERROR_CODES];

// ── Interfaces ────────────────────────────────────────────────────────────

export interface SyncEntity {
  id: string;
  entity_type: SyncEntityType;
  updated_at: string;
  /** Hash MD5 du contenu pour détection de changement rapide. */
  content_hash?: string;
  /** Données de l'entité. */
  data: Record<string, unknown>;
  /** Flag local : modifié offline. */
  is_dirty?: boolean;
  /** Flag local : supprimé offline (soft delete). */
  is_deleted?: boolean;
}

export interface SyncConflict {
  entity_id: string;
  entity_type: SyncEntityType;
  local: SyncEntity;
  remote: SyncEntity;
  reason: 'both_modified' | 'deleted_locally_modified_remotely' | 'modified_locally_deleted_remotely';
}

export interface SyncManifest {
  /** Entités modifiées localement à envoyer au serveur. */
  toUpload: SyncEntity[];
  /** IDs d'entités à télécharger depuis le serveur (plus récentes). */
  toDownload: string[];
  /** Conflits détectés nécessitant résolution. */
  conflicts: SyncConflict[];
  /** Timestamp de la dernière sync réussie. */
  lastSyncAt: string;
}

// ── Construction du manifeste ─────────────────────────────────────────────

/** Construit le manifeste de synchronisation en comparant les entités locales
 *  et distantes. Identifie les uploads, downloads et conflits. */
export function buildSyncManifest(
  localEntities: SyncEntity[],
  remoteEntities: SyncEntity[],
  lastSyncAt: string,
): SyncManifest {
  const lastSyncMs = Date.parse(lastSyncAt) || 0;

  // Indexer les entités distantes par ID
  const remoteMap = new Map<string, SyncEntity>();
  for (const re of remoteEntities) {
    if (re && re.id) remoteMap.set(re.id, re);
  }

  const toUpload: SyncEntity[] = [];
  const toDownload: string[] = [];
  const conflicts: SyncConflict[] = [];
  const processedIds = new Set<string>();

  for (const local of localEntities) {
    if (!local || !local.id) continue;
    processedIds.add(local.id);

    const remote = remoteMap.get(local.id);

    if (!remote) {
      // Nouvelle entité locale → upload
      if (local.is_dirty) {
        toUpload.push(local);
      }
      continue;
    }

    const localMs = Date.parse(local.updated_at) || 0;
    const remoteMs = Date.parse(remote.updated_at) || 0;
    const localModified = localMs > lastSyncMs && local.is_dirty;
    const remoteModified = remoteMs > lastSyncMs;

    if (localModified && remoteModified) {
      // Les deux ont été modifiés → conflit
      if (local.content_hash && remote.content_hash && local.content_hash === remote.content_hash) {
        // Même contenu → pas de vrai conflit, skip
        continue;
      }
      conflicts.push({
        entity_id: local.id,
        entity_type: local.entity_type,
        local,
        remote,
        reason: local.is_deleted
          ? 'deleted_locally_modified_remotely'
          : 'both_modified',
      });
    } else if (localModified) {
      toUpload.push(local);
    } else if (remoteModified) {
      toDownload.push(remote.id);
    }
  }

  // Nouvelles entités distantes (pas en local)
  for (const remote of remoteEntities) {
    if (!remote || !remote.id) continue;
    if (!processedIds.has(remote.id)) {
      toDownload.push(remote.id);
    }
  }

  return { toUpload, toDownload, conflicts, lastSyncAt };
}

// ── Détection de conflits ─────────────────────────────────────────────────

/** Détecte le type de conflit entre une version locale et une version distante. */
export function detectConflict(
  local: SyncEntity,
  remote: SyncEntity,
): 'no_conflict' | 'local_newer' | 'remote_newer' | 'both_modified' {
  if (!local || !remote) return 'no_conflict';
  const localMs = Date.parse(local.updated_at) || 0;
  const remoteMs = Date.parse(remote.updated_at) || 0;

  // Même hash = même contenu = pas de conflit
  if (local.content_hash && remote.content_hash && local.content_hash === remote.content_hash) {
    return 'no_conflict';
  }

  if (localMs === remoteMs) return 'both_modified';
  if (localMs > remoteMs) return 'local_newer';
  return 'remote_newer';
}

// ── Résolution de conflits ────────────────────────────────────────────────

/** Résout un conflit selon la stratégie choisie. Retourne l'entité gagnante. */
export function resolveConflict(
  local: SyncEntity,
  remote: SyncEntity,
  strategy: ConflictStrategy,
): SyncEntity {
  switch (strategy) {
    case 'local_priority':
      return local;
    case 'remote_priority':
      return remote;
    case 'last_write_wins': {
      const localMs = Date.parse(local.updated_at) || 0;
      const remoteMs = Date.parse(remote.updated_at) || 0;
      return localMs >= remoteMs ? local : remote;
    }
    default:
      return remote; // Fallback safe : serveur gagne
  }
}

// ── Payload de sync compact ───────────────────────────────────────────────

/** Taille maximale du payload de sync (5 MB). */
export const MAX_SYNC_PAYLOAD_BYTES = 5 * 1024 * 1024;

export interface SyncPayload {
  entities: Array<{
    id: string;
    entity_type: SyncEntityType;
    data: Record<string, unknown>;
    is_deleted?: boolean;
  }>;
  sync_token: string;
  client_timestamp: string;
}

/** Construit un payload de sync compact pour envoi batch.
 *  Exclut les métadonnées locales (is_dirty, content_hash). */
export function buildSyncPayload(
  changes: SyncEntity[],
  syncToken: string,
  now: Date = new Date(),
): SyncPayload {
  return {
    entities: changes.map((e) => ({
      id: e.id,
      entity_type: e.entity_type,
      data: e.data,
      ...(e.is_deleted ? { is_deleted: true } : {}),
    })),
    sync_token: syncToken,
    client_timestamp: now.toISOString(),
  };
}

// ── Validation de réponse de sync ─────────────────────────────────────────

export interface SyncResponse {
  success: boolean;
  sync_token: string;
  server_timestamp: string;
  applied: string[];
  rejected: Array<{ id: string; reason: string }>;
}

/** Valide structurellement la réponse du serveur après un sync push. */
export function validateSyncResponse(response: unknown): {
  ok: boolean;
  error?: SyncErrorCode;
  data?: SyncResponse;
} {
  if (!response || typeof response !== 'object') {
    return { ok: false, error: SYNC_ERROR_CODES.RESPONSE_INVALID };
  }
  const r = response as Record<string, unknown>;
  if (typeof r.success !== 'boolean') {
    return { ok: false, error: SYNC_ERROR_CODES.RESPONSE_INVALID };
  }
  if (typeof r.sync_token !== 'string' || r.sync_token.length === 0) {
    return { ok: false, error: SYNC_ERROR_CODES.RESPONSE_INVALID };
  }
  if (typeof r.server_timestamp !== 'string') {
    return { ok: false, error: SYNC_ERROR_CODES.RESPONSE_INVALID };
  }
  if (!Array.isArray(r.applied)) {
    return { ok: false, error: SYNC_ERROR_CODES.RESPONSE_INVALID };
  }
  return { ok: true, data: r as unknown as SyncResponse };
}
