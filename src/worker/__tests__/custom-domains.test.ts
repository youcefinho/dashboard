// ── custom-domains.test.ts — Sprint 50 RENFORCEMENT — wire-up dns-engine ───
//
// Tests additifs ciblant le câblage des helpers dns-engine renforcés
// (validateHostname / generateVerifyToken / buildVerifyTxtName / dns_records
// dans la réponse) dans `handleAddCustomDomain` + `handleVerifyDomain`.
//
// 5 cas obligatoires (cf. brief Sprint 50 renforcement) :
//
//   1. createDomain `256-chars-long` → 400 + errorCode:HOSTNAME_TOO_LONG
//   2. createDomain `192.168.1.1`    → 400 + errorCode:HOSTNAME_IS_IP
//   3. createDomain `_invalid`       → 400 + errorCode (underscore leading)
//   4. createDomain `domain.com`     → 201 + dns_records exposé
//   5. verifyDomain validation OK    → 200 + status='verified' + UPDATE DB
//
// Mock dns-engine partiel pour overrider verifyDomainOwnership (test 5) +
// provisionCloudflareForSaas (préserve byte-identique shape stub).
// Aucun réseau.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';

// ── Mocks (AVANT import du SUT — vi.mock est hoisté) ─────────────────────────

vi.mock('../lib/dns-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dns-engine')>();
  return {
    ...actual,
    // verifyDomainOwnership : par défaut verified=false (test 5 override).
    verifyDomainOwnership: vi.fn(async () => ({
      verified: false,
      reason: 'phase-a-stub',
    })),
    // provisionCloudflareForSaas : shape byte-identique stub (préserve
    // compatibilité avec les tests Sprint 50 originaux).
    provisionCloudflareForSaas: vi.fn(async () => ({
      zone_id: null,
      ssl_status: 'pending' as const,
    })),
    syncDnsRecords: vi.fn(async () => ({
      synced: 0,
      reason: 'phase-a-stub',
    })),
  };
});

// Imports APRÈS les mocks (vi.mock hoisté).
import {
  handleAddCustomDomain,
  handleVerifyDomain,
} from '../custom-domains';
import { verifyDomainOwnership } from '../lib/dns-engine';

// ── helpers locaux ──────────────────────────────────────────────────────────

function makeAuth(
  overrides: Partial<{
    userId: string;
    clientId: string;
    capabilities: Set<string>;
    tenant: unknown;
  }> = {},
) {
  return {
    userId: 'u_1',
    role: 'admin',
    clientId: 'cli_A',
    capabilities: new Set(['settings.manage']),
    ...overrides,
  } as unknown as Parameters<typeof handleAddCustomDomain>[2];
}

function makeEnv(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
// Wire-up validateHostname dans handleAddCustomDomain
// ════════════════════════════════════════════════════════════════════════════

describe('handleAddCustomDomain — wire-up validateHostname (Sprint 50 renforcé)', () => {
  it('256-chars-long hostname → 400 + errorCode:HOSTNAME_TOO_LONG', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth();

    // Hostname > 253 chars : 5 labels de 60 + ".com" = 304 chars.
    const longHost = Array(5).fill('a'.repeat(60)).join('.') + '.com';
    expect(longHost.length).toBeGreaterThan(253);

    const req = new Request('https://app/api/custom-domains', {
      method: 'POST',
      body: JSON.stringify({ domain: longHost }),
    });

    const res = await handleAddCustomDomain(req, env, auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      errorCode: string;
    };
    expect(body.errorCode).toBe('HOSTNAME_TOO_LONG');
    expect(body.error).toMatch(/invalide|trop long/i);

    // Aucun INSERT en DB (validation court-circuite).
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into custom_domains'),
    );
    expect(insert).toBeUndefined();
  });

  it('192.168.1.1 (IPv4) → 400 + errorCode:HOSTNAME_IS_IP', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth();

    const req = new Request('https://app/api/custom-domains', {
      method: 'POST',
      body: JSON.stringify({ domain: '192.168.1.1' }),
    });

    const res = await handleAddCustomDomain(req, env, auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      errorCode: string;
    };
    expect(body.errorCode).toBe('HOSTNAME_IS_IP');
    expect(body.error).toMatch(/invalide|ip/i);

    // Aucun INSERT.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into custom_domains'),
    );
    expect(insert).toBeUndefined();
  });

  it('_invalid (leading underscore) → 400 + errorCode HOSTNAME_HAS_UNDERSCORE', async () => {
    // NB : `_invalid` contient un underscore ET commence par underscore — le
    // check underscore (RFC 1035) trigger AVANT le check leading hyphen, donc
    // le code stable attendu est HOSTNAME_HAS_UNDERSCORE.
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth();

    const req = new Request('https://app/api/custom-domains', {
      method: 'POST',
      body: JSON.stringify({ domain: '_invalid.com' }),
    });

    const res = await handleAddCustomDomain(req, env, auth);
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      errorCode: string;
    };
    expect(body.errorCode).toBe('HOSTNAME_HAS_UNDERSCORE');
    expect(body.error).toMatch(/invalide|underscore/i);

    // Aucun INSERT.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into custom_domains'),
    );
    expect(insert).toBeUndefined();
  });

  it('domain.com valide → 201 + dns_records exposé (TXT verify + CNAME app)', async () => {
    const db = createMockD1();
    const env = makeEnv(db);
    const auth = makeAuth();

    const req = new Request('https://app/api/custom-domains', {
      method: 'POST',
      body: JSON.stringify({ domain: 'domain.com' }),
    });

    const res = await handleAddCustomDomain(req, env, auth);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        id: string;
        domain: string;
        status: string;
        verification_token: string;
        cloudflare_zone_id: string | null;
        ssl_status: string;
        dns_records: Array<{
          type: string;
          name: string;
          value: string;
          ttl?: number;
        }>;
      };
    };
    expect(body.data).toBeDefined();
    expect(body.data.domain).toBe('domain.com');
    expect(body.data.status).toBe('pending');
    expect(body.data.verification_token).toMatch(/^[0-9a-f]{32}$/);

    // dns_records exposé — 2 records (TXT verify + CNAME app).
    expect(Array.isArray(body.data.dns_records)).toBe(true);
    expect(body.data.dns_records).toHaveLength(2);

    const txt = body.data.dns_records.find((r) => r.type === 'TXT');
    expect(txt).toBeDefined();
    expect(txt?.name).toBe('_intralys-verify.domain.com');
    // value DOIT être le verification_token réel persisté en DB (PAS un
    // token random du mock provision).
    expect(txt?.value).toBe(body.data.verification_token);
    expect(txt?.ttl).toBe(3600);

    const cname = body.data.dns_records.find((r) => r.type === 'CNAME');
    expect(cname).toBeDefined();
    expect(cname?.name).toBe('domain.com');
    expect(cname?.value).toBe('intralys-sites.workers.dev');
    expect(cname?.ttl).toBe(3600);

    // INSERT custom_domains appelé.
    const insert = db.calls.find((c) =>
      c.sql.toLowerCase().includes('insert into custom_domains'),
    );
    expect(insert).toBeDefined();
    expect(insert?.args[2]).toBe('domain.com');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Wire-up verifyDomain OK
// ════════════════════════════════════════════════════════════════════════════

describe('handleVerifyDomain — verified=true → status verified + UPDATE DB', () => {
  it('verifyDomainOwnership renvoie verified:true → UPDATE status=verified', async () => {
    vi.mocked(verifyDomainOwnership).mockResolvedValueOnce({
      verified: true,
    });

    const db = createMockD1();
    db.seed('select * from custom_domains where id', [
      {
        id: 'dom_ok',
        client_id: 'cli_A',
        domain: 'verified.com',
        verification_token: 'tok_ok_abcdef1234567890abcdef1234567890',
        status: 'pending',
      },
    ]);
    const env = makeEnv(db);
    const auth = makeAuth();
    const req = new Request('https://app/api/custom-domains/dom_ok/verify', {
      method: 'POST',
    });

    const res = await handleVerifyDomain(req, env, auth, 'dom_ok');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; verified: boolean; status: string };
    };
    expect(body.data.verified).toBe(true);
    expect(body.data.status).toBe('verified');

    // verifyDomainOwnership appelé avec le bon domain + token.
    expect(vi.mocked(verifyDomainOwnership)).toHaveBeenCalledWith(
      expect.anything(),
      'verified.com',
      'tok_ok_abcdef1234567890abcdef1234567890',
    );

    // UPDATE status='verified' appelé.
    const updateVerified = db.calls.find(
      (c) =>
        c.sql.toLowerCase().includes('update custom_domains') &&
        c.sql.toLowerCase().includes("status = 'verified'") &&
        c.sql.toLowerCase().includes('verified_at'),
    );
    expect(updateVerified).toBeDefined();
    expect(updateVerified?.args).toEqual(['dom_ok']);
  });
});
