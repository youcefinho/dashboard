// ── Module Packs Industrie — Intralys CRM (Sprint 6 D7) ─────
import type { Env } from './types';
import { json, audit } from './helpers';

// ── Liste des packs disponibles ──────────────────────────────

export async function handleGetPacks(env: Env, _auth: { userId: string; role: string }): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, slug, name, description, icon, industries, is_published FROM industry_packs WHERE is_published = 1 ORDER BY name ASC'
  ).all();
  return json({ data: results || [] });
}

// ── Détail d'un pack ─────────────────────────────────────────

export async function handleGetPackDetail(
  env: Env, _auth: { userId: string; role: string }, slug: string
): Promise<Response> {
  const pack = await env.DB.prepare(
    'SELECT * FROM industry_packs WHERE slug = ? AND is_published = 1'
  ).bind(slug).first() as { id: string; slug: string; name: string; snapshot_json: string } | null;

  if (!pack) return json({ error: 'Pack introuvable' }, 404);

  let snapshot: Record<string, unknown> = {};
  try { snapshot = JSON.parse(pack.snapshot_json); } catch { /* */ }

  return json({ data: { ...pack, snapshot } });
}

// ── Installer un pack sur un client ─────────────────────────

export async function handleInstallPack(
  request: Request, env: Env, auth: { userId: string; role: string }, slug: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { client_id?: string };
  if (!body.client_id) return json({ error: 'client_id requis' }, 400);

  // Vérifier client existe
  const client = await env.DB.prepare(
    'SELECT id FROM clients WHERE id = ? AND is_active = 1'
  ).bind(body.client_id).first();
  if (!client) return json({ error: 'Client introuvable' }, 404);

  // Charger le pack
  const pack = await env.DB.prepare(
    'SELECT * FROM industry_packs WHERE slug = ? AND is_published = 1'
  ).bind(slug).first() as { id: string; name: string; snapshot_json: string } | null;
  if (!pack) return json({ error: 'Pack introuvable' }, 404);

  let snapshot: {
    custom_fields?: Array<{ name: string; key: string; type: string; options?: string[] }>;
    workflows?: Array<{ name: string; trigger: string; steps: unknown[] }>;
    templates?: Array<{ name: string; channel: string; subject?: string; body: string }>;
    smart_lists?: Array<{ name: string; filters: Record<string, unknown> }>;
  } = {};

  try { snapshot = JSON.parse(pack.snapshot_json); } catch {
    return json({ error: 'Pack corrompu (JSON invalide)' }, 500);
  }

  const results = {
    custom_fields: 0,
    workflows: 0,
    templates: 0,
    smart_lists: 0,
    skipped: 0,
  };

  // ── 1. Custom fields ────────────────────────────────────────
  if (snapshot.custom_fields) {
    for (const field of snapshot.custom_fields) {
      const existing = await env.DB.prepare(
        'SELECT id FROM custom_field_defs WHERE field_key = ? AND client_id = ?'
      ).bind(field.key, body.client_id).first();

      if (!existing) {
        await env.DB.prepare(
          `INSERT INTO custom_field_defs (id, client_id, label, field_key, field_type, options, is_active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        ).bind(
          crypto.randomUUID(),
          body.client_id,
          field.name,
          field.key,
          field.type,
          field.options ? JSON.stringify(field.options) : null
        ).run();
        results.custom_fields++;
      } else {
        results.skipped++;
      }
    }
  }

  // ── 2. Email/SMS Templates ───────────────────────────────────
  if (snapshot.templates) {
    for (const tpl of snapshot.templates) {
      const existing = await env.DB.prepare(
        'SELECT id FROM email_templates WHERE name = ? AND client_id = ?'
      ).bind(tpl.name, body.client_id).first();

      if (!existing) {
        await env.DB.prepare(
          `INSERT INTO email_templates (id, client_id, name, channel, subject, body)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          body.client_id,
          tpl.name,
          tpl.channel || 'email',
          tpl.subject || '',
          tpl.body
        ).run();
        results.templates++;
      } else {
        results.skipped++;
      }
    }
  }

  // ── 3. Workflows ─────────────────────────────────────────────
  if (snapshot.workflows) {
    for (const wf of snapshot.workflows) {
      const existing = await env.DB.prepare(
        'SELECT id FROM workflows WHERE name = ? AND client_id = ?'
      ).bind(wf.name, body.client_id).first();

      if (!existing) {
        const wfId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO workflows (id, client_id, name, trigger_type, is_active)
           VALUES (?, ?, ?, ?, 0)`
        ).bind(wfId, body.client_id, wf.name, wf.trigger).run();

        // Insérer les étapes
        for (let i = 0; i < wf.steps.length; i++) {
          const step = wf.steps[i] as { type: string; delay_hours?: number; subject?: string; body?: string; title?: string; due_in_days?: number };
          const stepId = crypto.randomUUID();
          const config: Record<string, unknown> = {};

          if (step.type === 'wait') config.delay_minutes = (step.delay_hours || 1) * 60;
          if (step.type === 'email') { config.subject = step.subject; config.body = step.body; }
          if (step.type === 'sms') config.body = step.body;
          if (step.type === 'task') { config.title = step.title; config.due_in_days = step.due_in_days || 1; }

          await env.DB.prepare(
            `INSERT INTO workflow_steps (id, workflow_id, step_type, step_order, config)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(stepId, wfId, step.type, i + 1, JSON.stringify(config)).run();
        }
        results.workflows++;
      } else {
        results.skipped++;
      }
    }
  }

  // ── 4. Smart Lists ───────────────────────────────────────────
  if (snapshot.smart_lists) {
    for (const sl of snapshot.smart_lists) {
      const existing = await env.DB.prepare(
        'SELECT id FROM smart_lists WHERE name = ? AND client_id = ?'
      ).bind(sl.name, body.client_id).first();

      if (!existing) {
        await env.DB.prepare(
          `INSERT INTO smart_lists (id, client_id, name, filters, is_dynamic)
           VALUES (?, ?, ?, ?, 1)`
        ).bind(
          crypto.randomUUID(),
          body.client_id,
          sl.name,
          JSON.stringify(sl.filters)
        ).run();
        results.smart_lists++;
      } else {
        results.skipped++;
      }
    }
  }

  await audit(env, auth.userId, 'pack.install', 'client', body.client_id, {
    pack_slug: slug,
    pack_name: pack.name,
    ...results,
  });

  return json({
    data: {
      success: true,
      pack_name: pack.name,
      installed: results,
      message: `Pack "${pack.name}" installé avec succès : ${results.custom_fields} champs, ${results.templates} templates, ${results.workflows} workflows, ${results.smart_lists} listes.`,
    },
  }, 201);
}
