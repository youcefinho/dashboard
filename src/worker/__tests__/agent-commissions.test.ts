import { describe, it, expect, vi } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import { onAgentLeadWon, handleGetAgentCommissions, handleUpdateAgentCommissionStatus } from '../agent-commissions';

const adminAuth = { role: 'admin', userId: 'user-admin', clientId: 'c1' };
const brokerAuth = { role: 'broker', userId: 'user-broker', clientId: 'c1' };

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

describe('Commissions d\'agent de vente — logique métier (onAgentLeadWon)', () => {
  it('devrait calculer et insérer une commission de 5% pour un lead gagné', async () => {
    const db = createMockD1();
    
    // Seed du lead à won avec deal_value de 1000$ et assigné à user-broker
    db.seed('SELECT client_id, assigned_to, deal_value, status FROM leads', [{
      client_id: 'c1',
      assigned_to: 'user-broker',
      deal_value: 1000,
      status: 'won'
    }]);

    // Pas de commission pré-existante
    db.seed('SELECT 1 AS x FROM agent_commissions WHERE lead_id = ?', []);

    // L'agent existe
    db.seed('SELECT id FROM users WHERE (id = ? OR name = ?)', [{ id: 'user-broker' }]);

    await onAgentLeadWon(envWith(db), 'lead_1');

    // Vérifier l'insertion (1000$ * 0.05 = 50$, soit 5000 cents)
    const inserts = db.calls.filter(c => c.sql.includes('INSERT INTO agent_commissions'));
    expect(inserts.length).toBe(1);
    expect(inserts[0].args[0]).toBe('c1');
    expect(inserts[0].args[1]).toBe('user-broker');
    expect(inserts[0].args[2]).toBe('lead_1');
    expect(inserts[0].args[3]).toBe(5000); // 5000 cents
  });

  it('devrait respecter l\'idempotence (pas de double commission)', async () => {
    const db = createMockD1();
    
    db.seed('SELECT client_id, assigned_to, deal_value, status FROM leads', [{
      client_id: 'c1',
      assigned_to: 'user-broker',
      deal_value: 1000,
      status: 'won'
    }]);

    // Commission existe déjà
    db.seed('SELECT 1 AS x FROM agent_commissions WHERE lead_id = ?', [{ x: 1 }]);

    await onAgentLeadWon(envWith(db), 'lead_1');

    // Pas d'insertion
    const inserts = db.calls.filter(c => c.sql.includes('INSERT INTO agent_commissions'));
    expect(inserts.length).toBe(0);
  });

  it('devrait résoudre l\'agent par son nom si assigned_to contient un nom', async () => {
    const db = createMockD1();
    
    db.seed('SELECT client_id, assigned_to, deal_value, status FROM leads', [{
      client_id: 'c1',
      assigned_to: 'John Doe',
      deal_value: 500,
      status: 'won'
    }]);

    db.seed('SELECT 1 AS x FROM agent_commissions WHERE lead_id = ?', []);

    // Nom résolu vers user-broker
    db.seed('SELECT id FROM users WHERE (id = ? OR name = ?)', [{ id: 'user-broker' }]);

    await onAgentLeadWon(envWith(db), 'lead_1');

    // Vérifier l'insertion (500$ * 0.05 = 25$, soit 2500 cents)
    const inserts = db.calls.filter(c => c.sql.includes('INSERT INTO agent_commissions'));
    expect(inserts.length).toBe(1);
    expect(inserts[0].args[1]).toBe('user-broker');
    expect(inserts[0].args[3]).toBe(2500);
  });
});

describe('Commissions d\'agent de vente — endpoints d\'API', () => {
  it('GET /api/agent-commissions (admin) -> retourne toutes les commissions', async () => {
    const db = createMockD1();
    db.seed('SELECT ac.*, u.name as agent_name, u.email as agent_email, l.name as lead_name', [
      { id: 'comm_1', commission_cents: 5000, status: 'pending', agent_name: 'Agent A' },
      { id: 'comm_2', commission_cents: 2500, status: 'paid', agent_name: 'Agent B' }
    ]);

    const res = await handleGetAgentCommissions(envWith(db), adminAuth, new URL('http://localhost/api?client_id=c1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: any[] };
    expect(body.data.length).toBe(2);
    expect(body.data[0].id).toBe('comm_1');
  });

  it('GET /api/agent-commissions (broker) -> filtre par son propre ID', async () => {
    const db = createMockD1();
    db.seed('SELECT ac.*, u.name as agent_name, u.email as agent_email, l.name as lead_name', [
      { id: 'comm_1', commission_cents: 5000, status: 'pending', user_id: 'user-broker' }
    ]);

    const res = await handleGetAgentCommissions(envWith(db), brokerAuth, new URL('http://localhost/api'));
    expect(res.status).toBe(200);
    
    // Vérifier que la clause WHERE filtre par user_id
    const calls = db.calls.filter(c => c.sql.includes('ac.user_id = ?'));
    expect(calls.length).toBe(1);
    expect(calls[0].args[1]).toBe('user-broker');
  });

  it('POST /api/agent-commissions/:id/status (admin) -> met à jour le statut', async () => {
    const db = createMockD1();
    db.seed('SELECT id, client_id, commission_cents FROM agent_commissions', [{ id: 'comm_1', client_id: 'c1', commission_cents: 5000 }]);

    const res = await handleUpdateAgentCommissionStatus(
      makeReq({ status: 'paid' }),
      envWith(db),
      adminAuth,
      'comm_1'
    );

    expect(res.status).toBe(200);
    const updates = db.calls.filter(c => c.sql.includes('UPDATE agent_commissions SET status = ?'));
    expect(updates.length).toBe(1);
    expect(updates[0].args[0]).toBe('paid');
  });

  it('POST /api/agent-commissions/:id/status (broker) -> retourne 403', async () => {
    const db = createMockD1();
    const res = await handleUpdateAgentCommissionStatus(
      makeReq({ status: 'paid' }),
      envWith(db),
      brokerAuth,
      'comm_1'
    );
    expect(res.status).toBe(403);
  });
});
