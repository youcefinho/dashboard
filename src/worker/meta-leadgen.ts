// ── Sprint 51 M1 — Meta / Google Lead Ads ingestion ─────────────
// Receiver Meta Lead Ads (leadgen) + Google Lead Form + CRUD connexions.
// Réutilise la logique lead canonique (dédoublonnage email+client) sans la
// dupliquer, et garantit l'idempotence via leads.external_id.

import type { Env } from './types';
import { sanitizeInput, json, audit, createNotification } from './helpers';

// ── Vérification signature HMAC SHA-256 (Meta X-Hub-Signature-256) ──
// Timing-safe via crypto.subtle.verify. Si secret absent → null (caller
// décide de logger un warn et continuer pour ne pas casser le flow legacy).
export async function verifyMetaSignature(
  env: Env,
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean | null> {
  const secret = env.META_APP_SECRET;
  if (!secret) return null; // pas de secret configuré → vérif impossible
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expectedHex = signatureHeader.slice('sha256='.length).trim();
  // hex → Uint8Array
  if (expectedHex.length % 2 !== 0) return false;
  const sigBytes = new Uint8Array(expectedHex.length / 2);
  for (let i = 0; i < sigBytes.length; i++) {
    const byte = parseInt(expectedHex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return false;
    sigBytes[i] = byte;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  // crypto.subtle.verify est constant-time → safe contre timing attacks
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(rawBody));
}

// ── Helper canonique d'ingestion d'un lead externe ──────────────
// Dédoublonnage : (1) idempotence stricte sur external_id (retry webhook),
// (2) dédup email+client_id (logique alignée sur handleCreateLead).
type IngestInput = {
  clientId: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  source: string;
  externalId: string;
  gclid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

async function ingestExternalLead(
  env: Env,
  input: IngestInput
): Promise<{ id: string; duplicate: boolean }> {
  const clientId = sanitizeInput(input.clientId, 100);
  const name = sanitizeInput(input.name || '', 100) || 'Lead sans nom';
  const email = sanitizeInput(input.email || '', 255).toLowerCase();
  const phone = sanitizeInput(input.phone || '', 30);
  const message = sanitizeInput(input.message || '', 2000);
  const source = sanitizeInput(input.source, 50);
  const externalId = sanitizeInput(input.externalId, 120);
  const gclid = sanitizeInput(input.gclid || '', 255);

  // (1) Idempotence stricte : ce leadgen_id / lead_id a déjà été ingéré ?
  if (externalId) {
    const dup = await env.DB.prepare(
      'SELECT id FROM leads WHERE external_id = ? AND client_id = ?'
    ).bind(externalId, clientId).first() as { id: string } | null;
    if (dup) return { id: dup.id, duplicate: true };
  }

  // (2) Dédoublonnage email + client (même règle que handleCreateLead)
  if (email) {
    const existing = await env.DB.prepare(
      'SELECT id FROM leads WHERE LOWER(email) = ? AND client_id = ?'
    ).bind(email, clientId).first() as { id: string } | null;
    if (existing) return { id: existing.id, duplicate: true };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO leads
       (id, client_id, name, email, phone, type, source, message, status, score,
        external_id, migrated_from, gclid, utm_source, utm_medium, utm_campaign,
        pipeline_id, stage_id)
     VALUES (?, ?, ?, ?, ?, 'inbound', ?, ?, 'new', 35,
        ?, ?, ?, ?, ?, ?, 'pipeline-default', 'stage-new')`
  ).bind(
    id, clientId, name, email, phone, source, message,
    externalId || null, source, gclid || null,
    sanitizeInput(input.utmSource || '', 100),
    sanitizeInput(input.utmMedium || '', 100),
    sanitizeInput(input.utmCampaign || '', 100)
  ).run();

  await audit(env, id, 'created', `Lead reçu via ${source}`, '');
  try {
    await createNotification(
      env, '', 'Nouveau lead', `${name} via ${source}`, '🎯', `/leads/${id}`, clientId
    );
  } catch { /* best-effort */ }

  return { id, duplicate: false };
}

// ── Mapping field_data → champs Lead ────────────────────────────
// Heuristique par défaut + override via field_mapping (JSON connexion).
function mapFields(
  pairs: Array<{ name: string; value: string }>,
  mapping: Record<string, string> | null
): { name: string; email: string; phone: string; message: string } {
  const out = { name: '', email: '', phone: '', message: '' };
  let firstName = '';
  let lastName = '';

  for (const { name: rawKey, value } of pairs) {
    if (!value) continue;
    const key = rawKey.toLowerCase().trim();

    // 1. Mapping explicite de la connexion (clé source → champ Lead)
    if (mapping && mapping[rawKey]) {
      const target = mapping[rawKey];
      if (target === 'name' || target === 'email' || target === 'phone' || target === 'message') {
        out[target] = out[target] ? `${out[target]} ${value}` : value;
        continue;
      }
    }

    // 2. Heuristique sur les noms de champs Meta/Google standards
    if (key === 'email' || key.includes('email') || key.includes('courriel')) {
      out.email ||= value;
    } else if (key === 'full_name' || key === 'name' || key === 'nom' || key === 'nom_complet') {
      out.name ||= value;
    } else if (key === 'first_name' || key === 'prenom' || key === 'prénom' || key === 'given_name') {
      firstName ||= value;
    } else if (key === 'last_name' || key === 'nom_de_famille' || key === 'family_name') {
      lastName ||= value;
    } else if (key.includes('phone') || key.includes('telephone') || key.includes('téléphone') || key.includes('mobile')) {
      out.phone ||= value;
    } else if (key.includes('message') || key.includes('comment') || key.includes('question') || key.includes('besoin')) {
      out.message = out.message ? `${out.message}\n${value}` : value;
    } else {
      // Champ custom non mappé → on l'ajoute au message pour ne rien perdre
      out.message = out.message ? `${out.message}\n${rawKey}: ${value}` : `${rawKey}: ${value}`;
    }
  }

  if (!out.name) {
    out.name = [firstName, lastName].filter(Boolean).join(' ').trim();
  }
  return out;
}

// ── M1.1 — Traitement d'un évènement leadgen Meta ───────────────
// Appelé depuis handleMetaWebhook quand entry.changes[].field === 'leadgen'.
export async function processMetaLeadgen(
  env: Env,
  pageId: string,
  change: { leadgen_id?: string; form_id?: string; page_id?: string }
): Promise<void> {
  const leadgenId = change.leadgen_id;
  if (!leadgenId) return;

  const conn = await env.DB.prepare(
    'SELECT client_id, page_access_token, field_mapping, form_ids, active FROM meta_lead_connections WHERE page_id = ? AND active = 1'
  ).bind(pageId).first() as {
    client_id: string;
    page_access_token: string;
    field_mapping: string | null;
    form_ids: string | null;
    active: number;
  } | null;
  if (!conn) {
    console.warn(`[meta-leadgen] Aucune connexion active pour page_id=${pageId}`);
    return;
  }

  // Filtre optionnel par form_id
  if (conn.form_ids) {
    try {
      const allowed = JSON.parse(conn.form_ids) as string[];
      if (Array.isArray(allowed) && allowed.length > 0 && change.form_id && !allowed.includes(change.form_id)) {
        return; // form non suivi par cette connexion
      }
    } catch { /* form_ids invalide → on ignore le filtre */ }
  }

  let pairs: Array<{ name: string; value: string }> = [];
  if (env.USE_MOCKS === 'true') {
    pairs = [
      { name: 'full_name', value: 'Lead Test Meta' },
      { name: 'email', value: `meta-${leadgenId}@example.com` },
      { name: 'phone_number', value: '+1 819 555-0142' },
    ];
  } else {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${encodeURIComponent(conn.page_access_token)}`
    );
    const data = await res.json() as {
      field_data?: Array<{ name: string; values: string[] }>;
      error?: { message: string };
    };
    if (data.error) {
      console.error(`[meta-leadgen] Graph API error: ${data.error.message}`);
      return;
    }
    pairs = (data.field_data || []).map(f => ({ name: f.name, value: (f.values || [])[0] || '' }));
  }

  let mapping: Record<string, string> | null = null;
  try { mapping = conn.field_mapping ? JSON.parse(conn.field_mapping) : null; } catch { mapping = null; }

  const mapped = mapFields(pairs, mapping);
  await ingestExternalLead(env, {
    clientId: conn.client_id,
    name: mapped.name,
    email: mapped.email,
    phone: mapped.phone,
    message: mapped.message,
    source: 'meta_lead_ads',
    externalId: leadgenId,
    utmSource: 'facebook',
    utmMedium: 'paid_social',
  });
}

// ── M1.3 — Receiver Google Lead Form ────────────────────────────
export async function handleGoogleLeadForm(request: Request, env: Env): Promise<Response> {
  let body: {
    lead_id?: string;
    user_column_data?: Array<{ column_id: string; string_value: string }>;
    google_key?: string;
    gclid?: string;
    campaign_id?: string;
  };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const googleKey = String(body.google_key || '');
  if (!googleKey) return json({ error: 'google_key manquant' }, 401);

  const conn = await env.DB.prepare(
    'SELECT client_id, field_mapping, active FROM google_lead_connections WHERE webhook_key = ? AND active = 1'
  ).bind(googleKey).first() as {
    client_id: string;
    field_mapping: string | null;
    active: number;
  } | null;
  if (!conn) return json({ error: 'google_key invalide' }, 401);

  const leadId = String(body.lead_id || '');
  const pairs = (body.user_column_data || []).map(c => ({
    name: c.column_id, value: c.string_value || '',
  }));

  let mapping: Record<string, string> | null = null;
  try { mapping = conn.field_mapping ? JSON.parse(conn.field_mapping) : null; } catch { mapping = null; }

  const mapped = mapFields(pairs, mapping);
  const result = await ingestExternalLead(env, {
    clientId: conn.client_id,
    name: mapped.name,
    email: mapped.email,
    phone: mapped.phone,
    message: mapped.message,
    source: 'google_lead_form',
    externalId: leadId,
    gclid: body.gclid ? String(body.gclid) : undefined,
    utmSource: 'google',
    utmMedium: 'paid_search',
    utmCampaign: body.campaign_id ? String(body.campaign_id) : undefined,
  });

  return json({ success: true, id: result.id, duplicate: result.duplicate }, 200);
}

// ── M1.2 — CRUD connexions Meta Lead Ads / Google Lead Form ─────
function requireAdmin(auth: { role: string }): Response | null {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  return null;
}

export async function handleListLeadConnections(
  env: Env, auth: { role: string }
): Promise<Response> {
  const err = requireAdmin(auth); if (err) return err;

  const meta = await env.DB.prepare(
    `SELECT id, client_id, page_id, page_name, form_ids, field_mapping, active, created_at
     FROM meta_lead_connections ORDER BY created_at DESC`
  ).all();
  const google = await env.DB.prepare(
    `SELECT id, client_id, webhook_key, label, field_mapping, active, created_at
     FROM google_lead_connections ORDER BY created_at DESC`
  ).all();

  return json({ data: { meta: meta.results || [], google: google.results || [] } });
}

export async function handleCreateLeadConnection(
  request: Request, env: Env, auth: { role: string; userId: string }
): Promise<Response> {
  const err = requireAdmin(auth); if (err) return err;

  const body = await request.json() as Record<string, unknown>;
  const provider = String(body.provider || '');
  const clientId = sanitizeInput(String(body.client_id || ''), 100);
  if (!clientId) return json({ error: 'client_id requis' }, 400);

  const client = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return json({ error: 'Client introuvable' }, 404);

  const fieldMapping = body.field_mapping ? JSON.stringify(body.field_mapping) : null;

  if (provider === 'meta') {
    const pageId = sanitizeInput(String(body.page_id || ''), 80);
    const token = String(body.page_access_token || '').trim();
    if (!pageId || !token) return json({ error: 'page_id et page_access_token requis' }, 400);
    const pageName = sanitizeInput(String(body.page_name || ''), 120);
    const formIds = body.form_ids ? JSON.stringify(body.form_ids) : null;

    // Upsert par page_id (une connexion par page)
    const existing = await env.DB.prepare(
      'SELECT id FROM meta_lead_connections WHERE page_id = ?'
    ).bind(pageId).first() as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        `UPDATE meta_lead_connections
         SET client_id = ?, page_name = ?, page_access_token = ?, form_ids = ?, field_mapping = ?, active = 1
         WHERE id = ?`
      ).bind(clientId, pageName, token, formIds, fieldMapping, existing.id).run();
      await audit(env, auth.userId, 'meta_lead_conn.update', 'integration', existing.id, { pageId });
      return json({ data: { id: existing.id, updated: true } });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO meta_lead_connections
         (id, client_id, page_id, page_name, page_access_token, form_ids, field_mapping, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(id, clientId, pageId, pageName, token, formIds, fieldMapping).run();
    await audit(env, auth.userId, 'meta_lead_conn.create', 'integration', id, { pageId });
    return json({ data: { id } }, 201);
  }

  if (provider === 'google') {
    const webhookKey = String(body.webhook_key || '').trim();
    if (!webhookKey) return json({ error: 'webhook_key requis' }, 400);
    const label = sanitizeInput(String(body.label || ''), 120);

    const existing = await env.DB.prepare(
      'SELECT id FROM google_lead_connections WHERE webhook_key = ?'
    ).bind(webhookKey).first() as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        `UPDATE google_lead_connections
         SET client_id = ?, label = ?, field_mapping = ?, active = 1 WHERE id = ?`
      ).bind(clientId, label, fieldMapping, existing.id).run();
      await audit(env, auth.userId, 'google_lead_conn.update', 'integration', existing.id, {});
      return json({ data: { id: existing.id, updated: true } });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO google_lead_connections
         (id, client_id, webhook_key, label, field_mapping, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).bind(id, clientId, webhookKey, label, fieldMapping).run();
    await audit(env, auth.userId, 'google_lead_conn.create', 'integration', id, {});
    return json({ data: { id } }, 201);
  }

  return json({ error: "provider doit être 'meta' ou 'google'" }, 400);
}

export async function handleDeleteLeadConnection(
  env: Env, auth: { role: string; userId: string }, provider: string, id: string
): Promise<Response> {
  const err = requireAdmin(auth); if (err) return err;

  const table = provider === 'meta' ? 'meta_lead_connections'
    : provider === 'google' ? 'google_lead_connections' : null;
  if (!table) return json({ error: 'provider invalide' }, 400);

  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  await audit(env, auth.userId, `${provider}_lead_conn.delete`, 'integration', id, {});
  return json({ data: { success: true } });
}
