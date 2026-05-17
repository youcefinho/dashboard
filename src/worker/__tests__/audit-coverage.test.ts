// ════════════════════════════════════════════════════════════
// S4 M3 — Tests : couverture audit_log sur mutations sensibles
// ════════════════════════════════════════════════════════════
//
// Couvre, pour team.ts + settings.ts (handlers instrumentés S4 M3) :
//  1. audit() est appelé avec les bons (action, resource_type,
//     resource_id) après le succès de chaque mutation sensible.
//  2. `details` (5e arg sérialisé dans la colonne JSON) ne contient
//     AUCUN champ/valeur sensible : pas de token, secret, whsec_,
//     rawKey, keyHash, password, certificat AMF brut (Loi 25).
//  3. Best-effort : si l'INSERT audit_log throw, la mutation réussit
//     quand même (réponse succès inchangée — audit() est try/catch
//     interne, figé helpers.ts).
//  4. Non-régression : la logique métier / le format de réponse
//     succès ne sont pas altérés (status + corps attendus).
//
// On observe l'appel via le mock D1 figé (`_helpers.ts`) — l'INSERT
// dans `audit_log` apparaît dans `db.calls`. On ne mocke pas `audit`
// (helper figé) : on vérifie son effet réel sur la couche D1.
//
// `environment: 'node'`, déterministe, zéro I/O réseau.

import { describe, it, expect } from 'vitest';
import { createMockD1, type MockD1 } from './_helpers';
import {
  handleInviteUser,
  handleUpdateUserRole,
  handleDeleteUser,
} from '../team';
import {
  handleCreateApiKey,
  handleRevokeApiKey,
  handleCreateWebhook,
  handleDeleteWebhook,
  handlePublicCreateWebhook,
  handlePublicDeleteWebhook,
  handleUpdateClientCompliance,
} from '../settings';

// ── Helpers de test ─────────────────────────────────────────

/** Extrait l'appel INSERT audit_log enregistré par le mock D1 (ou null). */
function findAuditCall(
  db: MockD1,
): { sql: string; args: any[] } | null {
  // audit() : INSERT INTO audit_log (user_id, action, resource_type,
  //           resource_id, details, ip, user_agent) VALUES (...)
  const c = db.calls.find((x) =>
    x.sql.toLowerCase().includes('insert into audit_log'),
  );
  return c ?? null;
}

/** Décompose les args bindés de l'INSERT audit_log. */
function parseAudit(call: { sql: string; args: any[] }) {
  const [userId, action, resourceType, resourceId, detailsJson] = call.args;
  let details: Record<string, unknown> = {};
  try {
    details = JSON.parse(detailsJson as string);
  } catch {
    /* laissé vide si non parseable */
  }
  return { userId, action, resourceType, resourceId, details };
}

/** Le JSON `details` ne doit contenir AUCUN champ/valeur sensible. */
function assertNoSecretInDetails(detailsJson: string) {
  const lower = String(detailsJson).toLowerCase();
  // Clés interdites (exclut 'has_certificate' qui est un booléen métadonnée légitime)
  for (const banned of ['token', 'secret', 'apikey', 'api_key', 'rawkey', 'keyhash', 'password', 'amf_certificate']) {
    expect(lower).not.toContain(banned);
  }
  // 'certificate' seul interdit, SAUF dans 'has_certificate' (booléen de présence, pas la valeur)
  const withoutHasCert = lower.replace(/has_certificate/g, '');
  expect(withoutHasCert).not.toContain('certificate');
  // Préfixes de valeurs secrètes produites par le worker
  expect(lower).not.toContain('whsec_');
  expect(lower).not.toContain('ilys_');
}

function makeRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u-actor-1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ════════════════════════════════════════════════════════════
// team.ts
// ════════════════════════════════════════════════════════════

describe('S4 M3 — audit_log team.ts', () => {
  it("handleInviteUser : audit user.invite/user, details={role,email}, sans secret", async () => {
    const db = createMockD1();
    // existing user lookup → aucun (autorise l'invite)
    db.seed('select id from users where email', []);
    const env = { DB: db } as any;
    const req = makeRequest('https://x/api/team/users', 'POST', {
      email: 'invite@ex.com',
      role: 'agent',
      name: 'Invitee',
    });

    const res = await handleInviteUser(req, env);
    expect(res.status).toBe(201); // métier inchangé

    const call = findAuditCall(db);
    expect(call).not.toBeNull();
    const a = parseAudit(call!);
    expect(a.action).toBe('user.invite');
    expect(a.resourceType).toBe('user');
    expect(typeof a.resourceId).toBe('string');
    expect(a.userId).toBe('u-actor-1'); // acteur dérivé X-User-Id
    expect(a.details).toMatchObject({ role: 'agent', email: 'invite@ex.com' });
    assertNoSecretInDetails(call!.args[4]);
  });

  it('handleUpdateUserRole : audit user.role_change/user, details={role}', async () => {
    const db = createMockD1();
    const env = { DB: db } as any;
    const req = makeRequest('https://x/api/team/users/usr-9', 'PATCH', {
      role: 'broker',
    });

    const res = await handleUpdateUserRole(req, env);
    expect(res.status).toBe(200);

    const a = parseAudit(findAuditCall(db)!);
    expect(a.action).toBe('user.role_change');
    expect(a.resourceType).toBe('user');
    expect(a.resourceId).toBe('usr-9');
    expect(a.details).toMatchObject({ role: 'broker' });
  });

  it('handleDeleteUser : audit user.remove/user, details vide (aucun secret)', async () => {
    const db = createMockD1();
    const env = { DB: db } as any;
    const req = makeRequest('https://x/api/team/users/usr-3', 'DELETE');

    const res = await handleDeleteUser(req, env);
    expect(res.status).toBe(200);

    const call = findAuditCall(db)!;
    const a = parseAudit(call);
    expect(a.action).toBe('user.remove');
    expect(a.resourceType).toBe('user');
    expect(a.resourceId).toBe('usr-3');
    assertNoSecretInDetails(call.args[4]);
  });

  it("best-effort : si l'INSERT audit_log throw, l'invite réussit quand même", async () => {
    const db = createMockD1();
    db.seed('select id from users where email', []);
    // On force l'INSERT audit_log à throw, sans casser les autres requêtes.
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (sql.toLowerCase().includes('insert into audit_log')) {
        return {
          bind: () => ({
            run: () => {
              throw new Error('audit DB down');
            },
            all: () => ({ results: [] }),
            first: () => null,
          }),
        } as any;
      }
      return stmt;
    };
    const env = { DB: db } as any;
    const req = makeRequest('https://x/api/team/users', 'POST', {
      email: 'ok@ex.com',
      role: 'agent',
    });

    const res = await handleInviteUser(req, env);
    // audit() avale l'erreur (try/catch interne figé) → mutation OK.
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// settings.ts
// ════════════════════════════════════════════════════════════

describe('S4 M3 — audit_log settings.ts', () => {
  it('handleCreateApiKey : audit apikey.create/api_key, details SANS rawKey/keyHash', async () => {
    const db = createMockD1();
    const env = { DB: db } as any;
    const req = new Request('https://x/api/settings/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': 'cli-1',
        'X-User-Id': 'u-actor-1',
      },
      body: JSON.stringify({ name: 'CI Key', scopes: 'read' }),
    });

    const res = await handleCreateApiKey(req, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    // La rawKey est toujours retournée UNE fois (métier inchangé).
    expect(typeof body.data.key).toBe('string');
    expect(body.data.key).toContain('ILYS_');

    const call = findAuditCall(db)!;
    const a = parseAudit(call);
    expect(a.action).toBe('apikey.create');
    expect(a.resourceType).toBe('api_key');
    expect(a.details).toMatchObject({ name: 'CI Key', scopes: 'read', client_id: 'cli-1' });
    // CRITIQUE Loi 25 : la rawKey générée ne fuit pas dans l'audit.
    assertNoSecretInDetails(call.args[4]);
    expect(call.args[4]).not.toContain(body.data.key);
  });

  it('handleRevokeApiKey : audit apikey.revoke/api_key', async () => {
    const db = createMockD1();
    const env = { DB: db } as any;
    const req = makeRequest('https://x/api/settings/api-keys/key-7', 'DELETE');

    const res = await handleRevokeApiKey(req, env);
    expect(res.status).toBe(200);

    const a = parseAudit(findAuditCall(db)!);
    expect(a.action).toBe('apikey.revoke');
    expect(a.resourceType).toBe('api_key');
    expect(a.resourceId).toBe('key-7');
  });

  it('handleCreateWebhook : audit webhook.create, details SANS le secret whsec_', async () => {
    const db = createMockD1();
    const env = { DB: db } as any;
    const req = new Request('https://x/api/settings/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': 'cli-1',
        'X-User-Id': 'u-actor-1',
      },
      body: JSON.stringify({
        url: 'https://hook.ex.com/in',
        events: 'lead.created',
      }),
    });

    const res = await handleCreateWebhook(req, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.secret).toContain('whsec_'); // métier inchangé

    const call = findAuditCall(db)!;
    const a = parseAudit(call);
    expect(a.action).toBe('webhook.create');
    expect(a.resourceType).toBe('webhook');
    expect(a.details).toMatchObject({
      url: 'https://hook.ex.com/in',
      events: 'lead.created',
      client_id: 'cli-1',
    });
    // CRITIQUE : le whsec_ généré ne fuit jamais dans l'audit.
    assertNoSecretInDetails(call.args[4]);
    expect(call.args[4]).not.toContain(body.data.secret);
  });

  it('handleDeleteWebhook : audit webhook.delete/webhook', async () => {
    const db = createMockD1();
    const env = { DB: db } as any;
    const req = makeRequest('https://x/api/settings/webhooks/wh-2', 'DELETE');

    const res = await handleDeleteWebhook(req, env);
    expect(res.status).toBe(200);

    const a = parseAudit(findAuditCall(db)!);
    expect(a.action).toBe('webhook.delete');
    expect(a.resourceType).toBe('webhook');
    expect(a.resourceId).toBe('wh-2');
  });

  it('handlePublicCreateWebhook : audit acteur=clientId, source public_api, sans secret', async () => {
    const db = createMockD1();
    const env = { DB: db } as any;
    const req = new Request('https://x/api/public/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://zapier.ex/in', events: '*' }),
    });

    const res = await handlePublicCreateWebhook(req, env, 'cli-zap');
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;

    const call = findAuditCall(db)!;
    const a = parseAudit(call);
    expect(a.userId).toBe('cli-zap'); // acteur = clientId authentifié
    expect(a.action).toBe('webhook.create');
    expect(a.details).toMatchObject({ source: 'public_api' });
    assertNoSecretInDetails(call.args[4]);
    expect(call.args[4]).not.toContain(body.data.secret);
  });

  it('handlePublicDeleteWebhook : audit webhook.delete, acteur=clientId, source public_api', async () => {
    const db = createMockD1();
    const env = { DB: db } as any;

    const res = await handlePublicDeleteWebhook(env, 'cli-zap', 'wh-x');
    expect(res.status).toBe(200);

    const a = parseAudit(findAuditCall(db)!);
    expect(a.userId).toBe('cli-zap');
    expect(a.action).toBe('webhook.delete');
    expect(a.resourceId).toBe('wh-x');
    expect(a.details).toMatchObject({ source: 'public_api' });
  });

  it('handleUpdateClientCompliance : audit compliance.update, details SANS valeur de certificat AMF', async () => {
    const db = createMockD1();
    const env = { DB: db } as any;
    const SECRET_CERT = 'AMF-CERT-PRIVE-9988-NE-DOIT-PAS-FUITER';
    const req = new Request('https://x/api/settings/compliance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'u-actor-1' },
      body: JSON.stringify({
        client_id: 'cli-7',
        amf_certificate: SECRET_CERT,
        amf_disclaimer_required: true,
      }),
    });

    const res = await handleUpdateClientCompliance(req, env, {
      role: 'admin',
    });
    expect(res.status).toBe(200);

    const call = findAuditCall(db)!;
    const a = parseAudit(call);
    expect(a.action).toBe('compliance.update');
    expect(a.resourceType).toBe('client');
    expect(a.resourceId).toBe('cli-7');
    expect(a.details).toMatchObject({
      amf_disclaimer_required: 1,
      has_certificate: true,
    });
    // CRITIQUE Loi 25 : la valeur du certificat ne fuit JAMAIS.
    expect(call.args[4]).not.toContain(SECRET_CERT);
    assertNoSecretInDetails(call.args[4]);
  });

  it("best-effort : audit_log en échec n'empêche pas la révocation de clé", async () => {
    const db = createMockD1();
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (sql.toLowerCase().includes('insert into audit_log')) {
        return {
          bind: () => ({
            run: () => {
              throw new Error('audit DB down');
            },
            all: () => ({ results: [] }),
            first: () => null,
          }),
        } as any;
      }
      return stmt;
    };
    const env = { DB: db } as any;
    const req = makeRequest('https://x/api/settings/api-keys/key-9', 'DELETE');

    const res = await handleRevokeApiKey(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.success).toBe(true);
  });
});
