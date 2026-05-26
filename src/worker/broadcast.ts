// ── Module Broadcast — Intralys CRM (refactoré Sprint Consolidation Queue) ──
// Sprint 5 (LOT EMAIL 5) — enrichissement ADDITIF Phase B (Manager-B) :
//   - scheduled_at  : broadcast PROGRAMMÉ (status 'queued' EXISTANT + scheduled_at
//                      futur ; NE PAS enqueue immédiat — le cron
//                      processScheduledBroadcasts le prendra). scheduled_at NULL
//                      ⇒ comportement legacy strictement identique.
//   - throttle_per_min : envoi paced (chunks espacés) si > 0 ; 0 ⇒ legacy
//                      Promise.all aveugle byte-identique.
//   - filters.source / filters.tags : appliqués RÉELLEMENT (gap §6.G corrigé) ;
//                      garde cross-tenant (client_id requis si tags) CONSERVÉE.
//   - tracking : la branche Resend RÉELLE INSERT désormais un row `messages`
//                (campaign_id = broadcast.id, campaign_kind='broadcast') AVANT
//                envoi, injecte le pixel /api/t/o/:id + réécrit les href en
//                /api/t/c/:id?url= (RÉUTILISE tracking.ts, READ-ONLY).
//   - mock honnête : status 'mock-sent' si !RESEND_API_KEY (jamais faux 'sent').
// Rétro-compat : scheduled_at NULL / throttle 0 / campaign_id NULL ⇒ legacy.
import type { Env } from './types';
import { json, audit, sendSms } from './helpers';
import { isUnsubscribed } from './compliance';
// LOT G6 — résolution segment_id→leads (builder partagé, exporté par
// segments.ts ; import unidirectionnel broadcast.ts → segments.ts, ZÉRO cycle :
// segments.ts n'importe PAS broadcast.ts).
import { buildSegmentQuery } from './segments';

// ── Helper tracking PARTAGÉ (broadcast + séquence) ──────────────────────────
// Injecte le pixel d'ouverture et réécrit les liens sortants pour pointer vers
// le tracker EXISTANT (tracking.ts, READ-ONLY) : pixel /api/t/o/{messageId},
// redirect /api/t/c/{messageId}?url={enc}. Best-effort, jamais throw : si le
// HTML est vide / malformé on renvoie l'entrée telle quelle (mieux vaut un mail
// non-tracké qu'un mail cassé). Exporté pour RÉUTILISATION par workflows.ts
// (case send_email, derrière garde additive `if (campaignKind)` — §6.H).
export function injectTracking(
  html: string,
  messageId: string,
  origin: string,
): string {
  if (!html || !messageId || !origin) return html || '';
  let out = html;
  try {
    // Réécriture des href absolus http(s) → tracker (on NE touche PAS aux
    // ancres internes #, mailto:, tel:, ni à l'URL de désabonnement déjà posée
    // par compliance — celle-ci passe aussi par le tracker, comportement voulu :
    // un clic « désabonnement » reste compté comme un clic et redirige bien).
    out = out.replace(
      /(<a\b[^>]*\bhref\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi,
      (_m, pre: string, q: string, target: string) =>
        `${pre}${q}${origin}/api/t/c/${messageId}?url=${encodeURIComponent(target)}${q}`,
    );
    // Pixel d'ouverture inséré juste avant </body> si présent, sinon en fin.
    const pixel = `<img src="${origin}/api/t/o/${messageId}" width="1" height="1" alt="" style="display:none" />`;
    if (/<\/body>/i.test(out)) {
      out = out.replace(/<\/body>/i, `${pixel}</body>`);
    } else {
      out = out + pixel;
    }
  } catch {
    return html;
  }
  return out;
}

export async function handleEmailBroadcast(request: Request, env: Env, auth: { userId: string; role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const body = await request.json() as {
    subject?: string; body_html?: string; body_text?: string; text_content?: string;
    template_id?: string; client_id?: string;
    scheduled_at?: string | null; throttle_per_min?: number;
    filters?: { status?: string[]; type?: string[]; source?: string[]; tags?: string[] };
    // LOT G6 — ciblage par SEGMENT réutilisable (ADDITIF ; absent ⇒ ciblage par
    // filters legacy byte-identique). variants ⇒ A/B (handleSetVariants).
    segment_id?: string;
    // LOT SMS/WHATSAPP seq 104 (§6.A/§6.H) — canal de diffusion. ADDITIF :
    //   absent / 'email' ⇒ chemin email legacy STRICTEMENT byte-identique.
    //   'sms' ⇒ mass-send SMS (Twilio helpers.sendSms par lead, body_text en
    //   clair). Champs gelés côté api par Phase A (sendBroadcast étendu).
    channel?: 'email' | 'sms';
  };
  if (!body.subject) return json({ error: 'Sujet requis' }, 400);

  // ── LOT SMS/WHATSAPP seq 104 — MASS-SEND SMS (§6.H) ─────────────────────────
  // Chemin SMS COMPLÈTEMENT SÉPARÉ du chemin email (qui reste byte-identique
  // plus bas). On ne l'active que si channel === 'sms' ; toute autre valeur
  // (absente / 'email') tombe dans le chemin email legacy intact.
  if (body.channel === 'sms') {
    return handleSmsBroadcast(request, env, auth, body);
  }

  let htmlContent = body.body_html || '';
  let textContent = body.body_text || body.text_content || '';

  if (body.template_id) {
    const tpl = await env.DB.prepare('SELECT subject, body_html, body_text FROM email_templates WHERE id = ?').bind(body.template_id).first() as { subject: string; body_html: string; body_text: string } | null;
    if (tpl) { htmlContent = htmlContent || tpl.body_html; textContent = textContent || tpl.body_text; }
  }
  if (!htmlContent && !textContent) return json({ error: 'Contenu email requis (body_html, body_text ou text_content)' }, 400);

  // Fix smell #10 : client_id OBLIGATOIRE si filters.tags présent (garde cross-tenant)
  if (body.filters?.tags?.length && !body.client_id) {
    return json({ error: 'client_id requis quand des tags sont utilisés comme filtre (protection cross-tenant)' }, 400);
  }

  let leads: Array<Record<string, unknown>> | null = null;

  // LOT G6 — ciblage par SEGMENT (ADDITIF). segment_id fourni ⇒ on résout
  // l'audience via le segment (criteria_json + buildSegmentQuery, bornage tenant
  // par le client_id du segment — FLAG-3 cross-tenant garanti par le builder).
  // ABSENT ⇒ chemin legacy filters STRICTEMENT byte-identique Sprint 5.
  if (body.segment_id) {
    const seg = await env.DB.prepare(
      'SELECT id, client_id, criteria_json FROM lead_segments WHERE id = ?',
    ).bind(body.segment_id).first() as { id: string; client_id: string | null; criteria_json: string | null } | null;
    if (!seg) return json({ error: 'Segment introuvable' }, 404);
    // client_id de bornage = celui du segment (priorité), sinon le body. FLAG-3.
    const segClientId = seg.client_id || body.client_id || null;
    let criteria: import('./segments').SegmentCriteria = {};
    try { criteria = JSON.parse(seg.criteria_json || '{}'); } catch { criteria = {}; }
    // On projette les colonnes d'envoi + on filtre email valide / DND comme le
    // chemin legacy (le builder ne pose pas ces contraintes — on les ajoute).
    const { sql, binds } = buildSegmentQuery(criteria, segClientId, 'leads.id, leads.name, leads.email, leads.dnd, leads.dnd_settings, leads.preferred_language');
    // Mêmes garde-fous d'éligibilité que le chemin legacy : email valide + DND
    // email respecté (le builder n'impose ni l'un ni l'autre). On filtre via la
    // sous-requête puis on ne projette que id/name/email/langue à l'enqueue.
    // MULTILANG-B : preferred_language projeté pour localiser le footer CASL
    // sortant (NULL ⇒ défaut fr-CA byte-identique côté generateCaslFooter).
    const guarded =
      `SELECT id, name, email, preferred_language FROM (${sql}) WHERE email != '' AND email IS NOT NULL AND (dnd = 0 OR dnd IS NULL OR json_extract(dnd_settings, '$.email') = 0)`;
    const res = binds.length > 0
      ? await env.DB.prepare(guarded).bind(...binds).all()
      : await env.DB.prepare(guarded).all();
    leads = (res.results || []) as Array<Record<string, unknown>>;
  } else {
    // MULTILANG-B : preferred_language projeté pour localiser le footer CASL.
    let query = "SELECT id, name, email, preferred_language FROM leads WHERE email != '' AND email IS NOT NULL AND (dnd = 0 OR dnd IS NULL OR json_extract(dnd_settings, '$.email') = 0)";
    const params: string[] = [];
    if (body.client_id) { query += ' AND client_id = ?'; params.push(body.client_id); }
    if (body.filters?.status?.length) { const ph = body.filters.status.map(() => '?').join(','); query += ` AND status IN (${ph})`; params.push(...body.filters.status); }
    if (body.filters?.type?.length) { const ph = body.filters.type.map(() => '?').join(','); query += ` AND type IN (${ph})`; params.push(...body.filters.type); }
    // §6.G — gap corrigé : source/tags étaient déclarés mais JAMAIS appliqués.
    if (body.filters?.source?.length) { const ph = body.filters.source.map(() => '?').join(','); query += ` AND source IN (${ph})`; params.push(...body.filters.source); }
    if (body.filters?.tags?.length) {
      const ph = body.filters.tags.map(() => '?').join(',');
      // Calque workflows.ts:643 (lead_tags) — EXISTS pour ne pas dupliquer les
      // lignes leads ; garde cross-tenant déjà imposée plus haut (client_id requis).
      query += ` AND EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.lead_id = leads.id AND lt.tag IN (${ph}))`;
      params.push(...body.filters.tags);
    }
    const stmt = env.DB.prepare(query);
    const r = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
    leads = (r.results || []) as Array<Record<string, unknown>>;
  }
  if (!leads || leads.length === 0) return json({ error: 'Aucun lead correspondant' }, 400);

  const broadcastId = crypto.randomUUID();

  // Fix smell #13 : filtrer unsubscribe AVANT le count
  const eligibleLeads: Array<{ id: string; name: string; email: string }> = [];
  for (const lead of leads as Array<{ id: string; name: string; email: string }>) {
    const unsub = await isUnsubscribed(env, lead.email, '', 'email');
    if (!unsub) eligibleLeads.push(lead);
  }

  if (eligibleLeads.length === 0) return json({ error: 'Aucun lead éligible (tous désabonnés)' }, 400);

  // §6.B/§6.F — broadcast PROGRAMMÉ : scheduled_at futur ⇒ status 'queued'
  // (valeur EXISTANTE du CHECK seq 24, AUCUNE valeur neuve) + scheduled_at posé,
  // PAS d'enqueue immédiat (le cron processScheduledBroadcasts → enqueue à
  // l'échéance). scheduled_at absent / NULL / passé ⇒ legacy immédiat.
  const throttlePerMin = Number.isFinite(body.throttle_per_min) && (body.throttle_per_min as number) > 0
    ? Math.floor(body.throttle_per_min as number)
    : 0;
  let scheduledAt: string | null = null;
  if (body.scheduled_at) {
    const t = Date.parse(body.scheduled_at);
    if (!Number.isNaN(t) && t > Date.now()) scheduledAt = new Date(t).toISOString();
  }

  // Insérer dans la table broadcasts (status 'queued' — INTOUCHÉ ; scheduled_at
  // / throttle_per_min sont des colonnes ADDITIVES seq 86 ; segment_id ADDITIF
  // seq 90, NULL en ciblage legacy).
  await env.DB.prepare(
    `INSERT INTO broadcasts (id, client_id, user_id, subject, template_id, body_html, body_text, filters_json, total, status, scheduled_at, throttle_per_min, segment_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
  ).bind(
    broadcastId, body.client_id || null, auth.userId, body.subject, body.template_id || null, htmlContent, textContent, JSON.stringify(body.filters || {}), eligibleLeads.length, scheduledAt, throttlePerMin, body.segment_id || null
  ).run();

  await audit(env, auth.userId, scheduledAt ? 'broadcast.scheduled' : 'broadcast.queued', 'broadcast', broadcastId, {
    subject: body.subject, recipient_count: eligibleLeads.length,
    filters: body.filters || {}, client_id: body.client_id || 'all',
    scheduled_at: scheduledAt, throttle_per_min: throttlePerMin
  });

  if (scheduledAt) {
    // Programmé : on ne touche PAS la queue maintenant. Le cron prendra le
    // relais à l'échéance (réutilise enqueueBroadcastJobs ci-dessous).
    return json({
      data: {
        broadcast_id: broadcastId,
        total_recipients: eligibleLeads.length,
        jobs_enqueued: 0,
        status: 'queued',
        scheduled_at: scheduledAt
      }
    });
  }

  const jobsEnqueued = await enqueueBroadcastJobs(env, {
    broadcastId,
    subject: body.subject,
    htmlContent,
    textContent,
    clientId: body.client_id,
    authUserId: auth.userId,
    leads: eligibleLeads,
    origin: new URL(request.url).origin,
    throttlePerMin
  });

  return json({
    data: {
      broadcast_id: broadcastId,
      total_recipients: eligibleLeads.length,
      jobs_enqueued: jobsEnqueued,
      status: 'queued'
    }
  });
}

// ── LOT SMS/WHATSAPP seq 104 — MASS-SEND SMS (§6.H, Manager-B) ──────────────
// Chemin SMS du broadcast de masse, SÉPARÉ du chemin email (qui reste
// byte-identique). Sélection des destinataires sur `phone != ''` (au lieu de
// `email`), DND SMS respecté (json_extract dnd_settings.$.sms), filtre opt-out
// CASL via isUnsubscribed(...,'sms'), envoi via helpers.sendSms (FLAG INACTIF
// sans credentials Twilio ⇒ success:false, aucun appel réseau), INSERT messages
// channel 'sms' (corps = broadcasts.body_text). broadcasts.channel='sms' +
// body_text posés (colonnes seq 104). Programmation (scheduled_at) NON gérée
// pour SMS dans cette itération (envoi immédiat). best-effort partout.
async function handleSmsBroadcast(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  body: {
    subject?: string; body_text?: string; client_id?: string;
    filters?: { status?: string[]; type?: string[]; source?: string[]; tags?: string[] };
    segment_id?: string;
    throttle_per_min?: number;
  },
): Promise<Response> {
  const smsBody = (body.body_text || '').trim();
  if (!smsBody) return json({ error: 'Contenu SMS requis (body_text)' }, 400);

  // Garde cross-tenant identique au chemin email : tags ⇒ client_id obligatoire.
  if (body.filters?.tags?.length && !body.client_id) {
    return json({ error: 'client_id requis quand des tags sont utilisés comme filtre (protection cross-tenant)' }, 400);
  }

  let leads: Array<{ id: string; name: string; phone: string }> | null = null;

  if (body.segment_id) {
    const seg = await env.DB.prepare(
      'SELECT id, client_id, criteria_json FROM lead_segments WHERE id = ?',
    ).bind(body.segment_id).first() as { id: string; client_id: string | null; criteria_json: string | null } | null;
    if (!seg) return json({ error: 'Segment introuvable' }, 404);
    const segClientId = seg.client_id || body.client_id || null;
    let criteria: import('./segments').SegmentCriteria = {};
    try { criteria = JSON.parse(seg.criteria_json || '{}'); } catch { criteria = {}; }
    const { sql, binds } = buildSegmentQuery(criteria, segClientId, 'leads.id, leads.name, leads.phone, leads.dnd, leads.dnd_settings');
    // Éligibilité SMS : téléphone non vide + DND SMS respecté.
    const guarded =
      `SELECT id, name, phone FROM (${sql}) WHERE phone != '' AND phone IS NOT NULL AND (dnd = 0 OR dnd IS NULL OR json_extract(dnd_settings, '$.sms') = 0)`;
    const res = binds.length > 0
      ? await env.DB.prepare(guarded).bind(...binds).all()
      : await env.DB.prepare(guarded).all();
    leads = (res.results || []) as Array<{ id: string; name: string; phone: string }>;
  } else {
    let query = "SELECT id, name, phone FROM leads WHERE phone != '' AND phone IS NOT NULL AND (dnd = 0 OR dnd IS NULL OR json_extract(dnd_settings, '$.sms') = 0)";
    const params: string[] = [];
    if (body.client_id) { query += ' AND client_id = ?'; params.push(body.client_id); }
    if (body.filters?.status?.length) { const ph = body.filters.status.map(() => '?').join(','); query += ` AND status IN (${ph})`; params.push(...body.filters.status); }
    if (body.filters?.type?.length) { const ph = body.filters.type.map(() => '?').join(','); query += ` AND type IN (${ph})`; params.push(...body.filters.type); }
    if (body.filters?.source?.length) { const ph = body.filters.source.map(() => '?').join(','); query += ` AND source IN (${ph})`; params.push(...body.filters.source); }
    if (body.filters?.tags?.length) {
      const ph = body.filters.tags.map(() => '?').join(',');
      query += ` AND EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.lead_id = leads.id AND lt.tag IN (${ph}))`;
      params.push(...body.filters.tags);
    }
    const stmt = env.DB.prepare(query);
    const r = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
    leads = (r.results || []) as Array<{ id: string; name: string; phone: string }>;
  }

  if (!leads || leads.length === 0) return json({ error: 'Aucun lead correspondant' }, 400);

  // Filtre opt-out CASL (channel 'sms') AVANT le count.
  const eligibleLeads: Array<{ id: string; name: string; phone: string }> = [];
  for (const lead of leads) {
    const unsub = await isUnsubscribed(env, '', lead.phone, 'sms');
    if (!unsub) eligibleLeads.push(lead);
  }
  if (eligibleLeads.length === 0) return json({ error: 'Aucun lead éligible (tous désabonnés)' }, 400);

  const broadcastId = crypto.randomUUID();
  const throttlePerMin = Number.isFinite(body.throttle_per_min) && (body.throttle_per_min as number) > 0
    ? Math.floor(body.throttle_per_min as number)
    : 0;

  // INSERT broadcasts avec channel='sms' + body_text (colonnes seq 104). On
  // réutilise les colonnes existantes : subject sert d'étiquette, body_html
  // reste vide (NULL/'' — non utilisé en SMS).
  await env.DB.prepare(
    `INSERT INTO broadcasts (id, client_id, user_id, subject, body_html, body_text, filters_json, total, status, throttle_per_min, channel)
     VALUES (?, ?, ?, ?, '', ?, ?, ?, 'queued', ?, 'sms')`
  ).bind(
    broadcastId, body.client_id || null, auth.userId, body.subject || 'Diffusion SMS',
    smsBody, JSON.stringify(body.filters || {}), eligibleLeads.length, throttlePerMin
  ).run();

  await audit(env, auth.userId, 'broadcast.queued', 'broadcast', broadcastId, {
    channel: 'sms', recipient_count: eligibleLeads.length,
    filters: body.filters || {}, client_id: body.client_id || 'all',
  });

  // Enqueue par batch de 50, payload portant channel='sms' + smsBody + phone.
  const batchSize = 50;
  let jobsEnqueued = 0;
  for (let i = 0; i < eligibleLeads.length; i += batchSize) {
    const batch = eligibleLeads.slice(i, i + batchSize);
    await env.BROADCAST_QUEUE.send({
      broadcastId,
      channel: 'sms',
      smsBody,
      clientId: body.client_id || null,
      authUserId: auth.userId,
      leads: batch,
      origin: new URL(request.url).origin,
      throttlePerMin,
    });
    jobsEnqueued++;
  }

  return json({
    data: {
      broadcast_id: broadcastId,
      total_recipients: eligibleLeads.length,
      jobs_enqueued: jobsEnqueued,
      status: 'queued',
      channel: 'sms',
    }
  });
}

// Enqueue partagé (broadcast immédiat ET broadcast programmé échu). Batch par
// 50 pour la Queue Cloudflare (legacy byte-identique quand throttlePerMin = 0 :
// même batchSize, même payload — throttlePerMin ajouté au job, ignoré par le
// worker si 0). Retourne le nombre de jobs enfournés.
//
// LOT G6 — A/B testing (ADDITIF). enqueueBroadcastJobs charge les variants du
// broadcast : si AUCUNE variante ⇒ chemin legacy STRICTEMENT byte-identique
// Sprint 5 (payload SANS variantId/variantSubject/variantHtml/variantText). Si
// variantes ⇒ partition déterministe des leads par split_pct, chaque batch porte
// le contenu (subject/html/text) ET l'id de SA variante.
async function enqueueBroadcastJobs(
  env: Env,
  job: {
    broadcastId: string;
    subject: string;
    htmlContent: string;
    textContent: string;
    clientId?: string | null;
    authUserId: string;
    leads: Array<{ id: string; name: string; email: string }>;
    origin: string;
    throttlePerMin: number;
  }
): Promise<number> {
  const batchSize = 50;

  // ── A/B : charge les variantes (best-effort ; toute erreur ⇒ legacy). ──
  let variants: Array<{ id: string; subject: string | null; body_html: string | null; body_text: string | null; split_pct: number }> = [];
  try {
    const r = await env.DB.prepare(
      'SELECT id, subject, body_html, body_text, split_pct FROM broadcast_variants WHERE broadcast_id = ? ORDER BY created_at ASC',
    ).bind(job.broadcastId).all();
    variants = ((r.results || []) as Array<Record<string, unknown>>).map((v) => ({
      id: String(v.id || ''),
      subject: (v.subject as string) ?? null,
      body_html: (v.body_html as string) ?? null,
      body_text: (v.body_text as string) ?? null,
      split_pct: Number(v.split_pct) || 0,
    })).filter((v) => v.id);
  } catch (err) {
    console.error('enqueueBroadcastJobs: variants load failed (legacy fallback)', job.broadcastId, err);
    variants = [];
  }

  // ── Chemin LEGACY (pas de variantes) — payload bit-identique Sprint 5. ──
  if (variants.length === 0) {
    let jobsEnqueued = 0;
    for (let i = 0; i < job.leads.length; i += batchSize) {
      const batch = job.leads.slice(i, i + batchSize);
      await env.BROADCAST_QUEUE.send({
        broadcastId: job.broadcastId,
        subject: job.subject,
        htmlContent: job.htmlContent,
        textContent: job.textContent,
        clientId: job.clientId,
        authUserId: job.authUserId,
        leads: batch,
        origin: job.origin,
        throttlePerMin: job.throttlePerMin
      });
      jobsEnqueued++;
    }
    return jobsEnqueued;
  }

  // ── Chemin A/B : partition déterministe des leads par split_pct. ──
  // Assignation par seuils cumulés sur l'index du lead (déterministe, reflète le
  // split global ; le dernier reçoit le reste pour absorber l'arrondi). Une
  // variante au split_pct=0 ne reçoit aucun lead. Contenu de la variante : sa
  // colonne propre si renseignée, sinon le contenu de base du broadcast (la
  // variante peut ne changer que le sujet, p.ex.).
  const total = job.leads.length;
  const counts: number[] = variants.map((v) => Math.floor((v.split_pct / 100) * total));
  let assigned = counts.reduce((s, n) => s + n, 0);
  // Distribue le reste d'arrondi aux premières variantes (split_pct > 0).
  let vi = 0;
  while (assigned < total && variants.length > 0) {
    if (variants[vi % variants.length]!.split_pct > 0) { counts[vi % variants.length]!++; assigned++; }
    vi++;
    if (vi > variants.length * 2 + total) break; // garde-fou anti-boucle.
  }

  let jobsEnqueued = 0;
  let cursor = 0;
  for (let v = 0; v < variants.length; v++) {
    const variant = variants[v]!;
    const slice = job.leads.slice(cursor, cursor + (counts[v] || 0));
    cursor += counts[v] || 0;
    if (slice.length === 0) continue;
    const vSubject = variant.subject || job.subject;
    const vHtml = variant.body_html || job.htmlContent;
    const vText = variant.body_text ?? job.textContent;
    for (let i = 0; i < slice.length; i += batchSize) {
      const batch = slice.slice(i, i + batchSize);
      await env.BROADCAST_QUEUE.send({
        broadcastId: job.broadcastId,
        subject: vSubject,
        htmlContent: vHtml,
        textContent: vText,
        clientId: job.clientId,
        authUserId: job.authUserId,
        leads: batch,
        origin: job.origin,
        throttlePerMin: job.throttlePerMin,
        // ADDITIF A/B : présent SEULEMENT en chemin variante (legacy = absent).
        variantId: variant.id,
      });
      jobsEnqueued++;
    }
  }
  return jobsEnqueued;
}

// ── Cron : broadcasts PROGRAMMÉS échus ──────────────────────────────────────
// Appelé par processScheduledBroadcasts (sequences.ts) depuis worker.ts
// scheduled() (pattern E7 best-effort). SELECT borné LIMIT 50 des broadcasts
// status='queued' AND scheduled_at <= now ; pour chacun on rejoue le SELECT de
// leads à partir de filters_json (mêmes filtres que l'envoi immédiat, bornage
// client_id CONSERVÉ), on enfourne via enqueueBroadcastJobs, puis on EFFACE
// scheduled_at (NULL) pour ne pas ré-enfourner au prochain tick (idempotence —
// le status reste 'queued', valeur EXISTANTE du CHECK seq 24, AUCUNE neuve).
// Best-effort : un broadcast en erreur n'arrête PAS les autres ; jamais throw.
export async function runDueScheduledBroadcasts(env: Env): Promise<void> {
  let due: Array<Record<string, unknown>> = [];
  try {
    const r = await env.DB.prepare(
      `SELECT id, client_id, user_id, subject, body_html, body_text, filters_json, throttle_per_min, segment_id
       FROM broadcasts
       WHERE scheduled_at IS NOT NULL AND scheduled_at <= datetime('now') AND status = 'queued'
       ORDER BY scheduled_at ASC LIMIT 50`
    ).all();
    due = (r.results || []) as Array<Record<string, unknown>>;
  } catch (err) {
    console.error('runDueScheduledBroadcasts: select failed', err);
    return;
  }

  for (const b of due) {
    const broadcastId = String(b.id || '');
    if (!broadcastId) continue;
    try {
      // Marquer scheduled_at = NULL TOUT DE SUITE (verrou d'idempotence : un
      // second tick concurrent ne le re-sélectionnera pas — status reste
      // 'queued', AUCUNE valeur de CHECK neuve).
      await env.DB.prepare(
        `UPDATE broadcasts SET scheduled_at = NULL WHERE id = ? AND scheduled_at IS NOT NULL`
      ).bind(broadcastId).run();

      const clientId = (b.client_id as string) || null;
      const segmentId = (b.segment_id as string) || null;
      let rawLeads: Array<{ id: string; name: string; email: string; preferred_language?: string | null }> = [];

      // LOT G6 — broadcast programmé ciblé par SEGMENT : on re-résout l'audience
      // via le segment à l'échéance (criteria_json + buildSegmentQuery, bornage
      // par le client_id du segment — FLAG-3). ABSENT ⇒ chemin filters legacy
      // byte-identique. Re-résolution à l'échéance (pas figée) : un programmé
      // reflète l'audience au moment de l'envoi.
      if (segmentId) {
        try {
          const seg = await env.DB.prepare(
            'SELECT client_id, criteria_json FROM lead_segments WHERE id = ?',
          ).bind(segmentId).first() as { client_id: string | null; criteria_json: string | null } | null;
          if (seg) {
            const segClientId = seg.client_id || clientId || null;
            let criteria: import('./segments').SegmentCriteria = {};
            try { criteria = JSON.parse(seg.criteria_json || '{}'); } catch { criteria = {}; }
            const { sql, binds } = buildSegmentQuery(criteria, segClientId, 'leads.id, leads.name, leads.email, leads.dnd, leads.dnd_settings, leads.preferred_language');
            // MULTILANG-B : preferred_language projeté pour localiser le footer CASL.
            const guarded = `SELECT id, name, email, preferred_language FROM (${sql}) WHERE email != '' AND email IS NOT NULL AND (dnd = 0 OR dnd IS NULL OR json_extract(dnd_settings, '$.email') = 0)`;
            const sres = binds.length > 0
              ? await env.DB.prepare(guarded).bind(...binds).all()
              : await env.DB.prepare(guarded).all();
            rawLeads = (sres.results || []) as Array<{ id: string; name: string; email: string; preferred_language?: string | null }>;
          }
        } catch (err) {
          console.error('runDueScheduledBroadcasts: segment resolve failed', broadcastId, segmentId, err);
          rawLeads = [];
        }
      } else {
        let filters: { status?: string[]; type?: string[]; source?: string[]; tags?: string[] } = {};
        try { filters = JSON.parse(String(b.filters_json || '{}')); } catch { /* */ }

        // Re-sélection des leads à l'échéance (mêmes règles que l'envoi immédiat
        // — DND, bornage client_id, status/type/source/tags). On recalcule plutôt
        // que de figer la liste : un programmé doit refléter l'audience au moment
        // de l'envoi (leads ajoutés/retirés entre la programmation et l'échéance).
        // MULTILANG-B : preferred_language projeté pour localiser le footer CASL.
        let query = "SELECT id, name, email, preferred_language FROM leads WHERE email != '' AND email IS NOT NULL AND (dnd = 0 OR dnd IS NULL OR json_extract(dnd_settings, '$.email') = 0)";
        const params: string[] = [];
        if (clientId) { query += ' AND client_id = ?'; params.push(clientId); }
        if (filters.status?.length) { const ph = filters.status.map(() => '?').join(','); query += ` AND status IN (${ph})`; params.push(...filters.status); }
        if (filters.type?.length) { const ph = filters.type.map(() => '?').join(','); query += ` AND type IN (${ph})`; params.push(...filters.type); }
        if (filters.source?.length) { const ph = filters.source.map(() => '?').join(','); query += ` AND source IN (${ph})`; params.push(...filters.source); }
        if (filters.tags?.length && clientId) {
          // Garde cross-tenant : tags appliqués UNIQUEMENT si client_id borné
          // (un programmé sans client_id n'applique pas les tags — sûr).
          const ph = filters.tags.map(() => '?').join(',');
          query += ` AND EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.lead_id = leads.id AND lt.tag IN (${ph}))`;
          params.push(...filters.tags);
        }

        const stmt = env.DB.prepare(query);
        const { results: leads } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
        rawLeads = (leads || []) as Array<{ id: string; name: string; email: string; preferred_language?: string | null }>;
      }

      const eligibleLeads: Array<{ id: string; name: string; email: string; preferred_language?: string | null }> = [];
      for (const lead of rawLeads) {
        const unsub = await isUnsubscribed(env, lead.email, '', 'email');
        if (!unsub) eligibleLeads.push(lead);
      }

      if (eligibleLeads.length === 0) {
        // Aucun destinataire : compléter proprement (valeur EXISTANTE du CHECK).
        await env.DB.prepare(
          `UPDATE broadcasts SET status = 'completed', total = 0, completed_at = datetime('now') WHERE id = ?`
        ).bind(broadcastId).run();
        continue;
      }

      // Resynchroniser le total réel (l'audience a pu changer depuis la
      // programmation) pour que l'agrégat de complétion soit correct.
      await env.DB.prepare(`UPDATE broadcasts SET total = ? WHERE id = ?`)
        .bind(eligibleLeads.length, broadcastId).run();

      await enqueueBroadcastJobs(env, {
        broadcastId,
        subject: String(b.subject || ''),
        htmlContent: String(b.body_html || ''),
        textContent: String(b.body_text || ''),
        clientId,
        authUserId: String(b.user_id || ''),
        leads: eligibleLeads,
        // Le cron n'a pas de Request : on reconstruit l'origin depuis l'env
        // (PUBLIC_BASE_URL / APP_URL si fournis — lecture tolérante, Env GELÉ
        // donc accès indexé ; sinon défaut sûr). Best-effort, le pixel/lien
        // reste cohérent avec le déploiement.
        origin: String(
          (env as unknown as Record<string, string | undefined>).PUBLIC_BASE_URL ||
          (env as unknown as Record<string, string | undefined>).APP_URL ||
          'https://app.intralys.com'
        ).replace(/\/+$/, ''),
        throttlePerMin: Number(b.throttle_per_min) > 0 ? Math.floor(Number(b.throttle_per_min)) : 0
      });
    } catch (err) {
      console.error('runDueScheduledBroadcasts: broadcast failed', broadcastId, err);
      // On NE remet PAS scheduled_at (évite une boucle d'échec infinie au
      // prochain tick). Le broadcast reste 'queued' ; les jobs déjà enfournés
      // (le cas échéant) seront traités normalement. Best-effort, jamais throw.
    }
  }
}

export async function handleGetBroadcasts(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const { results } = await env.DB.prepare(`SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  return json({ data: results || [] });
}

export async function handleGetBroadcastDetail(env: Env, auth: { role: string }, broadcastId: string): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const broadcast = await env.DB.prepare(`SELECT * FROM broadcasts WHERE id = ?`).bind(broadcastId).first();
  if (!broadcast) return json({ error: 'Broadcast introuvable' }, 404);
  return json({ data: broadcast });
}

export async function processBroadcastQueueJob(batch: MessageBatch<any>, env: Env): Promise<void> {
  // Optionnel: importer Resend statiquement en haut
  const { Resend } = await import('resend');
  const { generateUnsubscribeToken, generateCaslFooter, generateAmfDisclaimer, isUnsubscribed } = await import('./compliance');

  for (const message of batch.messages) {
    const job = message.body;

    // ── LOT SMS/WHATSAPP seq 104 — branche MASS-SEND SMS (§6.H) ──────────────
    // Job émis par handleSmsBroadcast (channel='sms', smsBody, leads[].phone).
    // COMPLÈTEMENT séparé du chemin email ci-dessous (qui reste byte-identique).
    // Envoi via helpers.sendSms (FLAG INACTIF sans credentials Twilio ⇒
    // success:false, AUCUN appel réseau ⇒ comptés en failed, jamais faux 'sent').
    // INSERT messages channel 'sms' (corps = broadcasts.body_text). Re-check
    // opt-out CASL par lead juste avant envoi. Statut final/complétion réutilisent
    // l'agrégat broadcasts (sent/failed/total), SANS l'agrégat open/click email.
    if (job.channel === 'sms') {
      const { broadcastId, smsBody, clientId, authUserId, leads } = job;
      let sent = 0;
      let failed = 0;
      await env.DB.prepare(`UPDATE broadcasts SET status = 'processing' WHERE id = ?`).bind(broadcastId).run();
      for (const lead of leads) {
        try {
          const isUnsub = await isUnsubscribed(env, '', lead.phone, 'sms');
          if (isUnsub) { failed++; continue; }
          const personalized = String(smsBody || '')
            .replace(/\{\{nom\}\}/g, lead.name || '')
            .replace(/\{\{name\}\}/g, lead.name || '');
          const r = await sendSms(env, lead.phone, personalized);
          const msgId = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT INTO messages (id, lead_id, client_id, direction, channel, body, status, sent_by, external_id, campaign_id, campaign_kind)
             VALUES (?, ?, ?, 'outbound', 'sms', ?, ?, ?, ?, ?, 'broadcast')`
          ).bind(
            msgId, lead.id, clientId || '', personalized,
            r.success ? 'sent' : 'failed', authUserId, r.sid || '', broadcastId
          ).run();
          if (r.success) sent++; else failed++;
        } catch {
          failed++;
        }
      }
      await env.DB.prepare(`UPDATE broadcasts SET sent = sent + ?, failed = failed + ? WHERE id = ?`).bind(sent, failed, broadcastId).run();
      const bs = await env.DB.prepare(`SELECT total, sent, failed FROM broadcasts WHERE id = ?`).bind(broadcastId).first() as { total: number; sent: number; failed: number } | null;
      if (bs && (bs.sent + bs.failed) >= bs.total) {
        await env.DB.prepare(`UPDATE broadcasts SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).bind(broadcastId).run();
        await audit(env, authUserId, 'broadcast.complete', 'broadcast', broadcastId, { channel: 'sms', sent: bs.sent, failed: bs.failed, total: bs.total });
      }
      message.ack();
      continue;
    }

    const { broadcastId, subject, htmlContent, textContent, clientId, authUserId, leads, origin } = job;
    // LOT G6 — A/B : campaign_variant_id du job (NULL en legacy : le job legacy
    // n'embarque PAS `variantId` ⇒ undefined ⇒ NULL à l'INSERT).
    const campaignVariantId: string | null = job.variantId || null;
    // throttle_per_min : ADDITIF. Absent / 0 ⇒ legacy Promise.all aveugle
    // byte-identique. > 0 ⇒ envoi paced par chunks de `throttlePerMin` avec
    // attente d'~1 min entre chunks (débit honnête, jamais de spam).
    const throttlePerMin: number = Number(job.throttlePerMin) > 0 ? Math.floor(Number(job.throttlePerMin)) : 0;

    let sent = 0;
    let failed = 0;

    // Update status to processing
    await env.DB.prepare(`UPDATE broadcasts SET status = 'processing' WHERE id = ?`).bind(broadcastId).run();

    if (env.USE_MOCKS === 'true') {
      for (const lead of leads) {
        try {
          const isUnsub = await isUnsubscribed(env, lead.email, lead.phone, 'email');
          if (isUnsub) {
            failed++;
            continue;
          }
          const personalizedHtml = htmlContent.replace(/\{\{nom\}\}/g, lead.name || '').replace(/\{\{name\}\}/g, lead.name || '').replace(/\{\{email\}\}/g, lead.email || '');
          const unsubToken = generateUnsubscribeToken(lead.email, env.WEBHOOK_SECRET || 'intralys');
          const unsubUrl = `${origin}/unsubscribe/${unsubToken}`;
          // MULTILANG-B : footer CASL localisé selon la langue du contact.
          // lead.preferred_language NULL/absent ⇒ undefined ⇒ generateCaslFooter
          // retombe sur son défaut fr-CA byte-identique (aucun changement legacy).
          const caslFooter = generateCaslFooter(unsubUrl, lead.preferred_language || undefined);

          let amfFooter = '';
          if (clientId) {
            const client = await env.DB.prepare('SELECT amf_certificate, amf_disclaimer_required FROM clients WHERE id = ?').bind(clientId).first() as { amf_certificate?: string; amf_disclaimer_required?: number } | null;
            if (client?.amf_disclaimer_required && client.amf_certificate) amfFooter = generateAmfDisclaimer(client.amf_certificate);
          }

          // §6.E — INSERT messages AVANT injection tracking (le messageId est
          // l'ancre du pixel/liens). Mock honnête : status 'mock-sent' (jamais
          // faux 'sent') — comportement legacy CONSERVÉ + campaign_id/kind
          // ADDITIFS pour que le tracking fonctionne aussi en mock.
          const messageId = crypto.randomUUID();
          const finalHtmlBase = personalizedHtml + amfFooter + caslFooter;
          const finalHtml = injectTracking(finalHtmlBase, messageId, origin);
          await env.DB.prepare(
            `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by, external_id, campaign_id, campaign_kind, campaign_variant_id)
             VALUES (?, ?, ?, 'outbound', 'email', ?, ?, 'mock-sent', ?, ?, ?, 'broadcast', ?)`
          ).bind(messageId, lead.id, clientId || '', subject!.replace(/\{\{nom\}\}/g, lead.name || ''), finalHtml, authUserId, 'mock-broadcast-' + broadcastId, broadcastId, campaignVariantId).run();
          sent++;
        } catch (err) {
          failed++;
        }
      }
    } else if (env.RESEND_API_KEY) {
      const resend = new Resend(env.RESEND_API_KEY);

      // Fonction d'envoi d'UN lead (réutilisée legacy Promise.all OU paced).
      const sendOne = async (lead: any) => {
        try {
          const isUnsub = await isUnsubscribed(env, lead.email, lead.phone, 'email');
          if (isUnsub) throw new Error('Unsubscribed');

          const personalizedHtml = htmlContent.replace(/\{\{nom\}\}/g, lead.name || '').replace(/\{\{name\}\}/g, lead.name || '').replace(/\{\{email\}\}/g, lead.email || '');
          const unsubToken = generateUnsubscribeToken(lead.email, env.WEBHOOK_SECRET || 'intralys');
          const unsubUrl = `${origin}/unsubscribe/${unsubToken}`;
          // MULTILANG-B : footer CASL localisé selon la langue du contact.
          // lead.preferred_language NULL/absent ⇒ undefined ⇒ generateCaslFooter
          // retombe sur son défaut fr-CA byte-identique (aucun changement legacy).
          const caslFooter = generateCaslFooter(unsubUrl, lead.preferred_language || undefined);
          let amfFooter = '';
          if (clientId) {
            const client = await env.DB.prepare('SELECT amf_certificate, amf_disclaimer_required FROM clients WHERE id = ?').bind(clientId).first() as { amf_certificate?: string; amf_disclaimer_required?: number } | null;
            if (client?.amf_disclaimer_required && client.amf_certificate) amfFooter = generateAmfDisclaimer(client.amf_certificate);
          }

          // §6.E — gap CORRIGÉ : la branche Resend RÉELLE n'INSERAIT PAS de
          // row `messages` (seul le mock le faisait) ⇒ tracking impossible sur
          // les envois réels. On l'aligne sur le mock : INSERT messages
          // (status 'sent', campaign_id = broadcastId, campaign_kind
          // 'broadcast') AVANT envoi, puis injection pixel + réécriture liens.
          const messageId = crypto.randomUUID();
          const baseHtml = personalizedHtml + amfFooter + caslFooter;
          const trackedHtml = injectTracking(baseHtml, messageId, origin);
          await env.DB.prepare(
            `INSERT INTO messages (id, lead_id, client_id, direction, channel, subject, body, status, sent_by, external_id, campaign_id, campaign_kind, campaign_variant_id)
             VALUES (?, ?, ?, 'outbound', 'email', ?, ?, 'sent', ?, ?, ?, 'broadcast', ?)`
          ).bind(messageId, lead.id, clientId || '', subject!.replace(/\{\{nom\}\}/g, lead.name || ''), trackedHtml, authUserId, 'broadcast-' + broadcastId, broadcastId, campaignVariantId).run();

          await resend.emails.send({
            from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com',
            to: [lead.email],
            subject: subject!.replace(/\{\{nom\}\}/g, lead.name || ''),
            html: trackedHtml,
            text: textContent.replace(/\{\{nom\}\}/g, lead.name || ''),
          });
          sent++;
        } catch (err) {
          failed++;
        }
      };

      if (throttlePerMin > 0) {
        // Envoi PACED : chunks de `throttlePerMin` mails, ~60 s entre chunks.
        // Plafonné à ~25 s d'attente effective pour rester dans le budget CPU
        // d'un message de queue (le batch est déjà ≤ 50 leads ; au pire 1-2
        // chunks). Débit honnête sans bloquer indéfiniment le worker.
        for (let i = 0; i < leads.length; i += throttlePerMin) {
          const chunk = leads.slice(i, i + throttlePerMin);
          await Promise.all(chunk.map(sendOne));
          if (i + throttlePerMin < leads.length) {
            await new Promise((r) => setTimeout(r, Math.min(60_000, 25_000)));
          }
        }
      } else {
        // Legacy STRICTEMENT identique : Promise.all aveugle (throttle 0).
        await Promise.all(leads.map(sendOne));
      }
    }

    // Update broadcast stats
    await env.DB.prepare(`UPDATE broadcasts SET sent = sent + ?, failed = failed + ? WHERE id = ?`).bind(sent, failed, broadcastId).run();

    // LOT G6 — A/B : incrément best-effort du compteur `sent` de la variante du
    // job (tout le batch appartient à UNE variante — partition dans
    // enqueueBroadcastJobs). NULL en legacy ⇒ pas d'UPDATE. opened/clicked sont
    // recalculés à la lecture (handleGetVariants).
    if (campaignVariantId && sent > 0) {
      try {
        await env.DB.prepare('UPDATE broadcast_variants SET sent = sent + ? WHERE id = ?')
          .bind(sent, campaignVariantId).run();
      } catch (err) {
        console.error('processBroadcastQueueJob: variant sent increment failed', campaignVariantId, err);
      }
    }

    // Check if fully completed
    const b = await env.DB.prepare(`SELECT total, sent, failed FROM broadcasts WHERE id = ?`).bind(broadcastId).first() as { total: number; sent: number; failed: number } | null;
    if (b && (b.sent + b.failed) >= b.total) {
      // §6.E — agrégation opened/clicked à la complétion : COUNT distinct des
      // message_events (open/click) joints sur messages.campaign_id =
      // broadcast.id (index idx_messages_campaign). Best-effort (un échec
      // d'agrégat ne doit pas empêcher la complétion).
      try {
        const agg = await env.DB.prepare(
          `SELECT
             (SELECT COUNT(DISTINCT m.id) FROM messages m
                JOIN message_events me ON me.message_id = m.id
              WHERE m.campaign_id = ? AND m.campaign_kind = 'broadcast' AND me.event_type = 'open') AS opened,
             (SELECT COUNT(DISTINCT m.id) FROM messages m
                JOIN message_events me ON me.message_id = m.id
              WHERE m.campaign_id = ? AND m.campaign_kind = 'broadcast' AND me.event_type = 'click') AS clicked`
        ).bind(broadcastId, broadcastId).first() as { opened: number; clicked: number } | null;
        await env.DB.prepare(
          `UPDATE broadcasts SET status = 'completed', completed_at = datetime('now'), opened = ?, clicked = ? WHERE id = ?`
        ).bind(agg?.opened || 0, agg?.clicked || 0, broadcastId).run();
      } catch {
        await env.DB.prepare(`UPDATE broadcasts SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).bind(broadcastId).run();
      }
      await audit(env, authUserId, 'broadcast.complete', 'broadcast', broadcastId, { sent: b.sent, failed: b.failed, total: b.total });
    }

    message.ack();
  }
}
