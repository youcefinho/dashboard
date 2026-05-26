// ── dns-engine.test.ts — Tests RENFORCEMENT Sprint 50 dns-engine ──────────
//
// Couvre les 5 helpers PURS ajoutés (validateHostname, generateVerifyToken,
// buildVerifyTxtName, parseDnsResponse) + les améliorations du mock
// provisionCloudflareForSaas / syncDnsRecords / verifyDomainOwnership.
//
// Aucun mock vi.mock — on importe le module RÉEL (les helpers sont purs ou
// best-effort sans réseau). Cible : zéro flaky.

import { describe, it, expect } from 'vitest';
import {
  validateHostname,
  generateVerifyToken,
  buildVerifyTxtName,
  parseDnsResponse,
  normalizeDomain,
  provisionCloudflareForSaas,
  syncDnsRecords,
  verifyDomainOwnership,
  DNS_ERROR_CODES,
} from '../lib/dns-engine';
import type { Env } from '../types';

// ════════════════════════════════════════════════════════════════════════════
// validateHostname — RFC 1035 strict
// ════════════════════════════════════════════════════════════════════════════

describe('validateHostname — cas valides', () => {
  it('hostname standard `example.com` → ok + normalized', () => {
    const r = validateHostname('example.com');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('example.com');
    expect(r.error).toBeUndefined();
  });

  it('subdomain `app.example.com` → ok', () => {
    const r = validateHostname('app.example.com');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('app.example.com');
  });

  it('hostname avec hyphen interne `my-site.example.com` → ok', () => {
    const r = validateHostname('my-site.example.com');
    expect(r.ok).toBe(true);
  });

  it('hostname mixed-case `EXAMPLE.com` → ok + lowercased', () => {
    const r = validateHostname('EXAMPLE.com');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('example.com');
  });

  it('hostname avec trailing dot `example.com.` → ok + dot stripped', () => {
    const r = validateHostname('example.com.');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('example.com');
  });

  it('hostname punycode `xn--bcher-kva.de` (bücher.de) → ok', () => {
    const r = validateHostname('xn--bcher-kva.de');
    expect(r.ok).toBe(true);
  });

  it('hostname avec whitespace ` example.com ` → ok après trim', () => {
    const r = validateHostname('  example.com  ');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('example.com');
  });
});

describe('validateHostname — cas invalides (anti-IDOR)', () => {
  it('chaîne vide → ok:false, code:EMPTY_HOSTNAME', () => {
    const r = validateHostname('');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EMPTY_HOSTNAME');
  });

  it('null/undefined → ok:false, code:EMPTY_HOSTNAME', () => {
    expect(validateHostname(null as unknown as string).ok).toBe(false);
    expect(validateHostname(undefined as unknown as string).ok).toBe(false);
  });

  it('IPv4 `10.0.0.1` → ok:false, code:HOSTNAME_IS_IP', () => {
    const r = validateHostname('10.0.0.1');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('HOSTNAME_IS_IP');
  });

  it('IPv4 `192.168.1.1` → ok:false, code:HOSTNAME_IS_IP', () => {
    const r = validateHostname('192.168.1.1');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('HOSTNAME_IS_IP');
  });

  it('underscore `my_site.com` → ok:false, code:HOSTNAME_HAS_UNDERSCORE', () => {
    const r = validateHostname('my_site.com');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('HOSTNAME_HAS_UNDERSCORE');
  });

  it('leading hyphen `-evil.com` → ok:false, code:HOSTNAME_HAS_LEADING_HYPHEN', () => {
    const r = validateHostname('-evil.com');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('HOSTNAME_HAS_LEADING_HYPHEN');
  });

  it('trailing hyphen sur label `evil-.com` → ok:false, code:HOSTNAME_HAS_TRAILING_HYPHEN', () => {
    const r = validateHostname('evil-.com');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('HOSTNAME_HAS_TRAILING_HYPHEN');
  });

  it('label >63 chars → ok:false, code:HOSTNAME_LABEL_TOO_LONG', () => {
    const longLabel = 'a'.repeat(64);
    const r = validateHostname(`${longLabel}.com`);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('HOSTNAME_LABEL_TOO_LONG');
  });

  it('total >253 chars → ok:false, code:HOSTNAME_TOO_LONG', () => {
    // 5 labels de 60 chars + dots = 5*60 + 4 = 304 chars
    const longHost = Array(5).fill('a'.repeat(60)).join('.') + '.com';
    const r = validateHostname(longHost);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('HOSTNAME_TOO_LONG');
  });

  it('dots consécutifs `example..com` → ok:false, code:HOSTNAME_HAS_CONSECUTIVE_DOTS', () => {
    const r = validateHostname('example..com');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('HOSTNAME_HAS_CONSECUTIVE_DOTS');
  });

  it('pas de TLD `localhost` → ok:false', () => {
    const r = validateHostname('localhost');
    expect(r.ok).toBe(false);
  });

  it('hostname trop court `a.b` → marginal mais accepté (≥3 chars)', () => {
    // `a.b` = 3 chars exactement, 2 labels → accepté par RFC mais TLD bidon.
    // On accepte côté validateHostname (responsabilité du registrar de
    // rejeter les TLDs inconnus). Test documente le comportement actuel.
    const r = validateHostname('a.b');
    expect(r.ok).toBe(true);
  });

  it('caractère exotique `exämple.com` → ok:false (regex strict ASCII)', () => {
    const r = validateHostname('exämple.com');
    expect(r.ok).toBe(false);
  });

  it('caractère spécial `evil$.com` → ok:false', () => {
    const r = validateHostname('evil$.com');
    expect(r.ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// generateVerifyToken — format + unicité
// ════════════════════════════════════════════════════════════════════════════

describe('generateVerifyToken', () => {
  it('retourne hex 32 chars (UUID v4 sans tirets)', () => {
    const token = generateVerifyToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBe(32);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('unicité sur 1000 itérations (collision check)', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tokens.add(generateVerifyToken());
    }
    expect(tokens.size).toBe(1000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// buildVerifyTxtName
// ════════════════════════════════════════════════════════════════════════════

describe('buildVerifyTxtName', () => {
  it('hostname valide → `_intralys-verify.<hostname>`', () => {
    expect(buildVerifyTxtName('example.com')).toBe(
      '_intralys-verify.example.com',
    );
  });

  it('hostname mixed-case → lowercased', () => {
    expect(buildVerifyTxtName('EXAMPLE.com')).toBe(
      '_intralys-verify.example.com',
    );
  });

  it('hostname invalide → string vide (best-effort)', () => {
    expect(buildVerifyTxtName('not_valid')).toBe('');
    expect(buildVerifyTxtName('')).toBe('');
    expect(buildVerifyTxtName('10.0.0.1')).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// parseDnsResponse
// ════════════════════════════════════════════════════════════════════════════

describe('parseDnsResponse — dns.google.com shape', () => {
  it('Answer match token → verified:true', () => {
    const raw = { Answer: [{ data: '"my-token-123"' }] };
    const r = parseDnsResponse(raw, 'my-token-123');
    expect(r.verified).toBe(true);
  });

  it('Answer sans quotes → verified:true (some resolvers don\'t quote)', () => {
    const raw = { Answer: [{ data: 'my-token-123' }] };
    const r = parseDnsResponse(raw, 'my-token-123');
    expect(r.verified).toBe(true);
  });

  it('Answer mismatch token → verified:false, code:DNS_NOT_VERIFIED', () => {
    const raw = { Answer: [{ data: '"wrong-token"' }] };
    const r = parseDnsResponse(raw, 'expected-token');
    expect(r.verified).toBe(false);
    expect(r.code).toBe('DNS_NOT_VERIFIED');
  });

  it('Answer vide → verified:false, code:DNS_NOT_VERIFIED', () => {
    const raw = { Answer: [] };
    const r = parseDnsResponse(raw, 'expected-token');
    expect(r.verified).toBe(false);
    expect(r.code).toBe('DNS_NOT_VERIFIED');
  });
});

describe('parseDnsResponse — Cloudflare API shape', () => {
  it('success:true → verified:true', () => {
    const r = parseDnsResponse({ success: true, result: {} });
    expect(r.verified).toBe(true);
  });

  it('success:false + errors → verified:false, code:CF_API_ERROR', () => {
    const raw = {
      success: false,
      errors: [{ code: 1004, message: 'DNS validation failed' }],
    };
    const r = parseDnsResponse(raw);
    expect(r.verified).toBe(false);
    expect(r.code).toBe('CF_API_ERROR');
    expect(r.reason).toBe('DNS validation failed');
  });

  it('success:false sans errors → verified:false, reason:cf-error', () => {
    const r = parseDnsResponse({ success: false });
    expect(r.verified).toBe(false);
    expect(r.code).toBe('CF_API_ERROR');
  });
});

describe('parseDnsResponse — malformed', () => {
  it('null → verified:false, code:MALFORMED_RESPONSE', () => {
    const r = parseDnsResponse(null);
    expect(r.verified).toBe(false);
    expect(r.code).toBe('MALFORMED_RESPONSE');
  });

  it('undefined → verified:false, code:MALFORMED_RESPONSE', () => {
    const r = parseDnsResponse(undefined);
    expect(r.verified).toBe(false);
    expect(r.code).toBe('MALFORMED_RESPONSE');
  });

  it('string brute → verified:false, code:MALFORMED_RESPONSE', () => {
    const r = parseDnsResponse('not-an-object');
    expect(r.verified).toBe(false);
    expect(r.code).toBe('MALFORMED_RESPONSE');
  });

  it('shape inconnu `{}` → verified:false, code:MALFORMED_RESPONSE', () => {
    const r = parseDnsResponse({});
    expect(r.verified).toBe(false);
    expect(r.code).toBe('MALFORMED_RESPONSE');
  });

  it('shape custom `{verified: true}` → verified:true (passthrough)', () => {
    const r = parseDnsResponse({ verified: true });
    expect(r.verified).toBe(true);
  });

  it('shape custom `{verified: false, reason: "x"}` → reason préservée', () => {
    const r = parseDnsResponse({ verified: false, reason: 'custom-reason' });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe('custom-reason');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// provisionCloudflareForSaas — mock réaliste flag INACTIF
// ════════════════════════════════════════════════════════════════════════════

describe('provisionCloudflareForSaas — mock fallback (CLOUDFLARE_API_TOKEN absent)', () => {
  it('hostname valide + token absent → mock réaliste avec dns_records', async () => {
    const env = {} as Env; // pas de CLOUDFLARE_API_TOKEN
    const r = await provisionCloudflareForSaas(env, 'example.com');

    // Shape de base — préservé byte-identique pour compat tests existants.
    expect(r.zone_id).toBeNull();
    expect(r.ssl_status).toBe('pending');

    // Shape enrichi mock (additif, non-breaking pour anciens consumers).
    expect(r.mock).toBe(true);
    expect(r.reason).toBe('cloudflare_token_missing');
    expect(r.code).toBe('CF_TOKEN_MISSING');
    expect(r.status).toBe('pending');

    // Instructions DNS — 2 records (TXT verify + CNAME app).
    expect(Array.isArray(r.dns_records)).toBe(true);
    expect(r.dns_records).toHaveLength(2);

    const [txt, cname] = r.dns_records!;
    expect(txt.type).toBe('TXT');
    expect(txt.name).toBe('_intralys-verify.example.com');
    expect(typeof txt.value).toBe('string');
    expect(txt.value).toMatch(/^[0-9a-f]{32}$/); // verify token
    expect(txt.ttl).toBe(3600);

    expect(cname.type).toBe('CNAME');
    expect(cname.name).toBe('example.com');
    expect(cname.value).toBe('intralys-sites.workers.dev');
    expect(cname.ttl).toBe(3600);
  });

  it('hostname mixed-case → normalized dans instructions', async () => {
    const env = {} as Env;
    const r = await provisionCloudflareForSaas(env, 'EXAMPLE.COM');
    expect(r.dns_records?.[0].name).toBe('_intralys-verify.example.com');
    expect(r.dns_records?.[1].name).toBe('example.com');
  });

  it('hostname invalide → mock dégradé, JAMAIS throw', async () => {
    const env = {} as Env;
    const r = await provisionCloudflareForSaas(env, '10.0.0.1');
    expect(r.zone_id).toBeNull();
    expect(r.ssl_status).toBe('pending');
    expect(r.mock).toBe(true);
    expect(r.code).toBe('HOSTNAME_IS_IP');
    expect(r.dns_records).toEqual([]);
  });

  it('hostname vide → mock dégradé sans throw', async () => {
    const env = {} as Env;
    const r = await provisionCloudflareForSaas(env, '');
    expect(r.zone_id).toBeNull();
    expect(r.code).toBe('EMPTY_HOSTNAME');
  });

  it('compat retour byte-identique : zone_id null + ssl_status pending', async () => {
    // Critique : custom-domains.ts consomme provision.zone_id et
    // provision.ssl_status DIRECT (sans optional chaining). Garantir que
    // ces 2 champs restent toujours présents.
    const env = {} as Env;
    const r = await provisionCloudflareForSaas(env, 'example.com');
    expect('zone_id' in r).toBe(true);
    expect('ssl_status' in r).toBe(true);
    expect(r.zone_id).toBeNull();
    expect(['pending', 'provisioned', 'failed']).toContain(r.ssl_status);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// syncDnsRecords — mock fallback
// ════════════════════════════════════════════════════════════════════════════

describe('syncDnsRecords — mock fallback (CLOUDFLARE_API_TOKEN absent)', () => {
  it('token absent → synced:0 + reason + mock:true', async () => {
    const env = {} as Env;
    const r = await syncDnsRecords(env, 'domain_1');
    expect(r.synced).toBe(0);
    expect(r.reason).toBeDefined();
    // mock:true OU phase-a-stub (compat byte-identique).
    expect(r.reason === 'phase-a-stub' || r.mock === true).toBe(true);
  });

  it('domainId vide → synced:0, JAMAIS throw', async () => {
    const env = {} as Env;
    const r = await syncDnsRecords(env, '');
    expect(r.synced).toBe(0);
    expect(r.code).toBe('PHASE_A_STUB');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// verifyDomainOwnership — validation input
// ════════════════════════════════════════════════════════════════════════════

describe('verifyDomainOwnership — validation input', () => {
  it('hostname valide + token → stub phase A préservé (verified:false)', async () => {
    const env = {} as Env;
    const r = await verifyDomainOwnership(env, 'example.com', 'token123');
    expect(r.verified).toBe(false);
    expect(r.reason).toBe('phase-a-stub');
  });

  it('hostname invalide (IP) → verified:false + code stable', async () => {
    const env = {} as Env;
    const r = await verifyDomainOwnership(env, '10.0.0.1', 'token123');
    expect(r.verified).toBe(false);
    expect(r.code).toBe('HOSTNAME_IS_IP');
  });

  it('hostname underscore → verified:false + code HOSTNAME_HAS_UNDERSCORE', async () => {
    const env = {} as Env;
    const r = await verifyDomainOwnership(env, 'my_site.com', 'token123');
    expect(r.verified).toBe(false);
    expect(r.code).toBe('HOSTNAME_HAS_UNDERSCORE');
  });

  it('hostname vide → verified:false + code EMPTY_HOSTNAME', async () => {
    const env = {} as Env;
    const r = await verifyDomainOwnership(env, '', 'token123');
    expect(r.verified).toBe(false);
    expect(r.code).toBe('EMPTY_HOSTNAME');
  });

  it('token vide → verified:false + code EMPTY_TOKEN', async () => {
    const env = {} as Env;
    const r = await verifyDomainOwnership(env, 'example.com', '');
    expect(r.verified).toBe(false);
    expect(r.code).toBe('EMPTY_TOKEN');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// normalizeDomain — préservation byte-identique
// ════════════════════════════════════════════════════════════════════════════

describe('normalizeDomain — compat byte-identique Phase A', () => {
  it('mixed-case + trailing dot + whitespace → normalized', () => {
    expect(normalizeDomain(' Example.COM. ')).toBe('example.com');
  });
  it('chaîne vide → ""', () => {
    expect(normalizeDomain('')).toBe('');
  });
  it('null/undefined → "" (best-effort)', () => {
    expect(normalizeDomain(null as unknown as string)).toBe('');
    expect(normalizeDomain(undefined as unknown as string)).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DNS_ERROR_CODES — exposé pour télémétrie
// ════════════════════════════════════════════════════════════════════════════

describe('DNS_ERROR_CODES — exhaustivité', () => {
  it('inclut tous les codes erreur attendus', () => {
    expect(DNS_ERROR_CODES).toContain('INVALID_HOSTNAME');
    expect(DNS_ERROR_CODES).toContain('CF_TOKEN_MISSING');
    expect(DNS_ERROR_CODES).toContain('DOMAIN_TAKEN');
    expect(DNS_ERROR_CODES).toContain('DNS_NOT_VERIFIED');
    expect(DNS_ERROR_CODES).toContain('MALFORMED_RESPONSE');
    expect(DNS_ERROR_CODES).toContain('PHASE_A_STUB');
  });
});
