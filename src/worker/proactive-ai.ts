// ══════════════════════════════════════════════════════════════════════════
// ██  Module Proactive AI — LOT PROACTIVE-C Sprint A (2026-05-21)
// ██  Couche IA proactive batch : scoring churn + Next-Best-Action + alertes
// ══════════════════════════════════════════════════════════════════════════
//
// Endpoints (capability 'ai.use', bornage tenant strict — WHERE client_id = ?) :
//   GET  /api/ai/proactive/alerts              → alertes du tenant (status != dismissed)
//   POST /api/ai/proactive/alerts/:id/seen     → marque une alerte 'seen'
//   POST /api/ai/proactive/alerts/:id/dismiss  → marque une alerte 'dismissed'
//
// Storage : tables `churn_scores` + `proactive_alerts` (D1, seq 99 — voir
// migration-proactive-ai-seq99.sql). Choix figés docs/LOT-PROACTIVE-C.md §6.
//
// PHASE A SOLO (ce fichier) :
//   - Handlers alertes = CORPS RÉELS : proactiveCapGuard('ai.use') + bornage
//     tenant `WHERE client_id = ?` + SELECT/UPDATE bornés. Le client_id provient
//     TOUJOURS de l'auth, JAMAIS du body ni de l'URL.
//   - `runProactiveBatch(env)` = CORPS RÉEL (itération
//     `SELECT DISTINCT client_id FROM leads LIMIT 50` → par tenant
//     generateChurnScores + generateNbaAlerts + 1 createNotification récap).
//   - `generateChurnScores(env, clientId)` = CORPS RÉEL (customers via
//     rfm_segment at_risk/hibernating/lost + leads via computeDeterministic
//     inversé, 100% DÉTERMINISTE, ZÉRO LLM).
//   - `generateNbaAlerts(env, clientId)` = CORPS RÉEL (règles déterministes →
//     proactive_alert kind='nba').
//
// CRON BEST-EFFORT — le hook scheduled() appelle runProactiveBatch via
// ctx.waitUntil(...).catch(()=>undefined) : un échec isolé n'altère JAMAIS RFM /
// workflows / broadcasts / scheduled-reports / cleanup (garde-fou §6.I). Le batch
// NE THROW JAMAIS de manière non rattrapée.
//
// CONTRÔLE COÛT LLM — le batch churn/NBA est 100% DÉTERMINISTE (ZÉRO appel
// Claude). Le LLM ne sert qu'aux résumés kind='summary' À LA DEMANDE (handler
// HTTP dédié, hors-cron — Phase B, non câblé ici).
//
// IA EN LECTURE/ALERTE SEULEMENT — crée des scores + alertes in-app. N'envoie ni
// email ni SMS auto, ne mute aucune autre table (leads/customers intouchés).
//
// Capability mutualisée — calque scheduled-reports.ts :
//   LECTURE + dismiss/seen → 'ai.use' (déjà dans ALL_CAPABILITIES, ZÉRO ajout).
//   La garde est mode-agence-only (proactiveCapGuard) : legacy/mono-tenant non
//   bridé (set legacy LARGE inclut ai.use), viewer bridé en mode agence.
//
// Réponses { data } / { error } normalisées (apiFetch GELÉ, JAMAIS `code`).
//
import type { Env } from './types';
import { json, createNotification } from './helpers';
import type { CapAuth, Capability } from './capabilities';
import { requireCapability } from './capabilities';
import { getSegmentConfig } from './ecommerce-rfm';

// Auth enrichi tel que produit au choke-point worker.ts (authCtx) — calque
// ScheduledReportAuth (scheduled-reports.ts). `id` legacy historique conservé.
type ProactiveAuth = CapAuth & {
  capabilities?: Set<string>;
  id?: string;
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

// Enums validés HANDLER (jamais CHECK SQL — cf. migration seq 99).
const VALID_KIND = ['churn', 'nba', 'summary'];
const VALID_ENTITY_TYPE = ['lead', 'customer'];
const VALID_RISK_LEVEL = ['low', 'medium', 'high'];
// Statuts exposés en lecture (on exclut 'dismissed' des listes par défaut).
const VALID_STATUS = ['new', 'seen', 'dismissed', 'acted'];

// ── Garde capability mode-agence-only (calque scheduled-reports.reportsCapGuard)
// Legacy/mono-tenant (!auth.tenant || agencyId == null) → undefined : aucun
// bridage nouveau (set legacy LARGE inclut ai.use). Mode agence (agencyId != null)
// → enforcement réel via requireCapability ; viewer bridé.
function proactiveCapGuard(auth: ProactiveAuth, cap: Capability): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, cap);
}

// Résout le client_id du tenant courant (sous-compte actif si switch).
// Bornage tenant : provient TOUJOURS de l'auth, JAMAIS du body / de l'URL.
function resolveClientId(auth: ProactiveAuth): string | null {
  return (auth.tenant?.clientId ?? auth.clientId ?? null) as string | null;
}

function resolveAgencyId(auth: ProactiveAuth): string | null {
  return (auth.tenant?.agencyId ?? null) as string | null;
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

function parsePaging(url: URL): { limit: number; offset: number } {
  const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') || '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

interface ProactiveAlertRow {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string | null;
  body: string | null;
  status: string;
  created_at: string | null;
}

const ALERT_COLS =
  `id, client_id, agency_id, kind, entity_type, entity_id, title, body, status, created_at`;

// ════════════════════════════════════════════════════════════════════════════
// CRON BATCH (IMPLÉMENTÉ — déterministe pur, zéro LLM, bornage tenant itéré)
// ════════════════════════════════════════════════════════════════════════════

// ── Helpers déterministes internes (ZÉRO LLM) ───────────────────────────────

// Borne MIN/MAX d'un nombre.
function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Jours écoulés depuis une date ISO/SQLite (datetime('now') ⇒ "YYYY-MM-DD HH:MM:SS").
// Calque daysSince(lead-predict.ts) + tolérance format SQLite (espace au lieu de T).
function daysSinceIso(dateStr: string | null | undefined): number {
  if (!dateStr) return 999;
  const norm = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const t = Date.parse(norm);
  if (!Number.isFinite(t)) return 999;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

// Probabilité de conversion 30j — DÉTERMINISTE, parité 1:1 avec
// computeDeterministic(lead-predict.ts) (module-privé, NON exporté ⇒ réplique
// READ-ONLY de la logique, ZÉRO LLM, ZÉRO refineWithLLM). On lit messages +
// tasks done pour l'engagement, exactement comme la source.
const SOURCE_COEFFICIENTS: Record<string, number> = {
  referral: 18, call: 14, email: 10, form: 8, webchat: 8,
  facebook_ads: 6, google_ads: 6, cold: -4,
};
function statusToProbability(status: string): number {
  const map: Record<string, number> = {
    new: 10, contacted: 25, qualified: 60, won: 100, closed: 100, lost: 0,
  };
  return map[status] ?? 20;
}
function parseTagsRaw(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j.map(String);
  } catch { /* fall through */ }
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

interface ChurnLeadRow {
  id: string;
  score: number | null;
  status: string;
  source: string | null;
  deal_value: number | null;
  updated_at: string | null;
  created_at: string | null;
  last_activity_at: string | null;
  tags: string | null;
}

async function leadProbability30d(env: Env, lead: ChurnLeadRow): Promise<number> {
  const msgRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM messages WHERE lead_id = ?`,
  ).bind(lead.id).first<{ c: number }>().catch(() => null);
  const msgCount = Number(msgRow?.c || 0);

  const tasksRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM tasks WHERE lead_id = ? AND status = 'done'`,
  ).bind(lead.id).first<{ c: number }>().catch(() => null);
  const tasksDone = Number(tasksRow?.c || 0);

  const lastActivityDays = daysSinceIso(lead.last_activity_at || lead.updated_at);
  let activityContribution: number;
  if (lastActivityDays <= 1) activityContribution = 25;
  else if (lastActivityDays <= 3) activityContribution = 18;
  else if (lastActivityDays <= 7) activityContribution = 8;
  else if (lastActivityDays <= 14) activityContribution = -3;
  else activityContribution = -10;

  const engagementContribution = clampNum(msgCount * 2 + tasksDone * 4, 0, 22);
  const stageProb = statusToProbability(lead.status);
  const stageContribution = Math.round((stageProb - 30) * 0.4);

  const dealValue = Number(lead.deal_value || 0);
  let dealContribution: number;
  if (dealValue >= 100_000) dealContribution = 18;
  else if (dealValue >= 50_000) dealContribution = 12;
  else if (dealValue >= 10_000) dealContribution = 6;
  else if (dealValue > 0) dealContribution = 2;
  else dealContribution = 0;

  const sourceKey = (lead.source || '').toLowerCase();
  const sourceCoef = SOURCE_COEFFICIENTS[sourceKey] ?? 4;

  const tags = parseTagsRaw(lead.tags).map((t) => t.toLowerCase());
  const hotKeywords = ['hot', 'chaud', 'qualified', 'qualifié', 'priority', 'vip'];
  const matchedTags = tags.filter((t) => hotKeywords.some((kw) => t.includes(kw)));
  const tagsContribution = matchedTags.length > 0 ? 8 + (matchedTags.length - 1) * 3 : 0;

  const sumContrib =
    activityContribution + engagementContribution + stageContribution +
    dealContribution + sourceCoef + tagsContribution;
  const baseScore = clampNum(30 + sumContrib, 0, 100);

  const freshness = clampNum(100 * Math.exp(-lastActivityDays / 14), 0, 100);
  let probability = Math.round(baseScore * 0.5 + stageProb * 0.35 + freshness * 0.15);
  if (lead.status === 'won' || lead.status === 'closed') probability = 100;
  if (lead.status === 'lost') probability = 0;
  return clampNum(probability, 0, 100);
}

function riskLevelFromScore(score: number): string {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

// UPSERT idempotent d'un score de churn (UNIQUE(client_id, entity_type, entity_id)).
// Bornage tenant : client_id provient TOUJOURS de l'itération DISTINCT du batch.
async function upsertChurnScore(
  env: Env, clientId: string, agencyId: string | null,
  entityType: string, entityId: string, score: number, riskLevel: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO churn_scores
       (client_id, agency_id, entity_type, entity_id, score, risk_level, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(client_id, entity_type, entity_id) DO UPDATE SET
       agency_id = excluded.agency_id,
       score = excluded.score,
       risk_level = excluded.risk_level,
       computed_at = excluded.computed_at`,
  ).bind(clientId, agencyId, entityType, entityId, score, riskLevel).run();
}

// Résout l'agency_id d'un tenant (best-effort, pour renseigner scores/alertes en
// mode agence). NULL si mono-tenant/legacy ou colonne absente.
async function resolveAgencyIdOf(env: Env, clientId: string): Promise<string | null> {
  try {
    const r = (await env.DB.prepare(
      `SELECT agency_id FROM clients WHERE id = ? LIMIT 1`,
    ).bind(clientId).first()) as { agency_id: string | null } | null;
    return r?.agency_id ?? null;
  } catch {
    return null; // colonne agency_id absente / panne D1 : best-effort
  }
}

// Premier user actif du tenant (calque firstUserOf booking-public.ts:142).
async function firstUserOf(env: Env, clientId: string): Promise<string | null> {
  try {
    const r = (await env.DB.prepare(
      `SELECT id FROM users WHERE client_id = ? AND is_active = 1 ORDER BY created_at ASC LIMIT 1`,
    ).bind(clientId).first()) as { id: string } | null;
    return r?.id ?? null;
  } catch {
    return null; // colonne client_id absente / panne D1 : best-effort
  }
}

// Anti-doublon : existe-t-il déjà une alerte 'new' pour ce (client, kind, entity) ?
async function alertExists(
  env: Env, clientId: string, kind: string, entityId: string | null,
): Promise<boolean> {
  try {
    const r = (await env.DB.prepare(
      `SELECT 1 AS x FROM proactive_alerts
        WHERE client_id = ? AND kind = ? AND status = 'new'
          AND ${entityId == null ? 'entity_id IS NULL' : 'entity_id = ?'}
        LIMIT 1`,
    ).bind(...(entityId == null ? [clientId, kind] : [clientId, kind, entityId]))
      .first()) as { x: number } | null;
    return !!r;
  } catch {
    return false;
  }
}

// INSERT d'une alerte proactive bornée tenant (status 'new').
async function insertAlert(
  env: Env, clientId: string, agencyId: string | null,
  kind: string, entityType: string | null, entityId: string | null,
  title: string, body: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO proactive_alerts
       (client_id, agency_id, kind, entity_type, entity_id, title, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'))`,
  ).bind(clientId, agencyId, kind, entityType, entityId, title, body).run();
}

/**
 * Batch cron best-effort — calque recomputeAllRfmSegments.
 *
 *   1. `SELECT DISTINCT client_id FROM leads LIMIT 50` (bornage par itération).
 *   2. Pour chaque tenant (try/catch isolé) : generateChurnScores +
 *      generateNbaAlerts (WHERE client_id = ? partout).
 *   3. Si ≥1 alerte neuve créée → 1 createNotification récap (anti-spam : 1 par
 *      tenant/run, PAS 1 par alerte) vers le 1er user actif du tenant.
 *
 * NE THROW JAMAIS de manière non rattrapée. 100% DÉTERMINISTE — ZÉRO LLM.
 * IA EN LECTURE/ALERTE SEULEMENT : écrit churn_scores + proactive_alerts +
 * 1 notification in-app. N'envoie NI email NI SMS, ne mute NI leads NI customers.
 *
 * Contrat FIGÉ : runProactiveBatch(env) -> Promise<void>.
 */
export async function runProactiveBatch(env: Env): Promise<void> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT client_id
         FROM leads
        WHERE client_id IS NOT NULL
        LIMIT 50`,
    ).all();
    const tenants = (results || []) as Array<{ client_id: string }>;

    for (const t of tenants) {
      const clientId = t.client_id;
      if (!clientId) continue;
      // Échec isolé par tenant — ne casse JAMAIS le lot global.
      try {
        await generateChurnScores(env, clientId);
        const { created } = await generateNbaAlerts(env, clientId);

        if (created > 0) {
          // 1 notification récap par tenant/run (anti-spam). Best-effort.
          try {
            const userId = await firstUserOf(env, clientId);
            if (userId) {
              await createNotification(
                env,
                userId,
                'IA proactive : nouvelles actions suggérées',
                created === 1
                  ? '1 nouvelle action prioritaire détectée par l’IA.'
                  : `${created} nouvelles actions prioritaires détectées par l’IA.`,
                'sparkles',
                '/dashboard',
                clientId,
              );
            }
          } catch (notifErr) {
            console.error('runProactiveBatch notify failed', clientId, notifErr);
          }
        }
      } catch (tenantErr) {
        console.error('runProactiveBatch tenant failed', clientId, tenantErr);
      }
    }
  } catch (err) {
    // Best-effort total : on avale toute erreur globale (cron ne doit jamais crasher).
    console.error('runProactiveBatch failed', err);
  }
  return undefined;
}

/**
 * Calcule + upsert les scores de churn d'un tenant donné. 100% DÉTERMINISTE
 * (ZÉRO LLM, ZÉRO refineWithLLM — contrôle coût) :
 *   - customers : rfm_segment at_risk/hibernating/lost OU last_order_at au-delà
 *     du seuil `recency.cold` (getSegmentConfig) → score + risk_level.
 *   - leads : top-N par score → probabilité 30j déterministe (réplique
 *     computeDeterministic, ZÉRO LLM) ⇒ score churn = 100 - probability30d.
 *   - UPSERT idempotent sur UNIQUE(client_id, entity_type, entity_id).
 * Bornage tenant strict : WHERE client_id = ? partout (clientId vient de
 * l'itération DISTINCT client_id du batch, jamais du body).
 *
 * Contrat FIGÉ : generateChurnScores(env, clientId) -> Promise<{ scored: number }>.
 */
export async function generateChurnScores(
  env: Env,
  clientId: string,
): Promise<{ scored: number }> {
  let scored = 0;
  const agencyId = await resolveAgencyIdOf(env, clientId);

  // ── Customers e-comm (best-effort : module e-comm peut être absent) ────────
  try {
    const config = await getSegmentConfig(env, clientId);
    const coldDays = Math.max(1, Math.round(config.recency.cold || 180));

    // at_risk/hibernating/lost OU récence > seuil cold. Borné tenant + limité.
    const { results } = await env.DB.prepare(
      `SELECT id, rfm_segment, last_order_at
         FROM customers
        WHERE client_id = ?
          AND (
            rfm_segment IN ('at_risk', 'hibernating', 'lost')
            OR (last_order_at IS NOT NULL
                AND julianday('now') - julianday(last_order_at) > ?)
          )
        ORDER BY datetime(last_order_at) ASC
        LIMIT 50`,
    ).bind(clientId, coldDays).all();

    const customers = (results || []) as Array<{
      id: string; rfm_segment: string | null; last_order_at: string | null;
    }>;

    for (const c of customers) {
      try {
        // Déterministe : plus la récence est haute (ancien), plus le risque.
        const recencyDays = daysSinceIso(c.last_order_at);
        // Normalise la récence sur [coldDays .. 2*coldDays] → 50..90, puis bonus
        // segment (lost > hibernating > at_risk). Borné 0..100.
        const recencyComponent = clampNum(
          Math.round(50 + ((recencyDays - coldDays) / coldDays) * 40), 0, 90,
        );
        const segBonus =
          c.rfm_segment === 'lost' ? 15
          : c.rfm_segment === 'hibernating' ? 10
          : c.rfm_segment === 'at_risk' ? 6
          : 0;
        const score = clampNum(recencyComponent + segBonus, 0, 100);
        await upsertChurnScore(
          env, clientId, agencyId, 'customer', c.id, score, riskLevelFromScore(score),
        );
        scored += 1;
      } catch (custErr) {
        console.error('generateChurnScores customer failed', c.id, custErr);
      }
    }
  } catch (ecomErr) {
    // Table customers / config absente ⇒ on saute la branche e-comm.
    console.error('generateChurnScores customers branch skipped', clientId, ecomErr);
  }

  // ── Leads : top-N par score, churn = 100 - probabilité de conversion 30j ───
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, score, status, source, deal_value,
              updated_at, created_at, last_activity_at, tags
         FROM leads
        WHERE client_id = ?
          AND (deleted_at IS NULL)
        ORDER BY score DESC
        LIMIT 20`,
    ).bind(clientId).all();

    const leads = (results || []) as unknown as ChurnLeadRow[];
    for (const lead of leads) {
      try {
        const prob = await leadProbability30d(env, lead); // DÉTERMINISTE, ZÉRO LLM
        const score = clampNum(100 - prob, 0, 100);
        await upsertChurnScore(
          env, clientId, agencyId, 'lead', lead.id, score, riskLevelFromScore(score),
        );
        scored += 1;
      } catch (leadErr) {
        console.error('generateChurnScores lead failed', lead.id, leadErr);
      }
    }
  } catch (leadsErr) {
    console.error('generateChurnScores leads branch failed', clientId, leadsErr);
  }

  return { scored };
}

// Seuils déterministes des règles NBA (constantes — PAS de magic number épars).
const NBA_HOT_LEAD_STALE_DAYS = 3;   // lead chaud sans activité depuis N jours
const NBA_MAX_PER_RULE = 10;          // garde-fou anti-flood par règle/tenant/run

/**
 * Calcule + insère les alertes Next-Best-Action d'un tenant. Règles 100%
 * DÉTERMINISTES (ZÉRO LLM). IA EN ALERTE SEULEMENT : insère uniquement dans
 * proactive_alerts (status 'new'), ne mute NI leads NI customers NI carts,
 * n'envoie NI email NI SMS.
 *
 *   Règle 1 : lead chaud (status qualified) sans activité depuis N jours → 'nba'.
 *   Règle 2 : panier abandonné non récupéré → 'nba' (relance panier).
 *   Règle 3 : customer churn risk='high' (churn_scores) → 'churn' (réactiver).
 *
 * Anti-doublon : avant INSERT, on skip s'il existe déjà une alerte 'new' pour le
 * même (client_id, kind, entity_id). Bornage tenant : WHERE client_id = ? partout.
 *
 * Contrat FIGÉ : generateNbaAlerts(env, clientId) -> Promise<{ created: number }>.
 */
export async function generateNbaAlerts(
  env: Env,
  clientId: string,
): Promise<{ created: number }> {
  let created = 0;
  const agencyId = await resolveAgencyIdOf(env, clientId);

  // ── Règle 1 : leads chauds (qualified) sans activité depuis N jours ────────
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, last_activity_at, updated_at
         FROM leads
        WHERE client_id = ?
          AND status = 'qualified'
          AND (deleted_at IS NULL)
          AND julianday('now')
              - julianday(COALESCE(last_activity_at, updated_at)) > ?
        ORDER BY score DESC
        LIMIT ?`,
    ).bind(clientId, NBA_HOT_LEAD_STALE_DAYS, NBA_MAX_PER_RULE).all();

    const leads = (results || []) as Array<{
      id: string; name: string | null; last_activity_at: string | null; updated_at: string | null;
    }>;
    for (const lead of leads) {
      try {
        if (await alertExists(env, clientId, 'nba', lead.id)) continue;
        const who = (lead.name || '').trim() || 'ce lead';
        const days = daysSinceIso(lead.last_activity_at || lead.updated_at);
        await insertAlert(
          env, clientId, agencyId, 'nba', 'lead', lead.id,
          `Relancer ${who}`,
          `Lead qualifié sans activité depuis ${days} j — une relance maintenant maximise les chances de conversion.`,
        );
        created += 1;
      } catch (e) {
        console.error('generateNbaAlerts rule1 failed', lead.id, e);
      }
    }
  } catch (e) {
    console.error('generateNbaAlerts rule1 branch failed', clientId, e);
  }

  // ── Règle 2 : paniers abandonnés non récupérés (e-comm, best-effort) ───────
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, customer_id
         FROM carts
        WHERE client_id = ?
          AND status = 'abandoned'
          AND recovered_at IS NULL
        ORDER BY datetime(abandoned_at) DESC
        LIMIT ?`,
    ).bind(clientId, NBA_MAX_PER_RULE).all();

    const carts = (results || []) as Array<{ id: string; customer_id: string | null }>;
    for (const cart of carts) {
      try {
        if (await alertExists(env, clientId, 'nba', cart.id)) continue;
        await insertAlert(
          env, clientId, agencyId, 'nba', 'customer', cart.id,
          'Relance panier',
          'Un panier abandonné n’a pas été récupéré — une relance rapide peut convertir cette vente.',
        );
        created += 1;
      } catch (e) {
        console.error('generateNbaAlerts rule2 failed', cart.id, e);
      }
    }
  } catch (e) {
    // Table carts absente ⇒ branche e-comm sautée (best-effort).
    console.error('generateNbaAlerts rule2 branch skipped', clientId, e);
  }

  // ── Règle 3 : customers à risque de churn élevé (churn_scores risk='high') ─
  try {
    const { results } = await env.DB.prepare(
      `SELECT cs.entity_id AS customer_id,
              c.first_name AS first_name, c.last_name AS last_name, c.email AS email
         FROM churn_scores cs
         LEFT JOIN customers c
           ON c.id = cs.entity_id AND c.client_id = cs.client_id
        WHERE cs.client_id = ?
          AND cs.entity_type = 'customer'
          AND cs.risk_level = 'high'
        ORDER BY cs.score DESC
        LIMIT ?`,
    ).bind(clientId, NBA_MAX_PER_RULE).all();

    const rows = (results || []) as Array<{
      customer_id: string | null; first_name: string | null; last_name: string | null; email: string | null;
    }>;
    for (const r of rows) {
      if (!r.customer_id) continue;
      try {
        if (await alertExists(env, clientId, 'churn', r.customer_id)) continue;
        const who =
          `${(r.first_name || '').trim()} ${(r.last_name || '').trim()}`.trim() ||
          (r.email || '').trim() || 'ce client';
        await insertAlert(
          env, clientId, agencyId, 'churn', 'customer', r.customer_id,
          `Réactiver ${who}`,
          'Client à risque de décrochage élevé — une offre de réactivation ciblée peut le retenir.',
        );
        created += 1;
      } catch (e) {
        console.error('generateNbaAlerts rule3 failed', r.customer_id, e);
      }
    }
  } catch (e) {
    console.error('generateNbaAlerts rule3 branch failed', clientId, e);
  }

  return { created };
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/ai/proactive/alerts — alertes actionnables du tenant (corps réel)
// ════════════════════════════════════════════════════════════════════════════

export async function handleListProactiveAlerts(
  env: Env, auth: ProactiveAuth, url: URL,
): Promise<Response> {
  const g = proactiveCapGuard(auth, 'ai.use');
  if (g) return g;

  try {
    const clientId = resolveClientId(auth);
    if (!clientId) return noClient();

    const { limit, offset } = parsePaging(url);

    // Filtres optionnels validés HANDLER (whitelist). Par défaut : on masque les
    // alertes 'dismissed' (status != 'dismissed').
    const kindFilter = (url.searchParams.get('kind') || '').trim();
    const bindKind = VALID_KIND.includes(kindFilter) ? kindFilter : null;
    const statusFilter = (url.searchParams.get('status') || '').trim();
    const bindStatus = VALID_STATUS.includes(statusFilter) ? statusFilter : null;

    const whereParts: string[] = ['client_id = ?'];
    const whereBinds: (string | number)[] = [clientId];
    if (bindStatus) {
      whereParts.push('status = ?');
      whereBinds.push(bindStatus);
    } else {
      // Défaut : on exclut les alertes écartées par l'utilisateur.
      whereParts.push("status != 'dismissed'");
    }
    if (bindKind) {
      whereParts.push('kind = ?');
      whereBinds.push(bindKind);
    }
    const where = `WHERE ${whereParts.join(' AND ')}`;

    const countRow = (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM proactive_alerts ${where}`,
    ).bind(...whereBinds).first()) as { n: number } | null;

    const { results } = await env.DB.prepare(
      `SELECT ${ALERT_COLS}
         FROM proactive_alerts
         ${where}
         ORDER BY datetime(created_at) DESC, id ASC
         LIMIT ? OFFSET ?`,
    ).bind(...whereBinds, limit, offset).all();

    return json({
      data: ((results || []) as unknown as ProactiveAlertRow[]),
      total: countRow?.n ?? 0,
    });
  } catch (err) {
    console.error('handleListProactiveAlerts failed', err);
    return json({ error: 'Erreur lors du chargement des alertes' }, 500);
  }
}

// ── UPDATE de statut borné tenant (seen / dismiss) ───────────────────────────
// Mutualisé : la cible `nextStatus` est validée (whitelist) et le UPDATE est
// borné `WHERE id = ? AND client_id = ?` (le client_id vient de l'auth, l'id de
// l'URL — un tenant ne peut JAMAIS muter l'alerte d'un autre tenant).
async function updateAlertStatus(
  env: Env, auth: ProactiveAuth, alertId: string, nextStatus: string,
): Promise<Response> {
  const g = proactiveCapGuard(auth, 'ai.use');
  if (g) return g;

  if (!VALID_STATUS.includes(nextStatus)) {
    return json({ error: 'Statut invalide' }, 400);
  }

  try {
    const clientId = resolveClientId(auth);
    if (!clientId) return noClient();
    if (!alertId) return json({ error: 'Identifiant requis' }, 400);

    const res = await env.DB.prepare(
      `UPDATE proactive_alerts
          SET status = ?
        WHERE id = ? AND client_id = ?`,
    ).bind(nextStatus, alertId, clientId).run();

    // D1 expose meta.changes (0 ⇒ alerte inexistante OU appartient à un autre
    // tenant ⇒ 404, jamais de fuite cross-tenant — calque ecommerce-products.ts).
    if (!(((res.meta?.changes as number) || 0) > 0)) {
      return json({ error: 'Alerte introuvable' }, 404);
    }

    return json({ data: { id: alertId, status: nextStatus } });
  } catch (err) {
    console.error('updateAlertStatus failed', err);
    return json({ error: 'Erreur lors de la mise à jour de l’alerte' }, 500);
  }
}

// POST /api/ai/proactive/alerts/:id/seen
export async function handleMarkProactiveAlertSeen(
  env: Env, auth: ProactiveAuth, alertId: string,
): Promise<Response> {
  return updateAlertStatus(env, auth, alertId, 'seen');
}

// POST /api/ai/proactive/alerts/:id/dismiss
export async function handleDismissProactiveAlert(
  env: Env, auth: ProactiveAuth, alertId: string,
): Promise<Response> {
  return updateAlertStatus(env, auth, alertId, 'dismissed');
}

// Réexports de constantes internes pour la Phase B (générateurs déterministes) —
// évite la redéfinition d'enums divergents entre phases.
export const PROACTIVE_ENUMS = {
  kind: VALID_KIND,
  entityType: VALID_ENTITY_TYPE,
  riskLevel: VALID_RISK_LEVEL,
  status: VALID_STATUS,
} as const;

// Helper de résolution agence (réutilisé Phase B pour renseigner agency_id sur
// les scores/alertes en mode agence). Exporté pour éviter une 2e implémentation.
export { resolveAgencyId as resolveProactiveAgencyId };
