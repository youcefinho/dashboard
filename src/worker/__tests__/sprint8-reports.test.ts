import { describe, it, expect } from 'bun:test';
import { handleGetSavedReports, handleCreateSavedReport, handleDeleteSavedReport } from '../src/worker/reports';

// Mock Env
const mockDb = {
  data: {} as any,
  prepare: (query: string) => {
    return {
      bind: (...args: any[]) => {
        return {
          first: async () => null,
          all: async () => ({ results: [{ id: '123', name: 'Test Report', type: 'sales' }] }),
          run: async () => ({ success: true })
        };
      }
    };
  }
};

const mockEnv = { DB: mockDb as any } as any;

describe('Sprint 8 - Reports', () => {
  it('doit récupérer les rapports sauvegardés', async () => {
    const res = await handleGetSavedReports(mockEnv, { id: '1' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toBeDefined();
    expect(body.data[0].name).toBe('Test Report');
  });

  it('doit créer un rapport sauvegardé', async () => {
    const req = new Request('http://localhost/api/reports/saved', {
      method: 'POST',
      headers: { 'X-Client-Id': 'gatineau' },
      body: JSON.stringify({ name: 'Rapport Ventes Q1', type: 'sales', config_json: { period: '90d' } })
    });
    const res = await handleCreateSavedReport(req, mockEnv, { id: '1' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe('Rapport Ventes Q1');
  });

  it('doit rejeter la création sans nom ou type', async () => {
    const req = new Request('http://localhost/api/reports/saved', {
      method: 'POST',
      body: JSON.stringify({ name: 'Incomplet' })
    });
    const res = await handleCreateSavedReport(req, mockEnv, { id: '1' });
    expect(res.status).toBe(400);
  });

  it('doit supprimer un rapport sauvegardé', async () => {
    const res = await handleDeleteSavedReport(mockEnv, { id: '1' }, '123');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.success).toBe(true);
  });
});
