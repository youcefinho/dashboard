// ── sites.ts — LOT SITE BUILDER (Sprint 10) ─────────────────────────────────
//
// Handlers backend du builder de SITES multi-pages. CALQUE STRUCTUREL de
// funnels.ts (seq 83) : un `site` = conteneur de N `site_pages` adressables +
// une navigation (`nav_json`). Le moteur de blocs est RÉUTILISÉ : les blocs
// d'une page sont des `FunnelBlock[]` (funnel-blocks.ts) ; le rendu public
// compile via `compileBlocksToHtml` IMPORTÉ de funnel-blocks + la nav via
// `compileNavToHtml` (site-nav.ts) ; la capture form RÉUTILISE le pipeline
// forms.ts (calque funnels.ts:handlePublicFunnelSubmit).
//
// ⚠ STUBS PHASE A — SIGNATURES FIGÉES (Manager-A SOLO). Les corps RÉELS sont
//   écrits Phase B par Manager-B. worker.ts (gelé Phase A) câble déjà ces
//   handlers ; l'ordre/typage des params et la forme de la Response NE CHANGENT
//   PAS. Contrat §6 verbatim dans docs/LOT-SITE-BUILDER.md. Les stubs renvoient
//   des réponses propres ({ data: [] } / 404) — JAMAIS de 500/throw — pour ne
//   pas casser le build/les imports tant que les corps ne sont pas écrits.
//
// Conventions imposées (docs/LOT-SITE-BUILDER.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur. JAMAIS
//     de champ `code` (apiFetch / ApiResponse GELÉS — §6.A).
//   - Garde capability : requireCapability(auth.capabilities, 'workflows.manage')
//     en tête des handlers protégés (RÉUTILISE la capability EXISTANTE — AUCUN
//     ajout à ALL_CAPABILITIES). Calque funnels.ts:capGuard.
//   - Bornage tenant : calque funnels.ts:loadFunnelInTenant (legacy → pas de
//     garde ; mode agence → agency_id ∈ tenant OU client_id ∈ accessibleClientIds,
//     sinon 404 'Site introuvable').
//   - Slug applicatif (slugify + suffixe court si collision) — PAS de UNIQUE SQL.
//   - Public submit → lead : RÉUTILISE le pipeline forms.ts (zéro dup dedup),
//     source='site', client_id résolu depuis site_publications. Cf. §6.F.
//   - best-effort : table/colonne absente → réponse propre, JAMAIS de 500/throw.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
// Moteur de blocs RÉUTILISÉ (GELÉ — import, jamais réécrit) §6.C.
import { compileBlocksToHtml } from './funnel-blocks';
import type { FunnelBlock } from './funnel-blocks';
// Compilateur de nav NEUF (site-nav.ts, owned Manager-B).
import { compileNavToHtml } from './site-nav';
import type { SiteNavItem } from '../lib/api';

// Auth enrichi au choke-point (worker.ts) — calque funnels.ts:FunnelAuth.
type SiteAuth = CapAuth & { capabilities?: Set<string> };

// ── Garde capability (calque funnels.ts:capGuard) ───────────────────────────
// RÉUTILISE 'workflows.manage' (déjà dans ALL_CAPABILITIES). En legacy/mono-
// tenant le set est LARGE ⇒ pas de régression ; bridage actif en mode agence.
function capGuard(auth: SiteAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// ── Bornage tenant sur un site (calque funnels.ts:loadFunnelInTenant) ────────
// PHASE B : charge la row sites + applique le bornage tenant. Renvoie la row
// (best-effort) ou une Response 404.
async function loadSiteInTenant(
  env: Env,
  siteId: string,
  auth: SiteAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM sites WHERE id = ?')
      .bind(siteId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return json({ error: 'Site introuvable' }, 404);
  }
  if (!row) return json({ error: 'Site introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;
  const inTenant =
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId);
  if (!inTenant) return json({ error: 'Site introuvable' }, 404);
  return row;
}

// Slug applicatif : slugify + suffixe court si collision (unicité côté handler,
// PAS de UNIQUE SQL — §6.E). CALQUE funnels.ts:slugify.
function slugify(input: string): string {
  const base = (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'site';
}

// Parse JSON défensif d'une colonne TEXT (blocks / nav_json). Best-effort.
function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  try {
    const v = JSON.parse((raw as string) || '[]');
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PROTÉGÉ — CRUD sites + pages + publish. CORPS RÉELS Phase B (Manager-B).
// ════════════════════════════════════════════════════════════════════════════

// ── PROTÉGÉ : liste des sites du tenant (calque handleGetFunnels) ────────────
export async function handleGetSites(
  env: Env,
  auth: SiteAuth,
  _url: URL,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  try {
    const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
    let sql = 'SELECT * FROM sites';
    const binds: unknown[] = [];

    if (!isLegacy) {
      const agencyId = auth.tenant!.agencyId as string;
      const accessible = auth.tenant!.accessibleClientIds || [];
      const conds: string[] = ['agency_id = ?'];
      binds.push(agencyId);
      if (accessible.length > 0) {
        conds.push(`client_id IN (${accessible.map(() => '?').join(',')})`);
        binds.push(...accessible);
      }
      sql += ` WHERE ${conds.join(' OR ')}`;
    }
    sql += ' ORDER BY created_at DESC LIMIT 200';

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: results || [] });
  } catch {
    // Table seq 111 absente : best-effort → liste vide.
    return json({ data: [] });
  }
}

// ── PROTÉGÉ : création d'un site (+ pages par défaut optionnelles) ───────────
export async function handleCreateSite(
  request: Request,
  env: Env,
  auth: SiteAuth,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const id = crypto.randomUUID();
  const name = sanitizeInput((body.name as string) || 'Site sans titre', 200);
  const description = sanitizeInput((body.description as string) || '', 500);
  const status = ['draft', 'published', 'archived'].includes(
    body.status as string,
  )
    ? (body.status as string)
    : 'draft';
  // theme_json / nav_json sérialisés (nav = SiteNavItem[]). custom_domain ignoré (INACTIF v1).
  const themeJson =
    body.theme_json != null ? String(body.theme_json) : null;
  const navJson = Array.isArray(body.nav_json)
    ? JSON.stringify(body.nav_json)
    : body.nav_json != null
      ? String(body.nav_json)
      : null;

  // client_id / agency_id POSÉS depuis le tenant (JAMAIS depuis le body) — §6.F.
  const clientId = auth.tenant?.clientId ?? auth.clientId ?? null;
  const agencyId = auth.tenant?.agencyId ?? null;

  try {
    await env.DB.prepare(
      `INSERT INTO sites (id, client_id, agency_id, name, description, status, theme_json, nav_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, clientId, agencyId, name, description, status, themeJson, navJson)
      .run();

    // Pages par défaut optionnelles (liste ordonnée) — chaque page = FunnelBlock[].
    const pages = Array.isArray(body.pages)
      ? (body.pages as Array<Record<string, unknown>>)
      : [];
    let pos = 0;
    const usedSlugs = new Set<string>();
    let hasHome = false;
    for (const p of pages) {
      const pageTitle = sanitizeInput((p.title as string) || 'Page', 200);
      let pageSlug = slugify((p.slug as string) || pageTitle || `page-${pos}`);
      while (usedSlugs.has(pageSlug)) {
        pageSlug = `${pageSlug}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 70);
      }
      usedSlugs.add(pageSlug);
      const isHome = p.is_home ? 1 : pos === 0 && !hasHome ? 1 : 0;
      if (isHome) hasHome = true;
      const inNav = p.in_nav === false || p.in_nav === 0 ? 0 : 1;
      const blocksJson = JSON.stringify(
        Array.isArray(p.blocks) ? p.blocks : [],
      );
      await env.DB.prepare(
        `INSERT INTO site_pages (id, site_id, slug, title, blocks, position, is_home, in_nav)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          id,
          pageSlug,
          pageTitle,
          blocksJson,
          pos,
          isHome,
          inNav,
        )
        .run();
      pos++;
    }
    return json({ data: { id } }, 201);
  } catch {
    // Table seq 111 absente : best-effort → réponse propre, pas de 500.
    return json({ error: 'Création impossible' }, 404);
  }
}

// ── PROTÉGÉ : détail d'un site (site + pages + publication) ──────────────────
export async function handleGetSite(
  env: Env,
  auth: SiteAuth,
  siteId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const siteOr = await loadSiteInTenant(env, siteId, auth);
  if (siteOr instanceof Response) return siteOr;
  const site = siteOr;

  try {
    const { results: pageRows } = await env.DB.prepare(
      'SELECT * FROM site_pages WHERE site_id = ? ORDER BY position ASC',
    )
      .bind(siteId)
      .all();
    const pages = ((pageRows || []) as Array<Record<string, unknown>>).map(
      (p) => ({ ...p, blocks: parseJsonArray<FunnelBlock>(p.blocks) }),
    );

    const pub = (await env.DB.prepare(
      'SELECT slug, is_active FROM site_publications WHERE site_id = ? AND is_active = 1 LIMIT 1',
    )
      .bind(siteId)
      .first()) as { slug: string; is_active: number } | null;

    return json({
      data: {
        ...site,
        nav_json: parseJsonArray<SiteNavItem>(site.nav_json),
        pages,
        publication: pub
          ? { slug: pub.slug, is_active: pub.is_active, url: '/site/' + pub.slug }
          : null,
      },
    });
  } catch {
    // Tables auxiliaires absentes : renvoie au moins le site borné.
    return json({ data: { ...site, pages: [], publication: null } });
  }
}

// ── PROTÉGÉ : mise à jour d'un site (name/description/status/theme/nav) ──────
export async function handleUpdateSite(
  request: Request,
  env: Env,
  auth: SiteAuth,
  siteId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const siteOr = await loadSiteInTenant(env, siteId, auth);
  if (siteOr instanceof Response) return siteOr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.name === 'string') {
    sets.push('name = ?');
    binds.push(sanitizeInput(body.name, 200));
  }
  if (typeof body.description === 'string') {
    sets.push('description = ?');
    binds.push(sanitizeInput(body.description, 500));
  }
  if (
    typeof body.status === 'string' &&
    ['draft', 'published', 'archived'].includes(body.status)
  ) {
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (body.theme_json !== undefined) {
    sets.push('theme_json = ?');
    binds.push(body.theme_json != null ? String(body.theme_json) : null);
  }
  if (body.nav_json !== undefined) {
    // nav = SiteNavItem[] sérialisé JSON.
    sets.push('nav_json = ?');
    binds.push(
      Array.isArray(body.nav_json)
        ? JSON.stringify(body.nav_json)
        : body.nav_json != null
          ? String(body.nav_json)
          : null,
    );
  }
  // custom_domain volontairement IGNORÉ (flag INACTIF v1 — §6.E).

  try {
    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      binds.push(siteId);
      await env.DB.prepare(`UPDATE sites SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...binds)
        .run();
    }
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Site introuvable' }, 404);
  }
}

// ── PROTÉGÉ : suppression d'un site (+ pages + publications, zéro FK) ────────
export async function handleDeleteSite(
  env: Env,
  auth: SiteAuth,
  siteId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const siteOr = await loadSiteInTenant(env, siteId, auth);
  if (siteOr instanceof Response) return siteOr;

  try {
    // Suppression dure du site + objets applicatifs (zéro FK, jointures
    // applicatives bornées site_id). Calque handleDeleteFunnel.
    await env.DB.prepare('DELETE FROM site_pages WHERE site_id = ?')
      .bind(siteId)
      .run();
    await env.DB.prepare('DELETE FROM site_publications WHERE site_id = ?')
      .bind(siteId)
      .run();
    await env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(siteId).run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Site introuvable' }, 404);
  }
}

// ── PROTÉGÉ : liste des pages d'un site ──────────────────────────────────────
export async function handleGetSitePages(
  env: Env,
  auth: SiteAuth,
  siteId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const siteOr = await loadSiteInTenant(env, siteId, auth);
  if (siteOr instanceof Response) return siteOr;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM site_pages WHERE site_id = ? ORDER BY position ASC',
    )
      .bind(siteId)
      .all();
    const pages = ((results || []) as Array<Record<string, unknown>>).map(
      (p) => ({ ...p, blocks: parseJsonArray<FunnelBlock>(p.blocks) }),
    );
    return json({ data: pages });
  } catch {
    return json({ data: [] });
  }
}

// ── PROTÉGÉ : création d'une page de site ────────────────────────────────────
export async function handleCreateSitePage(
  request: Request,
  env: Env,
  auth: SiteAuth,
  siteId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const siteOr = await loadSiteInTenant(env, siteId, auth);
  if (siteOr instanceof Response) return siteOr;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const pageId = crypto.randomUUID();
  const title = sanitizeInput((body.title as string) || 'Nouvelle page', 200);

  try {
    // Slug unicité APPLICATIVE PAR site (§6.I.12) : collision → suffixe court.
    let slug = slugify((body.slug as string) || title || 'page');
    const slugTaken = async (s: string): Promise<boolean> => {
      const hit = (await env.DB.prepare(
        'SELECT 1 AS x FROM site_pages WHERE site_id = ? AND slug = ? LIMIT 1',
      )
        .bind(siteId, s)
        .first()) as { x: number } | null;
      return !!hit;
    };
    let tries = 0;
    let candidate = slug;
    while ((await slugTaken(candidate)) && tries < 5) {
      candidate = `${slug}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 70);
      tries++;
    }
    slug = candidate;

    // position = fin de liste ; is_home seulement si demandé ; in_nav défaut 1.
    const cnt = (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM site_pages WHERE site_id = ?',
    )
      .bind(siteId)
      .first()) as { n: number } | null;
    const position = cnt ? Number(cnt.n) || 0 : 0;
    const isHome = body.is_home ? 1 : 0;
    const inNav = body.in_nav === false || body.in_nav === 0 ? 0 : 1;
    const blocksJson = JSON.stringify(
      Array.isArray(body.blocks) ? body.blocks : [],
    );

    await env.DB.prepare(
      `INSERT INTO site_pages (id, site_id, slug, title, blocks, position, is_home, in_nav)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(pageId, siteId, slug, title, blocksJson, position, isHome, inNav)
      .run();
    return json({ data: { id: pageId } }, 201);
  } catch {
    return json({ error: 'Création impossible' }, 404);
  }
}

// ── PROTÉGÉ : sauvegarde d'une page (write atomique des blocs) ───────────────
// blocks = FunnelBlock[] sérialisé JSON dans site_pages.blocks (moteur RÉUTILISÉ).
export async function handleSaveSitePage(
  request: Request,
  env: Env,
  auth: SiteAuth,
  siteId: string,
  pageId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const siteOr = await loadSiteInTenant(env, siteId, auth);
  if (siteOr instanceof Response) return siteOr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  // La page doit appartenir au site borné (re-bornage strict).
  let page: { id: string } | null = null;
  try {
    page = (await env.DB.prepare(
      'SELECT id FROM site_pages WHERE id = ? AND site_id = ?',
    )
      .bind(pageId, siteId)
      .first()) as { id: string } | null;
  } catch {
    return json({ error: 'Page introuvable' }, 404);
  }
  if (!page) return json({ error: 'Page introuvable' }, 404);

  // UPDATE partiel (champs fournis seulement). blocks = write ATOMIQUE de toute
  // la liste FunnelBlock[] (calque handleSaveFunnelPage).
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (Array.isArray(body.blocks)) {
    sets.push('blocks = ?');
    binds.push(JSON.stringify(body.blocks));
  }
  if (typeof body.title === 'string') {
    sets.push('title = ?');
    binds.push(sanitizeInput(body.title, 200));
  }
  if (body.settings_json !== undefined) {
    sets.push('settings_json = ?');
    binds.push(body.settings_json != null ? String(body.settings_json) : null);
  }
  if (typeof body.seo_title === 'string') {
    sets.push('seo_title = ?');
    binds.push(sanitizeInput(body.seo_title, 200) || null);
  }
  if (typeof body.seo_description === 'string') {
    sets.push('seo_description = ?');
    binds.push(sanitizeInput(body.seo_description, 500) || null);
  }
  if (typeof body.seo_image === 'string') {
    sets.push('seo_image = ?');
    binds.push(sanitizeInput(body.seo_image, 500) || null);
  }
  if (typeof body.position === 'number') {
    sets.push('position = ?');
    binds.push(body.position);
  }
  if (body.in_nav !== undefined) {
    sets.push('in_nav = ?');
    binds.push(body.in_nav === false || body.in_nav === 0 ? 0 : 1);
  }

  try {
    // slug : unicité applicative PAR site si modifié (re-bornage).
    if (typeof body.slug === 'string' && body.slug.trim()) {
      let slug = slugify(body.slug);
      const slugTaken = async (s: string): Promise<boolean> => {
        const hit = (await env.DB.prepare(
          'SELECT 1 AS x FROM site_pages WHERE site_id = ? AND slug = ? AND id <> ? LIMIT 1',
        )
          .bind(siteId, s, pageId)
          .first()) as { x: number } | null;
        return !!hit;
      };
      let tries = 0;
      let candidate = slug;
      while ((await slugTaken(candidate)) && tries < 5) {
        candidate = `${slug}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 70);
        tries++;
      }
      slug = candidate;
      sets.push('slug = ?');
      binds.push(slug);
    }

    // is_home : si on passe is_home=1, on démarque les autres pages du site
    // (une seule page d'accueil par site).
    const settingHome = body.is_home === true || body.is_home === 1;
    if (body.is_home !== undefined) {
      sets.push('is_home = ?');
      binds.push(settingHome ? 1 : 0);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      binds.push(pageId, siteId);
      await env.DB.prepare(
        `UPDATE site_pages SET ${sets.join(', ')} WHERE id = ? AND site_id = ?`,
      )
        .bind(...binds)
        .run();
    }

    if (settingHome) {
      await env.DB.prepare(
        'UPDATE site_pages SET is_home = 0 WHERE site_id = ? AND id <> ?',
      )
        .bind(siteId, pageId)
        .run();
    }
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Page introuvable' }, 404);
  }
}

// ── PROTÉGÉ : suppression d'une page de site ─────────────────────────────────
export async function handleDeleteSitePage(
  env: Env,
  auth: SiteAuth,
  siteId: string,
  pageId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const siteOr = await loadSiteInTenant(env, siteId, auth);
  if (siteOr instanceof Response) return siteOr;

  try {
    // Re-bornage strict : id=? AND site_id=?.
    await env.DB.prepare(
      'DELETE FROM site_pages WHERE id = ? AND site_id = ?',
    )
      .bind(pageId, siteId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Page introuvable' }, 404);
  }
}

// ── PROTÉGÉ : publication d'un site (slug tenant, unicité applicative) ───────
export async function handlePublishSite(
  request: Request,
  env: Env,
  auth: SiteAuth,
  siteId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;
  const siteOr = await loadSiteInTenant(env, siteId, auth);
  if (siteOr instanceof Response) return siteOr;
  const site = siteOr;

  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  try {
    // Slug souhaité ou dérivé du nom.
    let slug = slugify(
      (body.slug as string) || (site.name as string) || siteId,
    );

    // Unicité APPLICATIVE : collision si pris par un AUTRE site (§6.D/§6.E).
    const collides = async (s: string): Promise<boolean> => {
      const hit = (await env.DB.prepare(
        'SELECT 1 AS x FROM site_publications WHERE slug = ? AND site_id <> ? LIMIT 1',
      )
        .bind(s, siteId)
        .first()) as { x: number } | null;
      return !!hit;
    };

    if (await collides(slug)) {
      // Slug demandé explicitement ET pris → 409 (§6.D verbatim).
      if (typeof body.slug === 'string' && slugify(body.slug) === slug) {
        return json({ error: 'Cette adresse est déjà utilisée' }, 409);
      }
      // Sinon : régénère un slug libre (suffixe court ≤ 5 essais).
      let tries = 0;
      let candidate = slug;
      while ((await collides(candidate)) && tries < 5) {
        candidate = `${slug}-${Math.random().toString(36).slice(2, 6)}`.slice(
          0,
          70,
        );
        tries++;
      }
      slug = candidate;
    }

    const clientId =
      (site.client_id as string | null) ??
      auth.tenant?.clientId ??
      auth.clientId ??
      null;
    const agencyId =
      (site.agency_id as string | null) ?? auth.tenant?.agencyId ?? null;

    // Upsert publication : une seule ligne active par site.
    const existing = (await env.DB.prepare(
      'SELECT id FROM site_publications WHERE site_id = ? LIMIT 1',
    )
      .bind(siteId)
      .first()) as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        `UPDATE site_publications SET slug = ?, client_id = ?, agency_id = ?, is_active = 1
         WHERE site_id = ?`,
      )
        .bind(slug, clientId, agencyId, siteId)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO site_publications (id, site_id, client_id, agency_id, slug, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
        .bind(crypto.randomUUID(), siteId, clientId, agencyId, slug)
        .run();
    }

    await env.DB.prepare(
      "UPDATE sites SET status = 'published', updated_at = datetime('now') WHERE id = ?",
    )
      .bind(siteId)
      .run();

    return json({ data: { slug, url: '/site/' + slug } });
  } catch {
    return json({ error: 'Publication impossible' }, 404);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC (pré-requireAuth) — rendu d'un site publié par slug. CORPS Phase B.
// ════════════════════════════════════════════════════════════════════════════

// Réponse JSON publique avec Cache-Control public (calque handlePublicFunnelGet).
function publicJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

// Données publiables d'un site (AUCUN agency_id / client_id sensible).
function publicSiteShape(site: Record<string, unknown>) {
  return {
    id: site.id,
    name: site.name ?? null,
    description: site.description ?? null,
    status: site.status,
    theme_json: site.theme_json ?? null,
    total_views: site.total_views ?? 0,
  };
}

// Forme publiable d'une page : on inclut le HTML compilé serveur (blocks +
// nav) pour que le front (PublicSite.tsx) hydrate sans réimplémenter le moteur.
function publicPageShape(
  page: Record<string, unknown>,
  blocks: FunnelBlock[],
  html: string,
) {
  return {
    id: page.id,
    site_id: page.site_id,
    slug: page.slug,
    title: page.title ?? null,
    blocks,
    settings_json: page.settings_json ?? null,
    seo_title: page.seo_title ?? null,
    seo_description: page.seo_description ?? null,
    seo_image: page.seo_image ?? null,
    position: page.position ?? 0,
    is_home: page.is_home ?? 0,
    in_nav: page.in_nav ?? 1,
    html,
  };
}

// Résolution commune : slug → publication active → site + pages + nav. Renvoie
// null (best-effort) si rien de publié / table absente. Bornage public par slug
// vers une publication is_active=1 (site doit être status='published').
async function resolvePublishedSite(
  env: Env,
  slug: string,
): Promise<{
  site: Record<string, unknown>;
  pages: Array<Record<string, unknown>>;
  nav: SiteNavItem[];
} | null> {
  const pub = (await env.DB.prepare(
    'SELECT site_id FROM site_publications WHERE slug = ? AND is_active = 1 LIMIT 1',
  )
    .bind(slug)
    .first()) as { site_id: string } | null;
  if (!pub) return null;

  const site = (await env.DB.prepare(
    "SELECT * FROM sites WHERE id = ? AND status = 'published'",
  )
    .bind(pub.site_id)
    .first()) as Record<string, unknown> | null;
  if (!site) return null;

  const { results: pageRows } = await env.DB.prepare(
    'SELECT * FROM site_pages WHERE site_id = ? ORDER BY position ASC',
  )
    .bind(pub.site_id)
    .all();

  const nav = parseJsonArray<SiteNavItem>(site.nav_json);
  return {
    site,
    pages: (pageRows || []) as Array<Record<string, unknown>>,
    nav,
  };
}

// ── PUBLIC : page d'accueil d'un site publié (`/api/site/:slug`) ─────────────
// Résout site_publications(slug, is_active=1) → site + nav + page is_home=1
// (sinon 1re page par position). Compile les blocks via compileBlocksToHtml
// IMPORTÉ de funnel-blocks + la nav via compileNavToHtml (site-nav.ts). Calque
// funnels.ts:handlePublicFunnelGet (Cache-Control public). best-effort → 404.
export async function handlePublicSiteGet(
  env: Env,
  url: URL,
): Promise<Response> {
  const m = url.pathname.match(/^\/api\/site\/([^/]+)$/);
  const slug = m ? decodeURIComponent(m[1]!) : '';
  if (!slug) return json({ error: 'Site non trouvé' }, 404);

  try {
    const resolved = await resolvePublishedSite(env, slug);
    if (!resolved) return json({ error: 'Site non trouvé' }, 404);
    const { site, pages, nav } = resolved;

    // Page d'accueil : is_home=1, sinon 1re par position.
    const homeRow =
      pages.find((p) => Number(p.is_home) === 1) ?? pages[0] ?? null;

    // Toutes les pages publiables (sans HTML lourd pour la liste — le front
    // navigue ensuite vers /api/site/:slug/:page). On expose blocks + slug.
    const pagesOut = pages.map((p) => ({
      ...publicPageShape(p, parseJsonArray<FunnelBlock>(p.blocks), ''),
      // html omis pour la liste (rempli pour la page d'accueil ci-dessous).
    }));

    // HTML compilé de la page d'accueil = blocks (compileBlocksToHtml IMPORTÉ)
    // + barre de nav (compileNavToHtml). slug de page → nav active.
    let homeOut: ReturnType<typeof publicPageShape> | null = null;
    if (homeRow) {
      const blocks = parseJsonArray<FunnelBlock>(homeRow.blocks);
      const navHtml = compileNavToHtml(nav, {
        siteSlug: slug,
        activeSlug: String(homeRow.slug || ''),
      });
      const doc = compileBlocksToHtml(blocks, {
        slug,
        title:
          (homeRow.seo_title as string) ||
          (homeRow.title as string) ||
          (site.name as string) ||
          'Intralys',
      });
      // Injecte la nav juste après <body> (compileBlocksToHtml retourne un
      // document complet — on n'édite PAS le moteur gelé, on post-traite).
      const html = navHtml
        ? doc.replace(/<body>/i, `<body>\n${navHtml}`)
        : doc;
      homeOut = publicPageShape(homeRow, blocks, html);
    }

    return publicJson({
      data: {
        site: publicSiteShape(site),
        pages: homeOut
          ? pagesOut.map((p) => (p.id === homeOut!.id ? homeOut! : p))
          : pagesOut,
        nav,
      },
    });
  } catch {
    // Table seq 111 absente / panne D1 : best-effort → 404 propre.
    return json({ error: 'Site non trouvé' }, 404);
  }
}

// ── PUBLIC : page interne d'un site publié (`/api/site/:slug/:page`) ─────────
// Résout site_publications(slug) → site, puis site_pages(site_id, slug=page).
// 404 propre si page absente ; compile blocks (compileBlocksToHtml IMPORTÉ) +
// nav (compileNavToHtml). ⚠ Route /:slug/:page câblée AVANT /:slug (anti-shadowing).
export async function handlePublicSitePageGet(
  env: Env,
  url: URL,
): Promise<Response> {
  const m = url.pathname.match(/^\/api\/site\/([^/]+)\/([^/]+)$/);
  const slug = m ? decodeURIComponent(m[1]!) : '';
  const pageSlug = m ? decodeURIComponent(m[2]!) : '';
  if (!slug || !pageSlug) return json({ error: 'Page non trouvée' }, 404);

  try {
    const resolved = await resolvePublishedSite(env, slug);
    if (!resolved) return json({ error: 'Page non trouvée' }, 404);
    const { site, pages, nav } = resolved;

    const pageRow = pages.find((p) => String(p.slug) === pageSlug) ?? null;
    if (!pageRow) return json({ error: 'Page non trouvée' }, 404);

    const blocks = parseJsonArray<FunnelBlock>(pageRow.blocks);
    const navHtml = compileNavToHtml(nav, {
      siteSlug: slug,
      activeSlug: pageSlug,
    });
    const doc = compileBlocksToHtml(blocks, {
      slug,
      title:
        (pageRow.seo_title as string) ||
        (pageRow.title as string) ||
        (site.name as string) ||
        'Intralys',
    });
    const html = navHtml ? doc.replace(/<body>/i, `<body>\n${navHtml}`) : doc;

    return publicJson({
      data: {
        site: publicSiteShape(site),
        page: publicPageShape(pageRow, blocks, html),
        nav,
      },
    });
  } catch {
    return json({ error: 'Page non trouvée' }, 404);
  }
}

// ── PUBLIC : soumission d'un formulaire de page de site → lead CRM ───────────
// RÉUTILISE INTÉGRALEMENT le pipeline forms.ts via funnels.ts:handlePublicFunnelSubmit
// n'est PAS importable tel quel (résout funnel_publications). On CALQUE sa logique
// MAIS en réutilisant les MÊMES helpers forms.ts (applyLeadMapping / resolveDedup /
// mergeIntoLead / logIngestConsent / autoEnrollForTrigger) — ZÉRO duplication de
// la logique de dedup. source='site', client_id résolu depuis site_publications.
//
// ⚠ ÉCART CÂBLAGE (signalé) : worker.ts (GELÉ Phase A) NE câble PAS de route
//   /api/site/:slug/submit — seuls /api/site/:slug et /api/site/:slug/:page (GET)
//   existent. Le bloc `form` compilé par compileBlocksToHtml poste vers
//   POST /api/p/:slug/submit (cible funnel). Ce handler est donc EXPORTÉ et PRÊT
//   (réutilise le pipeline, source='site') pour le jour où une route publique
//   site/submit sera ajoutée ; en l'état un site publié partageant un slug avec
//   un funnel publié router-ait au pipeline funnel. Voir rapport §écarts.
export async function handlePublicSiteSubmit(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  if (!slug) return json({ error: 'Site non trouvé' }, 404);

  let raw: Record<string, unknown>;
  try {
    raw = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }
  const data =
    raw.data && typeof raw.data === 'object'
      ? (raw.data as Record<string, unknown>)
      : (raw as Record<string, unknown>);

  // client_id du lead = celui de site_publications (PAS du payload).
  let pub: { site_id: string; client_id: string | null } | null = null;
  try {
    pub = (await env.DB.prepare(
      'SELECT site_id, client_id FROM site_publications WHERE slug = ? AND is_active = 1 LIMIT 1',
    )
      .bind(slug)
      .first()) as { site_id: string; client_id: string | null } | null;
  } catch {
    return json({ error: 'Site non trouvé' }, 404);
  }
  if (!pub) return json({ error: 'Site non trouvé' }, 404);

  const clientId = pub.client_id || '';
  const subId = crypto.randomUUID();

  try {
    const d = data as Record<string, string>;
    const fName = sanitizeInput(d.name || d.nom || '', 100);
    const fEmail = sanitizeInput(d.email || '', 200).toLowerCase();
    const fPhone = sanitizeInput(d.phone || d.telephone || '', 30);
    const fMsg = sanitizeInput(d.message || d.note || '', 2000);

    // RÉUTILISE les helpers forms.ts (imports dynamiques IDENTIQUES funnels.ts).
    const { applyLeadMapping } = await import('./lead-mapping');
    const { logIngestConsent } = await import('./leads');
    const { resolveDedup, mergeIntoLead } = await import('./lead-dedup');
    const { autoEnrollForTrigger } = await import('./workflows');
    const { audit } = await import('./helpers');

    const mp = applyLeadMapping(data, null);
    const consentStatus =
      mp.consent === true
        ? 'granted'
        : mp.consent === false
          ? 'denied'
          : 'unknown';
    const attr = mp.attribution;

    const decision = await resolveDedup(env, 'email_phone', {
      clientId,
      email: fEmail,
      phone: fPhone,
    });

    let leadId = '';
    if (decision.action !== 'create' && decision.existingId) {
      leadId = decision.existingId;
      if (decision.action === 'merge') {
        await mergeIntoLead(env, leadId, {
          name: fName,
          phone: fPhone,
          message: fMsg,
          ...attr,
        });
        await audit(env, leadId, 'updated', 'Lead enrichi via site public', '');
      }
      await logIngestConsent(env, request, leadId, mp.consent, consentStatus);
    } else {
      leadId = crypto.randomUUID();
      // source = 'site' (≠ 'funnel'/'form'), colonnes IDENTIQUES forms/funnels.
      await env.DB.prepare(
        `INSERT INTO leads (id, client_id, name, email, phone, source, message, status, pipeline_id, stage_id,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, referrer, consent_status)
         VALUES (?, ?, ?, ?, ?, 'site', ?, 'new', 'pipeline-default', 'stage-new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          leadId,
          clientId,
          fName,
          fEmail,
          fPhone,
          fMsg,
          attr.utm_source,
          attr.utm_medium,
          attr.utm_campaign,
          attr.utm_term,
          attr.utm_content,
          attr.gclid,
          attr.fbclid,
          attr.referrer,
          consentStatus,
        )
        .run();
      await logIngestConsent(env, request, leadId, mp.consent, consentStatus);
    }

    // MÊME trigger workflow que forms/funnels.
    await autoEnrollForTrigger(env, 'form_submitted', leadId);
  } catch {
    // Pipeline indisponible : on n'échoue pas la soumission publique.
    return json(
      { data: { id: subId, success_message: '', redirect_url: '' } },
      201,
    );
  }

  const successMessage =
    typeof data.successMessage === 'string'
      ? data.successMessage
      : typeof data.success_message === 'string'
        ? (data.success_message as string)
        : '';
  const redirectUrl =
    typeof data.redirectUrl === 'string'
      ? data.redirectUrl
      : typeof data.redirect_url === 'string'
        ? (data.redirect_url as string)
        : '';

  return json(
    { data: { id: subId, success_message: successMessage, redirect_url: redirectUrl } },
    201,
  );
}
