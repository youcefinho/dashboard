import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import { recordTouchpoint, type TouchpointAttribution } from '../touchpoints';

function makeEnv(): Env {
  const db = createMockD1();
  return {
    DB: db as unknown as D1Database,
  } as unknown as Env;
}

describe('Attribution Marketing Multi-Touch - Tests Unitaires (Sprint 61)', () => {
  const clientId = 'client_intralys_61';
  const leadId = 'lead_xyz_999';

  it('doit enregistrer un touchpoint de creation (touch_order = 0)', async () => {
    const env = makeEnv();
    const db = env.DB as unknown as ReturnType<typeof createMockD1>;

    const attr: TouchpointAttribution = {
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'gatineau_premier_achat',
      referrer: 'https://google.com'
    };

    await recordTouchpoint(env, leadId, clientId, attr, 0);

    const insertCall = db.calls.find(c => /insert into lead_touchpoints/i.test(c.sql));
    expect(insertCall).toBeDefined();
    expect(insertCall!.args).toContain(clientId);
    expect(insertCall!.args).toContain(leadId);
    expect(insertCall!.args).toContain(0); // touch_order
    expect(insertCall!.args).toContain('google');
    expect(insertCall!.args).toContain('cpc');
    expect(insertCall!.args).toContain('gatineau_premier_achat');
    expect(insertCall!.args).toContain('https://google.com');
  });

  it('doit resoudre la sentinel -1 au merge en incrementant le touch_order existant maximum', async () => {
    const env = makeEnv();
    const db = env.DB as unknown as ReturnType<typeof createMockD1>;

    // Seed le SELECT MAX(touch_order) pour renvoyer 2
    db.seed('SELECT MAX(touch_order) AS mx FROM lead_touchpoints WHERE client_id = ? AND lead_id = ?', [{ mx: 2 }]);

    const attr: TouchpointAttribution = {
      utm_source: 'facebook',
      utm_medium: 'social',
      utm_campaign: 'retargeting',
      referrer: 'https://facebook.com'
    };

    // touchOrder = -1 pour le merge
    await recordTouchpoint(env, leadId, clientId, attr, -1);

    const selectCall = db.calls.find(c => /select max\(touch_order\)/i.test(c.sql));
    expect(selectCall).toBeDefined();
    expect(selectCall!.args).toContain(clientId);
    expect(selectCall!.args).toContain(leadId);

    const insertCall = db.calls.find(c => /insert into lead_touchpoints/i.test(c.sql));
    expect(insertCall).toBeDefined();
    expect(insertCall!.args).toContain(3); // touch_order = mx(2) + 1
    expect(insertCall!.args).toContain('facebook');
    expect(insertCall!.args).toContain('social');
  });

  it('doit utiliser 0 si aucun touchpoint n existe pour le lead lors de la sentinel -1', async () => {
    const env = makeEnv();
    const db = env.DB as unknown as ReturnType<typeof createMockD1>;

    // Seed qui renvoie mx null
    db.seed('SELECT MAX(touch_order) AS mx FROM lead_touchpoints WHERE client_id = ? AND lead_id = ?', [{ mx: null }]);

    const attr: TouchpointAttribution = {
      utm_source: 'newsletter',
    };

    await recordTouchpoint(env, leadId, clientId, attr, -1);

    const insertCall = db.calls.find(c => /insert into lead_touchpoints/i.test(c.sql));
    expect(insertCall).toBeDefined();
    expect(insertCall!.args).toContain(0); // touch_order fallback à 0
    expect(insertCall!.args).toContain('newsletter');
  });

  it('doit skip silencieusement si tous les champs d attribution sont vides', async () => {
    const env = makeEnv();
    const db = env.DB as unknown as ReturnType<typeof createMockD1>;

    const attr: TouchpointAttribution = {
      utm_source: '',
      utm_medium: null,
      referrer: '   '
    };

    await recordTouchpoint(env, leadId, clientId, attr, 0);

    const insertCall = db.calls.find(c => /insert into lead_touchpoints/i.test(c.sql));
    expect(insertCall).toBeUndefined(); // Pas d'insertion
  });

  it('doit skip silencieusement si le leadId ou clientId est manquant', async () => {
    const env = makeEnv();
    const db = env.DB as unknown as ReturnType<typeof createMockD1>;

    const attr: TouchpointAttribution = { utm_source: 'google' };

    await recordTouchpoint(env, '', clientId, attr, 0);
    await recordTouchpoint(env, leadId, '', attr, 0);

    const insertCall = db.calls.find(c => /insert into lead_touchpoints/i.test(c.sql));
    expect(insertCall).toBeUndefined(); // Pas d'insertion
  });
});
