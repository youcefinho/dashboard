import { describe, it, expect } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import { auditSystem, handleGetSystemAuditLogs } from '../system-audit';

const adminAuth = { role: 'admin', userId: 'user-admin', clientId: 'c1', capabilities: new Set(['settings.manage']) };
const brokerAuth = { role: 'broker', userId: 'user-broker', clientId: 'c1', capabilities: new Set<string>() };
const brokerAuthWithCap = { role: 'broker', userId: 'user-broker', clientId: 'c1', capabilities: new Set(['settings.manage']) };

function envWith(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

describe('Journal d\'Audit Système — Enregistrement (auditSystem)', () => {
  it('devrait insérer une ligne d\'audit système', async () => {
    const db = createMockD1();
    
    await auditSystem(
      envWith(db),
      'c1',
      'user-admin',
      'user.login',
      'user',
      'user-admin',
      { success: true },
      '127.0.0.1'
    );

    const inserts = db.calls.filter(c => c.sql.includes('INSERT INTO system_audit_logs'));
    expect(inserts.length).toBe(1);
    expect(inserts[0].args[1]).toBe('c1');
    expect(inserts[0].args[2]).toBe('user-admin');
    expect(inserts[0].args[3]).toBe('user.login');
    expect(inserts[0].args[4]).toBe('user');
    expect(inserts[0].args[5]).toBe('user-admin');
    expect(inserts[0].args[6]).toBe('{"success":true}');
    expect(inserts[0].args[7]).toBe('127.0.0.1');
  });

  it('ne devrait pas throw d\'erreur en cas d\'échec de la base de données', async () => {
    const db = createMockD1();
    db.prepare = () => { throw new Error('Database down'); };

    let threw = false;
    try {
      await auditSystem(
        envWith(db),
        'c1',
        'user-admin',
        'user.login',
        'user',
        'user-admin',
        null,
        null
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe('Journal d\'Audit Système — Lecture (handleGetSystemAuditLogs)', () => {
  it('GET /api/system-audit-logs (admin) -> retourne les logs filtrés par client_id', async () => {
    const db = createMockD1();
    db.seed('SELECT id, user_id, action, target_type, target_id, payload_json, ip_address, created_at', [
      { id: 'log_1', user_id: 'user-admin', action: 'user.login', target_type: 'user', target_id: 'user-admin', payload_json: '{}', ip_address: '127.0.0.1', created_at: '2026-05-29 12:00:00' }
    ]);
    db.seed('SELECT COUNT(*) as total', [{ total: 1 }]);

    const res = await handleGetSystemAuditLogs(
      new Request('http://localhost/api/system-audit-logs'),
      envWith(db),
      adminAuth
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { data: any[]; pagination: any };
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe('log_1');
    expect(body.pagination.total).toBe(1);

    // Vérifier la clause WHERE sur client_id
    const calls = db.calls.filter(c => c.sql.includes('WHERE client_id = ?'));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].args[0]).toBe('c1');
  });

  it('GET /api/system-audit-logs (broker avec settings.manage) -> autorise l\'accès', async () => {
    const db = createMockD1();
    db.seed('SELECT id, user_id, action, target_type, target_id, payload_json, ip_address, created_at', []);
    db.seed('SELECT COUNT(*) as total', [{ total: 0 }]);

    const res = await handleGetSystemAuditLogs(
      new Request('http://localhost/api/system-audit-logs'),
      envWith(db),
      brokerAuthWithCap
    );

    expect(res.status).toBe(200);
  });

  it('GET /api/system-audit-logs (broker sans capability) -> retourne 403', async () => {
    const db = createMockD1();
    const res = await handleGetSystemAuditLogs(
      new Request('http://localhost/api/system-audit-logs'),
      envWith(db),
      brokerAuth
    );

    expect(res.status).toBe(403);
  });

  it('devrait appliquer les filtres d\'action et target_type', async () => {
    const db = createMockD1();
    db.seed('SELECT id, user_id, action, target_type, target_id, payload_json, ip_address, created_at', []);
    db.seed('SELECT COUNT(*) as total', [{ total: 0 }]);

    const res = await handleGetSystemAuditLogs(
      new Request('http://localhost/api/system-audit-logs?action=user.login&target_type=user'),
      envWith(db),
      adminAuth
    );

    expect(res.status).toBe(200);
    const calls = db.calls.filter(c => c.sql.includes('SELECT id, user_id'));
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain('AND action = ?');
    expect(calls[0].sql).toContain('AND target_type = ?');
    expect(calls[0].args).toContain('user.login');
    expect(calls[0].args).toContain('user');
  });
});
