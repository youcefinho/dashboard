import type { Env } from './types';
import { json } from './helpers';

export interface PublicAuthContext {
  clientId: string;
  userId: string;
  scopes: string[];
}

export async function requireApiKey(request: Request, env: Env): Promise<Response | PublicAuthContext> {
  const authHeader = request.headers.get('Authorization');
  const customHeader = request.headers.get('X-Intralys-Key');
  
  let token = customHeader;
  
  if (!token && authHeader) {
    if (authHeader.startsWith('ApiKey ')) {
      token = authHeader.replace('ApiKey ', '').trim();
    } else if (authHeader.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '').trim();
    }
  }

  if (!token) {
    return json({ error: 'Clé API manquante. Utilisez le header Authorization: ApiKey <token>' }, 401);
  }

  // Hash de la clé reçue avec le même algorithme que la création
  const keyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

  // Chercher la clé dans la base de données
  const { results } = await env.DB.prepare(
    "SELECT id, client_id, user_id, scopes FROM api_keys WHERE key_hash = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).bind(keyHash).all();

  if (!results || results.length === 0) {
    return json({ error: 'Clé API invalide ou expirée' }, 401);
  }

  const apiKey = results[0] as { id: string; client_id: string; user_id: string; scopes: string };
  const scopes = apiKey.scopes ? apiKey.scopes.split(',').map(s => s.trim()) : [];

  // Mettre à jour last_used_at en background (fire and forget)
  try {
    const updateReq = env.DB.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").bind(apiKey.id).run();
    // Utiliser context.waitUntil si on avait le ctx, mais ici on le lance juste
    // Le mieux est de ne pas await ou si on await, ça ajoute de la latence
    // On l'await silencieusement (TODO: ctx.waitUntil)
    await updateReq;
  } catch (e) {
    // Ignore error
  }

  // Rate Limiting (Simple 1000 req/h) - Requiert KV
  if (env.RATE_LIMITER) {
    try {
      const now = new Date();
      const hourKey = `rate:${apiKey.id}:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
      
      const current = await env.RATE_LIMITER.get(hourKey);
      const count = current ? parseInt(current, 10) : 0;
      
      if (count >= 1000) {
        return json({ error: 'Rate limit exceeded (1000 req/hour)' }, 429);
      }
      
      await env.RATE_LIMITER.put(hourKey, (count + 1).toString(), { expirationTtl: 3600 });
    } catch (e) {
      // Si KV échoue, on ne bloque pas l'API
    }
  }

  return {
    clientId: apiKey.client_id,
    userId: apiKey.user_id,
    scopes
  };
}

export function requireScope(auth: PublicAuthContext, requiredScope: string): Response | null {
  if (auth.scopes.includes('admin')) return null; // L'admin a tous les droits
  
  if (!auth.scopes.includes(requiredScope)) {
    return json({ error: `Scope insuffisant. Requis: ${requiredScope}` }, 403);
  }
  return null;
}
