// ── Module Properties (Centris Sync) — Intralys CRM ────────
import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';

export async function handleGetProperties(request: Request, env: Env, auth: { role: string; clientId?: string }): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') || auth.clientId;

  if (auth.role !== 'admin' && clientId !== auth.clientId) {
    return json({ error: 'Accès refusé' }, 403);
  }

  let query = 'SELECT * FROM properties WHERE 1=1';
  const params: string[] = [];

  if (clientId) {
    query += ' AND client_id = ?';
    params.push(clientId);
  }

  const status = url.searchParams.get('status');
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT 50';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return json({ data: results || [] });
}

export async function handleSyncCentris(request: Request, env: Env, auth: { userId: string; role: string; clientId?: string }): Promise<Response> {
  const body = await request.json() as any;
  const mlsNumber = sanitizeInput(body.mls_number);
  const clientId = body.client_id || auth.clientId;

  if (auth.role !== 'admin' && clientId !== auth.clientId) {
    return json({ error: 'Accès refusé' }, 403);
  }

  if (!mlsNumber) {
    return json({ error: 'Numéro MLS requis' }, 400);
  }

  // --- MOCK SYNC CENTRIS ---
  // Dans un vrai scénario, on ferait un fetch vers une API Centris ou on parserait une page via Puppeteer
  const isMockSuccess = Math.random() > 0.2; // 80% de succès

  if (!isMockSuccess) {
    return json({ error: 'Propriété introuvable sur Centris ou numéro invalide.' }, 404);
  }

  const mockProperty = {
    title: `Maison unifamiliale à vendre - MLS ${mlsNumber}`,
    description: 'Magnifique propriété fraîchement rénovée avec grand terrain paysager.',
    price: Math.floor(Math.random() * 500000) + 300000,
    address: '123 Rue Fictive',
    city: 'Montréal',
    property_type: 'Maison',
    bedrooms: Math.floor(Math.random() * 3) + 2,
    bathrooms: Math.floor(Math.random() * 2) + 1,
    area_sqft: Math.floor(Math.random() * 1000) + 1000,
    year_built: Math.floor(Math.random() * 50) + 1970,
    image_url: `https://picsum.photos/seed/${mlsNumber}/800/600`,
    status: 'active'
  };

  // Upsert
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO properties (
      id, client_id, mls_number, title, description, price, address, city, 
      property_type, status, bedrooms, bathrooms, area_sqft, year_built, 
      image_url, sync_source, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'centris', datetime('now'))
    ON CONFLICT(id) DO UPDATE SET -- fallback logic
      title = excluded.title, price = excluded.price, status = excluded.status, synced_at = excluded.synced_at
  `).bind(
    id, clientId, mlsNumber, mockProperty.title, mockProperty.description, mockProperty.price,
    mockProperty.address, mockProperty.city, mockProperty.property_type, mockProperty.status,
    mockProperty.bedrooms, mockProperty.bathrooms, mockProperty.area_sqft, mockProperty.year_built,
    mockProperty.image_url
  ).run();

  await audit(env, auth.userId, 'centris.sync', 'property', mlsNumber, { client_id: clientId });

  return json({ data: { success: true, property: { ...mockProperty, id, mls_number: mlsNumber } } }, 201);
}

export async function handleDeleteProperty(env: Env, auth: { role: string; clientId?: string }, propertyId: string): Promise<Response> {
  const property = await env.DB.prepare('SELECT client_id FROM properties WHERE id = ?').bind(propertyId).first() as { client_id: string } | null;
  if (!property) return json({ error: 'Introuvable' }, 404);

  if (auth.role !== 'admin' && property.client_id !== auth.clientId) {
    return json({ error: 'Accès refusé' }, 403);
  }

  await env.DB.prepare('DELETE FROM properties WHERE id = ?').bind(propertyId).run();
  return json({ data: { success: true } });
}
