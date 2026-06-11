// ── offline-sync-engine.test.ts — Sprint 97 (seq192) ────────────────────────
// Tests pour le mode hors-ligne mobile et la synchronisation.
// 14 cas : manifeste, conflits, résolution, payload, validation.

import { describe, it, expect } from 'vitest';
import {
  buildSyncManifest,
  detectConflict,
  resolveConflict,
  buildSyncPayload,
  validateSyncResponse,
  SYNC_ENTITY_TYPES,
  CONFLICT_STRATEGIES,
  SYNC_ERROR_CODES,
  type SyncEntity,
} from '../lib/offline-sync-engine';

// Helper pour créer une entité de test
function makeEntity(
  id: string,
  updatedAt: string,
  opts?: Partial<SyncEntity>,
): SyncEntity {
  return {
    id,
    entity_type: 'leads',
    updated_at: updatedAt,
    data: { name: `Lead ${id}` },
    is_dirty: false,
    ...opts,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// buildSyncManifest — 4 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S97 — buildSyncManifest', () => {
  const LAST_SYNC = '2026-05-01T00:00:00Z';

  it('1. Entité modifiée localement → toUpload', () => {
    const local = [makeEntity('L1', '2026-05-15T00:00:00Z', { is_dirty: true })];
    const remote = [makeEntity('L1', '2026-04-01T00:00:00Z')];
    const manifest = buildSyncManifest(local, remote, LAST_SYNC);
    expect(manifest.toUpload.length).toBe(1);
    expect(manifest.toUpload[0]!.id).toBe('L1');
    expect(manifest.conflicts.length).toBe(0);
  });

  it('2. Entité modifiée à distance → toDownload', () => {
    const local = [makeEntity('L1', '2026-04-01T00:00:00Z')];
    const remote = [makeEntity('L1', '2026-05-15T00:00:00Z')];
    const manifest = buildSyncManifest(local, remote, LAST_SYNC);
    expect(manifest.toDownload.length).toBe(1);
    expect(manifest.toDownload[0]).toBe('L1');
  });

  it('3. Modifiée des deux côtés → conflit', () => {
    const local = [makeEntity('L1', '2026-05-10T00:00:00Z', { is_dirty: true })];
    const remote = [makeEntity('L1', '2026-05-12T00:00:00Z')];
    const manifest = buildSyncManifest(local, remote, LAST_SYNC);
    expect(manifest.conflicts.length).toBe(1);
    expect(manifest.conflicts[0]!.reason).toBe('both_modified');
  });

  it('4. Nouvelle entité distante (pas en local) → toDownload', () => {
    const local: SyncEntity[] = [];
    const remote = [makeEntity('R1', '2026-05-15T00:00:00Z')];
    const manifest = buildSyncManifest(local, remote, LAST_SYNC);
    expect(manifest.toDownload).toContain('R1');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// detectConflict — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S97 — detectConflict', () => {
  it('5. Même content_hash → no_conflict', () => {
    const local = makeEntity('L1', '2026-05-10T00:00:00Z', { content_hash: 'abc' });
    const remote = makeEntity('L1', '2026-05-12T00:00:00Z', { content_hash: 'abc' });
    expect(detectConflict(local, remote)).toBe('no_conflict');
  });

  it('6. Local plus récent → local_newer', () => {
    const local = makeEntity('L1', '2026-05-15T00:00:00Z');
    const remote = makeEntity('L1', '2026-05-10T00:00:00Z');
    expect(detectConflict(local, remote)).toBe('local_newer');
  });

  it('7. Remote plus récent → remote_newer', () => {
    const local = makeEntity('L1', '2026-05-10T00:00:00Z');
    const remote = makeEntity('L1', '2026-05-15T00:00:00Z');
    expect(detectConflict(local, remote)).toBe('remote_newer');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// resolveConflict — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S97 — resolveConflict', () => {
  it('8. local_priority → retourne local', () => {
    const local = makeEntity('L1', '2026-05-10T00:00:00Z');
    const remote = makeEntity('L1', '2026-05-15T00:00:00Z');
    expect(resolveConflict(local, remote, 'local_priority').id).toBe(local.id);
    expect(resolveConflict(local, remote, 'local_priority').updated_at).toBe(local.updated_at);
  });

  it('9. remote_priority → retourne remote', () => {
    const local = makeEntity('L1', '2026-05-15T00:00:00Z');
    const remote = makeEntity('L1', '2026-05-10T00:00:00Z');
    expect(resolveConflict(local, remote, 'remote_priority').updated_at).toBe(remote.updated_at);
  });

  it('10. last_write_wins → le plus récent gagne', () => {
    const local = makeEntity('L1', '2026-05-10T00:00:00Z');
    const remote = makeEntity('L1', '2026-05-15T00:00:00Z');
    expect(resolveConflict(local, remote, 'last_write_wins').updated_at).toBe(remote.updated_at);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildSyncPayload — 1 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S97 — buildSyncPayload', () => {
  it('11. Payload compact sans métadonnées locales', () => {
    const changes = [
      makeEntity('L1', '2026-05-15T00:00:00Z', { is_dirty: true, content_hash: 'xyz' }),
    ];
    const now = new Date('2026-06-01T00:00:00Z');
    const payload = buildSyncPayload(changes, 'token-abc', now);
    expect(payload.sync_token).toBe('token-abc');
    expect(payload.client_timestamp).toBe('2026-06-01T00:00:00.000Z');
    expect(payload.entities.length).toBe(1);
    // Pas de is_dirty ni content_hash dans le payload
    expect((payload.entities[0] as Record<string, unknown>).is_dirty).toBeUndefined();
    expect((payload.entities[0] as Record<string, unknown>).content_hash).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// validateSyncResponse — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S97 — validateSyncResponse', () => {
  it('12. Réponse valide → ok', () => {
    const response = {
      success: true,
      sync_token: 'new-token',
      server_timestamp: '2026-06-01T00:00:00Z',
      applied: ['L1', 'L2'],
      rejected: [],
    };
    const result = validateSyncResponse(response);
    expect(result.ok).toBe(true);
    expect(result.data?.applied.length).toBe(2);
  });

  it('13. Réponse invalide (sync_token manquant) → erreur', () => {
    const response = { success: true, sync_token: '', server_timestamp: '2026-06-01', applied: [] };
    const result = validateSyncResponse(response);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(SYNC_ERROR_CODES.RESPONSE_INVALID);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Config structurelle
// ──────────────────────────────────────────────────────────────────────────

describe('S97 — config exports', () => {
  it('14. SYNC_ENTITY_TYPES = 4 types', () => {
    expect(SYNC_ENTITY_TYPES.length).toBe(4);
    expect(SYNC_ENTITY_TYPES).toContain('leads');
    expect(SYNC_ENTITY_TYPES).toContain('tasks');
    expect(SYNC_ENTITY_TYPES).toContain('appointments');
    expect(SYNC_ENTITY_TYPES).toContain('messages');
  });

  it('15. CONFLICT_STRATEGIES = 3 stratégies', () => {
    expect(CONFLICT_STRATEGIES.length).toBe(3);
  });
});
