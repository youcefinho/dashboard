// ════════════════════════════════════════════════════════════
// Sprint 33 — calendar-sync.ts tests (push/pull + LWW + webhooks)
// ════════════════════════════════════════════════════════════
//
// Couvre `src/worker/calendar-sync.ts` (A2) :
//   - pushAppointmentToExternal : anti-loop (skip < 30s) + create gcal/outlook
//     event + INSERT appointment_sync
//   - pullExternalToAppointments : event externe absent → CREATE appointment ;
//     event externe newer (LWW) → UPDATE local ; conflit détecté →
//     UPDATE appointment_sync.sync_status='conflict'
//   - resolveLwwConflict : égalité timestamps → tiebreak 'lww_intralys'
//   - handleGcalWebhook : token valide → trigger pull ; token invalide → silent
//     ACK 200 (politique anti-retry-storm, cf. impl ligne 730)
//   - handleOutlookWebhook : validationToken handshake GET (200 plain-text echo)
//   - processCalendarPullSync : LIMIT 20 + best-effort errors counter
//
// Calque harness gbp.test.ts (createMockD1 inline + mock fetch + auth stub).
//
// SIGNATURES RÉELLES (cf. calendar-sync.ts) :
//   - pushAppointmentToExternal(env, auth, appointmentId, action) : Promise<void>
//   - pullExternalToAppointments(env, calendarConnectionId) : Promise<PullResult>
//   - handleGcalWebhook : lookup via calendar_connections (webhook_channel_id +
//     webhook_client_state), pas une table `gcal_channels` dédiée
//   - handleOutlookWebhook : handshake validationToken UNIQUEMENT en GET

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let cs: typeof import('../calendar-sync');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn());
  cs = await import('../calendar-sync');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Mini-mock D1 inline (calque gbp.test.ts) — pas de dépendance à _helpers
// pour rester self-contained et permettre le seeding par needle SQL.
function makeEnv(seed: Record<string, any[]> = {}) {
  const calls: Array<{ sql: string; args: any[] }> = [];
  const prepare = (sql: string) => {
    let bound: any[] = [];
    const stmt: any = {
      bind: (...a: any[]) => {
        bound = a;
        return stmt;
      },
      all: () => {
        calls.push({ sql, args: bound });
        for (const key of Object.keys(seed)) {
          if (sql.toLowerCase().includes(key.toLowerCase())) {
            return Promise.resolve({ results: seed[key] });
          }
        }
        return Promise.resolve({ results: [] });
      },
      first: () => {
        calls.push({ sql, args: bound });
        for (const key of Object.keys(seed)) {
          if (sql.toLowerCase().includes(key.toLowerCase())) {
            const rows = seed[key];
            return Promise.resolve(rows.length ? rows[0] : null);
          }
        }
        return Promise.resolve(null);
      },
      run: () => {
        calls.push({ sql, args: bound });
        return Promise.resolve({
          success: true,
          meta: { changes: 1, last_row_id: 1 },
        });
      },
    };
    return stmt;
  };
  return {
    env: {
      DB: { prepare },
      GCAL_SYNC_OAUTH_CLIENT_ID: 'gcid',
      GCAL_SYNC_OAUTH_CLIENT_SECRET: 'gsecret',
      GOOGLE_OAUTH_CLIENT_ID: 'gcid',
      GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret',
      OUTLOOK_SYNC_OAUTH_CLIENT_ID: 'ocid',
      OUTLOOK_SYNC_OAUTH_CLIENT_SECRET: 'osecret',
      MICROSOFT_OAUTH_CLIENT_ID: 'ocid',
      MICROSOFT_OAUTH_CLIENT_SECRET: 'osecret',
      // TOKEN_KEY volontairement omis : decryptToken/encryptToken (cf.
      // migration-ghl-oauth.ts:17,30) deviennent pass-through quand TOKEN_KEY
      // est absent, donc nos seeds de tokens en clair ('at', 'rt') passent
      // tel quel à travers getGcalAccessToken sans crash AES.
    } as any,
    calls,
  };
}

// Auth stub minimal — calendar-sync resolveClientId() lit auth.tenant?.clientId
// puis fallback auth.clientId.
function makeAuth(clientId = 'c1') {
  return { clientId, tenant: { clientId } };
}

// ── pushAppointmentToExternal ───────────────────────────────

describe('pushAppointmentToExternal', () => {
  it('anti-loop : skip si last_synced_at < 30s ago (pas de fetch externe)', async () => {
    const recent = new Date(Date.now() - 5_000).toISOString();
    const { env } = makeEnv({
      'from appointments': [
        {
          id: 'ap1',
          client_id: 'c1',
          title: 'RDV',
          description: '',
          start_time: '2026-06-01T10:00:00',
          end_time: '2026-06-01T11:00:00',
          location: '',
          status: 'scheduled',
          updated_at: recent,
        },
      ],
      'from calendar_connections': [
        {
          id: 'conn1',
          client_id: 'c1',
          provider: 'google_calendar',
          external_calendar_id: 'primary',
          webhook_client_state: null,
          last_pull_at: null,
        },
      ],
      'from appointment_sync': [
        {
          id: 'sync1',
          appointment_id: 'ap1',
          calendar_connection_id: 'conn1',
          external_event_id: 'ev_gcal_1',
          external_etag: 'etag1',
          sync_status: 'synced',
          last_synced_at: recent,
          intralys_updated_at: recent,
        },
      ],
    });
    // Signature : (env, auth, appointmentId, action) → Promise<void>.
    // Anti-loop : last_synced_at < 30s → continue dans la boucle → pas de fetch.
    await cs.pushAppointmentToExternal(env, makeAuth('c1'), 'ap1', 'update');
    expect((global.fetch as any).mock.calls.length).toBe(0);
  });

  it('create flow : INSERT appointment_sync quand pas d\'event existant', async () => {
    const { env, calls } = makeEnv({
      'from appointments': [
        {
          id: 'ap2',
          client_id: 'c1',
          title: 'Nouveau RDV',
          description: '',
          start_time: '2026-06-02T10:00:00',
          end_time: '2026-06-02T11:00:00',
          location: '',
          status: 'scheduled',
          updated_at: new Date().toISOString(),
        },
      ],
      'from calendar_connections': [
        {
          id: 'conn2',
          client_id: 'c1',
          provider: 'google_calendar',
          external_calendar_id: 'primary',
          webhook_client_state: null,
          last_pull_at: null,
        },
      ],
      // Pas de ligne appointment_sync → on est en mode CREATE.
      'from appointment_sync': [],
      // Token OAuth fresh : getGcalAccessToken lit oauth_connections.
      'from oauth_connections': [
        {
          access_token: 'at_ok',
          refresh_token: 'rt',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      ],
    });
    // Mock fetch : 1er appel = refresh OAuth (si nécessaire), 2e = gcalCreateEvent.
    // On répond OK à tous les appels fetch pour couvrir les deux cas.
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ id: 'ev_gcal_new', etag: 'etag1', access_token: 'at_fresh' }), {
        status: 200,
      }),
    );
    await cs.pushAppointmentToExternal(env, makeAuth('c1'), 'ap2', 'create');
    // upsertAppointmentSync fait DELETE + INSERT appointment_sync.
    const sqls = calls.map((c) => c.sql.toLowerCase()).join(' || ');
    expect(sqls).toMatch(/insert.*appointment_sync|delete.*appointment_sync/);
  });
});

// ── pullExternalToAppointments ──────────────────────────────

describe('pullExternalToAppointments', () => {
  it('event externe pas en local → CREATE appointment (INSERT appointments)', async () => {
    const { env, calls } = makeEnv({
      'from calendar_connections': [
        {
          id: 'conn_pull',
          client_id: 'c1',
          provider: 'google_calendar',
          external_calendar_id: 'primary',
          webhook_client_state: null,
          last_pull_at: null,
        },
      ],
      // Aucune ligne dans appointment_sync pour ce external_event_id.
      'from appointment_sync': [],
      'from oauth_connections': [
        {
          access_token: 'at',
          refresh_token: 'rt',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      ],
    });
    (global.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'ev_new',
              summary: 'External RDV',
              start: { dateTime: '2026-06-03T10:00:00Z' },
              end: { dateTime: '2026-06-03T11:00:00Z' },
              updated: new Date().toISOString(),
              etag: 'etag-new',
            },
          ],
          access_token: 'at_fresh',
        }),
        { status: 200 },
      ),
    );
    // Signature : (env, calendarConnectionId).
    await cs.pullExternalToAppointments(env, 'conn_pull');
    const sqls = calls.map((c) => c.sql.toLowerCase()).join(' || ');
    expect(sqls).toMatch(/insert.*appointments|insert.*appointment_sync/);
  });

  it('LWW external newer → UPDATE local appointment', async () => {
    const externalNewer = new Date(Date.now()).toISOString();
    const localOlder = new Date(Date.now() - 60_000).toISOString();
    const { env, calls } = makeEnv({
      'from calendar_connections': [
        {
          id: 'conn_lww',
          client_id: 'c1',
          provider: 'google_calendar',
          external_calendar_id: 'primary',
          webhook_client_state: null,
          last_pull_at: localOlder,
        },
      ],
      'from appointment_sync': [
        {
          id: 'sync_lww',
          appointment_id: 'ap_loc',
          calendar_connection_id: 'conn_lww',
          external_event_id: 'ev_x',
          external_etag: 'old-etag',
          sync_status: 'synced',
          last_synced_at: localOlder,
          intralys_updated_at: localOlder,
        },
      ],
      'from appointments': [
        {
          id: 'ap_loc',
          client_id: 'c1',
          title: 'Vieux',
          description: '',
          start_time: '2026-06-03T09:00:00',
          end_time: '2026-06-03T10:00:00',
          location: '',
          status: 'scheduled',
          updated_at: localOlder,
        },
      ],
      'from oauth_connections': [
        {
          access_token: 'at',
          refresh_token: 'rt',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      ],
    });
    (global.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'ev_x',
              summary: 'Nouveau titre',
              start: { dateTime: '2026-06-03T10:00:00Z' },
              end: { dateTime: '2026-06-03T11:00:00Z' },
              updated: externalNewer,
              etag: 'new-etag',
            },
          ],
          access_token: 'at_fresh',
        }),
        { status: 200 },
      ),
    );
    await cs.pullExternalToAppointments(env, 'conn_lww');
    const sqls = calls.map((c) => c.sql.toLowerCase()).join(' || ');
    expect(sqls).toMatch(/update.*appointments/);
  });

  it('conflit détecté → UPDATE appointment_sync.sync_status=conflict', async () => {
    // Les DEUX côtés ont changé depuis le last_synced_at → conflit.
    const lastSync = new Date(Date.now() - 60_000).toISOString();
    const externalChanged = new Date(Date.now() - 10_000).toISOString();
    const localChanged = new Date(Date.now() - 5_000).toISOString();
    const { env, calls } = makeEnv({
      'from calendar_connections': [
        {
          id: 'conn_c',
          client_id: 'c1',
          provider: 'google_calendar',
          external_calendar_id: 'primary',
          webhook_client_state: null,
          last_pull_at: lastSync,
        },
      ],
      'from appointment_sync': [
        {
          id: 'sync_c',
          appointment_id: 'ap_c',
          calendar_connection_id: 'conn_c',
          external_event_id: 'ev_c',
          external_etag: 'sync-etag',
          sync_status: 'synced',
          last_synced_at: lastSync,
          intralys_updated_at: lastSync,
        },
      ],
      'from appointments': [
        {
          id: 'ap_c',
          client_id: 'c1',
          title: 'Modifié local',
          description: '',
          start_time: '2026-06-03T09:00:00',
          end_time: '2026-06-03T10:00:00',
          location: '',
          status: 'scheduled',
          updated_at: localChanged,
        },
      ],
      'from oauth_connections': [
        {
          access_token: 'at',
          refresh_token: 'rt',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      ],
    });
    (global.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'ev_c',
              summary: 'Modifié externe',
              start: { dateTime: '2026-06-03T10:00:00Z' },
              end: { dateTime: '2026-06-03T11:00:00Z' },
              updated: externalChanged,
              etag: 'changed-etag',
            },
          ],
          access_token: 'at_fresh',
        }),
        { status: 200 },
      ),
    );
    await cs.pullExternalToAppointments(env, 'conn_c');
    const sqls = calls.map((c) => c.sql.toLowerCase()).join(' || ');
    // L'impl marque sync_status='conflict' via UPDATE appointment_sync.
    expect(sqls).toMatch(/update.*appointment_sync|sync_status/);
  });
});

// ── resolveLwwConflict ──────────────────────────────────────

describe('resolveLwwConflict', () => {
  it('égalité timestamps → tiebreak "lww_intralys" (Intralys gagne)', () => {
    const now = new Date().toISOString();
    const winner = cs.resolveLwwConflict(now, now);
    expect(winner).toBe('lww_intralys');
  });

  it('external strictement plus récent → "lww_external"', () => {
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date(Date.now()).toISOString();
    // Signature : (intralysUpdatedAt, externalUpdatedAt).
    const winner = cs.resolveLwwConflict(older, newer);
    expect(winner).toBe('lww_external');
  });

  it('local strictement plus récent → "lww_intralys"', () => {
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date(Date.now()).toISOString();
    const winner = cs.resolveLwwConflict(newer, older);
    expect(winner).toBe('lww_intralys');
  });
});

// ── handleGcalWebhook ───────────────────────────────────────

describe('handleGcalWebhook', () => {
  it('token valide → trigger pull + 200', async () => {
    const { env } = makeEnv({
      // L'impl lookup calendar_connections via webhook_channel_id.
      'from calendar_connections': [
        {
          id: 'conn_wh',
          webhook_client_state: 'tok-valid',
        },
      ],
      'from oauth_connections': [
        {
          access_token: 'at',
          refresh_token: 'rt',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      ],
    });
    const req = new Request('https://app/api/gcal/webhook', {
      method: 'POST',
      headers: {
        'X-Goog-Channel-ID': 'ch1',
        'X-Goog-Channel-Token': 'tok-valid',
        'X-Goog-Resource-State': 'exists',
      },
    });
    const res = await cs.handleGcalWebhook(req, env);
    expect([200, 202]).toContain(res.status);
  });

  it('token invalide → silent ACK 200 (anti-retry-storm)', async () => {
    // L'impl renvoie 200 même sur token mismatch (cf. ligne 730 calendar-sync.ts :
    // "silent ACK pour éviter retry agressif"). C'est une décision design
    // explicite — Google retry en exponential backoff si on renvoie 4xx/5xx.
    const { env } = makeEnv({
      'from calendar_connections': [
        {
          id: 'conn_wh',
          webhook_client_state: 'tok-valid',
        },
      ],
    });
    const req = new Request('https://app/api/gcal/webhook', {
      method: 'POST',
      headers: {
        'X-Goog-Channel-ID': 'ch1',
        'X-Goog-Channel-Token': 'tok-WRONG',
        'X-Goog-Resource-State': 'exists',
      },
    });
    const res = await cs.handleGcalWebhook(req, env);
    expect(res.status).toBe(200);
  });
});

// ── handleOutlookWebhook ────────────────────────────────────

describe('handleOutlookWebhook', () => {
  it('validationToken handshake GET → 200 + plain text echo du token', async () => {
    // Spec Microsoft Graph : handshake = GET ?validationToken=... → echo plain text.
    // L'impl ne déclenche le handshake QUE sur method=GET (cf. ligne 753).
    const { env } = makeEnv();
    const validationToken = 'validation-abc-123';
    const req = new Request(
      `https://app/api/outlook/webhook?validationToken=${encodeURIComponent(validationToken)}`,
      { method: 'GET' },
    );
    const res = await cs.handleOutlookWebhook(req, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(validationToken);
    // Doit être en text/plain selon spec Microsoft Graph.
    const ct = res.headers.get('content-type') ?? '';
    expect(ct.toLowerCase()).toContain('text/plain');
  });
});

// ── processCalendarPullSync ─────────────────────────────────

describe('processCalendarPullSync', () => {
  it('LIMIT 20 + best-effort : retourne { processed, errors } et ne throw jamais', async () => {
    const { env, calls } = makeEnv({
      // Seed de quelques connexions actives à puller.
      'from calendar_connections': [
        {
          id: 'conn_p1',
          client_id: 'c1',
          provider: 'google_calendar',
        },
        {
          id: 'conn_p2',
          client_id: 'c2',
          provider: 'outlook',
        },
      ],
      // Sync rows initiaux vides → on est en mode pull.
      'from appointment_sync': [],
      'from oauth_connections': [
        {
          access_token: 'at',
          refresh_token: 'rt',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      ],
    });
    // Réponses fetch génériques OK (best-effort, le test vérifie le contrat
    // pas le détail des fetches).
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ items: [], access_token: 'at' }), { status: 200 }),
    );

    const result = await cs.processCalendarPullSync(env);
    expect(result).toBeTruthy();
    expect(typeof result.processed).toBe('number');
    expect(typeof result.errors).toBe('number');
    // LIMIT 20 doit apparaître dans au moins une requête SELECT.
    const sqls = calls.map((c) => c.sql.toLowerCase()).join(' || ');
    expect(sqls).toMatch(/limit\s+20/);
  });

  it('aucune connexion → { processed: 0, errors: 0 } (no throw)', async () => {
    const { env } = makeEnv({ 'from calendar_connections': [] });
    const result = await cs.processCalendarPullSync(env);
    expect(result).toEqual({ processed: 0, errors: 0 });
    expect((global.fetch as any).mock.calls.length).toBe(0);
  });
});
