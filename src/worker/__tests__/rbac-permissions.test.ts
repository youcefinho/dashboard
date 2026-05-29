import { describe, it, expect } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import { resolveCapabilities } from '../capabilities';
import { handleGetRoles, handleUpdateRolePermission } from '../team';

const adminAuth = { role: 'admin', userId: 'user-admin', clientId: 'c1', tenant: { agencyId: 'agency-1', accessibleClientIds: ['c1'] } };
const brokerAuth = { role: 'broker', userId: 'user-broker', clientId: 'c1', tenant: { agencyId: 'agency-1', accessibleClientIds: ['c1'] } };

function envWith(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('RBAC Rôles & Permissions — resolveCapabilities', () => {
  it('devrait retourner les permissions par défaut si role_permissions est vide ou absente', async () => {
    const db = createMockD1();
    
    // Simuler absence de role_generic dans users -> fallback technique
    db.seed('SELECT role_generic FROM users WHERE id = ?', []);
    // Simuler absence de la table role_permissions (erreur)
    db.seed('SELECT capability, allowed FROM role_permissions WHERE role_name = ?', new Error('no table'));
    // Seed pour role_capabilities
    db.seed('SELECT capability FROM role_capabilities WHERE role_generic = ?', [
      { capability: 'leads.read' },
      { capability: 'leads.write' }
    ]);
    // Pas d'override
    db.seed('SELECT capability, granted FROM user_capability_overrides WHERE user_id = ?', []);

    const caps = await resolveCapabilities(envWith(db), brokerAuth);
    expect(caps.has('leads.read')).toBe(true);
    expect(caps.has('leads.write')).toBe(true);
    expect(caps.has('leads.delete')).toBe(false);
  });

  it('devrait lire et appliquer les permissions de la table role_permissions', async () => {
    const db = createMockD1();
    
    // role_generic = manager (broker)
    db.seed('SELECT role_generic FROM users WHERE id = ?', [{ role_generic: 'manager' }]);
    // role_permissions configurée : seulement leads.read est allowed
    db.seed('SELECT capability, allowed FROM role_permissions WHERE role_name = ?', [
      { capability: 'leads.read', allowed: 1 },
      { capability: 'leads.write', allowed: 0 }
    ]);
    db.seed('SELECT capability, granted FROM user_capability_overrides WHERE user_id = ?', []);

    const caps = await resolveCapabilities(envWith(db), brokerAuth);
    expect(caps.has('leads.read')).toBe(true);
    expect(caps.has('leads.write')).toBe(false);
  });

  it('devrait accorder toutes les permissions au rôle owner ou admin d\'office', async () => {
    const db = createMockD1();
    
    const caps = await resolveCapabilities(envWith(db), adminAuth);
    expect(caps.has('leads.read')).toBe(true);
    expect(caps.has('settings.manage')).toBe(true);
    expect(caps.has('invoices.write')).toBe(true);
  });
});

describe('RBAC Rôles & Permissions — endpoints d\'API', () => {
  it('GET /api/team/roles -> devrait lire depuis role_permissions en priorité', async () => {
    const db = createMockD1();
    
    // role_permissions avec leads.read activé pour manager
    db.seed('SELECT role_name, capability FROM role_permissions WHERE allowed = 1', [
      { role_name: 'manager', capability: 'leads.read' }
    ]);

    const res = await handleGetRoles(new Request('http://x'), envWith(db), adminAuth);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: any[] };
    
    const manager = body.data.find(r => r.id === 'manager');
    expect(manager).toBeDefined();
    expect(manager.capabilities).toContain('leads.read');
    expect(manager.capabilities).not.toContain('leads.write');
    
    // Owner a toujours toutes les permissions
    const owner = body.data.find(r => r.id === 'owner');
    expect(owner.capabilities.length).toBe(12);
  });

  it('POST /api/team/roles/permissions (admin) -> devrait modifier une permission', async () => {
    const db = createMockD1();
    
    const res = await handleUpdateRolePermission(
      makeReq({
        role_name: 'manager',
        capability: 'leads.write',
        allowed: false
      }),
      envWith(db),
      adminAuth
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { success: boolean } };
    expect(body.data.success).toBe(true);

    const inserts = db.calls.filter(c => c.sql.includes('INSERT INTO role_permissions'));
    expect(inserts.length).toBe(1);
    expect(inserts[0].args[1]).toBe('manager');
    expect(inserts[0].args[2]).toBe('leads.write');
    expect(inserts[0].args[3]).toBe(0); // false -> 0
  });

  it('POST /api/team/roles/permissions (admin) -> ne devrait pas modifier le rôle owner', async () => {
    const db = createMockD1();
    
    const res = await handleUpdateRolePermission(
      makeReq({
        role_name: 'owner',
        capability: 'leads.write',
        allowed: false
      }),
      envWith(db),
      adminAuth
    );

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('propriétaire');
  });

  it('POST /api/team/roles/permissions (non-admin) -> devrait être rejeté (403)', async () => {
    const db = createMockD1();
    
    // Simuler le fait que le broker n'a pas la capability settings.manage
    const brokerAuthNoSettings = {
      ...brokerAuth,
      capabilities: new Set(['leads.read'])
    };

    const res = await handleUpdateRolePermission(
      makeReq({
        role_name: 'manager',
        capability: 'leads.write',
        allowed: false
      }),
      envWith(db),
      brokerAuthNoSettings
    );

    expect(res.status).toBe(403);
  });
});
