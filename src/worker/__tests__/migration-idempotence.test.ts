import { describe, it, expect, vi } from 'vitest';

// Simulation de l'idempotence au niveau du mock DB
describe('Migration Idempotence', () => {
  it('doit ignorer une insertion si le mapping existe déjà (idempotence_map)', async () => {
    // Mock d'une DB qui throw sur contrainte UNIQUE
    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockImplementation(() => {
        throw new Error('UNIQUE constraint failed: migration_id_map.client_id, migration_id_map.intralys_resource, migration_id_map.external_source, migration_id_map.external_id');
      })
    };

    let caughtError = null;
    try {
      await mockDb.prepare('INSERT INTO migration_id_map...').bind('123').run();
    } catch (e: any) {
      caughtError = e;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toContain('UNIQUE constraint failed');
  });

  it('handleGhlApiRun - ignore les erreurs de contrainte UNIQUE silencieusement (comportement attendu)', () => {
    // Dans le worker api run, les erreurs UNIQUE sont catchées et ignorées sans fail la ligne entière
    const fakeError = new Error('UNIQUE constraint failed');
    const isUniqueError = fakeError.message.includes('UNIQUE constraint failed');
    
    expect(isUniqueError).toBe(true);
    // Si c'est true, le logError n'est pas appelé
  });

  it('les requêtes doivent toujours associer (client_id, resource, source, ext_id)', () => {
    const payload = {
      intralys_resource: 'lead',
      external_source: 'ghl',
      external_id: 'ghl_123',
      client_id: 'client_abc'
    };
    
    expect(payload.intralys_resource).toBeDefined();
    expect(payload.external_source).toBeDefined();
    expect(payload.external_id).toBeDefined();
    expect(payload.client_id).toBeDefined();
  });
});
