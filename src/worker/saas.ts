import type { Env } from './types';
import { json, sanitizeInput } from './helpers';

export async function handleGetAgencies(
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Non autorisé' }, 403);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM agencies ORDER BY created_at DESC'
  ).all();

  return json({ data: results || [] });
}

export async function handleCreateAgency(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Non autorisé' }, 403);
  }

  const body = await request.json() as { name: string; custom_domain?: string };
  const name = sanitizeInput(body.name, 100);
  const customDomain = sanitizeInput(body.custom_domain || '', 100);

  if (!name) {
    return json({ error: 'Nom requis' }, 400);
  }

  const agencyId = `ag_${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT INTO agencies (id, name, owner_id, custom_domain) VALUES (?, ?, ?, ?)`
  ).bind(agencyId, name, auth.userId, customDomain || null).run();

  return json({ data: { id: agencyId } }, 201);
}
