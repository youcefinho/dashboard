import { describe, it, expect } from 'vitest';
import { createMockD1 } from './_helpers';
import type { Env } from '../types';
import {
  handleListAccountSnapshots,
  handleCreateAccountSnapshot,
  handleApplyAccountSnapshot,
  handleDeleteAccountSnapshot,
} from '../account-snapshots';

const authAdmin = {
  role: 'admin',
  userId: 'user-1',
  clientId: 'c1',
  capabilities: new Set(['settings.manage']),
};

function envWith(db: ReturnType<typeof createMockD1>): Env {
  return { DB: db } as unknown as Env;
}

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('Snapshots de Compte (Configurations Portables) — Worker API', () => {
  it('GET /api/account-snapshots -> liste les snapshots de compte', async () => {
    const db = createMockD1();

    // Mock des modules utilisateur pour resolveClientId
    db.seed('SELECT * FROM client_modules WHERE client_id = (SELECT client_id FROM users WHERE id = ?)', []);
    db.seed('SELECT client_id FROM users WHERE id = ?', [{ client_id: 'c1' }]);

    // Seed de la table account_snapshots
    db.seed(
      `SELECT id, client_id, name, description, created_by, created_at
       FROM account_snapshots
       ORDER BY created_at DESC`,
      [
        {
          id: 'snap-1',
          client_id: 'c1',
          name: 'Snapshot Courtier V1',
          description: 'Description V1',
          created_by: 'user-1',
          created_at: '2026-05-29T12:00:00Z',
        },
      ]
    );

    const res = await handleListAccountSnapshots(envWith(db), authAdmin);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: any[] };
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe('snap-1');
    expect(body.data[0].name).toBe('Snapshot Courtier V1');
  });

  it('POST /api/account-snapshots -> collecte la configuration et la sauvegarde', async () => {
    const db = createMockD1();

    // Mock resolveClientId
    db.seed('SELECT client_id FROM users WHERE id = ?', [{ client_id: 'c1' }]);

    // Seed de la configuration existante
    db.seed('SELECT * FROM pipelines WHERE client_id = ?', [{ id: 'pipe-1', name: 'Pipeline Vente', is_active: 1 }]);
    db.seed('SELECT * FROM pipeline_stages WHERE client_id = ?', [
      { id: 'stage-1', pipeline_id: 'pipe-1', name: 'Nouveau', sort_order: 1 },
    ]);
    db.seed('SELECT * FROM forms WHERE client_id = ?', [{ id: 'form-1', name: 'Form Achat', slug: 'achat' }]);
    db.seed('SELECT * FROM form_field_options WHERE client_id = ?', []);
    db.seed('SELECT * FROM email_templates WHERE client_id = ?', []);
    db.seed('SELECT * FROM sms_templates WHERE client_id = ?', []);
    db.seed('SELECT * FROM calendars WHERE client_id = ?', [{ id: 'cal-1', name: 'Calendrier Vente', slot_duration: 30 }]);
    db.seed('SELECT * FROM availability_rules WHERE client_id = ?', [
      { id: 'rule-1', calendar_id: 'cal-1', day_of_week: 1, start_time: '09:00', end_time: '17:00' },
    ]);

    const req = makeReq({ name: 'Snapshot Test', description: 'Une belle configuration' });
    const res = await handleCreateAccountSnapshot(req, envWith(db), authAdmin);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.name).toBe('Snapshot Test');

    // Vérifier l'insertion
    const inserts = db.calls.filter((c) => c.sql.includes('INSERT INTO account_snapshots'));
    expect(inserts.length).toBe(1);

    const configBlob = JSON.parse(inserts[0].args[4]);
    expect(configBlob.pipelines.length).toBe(1);
    expect(configBlob.pipeline_stages.length).toBe(1);
    expect(configBlob.calendars.length).toBe(1);
    expect(configBlob.availability_rules.length).toBe(1);
  });

  it('POST /api/account-snapshots/:id/apply -> applique le snapshot en régénérant les UUIDs et en liant les tables enfants', async () => {
    const db = createMockD1();

    // Config simulée dans la DB
    const savedConfig = {
      pipelines: [{ id: 'old-pipe-1', name: 'Pipeline Vente', is_active: 1 }],
      pipeline_stages: [{ id: 'old-stage-1', pipeline_id: 'old-pipe-1', name: 'Contacté', sort_order: 1 }],
      forms: [{ id: 'old-form-1', name: 'Form Achat', slug: 'achat', fields_json: '[]', settings_json: '{}' }],
      form_field_options: [{ id: 'old-opt-1', form_id: 'old-form-1', field_name: 'choice', label: 'Oui', value: 'yes' }],
      calendars: [{ id: 'old-cal-1', name: 'Calendrier Vente', slot_duration: 30 }],
      availability_rules: [{ id: 'old-rule-1', calendar_id: 'old-cal-1', day_of_week: 1, start_time: '09:00', end_time: '17:00' }],
      email_templates: [{ name: 'Template Email', subject: 'Bonjour', html_content: '<p>Hi</p>' }],
      sms_templates: [{ name: 'Template SMS', message: 'Hello' }],
    };

    db.seed('SELECT config_blob, name FROM account_snapshots WHERE id = ?', [
      { config_blob: JSON.stringify(savedConfig), name: 'Snapshot Test' },
    ]);

    const req = makeReq({ target_client_id: 'target-client-id' });
    const res = await handleApplyAccountSnapshot(req, envWith(db), authAdmin, 'snap-1');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.success).toBe(true);
    expect(body.data.target_client_id).toBe('target-client-id');

    // Vérifier les insertions dans la DB pour la destination
    const pipeInserts = db.calls.filter((c) => c.sql.includes('INSERT INTO pipelines'));
    expect(pipeInserts.length).toBe(1);
    const newPipelineId = pipeInserts[0].args[0];
    expect(pipeInserts[0].args[1]).toBe('target-client-id');

    const stageInserts = db.calls.filter((c) => c.sql.includes('INSERT INTO pipeline_stages'));
    expect(stageInserts.length).toBe(1);
    expect(stageInserts[0].args[1]).toBe(newPipelineId); // Vérifie le réalignement de clé étrangère !
    expect(stageInserts[0].args[5]).toBe('target-client-id');

    const formInserts = db.calls.filter((c) => c.sql.includes('INSERT INTO forms'));
    expect(formInserts.length).toBe(1);
    const newFormId = formInserts[0].args[0];

    const optInserts = db.calls.filter((c) => c.sql.includes('INSERT INTO form_field_options'));
    expect(optInserts.length).toBe(1);
    expect(optInserts[0].args[1]).toBe(newFormId); // Clé étrangère du formulaire réalignée !

    const calInserts = db.calls.filter((c) => c.sql.includes('INSERT INTO calendars'));
    expect(calInserts.length).toBe(1);
    const newCalId = calInserts[0].args[0];

    const ruleInserts = db.calls.filter((c) => c.sql.includes('INSERT INTO availability_rules'));
    expect(ruleInserts.length).toBe(1);
    expect(ruleInserts[0].args[1]).toBe(newCalId); // Clé étrangère du calendrier réalignée !

    const emailInserts = db.calls.filter((c) => c.sql.includes('INSERT INTO email_templates'));
    expect(emailInserts.length).toBe(1);

    const smsInserts = db.calls.filter((c) => c.sql.includes('INSERT INTO sms_templates'));
    expect(smsInserts.length).toBe(1);
  });

  it('DELETE /api/account-snapshots/:id -> supprime le snapshot', async () => {
    const db = createMockD1();
    db.runMeta = { changes: 1 };

    const res = await handleDeleteAccountSnapshot(makeReq({}), envWith(db), authAdmin, 'snap-1');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: any };
    expect(body.data.success).toBe(true);

    const deletes = db.calls.filter((c) => c.sql.includes('DELETE FROM account_snapshots'));
    expect(deletes.length).toBe(1);
    expect(deletes[0].args[0]).toBe('snap-1');
  });
});
