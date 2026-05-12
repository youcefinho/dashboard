// ── Tests handleCreateLead (Sprint 12 A.1) ─────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCreateLead } from '../leads';
import type { Env } from '../types';

describe('handleCreateLead', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    run: vi.fn(),
  };
  const mockEnv = { DB: mockDb } as unknown as Env;
  const auth = { role: 'admin', userId: 'user-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReturnValue(mockDb);
    mockDb.bind.mockReturnValue(mockDb);
  });

  const makeReq = (body: Record<string, unknown>) =>
    new Request('http://localhost/api/leads', { method: 'POST', body: JSON.stringify(body) });

  it('refuse les non-admins', async () => {
    const res = await handleCreateLead(makeReq({}), mockEnv, { role: 'user', userId: 'u' });
    expect(res.status).toBe(403);
  });

  it('exige client_id, name et email', async () => {
    const res1 = await handleCreateLead(makeReq({ name: 'X', email: 'x@y.com' }), mockEnv, auth);
    expect(res1.status).toBe(400);
    expect((await res1.json() as { error: string }).error).toMatch(/client_id/);

    const res2 = await handleCreateLead(makeReq({ client_id: 'c1', email: 'x@y.com' }), mockEnv, auth);
    expect(res2.status).toBe(400);
    expect((await res2.json() as { error: string }).error).toMatch(/Nom/);

    const res3 = await handleCreateLead(makeReq({ client_id: 'c1', name: 'X' }), mockEnv, auth);
    expect(res3.status).toBe(400);
    expect((await res3.json() as { error: string }).error).toMatch(/Email/);
  });

  it('retourne 404 si le client n\'existe pas', async () => {
    mockDb.first.mockResolvedValueOnce(null);
    const res = await handleCreateLead(
      makeReq({ client_id: 'missing', name: 'Jean', email: 'jean@test.com' }), mockEnv, auth
    );
    expect(res.status).toBe(404);
  });

  it('retourne 409 si email déjà présent pour le client', async () => {
    mockDb.first.mockResolvedValueOnce({ id: 'c1' });    // client lookup
    mockDb.first.mockResolvedValueOnce({ id: 'lead-x' }); // duplicate lookup
    const res = await handleCreateLead(
      makeReq({ client_id: 'c1', name: 'Jean', email: 'jean@test.com' }), mockEnv, auth
    );
    expect(res.status).toBe(409);
  });

  it('crée le lead et renvoie 201 avec l\'id', async () => {
    mockDb.first.mockResolvedValueOnce({ id: 'c1' }); // client lookup
    mockDb.first.mockResolvedValueOnce(null);          // duplicate check : aucun
    mockDb.run.mockResolvedValue({});                  // INSERT + audit

    const res = await handleCreateLead(
      makeReq({ client_id: 'c1', name: 'Jean Tremblay', email: 'JEAN@Test.com', phone: '514-555-1234', source: 'manual' }),
      mockEnv, auth
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBeTruthy();

    const insertCall = mockDb.bind.mock.calls.find(call => typeof call[0] === 'string' && call[0].length > 20);
    expect(insertCall).toBeTruthy();
    expect(insertCall![2]).toBe('Jean Tremblay');
    expect(insertCall![3]).toBe('jean@test.com');
  });

  it('défaut le type à inbound si valeur invalide', async () => {
    mockDb.first.mockResolvedValueOnce({ id: 'c1' });
    mockDb.first.mockResolvedValueOnce(null);
    mockDb.run.mockResolvedValue({});

    const res = await handleCreateLead(
      makeReq({ client_id: 'c1', name: 'X', email: 'x@y.com', type: 'spam' }), mockEnv, auth
    );
    expect(res.status).toBe(201);
    const insertCall = mockDb.bind.mock.calls.find(call => call.includes('inbound') || call.includes('customer'));
    expect(insertCall).toBeTruthy();
  });
});
