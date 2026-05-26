// ── mobile-register-device.test.ts — Sprint 27 (Manager-B) ─────────────────
//
// Couvre l'extension chirurgicale de `handleRegisterDevice` (src/worker/mobile.ts)
// après la migration seq124 (4 colonnes nullables ajoutées à `device_tokens` :
// `last_seen_at`, `app_version`, `enabled DEFAULT 1`, `device_label`).
//
// Contrats vérifiés :
//   1. Body minimal { token, platform } → INSERT 8-col succès, return 201
//      { data: { id } } (signature publique INCHANGÉE).
//   2. Body enrichi { token, platform, app_version, device_label } → INSERT
//      8-col avec bind correct (vérifié via `db.calls`).
//   3. ON CONFLICT(token) DO UPDATE → SQL émis contient la clause + bind
//      complet (last_seen_at refresh + colonnes enrichies, sans DELETE
//      préalable côté chemin seq124).
//   4. Dégradation seq124 absente (mock "no such column: app_version") →
//      fallback DELETE + INSERT 4-col rétro-compat seq20, 201 OK (PAS 500).
//   5. Token vide → 400 { error: 'Token requis' }.
//   6. Cross-user : user-B avec MÊME token → ON CONFLICT met à jour user_id
//      (un device physique appartient au dernier user logué — comportement
//      explicite de seq124).
//   7. Body invalide (JSON cassé / vide) → 400 sans 500 (catch dans le
//      handler retombe sur body={}).

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { handleRegisterDevice } from '../mobile';

// ── Auth helper ────────────────────────────────────────────────────────────

type Auth = { userId: string; role: string; clientId?: string };

const AUTH_A: Auth = { userId: 'user-A', role: 'admin', clientId: 'client-1' };
const AUTH_B: Auth = { userId: 'user-B', role: 'admin', clientId: 'client-1' };

// ── Env helpers ────────────────────────────────────────────────────────────

function makeEnv() {
  const db = createMockD1();
  return { env: { DB: db } as unknown as Env, db };
}

/**
 * Patch un mock D1 pour simuler la migration seq124 NON jouée : le 1er INSERT
 * 8-col throw "no such column: app_version" comme le ferait SQLite. Le DELETE
 * et l'INSERT 4-col de fallback restent fonctionnels.
 */
function makeEnvMissingSeq124() {
  const db = createMockD1();
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const stmt = origPrepare(sql);
    // Match l'INSERT 8-col seq124 (contient les colonnes additives).
    if (/app_version|device_label|last_seen_at|enabled/i.test(sql)) {
      stmt.run = () => {
        throw new Error('SQLITE_ERROR: no such column: app_version');
      };
    }
    return stmt;
  };
  return { env: { DB: db } as unknown as Env, db };
}

function postReq(body: unknown): Request {
  return new Request('http://x/api/devices/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Body minimal — INSERT 8-col seq124 + signature publique 201 { data:{id} }
// ──────────────────────────────────────────────────────────────────────────

describe('S27 — POST /api/devices/register (body minimal)', () => {
  it('body { token, platform } → 201 { data: { id } } (signature inchangée)', async () => {
    const { env } = makeEnv();
    const res = await handleRegisterDevice(
      postReq({ token: 'tok-min-1', platform: 'ios' }),
      env,
      AUTH_A,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(typeof body.data.id).toBe('string');
    expect(body.data.id.startsWith('dt_')).toBe(true);
  });

  it('platform omis → fallback "web"', async () => {
    const { env, db } = makeEnv();
    await handleRegisterDevice(postReq({ token: 'tok-min-2' }), env, AUTH_A);
    const insert = db.calls.find(
      (c) => /insert into device_tokens/i.test(c.sql) && /app_version/i.test(c.sql),
    );
    expect(insert).toBeTruthy();
    // bind order : id, user_id, token, platform, app_version, device_label
    expect(insert!.args[3]).toBe('web');
  });

  it('app_version / device_label absents → bind NULL (pas string vide)', async () => {
    const { env, db } = makeEnv();
    await handleRegisterDevice(
      postReq({ token: 'tok-min-3', platform: 'android' }),
      env,
      AUTH_A,
    );
    const insert = db.calls.find(
      (c) => /insert into device_tokens/i.test(c.sql) && /app_version/i.test(c.sql),
    );
    expect(insert).toBeTruthy();
    // bind args: [id, user_id, token, platform, app_version, device_label]
    expect(insert!.args[4]).toBeNull();
    expect(insert!.args[5]).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Body enrichi seq124 — bind 6-arg complet
// ──────────────────────────────────────────────────────────────────────────

describe('S27 — POST /api/devices/register (body enrichi seq124)', () => {
  it('body enrichi → bind { app_version, device_label } non-null', async () => {
    const { env, db } = makeEnv();
    const res = await handleRegisterDevice(
      postReq({
        token: 'tok-enr-1',
        platform: 'ios',
        app_version: '1.2.3',
        device_label: "iPhone 15 — Rochdi's perso",
      }),
      env,
      AUTH_A,
    );
    expect(res.status).toBe(201);

    const insert = db.calls.find(
      (c) => /insert into device_tokens/i.test(c.sql) && /app_version/i.test(c.sql),
    );
    expect(insert).toBeTruthy();
    // bind order documenté : id, user_id, token, platform, app_version, device_label
    expect(insert!.args[1]).toBe('user-A');
    expect(insert!.args[2]).toBe('tok-enr-1');
    expect(insert!.args[3]).toBe('ios');
    expect(insert!.args[4]).toBe('1.2.3');
    expect(insert!.args[5]).toBe("iPhone 15 — Rochdi's perso");
  });

  it('SQL émis contient les 4 colonnes seq124 + datetime("now") + enabled=1', async () => {
    const { env, db } = makeEnv();
    await handleRegisterDevice(
      postReq({
        token: 'tok-enr-2',
        platform: 'android',
        app_version: '2.0.0',
        device_label: 'Pixel 9',
      }),
      env,
      AUTH_A,
    );
    const insert = db.calls.find(
      (c) => /insert into device_tokens/i.test(c.sql) && /app_version/i.test(c.sql),
    );
    expect(insert).toBeTruthy();
    const sql = insert!.sql.toLowerCase();
    expect(sql).toContain('app_version');
    expect(sql).toContain('device_label');
    expect(sql).toContain('last_seen_at');
    expect(sql).toContain('enabled');
    expect(sql).toContain("datetime('now')");
  });

  it('app_version trop long → tronqué (sanitizeInput maxLen=64)', async () => {
    const { env, db } = makeEnv();
    const longVersion = 'x'.repeat(200);
    await handleRegisterDevice(
      postReq({
        token: 'tok-enr-3',
        platform: 'web',
        app_version: longVersion,
      }),
      env,
      AUTH_A,
    );
    const insert = db.calls.find(
      (c) => /insert into device_tokens/i.test(c.sql) && /app_version/i.test(c.sql),
    );
    const bound = insert!.args[4] as string;
    expect(typeof bound).toBe('string');
    expect(bound.length).toBeLessThanOrEqual(64);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. ON CONFLICT(token) DO UPDATE — refresh last_seen_at + colonnes enrichies
// ──────────────────────────────────────────────────────────────────────────

describe('S27 — ON CONFLICT(token) DO UPDATE (ré-enregistrement)', () => {
  it('le SQL INSERT contient la clause ON CONFLICT(token) DO UPDATE SET', async () => {
    const { env, db } = makeEnv();
    await handleRegisterDevice(
      postReq({
        token: 'tok-conflict-1',
        platform: 'ios',
        app_version: '1.0.0',
        device_label: 'iPhone 15',
      }),
      env,
      AUTH_A,
    );
    const insert = db.calls.find(
      (c) => /insert into device_tokens/i.test(c.sql) && /app_version/i.test(c.sql),
    );
    expect(insert).toBeTruthy();
    const sql = insert!.sql.toLowerCase();
    expect(sql).toContain('on conflict(token)');
    expect(sql).toContain('do update set');
    expect(sql).toMatch(/last_seen_at\s*=\s*datetime\('now'\)/);
    expect(sql).toContain('app_version = excluded.app_version');
    expect(sql).toContain('device_label = excluded.device_label');
    expect(sql).toContain('platform = excluded.platform');
  });

  it("pas de DELETE préalable sur le chemin seq124 (vs legacy DELETE+INSERT)", async () => {
    const { env, db } = makeEnv();
    await handleRegisterDevice(
      postReq({ token: 'tok-conflict-2', platform: 'web' }),
      env,
      AUTH_A,
    );
    // Le chemin seq124 nominal n'émet PAS de DELETE — c'est l'upsert qui gère.
    const del = db.calls.find((c) => /delete from device_tokens/i.test(c.sql));
    expect(del).toBeUndefined();
  });

  it('2e register même token → 2e INSERT 8-col avec ON CONFLICT (pas de doublon de DELETE)', async () => {
    const { env, db } = makeEnv();
    await handleRegisterDevice(
      postReq({ token: 'tok-conflict-3', platform: 'ios', app_version: '1.0.0' }),
      env,
      AUTH_A,
    );
    await handleRegisterDevice(
      postReq({ token: 'tok-conflict-3', platform: 'ios', app_version: '1.0.1' }),
      env,
      AUTH_A,
    );
    const inserts = db.calls.filter(
      (c) => /insert into device_tokens/i.test(c.sql) && /app_version/i.test(c.sql),
    );
    expect(inserts.length).toBe(2);
    // 2e bind reflète la nouvelle version d'app.
    expect(inserts[1].args[4]).toBe('1.0.1');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Dégradation seq124 non jouée — fallback DELETE + INSERT 4-col legacy
// ──────────────────────────────────────────────────────────────────────────

describe('S27 — dégradation seq124 non jouée', () => {
  it('INSERT 8-col throw "no such column" → fallback DELETE + INSERT 4-col, 201 OK', async () => {
    const { env, db } = makeEnvMissingSeq124();
    const res = await handleRegisterDevice(
      postReq({
        token: 'tok-legacy-1',
        platform: 'ios',
        app_version: '1.0.0',
        device_label: 'iPhone 15',
      }),
      env,
      AUTH_A,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id.startsWith('dt_')).toBe(true);

    // Le fallback a émis : (a) tentative 8-col qui throw, (b) DELETE, (c) INSERT 4-col.
    const del = db.calls.find((c) => /delete from device_tokens/i.test(c.sql));
    expect(del).toBeTruthy();
    expect(del!.args).toEqual(['tok-legacy-1']);

    const legacyInsert = db.calls.find(
      (c) =>
        /insert into device_tokens/i.test(c.sql) &&
        !/app_version/i.test(c.sql),
    );
    expect(legacyInsert).toBeTruthy();
    // bind order legacy : id, user_id, token, platform
    expect(legacyInsert!.args[1]).toBe('user-A');
    expect(legacyInsert!.args[2]).toBe('tok-legacy-1');
    expect(legacyInsert!.args[3]).toBe('ios');
  });

  it('même variante "has no column" → fallback OK', async () => {
    const db = createMockD1();
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (/app_version|device_label|last_seen_at|enabled/i.test(sql)) {
        stmt.run = () => {
          throw new Error('table device_tokens has no column named app_version');
        };
      }
      return stmt;
    };
    const env = { DB: db } as unknown as Env;
    const res = await handleRegisterDevice(
      postReq({ token: 'tok-legacy-2', platform: 'android' }),
      env,
      AUTH_A,
    );
    expect(res.status).toBe(201);
  });

  it('autre erreur SQL (non-migration) → propage (PAS de masquage silencieux)', async () => {
    const db = createMockD1();
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (/insert into device_tokens/i.test(sql) && /app_version/i.test(sql)) {
        stmt.run = () => {
          throw new Error('SQLITE_ERROR: database is locked');
        };
      }
      return stmt;
    };
    const env = { DB: db } as unknown as Env;
    await expect(
      handleRegisterDevice(postReq({ token: 'tok-err', platform: 'ios' }), env, AUTH_A),
    ).rejects.toThrow(/database is locked/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Validation body — token vide / body cassé
// ──────────────────────────────────────────────────────────────────────────

describe('S27 — validation body', () => {
  it('token vide → 400 { error: "Token requis" }', async () => {
    const { env, db } = makeEnv();
    const res = await handleRegisterDevice(
      postReq({ token: '', platform: 'ios' }),
      env,
      AUTH_A,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Token requis');
    // Aucun INSERT ne doit avoir été tenté.
    const insert = db.calls.find((c) => /insert into device_tokens/i.test(c.sql));
    expect(insert).toBeUndefined();
  });

  it('token absent → 400 { error: "Token requis" }', async () => {
    const { env } = makeEnv();
    const res = await handleRegisterDevice(postReq({ platform: 'ios' }), env, AUTH_A);
    expect(res.status).toBe(400);
  });

  it('body JSON corrompu → 400 (catch retombe sur body vide)', async () => {
    const { env } = makeEnv();
    const req = new Request('http://x/api/devices/register', {
      method: 'POST',
      body: '{not-json',
    });
    const res = await handleRegisterDevice(req, env, AUTH_A);
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. Cross-user — même token, user différent → ON CONFLICT met à jour user_id
// ──────────────────────────────────────────────────────────────────────────

describe('S27 — isolation cross-user (device physique = dernier user logué)', () => {
  it('user-A puis user-B avec MÊME token → 2e INSERT bind user_id=user-B', async () => {
    const { env, db } = makeEnv();
    await handleRegisterDevice(
      postReq({ token: 'tok-shared', platform: 'ios', app_version: '1.0.0' }),
      env,
      AUTH_A,
    );
    await handleRegisterDevice(
      postReq({ token: 'tok-shared', platform: 'ios', app_version: '1.0.0' }),
      env,
      AUTH_B,
    );
    const inserts = db.calls.filter(
      (c) => /insert into device_tokens/i.test(c.sql) && /app_version/i.test(c.sql),
    );
    expect(inserts.length).toBe(2);
    // 1er INSERT : user-A
    expect(inserts[0].args[1]).toBe('user-A');
    // 2e INSERT : user-B (qui sera ré-affecté via ON CONFLICT excluded.user_id)
    expect(inserts[1].args[1]).toBe('user-B');
    // Token identique sur les 2.
    expect(inserts[0].args[2]).toBe('tok-shared');
    expect(inserts[1].args[2]).toBe('tok-shared');
  });

  it('le SQL UPDATE clause inclut user_id = excluded.user_id (réassociation)', async () => {
    const { env, db } = makeEnv();
    await handleRegisterDevice(
      postReq({ token: 'tok-reassign', platform: 'ios' }),
      env,
      AUTH_A,
    );
    const insert = db.calls.find(
      (c) => /insert into device_tokens/i.test(c.sql) && /app_version/i.test(c.sql),
    );
    expect(insert).toBeTruthy();
    expect(insert!.sql.toLowerCase()).toContain('user_id = excluded.user_id');
  });
});
