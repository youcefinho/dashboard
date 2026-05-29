// ── Sprint 85 — account-snapshots.ts — Configurations Portables de Compte ──
//
// Permet de sauvegarder en base de données (account_snapshots) l'état de configuration
// d'un compte (pipelines, formulaires, templates, calendriers) et de la répliquer
// sur un autre sous-compte client de l'agence.
// Gère de manière dynamique la régénération des UUIDs et le réalignement des clés étrangères.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { getClientModules } from './modules';

type SnapshotsAuth = CapAuth & { capabilities?: Set<string> };

/** Résout le client_id du tenant courant. */
async function resolveClientId(
  env: Env,
  auth: SnapshotsAuth,
): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

// ── GET /api/account-snapshots ──────────────────────────────────────────────
export async function handleListAccountSnapshots(
  env: Env,
  auth: SnapshotsAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Liste des snapshots en DB (sans config_blob pour la performance)
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, name, description, created_by, created_at
       FROM account_snapshots
       ORDER BY created_at DESC`
    ).all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/account-snapshots ─────────────────────────────────────────────
export async function handleCreateAccountSnapshot(
  request: Request,
  env: Env,
  auth: SnapshotsAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    let body: { name?: unknown; description?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const name = sanitizeInput(typeof body.name === 'string' ? body.name : '', 200);
    if (!name) {
      return json({ error: 'Le nom du snapshot est requis' }, 400);
    }
    const description = sanitizeInput(
      typeof body.description === 'string' ? body.description : '',
      2000
    ) || null;

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // 1) Collecter toutes les configurations métier du sous-compte
    const pipelines = (await env.DB.prepare('SELECT * FROM pipelines WHERE client_id = ?').bind(clientId).all()).results || [];
    const stages = (await env.DB.prepare('SELECT * FROM pipeline_stages WHERE client_id = ?').bind(clientId).all()).results || [];
    const forms = (await env.DB.prepare('SELECT * FROM forms WHERE client_id = ?').bind(clientId).all()).results || [];
    const formOptions = (await env.DB.prepare('SELECT * FROM form_field_options WHERE client_id = ?').bind(clientId).all()).results || [];
    const emailTemplates = (await env.DB.prepare('SELECT * FROM email_templates WHERE client_id = ?').bind(clientId).all()).results || [];
    const smsTemplates = (await env.DB.prepare('SELECT * FROM sms_templates WHERE client_id = ?').bind(clientId).all()).results || [];
    const calendars = (await env.DB.prepare('SELECT * FROM calendars WHERE client_id = ?').bind(clientId).all()).results || [];
    const availabilityRules = (await env.DB.prepare('SELECT * FROM availability_rules WHERE client_id = ?').bind(clientId).all()).results || [];

    const config = {
      pipelines,
      pipeline_stages: stages,
      forms,
      form_field_options: formOptions,
      email_templates: emailTemplates,
      sms_templates: smsTemplates,
      calendars,
      availability_rules: availabilityRules,
    };

    const id = crypto.randomUUID();
    const serializedConfig = JSON.stringify(config);

    // 2) Insérer en DB
    await env.DB.prepare(
      `INSERT INTO account_snapshots (id, client_id, name, description, config_blob, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(id, clientId, name, description, serializedConfig, auth.userId)
      .run();

    await audit(env, auth.userId, 'account_snapshot_created', 'account_snapshot', id, {
      name,
      pipelines_count: pipelines.length,
      forms_count: forms.length,
    });

    return json({
      data: {
        id,
        client_id: clientId,
        name,
        description,
        created_by: auth.userId,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/account-snapshots/:id/apply ──────────────────────────────────
export async function handleApplyAccountSnapshot(
  request: Request,
  env: Env,
  auth: SnapshotsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    let body: { target_client_id?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const targetClientId = sanitizeInput(
      typeof body.target_client_id === 'string' ? body.target_client_id : '',
      100
    );
    if (!targetClientId) {
      return json({ error: 'Le client cible est requis' }, 400);
    }

    // Récupérer le snapshot
    const snapshot = (await env.DB.prepare(
      'SELECT config_blob, name FROM account_snapshots WHERE id = ?'
    )
      .bind(id)
      .first()) as { config_blob: string; name: string } | null;

    if (!snapshot) {
      return json({ error: 'Snapshot de compte introuvable' }, 404);
    }

    let config: {
      pipelines?: Array<Record<string, unknown>>;
      pipeline_stages?: Array<Record<string, unknown>>;
      forms?: Array<Record<string, unknown>>;
      form_field_options?: Array<Record<string, unknown>>;
      email_templates?: Array<Record<string, unknown>>;
      sms_templates?: Array<Record<string, unknown>>;
      calendars?: Array<Record<string, unknown>>;
      availability_rules?: Array<Record<string, unknown>>;
    };

    try {
      config = JSON.parse(snapshot.config_blob);
    } catch {
      return json({ error: 'Le contenu du snapshot est corrompu' }, 500);
    }

    // ── APPLICATION AVEC RE-LIAISON DES IDS ──

    // 1) Pipelines & Stages
    const pipelineIdMap: Record<string, string> = {};
    if (Array.isArray(config.pipelines)) {
      for (const p of config.pipelines) {
        const oldId = String(p.id);
        const newId = crypto.randomUUID();
        pipelineIdMap[oldId] = newId;

        await env.DB.prepare(
          `INSERT INTO pipelines (id, client_id, name, description, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind(newId, targetClientId, p.name, p.description || null, p.is_active ?? 1)
          .run();
      }
    }

    if (Array.isArray(config.pipeline_stages)) {
      for (const s of config.pipeline_stages) {
        const oldPipelineId = String(s.pipeline_id);
        const newPipelineId = pipelineIdMap[oldPipelineId];
        if (newPipelineId) {
          const newId = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT INTO pipeline_stages (id, pipeline_id, name, color, sort_order, client_id)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
            .bind(newId, newPipelineId, s.name, s.color || null, s.sort_order ?? 0, targetClientId)
            .run();
        }
      }
    }

    // 2) Formulaires & Options
    const formIdMap: Record<string, string> = {};
    if (Array.isArray(config.forms)) {
      for (const f of config.forms) {
        const oldId = String(f.id);
        const newId = crypto.randomUUID();
        formIdMap[oldId] = newId;

        await env.DB.prepare(
          `INSERT INTO forms (id, client_id, name, slug, fields_json, settings_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind(
            newId,
            targetClientId,
            f.name,
            `${f.slug}-${Math.floor(Math.random() * 10000)}`, // évite collision de slug unique
            f.fields_json || '[]',
            f.settings_json || '{}'
          )
          .run();
      }
    }

    if (Array.isArray(config.form_field_options)) {
      for (const opt of config.form_field_options) {
        const oldFormId = String(opt.form_id);
        const newFormId = formIdMap[oldFormId];
        if (newFormId) {
          const newId = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT INTO form_field_options (id, form_id, field_name, label, value, sort_order, client_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(newId, newFormId, opt.field_name, opt.label, opt.value, opt.sort_order ?? 0, targetClientId)
            .run();
        }
      }
    }

    // 3) Calendriers & Rôles
    const calendarIdMap: Record<string, string> = {};
    if (Array.isArray(config.calendars)) {
      for (const c of config.calendars) {
        const oldId = String(c.id);
        const newId = crypto.randomUUID();
        calendarIdMap[oldId] = newId;

        await env.DB.prepare(
          `INSERT INTO calendars (id, client_id, name, description, slot_duration, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind(newId, targetClientId, c.name, c.description || null, c.slot_duration ?? 30)
          .run();
      }
    }

    if (Array.isArray(config.availability_rules)) {
      for (const r of config.availability_rules) {
        const oldCalendarId = String(r.calendar_id);
        const newCalendarId = calendarIdMap[oldCalendarId];
        if (newCalendarId) {
          const newId = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT INTO availability_rules (id, calendar_id, day_of_week, start_time, end_time, client_id)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
            .bind(newId, newCalendarId, r.day_of_week, r.start_time, r.end_time, targetClientId)
            .run();
        }
      }
    }

    // 4) Templates (Email & SMS)
    if (Array.isArray(config.email_templates)) {
      for (const t of config.email_templates) {
        const newId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO email_templates (id, client_id, name, subject, html_content, design_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        )
          .bind(newId, targetClientId, t.name, t.subject, t.html_content || '', t.design_json || null)
          .run();
      }
    }

    if (Array.isArray(config.sms_templates)) {
      for (const t of config.sms_templates) {
        const newId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO sms_templates (id, client_id, name, message, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        )
          .bind(newId, targetClientId, t.name, t.message)
          .run();
      }
    }

    await audit(env, auth.userId, 'account_snapshot_applied', 'account_snapshot', id, {
      target_client_id: targetClientId,
      name: snapshot.name,
    });

    return json({ data: { success: true, target_client_id: targetClientId } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── DELETE /api/account-snapshots/:id ───────────────────────────────────────
export async function handleDeleteAccountSnapshot(
  _request: Request,
  env: Env,
  auth: SnapshotsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const res = await env.DB.prepare('DELETE FROM account_snapshots WHERE id = ?').bind(id).run();
    const changes = (res?.meta?.changes ?? 0) as number;
    if (changes === 0) {
      return json({ error: 'Snapshot introuvable' }, 404);
    }

    await audit(env, auth.userId, 'account_snapshot_deleted', 'account_snapshot', id, {});

    return json({ data: { success: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
