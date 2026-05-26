// ── onboarding-checklist-s21.test.ts — Sprint 21 (Manager-B) ────────────────
//
// Couvre les 4 handlers de la checklist serveur d'onboarding (migration
// seq 119, ALTER additif sur onboarding_state + table onboarding_events) :
//   - GET    /api/onboarding/checklist            → handleGetChecklist
//   - POST   /api/onboarding/checklist/complete   → handleCompleteChecklistItem
//   - POST   /api/onboarding/checklist/skip       → handleSkipChecklistItem
//   - POST   /api/onboarding/checklist/reset      → handleResetChecklist
//
// Approche : harness mock D1 existant (`createMockD1` + `seed`) — calqué sur
// `onboarding-s8.test.ts`. Les tests SQL-level assertent sur `db.calls`
// (UPSERT, UPDATE, INSERT onboarding_events) — vitest n'exécute pas D1 en VM.
//
// Contrats vérifiés :
//   1. Tenant nouveau → items vides, total=6 (CRM seul) ou 9 (avec ecom).
//   2. Complete + idempotence (completedAt figé au 1er appel).
//   3. Skip avec reason + skipReason exposé.
//   4. Reset → checklist_items_json=NULL via UPDATE.
//   5. Cross-tenant : bind STRICT (client_id, user_id).
//   6. Dégradation seq119 absente → 200 + EMPTY_CHECKLIST (PAS 500).
//   7. Capability : agence sans settings.manage → 403 { error } (sans `code`).
//      Legacy mono-tenant (agencyId === null) → skip garde, 200 OK.
//   8. Validation zod : itemKey vide → 400 code VALIDATION ; itemKey hors
//      enum → 400 { error: 'Unknown itemKey' }.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import {
  handleGetChecklist,
  handleCompleteChecklistItem,
  handleSkipChecklistItem,
  handleResetChecklist,
} from '../onboarding';

// ── Auth helpers ───────────────────────────────────────────────────────────

type Auth = {
  userId: string;
  role: string;
  tenant?: { agencyId?: string | null };
  capabilities?: Set<string>;
};

const AUTH_LEGACY: Auth = { userId: 'user-1', role: 'admin' };
const AUTH_AGENCY_OK: Auth = {
  userId: 'user-1',
  role: 'admin',
  tenant: { agencyId: 'agency-1' },
  capabilities: new Set(['settings.manage']),
};
const AUTH_AGENCY_KO: Auth = {
  userId: 'user-1',
  role: 'broker',
  tenant: { agencyId: 'agency-1' },
  capabilities: new Set(['leads.read']),
};

// ── Env helpers ────────────────────────────────────────────────────────────

function makeEnv(opts?: {
  ecommerce?: boolean;
  clientId?: string | null;
  checklistItemsJson?: string | null;
  lastActiveAt?: string | null;
}) {
  const db = createMockD1();
  const clientId = opts?.clientId === undefined ? 'client-1' : opts.clientId;
  db.seed('from users where id', [{ client_id: clientId }]);
  db.seed('modules_json from clients', [
    { modules_json: opts?.ecommerce ? '["crm","ecommerce"]' : '["crm"]' },
  ]);
  if (opts?.checklistItemsJson !== undefined || opts?.lastActiveAt !== undefined) {
    db.seed('from onboarding_state', [
      {
        checklist_items_json: opts?.checklistItemsJson ?? null,
        last_active_at: opts?.lastActiveAt ?? null,
      },
    ]);
  }
  return { env: { DB: db } as unknown as Env, db };
}

function postReq(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function getReq(path: string): Request {
  return new Request(`http://x${path}`, { method: 'GET' });
}

// ──────────────────────────────────────────────────────────────────────────
// 1. GET — tenant nouveau
// ──────────────────────────────────────────────────────────────────────────

describe('S21 — GET /api/onboarding/checklist (état initial)', () => {
  it('user nouveau (CRM seul) → items vides, total=6, pct=0', async () => {
    const { env } = makeEnv();
    const res = await handleGetChecklist(getReq('/api/onboarding/checklist'), env, AUTH_LEGACY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data).toEqual({
      items: {},
      total: 6,
      completed: 0,
      skipped: 0,
      pct: 0,
      lastActiveAt: null,
    });
  });

  it('module ecommerce actif → total=9', async () => {
    const { env } = makeEnv({ ecommerce: true });
    const res = await handleGetChecklist(getReq('/api/onboarding/checklist'), env, AUTH_LEGACY);
    const body = (await res.json()) as { data: any };
    expect(body.data.total).toBe(9);
  });

  it('aucun tenant résolu → EMPTY_CHECKLIST (200)', async () => {
    const { env } = makeEnv({ clientId: null });
    const res = await handleGetChecklist(getReq('/api/onboarding/checklist'), env, AUTH_LEGACY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.total).toBe(0);
    expect(body.data.items).toEqual({});
  });

  it('filtre SQL strict (client_id, user_id)', async () => {
    const { env, db } = makeEnv();
    await handleGetChecklist(getReq('/api/onboarding/checklist'), env, AUTH_LEGACY);
    const sel = db.calls.find(
      (c) => /from onboarding_state/i.test(c.sql) && /client_id = \? and user_id = \?/i.test(c.sql),
    );
    expect(sel).toBeTruthy();
    expect(sel!.args).toEqual(['client-1', 'user-1']);
  });

  it('parse une row existante avec items done/skipped', async () => {
    const items = {
      profile_completed: {
        done: true,
        skipped: false,
        completedAt: '2026-05-22T10:00:00.000Z',
        skippedAt: null,
      },
      leads_imported: {
        done: false,
        skipped: true,
        completedAt: null,
        skippedAt: '2026-05-22T11:00:00.000Z',
        skipReason: 'pas besoin',
      },
    };
    const { env } = makeEnv({
      checklistItemsJson: JSON.stringify(items),
      lastActiveAt: '2026-05-22 12:00:00',
    });
    const res = await handleGetChecklist(getReq('/api/onboarding/checklist'), env, AUTH_LEGACY);
    const body = (await res.json()) as { data: any };
    expect(body.data.completed).toBe(1);
    expect(body.data.skipped).toBe(1);
    expect(body.data.total).toBe(6);
    expect(body.data.pct).toBe(Math.round((2 / 6) * 100));
    expect(body.data.lastActiveAt).toBe('2026-05-22 12:00:00');
    expect(body.data.items.profile_completed.done).toBe(true);
    expect(body.data.items.leads_imported.skipReason).toBe('pas besoin');
  });

  it('JSON corrompu → items vides (dégrade sans throw)', async () => {
    const { env } = makeEnv({ checklistItemsJson: '{not-json' });
    const res = await handleGetChecklist(getReq('/api/onboarding/checklist'), env, AUTH_LEGACY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.items).toEqual({});
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. POST /complete — marque item + idempotence
// ──────────────────────────────────────────────────────────────────────────

describe('S21 — POST /api/onboarding/checklist/complete', () => {
  it('item nouveau → done=true, completedAt non null', async () => {
    const { env, db } = makeEnv();
    const res = await handleCompleteChecklistItem(
      postReq('/api/onboarding/checklist/complete', { itemKey: 'profile_completed' }),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    // Note : computeChecklist relit la row APRÈS UPSERT, mais le mock D1 ne
    // persiste pas — la 2e lecture renvoie le seed initial (vide). On
    // assertit donc le SQL émis + l'idempotence via les calls.
    const upsert = db.calls.find(
      (c) => /insert into onboarding_state/i.test(c.sql) && /on conflict/i.test(c.sql),
    );
    expect(upsert).toBeTruthy();
    expect(upsert!.args[0]).toBe('client-1');
    expect(upsert!.args[1]).toBe('user-1');
    // bind order : clientId, userId, itemsJson, skippedJson
    // (les autres VALUES sont des littéraux SQL : 0, '[]', NULL, 0).
    const itemsJsonArg = upsert!.args[2];
    expect(typeof itemsJsonArg).toBe('string');
    const parsed = JSON.parse(itemsJsonArg as string);
    expect(parsed.profile_completed.done).toBe(true);
    expect(typeof parsed.profile_completed.completedAt).toBe('string');
    expect(body).toBeTruthy();
  });

  it('idempotent : 2e complete même itemKey → completedAt préservé', async () => {
    const initialAt = '2026-05-22T08:00:00.000Z';
    const items = {
      profile_completed: {
        done: true,
        skipped: false,
        completedAt: initialAt,
        skippedAt: null,
      },
    };
    const { env, db } = makeEnv({ checklistItemsJson: JSON.stringify(items) });
    await handleCompleteChecklistItem(
      postReq('/api/onboarding/checklist/complete', { itemKey: 'profile_completed' }),
      env,
      AUTH_LEGACY,
    );
    const upsert = db.calls.find(
      (c) => /insert into onboarding_state/i.test(c.sql) && /on conflict/i.test(c.sql),
    );
    expect(upsert).toBeTruthy();
    const parsed = JSON.parse(upsert!.args[2] as string);
    expect(parsed.profile_completed.completedAt).toBe(initialAt);
  });

  it('insère un event onboarding_events item.completed', async () => {
    const { env, db } = makeEnv();
    await handleCompleteChecklistItem(
      postReq('/api/onboarding/checklist/complete', { itemKey: 'leads_imported' }),
      env,
      AUTH_LEGACY,
    );
    const evt = db.calls.find((c) => /insert into onboarding_events/i.test(c.sql));
    expect(evt).toBeTruthy();
    // bind : clientId, userId, eventType, itemKey, metadataJson
    expect(evt!.args[0]).toBe('client-1');
    expect(evt!.args[1]).toBe('user-1');
    expect(evt!.args[2]).toBe('item.completed');
    expect(evt!.args[3]).toBe('leads_imported');
  });

  it('audit non sensible (itemKey only)', async () => {
    const { env, db } = makeEnv();
    await handleCompleteChecklistItem(
      postReq('/api/onboarding/checklist/complete', { itemKey: 'docs_visited' }),
      env,
      AUTH_LEGACY,
    );
    const audit = db.calls.find((c) => /insert into audit_log/i.test(c.sql));
    expect(audit).toBeTruthy();
    const details = audit!.args.find((a) => typeof a === 'string' && a.startsWith('{')) as string;
    expect(details).toContain('docs_visited');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. POST /skip — marque item + raison
// ──────────────────────────────────────────────────────────────────────────

describe('S21 — POST /api/onboarding/checklist/skip', () => {
  it('skip avec reason → skipped=true, skipReason exposé', async () => {
    const { env, db } = makeEnv();
    const res = await handleSkipChecklistItem(
      postReq('/api/onboarding/checklist/skip', {
        itemKey: 'leads_imported',
        reason: 'pas besoin',
      }),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(200);
    const upsert = db.calls.find(
      (c) => /insert into onboarding_state/i.test(c.sql) && /on conflict/i.test(c.sql),
    );
    expect(upsert).toBeTruthy();
    // bind order : clientId, userId, itemsJson, skippedJson
    const parsed = JSON.parse(upsert!.args[2] as string);
    expect(parsed.leads_imported.skipped).toBe(true);
    expect(parsed.leads_imported.done).toBe(false);
    expect(parsed.leads_imported.skipReason).toBe('pas besoin');
  });

  it('skipped_items_json miroir des items skipped seulement', async () => {
    const { env, db } = makeEnv();
    await handleSkipChecklistItem(
      postReq('/api/onboarding/checklist/skip', {
        itemKey: 'team_invited',
        reason: 'solo',
      }),
      env,
      AUTH_LEGACY,
    );
    const upsert = db.calls.find(
      (c) => /insert into onboarding_state/i.test(c.sql) && /on conflict/i.test(c.sql),
    );
    // args[3] = skipped_items_json (miroir des items skipped seulement).
    const skippedJson = upsert!.args[3] as string;
    const parsedSkipped = JSON.parse(skippedJson);
    expect(parsedSkipped.team_invited).toBeTruthy();
    expect(parsedSkipped.team_invited.skipReason).toBe('solo');
  });

  it('event item.skipped avec metadata reason', async () => {
    const { env, db } = makeEnv();
    await handleSkipChecklistItem(
      postReq('/api/onboarding/checklist/skip', {
        itemKey: 'integration_connected',
        reason: 'plus tard',
      }),
      env,
      AUTH_LEGACY,
    );
    const evt = db.calls.find((c) => /insert into onboarding_events/i.test(c.sql));
    expect(evt).toBeTruthy();
    expect(evt!.args[2]).toBe('item.skipped');
    expect(evt!.args[3]).toBe('integration_connected');
    const meta = evt!.args[4] as string | null;
    expect(meta).toBeTruthy();
    expect(JSON.parse(meta!)).toEqual({ reason: 'plus tard' });
  });

  it('skip sans reason → metadata_json NULL', async () => {
    const { env, db } = makeEnv();
    await handleSkipChecklistItem(
      postReq('/api/onboarding/checklist/skip', { itemKey: 'team_invited' }),
      env,
      AUTH_LEGACY,
    );
    const evt = db.calls.find((c) => /insert into onboarding_events/i.test(c.sql));
    expect(evt!.args[4]).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. POST /reset — réinitialise
// ──────────────────────────────────────────────────────────────────────────

describe('S21 — POST /api/onboarding/checklist/reset', () => {
  it('émet UPDATE NULL sur les colonnes checklist + dismissed_at', async () => {
    const { env, db } = makeEnv();
    const res = await handleResetChecklist(
      postReq('/api/onboarding/checklist/reset', {}),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(200);
    const upd = db.calls.find(
      (c) =>
        /update onboarding_state/i.test(c.sql) &&
        /checklist_items_json = null/i.test(c.sql) &&
        /skipped_items_json = null/i.test(c.sql) &&
        /dismissed_at = null/i.test(c.sql),
    );
    expect(upd).toBeTruthy();
    expect(upd!.args).toEqual(['client-1', 'user-1']);
  });

  it('insère event checklist.reset', async () => {
    const { env, db } = makeEnv();
    await handleResetChecklist(postReq('/api/onboarding/checklist/reset', {}), env, AUTH_LEGACY);
    const evt = db.calls.find((c) => /insert into onboarding_events/i.test(c.sql));
    expect(evt).toBeTruthy();
    expect(evt!.args[2]).toBe('checklist.reset');
    expect(evt!.args[3]).toBeNull();
  });

  it('réponse shape valide (200 EMPTY_CHECKLIST-like)', async () => {
    const { env } = makeEnv();
    const res = await handleResetChecklist(
      postReq('/api/onboarding/checklist/reset', {}),
      env,
      AUTH_LEGACY,
    );
    const body = (await res.json()) as { data: any };
    expect(Object.keys(body.data).sort()).toEqual(
      ['completed', 'items', 'lastActiveAt', 'pct', 'skipped', 'total'].sort(),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Cross-tenant isolation
// ──────────────────────────────────────────────────────────────────────────

describe('S21 — isolation cross-tenant', () => {
  it('user-B autre client_id ne voit pas les items de user-A', async () => {
    // user-B authentifié, son user.client_id = client-2 (différent de l'auteur).
    const db = createMockD1();
    db.seed('from users where id', [{ client_id: 'client-2' }]);
    db.seed('modules_json from clients', [{ modules_json: '["crm"]' }]);
    // Aucun seed onboarding_state pour client-2 → row null → items vides.
    const env = { DB: db } as unknown as Env;
    const res = await handleGetChecklist(
      getReq('/api/onboarding/checklist'),
      env,
      { userId: 'user-B', role: 'admin' },
    );
    const body = (await res.json()) as { data: any };
    expect(body.data.items).toEqual({});
    expect(body.data.completed).toBe(0);

    // ET le SELECT bind sur (client-2, user-B) — pas de fuite.
    const sel = db.calls.find((c) => /from onboarding_state/i.test(c.sql));
    expect(sel!.args).toEqual(['client-2', 'user-B']);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. Dégradation migration seq119 absente
// ──────────────────────────────────────────────────────────────────────────

describe('S21 — dégradation seq119 non jouée', () => {
  function makeEnvMissingColumn() {
    const db = createMockD1();
    db.seed('from users where id', [{ client_id: 'client-1' }]);
    db.seed('modules_json from clients', [{ modules_json: '["crm"]' }]);
    // Patch prepare pour throw "no such column" sur les colonnes seq119.
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (
        /checklist_items_json|skipped_items_json|dismissed_at|onboarding_events/i.test(sql)
      ) {
        const origRun = stmt.run.bind(stmt);
        const origFirst = stmt.first.bind(stmt);
        stmt.run = () => {
          throw new Error('SQLITE_ERROR: no such column: checklist_items_json');
        };
        stmt.first = () => {
          if (/checklist_items_json/i.test(sql)) {
            throw new Error('SQLITE_ERROR: no such column: checklist_items_json');
          }
          return origFirst();
        };
        // Évite warning unused dans le helper d'origine.
        void origRun;
      }
      return stmt;
    };
    return { env: { DB: db } as unknown as Env, db };
  }

  it('GET → 200 EMPTY_CHECKLIST (PAS 500)', async () => {
    const { env } = makeEnvMissingColumn();
    const res = await handleGetChecklist(getReq('/api/onboarding/checklist'), env, AUTH_LEGACY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data).toEqual({
      items: {},
      total: 0,
      completed: 0,
      skipped: 0,
      pct: 0,
      lastActiveAt: null,
    });
  });

  it('POST /complete → 200 EMPTY_CHECKLIST', async () => {
    const { env } = makeEnvMissingColumn();
    const res = await handleCompleteChecklistItem(
      postReq('/api/onboarding/checklist/complete', { itemKey: 'profile_completed' }),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.total).toBe(0);
  });

  it('POST /skip → 200 EMPTY_CHECKLIST', async () => {
    const { env } = makeEnvMissingColumn();
    const res = await handleSkipChecklistItem(
      postReq('/api/onboarding/checklist/skip', {
        itemKey: 'leads_imported',
        reason: 'plus tard',
      }),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(200);
  });

  it('POST /reset → 200 EMPTY_CHECKLIST', async () => {
    const { env } = makeEnvMissingColumn();
    const res = await handleResetChecklist(
      postReq('/api/onboarding/checklist/reset', {}),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. Capability gating
// ──────────────────────────────────────────────────────────────────────────

describe('S21 — capability settings.manage (mode-agence-only)', () => {
  it('agence sans settings.manage → 403 { error } (pas de champ code)', async () => {
    const { env } = makeEnv();
    const res = await handleCompleteChecklistItem(
      postReq('/api/onboarding/checklist/complete', { itemKey: 'profile_completed' }),
      env,
      AUTH_AGENCY_KO,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code?: string };
    expect(typeof body.error).toBe('string');
    expect(body.code).toBeUndefined();
  });

  it('agence avec settings.manage → 200 OK', async () => {
    const { env } = makeEnv();
    const res = await handleCompleteChecklistItem(
      postReq('/api/onboarding/checklist/complete', { itemKey: 'profile_completed' }),
      env,
      AUTH_AGENCY_OK,
    );
    expect(res.status).toBe(200);
  });

  it('legacy mono-tenant (agencyId null) → skip garde, 200', async () => {
    const { env } = makeEnv();
    const res = await handleGetChecklist(
      getReq('/api/onboarding/checklist'),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(200);
  });

  it('GET aussi gardé (mode-agence-only)', async () => {
    const { env } = makeEnv();
    const res = await handleGetChecklist(
      getReq('/api/onboarding/checklist'),
      env,
      AUTH_AGENCY_KO,
    );
    expect(res.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. Validation zod / enum applicatif
// ──────────────────────────────────────────────────────────────────────────

describe('S21 — validation body', () => {
  it('POST /complete itemKey vide → 400 code VALIDATION', async () => {
    const { env } = makeEnv();
    const res = await handleCompleteChecklistItem(
      postReq('/api/onboarding/checklist/complete', { itemKey: '' }),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(typeof body.error).toBe('string');
    expect(body.code).toBe('VALIDATION');
  });

  it('POST /complete itemKey hors enum → 400 "Unknown itemKey"', async () => {
    const { env } = makeEnv();
    const res = await handleCompleteChecklistItem(
      postReq('/api/onboarding/checklist/complete', { itemKey: 'not_a_real_key' }),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe('Unknown itemKey');
    // Pas de champ `code` ici (uniquement validationError en pose un, et
    // c'est le helper standard partagé — cette branche-là utilise json()
    // direct, donc pas de `code`).
    expect(body.code).toBeUndefined();
  });

  it('POST /skip itemKey vide → 400 VALIDATION', async () => {
    const { env } = makeEnv();
    const res = await handleSkipChecklistItem(
      postReq('/api/onboarding/checklist/skip', { itemKey: '' }),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION');
  });

  it('POST /skip reason > 280 chars → 400 VALIDATION (schema max)', async () => {
    const { env } = makeEnv();
    const longReason = 'x'.repeat(281);
    const res = await handleSkipChecklistItem(
      postReq('/api/onboarding/checklist/skip', {
        itemKey: 'leads_imported',
        reason: longReason,
      }),
      env,
      AUTH_LEGACY,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION');
  });
});
