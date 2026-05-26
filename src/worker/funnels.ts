// ── funnels.ts — LOT FUNNEL (Sprint 1) ─────────────────────────────────────
//
// Handlers backend du builder de funnels / landing pages.
//
// ⚠ CORPS RÉELS PHASE B — signatures FIGÉES Phase A (Manager-A SOLO). Les
//   signatures (ordre/typage des params, forme de la Response) NE CHANGENT
//   PAS : worker.ts (gelé Phase A) câble déjà ces handlers. Contrat §6
//   verbatim dans docs/LOT-FUNNEL.md.
//
// Conventions imposées (docs/LOT-FUNNEL.md §6.D/§6.F/§6.I) respectées :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.A).
//   - Garde capability : requireCapability(auth.capabilities, 'workflows.manage')
//     en tête des handlers protégés (réutilise la capability EXISTANTE — AUCUN
//     ajout à ALL_CAPABILITIES). Pattern calqué clients-admin.ts:93-97.
//   - Bornage tenant : calque clients-admin.ts:assertClientInTenant
//     (isLegacy → pas de garde nouvelle ; mode agence → agency_id ∈ tenant
//     OU client_id ∈ accessibleClientIds, sinon 404 'Funnel introuvable').
//   - Submit → lead : RÉUTILISE le pipeline forms.ts (PAS de dup dedup) :
//       * applyLeadMapping (lead-mapping.ts)        — calque forms.ts:78,80
//       * resolveDedup / mergeIntoLead (lead-dedup) — calque forms.ts:87-98
//       * logIngestConsent (leads.ts)               — calque forms.ts:79,102
//       * INSERT leads borné client_id, source = 'funnel' (≠ 'form')
//       * autoEnrollForTrigger(env,'form_submitted',leadId) — forms.ts:131
//     client_id résolu depuis funnel_publications (slug → row). Cf. §6.F.
//   - Compteurs : UPDATE funnels.total_views/total_submissions += 1
//     (calque forms.total_submissions forms.ts:34-36) + INSERT
//     funnel_analytics (event_type view/submit/conversion).
//   - Stats : GROUP BY date(created_at) (calque handleGetFormStats
//     forms.ts:186-190).
//   - best-effort : table/colonne absente → réponse propre (404 / {data:[]}),
//     JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';

// Auth enrichi au choke-point (worker.ts) — calque le type passé à
// routeProtected (userId/role/clientId/tenant/capabilities).
type FunnelAuth = CapAuth & { capabilities?: Set<string> };

// ── Garde capability (calque clients-admin.ts:93-97) ────────────────────────
// Réutilise 'workflows.manage' (déjà dans ALL_CAPABILITIES). En legacy/
// mono-tenant le set est LARGE ⇒ pas de régression ; bridage viewer actif
// seulement en mode agence.
function capGuard(auth: FunnelAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// ── Bornage tenant sur un funnel (calque clients-admin.ts:isLegacy +
//    assertClientInTenant ; cible = funnels.id) ─────────────────────────────
//   - Legacy/mono-tenant (!tenant || agencyId == null) → undefined : endpoint
//     NEUF, rétro-compat byte-équivalente à l'absence historique de borne.
//   - Mode agence (agencyId != null) → le funnel doit avoir
//     client_id ∈ accessibleClientIds OU agency_id == auth.tenant.agencyId,
//     sinon json({error:'Funnel introuvable'},404).
// Renvoie la row funnel (best-effort) ou une Response 404.
async function loadFunnelInTenant(
  env: Env,
  funnelId: string,
  auth: FunnelAuth,
): Promise<Record<string, unknown> | Response> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare(
      'SELECT * FROM funnels WHERE id = ?',
    )
      .bind(funnelId)
      .first()) as Record<string, unknown> | null;
  } catch {
    // Table seq 83 absente / panne D1 : best-effort → 404 propre.
    return json({ error: 'Funnel introuvable' }, 404);
  }
  if (!row) return json({ error: 'Funnel introuvable' }, 404);

  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return row;

  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;

  const inTenant =
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId);
  if (!inTenant) return json({ error: 'Funnel introuvable' }, 404);
  return row;
}

// Slug applicatif : slugify + suffixe court si collision (unicité côté handler,
// PAS de UNIQUE SQL — §6.B/§6.E).
function slugify(input: string): string {
  const base = (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'funnel';
}

// ── PROTÉGÉ : liste des funnels du tenant ───────────────────────────────────
export async function handleGetFunnels(
  env: Env,
  auth: FunnelAuth,
  _url: URL,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  try {
    const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
    let sql = 'SELECT * FROM funnels';
    const binds: unknown[] = [];

    if (!isLegacy) {
      // Mode agence : borne aux funnels du périmètre (client OU agence).
      const agencyId = auth.tenant!.agencyId as string;
      const accessible = auth.tenant!.accessibleClientIds || [];
      const conds: string[] = ['agency_id = ?'];
      binds.push(agencyId);
      if (accessible.length > 0) {
        conds.push(
          `client_id IN (${accessible.map(() => '?').join(',')})`,
        );
        binds.push(...accessible);
      }
      sql += ` WHERE ${conds.join(' OR ')}`;
    }
    sql += ' ORDER BY created_at DESC LIMIT 200';

    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: results || [] });
  } catch {
    // Table seq 83 absente : best-effort → liste vide.
    return json({ data: [] });
  }
}

// ── PROTÉGÉ : création d'un funnel (+ étapes par défaut optionnelles) ────────
export async function handleCreateFunnel(
  request: Request,
  env: Env,
  auth: FunnelAuth,
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
  const name = sanitizeInput((body.name as string) || 'Funnel sans titre', 200);
  const description = sanitizeInput((body.description as string) || '', 500);
  const industry = sanitizeInput((body.industry as string) || '', 80);
  const status = ['draft', 'published', 'archived'].includes(
    body.status as string,
  )
    ? (body.status as string)
    : 'draft';

  // client_id / agency_id POSÉS depuis le tenant à la création (§6.D).
  const clientId = auth.tenant?.clientId ?? auth.clientId ?? null;
  const agencyId = auth.tenant?.agencyId ?? null;

  try {
    await env.DB.prepare(
      `INSERT INTO funnels (id, client_id, agency_id, name, description, status, industry)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, clientId, agencyId, name, description, status, industry || null)
      .run();

    // Étapes par défaut optionnelles (liste ordonnée) — chaque étape porte
    // 0..1 page (relation applicative 1:1 ; §6.B).
    const steps = Array.isArray(body.steps)
      ? (body.steps as Array<Record<string, unknown>>)
      : [];
    let pos = 0;
    for (const s of steps) {
      const stepId = crypto.randomUUID();
      const stepName = sanitizeInput((s.name as string) || 'Étape', 200);
      const stepType = [
        'optin',
        'content',
        'upsell',
        'thankyou',
        'generic',
      ].includes(s.step_type as string)
        ? (s.step_type as string)
        : 'content';
      await env.DB.prepare(
        `INSERT INTO funnel_steps (id, funnel_id, name, step_type, position)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(stepId, id, stepName, stepType, pos)
        .run();
      // Page vide associée (blocks '[]'), lecture/écriture atomique ensuite.
      await env.DB.prepare(
        `INSERT INTO funnel_pages (id, funnel_id, step_id, title, blocks)
         VALUES (?, ?, ?, ?, '[]')`,
      )
        .bind(crypto.randomUUID(), id, stepId, stepName)
        .run();
      pos++;
    }
    return json({ data: { id } }, 201);
  } catch {
    // Table seq 83 absente : best-effort → réponse propre, pas de 500.
    return json({ error: 'Création impossible' }, 404);
  }
}

// ── PROTÉGÉ : détail d'un funnel (funnel + steps + pages) ────────────────────
export async function handleGetFunnel(
  env: Env,
  auth: FunnelAuth,
  funnelId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const funnelOr = await loadFunnelInTenant(env, funnelId, auth);
  if (funnelOr instanceof Response) return funnelOr;
  const funnel = funnelOr;

  try {
    const { results: stepRows } = await env.DB.prepare(
      'SELECT * FROM funnel_steps WHERE funnel_id = ? ORDER BY position ASC',
    )
      .bind(funnelId)
      .all();

    const { results: pageRows } = await env.DB.prepare(
      'SELECT * FROM funnel_pages WHERE funnel_id = ?',
    )
      .bind(funnelId)
      .all();

    const pagesByStep = new Map<string, Record<string, unknown>>();
    for (const p of (pageRows || []) as Array<Record<string, unknown>>) {
      let blocks: unknown = [];
      try {
        blocks = JSON.parse((p.blocks as string) || '[]');
      } catch {
        blocks = [];
      }
      pagesByStep.set(p.step_id as string, { ...p, blocks });
    }

    const steps = ((stepRows || []) as Array<Record<string, unknown>>).map(
      (s) => ({ ...s, page: pagesByStep.get(s.id as string) ?? null }),
    );

    const pub = (await env.DB.prepare(
      'SELECT slug, is_active FROM funnel_publications WHERE funnel_id = ? AND is_active = 1 ORDER BY published_at DESC LIMIT 1',
    )
      .bind(funnelId)
      .first()) as { slug: string; is_active: number } | null;

    return json({
      data: {
        ...funnel,
        steps,
        publication: pub
          ? { slug: pub.slug, is_active: pub.is_active, url: '/p/' + pub.slug }
          : null,
      },
    });
  } catch {
    // Tables auxiliaires absentes : renvoie au moins le funnel borné.
    return json({ data: { ...funnel, steps: [], publication: null } });
  }
}

// ── PROTÉGÉ : mise à jour d'un funnel (name/description/status/steps) ────────
export async function handleUpdateFunnel(
  request: Request,
  env: Env,
  auth: FunnelAuth,
  funnelId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const funnelOr = await loadFunnelInTenant(env, funnelId, auth);
  if (funnelOr instanceof Response) return funnelOr;

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
  if (typeof body.industry === 'string') {
    sets.push('industry = ?');
    binds.push(sanitizeInput(body.industry, 80));
  }
  if (
    typeof body.status === 'string' &&
    ['draft', 'published', 'archived'].includes(body.status)
  ) {
    sets.push('status = ?');
    binds.push(body.status);
  }

  try {
    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      binds.push(funnelId);
      await env.DB.prepare(
        `UPDATE funnels SET ${sets.join(', ')} WHERE id = ?`,
      )
        .bind(...binds)
        .run();
    }

    // Réécriture atomique de la liste d'étapes si fournie (v1 linéaire) :
    // delete-then-insert borné au funnel, pages vides préservées par stepId.
    if (Array.isArray(body.steps)) {
      const steps = body.steps as Array<Record<string, unknown>>;
      const existing = (
        (
          await env.DB.prepare(
            'SELECT id FROM funnel_steps WHERE funnel_id = ?',
          )
            .bind(funnelId)
            .all()
        ).results || []
      ).map((r) => (r as { id: string }).id);
      const keepIds = new Set<string>();
      let pos = 0;
      for (const s of steps) {
        const stepType = [
          'optin',
          'content',
          'upsell',
          'thankyou',
          'generic',
        ].includes(s.step_type as string)
          ? (s.step_type as string)
          : 'content';
        const stepName = sanitizeInput((s.name as string) || 'Étape', 200);
        const existingId =
          typeof s.id === 'string' && existing.includes(s.id) ? s.id : null;
        if (existingId) {
          keepIds.add(existingId);
          await env.DB.prepare(
            `UPDATE funnel_steps SET name = ?, step_type = ?, position = ?, updated_at = datetime('now') WHERE id = ? AND funnel_id = ?`,
          )
            .bind(stepName, stepType, pos, existingId, funnelId)
            .run();
        } else {
          const newId = crypto.randomUUID();
          keepIds.add(newId);
          await env.DB.prepare(
            `INSERT INTO funnel_steps (id, funnel_id, name, step_type, position) VALUES (?, ?, ?, ?, ?)`,
          )
            .bind(newId, funnelId, stepName, stepType, pos)
            .run();
          await env.DB.prepare(
            `INSERT INTO funnel_pages (id, funnel_id, step_id, title, blocks) VALUES (?, ?, ?, ?, '[]')`,
          )
            .bind(crypto.randomUUID(), funnelId, newId, stepName)
            .run();
        }
        pos++;
      }
      // Suppression des étapes retirées (+ leurs pages) — borné funnel.
      for (const oldId of existing) {
        if (!keepIds.has(oldId)) {
          await env.DB.prepare(
            'DELETE FROM funnel_pages WHERE funnel_id = ? AND step_id = ?',
          )
            .bind(funnelId, oldId)
            .run();
          await env.DB.prepare(
            'DELETE FROM funnel_steps WHERE id = ? AND funnel_id = ?',
          )
            .bind(oldId, funnelId)
            .run();
        }
      }
    }

    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Funnel introuvable' }, 404);
  }
}

// ── PROTÉGÉ : suppression d'un funnel ───────────────────────────────────────
export async function handleDeleteFunnel(
  env: Env,
  auth: FunnelAuth,
  funnelId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const funnelOr = await loadFunnelInTenant(env, funnelId, auth);
  if (funnelOr instanceof Response) return funnelOr;

  try {
    // Suppression dure du funnel + objets applicatifs (zéro FK, jointures
    // applicatives bornées funnel_id). Analytics conservées (audit).
    await env.DB.prepare('DELETE FROM funnel_pages WHERE funnel_id = ?')
      .bind(funnelId)
      .run();
    await env.DB.prepare('DELETE FROM funnel_steps WHERE funnel_id = ?')
      .bind(funnelId)
      .run();
    await env.DB.prepare(
      'DELETE FROM funnel_publications WHERE funnel_id = ?',
    )
      .bind(funnelId)
      .run();
    await env.DB.prepare('DELETE FROM funnels WHERE id = ?')
      .bind(funnelId)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Funnel introuvable' }, 404);
  }
}

// ── PROTÉGÉ : sauvegarde des blocs d'une page d'étape (write atomique) ───────
// blocks = FunnelBlock[] sérialisé JSON dans funnel_pages.blocks.
export async function handleSaveFunnelPage(
  request: Request,
  env: Env,
  auth: FunnelAuth,
  funnelId: string,
  stepId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const funnelOr = await loadFunnelInTenant(env, funnelId, auth);
  if (funnelOr instanceof Response) return funnelOr;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  // L'étape doit appartenir au funnel borné (jointure applicative).
  let step: { id: string } | null = null;
  try {
    step = (await env.DB.prepare(
      'SELECT id FROM funnel_steps WHERE id = ? AND funnel_id = ?',
    )
      .bind(stepId, funnelId)
      .first()) as { id: string } | null;
  } catch {
    return json({ error: 'Étape introuvable' }, 404);
  }
  if (!step) return json({ error: 'Étape introuvable' }, 404);

  // blocks : lecture/écriture ATOMIQUE de toute la liste (FunnelBlock[]).
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  const blocksJson = JSON.stringify(blocks);
  const settingsJson =
    body.settings_json != null ? String(body.settings_json) : '{}';
  const title = sanitizeInput((body.title as string) || '', 200);
  const seoTitle = sanitizeInput((body.seo_title as string) || '', 200);
  const seoDesc = sanitizeInput((body.seo_description as string) || '', 500);
  const seoImage = sanitizeInput((body.seo_image as string) || '', 500);

  try {
    const existing = (await env.DB.prepare(
      'SELECT id FROM funnel_pages WHERE funnel_id = ? AND step_id = ?',
    )
      .bind(funnelId, stepId)
      .first()) as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        `UPDATE funnel_pages SET title = ?, blocks = ?, settings_json = ?,
           seo_title = ?, seo_description = ?, seo_image = ?,
           updated_at = datetime('now')
         WHERE funnel_id = ? AND step_id = ?`,
      )
        .bind(
          title,
          blocksJson,
          settingsJson,
          seoTitle || null,
          seoDesc || null,
          seoImage || null,
          funnelId,
          stepId,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO funnel_pages (id, funnel_id, step_id, title, blocks,
           settings_json, seo_title, seo_description, seo_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          funnelId,
          stepId,
          title,
          blocksJson,
          settingsJson,
          seoTitle || null,
          seoDesc || null,
          seoImage || null,
        )
        .run();
    }
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Page introuvable' }, 404);
  }
}

// ── PROTÉGÉ : publication d'un funnel (slug tenant, unicité applicative) ─────
export async function handlePublishFunnel(
  request: Request,
  env: Env,
  auth: FunnelAuth,
  funnelId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const funnelOr = await loadFunnelInTenant(env, funnelId, auth);
  if (funnelOr instanceof Response) return funnelOr;
  const funnel = funnelOr;

  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  try {
    // Slug souhaité ou dérivé du nom.
    let slug = slugify(
      (body.slug as string) || (funnel.name as string) || funnelId,
    );

    // Unicité APPLICATIVE : collision si pris par un AUTRE funnel (§6.E).
    const collides = async (s: string): Promise<boolean> => {
      const hit = (await env.DB.prepare(
        'SELECT 1 AS x FROM funnel_publications WHERE slug = ? AND funnel_id <> ? LIMIT 1',
      )
        .bind(s, funnelId)
        .first()) as { x: number } | null;
      return !!hit;
    };

    if (await collides(slug)) {
      // Si l'appelant a explicitement demandé ce slug → 409 (§6.E verbatim).
      if (typeof body.slug === 'string' && slugify(body.slug) === slug) {
        return json({ error: 'Cette adresse est déjà utilisée' }, 409);
      }
      // Sinon : régénère un slug libre (suffixe court).
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
      (funnel.client_id as string | null) ??
      auth.tenant?.clientId ??
      auth.clientId ??
      null;
    const agencyId =
      (funnel.agency_id as string | null) ?? auth.tenant?.agencyId ?? null;

    // Upsert publication : une seule ligne active par funnel.
    const existing = (await env.DB.prepare(
      'SELECT id FROM funnel_publications WHERE funnel_id = ? LIMIT 1',
    )
      .bind(funnelId)
      .first()) as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        `UPDATE funnel_publications SET slug = ?, client_id = ?, agency_id = ?,
           is_active = 1, published_at = datetime('now'), updated_at = datetime('now')
         WHERE funnel_id = ?`,
      )
        .bind(slug, clientId, agencyId, funnelId)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO funnel_publications (id, funnel_id, client_id, agency_id, slug, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
        .bind(crypto.randomUUID(), funnelId, clientId, agencyId, slug)
        .run();
    }

    await env.DB.prepare(
      "UPDATE funnels SET status = 'published', updated_at = datetime('now') WHERE id = ?",
    )
      .bind(funnelId)
      .run();

    return json({ data: { slug, url: '/p/' + slug } });
  } catch {
    return json({ error: 'Publication impossible' }, 404);
  }
}

// ── PROTÉGÉ : statistiques d'un funnel (vues/soumissions/conversions) ────────
export async function handleGetFunnelStats(
  env: Env,
  auth: FunnelAuth,
  funnelId: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const funnelOr = await loadFunnelInTenant(env, funnelId, auth);
  if (funnelOr instanceof Response) return funnelOr;
  const funnel = funnelOr;

  const totalViews = Number(funnel.total_views) || 0;
  const totalSubs = Number(funnel.total_submissions) || 0;
  const totalConv = Number(funnel.total_conversions) || 0;
  const conversionRate =
    totalViews > 0 ? ((totalSubs / totalViews) * 100).toFixed(1) : '0.0';

  let viewsByDay: unknown[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT date(created_at) as day, COUNT(*) as count
         FROM funnel_analytics WHERE funnel_id = ? AND event_type = 'view'
         GROUP BY date(created_at) ORDER BY day DESC LIMIT 30`,
    )
      .bind(funnelId)
      .all();
    viewsByDay = results || [];
  } catch {
    viewsByDay = [];
  }

  return json({
    data: {
      total_views: totalViews,
      total_submissions: totalSubs,
      total_conversions: totalConv,
      conversion_rate: conversionRate,
      views_by_day: viewsByDay,
    },
  });
}

// ── Résolution slug d'un path /api/p/:slug[...] ─────────────────────────────
function slugFromPath(pathname: string): string {
  const m = pathname.match(/^\/api\/p\/([^/]+)/);
  return m ? decodeURIComponent(m[1]!) : '';
}

// ── PUBLIC (pré-requireAuth) : rendu d'un funnel publié par slug ─────────────
// Résout funnel_publications(slug, is_active=1) → funnel + steps + pages.
// Renvoie SEULEMENT les données publiables (aucun agency_id / id interne
// sensible). Le rendu réel = SPA hydraté front (route /p/$slug).
export async function handlePublicFunnelGet(
  env: Env,
  url: URL,
): Promise<Response> {
  const slug = slugFromPath(url.pathname);
  if (!slug) return json({ error: 'Funnel non trouvé' }, 404);

  try {
    const pub = (await env.DB.prepare(
      "SELECT funnel_id FROM funnel_publications WHERE slug = ? AND is_active = 1 LIMIT 1",
    )
      .bind(slug)
      .first()) as { funnel_id: string } | null;
    if (!pub) return json({ error: 'Funnel non trouvé' }, 404);

    const funnel = (await env.DB.prepare(
      "SELECT id, name, description, status, industry FROM funnels WHERE id = ? AND status = 'published'",
    )
      .bind(pub.funnel_id)
      .first()) as Record<string, unknown> | null;
    if (!funnel) return json({ error: 'Funnel non trouvé' }, 404);

    const { results: stepRows } = await env.DB.prepare(
      'SELECT id, name, step_type, position FROM funnel_steps WHERE funnel_id = ? ORDER BY position ASC',
    )
      .bind(pub.funnel_id)
      .all();

    const { results: pageRows } = await env.DB.prepare(
      `SELECT step_id, title, blocks, seo_title, seo_description, seo_image
         FROM funnel_pages WHERE funnel_id = ?`,
    )
      .bind(pub.funnel_id)
      .all();

    const pagesByStep = new Map<string, Record<string, unknown>>();
    for (const p of (pageRows || []) as Array<Record<string, unknown>>) {
      let blocks: unknown = [];
      try {
        blocks = JSON.parse((p.blocks as string) || '[]');
      } catch {
        blocks = [];
      }
      pagesByStep.set(p.step_id as string, {
        title: p.title ?? null,
        blocks,
        seo_title: p.seo_title ?? null,
        seo_description: p.seo_description ?? null,
        seo_image: p.seo_image ?? null,
      });
    }

    const steps = ((stepRows || []) as Array<Record<string, unknown>>).map(
      (s) => ({
        id: s.id,
        name: s.name,
        step_type: s.step_type,
        position: s.position,
        page: pagesByStep.get(s.id as string) ?? null,
      }),
    );

    // AUCUNE donnée tenant sensible (pas d'agency_id / client_id).
    const body = JSON.stringify({
      data: {
        funnel: {
          id: funnel.id,
          name: funnel.name,
          description: funnel.description ?? null,
          status: funnel.status,
          industry: funnel.industry ?? null,
        },
        steps,
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch {
    // Table seq 83 absente / panne D1 : best-effort → 404 propre.
    return json({ error: 'Funnel non trouvé' }, 404);
  }
}

// ── PUBLIC : soumission d'un formulaire de funnel → lead CRM ────────────────
// RÉUTILISE le pipeline forms.ts (applyLeadMapping / resolveDedup /
// mergeIntoLead / logIngestConsent / INSERT leads / autoEnrollForTrigger).
// source = 'funnel'. client_id résolu depuis funnel_publications. Cf. §6.F.
export async function handlePublicFunnelSubmit(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  if (!slug) return json({ error: 'Funnel non trouvé' }, 404);

  let raw: Record<string, unknown>;
  try {
    raw = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }
  // payload public = { step_id?, data } (calque submitPublicFunnel api.ts +
  // forms.ts:body.data). Le bloc form poste ses champs sous `data`.
  const stepId =
    typeof raw.step_id === 'string' ? (raw.step_id as string) : null;
  const data =
    raw.data && typeof raw.data === 'object'
      ? (raw.data as Record<string, unknown>)
      : (raw as Record<string, unknown>);

  // 1) Résoudre la publication (404 sinon). client_id du lead = celui de
  //    funnel_publications (PAS du payload) — §6.F.1.
  let pub: { funnel_id: string; client_id: string | null } | null = null;
  try {
    pub = (await env.DB.prepare(
      'SELECT funnel_id, client_id FROM funnel_publications WHERE slug = ? AND is_active = 1 LIMIT 1',
    )
      .bind(slug)
      .first()) as { funnel_id: string; client_id: string | null } | null;
  } catch {
    return json({ error: 'Funnel non trouvé' }, 404);
  }
  if (!pub) return json({ error: 'Funnel non trouvé' }, 404);

  const funnelId = pub.funnel_id;
  const clientId = pub.client_id || '';
  const subId = crypto.randomUUID();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';

  // 2) Analytics submit + incrément compteur dénormalisé (calque
  //    forms.ts:34-36). Best-effort : n'empêche jamais la création du lead.
  try {
    await env.DB.prepare(
      `INSERT INTO funnel_analytics (id, funnel_id, step_id, event_type, ip, user_agent)
       VALUES (?, ?, ?, 'submit', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        funnelId,
        stepId,
        ip,
        sanitizeInput(ua, 300),
      )
      .run();
    await env.DB.prepare(
      'UPDATE funnels SET total_submissions = total_submissions + 1 WHERE id = ?',
    )
      .bind(funnelId)
      .run();
  } catch {
    /* best-effort */
  }

  // 3) Mapping + dedup + lead — RÉUTILISE les helpers forms.ts (zéro dup).
  //    Imports dynamiques IDENTIQUES à forms.ts:78-87.
  let leadId = '';
  try {
    const d = data as Record<string, string>;
    const fName = sanitizeInput(d.name || d.nom || '', 100);
    const fEmail = sanitizeInput(d.email || '', 200).toLowerCase();
    const fPhone = sanitizeInput(d.phone || d.telephone || '', 30);
    const fMsg = sanitizeInput(d.message || d.note || '', 2000);

    const { applyLeadMapping } = await import('./lead-mapping');
    const { logIngestConsent } = await import('./leads');
    const { resolveDedup, mergeIntoLead } = await import('./lead-dedup');
    const { autoEnrollForTrigger } = await import('./workflows');
    const { audit } = await import('./helpers');

    const m = applyLeadMapping(data, null);
    const consentStatus =
      m.consent === true
        ? 'granted'
        : m.consent === false
          ? 'denied'
          : 'unknown';
    const attr = m.attribution;

    const decision = await resolveDedup(env, 'email_phone', {
      clientId,
      email: fEmail,
      phone: fPhone,
    });

    if (decision.action !== 'create' && decision.existingId) {
      leadId = decision.existingId;
      if (decision.action === 'merge') {
        await mergeIntoLead(env, leadId, {
          name: fName,
          phone: fPhone,
          message: fMsg,
          ...attr,
        });
        await audit(
          env,
          leadId,
          'updated',
          'Lead enrichi via funnel public',
          '',
        );
      }
      await logIngestConsent(env, request, leadId, m.consent, consentStatus);
    } else {
      leadId = crypto.randomUUID();
      // source = 'funnel' (≠ 'form'), colonnes attribution/consent
      // IDENTIQUES à forms.ts:106-113.
      await env.DB.prepare(
        `INSERT INTO leads (id, client_id, name, email, phone, source, message, status, pipeline_id, stage_id,
           utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, referrer, consent_status)
         VALUES (?, ?, ?, ?, ?, 'funnel', ?, 'new', 'pipeline-default', 'stage-new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      await logIngestConsent(env, request, leadId, m.consent, consentStatus);
    }

    // Le funnel déclenche le MÊME trigger workflow que les forms (§6.F.3).
    await autoEnrollForTrigger(env, 'form_submitted', leadId);

    // Analytics conversion + compteur dénormalisé (§6.G). Best-effort.
    try {
      await env.DB.prepare(
        `INSERT INTO funnel_analytics (id, funnel_id, step_id, event_type, lead_id, ip, user_agent)
         VALUES (?, ?, ?, 'conversion', ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          funnelId,
          stepId,
          leadId,
          ip,
          sanitizeInput(ua, 300),
        )
        .run();
      await env.DB.prepare(
        'UPDATE funnels SET total_conversions = total_conversions + 1 WHERE id = ?',
      )
        .bind(funnelId)
        .run();
    } catch {
      /* best-effort */
    }
  } catch {
    // Pipeline lead indisponible (table absente / panne) : on n'échoue pas
    // la soumission publique — la submission analytics est déjà posée.
    return json(
      { data: { id: subId, success_message: '', redirect_url: '' } },
      201,
    );
  }

  // 4) Réponse calquée forms.ts:134-142 (sans quiz). success_message /
  //    redirect_url proviennent de la config du bloc form (front).
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
    {
      data: {
        id: subId,
        success_message: successMessage,
        redirect_url: redirectUrl,
      },
    },
    201,
  );
}

// ── PUBLIC : tracking d'événement funnel (view) ─────────────────────────────
// INSERT funnel_analytics + UPDATE compteur dénormalisé funnels.total_views.
// Best-effort, ne throw JAMAIS (calque handleTrackFormView forms.ts:147-165).
export async function handleTrackFunnelEvent(
  request: Request,
  env: Env,
  slug: string,
): Promise<Response> {
  if (!slug) return json({ data: { success: true } });

  try {
    const pub = (await env.DB.prepare(
      'SELECT funnel_id FROM funnel_publications WHERE slug = ? AND is_active = 1 LIMIT 1',
    )
      .bind(slug)
      .first()) as { funnel_id: string } | null;
    if (!pub) return json({ data: { success: true } });

    let stepId: string | null = null;
    try {
      const raw = (await request.json()) as Record<string, unknown> | null;
      if (raw && typeof raw.step_id === 'string') stepId = raw.step_id;
    } catch {
      /* corps optionnel */
    }

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ua = request.headers.get('User-Agent') || '';

    await env.DB.prepare(
      `INSERT INTO funnel_analytics (id, funnel_id, step_id, event_type, ip, user_agent)
       VALUES (?, ?, ?, 'view', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        pub.funnel_id,
        stepId,
        ip,
        sanitizeInput(ua, 300),
      )
      .run();
    await env.DB.prepare(
      'UPDATE funnels SET total_views = total_views + 1 WHERE id = ?',
    )
      .bind(pub.funnel_id)
      .run();
  } catch {
    /* best-effort : jamais de throw, jamais de 500 */
  }
  return json({ data: { success: true } });
}
