// ── security-admin.test.ts — Sprint 23 (Manager-B) ──────────────────────
//
// Couvre les 4 handlers admin (audit log viewer + RBAC overrides CRUD).
// Approche identique à onboarding-checklist-s21.test.ts : mock D1 (db.calls
// + seed). Les tests assertent sur :
//   - status / code retour (AGENCY_ONLY / OVERRIDE_INVALID / INVALID_INPUT)
//   - shape du body (data: [...])
//   - SQL émis (filtres action LIKE, WHERE user_id, UPSERT, DELETE)
//   - audit() bien appelé (méta-audit)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import {
  handleGetAuditLog,
  handleGetCapabilityOverrides,
  handleSetCapabilityOverride,
  handleDeleteCapabilityOverride,
} from '../security-admin';

type Auth = {
  userId: string;
  tenant?: { agencyId: string | null };
  capabilities?: Set<string>;
};

const AUTH_LEGACY: Auth = { userId: 'admin-1' };
const AUTH_AGENCY_OK_SETTINGS: Auth = {
  userId: 'admin-1',
  tenant: { agencyId: 'agency-1' },
  capabilities: new Set(['settings.manage']),
};
const AUTH_AGENCY_OK_TEAM: Auth = {
  userId: 'admin-1',
  tenant: { agencyId: 'agency-1' },
  capabilities: new Set(['team.manage']),
};
const AUTH_AGENCY_KO: Auth = {
  userId: 'admin-1',
  tenant: { agencyId: 'agency-1' },
  capabilities: new Set(['leads.read']),
};

function getReq(path: string): Request {
  return new Request(`http://x${path}`, { method: 'GET' });
}

function postReq(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, { method: 'POST', body: JSON.stringify(body) });
}

function deleteReq(path: string): Request {
  return new Request(`http://x${path}`, { method: 'DELETE' });
}

function makeEnv(): { env: Env; db: ReturnType<typeof createMockD1> } {
  const db = createMockD1();
  return { env: { DB: db } as unknown as Env, db };
}

// ──────────────────────────────────────────────────────────────────────────
// handleGetAuditLog
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — GET /api/admin/audit-log', () => {
  it('legacy/mono-tenant → skip garde, retourne data', async () => {
    const { env, db } = makeEnv();
    db.seed('from audit_log', [
      { id: 1, user_id: 'u1', action: 'login', resource_type: null, resource_id: null, details: '{}', ip: 'x', user_agent: 'x', request_id: null, tenant_id: null, redacted: 0, created_at: 'now' },
    ]);
    const res = await handleGetAuditLog(getReq('/api/admin/audit-log'), env, AUTH_LEGACY);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('agence sans settings.manage → 403 AGENCY_ONLY', async () => {
    const { env } = makeEnv();
    const res = await handleGetAuditLog(getReq('/api/admin/audit-log'), env, AUTH_AGENCY_KO);
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('AGENCY_ONLY');
  });

  it('filter action → SQL LIKE émis', async () => {
    const { env, db } = makeEnv();
    db.seed('from audit_log', []);
    const res = await handleGetAuditLog(
      getReq('/api/admin/audit-log?action=login'),
      env,
      AUTH_AGENCY_OK_SETTINGS,
    );
    expect(res.status).toBe(200);
    const selectCalls = db.calls.filter(c => /FROM audit_log/i.test(c.sql) && /action LIKE/i.test(c.sql));
    expect(selectCalls.length).toBeGreaterThan(0);
    // Le filtre LIKE doit wrapper l'argument avec %.
    const args = selectCalls[0].args;
    expect(args.some(a => typeof a === 'string' && a.includes('login'))).toBe(true);
  });

  it('filtres invalides (limit=999) → 400 INVALID_INPUT', async () => {
    const { env } = makeEnv();
    const res = await handleGetAuditLog(
      getReq('/api/admin/audit-log?limit=999'),
      env,
      AUTH_AGENCY_OK_SETTINGS,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('tenant filter : SQL inclut (tenant_id = ? OR tenant_id IS NULL)', async () => {
    const { env, db } = makeEnv();
    db.seed('from audit_log', []);
    await handleGetAuditLog(getReq('/api/admin/audit-log'), env, AUTH_AGENCY_OK_SETTINGS);
    const selectCalls = db.calls.filter(c => /FROM audit_log/i.test(c.sql));
    expect(selectCalls.some(c => /tenant_id IS NULL/i.test(c.sql))).toBe(true);
    // Le bind tenant_id = 'agency-1' doit apparaître.
    const hasAgencyBind = selectCalls.some(c => c.args.includes('agency-1'));
    expect(hasAgencyBind).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// handleGetCapabilityOverrides
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — GET /api/admin/capability-overrides/:userId', () => {
  it('liste les overrides pour un user cible', async () => {
    const { env, db } = makeEnv();
    db.seed('from user_capability_overrides', [
      { id: 'o1', user_id: 'u-42', capability: 'export', granted: 1, created_at: 'now' },
      { id: 'o2', user_id: 'u-42', capability: 'leads.delete', granted: 0, created_at: 'now' },
    ]);
    const res = await handleGetCapabilityOverrides(
      getReq('/api/admin/capability-overrides/u-42'),
      env,
      AUTH_AGENCY_OK_TEAM,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { user_id: string; capability: string; granted: 0 | 1 }[] };
    expect(body.data.length).toBe(2);
    expect(body.data[0].user_id).toBe('u-42');
  });

  it('userId manquant → 400 INVALID_INPUT', async () => {
    const { env } = makeEnv();
    const res = await handleGetCapabilityOverrides(
      getReq('/api/admin/capability-overrides/'),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// handleSetCapabilityOverride
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — POST /api/admin/capability-overrides/:userId', () => {
  it('body invalide (capability hors enum) → 400 OVERRIDE_INVALID', async () => {
    const { env } = makeEnv();
    const res = await handleSetCapabilityOverride(
      postReq('/api/admin/capability-overrides/u-42', { capability: 'unknown.cap', granted: true }),
      env,
      AUTH_AGENCY_OK_TEAM,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('OVERRIDE_INVALID');
  });

  it('UPSERT + audit émis + retour CapabilityOverride', async () => {
    const { env, db } = makeEnv();
    db.seed('from user_capability_overrides', [
      { id: 'new-id', user_id: 'u-42', capability: 'export', granted: 1, created_at: 'now' },
    ]);
    const res = await handleSetCapabilityOverride(
      postReq('/api/admin/capability-overrides/u-42', { capability: 'export', granted: true }),
      env,
      AUTH_AGENCY_OK_TEAM,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { capability: string; granted: 0 | 1 } };
    expect(body.data.capability).toBe('export');
    expect(body.data.granted).toBe(1);

    // UPSERT émis avec ON CONFLICT.
    const upsert = db.calls.find(c => /INSERT INTO user_capability_overrides/i.test(c.sql) && /ON CONFLICT/i.test(c.sql));
    expect(upsert).toBeDefined();
    expect(upsert!.args).toContain('u-42');
    expect(upsert!.args).toContain('export');
    expect(upsert!.args).toContain(1);

    // audit('rbac.override.set') émis.
    const auditCall = db.calls.find(c => /INSERT INTO audit_log/i.test(c.sql));
    expect(auditCall).toBeDefined();
    expect(auditCall!.args).toContain('rbac.override.set');
  });

  it('agence sans team.manage → 403 AGENCY_ONLY (mais body invalide → 400 first)', async () => {
    const { env } = makeEnv();
    // Body valide pour passer la validation zod, mais capability KO.
    const res = await handleSetCapabilityOverride(
      postReq('/api/admin/capability-overrides/u-42', { capability: 'export', granted: true }),
      env,
      AUTH_AGENCY_KO,
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('AGENCY_ONLY');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// handleDeleteCapabilityOverride
// ──────────────────────────────────────────────────────────────────────────

describe('S23 — DELETE /api/admin/capability-overrides/:userId/:capability', () => {
  it('DELETE émis sur (user_id, capability) + audit', async () => {
    const { env, db } = makeEnv();
    const res = await handleDeleteCapabilityOverride(
      deleteReq('/api/admin/capability-overrides/u-42/export'),
      env,
      AUTH_AGENCY_OK_TEAM,
    );
    expect(res.status).toBe(200);
    const del = db.calls.find(c => /^DELETE FROM user_capability_overrides/i.test(c.sql.trim()));
    expect(del).toBeDefined();
    expect(del!.args).toContain('u-42');
    expect(del!.args).toContain('export');

    const auditCall = db.calls.find(c => /INSERT INTO audit_log/i.test(c.sql));
    expect(auditCall).toBeDefined();
    expect(auditCall!.args).toContain('rbac.override.delete');
  });

  it('path malformé (capability absente) → 400 INVALID_INPUT', async () => {
    const { env } = makeEnv();
    const res = await handleDeleteCapabilityOverride(
      deleteReq('/api/admin/capability-overrides/u-42'),
      env,
      AUTH_AGENCY_OK_TEAM,
    );
    expect(res.status).toBe(400);
  });

  it('agence sans team.manage → 403 AGENCY_ONLY', async () => {
    const { env } = makeEnv();
    const res = await handleDeleteCapabilityOverride(
      deleteReq('/api/admin/capability-overrides/u-42/export'),
      env,
      AUTH_AGENCY_KO,
    );
    expect(res.status).toBe(403);
  });
});

// ── Phase 1 V2 — câblage engine (wire-up) ────────────────────────────────
// Prouve que security-admin.ts délègue désormais le parsing path + le format
// de ligne au security-admin-engine (helpers purs déjà testés) au lieu de
// dupliquer la logique inline. Ancrage statique : si quelqu'un retire le
// câblage, ce test casse.
describe('security-admin.ts — câblage engine (wire-up)', () => {
  const src = readFileSync(
    resolve(__dirname, '..', 'security-admin.ts'), 'utf8',
  );

  it('importe extractUserIdFromPath + formatAuditLogEntry depuis le moteur', () => {
    expect(src).toContain("from './lib/security-admin-engine'");
    expect(src).toContain('extractUserIdFromPath');
    expect(src).toContain('formatAuditLogEntry');
  });

  it("ne redéfinit plus parseDetails / extractUserIdFromPath en local", () => {
    expect(src).not.toContain('function parseDetails(');
    expect(src).not.toContain('function extractUserIdFromPath(');
  });
});
