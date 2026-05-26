// ── kb.ts — LOT G1 Helpdesk : base de connaissances (KB) (Sprint 8) ────────
//
// Handlers backend de la base de connaissances publique simple : CRUD admin
// (PRO) + lecture publique par slug (calque PublicFunnel SPA hydraté). Table
// NEUVE kb_articles (seq 89).
//
// ⚠ CORPS RÉELS PHASE B (Manager-B backend exclusif) — signatures FIGÉES
//   Phase A (Manager-A SOLO). worker.ts (gelé Phase A) câble déjà ces handlers,
//   api.ts (gelé Phase A) appelle déjà ces routes. Contrat §6 verbatim dans
//   docs/LOT-HELPDESK-G1.md.
//
// Conventions imposées (docs/LOT-HELPDESK-G1.md §6.C/§6.D/§6.I) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.D).
//   - Garde capability : helpdeskCapGuard(auth) (mode-agence-only, 'leads.write'
//     — partagé avec tickets.ts). AUCUN ajout à ALL_CAPABILITIES.
//   - Bornage tenant : loadKBInTenant (calque funnels.ts:loadFunnelInTenant).
//   - Slug : unicité APPLICATIVE (slugify + suffixe collision calque funnels.ts
//     — Phase B), PAS de UNIQUE SQL.
//   - status v1 : draft|published validé handler (PAS de CHECK SQL).
//   - Public viewer : SELECT slug + status='published' ; UPDATE view_count++
//     best-effort ; ZÉRO champ tenant exposé (calque handlePublicFunnelGet).
//   - best-effort : table absente → réponse propre (404 / {data:[]}), JAMAIS
//     de 500/throw non maîtrisé.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { TicketAuth } from './tickets';
import { helpdeskCapGuard } from './tickets';

const KB_STATUSES = ['draft', 'published'] as const;

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

// Slug applicatif : slugify + suffixe court si collision (unicité côté handler,
// PAS de UNIQUE SQL — §6.B). Calque funnels.ts:slugify.
function slugify(input: string): string {
  const base = (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'article';
}

// Unicité APPLICATIVE du slug : collision si pris par un AUTRE article. Renvoie
// un slug libre (suffixe court si nécessaire). Calque funnels.ts:handlePublishFunnel.
async function uniqueSlug(
  env: Env,
  desired: string,
  excludeId: string | null,
): Promise<string> {
  const collides = async (s: string): Promise<boolean> => {
    try {
      const hit = (await env.DB.prepare(
        excludeId
          ? 'SELECT 1 AS x FROM kb_articles WHERE slug = ? AND id <> ? LIMIT 1'
          : 'SELECT 1 AS x FROM kb_articles WHERE slug = ? LIMIT 1',
      )
        .bind(...(excludeId ? [s, excludeId] : [s]))
        .first()) as { x: number } | null;
      return !!hit;
    } catch {
      return false;
    }
  };
  let slug = slugify(desired);
  let tries = 0;
  let candidate = slug;
  while ((await collides(candidate)) && tries < 5) {
    candidate = `${slug}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 70);
    tries++;
  }
  return candidate;
}

// ── Bornage tenant sur un article KB (calque funnels.ts:loadFunnelInTenant) ──
//   - Legacy/mono-tenant → row.
//   - Mode agence → client_id ∈ accessibleClientIds OU agency_id == agencyId,
//     sinon 404 'Article introuvable'.
export async function loadKBInTenant(
  env: Env,
  articleId: string,
  auth: TicketAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM kb_articles WHERE id = ?')
      .bind(articleId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Article introuvable' }, 404);
  }
  if (!row) return json({ error: 'Article introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;

  const inTenant =
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId);
  if (!inTenant) return json({ error: 'Article introuvable' }, 404);
  return row;
}

// ── PROTÉGÉ : liste des articles KB du tenant ───────────────────────────────
// SELECT borné tenant (calque tickets.ts:handleGetTickets). Filtre status
// optionnel. Tri updated_at DESC.
export async function handleGetKBArticles(
  env: Env,
  auth: TicketAuth,
  url: URL,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  try {
    const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
    const conds: string[] = [];
    const binds: unknown[] = [];

    if (!isLegacy) {
      const agencyId = auth.tenant!.agencyId as string;
      const accessible = auth.tenant!.accessibleClientIds || [];
      const tenantConds: string[] = ['agency_id = ?'];
      binds.push(agencyId);
      if (accessible.length > 0) {
        tenantConds.push(
          `client_id IN (${accessible.map(() => '?').join(',')})`,
        );
        binds.push(...accessible);
      }
      conds.push(`(${tenantConds.join(' OR ')})`);
    }

    const status = url.searchParams.get('status');
    if (status && KB_STATUSES.includes(status as never)) {
      conds.push('status = ?');
      binds.push(status);
    }

    let sql = 'SELECT * FROM kb_articles';
    if (conds.length > 0) sql += ` WHERE ${conds.join(' AND ')}`;
    sql += ' ORDER BY updated_at DESC LIMIT 200';

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// ── PROTÉGÉ : création d'un article KB ──────────────────────────────────────
// INSERT (id uuid, slug applicatif unique, status 'draft' par défaut,
// client_id/agency_id depuis tenant).
export async function handleCreateKBArticle(
  request: Request,
  env: Env,
  auth: TicketAuth,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const id = crypto.randomUUID();
  const title = sanitizeInput((body.title as string) || 'Article sans titre', 200);
  const bodyMd = sanitizeInput((body.body_md as string) || '', 20000);
  const category = sanitizeInput((body.category as string) || '', 80);
  const status = KB_STATUSES.includes(body.status as never)
    ? (body.status as string)
    : 'draft';

  const clientId = auth.tenant?.clientId ?? auth.clientId ?? null;
  const agencyId = auth.tenant?.agencyId ?? null;

  try {
    const slug = await uniqueSlug(
      env,
      (body.slug as string) || title,
      null,
    );
    const at = nowEpoch();
    await env.DB.prepare(
      `INSERT INTO kb_articles
         (id, client_id, agency_id, slug, title, body_md, category, status, view_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
      .bind(
        id,
        clientId,
        agencyId,
        slug,
        title,
        bodyMd,
        category || null,
        status,
        at,
        at,
      )
      .run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Création impossible' }, 404);
  }
}

// ── PROTÉGÉ : détail d'un article KB ────────────────────────────────────────
export async function handleGetKBArticle(
  env: Env,
  auth: TicketAuth,
  articleId: string,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  const articleOr = await loadKBInTenant(env, articleId, auth);
  if (articleOr instanceof Response) return articleOr;
  return json({ data: articleOr });
}

// ── PROTÉGÉ : mise à jour d'un article KB ───────────────────────────────────
// loadKBInTenant 404 → UPDATE (title/body_md/category/status). Re-slug si title
// change (avec garde unicité applicative). updated_at refresh.
export async function handleUpdateKBArticle(
  request: Request,
  env: Env,
  auth: TicketAuth,
  articleId: string,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  const articleOr = await loadKBInTenant(env, articleId, auth);
  if (articleOr instanceof Response) return articleOr;
  const article = articleOr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (typeof body.title === 'string') {
    const newTitle = sanitizeInput(body.title, 200);
    sets.push('title = ?');
    binds.push(newTitle);
    // Re-slug uniquement si le titre change ET pas de slug explicite fourni.
    const oldTitle = (article.title as string | null) || '';
    if (typeof body.slug !== 'string' && newTitle !== oldTitle) {
      const slug = await uniqueSlug(env, newTitle, articleId);
      sets.push('slug = ?');
      binds.push(slug);
    }
  }
  if (typeof body.slug === 'string') {
    const slug = await uniqueSlug(env, body.slug, articleId);
    sets.push('slug = ?');
    binds.push(slug);
  }
  if (typeof body.body_md === 'string') {
    sets.push('body_md = ?');
    binds.push(sanitizeInput(body.body_md, 20000));
  }
  if (typeof body.category === 'string') {
    sets.push('category = ?');
    binds.push(sanitizeInput(body.category, 80) || null);
  }
  if (
    typeof body.status === 'string' &&
    KB_STATUSES.includes(body.status as never)
  ) {
    sets.push('status = ?');
    binds.push(body.status);
  }

  if (sets.length === 0) return json({ error: 'Aucune modification' }, 400);

  try {
    sets.push('updated_at = ?');
    binds.push(nowEpoch());
    binds.push(articleId);
    await env.DB.prepare(
      `UPDATE kb_articles SET ${sets.join(', ')} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Article introuvable' }, 404);
  }
}

// ── PROTÉGÉ : suppression d'un article KB ───────────────────────────────────
export async function handleDeleteKBArticle(
  env: Env,
  auth: TicketAuth,
  articleId: string,
): Promise<Response> {
  const g = helpdeskCapGuard(auth);
  if (g) return g;

  const articleOr = await loadKBInTenant(env, articleId, auth);
  if (articleOr instanceof Response) return articleOr;

  try {
    await env.DB.prepare('DELETE FROM kb_articles WHERE id = ?')
      .bind(articleId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Article introuvable' }, 404);
  }
}

// ── PUBLIC (pré-requireAuth) : lecture d'un article KB publié par slug ───────
// SELECT WHERE slug=? AND status='published'. Incrémente view_count++
// best-effort. Renvoie SEULEMENT les données publiables (title/body_md/category/
// slug) — JAMAIS client_id/agency_id/id interne (calque handlePublicFunnelGet).
// Cache-Control. 404 si introuvable.
export async function handlePublicGetKBArticle(
  env: Env,
  slug: string,
): Promise<Response> {
  const cleanSlug = (slug || '').trim();
  if (!cleanSlug) return json({ error: 'Article non trouvé' }, 404);

  try {
    const row = (await env.DB.prepare(
      "SELECT id, slug, title, body_md, category FROM kb_articles WHERE slug = ? AND status = 'published' LIMIT 1",
    )
      .bind(cleanSlug)
      .first()) as Record<string, unknown> | null;
    if (!row) return json({ error: 'Article non trouvé' }, 404);

    // Incrément view_count best-effort (ne casse jamais la lecture).
    try {
      await env.DB.prepare(
        'UPDATE kb_articles SET view_count = view_count + 1 WHERE id = ?',
      )
        .bind(row.id as string)
        .run();
    } catch {
      /* best-effort */
    }

    // AUCUNE donnée tenant sensible (pas de client_id/agency_id/id interne).
    const responseBody = JSON.stringify({
      data: {
        slug: row.slug ?? null,
        title: row.title ?? null,
        body_md: row.body_md ?? null,
        category: row.category ?? null,
      },
    });
    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch {
    // Table seq 89 absente / panne D1 : best-effort → 404 propre.
    return json({ error: 'Article non trouvé' }, 404);
  }
}
