// ── Module Segments — Intralys CRM (LOT G6, Segmentation comportementale +
//   A/B testing campagnes — 2026-05-20) ──────────────────────────────────────
//
// SEGMENT = audience DYNAMIQUE de leads, recompute-on-read + cache
// (`lead_segments.criteria_json` + cached_count/cached_at ; ZÉRO table de
// membres matérialisée — la liste est recalculée à la demande à partir des
// critères). Critères v1 = AND-only (status / source / score sur leads.score /
// tags_in / tags_not_in / created_at range / last_activity range +
// comportemental opened_campaign / clicked_campaign / not_opened / not_clicked
// via EXISTS messages JOIN message_events + in_sequence via EXISTS
// workflow_enrollments active).
//
// Le segment est (a) une CIBLE de broadcast (sendBroadcast accepte segment_id —
// broadcast.ts importe `buildSegmentQuery` ci-dessous pour résoudre segment_id→
// leads) et (b) une source d'enrôlement workflow EN MASSE (POST
// /api/segments/:id/enroll itère les leads et appelle `autoEnroll` EXISTANT —
// moteur workflows.ts READ-ONLY, AUCUNE logique d'enrôlement neuve).
//
// Capability = `workflows.manage` RÉUTILISÉE (capabilities.ts:45 ; capGuard
// conditionnel calque funnels.ts / sequences). ZÉRO ajout ALL_CAPABILITIES.
// Bornage tenant via `client_id` (calque sequences.ts:47 / broadcast.ts —
// query ?client_id= prioritaire, sinon contexte tenant). En mode agence
// (agencyId != null) un client_id RÉEL est exigé pour les critères
// comportementaux (FLAG-3 cross-tenant).
//
// Phase B Manager-B : CORPS RÉELS (CRUD + buildSegmentQuery + 4 sous-requêtes
// EXISTS comportementales + preview + enroll). Retours `{ data }` / `{ error }`
// (jamais `code` — ApiResponse GELÉ §6.D).

import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { autoEnroll } from './workflows';

// Auth enrichi au choke-point (worker.ts) — calque le type passé à
// routeProtected (userId/role/clientId/tenant/capabilities). Identique au
// FunnelAuth de funnels.ts:41.
export type SegmentAuth = CapAuth & { capabilities?: Set<string> };

// ── Garde capability (calque funnels.ts:47-49) ──────────────────────────────
// Réutilise 'workflows.manage' (déjà dans ALL_CAPABILITIES). En legacy/
// mono-tenant le set est LARGE ⇒ pas de régression ; bridage viewer actif
// seulement en mode agence (agencyId != null).
function capGuard(auth: SegmentAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'workflows.manage');
}

// Récupère le client_id de bornage : query ?client_id= (liste) prioritaire,
// sinon contexte tenant. Optionnel (legacy/mono-tenant ⇒ pas de filtre — calque
// sequences.ts:47-51 / broadcast.ts où client_id est conditionnel). Exporté
// pour réutilisation (CRUD + preview + enroll).
export function scopeClientId(auth: SegmentAuth, url?: URL): string | null {
  const fromQuery = url?.searchParams.get('client_id');
  if (fromQuery) return fromQuery;
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// Mode agence = bridage tenant actif (calque capabilities.ts:119). En ce mode
// un client_id RÉEL est OBLIGATOIRE pour les critères comportementaux (FLAG-3 :
// les JOIN messages doivent être bornés par messages.client_id).
function isAgencyMode(auth: SegmentAuth): boolean {
  return !!auth.tenant && auth.tenant.agencyId != null;
}

// ── Forme des critères (interprétée côté handler — calque api.ts SegmentCriteria) ──
type CampaignCrit = { broadcast_id?: string; within_days?: number; negate?: boolean };
type ScoreCrit = { op?: 'gte' | 'lte' | 'eq'; value?: number };
export interface SegmentCriteria {
  status?: string[];
  source?: string[];
  // Sprint MULTILANG-B — langue préférée du lead (colonne leads.preferred_language,
  // seq 98). Critère IN (...) borné tenant par la query de base (calque `source`).
  preferred_language?: string[];
  score?: ScoreCrit;
  tags_in?: string[];
  tags_not_in?: string[];
  created_after?: string;
  created_before?: string;
  last_activity_after?: string;
  last_activity_before?: string;
  opened_campaign?: CampaignCrit;
  clicked_campaign?: CampaignCrit;
  // not_opened/not_clicked = forme alternative tolérée (le contrat api.ts gelé
  // exprime la négation via `opened_campaign.negate` ; on accepte les deux).
  not_opened?: CampaignCrit;
  not_clicked?: CampaignCrit;
  // in_sequence : contrat api.ts gelé = boolean (true ⇒ enrôlé dans UNE séquence
  // active quelconque ; false ⇒ aucune). Forme objet `{workflow_id}` tolérée
  // (cible un workflow précis) pour rétro-compat défensive.
  in_sequence?: boolean | { workflow_id?: string };
}

// ── BUILDER DE REQUÊTE (le cœur) ─────────────────────────────────────────────
// Construit le SELECT des leads matchant les critères AND-only. Retourne
// `{ sql, binds }` avec un SELECT projetant les colonnes utiles
// (id/name/email/phone/score). Le `selectCols` permet à broadcast.ts de
// projeter id/name/email/phone (envoi) ; le preview/count utilise COUNT(*).
//
// Bornage tenant TOUJOURS appliqué : si `clientId` fourni → `leads.client_id =
// ?`. En mode agence sans clientId, les critères comportementaux sont REFUSÉS
// (FLAG-3) — voir validateBehavioralBornage.
//
// FLAG-3 (CROSS-TENANT) : tout EXISTS sur `messages` injecte
// `AND m.client_id = ?` (clientId du segment). `message_events` n'a NI lead_id
// NI client_id → la borne passe OBLIGATOIREMENT par `messages.client_id`.
export function buildSegmentQuery(
  criteria: SegmentCriteria | null | undefined,
  clientId: string | null,
  selectCols = 'leads.id, leads.name, leads.email, leads.phone, leads.score',
): { sql: string; binds: unknown[] } {
  const c = criteria || {};
  const where: string[] = [];
  const binds: unknown[] = [];

  // Bornage tenant : client_id du segment (calque broadcast.ts:84).
  if (clientId) {
    where.push('leads.client_id = ?');
    binds.push(clientId);
  }

  // status IN (...)
  if (Array.isArray(c.status) && c.status.length > 0) {
    const ph = c.status.map(() => '?').join(',');
    where.push(`leads.status IN (${ph})`);
    binds.push(...c.status);
  }

  // source IN (...)
  if (Array.isArray(c.source) && c.source.length > 0) {
    const ph = c.source.map(() => '?').join(',');
    where.push(`leads.source IN (${ph})`);
    binds.push(...c.source);
  }

  // preferred_language IN (...) — Sprint MULTILANG-B (calque `source IN`).
  // Bornage tenant déjà assuré par leads.client_id ci-dessus.
  if (Array.isArray(c.preferred_language) && c.preferred_language.length > 0) {
    const ph = c.preferred_language.map(() => '?').join(',');
    where.push(`leads.preferred_language IN (${ph})`);
    binds.push(...c.preferred_language);
  }

  // score (op gte/lte/eq sur leads.score — colonne directe seq existante)
  if (c.score && typeof c.score.value === 'number' && Number.isFinite(c.score.value)) {
    const op = c.score.op === 'lte' ? '<=' : c.score.op === 'eq' ? '=' : '>=';
    where.push(`leads.score ${op} ?`);
    binds.push(c.score.value);
  }

  // created_at range
  if (c.created_after) { where.push('leads.created_at >= ?'); binds.push(c.created_after); }
  if (c.created_before) { where.push('leads.created_at <= ?'); binds.push(c.created_before); }

  // last_activity range — colonne RÉELLE = last_activity_at (migration-sprint2-phase1).
  if (c.last_activity_after) { where.push('leads.last_activity_at >= ?'); binds.push(c.last_activity_after); }
  if (c.last_activity_before) { where.push('leads.last_activity_at <= ?'); binds.push(c.last_activity_before); }

  // tags_in / tags_not_in — EXISTS lead_tags (calque broadcast.ts:89-95).
  if (Array.isArray(c.tags_in) && c.tags_in.length > 0) {
    const ph = c.tags_in.map(() => '?').join(',');
    where.push(`EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.lead_id = leads.id AND lt.tag IN (${ph}))`);
    binds.push(...c.tags_in);
  }
  if (Array.isArray(c.tags_not_in) && c.tags_not_in.length > 0) {
    const ph = c.tags_not_in.map(() => '?').join(',');
    where.push(`NOT EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.lead_id = leads.id AND lt.tag IN (${ph}))`);
    binds.push(...c.tags_not_in);
  }

  // ── Comportemental : EXISTS messages JOIN message_events ────────────────────
  // FLAG-3 : `AND m.client_id = ?` OBLIGATOIRE (clientId du segment). Si clientId
  // est null le critère est IGNORÉ ici (validateBehavioralBornage refuse en
  // amont en mode agence ; en legacy/mono-tenant pas de borne cross-tenant à
  // poser, mais on n'émet pas de critère non-borné — sécurité par défaut).
  const behavioral = (camp: CampaignCrit | undefined, eventType: 'open' | 'click', negate: boolean) => {
    if (!camp || !camp.broadcast_id) return;
    if (!clientId) return; // pas de borne cross-tenant possible → critère ignoré (sûr).
    const parts: string[] = [
      'SELECT 1 FROM messages m JOIN message_events me ON me.message_id = m.id',
      'WHERE m.lead_id = leads.id AND m.campaign_id = ?',
      `AND me.event_type = '${eventType}'`,
      'AND m.client_id = ?',
    ];
    const subBinds: unknown[] = [camp.broadcast_id];
    if (typeof camp.within_days === 'number' && Number.isFinite(camp.within_days) && camp.within_days > 0) {
      parts.splice(3, 0, "AND me.created_at >= datetime('now', ?)");
      // datetime modifier ordre : broadcast_id, [within], client_id.
      subBinds.push(`-${Math.floor(camp.within_days)} days`);
    }
    subBinds.push(clientId);
    const exists = `EXISTS (${parts.join(' ')})`;
    where.push(negate ? `NOT ${exists}` : exists);
    binds.push(...subBinds);
  };

  // opened_campaign : open EXISTS ; negate via flag OU critère not_opened.
  behavioral(c.opened_campaign, 'open', !!c.opened_campaign?.negate);
  behavioral(c.not_opened, 'open', true);
  // clicked_campaign : click EXISTS ; negate via flag OU critère not_clicked.
  behavioral(c.clicked_campaign, 'click', !!c.clicked_campaign?.negate);
  behavioral(c.not_clicked, 'click', true);

  // in_sequence : EXISTS workflow_enrollments active.
  //   - boolean true  ⇒ enrôlé dans UNE séquence active quelconque (EXISTS sans
  //                     workflow_id) ;
  //   - boolean false ⇒ AUCUNE séquence active (NOT EXISTS) ;
  //   - objet {workflow_id} ⇒ cible un workflow précis (forme défensive tolérée).
  if (typeof c.in_sequence === 'boolean') {
    const anyActive =
      'EXISTS (SELECT 1 FROM workflow_enrollments we WHERE we.lead_id = leads.id AND we.status = \'active\')';
    where.push(c.in_sequence ? anyActive : `NOT ${anyActive}`);
  } else if (c.in_sequence && c.in_sequence.workflow_id) {
    where.push(
      "EXISTS (SELECT 1 FROM workflow_enrollments we WHERE we.lead_id = leads.id AND we.workflow_id = ? AND we.status = 'active')",
    );
    binds.push(c.in_sequence.workflow_id);
  }

  const sql =
    `SELECT ${selectCols} FROM leads` +
    (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '');
  return { sql, binds };
}

// FLAG-3 : en mode agence un client_id RÉEL est OBLIGATOIRE dès qu'un critère
// comportemental (opened/clicked/not_opened/not_clicked) cible un broadcast.
// Retourne une Response 400 si la borne est impossible, sinon undefined.
function validateBehavioralBornage(
  criteria: SegmentCriteria | null | undefined,
  clientId: string | null,
  agencyMode: boolean,
): Response | undefined {
  if (!agencyMode || clientId) return undefined;
  const c = criteria || {};
  const usesBehavioral =
    !!c.opened_campaign?.broadcast_id ||
    !!c.clicked_campaign?.broadcast_id ||
    !!c.not_opened?.broadcast_id ||
    !!c.not_clicked?.broadcast_id;
  if (usesBehavioral) {
    return json(
      { error: 'client_id requis pour un critère comportemental (protection cross-tenant)' },
      400,
    );
  }
  return undefined;
}

// Résout les leads d'un ensemble de critères (count + sample). Best-effort :
// une erreur SQL renvoie { count: 0, sample: [] } plutôt qu'un throw.
async function resolveSegmentLeads(
  env: Env,
  criteria: SegmentCriteria | null | undefined,
  clientId: string | null,
  sampleSize = 20,
): Promise<{ count: number; sample: Array<Record<string, unknown>> }> {
  try {
    const { sql, binds } = buildSegmentQuery(criteria, clientId);
    const countSql = `SELECT COUNT(*) AS n FROM (${sql})`;
    const countRow = binds.length > 0
      ? await env.DB.prepare(countSql).bind(...binds).first()
      : await env.DB.prepare(countSql).first();
    const count = Number((countRow as { n?: number } | null)?.n || 0);
    const sampleSql = `${sql} ORDER BY leads.created_at DESC LIMIT ${Math.max(0, Math.floor(sampleSize))}`;
    const sampleRes = binds.length > 0
      ? await env.DB.prepare(sampleSql).bind(...binds).all()
      : await env.DB.prepare(sampleSql).all();
    return { count, sample: (sampleRes.results || []) as Array<Record<string, unknown>> };
  } catch (err) {
    console.error('resolveSegmentLeads failed', err);
    return { count: 0, sample: [] };
  }
}

// Charge un segment borné tenant (calque loadXInTenant des autres lots).
// Retourne null si introuvable OU hors-tenant (404 côté handler). En legacy/
// mono-tenant (clientId null) le filtre client_id est omis.
async function loadSegmentInTenant(
  env: Env,
  segmentId: string,
  clientId: string | null,
): Promise<Record<string, unknown> | null> {
  let q = 'SELECT * FROM lead_segments WHERE id = ?';
  const binds: unknown[] = [segmentId];
  if (clientId) { q += ' AND client_id = ?'; binds.push(clientId); }
  const row = await env.DB.prepare(q).bind(...binds).first();
  return (row as Record<string, unknown> | null) || null;
}

function parseCriteria(raw: unknown): SegmentCriteria {
  if (raw && typeof raw === 'object') return raw as SegmentCriteria;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as SegmentCriteria; } catch { return {}; }
  }
  return {};
}

// GET /api/segments — liste des segments (bornage client_id). Lecture pure
// (PAS de capGuard — calque handleGetSequences). SELECT lead_segments borné.
export async function handleGetSegments(
  env: Env,
  auth: SegmentAuth,
  url: URL,
): Promise<Response> {
  try {
    const clientId = scopeClientId(auth, url);
    let query = 'SELECT * FROM lead_segments';
    const params: unknown[] = [];
    if (clientId) { query += ' WHERE client_id = ?'; params.push(clientId); }
    query += ' ORDER BY updated_at DESC';
    const { results } = params.length > 0
      ? await env.DB.prepare(query).bind(...params).all()
      : await env.DB.prepare(query).all();
    return json({ data: results || [] });
  } catch (err) {
    return json({ error: 'Erreur de chargement des segments: ' + String(err) }, 500);
  }
}

// POST /api/segments — crée un segment (capGuard). INSERT lead_segments +
// cached_count initial best-effort via le builder.
export async function handleCreateSegment(
  request: Request,
  env: Env,
  auth: SegmentAuth,
): Promise<Response> {
  const guard = capGuard(auth);
  if (guard) return guard;

  const body = await request.json() as { name?: string; criteria?: unknown; client_id?: string };
  const name = (body.name || '').trim();
  if (!name) return json({ error: 'Nom requis' }, 400);
  const criteria = parseCriteria(body.criteria);

  const clientId = body.client_id || scopeClientId(auth);
  const agencyMode = isAgencyMode(auth);
  const bornageErr = validateBehavioralBornage(criteria, clientId, agencyMode);
  if (bornageErr) return bornageErr;

  // cached_count initial best-effort (n'échoue pas la création si erreur).
  const { count } = await resolveSegmentLeads(env, criteria, clientId, 0);

  const id = crypto.randomUUID();
  const agencyId = auth.tenant?.agencyId ?? null;
  try {
    await env.DB.prepare(
      `INSERT INTO lead_segments (id, client_id, agency_id, name, criteria_json, cached_count, cached_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    ).bind(id, clientId, agencyId, name, JSON.stringify(criteria), count, auth.userId).run();
  } catch (err) {
    return json({ error: 'Création du segment échouée: ' + String(err) }, 500);
  }
  return json({ data: { id } }, 201);
}

// POST /api/segments/preview — compte/échantillon SANS persister.
export async function handlePreviewSegment(
  request: Request,
  env: Env,
  auth: SegmentAuth,
): Promise<Response> {
  const guard = capGuard(auth);
  if (guard) return guard;

  const body = await request.json() as { criteria?: unknown; client_id?: string };
  const criteria = parseCriteria(body.criteria);
  const clientId = body.client_id || scopeClientId(auth);
  const bornageErr = validateBehavioralBornage(criteria, clientId, isAgencyMode(auth));
  if (bornageErr) return bornageErr;

  const { count, sample } = await resolveSegmentLeads(env, criteria, clientId, 20);
  return json({ data: { count, sample } });
}

// GET /api/segments/:id — détail + recompute-on-read (cached_count/cached_at).
export async function handleGetSegment(
  env: Env,
  auth: SegmentAuth,
  segmentId: string,
): Promise<Response> {
  try {
    const clientId = scopeClientId(auth);
    const seg = await loadSegmentInTenant(env, segmentId, clientId);
    if (!seg) return json({ error: 'Segment introuvable' }, 404);

    const criteria = parseCriteria(seg.criteria_json);
    const segClientId = (seg.client_id as string) || clientId;
    const { count, sample } = await resolveSegmentLeads(env, criteria, segClientId, 20);

    // Recompute-on-read : UPDATE best-effort (n'échoue pas la lecture).
    try {
      await env.DB.prepare(
        "UPDATE lead_segments SET cached_count = ?, cached_at = datetime('now') WHERE id = ?",
      ).bind(count, segmentId).run();
    } catch (err) {
      console.error('handleGetSegment: recompute cache failed', segmentId, err);
    }

    return json({ data: { ...seg, cached_count: count, criteria, sample } });
  } catch (err) {
    return json({ error: 'Erreur de chargement du segment: ' + String(err) }, 500);
  }
}

// PUT /api/segments/:id — UPDATE name/criteria (capGuard + bornage tenant).
export async function handleUpdateSegment(
  request: Request,
  env: Env,
  auth: SegmentAuth,
  segmentId: string,
): Promise<Response> {
  const guard = capGuard(auth);
  if (guard) return guard;

  const clientId = scopeClientId(auth);
  const seg = await loadSegmentInTenant(env, segmentId, clientId);
  if (!seg) return json({ error: 'Segment introuvable' }, 404);

  const body = await request.json() as { name?: string; criteria?: unknown };
  const segClientId = (seg.client_id as string) || clientId;

  const updates: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    updates.push('name = ?');
    binds.push(body.name.trim());
  }
  let criteria: SegmentCriteria = parseCriteria(seg.criteria_json);
  if (body.criteria !== undefined) {
    criteria = parseCriteria(body.criteria);
    const bornageErr = validateBehavioralBornage(criteria, segClientId, isAgencyMode(auth));
    if (bornageErr) return bornageErr;
    updates.push('criteria_json = ?');
    binds.push(JSON.stringify(criteria));
  }
  if (updates.length === 0) return json({ data: { id: segmentId } });

  // Recompute cached_count avec les critères (potentiellement) mis à jour.
  const { count } = await resolveSegmentLeads(env, criteria, segClientId, 0);
  updates.push("cached_count = ?", "cached_at = datetime('now')", "updated_at = datetime('now')");
  binds.push(count);
  binds.push(segmentId);

  try {
    await env.DB.prepare(
      `UPDATE lead_segments SET ${updates.join(', ')} WHERE id = ?`,
    ).bind(...binds).run();
  } catch (err) {
    return json({ error: 'Mise à jour échouée: ' + String(err) }, 500);
  }
  return json({ data: { id: segmentId } });
}

// DELETE /api/segments/:id — suppression (capGuard + bornage tenant).
export async function handleDeleteSegment(
  env: Env,
  auth: SegmentAuth,
  segmentId: string,
): Promise<Response> {
  const guard = capGuard(auth);
  if (guard) return guard;

  const clientId = scopeClientId(auth);
  const seg = await loadSegmentInTenant(env, segmentId, clientId);
  if (!seg) return json({ error: 'Segment introuvable' }, 404);

  try {
    await env.DB.prepare('DELETE FROM lead_segments WHERE id = ?').bind(segmentId).run();
  } catch (err) {
    return json({ error: 'Suppression échouée: ' + String(err) }, 500);
  }
  return json({ data: { id: segmentId, deleted: true } });
}

// POST /api/segments/:id/enroll — enrôle EN MASSE les leads du segment dans un
// workflow (capGuard). Résout les leads via le builder → pour chaque lead
// appelle `autoEnroll` EXISTANT (workflows.ts, moteur READ-ONLY ; idempotent +
// best-effort par construction). Best-effort par lead (un échec n'arrête PAS
// la boucle). AUCUNE logique d'enrôlement neuve.
export async function handleEnrollSegment(
  request: Request,
  env: Env,
  auth: SegmentAuth,
  segmentId: string,
): Promise<Response> {
  const guard = capGuard(auth);
  if (guard) return guard;

  const clientId = scopeClientId(auth);
  const seg = await loadSegmentInTenant(env, segmentId, clientId);
  if (!seg) return json({ error: 'Segment introuvable' }, 404);

  const body = await request.json() as { workflow_id?: string };
  const workflowId = (body.workflow_id || '').trim();
  if (!workflowId) return json({ error: 'workflow_id requis' }, 400);

  const segClientId = (seg.client_id as string) || clientId;
  const criteria = parseCriteria(seg.criteria_json);

  // Résout les leads (id seul suffit pour autoEnroll).
  let leads: Array<{ id: string }> = [];
  try {
    const { sql, binds } = buildSegmentQuery(criteria, segClientId, 'leads.id');
    const res = binds.length > 0
      ? await env.DB.prepare(sql).bind(...binds).all()
      : await env.DB.prepare(sql).all();
    leads = (res.results || []) as Array<{ id: string }>;
  } catch (err) {
    return json({ error: 'Résolution des leads échouée: ' + String(err) }, 500);
  }

  let enrolled = 0;
  for (const lead of leads) {
    if (!lead?.id) continue;
    try {
      // autoEnroll EXISTANT : idempotent (anti-doublon actif) + void + best-effort.
      await autoEnroll(env, workflowId, lead.id);
      enrolled++;
    } catch (err) {
      console.error('handleEnrollSegment: enroll failed', segmentId, lead.id, err);
      // best-effort : un échec n'arrête pas la boucle.
    }
  }

  return json({ data: { enrolled } });
}

// GET /api/broadcasts/:id/variants — variantes A/B + stats sent/opened/clicked.
// Reporting open/click recalculé à la lecture via messages.campaign_variant_id
// JOIN message_events (best-effort ; fallback colonnes stockées).
export async function handleGetVariants(
  env: Env,
  auth: SegmentAuth,
  broadcastId: string,
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const broadcast = await env.DB.prepare('SELECT id FROM broadcasts WHERE id = ?').bind(broadcastId).first();
  if (!broadcast) return json({ error: 'Broadcast introuvable' }, 404);

  const { results } = await env.DB.prepare(
    'SELECT * FROM broadcast_variants WHERE broadcast_id = ? ORDER BY created_at ASC',
  ).bind(broadcastId).all();
  const variants = (results || []) as Array<Record<string, unknown>>;

  // Reporting open/click à la lecture (best-effort) : COUNT distinct messages
  // par variante. campaign_variant_id corrèle messages ↔ broadcast_variants.
  for (const v of variants) {
    const variantId = String(v.id || '');
    if (!variantId) continue;
    try {
      const agg = await env.DB.prepare(
        `SELECT
           (SELECT COUNT(DISTINCT m.id) FROM messages m
              JOIN message_events me ON me.message_id = m.id
            WHERE m.campaign_variant_id = ? AND me.event_type = 'open') AS opened,
           (SELECT COUNT(DISTINCT m.id) FROM messages m
              JOIN message_events me ON me.message_id = m.id
            WHERE m.campaign_variant_id = ? AND me.event_type = 'click') AS clicked`,
      ).bind(variantId, variantId).first() as { opened?: number; clicked?: number } | null;
      if (agg) {
        v.opened = Number(agg.opened || 0);
        v.clicked = Number(agg.clicked || 0);
      }
    } catch (err) {
      console.error('handleGetVariants: agg failed', variantId, err);
      // garde les valeurs stockées (best-effort).
    }
  }

  return json({ data: variants });
}

// POST /api/broadcasts/:id/variants — (re)définit les variantes A/B (capGuard).
// Valide somme split_pct = 100, REPLACE le set, pose ab_test_enabled.
export async function handleSetVariants(
  request: Request,
  env: Env,
  auth: SegmentAuth,
  broadcastId: string,
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const guard = capGuard(auth);
  if (guard) return guard;

  const broadcast = await env.DB.prepare('SELECT id FROM broadcasts WHERE id = ?').bind(broadcastId).first();
  if (!broadcast) return json({ error: 'Broadcast introuvable' }, 404);

  const body = await request.json() as {
    variants?: Array<{ label?: string; subject?: string; template_id?: string; body_html?: string; body_text?: string; split_pct?: number }>;
  };
  const variants = Array.isArray(body.variants) ? body.variants : [];

  // Valide somme split_pct = 100 (si au moins une variante).
  if (variants.length > 0) {
    const total = variants.reduce((s, v) => s + (Number(v.split_pct) || 0), 0);
    if (total !== 100) {
      return json({ error: 'La somme des pourcentages de répartition doit être égale à 100' }, 400);
    }
  }

  // REPLACE le set : DELETE + re-INSERT.
  try {
    await env.DB.prepare('DELETE FROM broadcast_variants WHERE broadcast_id = ?').bind(broadcastId).run();
    for (const v of variants) {
      await env.DB.prepare(
        `INSERT INTO broadcast_variants (id, broadcast_id, label, subject, template_id, body_html, body_text, split_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        broadcastId,
        v.label || null,
        v.subject || null,
        v.template_id || null,
        v.body_html || null,
        v.body_text || null,
        Math.max(0, Math.min(100, Math.floor(Number(v.split_pct) || 0))),
      ).run();
    }
    // ab_test_enabled = 1 si variantes, sinon 0 (retour au chemin legacy).
    await env.DB.prepare('UPDATE broadcasts SET ab_test_enabled = ? WHERE id = ?')
      .bind(variants.length > 0 ? 1 : 0, broadcastId).run();
  } catch (err) {
    return json({ error: 'Enregistrement des variantes échoué: ' + String(err) }, 500);
  }

  return json({ data: { broadcast_id: broadcastId, variants: variants.length, ab_test_enabled: variants.length > 0 ? 1 : 0 } });
}
