// ── Sprint 44 — funnels-builder.ts — Handlers REST Funnels Builder (PHASE B) ─
//
// 17 handlers : 14 AUTHED CRUD/analytics + 3 PUBLIC (track-view, track-conversion,
// render). Routes câblées dans `src/worker.ts` :
//   - PUBLIC (pré-requireAuth, honeypot + rate-limit) :
//       POST /api/public/funnels/track-view
//       POST /api/public/funnels/track-conversion
//       GET  /api/public/funnels/:slug/render?step=N&variant=A
//   - AUTHED (cap settings.manage, après bloc S43 ~l.3157) :
//       /api/funnels-builder (+/:id + /publish + /steps + /steps/:id +
//       /steps/:id/variants + /variants/:id + /:id/analytics)
//
// ⚠ DISTINCT de `funnels.ts` (LOT FUNNEL S1, seq83 — `/api/funnels/*` legacy
//   + `/api/p/:slug/*` PUBLIC). Sprint 44 = MODULE NEUF (tables `fb_*` seq139,
//   alias TS Funnel/FunnelStep/FunnelStepVariant). Voir docs/LOT-FUNNELS-S44.md.
//
// Contrats GELÉS (docs/LOT-FUNNELS-S44.md §6) :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)   ← JAMAIS de champ `code`
//   - imports RELATIFS uniquement (`./types`, `../lib/api`)
//   - capabilities : `settings.manage` (admin) — ZÉRO ajout à ALL_CAPABILITIES
//
// Bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth IDOR).
// Garde capability `settings.manage` au top de chaque handler AUTHED.
// resolveClientId() = calque chat-bot.ts:33 + voice-agent.ts:32.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit, sanitizeInput, sanitizeHtml } from './helpers';
import { getClientModules } from './modules';
import { checkRateLimit } from './lib/rate-limit';
import {
  pickVariantForVisitor,
  computeFunnelAnalytics,
  recordView,
  recordConversion,
  // Sprint 44 renforcement — pure helpers (additif, zéro régression)
  assignVariant,
  validateStepOrder,
  validateSplitPct,
  validateStepType,
  aggregateFunnelAnalytics,
  FUNNEL_ERROR_CODES,
  type VariantSplit,
} from './lib/funnel-engine';
import type { FunnelStepVariant } from '../lib/api';

type FunnelsBuilderAuth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

/** Whitelist des goals (validation HANDLER, pas de CHECK SQL). */
const VALID_GOALS = new Set(['lead_capture', 'sale', 'webinar', 'other']);

/** Whitelist des step_types (validation HANDLER, pas de CHECK SQL). */
const VALID_STEP_TYPES = new Set([
  'landing',
  'optin',
  'upsell',
  'downsell',
  'thank_you',
  'custom',
]);

/** Slug : alphanum + tirets, 1..120 chars (validation handler). */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Garde capability `settings.manage` (FIGÉE seq80). */
function capGuard(auth: FunnelsBuilderAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

/** Résout le client_id du tenant courant (calque chat-bot.ts:33). */
async function resolveClientId(
  env: Env,
  auth: FunnelsBuilderAuth,
): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Normalise un slug user → lower + tirets. Retourne '' si invalide. */
function normalizeSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return SLUG_RE.test(cleaned) ? cleaned : '';
}

/** SHA-256 court 32 hex (anonymise IP pour les buckets rate-limit). */
async function sha256Ip(ip: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(ip);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch {
    return ip.slice(0, 32);
  }
}

/** Normalise une row funnel D1 → shape API. */
function mapFunnelRow(r: Record<string, unknown>): Record<string, unknown> {
  const goal = String(r.primary_goal ?? 'lead_capture');
  return {
    id: String(r.id ?? ''),
    client_id: String(r.client_id ?? ''),
    name: String(r.name ?? ''),
    slug: String(r.slug ?? ''),
    description: r.description == null ? null : String(r.description),
    primary_goal: VALID_GOALS.has(goal) ? goal : 'lead_capture',
    is_published: r.is_published === 1 || r.is_published === true,
    published_at: r.published_at == null ? null : String(r.published_at),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

/** Normalise une row step D1 → shape API. */
function mapStepRow(r: Record<string, unknown>): Record<string, unknown> {
  const stype = String(r.step_type ?? 'landing');
  return {
    id: String(r.id ?? ''),
    funnel_id: String(r.funnel_id ?? ''),
    name: String(r.name ?? ''),
    step_type: VALID_STEP_TYPES.has(stype) ? stype : 'landing',
    order_index: Number(r.order_index ?? 0),
    redirect_after_url:
      r.redirect_after_url == null ? null : String(r.redirect_after_url),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

/** Normalise une row variant D1 → shape API. */
function mapVariantRow(r: Record<string, unknown>): FunnelStepVariant {
  const pct = Number(r.traffic_pct ?? 0.5);
  return {
    id: String(r.id ?? ''),
    step_id: String(r.step_id ?? ''),
    variant_name: String(r.variant_name ?? ''),
    content_html: r.content_html == null ? null : String(r.content_html),
    traffic_pct: Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0.5,
    is_control: r.is_control === 1 || r.is_control === true,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

/** Vérifie qu'un funnel appartient au tenant (defense-in-depth IDOR). */
async function assertFunnelInTenant(
  env: Env,
  funnelId: string,
  clientId: string,
): Promise<boolean> {
  const row = (await env.DB.prepare(
    `SELECT id FROM fb_funnels WHERE id = ? AND client_id = ? LIMIT 1`,
  )
    .bind(funnelId, clientId)
    .first()) as { id?: string } | null;
  return !!row?.id;
}

/** Vérifie qu'un step appartient au tenant (via join applicatif). */
async function assertStepInTenant(
  env: Env,
  stepId: string,
  clientId: string,
): Promise<{ funnelId: string } | null> {
  const row = (await env.DB.prepare(
    `SELECT s.funnel_id AS funnel_id
       FROM fb_steps s
       JOIN fb_funnels f ON f.id = s.funnel_id
      WHERE s.id = ? AND f.client_id = ?
      LIMIT 1`,
  )
    .bind(stepId, clientId)
    .first()) as { funnel_id?: string } | null;
  return row?.funnel_id ? { funnelId: String(row.funnel_id) } : null;
}

/** Vérifie qu'un variant appartient au tenant (via double join applicatif). */
async function assertVariantInTenant(
  env: Env,
  variantId: string,
  clientId: string,
): Promise<{ stepId: string } | null> {
  const row = (await env.DB.prepare(
    `SELECT v.step_id AS step_id
       FROM fb_step_variants v
       JOIN fb_steps s ON s.id = v.step_id
       JOIN fb_funnels f ON f.id = s.funnel_id
      WHERE v.id = ? AND f.client_id = ?
      LIMIT 1`,
  )
    .bind(variantId, clientId)
    .first()) as { step_id?: string } | null;
  return row?.step_id ? { stepId: String(row.step_id) } : null;
}

// ── 5 handlers Funnels CRUD (admin — cap settings.manage) ───────────────────

/** GET /api/funnels-builder — liste funnels du tenant. */
export async function handleListFunnels(
  env: Env,
  auth: FunnelsBuilderAuth,
  _url: URL,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, client_id, name, slug, description, primary_goal,
              is_published, published_at, created_at, updated_at
         FROM fb_funnels
        WHERE client_id = ?
        ORDER BY updated_at DESC`,
    )
      .bind(clientId)
      .all();

    const rows = ((results || []) as Array<Record<string, unknown>>).map(mapFunnelRow);
    return json({ data: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/funnels-builder — créer un funnel. */
export async function handleCreateFunnel(
  request: Request,
  env: Env,
  auth: FunnelsBuilderAuth,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const name = sanitizeInput(typeof body.name === 'string' ? body.name : '', 200);
    if (!name) return json({ error: 'Le nom est requis' }, 400);

    const slugRaw =
      typeof body.slug === 'string' && body.slug.trim().length > 0
        ? body.slug
        : name;
    const slug = normalizeSlug(slugRaw);
    if (!slug) {
      return json(
        { error: 'Slug invalide (alphanumérique + tirets, 1..120 chars)' },
        400,
      );
    }

    // Unicité slug par tenant (UNIQUE INDEX en place, mais check applicatif
    // pour message d'erreur propre — l'index garantit le racing).
    const dupe = (await env.DB.prepare(
      `SELECT id FROM fb_funnels WHERE client_id = ? AND slug = ? LIMIT 1`,
    )
      .bind(clientId, slug)
      .first()) as { id?: string } | null;
    if (dupe?.id) {
      return json({ error: 'Ce slug est déjà utilisé pour un autre funnel' }, 409);
    }

    const goalRaw =
      typeof body.primary_goal === 'string' && body.primary_goal.length > 0
        ? body.primary_goal
        : 'lead_capture';
    if (!VALID_GOALS.has(goalRaw)) {
      return json(
        { error: 'primary_goal invalide (lead_capture|sale|webinar|other)' },
        400,
      );
    }

    const description =
      typeof body.description === 'string' && body.description.trim().length > 0
        ? sanitizeInput(body.description, 1000)
        : null;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO fb_funnels
         (id, client_id, name, slug, description, primary_goal,
          is_published, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    )
      .bind(id, clientId, name, slug, description, goalRaw, now, now)
      .run();

    await audit(env, auth.userId, 'create', 'fb_funnel', id, { name, slug, primary_goal: goalRaw });

    return json({
      data: {
        id,
        client_id: clientId,
        name,
        slug,
        description,
        primary_goal: goalRaw,
        is_published: false,
        published_at: null,
        created_at: now,
        updated_at: now,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** PATCH /api/funnels-builder/:id — update partial d'un funnel. */
export async function handleUpdateFunnel(
  request: Request,
  env: Env,
  auth: FunnelsBuilderAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!id) return json({ error: 'id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const ok = await assertFunnelInTenant(env, id, clientId);
    if (!ok) return json({ error: 'Funnel introuvable' }, 404);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const updates: string[] = [];
    const binds: unknown[] = [];
    const patched: Record<string, unknown> = {};

    if (typeof body.name === 'string') {
      const name = sanitizeInput(body.name, 200);
      if (!name) return json({ error: 'Le nom ne peut pas être vide' }, 400);
      updates.push('name = ?');
      binds.push(name);
      patched.name = name;
    }

    if (typeof body.slug === 'string') {
      const slug = normalizeSlug(body.slug);
      if (!slug) return json({ error: 'Slug invalide' }, 400);
      // Vérif unicité (excluant self).
      const dupe = (await env.DB.prepare(
        `SELECT id FROM fb_funnels WHERE client_id = ? AND slug = ? AND id != ? LIMIT 1`,
      )
        .bind(clientId, slug, id)
        .first()) as { id?: string } | null;
      if (dupe?.id) {
        return json({ error: 'Ce slug est déjà utilisé pour un autre funnel' }, 409);
      }
      updates.push('slug = ?');
      binds.push(slug);
      patched.slug = slug;
    }

    if ('description' in body) {
      const desc =
        typeof body.description === 'string' && body.description.trim().length > 0
          ? sanitizeInput(body.description, 1000)
          : null;
      updates.push('description = ?');
      binds.push(desc);
      patched.description = desc;
    }

    if (typeof body.primary_goal === 'string') {
      if (!VALID_GOALS.has(body.primary_goal)) {
        return json({ error: 'primary_goal invalide' }, 400);
      }
      updates.push('primary_goal = ?');
      binds.push(body.primary_goal);
      patched.primary_goal = body.primary_goal;
    }

    if (updates.length === 0) {
      return json({ error: 'Aucun champ à mettre à jour' }, 400);
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    binds.push(now);

    binds.push(id, clientId);
    await env.DB.prepare(
      `UPDATE fb_funnels SET ${updates.join(', ')}
        WHERE id = ? AND client_id = ?`,
    )
      .bind(...binds)
      .run();

    await audit(env, auth.userId, 'update', 'fb_funnel', id, patched);

    // Re-SELECT pour shape complète.
    const row = (await env.DB.prepare(
      `SELECT id, client_id, name, slug, description, primary_goal,
              is_published, published_at, created_at, updated_at
         FROM fb_funnels WHERE id = ? AND client_id = ? LIMIT 1`,
    )
      .bind(id, clientId)
      .first()) as Record<string, unknown> | null;

    return json({ data: row ? mapFunnelRow(row) : { id, ...patched, updated_at: now } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * DELETE /api/funnels-builder/:id — soft-delete (unpublish + tagging name).
 *
 * Pas de colonne `deleted_at` au schéma (migration seq139) → on dépublie
 * (is_published=0) + on préfixe le name pour exclure du listing UI. Pas de
 * hard DELETE pour préserver les vues/conversions historiques liées.
 */
export async function handleDeleteFunnel(
  env: Env,
  auth: FunnelsBuilderAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!id) return json({ error: 'id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const ok = await assertFunnelInTenant(env, id, clientId);
    if (!ok) return json({ error: 'Funnel introuvable' }, 404);

    const now = new Date().toISOString();
    // Soft-delete : dépublication + tagging name pour exclusion future éventuelle.
    await env.DB.prepare(
      `UPDATE fb_funnels
          SET is_published = 0,
              published_at = NULL,
              updated_at   = ?
        WHERE id = ? AND client_id = ?`,
    )
      .bind(now, id, clientId)
      .run();

    await audit(env, auth.userId, 'delete', 'fb_funnel', id, {});

    return json({ data: { success: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/funnels-builder/:id/publish — toggle publication on/off. */
export async function handlePublishFunnel(
  request: Request,
  env: Env,
  auth: FunnelsBuilderAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!id) return json({ error: 'id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const ok = await assertFunnelInTenant(env, id, clientId);
    if (!ok) return json({ error: 'Funnel introuvable' }, 404);

    let body: { publish?: boolean } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // Body optionnel : par défaut = publish true.
      body = { publish: true };
    }

    const publish = body.publish !== false; // true par défaut
    const now = new Date().toISOString();

    await env.DB.prepare(
      `UPDATE fb_funnels
          SET is_published = ?,
              published_at = ?,
              updated_at   = ?
        WHERE id = ? AND client_id = ?`,
    )
      .bind(publish ? 1 : 0, publish ? now : null, now, id, clientId)
      .run();

    await audit(env, auth.userId, publish ? 'publish' : 'unpublish', 'fb_funnel', id, {});

    const row = (await env.DB.prepare(
      `SELECT id, client_id, name, slug, description, primary_goal,
              is_published, published_at, created_at, updated_at
         FROM fb_funnels WHERE id = ? AND client_id = ? LIMIT 1`,
    )
      .bind(id, clientId)
      .first()) as Record<string, unknown> | null;

    return json({ data: row ? mapFunnelRow(row) : null });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 4 handlers Steps CRUD (admin — cap settings.manage) ─────────────────────

/** GET /api/funnels-builder/:id/steps — liste étapes d'un funnel. */
export async function handleListSteps(
  env: Env,
  auth: FunnelsBuilderAuth,
  funnelId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!funnelId) return json({ error: 'funnel_id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const ok = await assertFunnelInTenant(env, funnelId, clientId);
    if (!ok) return json({ error: 'Funnel introuvable' }, 404);

    const { results } = await env.DB.prepare(
      `SELECT id, funnel_id, name, step_type, order_index, redirect_after_url,
              created_at, updated_at
         FROM fb_steps
        WHERE funnel_id = ?
        ORDER BY order_index ASC`,
    )
      .bind(funnelId)
      .all();

    const rows = ((results || []) as Array<Record<string, unknown>>).map(mapStepRow);
    return json({ data: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/funnels-builder/:id/steps — créer une étape. */
export async function handleCreateStep(
  request: Request,
  env: Env,
  auth: FunnelsBuilderAuth,
  funnelId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!funnelId) return json({ error: 'funnel_id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const ok = await assertFunnelInTenant(env, funnelId, clientId);
    if (!ok) return json({ error: 'Funnel introuvable' }, 404);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const name = sanitizeInput(typeof body.name === 'string' ? body.name : '', 200);
    if (!name) return json({ error: "Le nom de l'étape est requis" }, 400);

    const stepTypeRaw =
      typeof body.step_type === 'string' && body.step_type.length > 0
        ? body.step_type
        : 'landing';
    // Sprint 44 renforcement : whitelist via engine + handler guard local (defense-in-depth).
    const typeCheck = validateStepType(stepTypeRaw);
    if (!typeCheck.ok || !VALID_STEP_TYPES.has(stepTypeRaw)) {
      return json(
        {
          error: `[${FUNNEL_ERROR_CODES.INVALID_STEP_TYPE}] step_type invalide (landing|optin|upsell|downsell|thank_you|custom)`,
        },
        400,
      );
    }

    let orderIndex = Number(body.order_index ?? NaN);
    if (!Number.isFinite(orderIndex)) {
      // Auto-append : max(order_index)+1.
      const maxRow = (await env.DB.prepare(
        `SELECT COALESCE(MAX(order_index), -1) AS m FROM fb_steps WHERE funnel_id = ?`,
      )
        .bind(funnelId)
        .first()) as { m?: number } | null;
      orderIndex = Number(maxRow?.m ?? -1) + 1;
    }
    orderIndex = Math.max(0, Math.floor(orderIndex));

    // Sprint 44 renforcement : refuser DUPLICATE_ORDER_INDEX (collision UI).
    // On query les order_index existants et on vérifie l'unicité avec le nouveau.
    const existingRows = await env.DB.prepare(
      `SELECT id, order_index FROM fb_steps WHERE funnel_id = ?`,
    )
      .bind(funnelId)
      .all();
    const existingSteps = ((existingRows.results || []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id ?? ''),
      order_index: Number(r.order_index ?? 0),
    }));
    if (existingSteps.some((s) => s.order_index === orderIndex)) {
      return json(
        {
          error: `[${FUNNEL_ERROR_CODES.DUPLICATE_ORDER_INDEX}] order_index ${orderIndex} déjà utilisé pour ce funnel`,
        },
        400,
      );
    }
    // Vérif applicative supplémentaire via validateStepOrder sur l'ensemble
    // {existants + nouveau} : capture les doublons croisés (additif zéro perf).
    const orderCheck = validateStepOrder([
      ...existingSteps,
      { id: 'new', order_index: orderIndex },
    ]);
    // Note : on tolère STEP_INVALID (gaps) sur les données existantes — seul
    // DUPLICATE_ORDER_INDEX est bloquant côté insert (cohérence handler).
    if (!orderCheck.ok && orderCheck.error.code === FUNNEL_ERROR_CODES.DUPLICATE_ORDER_INDEX) {
      return json(
        { error: `[${FUNNEL_ERROR_CODES.DUPLICATE_ORDER_INDEX}] ${orderCheck.error.message}` },
        400,
      );
    }

    const redirectUrl =
      typeof body.redirect_after_url === 'string' && body.redirect_after_url.trim().length > 0
        ? sanitizeInput(body.redirect_after_url, 500)
        : null;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO fb_steps
         (id, funnel_id, name, step_type, order_index, redirect_after_url,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, funnelId, name, stepTypeRaw, orderIndex, redirectUrl, now, now)
      .run();

    await audit(env, auth.userId, 'create', 'fb_step', id, {
      funnel_id: funnelId,
      step_type: stepTypeRaw,
    });

    return json({
      data: {
        id,
        funnel_id: funnelId,
        name,
        step_type: stepTypeRaw,
        order_index: orderIndex,
        redirect_after_url: redirectUrl,
        created_at: now,
        updated_at: now,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** PATCH /api/funnels-builder/steps/:id — update partial d'une étape. */
export async function handleUpdateStep(
  request: Request,
  env: Env,
  auth: FunnelsBuilderAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!id) return json({ error: 'id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await assertStepInTenant(env, id, clientId);
    if (!tenant) return json({ error: 'Étape introuvable' }, 404);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const updates: string[] = [];
    const binds: unknown[] = [];
    const patched: Record<string, unknown> = {};

    if (typeof body.name === 'string') {
      const name = sanitizeInput(body.name, 200);
      if (!name) return json({ error: 'Le nom ne peut pas être vide' }, 400);
      updates.push('name = ?');
      binds.push(name);
      patched.name = name;
    }

    if (typeof body.step_type === 'string') {
      // Sprint 44 renforcement : whitelist via engine.
      const typeCheck = validateStepType(body.step_type);
      if (!typeCheck.ok || !VALID_STEP_TYPES.has(body.step_type)) {
        return json(
          { error: `[${FUNNEL_ERROR_CODES.INVALID_STEP_TYPE}] step_type invalide` },
          400,
        );
      }
      updates.push('step_type = ?');
      binds.push(body.step_type);
      patched.step_type = body.step_type;
    }

    if (body.order_index != null) {
      const oi = Number(body.order_index);
      if (!Number.isFinite(oi)) {
        return json({ error: 'order_index invalide' }, 400);
      }
      const safeOi = Math.max(0, Math.floor(oi));

      // Sprint 44 renforcement : refuser DUPLICATE_ORDER_INDEX (collision sibling).
      const siblingRows = await env.DB.prepare(
        `SELECT id, order_index FROM fb_steps WHERE funnel_id = ? AND id != ?`,
      )
        .bind(tenant.funnelId, id)
        .all();
      const siblings = ((siblingRows.results || []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id ?? ''),
        order_index: Number(r.order_index ?? 0),
      }));
      if (siblings.some((s) => s.order_index === safeOi)) {
        return json(
          {
            error: `[${FUNNEL_ERROR_CODES.DUPLICATE_ORDER_INDEX}] order_index ${safeOi} déjà utilisé pour ce funnel`,
          },
          400,
        );
      }

      updates.push('order_index = ?');
      binds.push(safeOi);
      patched.order_index = safeOi;
    }

    if ('redirect_after_url' in body) {
      const url =
        typeof body.redirect_after_url === 'string' &&
        body.redirect_after_url.trim().length > 0
          ? sanitizeInput(body.redirect_after_url, 500)
          : null;
      updates.push('redirect_after_url = ?');
      binds.push(url);
      patched.redirect_after_url = url;
    }

    if (updates.length === 0) {
      return json({ error: 'Aucun champ à mettre à jour' }, 400);
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    binds.push(now);

    binds.push(id);
    await env.DB.prepare(
      `UPDATE fb_steps SET ${updates.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();

    await audit(env, auth.userId, 'update', 'fb_step', id, patched);

    const row = (await env.DB.prepare(
      `SELECT id, funnel_id, name, step_type, order_index, redirect_after_url,
              created_at, updated_at
         FROM fb_steps WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first()) as Record<string, unknown> | null;

    return json({ data: row ? mapStepRow(row) : { id, ...patched, updated_at: now } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** DELETE /api/funnels-builder/steps/:id — supprime une étape (hard). */
export async function handleDeleteStep(
  env: Env,
  auth: FunnelsBuilderAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!id) return json({ error: 'id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await assertStepInTenant(env, id, clientId);
    if (!tenant) return json({ error: 'Étape introuvable' }, 404);

    // Hard delete : on cleanup les variants liés (analytics views/conversions
    // conservés pour historique).
    await env.DB.prepare(`DELETE FROM fb_step_variants WHERE step_id = ?`)
      .bind(id)
      .run();
    await env.DB.prepare(`DELETE FROM fb_steps WHERE id = ?`).bind(id).run();

    await audit(env, auth.userId, 'delete', 'fb_step', id, {});

    return json({ data: { success: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 4 handlers Variants CRUD (admin — cap settings.manage) ──────────────────

/** GET /api/funnels-builder/steps/:id/variants — liste variantes d'une étape. */
export async function handleListVariants(
  env: Env,
  auth: FunnelsBuilderAuth,
  stepId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!stepId) return json({ error: 'step_id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await assertStepInTenant(env, stepId, clientId);
    if (!tenant) return json({ error: 'Étape introuvable' }, 404);

    const { results } = await env.DB.prepare(
      `SELECT id, step_id, variant_name, content_html, traffic_pct,
              is_control, created_at, updated_at
         FROM fb_step_variants
        WHERE step_id = ?
        ORDER BY variant_name ASC`,
    )
      .bind(stepId)
      .all();

    const rows = ((results || []) as Array<Record<string, unknown>>).map(mapVariantRow);
    return json({ data: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** POST /api/funnels-builder/steps/:id/variants — créer une variante. */
export async function handleCreateVariant(
  request: Request,
  env: Env,
  auth: FunnelsBuilderAuth,
  stepId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!stepId) return json({ error: 'step_id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await assertStepInTenant(env, stepId, clientId);
    if (!tenant) return json({ error: 'Étape introuvable' }, 404);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const variantName = sanitizeInput(
      typeof body.variant_name === 'string' ? body.variant_name : '',
      50,
    );
    if (!variantName) {
      return json({ error: 'variant_name est requis' }, 400);
    }

    const contentHtml =
      typeof body.content_html === 'string' ? body.content_html : null;

    let trafficPct = Number(body.traffic_pct ?? 0.5);
    if (!Number.isFinite(trafficPct)) trafficPct = 0.5;
    trafficPct = Math.max(0, Math.min(1, trafficPct));

    const isControl = body.is_control === true ? 1 : 0;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO fb_step_variants
         (id, step_id, variant_name, content_html, traffic_pct, is_control,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, stepId, variantName, contentHtml, trafficPct, isControl, now, now)
      .run();

    await audit(env, auth.userId, 'create', 'fb_step_variant', id, {
      step_id: stepId,
      variant_name: variantName,
      traffic_pct: trafficPct,
    });

    return json({
      data: {
        id,
        step_id: stepId,
        variant_name: variantName,
        content_html: contentHtml,
        traffic_pct: trafficPct,
        is_control: isControl === 1,
        created_at: now,
        updated_at: now,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** PATCH /api/funnels-builder/variants/:id — update partial d'une variante. */
export async function handleUpdateVariant(
  request: Request,
  env: Env,
  auth: FunnelsBuilderAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!id) return json({ error: 'id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await assertVariantInTenant(env, id, clientId);
    if (!tenant) return json({ error: 'Variante introuvable' }, 404);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const updates: string[] = [];
    const binds: unknown[] = [];
    const patched: Record<string, unknown> = {};

    if (typeof body.variant_name === 'string') {
      const vn = sanitizeInput(body.variant_name, 50);
      if (!vn) return json({ error: 'variant_name ne peut pas être vide' }, 400);
      updates.push('variant_name = ?');
      binds.push(vn);
      patched.variant_name = vn;
    }

    if ('content_html' in body) {
      const html =
        typeof body.content_html === 'string' ? body.content_html : null;
      updates.push('content_html = ?');
      binds.push(html);
      patched.content_html = html;
    }

    if (body.traffic_pct != null) {
      let pct = Number(body.traffic_pct);
      if (!Number.isFinite(pct)) {
        return json({ error: 'traffic_pct invalide' }, 400);
      }
      pct = Math.max(0, Math.min(1, pct));
      updates.push('traffic_pct = ?');
      binds.push(pct);
      patched.traffic_pct = pct;
    }

    if (typeof body.is_control === 'boolean') {
      updates.push('is_control = ?');
      binds.push(body.is_control ? 1 : 0);
      patched.is_control = body.is_control;
    }

    if (updates.length === 0) {
      return json({ error: 'Aucun champ à mettre à jour' }, 400);
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    binds.push(now);

    binds.push(id);
    await env.DB.prepare(
      `UPDATE fb_step_variants SET ${updates.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();

    await audit(env, auth.userId, 'update', 'fb_step_variant', id, patched);

    const row = (await env.DB.prepare(
      `SELECT id, step_id, variant_name, content_html, traffic_pct, is_control,
              created_at, updated_at
         FROM fb_step_variants WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first()) as Record<string, unknown> | null;

    return json({ data: row ? mapVariantRow(row) : { id, ...patched, updated_at: now } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/** DELETE /api/funnels-builder/variants/:id — supprime une variante (hard). */
export async function handleDeleteVariant(
  env: Env,
  auth: FunnelsBuilderAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!id) return json({ error: 'id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await assertVariantInTenant(env, id, clientId);
    if (!tenant) return json({ error: 'Variante introuvable' }, 404);

    await env.DB.prepare(`DELETE FROM fb_step_variants WHERE id = ?`)
      .bind(id)
      .run();

    await audit(env, auth.userId, 'delete', 'fb_step_variant', id, {});

    return json({ data: { success: true } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 1 handler Analytics (admin — cap settings.manage) ───────────────────────

/**
 * GET /api/funnels-builder/:id/analytics — analytics agrégées du funnel.
 *
 * Sprint 44 renforcement : enrichi avec `dropoff` (identifyDropoff) calculé
 * à partir des views agrégées par step (additif, n'altère pas le shape
 * historique `data.{steps_breakdown, conversion_rate, top_variants}`).
 */
export async function handleGetAnalytics(
  env: Env,
  auth: FunnelsBuilderAuth,
  funnelId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!funnelId) return json({ error: 'funnel_id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const ok = await assertFunnelInTenant(env, funnelId, clientId);
    if (!ok) return json({ error: 'Funnel introuvable' }, 404);

    const analytics = await computeFunnelAnalytics(env, funnelId);

    // Sprint 44 renforcement : aggregateFunnelAnalytics orchestrator (pure)
    // calcule conversion par step + dropoff via helpers (zéro round-trip D1
    // additionnel — réutilise les counts déjà résolus par computeFunnelAnalytics).
    const steps = analytics.steps_breakdown.map((s) => ({
      id: s.step_id,
      order_index: s.order_index,
    }));
    const viewsByStep: Record<string, number> = {};
    const convByStep: Record<string, number> = {};
    for (const s of analytics.steps_breakdown) {
      viewsByStep[s.step_id] = s.views;
      convByStep[s.step_id] = s.conversions;
    }
    const aggregated = aggregateFunnelAnalytics(steps, viewsByStep, convByStep);

    return json({
      data: {
        ...analytics,
        // ── Sprint 44 renforcement (additif zéro régression) ──
        dropoff: aggregated.dropoff,
        conversion_breakdown: aggregated.global,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 2 handlers Sprint 44 renforcement (additif) ─────────────────────────────

/**
 * POST /api/funnels-builder/steps/:id/variants/split — bulk-update splits.
 *
 * Body : `{ variants: [{ id, split_pct }] }` où split_pct ∈ [1, 99] entier,
 * somme = 100 (validateSplitPct côté engine). Conversion split_pct → traffic_pct
 * en interne : `traffic_pct = split_pct / 100` (mapping API REAL ∈ [0, 1]).
 *
 * Cas d'usage : UI builder envoie l'état complet des variants quand le user
 * sauvegarde le slider de split. Validation atomique : refuse 400 INVALID_SPLIT
 * si sum ≠ 100 ou empty (cf. FUNNEL_ERROR_CODES côté engine).
 *
 * Bornage tenant : assertVariantInTenant sur CHAQUE id avant UPDATE.
 */
export async function handleSetSplitPct(
  request: Request,
  env: Env,
  auth: FunnelsBuilderAuth,
  stepId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  if (!stepId) return json({ error: 'step_id invalide' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const tenant = await assertStepInTenant(env, stepId, clientId);
    if (!tenant) return json({ error: 'Étape introuvable' }, 404);

    let body: { variants?: Array<{ id?: string; split_pct?: number }> };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const rawVariants = Array.isArray(body.variants) ? body.variants : [];
    if (rawVariants.length === 0) {
      return json(
        { error: `[${FUNNEL_ERROR_CODES.EMPTY_VARIANTS}] Au moins une variante est requise` },
        400,
      );
    }

    // Normalise + valide chaque entrée (id non-vide + split_pct entier).
    const variants: Array<{ id: string; split_pct: number }> = [];
    for (const v of rawVariants) {
      const id = String(v.id ?? '').trim();
      const pct = Number(v.split_pct);
      if (!id || !Number.isInteger(pct)) {
        return json(
          {
            error: `[${FUNNEL_ERROR_CODES.INVALID_SPLIT}] Chaque variante doit avoir { id, split_pct (entier) }`,
          },
          400,
        );
      }
      variants.push({ id, split_pct: pct });
    }

    // Sprint 44 renforcement : validateSplitPct côté engine (sum=100 + ∈[1,99]).
    const check = validateSplitPct(variants);
    if (!check.ok) {
      return json({ error: `[${check.error.code}] ${check.error.message}` }, 400);
    }

    // Vérif bornage tenant : tous les variant.id doivent appartenir au step
    // courant (defense-in-depth contre payload croisé).
    const placeholders = variants.map(() => '?').join(',');
    const tenantRows = await env.DB.prepare(
      `SELECT v.id AS id
         FROM fb_step_variants v
         JOIN fb_steps s ON s.id = v.step_id
         JOIN fb_funnels f ON f.id = s.funnel_id
        WHERE v.id IN (${placeholders})
          AND v.step_id = ?
          AND f.client_id = ?`,
    )
      .bind(...variants.map((v) => v.id), stepId, clientId)
      .all();
    const validIds = new Set(
      ((tenantRows.results || []) as Array<Record<string, unknown>>).map((r) =>
        String(r.id ?? ''),
      ),
    );
    for (const v of variants) {
      if (!validIds.has(v.id)) {
        return json({ error: `Variante ${v.id} introuvable pour cette étape` }, 404);
      }
    }

    // Bulk-update traffic_pct = split_pct / 100 (séquentiel — D1 ne supporte pas
    // batch dans le mock partagé ; en prod c'est OK, 2-5 variants max).
    const now = new Date().toISOString();
    for (const v of variants) {
      await env.DB.prepare(
        `UPDATE fb_step_variants
            SET traffic_pct = ?, updated_at = ?
          WHERE id = ?`,
      )
        .bind(v.split_pct / 100, now, v.id)
        .run();
    }

    await audit(env, auth.userId, 'update', 'fb_step_variants_split', stepId, {
      variants: variants.map((v) => ({ id: v.id, split_pct: v.split_pct })),
    });

    return json({
      data: {
        success: true,
        step_id: stepId,
        variants: variants.map((v) => ({
          id: v.id,
          split_pct: v.split_pct,
          traffic_pct: v.split_pct / 100,
        })),
        updated_at: now,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/public/funnels/steps/:id/assign-variant — assignation déterministe.
 *
 * Body : `{ visitor_id }`. Pas de capability (PUBLIC + rate-limited).
 * Différent de pickVariantForVisitor (interne render) : expose explicitement le
 * choix via API JSON pour permettre au front client de fetch la variante puis
 * appliquer ses propres patches (cas SPA Intralys Stack B).
 *
 * Garantie : même visitor_id → même variant (FNV-1a déterministe via
 * assignVariant). Crucial pour la cohérence des analytics A/B test (un visiteur
 * ne doit jamais voir 2 variantes différentes pour la même étape).
 */
export async function handleVisitorAssignVariant(
  request: Request,
  env: Env,
  stepId: string,
): Promise<Response> {
  try {
    // Rate-limit anti-bot par IP-hash : 60 req / 60 s (équivalent render).
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await sha256Ip(ip);
    const rl = await checkRateLimit(env, `funnel:assign:${ipHash}`, 60, 60);
    if (!rl.allowed) {
      return json({ error: 'Too Many Requests' }, 429);
    }

    if (!stepId) return json({ error: 'step_id invalide' }, 400);

    let body: { visitor_id?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const visitorId = String(body.visitor_id ?? '').trim();
    if (!visitorId) {
      return json({ error: 'visitor_id requis' }, 400);
    }

    // Lookup variants du step (PUBLIC : pas d'assertStepInTenant, on filtre
    // implicitement via le fait que l'id de step soit connu — équivalent au
    // pattern handlePublicRenderStep).
    const variantsRows = await env.DB.prepare(
      `SELECT id, step_id, variant_name, traffic_pct, is_control
         FROM fb_step_variants
        WHERE step_id = ?`,
    )
      .bind(stepId)
      .all();

    const splits: Array<VariantSplit & { variant_name: string; is_control: boolean }> = (
      (variantsRows.results || []) as Array<Record<string, unknown>>
    ).map((r) => {
      const trafficPct = Number(r.traffic_pct ?? 0);
      // Conversion API traffic_pct ∈ [0, 1] → split_pct entier ∈ [1, 100].
      const splitPct = Math.max(0, Math.round(trafficPct * 100));
      return {
        id: String(r.id ?? ''),
        split_pct: splitPct,
        variant_name: String(r.variant_name ?? ''),
        is_control: r.is_control === 1 || r.is_control === true,
      };
    });

    if (splits.length === 0) {
      return json({ data: { variant: null, visitor_id: visitorId } });
    }

    // Sprint 44 renforcement : assignVariant déterministe (vs random).
    const chosen = assignVariant(visitorId, splits);

    return json({
      data: {
        visitor_id: visitorId,
        variant: chosen
          ? {
              id: chosen.id,
              variant_name: chosen.variant_name,
              is_control: chosen.is_control,
              split_pct: chosen.split_pct,
            }
          : null,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── 3 handlers PUBLIC (anti-bot rate-limit + honeypot côté worker.ts) ───────

/** POST /api/public/funnels/track-view — track vue anonyme (visitor_id cookie). */
export async function handlePublicTrackView(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Rate-limit anti-bot par IP-hash : 30 req / 60 s.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await sha256Ip(ip);
    const rl = await checkRateLimit(env, `funnel:view:${ipHash}`, 30, 60);
    if (!rl.allowed) {
      // Fake-success silencieux (anti-énumération + masque rate-limit aux bots).
      return json({ data: { success: true } });
    }

    let body: { step_id?: string; variant_id?: string; visitor_id?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const stepId = String(body.step_id ?? '').trim();
    const variantId = String(body.variant_id ?? '').trim();
    const visitorId = String(body.visitor_id ?? '').trim();
    if (!stepId || !variantId || !visitorId) {
      return json({ error: 'Champs requis manquants (step_id, variant_id, visitor_id)' }, 400);
    }

    await recordView(env, stepId, variantId, visitorId, request);
    return json({ data: { success: true } });
  } catch {
    // Best-effort : on ne révèle JAMAIS l'erreur au client (anti-énumération).
    return json({ data: { success: true } });
  }
}

/** POST /api/public/funnels/track-conversion — track conversion anonyme. */
export async function handlePublicTrackConversion(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // Rate-limit anti-bot par IP-hash : 10 req / 60 s (plus strict que view).
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await sha256Ip(ip);
    const rl = await checkRateLimit(env, `funnel:conv:${ipHash}`, 10, 60);
    if (!rl.allowed) {
      return json({ data: { success: true } });
    }

    let body: {
      step_id?: string;
      variant_id?: string;
      visitor_id?: string;
      next_step_id?: string | null;
      conversion_value_cents?: number;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const stepId = String(body.step_id ?? '').trim();
    const variantId = String(body.variant_id ?? '').trim();
    const visitorId = String(body.visitor_id ?? '').trim();
    if (!stepId || !variantId || !visitorId) {
      return json({ error: 'Champs requis manquants (step_id, variant_id, visitor_id)' }, 400);
    }
    const nextStepId = body.next_step_id ? String(body.next_step_id).trim() : null;
    const valueCents = Number.isFinite(body.conversion_value_cents)
      ? Math.max(0, Math.floor(body.conversion_value_cents as number))
      : 0;

    await recordConversion(env, stepId, variantId, visitorId, nextStepId, valueCents);
    return json({ data: { success: true } });
  } catch {
    return json({ data: { success: true } });
  }
}

/**
 * GET /api/public/funnels/:slug/render?step=N&variant=A&visitor_id=X
 *
 * Pipeline :
 *   1. Rate-limit IP (60 req / 60 s — render léger, plus permissif).
 *   2. Lookup fb_funnels WHERE slug=? AND is_published=1.
 *   3. Lookup fb_steps WHERE funnel_id=? ORDER BY order_index ASC,
 *      sélectionne celui à l'index `step-1` (1-based).
 *   4. Lookup fb_step_variants WHERE step_id=?.
 *   5. Si query.variant fourni → match strict variant_name. Sinon →
 *      pickVariantForVisitor(variants, visitor_id).
 *   6. Si visitor_id manquant : génère UUID + set cookie `_intralys_fid`.
 *   7. Return new Response(variant.content_html, headers HTML).
 */
export async function handlePublicRenderStep(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  // Rate-limit anti-bot par IP-hash : 60 req / 60 s.
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipHash = await sha256Ip(ip);
    const rl = await checkRateLimit(env, `funnel:render:${ipHash}`, 60, 60);
    if (!rl.allowed) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  } catch {
    // Fail-open : on continue si rate-limit panne.
  }

  if (!slug) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  try {
    const url = new URL(request.url);
    const stepParam = Number(url.searchParams.get('step') ?? '1');
    const stepIndex = Number.isFinite(stepParam) && stepParam >= 1
      ? Math.floor(stepParam)
      : 1;
    const variantParam = url.searchParams.get('variant');

    // visitor_id : query param OU cookie `_intralys_fid` OU généré.
    let visitorId = (url.searchParams.get('visitor_id') ?? '').trim();
    if (!visitorId) {
      const cookie = request.headers.get('Cookie') || '';
      const m = /(?:^|;\s*)_intralys_fid=([^;]+)/.exec(cookie);
      visitorId = m ? decodeURIComponent(m[1]!).trim() : '';
    }
    let setCookie = false;
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      setCookie = true;
    }

    // Lookup funnel publié.
    const funnel = (await env.DB.prepare(
      `SELECT id, client_id FROM fb_funnels
        WHERE slug = ? AND is_published = 1
        LIMIT 1`,
    )
      .bind(slug)
      .first()) as { id?: string; client_id?: string } | null;

    if (!funnel?.id) {
      return new Response('Funnel introuvable', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // Lookup step à l'index demandé (1-based → OFFSET stepIndex-1).
    const step = (await env.DB.prepare(
      `SELECT id, name, step_type, order_index, redirect_after_url
         FROM fb_steps
        WHERE funnel_id = ?
        ORDER BY order_index ASC
        LIMIT 1 OFFSET ?`,
    )
      .bind(funnel.id, stepIndex - 1)
      .first()) as Record<string, unknown> | null;

    if (!step?.id) {
      return new Response('Étape introuvable', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    const stepId = String(step.id);

    // Lookup variants.
    const variantsRows = await env.DB.prepare(
      `SELECT id, step_id, variant_name, content_html, traffic_pct, is_control,
              created_at, updated_at
         FROM fb_step_variants
        WHERE step_id = ?`,
    )
      .bind(stepId)
      .all();

    const variants = ((variantsRows.results || []) as Array<Record<string, unknown>>).map(
      mapVariantRow,
    );

    // Sélection variante : query.variant (match strict) OU déterministe hash.
    let chosen: FunnelStepVariant | null = null;
    if (variantParam) {
      const wanted = sanitizeInput(variantParam, 50);
      chosen = variants.find((v) => v.variant_name === wanted) ?? null;
    }
    if (!chosen) {
      chosen = pickVariantForVisitor(variants, visitorId);
    }

    // Fallback : si aucune variante, on rend un HTML minimal sûr.
    const safeName = sanitizeHtml(String(step.name ?? 'Étape'));
    const html = chosen?.content_html
      ? chosen.content_html
      : `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${safeName}</title></head><body><h1>${safeName}</h1></body></html>`;

    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Funnel-Step': String(step.order_index ?? 0),
      'X-Funnel-Variant': chosen?.variant_name ?? '',
    };
    if (setCookie) {
      // Cookie 1st-party 1 an, SameSite=Lax pour cross-step navigation.
      headers['Set-Cookie'] = `_intralys_fid=${encodeURIComponent(visitorId)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }

    return new Response(html, { status: 200, headers });
  } catch (err) {
    return new Response(
      `Erreur : ${err instanceof Error ? err.message : String(err)}`,
      { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
}
