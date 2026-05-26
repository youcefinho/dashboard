// ── social-posts.ts — LOT SOCIAL PLANNER (Sprint 9) — NEUF (owned Manager-B)
//
// ⚠ État : corps réels Phase B (Manager-B). Signatures FIGÉES (worker.ts les
//   câble déjà). Imports worker RELATIFS.
//
// CRUD posts + planification. Capability EXISTANTE 'workflows.manage' (calque
// oauth.ts:capGuard / requireCapability — AUCUN ajout à ALL_CAPABILITIES).
// Bornage tenant STRICT : client_id depuis l'auth (JAMAIS le body), re-bornage
// sur PATCH/DELETE/schedule (calque oauth.ts:handleDeleteOauthConnection).
// Succès json({ data }) / erreur json({ error }, status) — JAMAIS de `code`.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import type { SocialPost, SocialProvider } from '../lib/types';

export type SocialAuth = CapAuth & { capabilities?: Set<string> };

// Statuts applicatifs (SANS CHECK en base — calque seq 109).
const POST_STATUSES = new Set(['draft', 'queued', 'processing', 'published', 'failed']);

// Garde capability (réutilise 'workflows.manage' — calque oauth.ts:capGuard).
function capGuard(auth: SocialAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// Résolution tenant STRICTE depuis l'auth (JAMAIS le body) — calque oauth.ts.
function tenantClientId(auth: SocialAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// Parse tolérant d'un tableau JSON (media_json / networks_json). Best-effort :
// une valeur corrompue dégrade en [] plutôt que de casser la sérialisation.
function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map((x) => String(x));
    return [];
  } catch {
    return [];
  }
}

// Mappe une ligne social_posts → SocialPost (désérialise media/networks).
function rowToPost(row: Record<string, unknown>): SocialPost {
  return {
    id: String(row.id),
    client_id: (row.client_id as string) ?? null,
    content: String(row.content ?? ''),
    media: parseJsonArray(row.media_json),
    networks: parseJsonArray(row.networks_json) as SocialProvider[],
    scheduled_at: (row.scheduled_at as string) ?? null,
    status: String(row.status ?? 'draft'),
    published_at: (row.published_at as string) ?? null,
    error: (row.error as string) ?? null,
    created_by: (row.created_by as string) ?? null,
    created_at: (row.created_at as string) ?? undefined,
    updated_at: (row.updated_at as string) ?? undefined,
  };
}

// ── GET /api/social/posts (PROTÉGÉ) — liste tenant-bornée ───────────────────
//    SELECT social_posts WHERE client_id = tenant (filtre ?status= optionnel),
//    ORDER BY scheduled_at/created_at DESC. media_json/networks_json → media[]/
//    networks[].
export async function handleListSocialPosts(
  _request: Request, env: Env, auth: SocialAuth, url: URL,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  const clientId = tenantClientId(auth);
  if (!clientId) return json({ data: [] });

  const status = url.searchParams.get('status');
  let query =
    `SELECT id, client_id, content, media_json, networks_json, scheduled_at,
            status, published_at, error, created_by, created_at, updated_at
       FROM social_posts
      WHERE client_id = ?`;
  const params: string[] = [clientId];
  if (status && POST_STATUSES.has(status)) {
    query += ' AND status = ?';
    params.push(status);
  }
  // Échéance d'abord (planning), puis création (brouillons sans échéance).
  query += " ORDER BY COALESCE(scheduled_at, created_at) DESC, created_at DESC LIMIT 200";

  try {
    const { results } = await env.DB.prepare(query).bind(...params).all();
    const posts = (results || []).map((r) => rowToPost(r as Record<string, unknown>));
    return json({ data: posts });
  } catch (err) {
    console.error('handleListSocialPosts: select failed', err);
    return json({ error: 'Échec lecture des posts' }, 500);
  }
}

// ── POST /api/social/posts (PROTÉGÉ) — créer un post (brouillon) ─────────────
//    INSERT social_posts (id=randomUUID, client_id DU TENANT, content,
//    media_json, networks_json, scheduled_at?, status='draft',
//    created_by=auth.userId). Bornage client_id serveur (jamais body).
export async function handleCreateSocialPost(
  request: Request, env: Env, auth: SocialAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  const clientId = tenantClientId(auth);
  if (!clientId) return json({ error: 'Tenant non résolu' }, 400);

  let body: {
    content?: string; media?: unknown; networks?: unknown; scheduled_at?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const content = sanitizeInput(body.content, 5000);
  if (!content) return json({ error: 'Contenu requis' }, 400);

  const media = Array.isArray(body.media) ? body.media.map((x) => String(x)) : [];
  const networks = Array.isArray(body.networks) ? body.networks.map((x) => String(x)) : [];
  const scheduledAt = typeof body.scheduled_at === 'string' && body.scheduled_at
    ? body.scheduled_at
    : null;

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO social_posts
         (id, client_id, content, media_json, networks_json, scheduled_at,
          status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, datetime('now'), datetime('now'))`,
    ).bind(
      id, clientId, content, JSON.stringify(media), JSON.stringify(networks),
      scheduledAt, auth.userId || null,
    ).run();
  } catch (err) {
    console.error('handleCreateSocialPost: insert failed', err);
    return json({ error: 'Échec création du post' }, 500);
  }

  return json({
    data: {
      id, client_id: clientId, content,
      media: media as string[], networks: networks as SocialProvider[],
      scheduled_at: scheduledAt, status: 'draft', published_at: null, error: null,
      created_by: auth.userId || null,
    } satisfies SocialPost,
  });
}

// ── PATCH /api/social/posts/:id (PROTÉGÉ) — re-borne tenant ─────────────────
//    UPDATE social_posts SET … WHERE id=? AND client_id = tenant (re-bornage
//    strict, 404 si hors tenant). updated_at=datetime('now').
export async function handleUpdateSocialPost(
  request: Request, env: Env, auth: SocialAuth, id: string,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  const clientId = tenantClientId(auth);
  if (!clientId) return json({ error: 'Post introuvable' }, 404);

  // RE-BORNAGE STRICT : charge le post, re-vérifie client_id (404 cross-tenant).
  const existing = (await env.DB.prepare(
    'SELECT id, client_id FROM social_posts WHERE id = ?',
  ).bind(id).first()) as { id: string; client_id: string | null } | null;
  if (!existing || existing.client_id !== clientId) {
    return json({ error: 'Post introuvable' }, 404);
  }

  let body: {
    content?: string; media?: unknown; networks?: unknown;
    scheduled_at?: string | null; status?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (typeof body.content === 'string') {
    sets.push('content = ?'); params.push(sanitizeInput(body.content, 5000));
  }
  if (Array.isArray(body.media)) {
    sets.push('media_json = ?'); params.push(JSON.stringify(body.media.map((x) => String(x))));
  }
  if (Array.isArray(body.networks)) {
    sets.push('networks_json = ?'); params.push(JSON.stringify(body.networks.map((x) => String(x))));
  }
  if (body.scheduled_at !== undefined) {
    sets.push('scheduled_at = ?');
    params.push(typeof body.scheduled_at === 'string' && body.scheduled_at ? body.scheduled_at : null);
  }
  if (typeof body.status === 'string' && POST_STATUSES.has(body.status)) {
    sets.push('status = ?'); params.push(body.status);
  }

  if (sets.length === 0) return json({ error: 'Aucune modification' }, 400);
  sets.push("updated_at = datetime('now')");

  try {
    await env.DB.prepare(
      `UPDATE social_posts SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
    ).bind(...params, id, clientId).run();
  } catch (err) {
    console.error('handleUpdateSocialPost: update failed', err);
    return json({ error: 'Échec mise à jour du post' }, 500);
  }

  const row = (await env.DB.prepare(
    `SELECT id, client_id, content, media_json, networks_json, scheduled_at,
            status, published_at, error, created_by, created_at, updated_at
       FROM social_posts WHERE id = ? AND client_id = ?`,
  ).bind(id, clientId).first()) as Record<string, unknown> | null;
  if (!row) return json({ error: 'Post introuvable' }, 404);
  return json({ data: rowToPost(row) });
}

// ── DELETE /api/social/posts/:id (PROTÉGÉ) — re-borne tenant ────────────────
//    Charge le post, re-vérifie client_id (404 sinon), DELETE WHERE id=? AND
//    client_id=? (calque handleDeleteOauthConnection).
export async function handleDeleteSocialPost(
  _request: Request, env: Env, auth: SocialAuth, id: string,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  const clientId = tenantClientId(auth);
  if (!clientId) return json({ error: 'Post introuvable' }, 404);

  const row = (await env.DB.prepare(
    'SELECT id, client_id FROM social_posts WHERE id = ?',
  ).bind(id).first()) as { id: string; client_id: string | null } | null;
  if (!row || row.client_id !== clientId) {
    return json({ error: 'Post introuvable' }, 404);
  }

  try {
    await env.DB.prepare('DELETE FROM social_posts WHERE id = ? AND client_id = ?')
      .bind(id, clientId).run();
  } catch (err) {
    console.error('handleDeleteSocialPost: delete failed', err);
    return json({ error: 'Échec suppression du post' }, 500);
  }
  return json({ data: { deleted: true } });
}

// ── POST /api/social/posts/:id/schedule (PROTÉGÉ) — planifier ───────────────
//    UPDATE social_posts SET scheduled_at=?, status='queued' WHERE id=? AND
//    client_id = tenant (re-bornage). Le cron de publication (social-publish.ts)
//    prendra le relais à l'échéance.
export async function handleScheduleSocialPost(
  request: Request, env: Env, auth: SocialAuth, id: string,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  const clientId = tenantClientId(auth);
  if (!clientId) return json({ error: 'Post introuvable' }, 404);

  let body: { scheduled_at?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }
  const scheduledAt = typeof body.scheduled_at === 'string' && body.scheduled_at
    ? body.scheduled_at
    : null;
  if (!scheduledAt) return json({ error: 'Date de planification requise' }, 400);

  // RE-BORNAGE STRICT : 404 si hors tenant.
  const existing = (await env.DB.prepare(
    'SELECT id, client_id FROM social_posts WHERE id = ?',
  ).bind(id).first()) as { id: string; client_id: string | null } | null;
  if (!existing || existing.client_id !== clientId) {
    return json({ error: 'Post introuvable' }, 404);
  }

  try {
    await env.DB.prepare(
      `UPDATE social_posts
          SET scheduled_at = ?, status = 'queued', updated_at = datetime('now')
        WHERE id = ? AND client_id = ?`,
    ).bind(scheduledAt, id, clientId).run();
  } catch (err) {
    console.error('handleScheduleSocialPost: update failed', err);
    return json({ error: 'Échec planification du post' }, 500);
  }

  const row = (await env.DB.prepare(
    `SELECT id, client_id, content, media_json, networks_json, scheduled_at,
            status, published_at, error, created_by, created_at, updated_at
       FROM social_posts WHERE id = ? AND client_id = ?`,
  ).bind(id, clientId).first()) as Record<string, unknown> | null;
  if (!row) return json({ error: 'Post introuvable' }, 404);
  return json({ data: rowToPost(row) });
}
