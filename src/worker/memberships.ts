// ── memberships.ts — LOT MEMBERSHIPS (Sprint 6) ────────────────────────────
//
// CRUD PRO (gestion cours / modules / leçons / membership-sites /
// membership-plans) + endpoints ESPACE MEMBRE (catalogue cours, leçon,
// vidéo R2 gated, progression). Fichier NEUF et ISOLÉ. Auth membre =
// member-auth.ts (table member_sessions, 100% SÉPARÉE). Auth PRO = injectée
// au choke-point worker.ts (CapAuth + capabilities). bookings.ts /
// documents.ts / funnels.ts EXISTANTS intacts (rétro-compat).
//
// ⚠ CORPS RÉELS PHASE B — Manager-B SOLO sur ce fichier. Les signatures
//   (ordre/typage des params, forme de la Response) NE CHANGENT PAS :
//   worker.ts (GELÉ Phase A) câble déjà ces handlers ; src/lib/api.ts (GELÉ
//   Phase A) appelle les endpoints. Contrat §6 verbatim dans
//   docs/LOT-MEMBER6.md (Phase B/C ne lisent QUE ce document + le CODE).
//
// Conventions imposées (docs/LOT-MEMBER6.md §6.A/§6.D/§6.E/§6.F/§6.I) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.A).
//   - Garde capability PROTÉGÉE : requireCapability(auth.capabilities,
//     'workflows.manage') en tête des handlers CRUD (RÉUTILISE la capability
//     EXISTANTE — AUCUN ajout à ALL_CAPABILITIES). Pattern calqué EXACT
//     booking-public.ts:capGuard.
//   - Bornage tenant : calque EXACT booking-public.ts:rowInTenant
//     (isLegacy → pas de garde ; mode agence → client_id ∈
//     accessibleClientIds OU agency_id == tenant.agencyId, sinon 404).
//   - Vidéo R2 gated (§6.E) : calque EXACT documents.ts:handleGetFile
//     (env.FILES.get(r2_key) → stream `new Response(r2Object.body, ...)`,
//     JAMAIS d'URL R2 publique), DERRIÈRE TRIPLE borne
//     member.client_id == lesson.client_id + course_enrollments du memberId
//     vérifié + drip débloqué (enrolled_at + drip_days ≤ now) AVANT
//     env.FILES.get, header `Cache-Control: private`.
//   - Drip / progression (§6.F) : déblocage drip = enrolled_at + drip_days
//     ≤ now ; progression = upsert lesson_progress ON CONFLICT(member_id,
//     lesson_id) (index unique seq 87) ; % = COUNT applicatif.
//   - best-effort : table/colonne seq 87 absente → réponse propre
//     (404 / {data:[]}), JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json } from './helpers';
import { requireCapability, type CapAuth } from './capabilities';
import type { MemberContext } from './member-auth';

// Auth PRO enrichi au choke-point (worker.ts) — calque EXACT
// booking-public.ts:BookingAuth (CapAuth + capabilities injectées).
export type MembershipAuth = CapAuth & { capabilities?: Set<string> };

// ════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNES (corps réels Phase B Manager-B — signatures FIGÉES)
// ════════════════════════════════════════════════════════════════════════════

// Garde capability (calque EXACT booking-public.ts:capGuard). RÉUTILISE
// 'workflows.manage' (déjà dans ALL_CAPABILITIES seq 80 — AUCUN ajout). En
// legacy/mono-tenant le set est LARGE ⇒ pas de régression ; bridage actif
// en mode agence.
export function membershipCapGuard(auth: MembershipAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// Bornage tenant sur une row porteuse de client_id/agency_id (calque EXACT
// booking-public.ts:67 rowInTenant).
//   - Legacy/mono-tenant (!tenant || agencyId == null) → true : endpoints
//     NEUFS, rétro-compat byte-équivalente à l'absence historique de borne.
//   - Mode agence (agencyId != null) → client_id ∈ accessibleClientIds OU
//     agency_id == auth.tenant.agencyId, sinon false ⇒ 404 'Introuvable'.
function rowInTenant(
  row: { client_id?: unknown; agency_id?: unknown },
  auth: MembershipAuth,
): boolean {
  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return true;
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;
  return (
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId)
  );
}

// client_id / agency_id POSÉS depuis le tenant à la création (§6.D — calque
// booking-public.ts:1081). Legacy → auth.clientId ; agence → tenant.
function tenantIds(auth: MembershipAuth): {
  clientId: string | null;
  agencyId: string | null;
} {
  return {
    clientId: auth.tenant?.clientId ?? auth.clientId ?? null,
    agencyId: auth.tenant?.agencyId ?? null,
  };
}

// Drip débloqué : enrolled_at + drip_days jours ≤ now (§6.F). drip_days = 0
// ⇒ disponible dès l'inscription. Calcul applicatif (pas de cron).
function dripUnlocked(enrolledAt: string | null, dripDays: number): boolean {
  if (!dripDays || dripDays <= 0) return true;
  if (!enrolledAt) return false;
  const base = new Date(enrolledAt.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(base)) return true; // date illisible : ne pas bloquer
  return base + dripDays * 86_400_000 <= Date.now();
}

// ════════════════════════════════════════════════════════════════════════════
// CRUD PRO — courses (PROTÉGÉ — capability 'workflows.manage')
// ════════════════════════════════════════════════════════════════════════════

// GET /api/courses — liste des cours du tenant.
export async function handleListCourses(
  env: Env,
  auth: MembershipAuth,
  _url: URL,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, agency_id, site_id, plan_id, title, description,
              is_published, created_at
         FROM courses ORDER BY created_at DESC`,
    ).all();
    const rows = (results || []).filter((r) =>
      rowInTenant(r as Record<string, unknown>, auth),
    );
    return json({ data: rows });
  } catch {
    return json({ data: [] });
  }
}

// POST /api/courses — crée un cours borné au tenant.
export async function handleCreateCourse(
  request: Request,
  env: Env,
  auth: MembershipAuth,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const { clientId, agencyId } = tenantIds(auth);
  const id = crypto.randomUUID();
  const title = String(body.title || 'Cours').slice(0, 200);
  const description = body.description ? String(body.description).slice(0, 2000) : null;
  const siteId = body.site_id ? String(body.site_id).slice(0, 60) : null;
  const planId = body.plan_id ? String(body.plan_id).slice(0, 60) : null;
  const isPublished = body.is_published ? 1 : 0;

  try {
    await env.DB.prepare(
      `INSERT INTO courses (id, client_id, agency_id, site_id, plan_id, title, description, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, clientId, agencyId, siteId, planId, title, description, isPublished)
      .run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Création de cours indisponible' }, 503);
  }
}

// GET /api/courses/:id — détail (cours + modules + leçons), borné tenant.
export async function handleGetCourse(
  env: Env,
  auth: MembershipAuth,
  courseId: string,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    const course = (await env.DB.prepare(
      'SELECT * FROM courses WHERE id = ? LIMIT 1',
    )
      .bind(courseId)
      .first()) as Record<string, unknown> | null;
    if (!course || !rowInTenant(course, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }
    const { results: modules } = await env.DB.prepare(
      'SELECT id, course_id, title, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, created_at ASC',
    )
      .bind(courseId)
      .all();
    const { results: lessons } = await env.DB.prepare(
      `SELECT id, module_id, course_id, title, content_type, body_html,
              (r2_key IS NOT NULL AND r2_key != '') AS has_video, drip_days, sort_order
         FROM lessons WHERE course_id = ? ORDER BY sort_order ASC, created_at ASC`,
    )
      .bind(courseId)
      .all();
    return json({ data: { ...course, modules: modules || [], lessons: lessons || [] } });
  } catch {
    return json({ error: 'Introuvable' }, 404);
  }
}

// PUT /api/courses/:id — mise à jour, borné tenant.
export async function handleUpdateCourse(
  request: Request,
  env: Env,
  auth: MembershipAuth,
  courseId: string,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    const course = (await env.DB.prepare(
      'SELECT client_id, agency_id FROM courses WHERE id = ? LIMIT 1',
    )
      .bind(courseId)
      .first()) as Record<string, unknown> | null;
    if (!course || !rowInTenant(course, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = ((await request.json()) as Record<string, unknown>) || {};
    } catch {
      body = {};
    }

    const updates: string[] = [];
    const params: (string | number | null)[] = [];
    if (body.title !== undefined) {
      updates.push('title = ?');
      params.push(String(body.title).slice(0, 200));
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      params.push(body.description ? String(body.description).slice(0, 2000) : null);
    }
    if (body.site_id !== undefined) {
      updates.push('site_id = ?');
      params.push(body.site_id ? String(body.site_id).slice(0, 60) : null);
    }
    if (body.plan_id !== undefined) {
      updates.push('plan_id = ?');
      params.push(body.plan_id ? String(body.plan_id).slice(0, 60) : null);
    }
    if (body.is_published !== undefined) {
      updates.push('is_published = ?');
      params.push(body.is_published ? 1 : 0);
    }
    if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
    params.push(courseId);
    await env.DB.prepare(
      `UPDATE courses SET ${updates.join(', ')} WHERE id = ?`,
    )
      .bind(...params)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Mise à jour indisponible' }, 503);
  }
}

// DELETE /api/courses/:id — suppression, borné tenant.
export async function handleDeleteCourse(
  env: Env,
  auth: MembershipAuth,
  courseId: string,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    const course = (await env.DB.prepare(
      'SELECT client_id, agency_id FROM courses WHERE id = ? LIMIT 1',
    )
      .bind(courseId)
      .first()) as Record<string, unknown> | null;
    if (!course || !rowInTenant(course, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }
    await env.DB.prepare('DELETE FROM courses WHERE id = ?').bind(courseId).run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Suppression indisponible' }, 503);
  }
}

// GET|POST /api/courses/:id/modules — liste / création module (borné via cours).
export async function handleCourseModules(
  request: Request,
  env: Env,
  auth: MembershipAuth,
  courseId: string,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    const course = (await env.DB.prepare(
      'SELECT client_id, agency_id FROM courses WHERE id = ? LIMIT 1',
    )
      .bind(courseId)
      .first()) as Record<string, unknown> | null;
    if (!course || !rowInTenant(course, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }

    if (request.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = ((await request.json()) as Record<string, unknown>) || {};
      } catch {
        body = {};
      }
      const id = crypto.randomUUID();
      const title = String(body.title || 'Module').slice(0, 200);
      const sortOrder = Number(body.sort_order) || 0;
      await env.DB.prepare(
        'INSERT INTO course_modules (id, course_id, title, sort_order) VALUES (?, ?, ?, ?)',
      )
        .bind(id, courseId, title, sortOrder)
        .run();
      return json({ data: { id } }, 201);
    }

    const { results } = await env.DB.prepare(
      'SELECT id, course_id, title, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, created_at ASC',
    )
      .bind(courseId)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CRUD PRO — lessons (PROTÉGÉ — capability 'workflows.manage')
// ════════════════════════════════════════════════════════════════════════════

// POST /api/lessons — crée une leçon (borné via le cours parent).
export async function handleCreateLesson(
  request: Request,
  env: Env,
  auth: MembershipAuth,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const courseId = body.course_id ? String(body.course_id) : '';
  const moduleId = body.module_id ? String(body.module_id) : null;
  if (!courseId) return json({ error: 'course_id requis' }, 400);

  try {
    const course = (await env.DB.prepare(
      'SELECT client_id, agency_id FROM courses WHERE id = ? LIMIT 1',
    )
      .bind(courseId)
      .first()) as Record<string, unknown> | null;
    if (!course || !rowInTenant(course, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }

    const id = crypto.randomUUID();
    const title = String(body.title || 'Leçon').slice(0, 200);
    const contentType = body.content_type === 'video' ? 'video' : 'text';
    const bodyHtml = body.body_html ? String(body.body_html) : null;
    const r2Key = body.r2_key ? String(body.r2_key).slice(0, 300) : null;
    const dripDays = Number(body.drip_days) || 0;
    const sortOrder = Number(body.sort_order) || 0;

    await env.DB.prepare(
      `INSERT INTO lessons (id, module_id, course_id, title, content_type, body_html, r2_key, drip_days, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, moduleId, courseId, title, contentType, bodyHtml, r2Key, dripDays, sortOrder)
      .run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Création de leçon indisponible' }, 503);
  }
}

// PUT /api/lessons/:id — mise à jour (borné via le cours parent).
export async function handleUpdateLesson(
  request: Request,
  env: Env,
  auth: MembershipAuth,
  lessonId: string,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    const lesson = (await env.DB.prepare(
      `SELECT l.id AS id, c.client_id AS client_id, c.agency_id AS agency_id
         FROM lessons l JOIN courses c ON c.id = l.course_id
        WHERE l.id = ? LIMIT 1`,
    )
      .bind(lessonId)
      .first()) as Record<string, unknown> | null;
    if (!lesson || !rowInTenant(lesson, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = ((await request.json()) as Record<string, unknown>) || {};
    } catch {
      body = {};
    }

    const updates: string[] = [];
    const params: (string | number | null)[] = [];
    if (body.title !== undefined) {
      updates.push('title = ?');
      params.push(String(body.title).slice(0, 200));
    }
    if (body.content_type !== undefined) {
      updates.push('content_type = ?');
      params.push(body.content_type === 'video' ? 'video' : 'text');
    }
    if (body.body_html !== undefined) {
      updates.push('body_html = ?');
      params.push(body.body_html ? String(body.body_html) : null);
    }
    if (body.r2_key !== undefined) {
      updates.push('r2_key = ?');
      params.push(body.r2_key ? String(body.r2_key).slice(0, 300) : null);
    }
    if (body.drip_days !== undefined) {
      updates.push('drip_days = ?');
      params.push(Number(body.drip_days) || 0);
    }
    if (body.module_id !== undefined) {
      updates.push('module_id = ?');
      params.push(body.module_id ? String(body.module_id) : null);
    }
    if (body.sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(Number(body.sort_order) || 0);
    }
    if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
    params.push(lessonId);
    await env.DB.prepare(
      `UPDATE lessons SET ${updates.join(', ')} WHERE id = ?`,
    )
      .bind(...params)
      .run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Mise à jour indisponible' }, 503);
  }
}

// DELETE /api/lessons/:id — suppression (borné via le cours parent).
export async function handleDeleteLesson(
  env: Env,
  auth: MembershipAuth,
  lessonId: string,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    const lesson = (await env.DB.prepare(
      `SELECT l.id AS id, c.client_id AS client_id, c.agency_id AS agency_id
         FROM lessons l JOIN courses c ON c.id = l.course_id
        WHERE l.id = ? LIMIT 1`,
    )
      .bind(lessonId)
      .first()) as Record<string, unknown> | null;
    if (!lesson || !rowInTenant(lesson, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }
    await env.DB.prepare('DELETE FROM lessons WHERE id = ?').bind(lessonId).run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Suppression indisponible' }, 503);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CRUD PRO — membership-sites / membership-plans (PROTÉGÉ 'workflows.manage')
// ════════════════════════════════════════════════════════════════════════════

// GET|POST /api/membership-sites — liste / création espace membre.
export async function handleMembershipSites(
  request: Request,
  env: Env,
  auth: MembershipAuth,
  _url: URL,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    if (request.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = ((await request.json()) as Record<string, unknown>) || {};
      } catch {
        body = {};
      }
      const { clientId, agencyId } = tenantIds(auth);
      const id = crypto.randomUUID();
      const slug = String(body.slug || '').trim().slice(0, 120);
      const name = body.name ? String(body.name).slice(0, 200) : null;
      const isActive = body.is_active === false ? 0 : 1;
      if (!slug) return json({ error: 'slug requis' }, 400);
      await env.DB.prepare(
        `INSERT INTO membership_sites (id, client_id, agency_id, slug, name, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, clientId, agencyId, slug, name, isActive)
        .run();
      return json({ data: { id } }, 201);
    }

    const { results } = await env.DB.prepare(
      'SELECT id, client_id, agency_id, slug, name, is_active, created_at FROM membership_sites ORDER BY created_at DESC',
    ).all();
    const rows = (results || []).filter((r) =>
      rowInTenant(r as Record<string, unknown>, auth),
    );
    return json({ data: rows });
  } catch {
    return json({ data: [] });
  }
}

// GET|POST /api/membership-plans — liste / création plan.
// price_cents POSÉ INACTIF — lu/écrit mais AUCUNE logique paiement (§6.B).
export async function handleMembershipPlans(
  request: Request,
  env: Env,
  auth: MembershipAuth,
  _url: URL,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    if (request.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = ((await request.json()) as Record<string, unknown>) || {};
      } catch {
        body = {};
      }
      const { clientId, agencyId } = tenantIds(auth);
      const id = crypto.randomUUID();
      const name = String(body.name || 'Plan').slice(0, 200);
      // price_cents POSÉ INACTIF — stocké, AUCUNE logique paiement (§6.B).
      const priceCents = Number(body.price_cents) || 0;
      await env.DB.prepare(
        `INSERT INTO membership_plans (id, client_id, agency_id, name, price_cents)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(id, clientId, agencyId, name, priceCents)
        .run();
      return json({ data: { id } }, 201);
    }

    const { results } = await env.DB.prepare(
      'SELECT id, client_id, agency_id, name, price_cents, created_at FROM membership_plans ORDER BY created_at DESC',
    ).all();
    const rows = (results || []).filter((r) =>
      rowInTenant(r as Record<string, unknown>, auth),
    );
    return json({ data: rows });
  } catch {
    return json({ data: [] });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ESPACE MEMBRE (auth membre — member-auth.ts, table member_sessions)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/member/:slug/courses — catalogue publié du tenant du membre +
// état d'inscription/progression. Borné member.client_id (§6.D).
export async function handleMemberCourses(
  _request: Request,
  env: Env,
  _slug: string,
  member: MemberContext,
): Promise<Response> {
  try {
    const { results: courses } = await env.DB.prepare(
      `SELECT id, title, description, created_at
         FROM courses
        WHERE client_id = ? AND is_published = 1
        ORDER BY created_at DESC`,
    )
      .bind(member.clientId)
      .all();

    // Inscriptions actives du membre (course_enrollments — JAMAIS
    // workflow_enrollments).
    const { results: enrolls } = await env.DB.prepare(
      `SELECT course_id, enrolled_at
         FROM course_enrollments
        WHERE member_id = ? AND status = 'active'`,
    )
      .bind(member.memberId)
      .all();
    const enrolledMap = new Map<string, string>();
    for (const e of enrolls || []) {
      const row = e as { course_id: string; enrolled_at: string };
      enrolledMap.set(row.course_id, row.enrolled_at);
    }

    const data = [];
    for (const c of courses || []) {
      const course = c as { id: string; title: string; description: string | null; created_at: string };
      const enrolledAt = enrolledMap.get(course.id) ?? null;
      let lessonsTotal = 0;
      let lessonsDone = 0;
      try {
        const tot = (await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?',
        )
          .bind(course.id)
          .first()) as { n: number } | null;
        lessonsTotal = tot?.n || 0;
        const done = (await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM lesson_progress
            WHERE member_id = ? AND course_id = ? AND status = 'completed'`,
        )
          .bind(member.memberId, course.id)
          .first()) as { n: number } | null;
        lessonsDone = done?.n || 0;
      } catch {
        /* best-effort : compteurs à 0 si table absente */
      }
      data.push({
        id: course.id,
        title: course.title,
        description: course.description,
        enrolled: enrolledAt != null,
        enrolled_at: enrolledAt,
        lessons_total: lessonsTotal,
        lessons_completed: lessonsDone,
        progress_pct: lessonsTotal > 0 ? Math.round((lessonsDone / lessonsTotal) * 100) : 0,
      });
    }
    return json({ data });
  } catch {
    return json({ data: [] });
  }
}

// Charge une leçon + son cours, en vérifiant les 3 bornes membre (§6.E/§6.F).
// Retourne soit { lesson, course, enrolledAt } soit une Response d'erreur.
async function loadGatedLesson(
  env: Env,
  lessonId: string,
  member: MemberContext,
): Promise<
  | { lesson: Record<string, unknown>; enrolledAt: string }
  | Response
> {
  const lesson = (await env.DB.prepare(
    `SELECT l.id AS id, l.module_id AS module_id, l.course_id AS course_id,
            l.title AS title, l.content_type AS content_type, l.body_html AS body_html,
            l.r2_key AS r2_key, l.drip_days AS drip_days,
            c.client_id AS client_id
       FROM lessons l JOIN courses c ON c.id = l.course_id
      WHERE l.id = ? LIMIT 1`,
  )
    .bind(lessonId)
    .first()) as Record<string, unknown> | null;

  if (!lesson) return json({ error: 'Leçon indisponible' }, 404);

  // Borne 1 : la leçon appartient au tenant du membre.
  if ((lesson.client_id as string | null) !== member.clientId) {
    return json({ error: 'Leçon indisponible' }, 404);
  }

  // Borne 2 : inscription active du membre au cours (course_enrollments —
  // JAMAIS workflow_enrollments).
  const enroll = (await env.DB.prepare(
    `SELECT enrolled_at FROM course_enrollments
      WHERE member_id = ? AND course_id = ? AND status = 'active' LIMIT 1`,
  )
    .bind(member.memberId, lesson.course_id as string)
    .first()) as { enrolled_at: string } | null;
  if (!enroll) return json({ error: 'Accès non autorisé' }, 403);

  // Borne 3 : drip débloqué (enrolled_at + drip_days ≤ now — §6.F).
  if (!dripUnlocked(enroll.enrolled_at, Number(lesson.drip_days) || 0)) {
    return json({ error: 'Leçon pas encore disponible' }, 403);
  }

  return { lesson, enrolledAt: enroll.enrolled_at };
}

// GET /api/member/lessons/:id — contenu d'une leçon, derrière la triple
// borne (§6.E/§6.F). La clé R2 n'est JAMAIS exposée (has_video seul).
export async function handleMemberLesson(
  _request: Request,
  env: Env,
  lessonId: string,
  member: MemberContext,
): Promise<Response> {
  try {
    const gated = await loadGatedLesson(env, lessonId, member);
    if (gated instanceof Response) return gated;
    const l = gated.lesson;
    return json({
      data: {
        id: l.id,
        module_id: l.module_id,
        course_id: l.course_id,
        title: l.title,
        content_type: l.content_type,
        body_html: l.body_html,
        has_video: !!(l.r2_key as string | null),
        drip_days: l.drip_days,
      },
    });
  } catch {
    return json({ error: 'Leçon indisponible' }, 404);
  }
}

// GET /api/member/lessons/:id/video — SERVICE VIDÉO R2 GATED (§6.E).
// Calque EXACT documents.ts:58-67 handleGetFile (env.FILES.get(r2_key) →
// `new Response(r2Object.body, { headers: { 'Cache-Control': 'private' } })`).
// TRIPLE BORNE AVANT env.FILES.get : (1) member.client_id == lesson.client_id ;
// (2) course_enrollments actif du memberId ; (3) drip débloqué. JAMAIS
// d'URL R2 publique/signée exposée — la vidéo transite UNIQUEMENT par ce
// proxy worker. Le token membre est lu en query par requireMember (amont
// worker.ts) — les `<video>` n'envoient pas de header Authorization.
export async function handleMemberLessonVideo(
  _request: Request,
  env: Env,
  lessonId: string,
  member: MemberContext,
): Promise<Response> {
  try {
    // TRIPLE BORNE (client_id == + enrollment actif + drip) AVANT tout
    // accès R2 — échec borne → 403/404 propre, JAMAIS le flux R2.
    const gated = await loadGatedLesson(env, lessonId, member);
    if (gated instanceof Response) return gated;
    const lesson = gated.lesson;

    const r2Key = lesson.r2_key as string | null;
    if (!r2Key) return json({ error: 'Vidéo non trouvée' }, 404);

    // Calque EXACT documents.ts:58-67 — env.FILES.get + stream.
    const r2Object = await env.FILES.get(r2Key);
    if (!r2Object) return json({ error: 'Vidéo non trouvée' }, 404);

    const contentType =
      (r2Object.httpMetadata?.contentType as string | undefined) ||
      'video/mp4';

    return new Response(r2Object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private',
      },
    });
  } catch {
    // Table/clé absente : best-effort → 404 propre, jamais 500.
    return json({ error: 'Vidéo indisponible' }, 404);
  }
}

// POST /api/member/progress — body { lesson_id, status }. Upsert
// lesson_progress ON CONFLICT(member_id, lesson_id) (index unique seq 87,
// calque auth.ts:269-273). status ∈ {started, completed} (PAS de CHECK).
// % de complétion = COUNT applicatif, borné au memberId (§6.F).
export async function handleMemberProgress(
  request: Request,
  env: Env,
  member: MemberContext,
): Promise<Response> {
  let body: { lesson_id?: string; status?: string };
  try {
    body = ((await request.json()) as typeof body) || {};
  } catch {
    body = {};
  }

  const lessonId = body.lesson_id ? String(body.lesson_id) : '';
  const status = body.status === 'completed' ? 'completed' : 'started';
  if (!lessonId) return json({ error: 'lesson_id requis' }, 400);

  try {
    // La leçon doit être accessible au membre (triple borne réutilisée :
    // tenant + enrollment + drip) — empêche d'écrire une progression sur
    // une leçon hors périmètre.
    const gated = await loadGatedLesson(env, lessonId, member);
    if (gated instanceof Response) return gated;
    const courseId = gated.lesson.course_id as string;

    const id = crypto.randomUUID();
    const completedAt = status === 'completed' ? "datetime('now')" : 'NULL';
    // Upsert porté par l'index UNIQUE idx_lesson_progress_member
    // (member_id, lesson_id) — calque auth.ts:269-273 ON CONFLICT.
    await env.DB.prepare(
      `INSERT INTO lesson_progress (id, member_id, lesson_id, course_id, status, completed_at)
       VALUES (?, ?, ?, ?, ?, ${completedAt})
       ON CONFLICT(member_id, lesson_id) DO UPDATE SET
         status = excluded.status,
         completed_at = ${completedAt}`,
    )
      .bind(id, member.memberId, lessonId, courseId, status)
      .run();

    // % de complétion = COUNT applicatif borné au memberId (§6.F).
    let progressPct = 0;
    try {
      const tot = (await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?',
      )
        .bind(courseId)
        .first()) as { n: number } | null;
      const done = (await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM lesson_progress
          WHERE member_id = ? AND course_id = ? AND status = 'completed'`,
      )
        .bind(member.memberId, courseId)
        .first()) as { n: number } | null;
      const total = tot?.n || 0;
      progressPct = total > 0 ? Math.round(((done?.n || 0) / total) * 100) : 0;
    } catch {
      /* best-effort : % à 0 si table absente */
    }

    return json({ data: { success: true, progress_pct: progressPct } });
  } catch {
    return json({ error: 'Progression indisponible' }, 503);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LOT MEMBERSHIP ENROLL (Sprint 6 « fermeture boucle inscription ») — 5 STUBS
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠ ZONE STUBS — POSÉE Phase A (Manager-A). SIGNATURES FIGÉES : worker.ts (GELÉ
//   Phase A) câble déjà ces 5 handlers ; src/lib/api.ts (GELÉ Phase A) appelle
//   les endpoints. Manager-B (Phase B, SOLO sur memberships.ts) remplit les
//   CORPS RÉELS — SANS changer signature/ordre/typage des params ni la forme de
//   la Response. Contrat §6 verbatim dans docs/LOT-MEMBERSHIP-ENROLL.md.
//
// Conventions (identiques au reste du fichier) : json({ data }) succès /
//   json({ error }, status) erreur, JAMAIS de `code` (§6.A). Inscription
//   GRATUITE (E4 inactif — price_cents cosmétique). Membre = MemberContext
//   (requireMember amont, member.clientId / member.memberId). PRO =
//   MembershipAuth + membershipCapGuard ('workflows.manage') + rowInTenant.
//   best-effort : table/colonne seq 87 absente → réponse propre, JAMAIS 500.

// POST /api/member/:slug/courses/:courseId/enroll — inscription du membre
// courant à un cours (GRATUIT). MEMBRE (requireMember amont — `member`).
// Manager-B : borné `member.clientId == course.client_id`, cours
// `is_published = 1`, IDEMPOTENT (vérif course_enrollments existant AVANT
// INSERT — index idx_course_enrollments_member/_course seq 87/107), INSERT
// course_enrollments (id, member_id, course_id, client_id, status 'active',
// enrolled_at default). Réponse succès : json({ data: { success: true,
// enrolled: true } }). NE PAS casser loadGatedLesson (qui LIT ces rows).
export async function handleMemberEnroll(
  _request: Request,
  env: Env,
  _slug: string,
  courseId: string,
  member: MemberContext,
): Promise<Response> {
  if (!courseId) return json({ error: 'Cours introuvable' }, 404);
  try {
    // Borne tenant : le cours doit appartenir au tenant du membre ET être
    // publié (calque handleMemberCourses l.594 + loadGatedLesson borne 1).
    const course = (await env.DB.prepare(
      'SELECT id, client_id, is_published FROM courses WHERE id = ? LIMIT 1',
    )
      .bind(courseId)
      .first()) as { id: string; client_id: string | null; is_published: number } | null;
    if (!course || (course.client_id as string | null) !== member.clientId) {
      return json({ error: 'Cours introuvable' }, 404);
    }
    if (!course.is_published) {
      return json({ error: 'Accès non autorisé' }, 403);
    }

    // IDEMPOTENT : si une inscription active existe déjà (member_id+course_id),
    // succès SANS double INSERT (§6.D).
    const existing = (await env.DB.prepare(
      `SELECT id FROM course_enrollments
        WHERE member_id = ? AND course_id = ? AND status = 'active' LIMIT 1`,
    )
      .bind(member.memberId, courseId)
      .first()) as { id: string } | null;
    if (existing) {
      return json({ data: { success: true, enrolled: true } });
    }

    // INSERT GRATUIT (E4 inactif — aucune logique paiement). enrolled_at via
    // DEFAULT datetime('now') côté SQLite.
    await env.DB.prepare(
      `INSERT INTO course_enrollments (id, member_id, course_id, client_id, status)
       VALUES (?, ?, ?, ?, 'active')`,
    )
      .bind(crypto.randomUUID(), member.memberId, courseId, member.clientId)
      .run();
    return json({ data: { success: true, enrolled: true } });
  } catch {
    // best-effort : table seq 87 absente → réponse propre, jamais 500.
    return json({ error: 'Inscription indisponible' }, 503);
  }
}

// GET /api/member/:slug/courses/:courseId — détail cours côté membre : cours +
// état inscription + arbre modules→leçons borné membre, état drip + progress
// par leçon. MEMBRE (requireMember amont — `member`). Manager-B : réutilise la
// logique de handleMemberCourses / loadGatedLesson (NE la casse PAS) — borne
// `member.clientId == course.client_id`, charge course_modules + lessons du
// cours, calcule par leçon `unlocked` (dripUnlocked(enrolled_at, drip_days)) +
// `status` (lesson_progress du membre). Si non inscrit → 403 (le front montre
// alors « S'inscrire »). Réponse = MemberCourseDetail (cf. §6.B / api.ts).
export async function handleMemberCourseDetail(
  _request: Request,
  env: Env,
  _slug: string,
  courseId: string,
  member: MemberContext,
): Promise<Response> {
  if (!courseId) return json({ error: 'Cours introuvable' }, 404);
  try {
    // Borne tenant : course.client_id == member.clientId (calque
    // handleMemberCourses l.594 + loadGatedLesson borne 1). Hors tenant → 404.
    const course = (await env.DB.prepare(
      'SELECT id, client_id, title, description FROM courses WHERE id = ? LIMIT 1',
    )
      .bind(courseId)
      .first()) as {
      id: string;
      client_id: string | null;
      title: string;
      description: string | null;
    } | null;
    if (!course || (course.client_id as string | null) !== member.clientId) {
      return json({ error: 'Cours introuvable' }, 404);
    }

    // Inscription active du membre (calque loadGatedLesson borne 2). Si non
    // inscrit → 403 (choix figé §6.B-bis — le front affiche « S'inscrire »).
    const enroll = (await env.DB.prepare(
      `SELECT enrolled_at FROM course_enrollments
        WHERE member_id = ? AND course_id = ? AND status = 'active' LIMIT 1`,
    )
      .bind(member.memberId, courseId)
      .first()) as { enrolled_at: string } | null;
    if (!enroll) return json({ error: 'Accès non autorisé' }, 403);
    const enrolledAt = enroll.enrolled_at ?? null;

    // Modules du cours, triés (calque handleGetCourse l.184-188).
    const { results: modulesRaw } = await env.DB.prepare(
      'SELECT id, course_id, title, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, created_at ASC',
    )
      .bind(courseId)
      .all();
    const modules = (modulesRaw || []).map((m) => {
      const r = m as { id: string; course_id: string | null; title: string; sort_order: number };
      return { id: r.id, course_id: r.course_id, title: r.title, sort_order: r.sort_order };
    });

    // Leçons du cours, PLAT, avec has_video (clé R2 JAMAIS exposée — §6.E).
    const { results: lessonsRaw } = await env.DB.prepare(
      `SELECT id, module_id, course_id, title, content_type,
              (r2_key IS NOT NULL AND r2_key != '') AS has_video, drip_days, sort_order
         FROM lessons WHERE course_id = ? ORDER BY sort_order ASC, created_at ASC`,
    )
      .bind(courseId)
      .all();

    // Statut progress par leçon (lesson_progress du membre — calque
    // handleMemberCourses l.628-634 / handleMemberProgress l.824).
    const progressMap = new Map<string, string>();
    try {
      const { results: progRaw } = await env.DB.prepare(
        `SELECT lesson_id, status FROM lesson_progress
          WHERE member_id = ? AND course_id = ?`,
      )
        .bind(member.memberId, courseId)
        .all();
      for (const p of progRaw || []) {
        const r = p as { lesson_id: string; status: string };
        progressMap.set(r.lesson_id, r.status);
      }
    } catch {
      /* best-effort : pas de progress si table absente */
    }

    let lessonsCompleted = 0;
    const lessons = (lessonsRaw || []).map((l) => {
      const r = l as {
        id: string;
        module_id: string | null;
        course_id: string | null;
        title: string;
        content_type: string;
        has_video: number;
        drip_days: number;
        sort_order: number;
      };
      const status = progressMap.get(r.id) ?? null;
      if (status === 'completed') lessonsCompleted += 1;
      return {
        id: r.id,
        module_id: r.module_id,
        course_id: r.course_id,
        title: r.title,
        content_type: r.content_type,
        has_video: !!r.has_video,
        drip_days: Number(r.drip_days) || 0,
        sort_order: r.sort_order,
        // unlocked = dripUnlocked(enrolled_at, drip_days) — helper EXISTANT.
        unlocked: dripUnlocked(enrolledAt, Number(r.drip_days) || 0),
        status,
      };
    });

    const lessonsTotal = lessons.length;
    const progressPct =
      lessonsTotal > 0 ? Math.round((lessonsCompleted / lessonsTotal) * 100) : 0;

    return json({
      data: {
        id: course.id,
        title: course.title,
        description: course.description,
        enrolled: true,
        enrolled_at: enrolledAt,
        progress_pct: progressPct,
        lessons_total: lessonsTotal,
        lessons_completed: lessonsCompleted,
        modules,
        lessons,
      },
    });
  } catch {
    // best-effort : table seq 87 absente → 404 propre, jamais 500.
    return json({ error: 'Cours introuvable' }, 404);
  }
}

// GET /api/members — liste des membres du tenant (gestion PRO). PROTÉGÉ
// (membershipCapGuard 'workflows.manage'). Calque handleListCourses : SELECT
// members puis filter rowInTenant. Manager-B : NE renvoie PAS password_hash
// (SELECT colonnes explicites : id, email, name, status, created_at).
export async function handleListMembers(
  env: Env,
  auth: MembershipAuth,
  _url: URL,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  try {
    // SELECT colonnes explicites — JAMAIS password_hash (§6.H). client_id/
    // agency_id portés pour le filtre rowInTenant (calque handleListCourses).
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, agency_id, email, name, status, created_at
         FROM members ORDER BY created_at DESC`,
    ).all();
    const rows = (results || [])
      .filter((r) => rowInTenant(r as Record<string, unknown>, auth))
      .map((r) => {
        const m = r as {
          id: string;
          email: string;
          name: string | null;
          status: string | null;
          created_at: string;
        };
        // MemberLite §6.B — pas de client_id/agency_id exposés.
        return {
          id: m.id,
          email: m.email,
          name: m.name,
          status: m.status,
          created_at: m.created_at,
        };
      });
    return json({ data: rows });
  } catch {
    return json({ data: [] });
  }
}

// POST /api/courses/:id/enroll — inscription PRO d'un membre à un cours
// (GRATUIT). body { member_id }. PROTÉGÉ (membershipCapGuard). Manager-B :
// re-borne le cours via rowInTenant AVANT action, vérifie member_id ∈ tenant,
// IDEMPOTENT (vérif existant), INSERT course_enrollments (status 'active').
// Réponse succès : json({ data: { success: true, enrolled: true } }).
export async function handleAdminEnroll(
  request: Request,
  env: Env,
  auth: MembershipAuth,
  courseId: string,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;

  let body: { member_id?: string };
  try {
    body = ((await request.json()) as typeof body) || {};
  } catch {
    body = {};
  }
  const memberId = body.member_id ? String(body.member_id) : '';
  if (!memberId) return json({ error: 'member_id requis' }, 400);
  if (!courseId) return json({ error: 'Introuvable' }, 404);

  try {
    // Re-borne le cours via rowInTenant AVANT action (calque handleDeleteCourse
    // l.272-279).
    const course = (await env.DB.prepare(
      'SELECT id, client_id, agency_id FROM courses WHERE id = ? LIMIT 1',
    )
      .bind(courseId)
      .first()) as Record<string, unknown> | null;
    if (!course || !rowInTenant(course, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }

    // Le membre cible doit ∈ tenant (rowInTenant sur la row members).
    const memberRow = (await env.DB.prepare(
      'SELECT id, client_id, agency_id FROM members WHERE id = ? LIMIT 1',
    )
      .bind(memberId)
      .first()) as Record<string, unknown> | null;
    if (!memberRow || !rowInTenant(memberRow, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }

    // IDEMPOTENT : vérif inscription active existante AVANT INSERT.
    const existing = (await env.DB.prepare(
      `SELECT id FROM course_enrollments
        WHERE member_id = ? AND course_id = ? AND status = 'active' LIMIT 1`,
    )
      .bind(memberId, courseId)
      .first()) as { id: string } | null;
    if (existing) {
      return json({ data: { success: true, enrolled: true } });
    }

    // INSERT GRATUIT (E4 inactif). client_id posé depuis le cours (tenant).
    await env.DB.prepare(
      `INSERT INTO course_enrollments (id, member_id, course_id, client_id, status)
       VALUES (?, ?, ?, ?, 'active')`,
    )
      .bind(
        crypto.randomUUID(),
        memberId,
        courseId,
        (course.client_id as string | null) ?? null,
      )
      .run();
    return json({ data: { success: true, enrolled: true } });
  } catch {
    return json({ error: 'Inscription indisponible' }, 503);
  }
}

// GET /api/courses/:id/enrollments — liste des inscrits à un cours (gestion
// PRO). PROTÉGÉ (membershipCapGuard). Manager-B : re-borne le cours via
// rowInTenant AVANT lecture, SELECT course_enrollments du cours JOIN members
// (jointure applicative member_id) → { id, member_id, course_id, email, name,
// status, enrolled_at }[]. Calque handleDeleteCourse (signature env/auth/id).
export async function handleListEnrollments(
  env: Env,
  auth: MembershipAuth,
  courseId: string,
): Promise<Response> {
  const g = membershipCapGuard(auth);
  if (g) return g;
  if (!courseId) return json({ error: 'Introuvable' }, 404);
  try {
    // Re-borne le cours via rowInTenant AVANT lecture (calque handleDeleteCourse).
    const course = (await env.DB.prepare(
      'SELECT id, client_id, agency_id FROM courses WHERE id = ? LIMIT 1',
    )
      .bind(courseId)
      .first()) as Record<string, unknown> | null;
    if (!course || !rowInTenant(course, auth)) {
      return json({ error: 'Introuvable' }, 404);
    }

    // Inscrits du cours, JOIN applicative members (member_id) pour email/name.
    const { results } = await env.DB.prepare(
      `SELECT ce.id AS id, ce.member_id AS member_id, ce.course_id AS course_id,
              m.email AS email, m.name AS name, ce.status AS status,
              ce.enrolled_at AS enrolled_at
         FROM course_enrollments ce
         LEFT JOIN members m ON m.id = ce.member_id
        WHERE ce.course_id = ?
        ORDER BY ce.enrolled_at DESC`,
    )
      .bind(courseId)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}
