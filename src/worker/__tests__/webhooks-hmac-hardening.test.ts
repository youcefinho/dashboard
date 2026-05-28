// ── Tests S7 M-C — Durcissement HMAC webhooks + audit forensic ──────────────
// Couvre le durcissement ADDITIF de verifyMetaSignature (meta-leadgen.ts) et
// l'ancrage contractuel des routes rotate/revoke (worker.ts). Anti-fuite
// Loi 25 : on prouve qu'aucun body/secret ne fuit dans audit().
//
// Mock D1 figé (_helpers.ts) : audit() écrit via DB.prepare(INSERT INTO
// audit_log ...).run() → on inspecte db.calls pour le forensic + non-fuite.
// NON exécuté sur la VM (aucune commande) — run réel délégué à Rochdi.
//
// Non-régression E4 : ce fichier n'importe JAMAIS de provider de paiement.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMockD1, type MockD1 } from './_helpers';
import { verifyMetaSignature } from '../meta-leadgen';

const SECRET = 'meta-app-secret-unit-0123456789';

function mkEnv(db: MockD1, withSecret: boolean) {
  return {
    DB: db as unknown,
    ...(withSecret ? { META_APP_SECRET: SECRET } : {}),
  } as any;
}

// Calcule une signature Meta valide (sha256=<hex>) pour un corps donné.
async function signMeta(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const hex = [...new Uint8Array(sig)]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}

function auditCalls(db: MockD1) {
  return db.calls.filter(c =>
    c.sql.toLowerCase().includes('insert into audit_log'));
}

describe('verifyMetaSignature — comportement legacy PRÉSERVÉ (régression-0)', () => {
  it('secret absent → null, AUCUN audit de rejet émis', async () => {
    const db = createMockD1();
    const env = mkEnv(db, false);
    const r = await verifyMetaSignature(env, '{"x":1}', 'sha256=deadbeef');
    expect(r).toBeNull(); // caller log un warn et continue (legacy intact)
    expect(auditCalls(db).length).toBe(0); // absence config ≠ rejet signature
  });

  it('signature valide → true, aucun audit de rejet', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    const body = '{"object":"page","entry":[]}';
    const sig = await signMeta(SECRET, body);
    const r = await verifyMetaSignature(env, body, sig);
    expect(r).toBe(true);
    expect(auditCalls(db).length).toBe(0);
  });
});

describe('verifyMetaSignature — gardes additives + rejet propre sans crash', () => {
  it('rawBody vide → false sans crash, audit forensic reason=empty_body', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    const r = await verifyMetaSignature(env, '', 'sha256=' + 'a'.repeat(64));
    expect(r).toBe(false);
    const a = auditCalls(db);
    expect(a.length).toBe(1);
    // args = (userId, action, resourceType, resourceId, detailsJSON, ip, ua)
    expect(a[0]!.args[1]).toBe('webhook.signature_reject');
    expect(a[0]!.args[2]).toBe('meta_webhook');
    expect(JSON.parse(a[0]!.args[4] as string)).toEqual({ reason: 'empty_body' });
  });

  it('rawBody non-string → false sans crash (garde défensive)', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    // @ts-expect-error test runtime : rawBody invalide
    const r = await verifyMetaSignature(env, undefined, 'sha256=' + 'a'.repeat(64));
    expect(r).toBe(false);
    expect(JSON.parse(auditCalls(db)[0]!.args[4] as string))
      .toEqual({ reason: 'empty_body' });
  });

  it('header manquant/malformé → false + reason=missing_or_malformed_header', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    expect(await verifyMetaSignature(env, '{"a":1}', null)).toBe(false);
    expect(await verifyMetaSignature(env, '{"a":1}', 'md5=xx')).toBe(false);
    for (const c of auditCalls(db)) {
      expect(JSON.parse(c.args[4] as string).reason)
        .toBe('missing_or_malformed_header');
    }
  });

  it('hex de mauvaise longueur/format → false + reason=bad_signature_format', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    expect(await verifyMetaSignature(env, '{"a":1}', 'sha256=abc')).toBe(false); // impair
    expect(await verifyMetaSignature(env, '{"a":1}', 'sha256=zz'.repeat(32))).toBe(false); // non-hex
    expect(await verifyMetaSignature(env, '{"a":1}', 'sha256=ab')).toBe(false); // trop court
    for (const c of auditCalls(db)) {
      expect(JSON.parse(c.args[4] as string).reason).toBe('bad_signature_format');
    }
  });

  it('signature bien formée mais fausse → false + reason=bad_signature', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    const r = await verifyMetaSignature(env, '{"real":true}', 'sha256=' + 'b'.repeat(64));
    expect(r).toBe(false);
    expect(JSON.parse(auditCalls(db)[0]!.args[4] as string))
      .toEqual({ reason: 'bad_signature' });
  });
});

describe('anti-fuite Loi 25 — audit forensic ne contient JAMAIS body/secret', () => {
  it('details ne porte que { reason } non sensible, jamais le corps ni le secret', async () => {
    const db = createMockD1();
    const env = mkEnv(db, true);
    const sensitiveBody = '{"email":"victim@example.com","token":"shpat_LEAK"}';
    await verifyMetaSignature(env, sensitiveBody, 'sha256=' + 'c'.repeat(64));
    for (const c of auditCalls(db)) {
      const blob = c.sql + JSON.stringify(c.args);
      expect(blob).not.toContain('shpat_LEAK');
      expect(blob).not.toContain('victim@example.com');
      expect(blob).not.toContain(SECRET);
      const details = JSON.parse(c.args[4] as string);
      expect(Object.keys(details)).toEqual(['reason']);
    }
  });
});

// ── Ancrage contractuel routes rotate/revoke (worker.ts) ────────────────────
// worker.ts n'est pas invoqué ici (handler lourd) ; on vérifie statiquement
// l'ancrage chirurgical : routes spécifiques AVANT le générique /channels/:id,
// même pattern auth/tenant que les routes voisines, format json rétro-compat.
describe('worker.ts — routes rotate/revoke ancrées AVANT le générique', () => {
  const src = readFileSync(
    resolve(__dirname, '..', '..', 'worker.ts'), 'utf8',
  );

  // Routes ancrées dans worker.ts (chRotateMatch/chRevokeMatch, ~L4770).
  // Le source contient la regex littérale avec slashes échappés (\/), donc on
  // matche la forme échappée telle qu'écrite dans worker.ts.
  it('déclare les 2 routes POST rotate + revoke', () => {
    expect(src).toContain("\\/api\\/ecommerce\\/channels\\/([^/]+)\\/rotate$");
    expect(src).toContain("\\/api\\/ecommerce\\/channels\\/([^/]+)\\/revoke$");
  });

  it('rotate/revoke sont placées AVANT le générique chMatch (sinon capturées)', () => {
    const idxRotate = src.indexOf('chRotateMatch');
    const idxRevoke = src.indexOf('chRevokeMatch');
    const idxGeneric = src.indexOf(
      'const chMatch = path.match(/^\\/api\\/ecommerce\\/channels\\/([^/]+)$/)');
    expect(idxRotate).toBeGreaterThan(0);
    expect(idxRevoke).toBeGreaterThan(0);
    expect(idxGeneric).toBeGreaterThan(0);
    expect(idxRotate).toBeLessThan(idxGeneric);
    expect(idxRevoke).toBeLessThan(idxGeneric);
  });

  it('réutilise le pattern auth+tenant des routes voisines (admin + loadChannel + 404)', () => {
    const block = src.slice(src.indexOf('chRotateMatch'), src.indexOf('const chMatch ='));
    // Admin only, comme connect/callback/sync
    expect(block).toContain("auth.role !== 'admin'");
    expect(block).toContain("getClientModules");
    expect(block).toContain("sync.loadChannel(env, clientId,");
    // 404 multi-tenant strict si canal absent / mauvais tenant
    expect(block).toContain("Canal introuvable' }, 404");
    // Import contractuel du module Manager B (non réécrit)
    expect(block).toContain("./worker/ecommerce-channel-rotation");
    expect(block).toContain('rotateChannelSecret');
    expect(block).toContain('revokeChannelSecret');
    // Validation kind présente (shopify_token | woo_creds)
    expect(block).toContain("kind !== 'shopify_token'");
    expect(block).toContain("kind !== 'woo_creds'");
    // Format json rétro-compat { ok: true } / { error }
    expect(block).toContain('json({ ok: true })');
    expect(block).toContain('json({ error:');
  });
});

describe('non-régression E4 — aucune dépendance Stripe introduite', () => {
  // La chaîne interdite est construite dynamiquement pour que ce fichier
  // ne la contienne PAS littéralement (sinon le self-check échoue toujours).
  const forbidden = ['stripe', 'provider'].join('-');

  it('ce test + meta-leadgen ne référencent jamais le provider de paiement Stripe (zone régulée)', () => {
    const self = readFileSync(
      resolve(__dirname, 'webhooks-hmac-hardening.test.ts'), 'utf8');
    const metaLeadgen = readFileSync(
      resolve(__dirname, '..', 'meta-leadgen.ts'), 'utf8');
    expect(self).not.toContain(forbidden);
    expect(metaLeadgen).not.toContain(forbidden);
  });
});
