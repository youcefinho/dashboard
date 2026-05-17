import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';

// S4 M3 — acteur de l'audit dérivé du header X-User-Id (convention de ce fichier),
// fallback 'system'. Purement additif : ne change ni la logique métier ni les réponses.
// ⚠ Loi 25 : `details` ne contient JAMAIS de secret brut (clé API / whsec / hash).
function auditActor(request: Request): string {
  return request.headers.get('X-User-Id') || 'system';
}

// ── User Preferences ────────────────────────────────────────

export async function handleGetPreferences(request: Request, env: Env): Promise<Response> {
  const user_id = request.headers.get('X-User-Id') || '1'; // Mock Auth
  
  const { results } = await env.DB.prepare('SELECT * FROM user_preferences WHERE user_id = ?').bind(user_id).all();
  const pref = results && results.length > 0 ? results[0] : { notification_preferences_json: '{}', ui_density: 'comfortable', language: 'fr', weekly_digest: 1 };
  
  return json({ data: pref });
}

export async function handleUpdatePreferences(request: Request, env: Env): Promise<Response> {
  const user_id = request.headers.get('X-User-Id') || '1'; // Mock Auth
  const body = await request.json() as any;

  await env.DB.prepare(`
    INSERT INTO user_preferences (user_id, notification_preferences_json, ui_density, language, weekly_digest, quiet_hours_start, quiet_hours_end)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      notification_preferences_json = excluded.notification_preferences_json,
      ui_density = excluded.ui_density,
      language = excluded.language,
      weekly_digest = excluded.weekly_digest,
      quiet_hours_start = excluded.quiet_hours_start,
      quiet_hours_end = excluded.quiet_hours_end
  `).bind(
    user_id,
    JSON.stringify(body.notification_preferences || {}),
    body.ui_density || 'comfortable',
    body.language || 'fr',
    body.weekly_digest === false ? 0 : 1,
    body.quiet_hours_start || null,
    body.quiet_hours_end || null
  ).run();

  return json({ data: { success: true } });
}

// ── Active Sessions ────────────────────────────────────────

export async function handleUpdateClientCompliance(request: Request, env: Env, auth: { role: string; clientId?: string }): Promise<Response> {
  const body = await request.json() as any;
  const amf_certificate = sanitizeInput(body.amf_certificate || '');
  const amf_disclaimer_required = body.amf_disclaimer_required ? 1 : 0;
  
  if (auth.role !== 'admin' && !auth.clientId) {
    return json({ error: 'Non autorisé' }, 403);
  }
  
  // Si admin, on peut passer un client_id dans le body, sinon on prend celui de l'auth
  const targetClientId = (auth.role === 'admin' && body.client_id) ? sanitizeInput(body.client_id) : auth.clientId;
  
  if (!targetClientId) {
    return json({ error: 'Client ID requis' }, 400);
  }

  // S'assurer que les colonnes existent
  try {
    await env.DB.prepare('ALTER TABLE clients ADD COLUMN amf_certificate TEXT DEFAULT ""').run();
    await env.DB.prepare('ALTER TABLE clients ADD COLUMN amf_disclaimer_required INTEGER DEFAULT 0').run();
  } catch { /* Colonnes existent déjà */ }

  await env.DB.prepare(
    'UPDATE clients SET amf_certificate = ?, amf_disclaimer_required = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(amf_certificate, amf_disclaimer_required, targetClientId).run();

  // Traçabilité conformité AMF (config courtier, non-régulé paiement E4/E6).
  // Pas de valeur de certificat dans details — métadonnée booléenne seulement.
  await audit(env, auditActor(request), 'compliance.update', 'client', targetClientId, {
    amf_disclaimer_required,
    has_certificate: !!amf_certificate,
  });
  return json({ data: { success: true } });
}

export async function handleGetClientCompliance(request: Request, env: Env, auth: { role: string; clientId?: string }): Promise<Response> {
  const url = new URL(request.url);
  let targetClientId = url.searchParams.get('client_id');
  
  if (!targetClientId) {
    targetClientId = auth.clientId || null;
  }
  
  if (auth.role !== 'admin' && targetClientId !== auth.clientId) {
    return json({ error: 'Non autorisé' }, 403);
  }
  
  if (!targetClientId) {
    return json({ error: 'Client ID requis' }, 400);
  }

  try {
    const { results } = await env.DB.prepare('SELECT amf_certificate, amf_disclaimer_required FROM clients WHERE id = ?').bind(targetClientId).all();
    if (!results || results.length === 0) return json({ error: 'Client introuvable' }, 404);
    
    return json({ data: results[0] });
  } catch (err) {
    // Si la table n'a pas les colonnes, on retourne vide
    return json({ data: { amf_certificate: '', amf_disclaimer_required: 0 } });
  }
}


// ── Sessions ──────────────────────────────────────────────
// Note : handleGetSessions + handleDeleteSession sont définis dans worker/auth.ts
// (Sprint 12 D.1 — filtrage user_id, flag is_current, vraie clé token).
// Les anciennes versions ici étaient des stubs Sprint 8 cassés (LIMIT 5 sans filtre,
// DELETE WHERE id = ? sur une colonne inexistante). Supprimés pour éviter la collision
// d'imports dans worker.ts. Les routes /api/settings/sessions/* sont reroutées sur
// les handlers auth.ts.

// ── API Keys ───────────────────────────────────────────────

export async function handleGetApiKeys(request: Request, env: Env): Promise<Response> {
  const client_id = request.headers.get('X-Client-Id');
  if (!client_id) return json({ error: 'Missing Client ID' }, 400);

  const { results } = await env.DB.prepare('SELECT id, name, scopes, last_used_at, created_at FROM api_keys WHERE client_id = ?').bind(client_id).all();
  return json({ data: results || [] });
}

export async function handleCreateApiKey(request: Request, env: Env): Promise<Response> {
  const client_id = request.headers.get('X-Client-Id');
  const user_id = request.headers.get('X-User-Id') || '1';
  if (!client_id) return json({ error: 'Missing Client ID' }, 400);

  const body = await request.json() as any;
  const name = sanitizeInput(body.name) || 'Unnamed Key';
  const scopes = sanitizeInput(body.scopes) || 'read';

  // Générer une clé "ILYS_..."
  const rawKey = `ILYS_${crypto.randomUUID().replace(/-/g, '')}`;
  // Hacher la clé (Mock PBKDF2 / SHA256 pour MVP)
  const keyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO api_keys (id, client_id, user_id, name, key_hash, scopes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, client_id, user_id, name, keyHash, scopes).run();

  // Audit : id/label/scope seulement — JAMAIS rawKey ni keyHash (Loi 25).
  await audit(env, auditActor(request), 'apikey.create', 'api_key', id, { name, scopes, client_id });
  // Ne retourne la rawKey qu'une seule fois !
  return json({ data: { id, name, key: rawKey, scopes } }, 201);
}

export async function handleRevokeApiKey(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const keyId = url.pathname.split('/').pop() || '';
  
  await env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(keyId).run();
  await audit(env, auditActor(request), 'apikey.revoke', 'api_key', keyId);
  return json({ data: { success: true } });
}

// ── Webhooks OUT ──────────────────────────────────────────

export async function handleGetWebhooks(request: Request, env: Env): Promise<Response> {
  const client_id = request.headers.get('X-Client-Id');
  if (!client_id) return json({ error: 'Missing Client ID' }, 400);

  const { results } = await env.DB.prepare('SELECT id, url, events, is_active, last_triggered_at, fail_count, created_at FROM webhook_subscriptions WHERE client_id = ?').bind(client_id).all();
  return json({ data: results || [] });
}

export async function handleCreateWebhook(request: Request, env: Env): Promise<Response> {
  const client_id = request.headers.get('X-Client-Id');
  if (!client_id) return json({ error: 'Missing Client ID' }, 400);

  const body = await request.json() as any;
  const url = sanitizeInput(body.url);
  const events = sanitizeInput(body.events);
  
  if (!url || !url.startsWith('https://')) return json({ error: 'Invalid HTTPS URL' }, 400);

  const id = crypto.randomUUID();
  const secret = `whsec_${crypto.randomUUID().replace(/-/g, '')}`;

  await env.DB.prepare(
    'INSERT INTO webhook_subscriptions (id, client_id, url, events, secret) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, client_id, url, events, secret).run();

  // Audit : url/events/id seulement — JAMAIS le secret whsec_ (Loi 25).
  await audit(env, auditActor(request), 'webhook.create', 'webhook', id, { url, events, client_id });
  return json({ data: { id, url, events, secret } }, 201);
}

export async function handleDeleteWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const webhookId = url.pathname.split('/').pop() || '';

  await env.DB.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').bind(webhookId).run();
  await audit(env, auditActor(request), 'webhook.delete', 'webhook', webhookId);
  return json({ data: { success: true } });
}

export async function handleGetWebhookDeliveries(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const webhookId = url.pathname.split('/')[4]; // /api/settings/webhooks/:id/deliveries
  
  const { results } = await env.DB.prepare(
    'SELECT * FROM webhook_deliveries WHERE subscription_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(webhookId).all();
  
  return json({ data: results || [] });
}

export async function handleTestWebhook(request: Request, env: Env): Promise<Response> {
  // webhookId is in url.pathname.split('/')[4] if needed, but we just trigger an event for the client.
  
  const client_id = request.headers.get('X-Client-Id');
  if (!client_id) return json({ error: 'Missing Client ID' }, 400);

  try {
    const { publishEvent } = await import('./webhooks-dispatch');
    publishEvent(env, client_id, 'test.event', { message: 'This is a test event from Intralys CRM' });
    return json({ data: { success: true } });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Zapier App Webhooks (Public API) ────────────────────────
export async function handlePublicCreateWebhook(request: Request, env: Env, clientId: string): Promise<Response> {
  const body = await request.json() as any;
  const url = sanitizeInput(body.url);
  const events = sanitizeInput(body.events) || '*';
  
  if (!url || !url.startsWith('https://')) return json({ error: 'Invalid HTTPS URL' }, 400);

  const id = crypto.randomUUID();
  const secret = `whsec_${crypto.randomUUID().replace(/-/g, '')}`;

  await env.DB.prepare(
    'INSERT INTO webhook_subscriptions (id, client_id, url, events, secret) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, clientId, url, events, secret).run();

  // Acteur = clientId authentifié (API publique Zapier). Pas de secret dans details.
  await audit(env, clientId, 'webhook.create', 'webhook', id, { url, events, source: 'public_api' });
  return json({ data: { id, url, events, secret } }, 201);
}

export async function handlePublicDeleteWebhook(env: Env, clientId: string, webhookId: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM webhook_subscriptions WHERE id = ? AND client_id = ?').bind(webhookId, clientId).run();
  await audit(env, clientId, 'webhook.delete', 'webhook', webhookId, { source: 'public_api' });
  return json({ data: { success: true } });
}
