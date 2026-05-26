// ── exports-extra-lotB.test.ts — LOT B / S-B2 (Manager C, Phase B) ─────────
//
// Couvre handleConfigurableExport :
//   1. Garde admin-only → 403 pour rôle non-admin (copie pattern leads.ts:701).
//   2. Whitelist entité stricte → 400 si entity hors {leads,orders,conversations}.
//   3. Whitelist colonnes stricte → 400 si une colonne hors whitelist (anti-injection).
//   4. Escaping CSV identique leads.ts:725 : guillemets doublés "" .
//   5. Headers Content-Type text/csv + Content-Disposition attachment.
//   6. Colonnes par défaut quand ?columns= absent.
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande). Écrits pour vitest.
// Mock : createMockD1 partagé (_helpers.ts figé). `.all()` → { results }.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { handleConfigurableExport } from '../exports-extra';

function makeEnv(db = createMockD1()) {
  return { env: { DB: db } as unknown as Env, db };
}

const ADMIN = { role: 'admin' };
const BROKER = { role: 'broker' };

function exportUrl(qs = ''): URL {
  return new URL(`http://x/api/exports/configurable${qs}`);
}

describe('S-B2 — handleConfigurableExport : garde admin-only', () => {
  it('rôle non-admin → 403, message FR', async () => {
    const { env, db } = makeEnv();
    const res = await handleConfigurableExport(env, BROKER, exportUrl('?entity=leads'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Accès réservé aux administrateurs');
    // aucune requête SQL ne doit partir avant le check de rôle
    expect(db.calls.length).toBe(0);
  });
});

describe('S-B2 — whitelist entité stricte', () => {
  it('entity manquant → 400', async () => {
    const { env } = makeEnv();
    const res = await handleConfigurableExport(env, ADMIN, exportUrl());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('EXPORT');
  });

  it('entity hors whitelist (ex. users) → 400, aucune query', async () => {
    const { env, db } = makeEnv();
    const res = await handleConfigurableExport(env, ADMIN, exportUrl('?entity=users'));
    expect(res.status).toBe(400);
    expect(db.calls.length).toBe(0);
  });

  it('entity=orders accepté', async () => {
    const { env } = makeEnv();
    const res = await handleConfigurableExport(env, ADMIN, exportUrl('?entity=orders'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
  });
});

describe('S-B2 — whitelist colonnes stricte (anti-injection)', () => {
  it('colonne hors whitelist → 400, rejet explicite', async () => {
    const { env, db } = makeEnv();
    const res = await handleConfigurableExport(
      env,
      ADMIN,
      exportUrl('?entity=leads&columns=name,password'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('EXPORT');
    expect(body.error).toContain('password');
    // aucune query SQL avec colonne injectée
    expect(db.calls.length).toBe(0);
  });

  it('tentative injection SQL via columns → 400', async () => {
    const { env, db } = makeEnv();
    const res = await handleConfigurableExport(
      env,
      ADMIN,
      exportUrl('?entity=leads&columns=' + encodeURIComponent('name,(SELECT 1)')),
    );
    expect(res.status).toBe(400);
    expect(db.calls.length).toBe(0);
  });

  it('colonnes valides → SELECT uniquement sur whitelist', async () => {
    const { env, db } = makeEnv();
    db.seed('from leads', [{ name: 'Bob', email: 'b@x.co' }]);
    const res = await handleConfigurableExport(
      env,
      ADMIN,
      exportUrl('?entity=leads&columns=name,email'),
    );
    expect(res.status).toBe(200);
    const call = db.calls.find((c) => /from leads/i.test(c.sql))!;
    expect(call.sql).toContain('name, email');
    expect(call.sql).not.toContain('password');
  });
});

describe('S-B2 — escaping CSV + headers', () => {
  it('guillemets dans une valeur doublés ("")', async () => {
    const { env, db } = makeEnv();
    db.seed('from leads', [{ name: 'O"Brien', email: 'o@x.co' }]);
    const res = await handleConfigurableExport(
      env,
      ADMIN,
      exportUrl('?entity=leads&columns=name,email'),
    );
    const csv = await res.text();
    expect(csv).toContain('"O""Brien"');
  });

  it('null/undefined → chaîne vide entre guillemets', async () => {
    const { env, db } = makeEnv();
    db.seed('from leads', [{ name: null, email: 'x@x.co' }]);
    const res = await handleConfigurableExport(
      env,
      ADMIN,
      exportUrl('?entity=leads&columns=name,email'),
    );
    const csv = await res.text();
    const lines = csv.split('\n');
    expect(lines[1]).toBe('"","x@x.co"');
  });

  it('headers Content-Type + Content-Disposition attachment', async () => {
    const { env } = makeEnv();
    const res = await handleConfigurableExport(env, ADMIN, exportUrl('?entity=conversations'));
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="conversations-intralys-');
  });
});

describe('S-B2 — colonnes par défaut', () => {
  it('?columns= absent → header CSV = colonnes par défaut', async () => {
    const { env, db } = makeEnv();
    db.seed('from leads', []);
    const res = await handleConfigurableExport(env, ADMIN, exportUrl('?entity=leads'));
    const csv = await res.text();
    const header = csv.split('\n')[0];
    expect(header).toContain('"name"');
    expect(header).toContain('"created_at"');
  });
});
