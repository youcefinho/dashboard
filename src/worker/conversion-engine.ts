// ══════════════════════════════════════════════════════════════════════════
// ██  Module Conversion Engine — SPRINT 13 « Scoring prédictif calibré tenant »
// ██  (Phase A SOLO posa les stubs — corps réels Phase B Manager-B)
// ══════════════════════════════════════════════════════════════════════════
//
// GAP comblé : le scoring existant (lead-predict.ts / lead-score.ts /
// proactive-ai.ts) utilise des coefficients UNIVERSELS codés en dur
// (SOURCE_COEFFICIENTS / statusToProbability identiques TOUS tenants). Ce module
// AJOUTE une couche de CALIBRATION par tenant : on agrège l'historique won/lost
// RÉEL du tenant (DÉTERMINISTE, offline-safe, ZÉRO LLM) puis on ajuste la proba
// déterministe existante par le taux de conversion observé du tenant.
//
// RÉUTILISE EN LECTURE (NE RÉÉCRIT RIEN) :
//   - lead-predict.ts : computeDeterministic / statusToProbability /
//     SOURCE_COEFFICIENTS sont MODULE-PRIVÉS (NON exportés). On en RÉPLIQUE la
//     logique UNE fois ici (read-only), exactement comme leadProbability30d de
//     proactive-ai. ZÉRO refineWithLLM, ZÉRO appel Claude.
//   - proactive-ai.ts : pattern cron best-effort + bornage tenant
//     (SELECT DISTINCT client_id FROM leads LIMIT 50) + resolveProactiveAgencyId.
//
// Storage : tables `conversion_baselines` + `conversion_predictions` (D1, seq
// 113 — voir migration-conversion-scoring-seq113.sql). NE PAS écraser le cache
// `lead_predictions` (seq 54). Choix figés docs/LOT-CONVERSION-SCORING.md §6.
//
// CRON BEST-EFFORT — scheduled() appelle recomputeConversionBaselines via
// ctx.waitUntil(...).then(()=>undefined).catch(()=>undefined). NE THROW JAMAIS de
// manière non rattrapée. 100% DÉTERMINISTE — ZÉRO LLM (contrôle coût).
//
// Capability mutualisée : LECTURE → 'ai.use' (déjà dans ALL_CAPABILITIES, ZÉRO
// ajout). Garde mode-agence-only (calque proactive-ai.proactiveCapGuard).
//
// Réponses { data } / { error } normalisées (apiFetch GELÉ, JAMAIS `code`).
//
import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth, Capability } from './capabilities';
import { requireCapability } from './capabilities';
// Phase 1 V2 — câblage engine (⚠️ behavior-change assumé) : confiance déléguée à
// conversion-helpers-engine.confidenceFromSampleSize → seuils PLUS FINS
// (>500 high / >50 medium / sinon low) vs legacy (≥50 high / ≥10 medium).
import { confidenceFromSampleSize } from './lib/conversion-helpers-engine';

// Auth enrichi tel que produit au choke-point worker.ts (authCtx) — calque
// ProactiveAuth (proactive-ai.ts). `id` legacy historique conservé.
type ConversionAuth = CapAuth & {
  capabilities?: Set<string>;
  id?: string;
};

// Enums validés HANDLER (jamais CHECK SQL — cf. migration seq 113).
const VALID_DIMENSION = ['source', 'status', 'score_bucket', 'overall'];

// Seuil d'échantillon minimal pour CALIBRER (sinon fallback coefficients fixes).
const MIN_SAMPLE_FOR_CALIBRATION = 10;
// Plafond du nombre de tenants traités par run de cron (bornage best-effort).
const TENANT_BATCH_LIMIT = 50;
// Fraîcheur du cache conversion_predictions (recompute si plus vieux que ça).
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6h — calque lead-predict.ts

// Garde capability mode-agence-only (calque proactive-ai.proactiveCapGuard) :
// legacy/mono-tenant non bridé (set legacy LARGE inclut ai.use), viewer bridé en
// mode agence.
function conversionCapGuard(
  auth: ConversionAuth,
  cap: Capability,
): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, cap);
}

// Résout le client_id du tenant courant. Bornage tenant : provient TOUJOURS de
// l'auth, JAMAIS du body / de l'URL.
function resolveClientId(auth: ConversionAuth): string | null {
  return (auth.tenant?.clientId ?? auth.clientId ?? null) as string | null;
}

// Réexport interne pour la Phase B (évite des enums divergents entre phases).
export const CONVERSION_ENUMS = {
  dimension: VALID_DIMENSION,
} as const;

// ════════════════════════════════════════════════════════════════════════════
// Réplique déterministe de la base lead-predict (RÉUTILISÉE EN LECTURE)
// ──────────────────────────────────────────────────────────────────────────
// computeDeterministic / statusToProbability / SOURCE_COEFFICIENTS sont
// MODULE-PRIVÉS dans lead-predict.ts (NON exportés). On RÉPLIQUE la logique UNE
// SEULE fois ici (read-only), exactement comme leadProbability30d de
// proactive-ai. ZÉRO LLM. probability = baseScore*0.5 + stageProb*0.35 +
// freshness*0.15.
// ════════════════════════════════════════════════════════════════════════════

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

function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Jours écoulés depuis une date ISO/SQLite (datetime('now') ⇒ "YYYY-MM-DD HH:MM:SS").
// Calque daysSinceIso(proactive-ai.ts) — tolérance format SQLite (espace au lieu de T).
function daysSinceIso(dateStr: string | null | undefined): number {
  if (!dateStr) return 999;
  const norm = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const t = Date.parse(norm);
  if (!Number.isFinite(t)) return 999;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function parseTagsRaw(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j.map(String);
  } catch { /* fall through */ }
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

interface ConversionLeadRow {
  id: string;
  client_id?: string | null;
  score: number | null;
  status: string;
  source: string | null;
  deal_value: number | null;
  updated_at: string | null;
  created_at: string | null;
  last_activity_at: string | null;
  tags: string | null;
}

// Bucket de score (aligné conversion_baselines.dimension='score_bucket' :
// '0-39' | '40-59' | '60-79' | '80-100'). Déterministe.
function scoreBucket(score: number | null): string {
  const s = Number(score || 0);
  if (s >= 80) return '80-100';
  if (s >= 60) return '60-79';
  if (s >= 40) return '40-59';
  return '0-39';
}

// Base déterministe — réplique 1:1 de computeDeterministic(lead-predict.ts),
// ZÉRO LLM. Renvoie aussi les facteurs de base (top contributions) pour
// l'explicabilité.
async function computeBaseDeterministic(
  env: Env,
  lead: ConversionLeadRow,
): Promise<{ probability: number; factors: { label: string; impact: number }[] }> {
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
  probability = clampNum(probability, 0, 100);

  const allFactors = [
    { label: 'Activité récente', impact: activityContribution },
    { label: 'Engagement', impact: engagementContribution },
    { label: 'Étape pipeline', impact: stageContribution },
    { label: 'Valeur deal', impact: dealContribution },
    { label: 'Source', impact: sourceCoef },
  ];
  if (tagsContribution > 0) allFactors.push({ label: 'Tags chauds', impact: tagsContribution });
  const factors = allFactors
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 3)
    .map((f) => ({ label: f.label, impact: Math.round(f.impact) }));

  return { probability, factors };
}

function confidenceFromSample(sampleSize: number): 'low' | 'medium' | 'high' {
  // Câblage engine : délègue à confidenceFromSampleSize (seuils plus fins).
  return confidenceFromSampleSize(sampleSize);
}

// ════════════════════════════════════════════════════════════════════════════
// CRON BATCH — recomputeConversionBaselines (corps réel — déterministe SQL pur)
// ════════════════════════════════════════════════════════════════════════════

interface AggRow {
  dim_value: string | null;
  total: number;
  won: number;
  lost: number;
}

// Agrège won/lost RÉELS d'un tenant pour une dimension donnée et upsert (idempotent).
// won  = status IN ('won')            (cf. brief §6.H + schéma leads)
// lost = status IN ('lost','closed')
// conversion_rate = won/(won+lost) si (won+lost)>0, sinon 0.
// sample_size     = won + lost (sert au seuil fallback < 10).
// Idempotence applicative (UNIQUE(client_id, dimension, dimension_value) non
// matérialisé en contrainte SQL — cf. migration sans CHECK/UNIQUE) : DELETE
// borné tenant+dimension puis INSERT du recalcul. 100% SQL déterministe, ZÉRO LLM.
async function recomputeDimension(
  env: Env,
  clientId: string,
  agencyId: string | null,
  dimension: string,
  groupExpr: string,
): Promise<void> {
  // groupExpr = expression SQL produisant la valeur de dimension (constantes
  // contrôlées en interne — JAMAIS de valeur issue du body/URL → pas d'injection).
  const { results } = await env.DB.prepare(
    `SELECT ${groupExpr} AS dim_value,
            COUNT(*) AS total,
            SUM(CASE WHEN status IN ('won') THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN status IN ('lost','closed') THEN 1 ELSE 0 END) AS lost
       FROM leads
      WHERE client_id = ?
        AND (deleted_at IS NULL)
      GROUP BY ${groupExpr}`,
  ).bind(clientId).all();

  const rows = (results || []) as unknown as AggRow[];

  // Upsert idempotent : on purge la dimension du tenant puis on réinsère le
  // recalcul (delete+insert borné tenant — stratégie autorisée par le brief).
  await env.DB.prepare(
    `DELETE FROM conversion_baselines WHERE client_id = ? AND dimension = ?`,
  ).bind(clientId, dimension).run();

  for (const r of rows) {
    const dimValue = dimension === 'overall' ? '' : String(r.dim_value ?? '');
    const won = Number(r.won || 0);
    const lost = Number(r.lost || 0);
    const decided = won + lost;
    const conversionRate = decided > 0 ? won / decided : 0;
    const sampleSize = decided;

    await env.DB.prepare(
      `INSERT INTO conversion_baselines
         (client_id, agency_id, dimension, dimension_value,
          won_count, lost_count, conversion_rate, sample_size, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(
      clientId, agencyId, dimension, dimValue,
      won, lost, conversionRate, sampleSize,
    ).run();
  }
}

/**
 * Recalcule + upsert les baselines de conversion de TOUS les tenants (best-effort).
 *
 *   1. `SELECT DISTINCT client_id FROM leads ... LIMIT 50` (bornage par itération).
 *   2. Par tenant (try/catch isolé) : agrège won/lost RÉELS par dimension
 *      'source' / 'status' / 'score_bucket' / 'overall' → conversion_rate +
 *      sample_size, DÉTERMINISTE SQL pur.
 *   3. UPSERT idempotent (delete+insert borné tenant+dimension).
 *
 * NE THROW JAMAIS de manière non rattrapée. 100% DÉTERMINISTE — ZÉRO LLM.
 * Borné tenant (WHERE client_id = ?), LIMIT 50.
 *
 * Contrat FIGÉ : recomputeConversionBaselines(env) -> Promise<void>.
 */
export async function recomputeConversionBaselines(env: Env): Promise<void> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT client_id
         FROM leads
        WHERE client_id IS NOT NULL
        LIMIT ${TENANT_BATCH_LIMIT}`,
    ).all();
    const tenants = (results || []) as Array<{ client_id: string }>;

    for (const t of tenants) {
      const clientId = t.client_id;
      if (!clientId) continue;
      // Échec isolé par tenant — ne casse JAMAIS le lot global.
      try {
        const agencyId = await resolveAgencyIdOf(env, clientId);
        // Dimensions agrégées (groupExpr = constantes internes contrôlées).
        await recomputeDimension(
          env, clientId, agencyId, 'source', "COALESCE(NULLIF(LOWER(source), ''), 'unknown')",
        );
        await recomputeDimension(
          env, clientId, agencyId, 'status', "COALESCE(status, 'unknown')",
        );
        await recomputeDimension(
          env, clientId, agencyId, 'score_bucket',
          `CASE
             WHEN COALESCE(score, 0) >= 80 THEN '80-100'
             WHEN COALESCE(score, 0) >= 60 THEN '60-79'
             WHEN COALESCE(score, 0) >= 40 THEN '40-59'
             ELSE '0-39'
           END`,
        );
        await recomputeDimension(
          env, clientId, agencyId, 'overall', "'overall'",
        );
      } catch (tenantErr) {
        console.error('recomputeConversionBaselines tenant failed', clientId, tenantErr);
      }
    }
  } catch (err) {
    // Best-effort total : on avale toute erreur globale (cron ne crashe jamais).
    console.error('recomputeConversionBaselines failed', err);
  }
  return undefined;
}

// Résout l'agency_id d'un tenant (best-effort). NULL si mono-tenant/legacy ou
// colonne absente. Calque resolveAgencyIdOf(proactive-ai.ts).
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

// ════════════════════════════════════════════════════════════════════════════
// computeCalibratedProbability (corps réel — base déterministe + calibration)
// ════════════════════════════════════════════════════════════════════════════

interface BaselineRow {
  dimension: string;
  dimension_value: string;
  conversion_rate: number;
  sample_size: number;
}

/**
 * Calcule la probabilité de conversion CALIBRÉE d'un lead.
 *
 * 1. Base déterministe lead-predict EN LECTURE (réplique computeDeterministic,
 *    ZÉRO LLM).
 * 2. Si une baseline 'source' du tenant existe pour la source du lead avec
 *    sample_size >= 10 → mélange la proba de base avec le conversion_rate observé
 *    (×100), pondéré par la CONFIANCE (sample/(sample+30), plafonné 0.6).
 *    calibrated = 1 + facteur « Taux historique de tes leads {source} : X% (n=…) ».
 * 3. Sinon fallback base fixe (calibrated = 0).
 *
 * Borné tenant : on filtre conversion_baselines par client_id (issu de l'auth via
 * lead.client_id chargé borné, JAMAIS du body). 100% DÉTERMINISTE.
 *
 * Contrat FIGÉ : computeCalibratedProbability(env, lead)
 *   -> Promise<{ probability: number; calibrated: number; factors: { label; impact }[] }>.
 */
export async function computeCalibratedProbability(
  env: Env,
  lead: { id: string; client_id?: string | null } & Record<string, unknown>,
): Promise<{
  probability: number;
  calibrated: number;
  factors: { label: string; impact: number }[];
}> {
  const typedLead: ConversionLeadRow = {
    id: lead.id,
    client_id: (lead.client_id ?? null) as string | null,
    score: (lead.score ?? null) as number | null,
    status: String(lead.status ?? 'new'),
    source: (lead.source ?? null) as string | null,
    deal_value: (lead.deal_value ?? null) as number | null,
    updated_at: (lead.updated_at ?? null) as string | null,
    created_at: (lead.created_at ?? null) as string | null,
    last_activity_at: (lead.last_activity_at ?? null) as string | null,
    tags: (lead.tags ?? null) as string | null,
  };

  const base = await computeBaseDeterministic(env, typedLead);
  let probability = base.probability;
  let calibrated = 0;
  const factors = [...base.factors];

  const clientId = typedLead.client_id;
  // Calibration : seulement si on connaît le tenant ET que le lead n'est pas déjà
  // tranché (won/closed=100, lost=0 — la calibration n'a pas de sens).
  const decided =
    typedLead.status === 'won' ||
    typedLead.status === 'closed' ||
    typedLead.status === 'lost';

  if (clientId && !decided) {
    const sourceKey = (typedLead.source || '').toLowerCase() || 'unknown';
    const bucketKey = scoreBucket(typedLead.score);

    // On lit les baselines pertinentes du tenant (best-effort). Priorité à la
    // source ; le bucket de score sert de calibration secondaire.
    const baselines = await readBaselines(env, clientId, [
      { dimension: 'source', value: sourceKey },
      { dimension: 'score_bucket', value: bucketKey },
    ]);

    const sourceBl = baselines.find(
      (b) => b.dimension === 'source' && b.dimension_value === sourceKey,
    );

    if (sourceBl && sourceBl.sample_size >= MIN_SAMPLE_FOR_CALIBRATION) {
      const observedPct = clampNum(Math.round(sourceBl.conversion_rate * 100), 0, 100);
      // Poids de confiance : croît avec l'échantillon, plafonné à 0.6 (la base
      // déterministe garde toujours au moins 40% du poids — anti-sur-calibration).
      const weight = clampNum(sourceBl.sample_size / (sourceBl.sample_size + 30), 0, 0.6);
      probability = clampNum(
        Math.round(base.probability * (1 - weight) + observedPct * weight),
        0,
        100,
      );
      calibrated = 1;
      factors.unshift({
        label: `Taux historique de tes leads ${sourceKey} : ${observedPct}% (n=${sourceBl.sample_size})`,
        impact: Math.round(observedPct - base.probability),
      });

      // Calibration secondaire (légère) par bucket de score si dispo.
      const bucketBl = baselines.find(
        (b) => b.dimension === 'score_bucket' && b.dimension_value === bucketKey,
      );
      if (bucketBl && bucketBl.sample_size >= MIN_SAMPLE_FOR_CALIBRATION) {
        const bucketPct = clampNum(Math.round(bucketBl.conversion_rate * 100), 0, 100);
        const bucketWeight = clampNum(bucketBl.sample_size / (bucketBl.sample_size + 60), 0, 0.3);
        probability = clampNum(
          Math.round(probability * (1 - bucketWeight) + bucketPct * bucketWeight),
          0,
          100,
        );
      }
    }
  }

  return {
    probability,
    calibrated,
    factors: factors.slice(0, 4),
  };
}

// Lit un sous-ensemble de baselines d'un tenant (best-effort). Borné tenant.
async function readBaselines(
  env: Env,
  clientId: string,
  wanted: Array<{ dimension: string; value: string }>,
): Promise<BaselineRow[]> {
  try {
    const dims = [...new Set(wanted.map((w) => w.dimension))];
    const placeholders = dims.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT dimension, dimension_value, conversion_rate, sample_size
         FROM conversion_baselines
        WHERE client_id = ?
          AND dimension IN (${placeholders})`,
    ).bind(clientId, ...dims).all();
    return (results || []) as unknown as BaselineRow[];
  } catch {
    return []; // table absente / panne D1 : fallback base fixe (calibrated=0)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/leads/:id/conversion-score — score calibré d'un lead (corps réel)
// ════════════════════════════════════════════════════════════════════════════

interface ConversionPredictionData {
  probability: number;
  calibrated: number;
  factors: { label: string; impact: number }[];
  confidence?: 'low' | 'medium' | 'high';
}

interface ConversionCacheRow {
  lead_id: string;
  probability: number;
  calibrated: number;
  factors_json: string | null;
  computed_at: string | null;
}

/**
 * Handler du score de conversion calibré. capGuard 'ai.use' (mode-agence-only).
 *
 *   - capGuard ai.use.
 *   - charge le lead BORNÉ TENANT (WHERE id = ? AND client_id = ? — client_id de
 *     l'AUTH, jamais du body/URL).
 *   - cache conversion_predictions : sert si frais (< TTL), sinon recompute.
 *   - appelle computeCalibratedProbability, upsert cache (delete+insert
 *     idempotent borné lead), renvoie { data: ConversionPrediction }.
 *
 * Best-effort, ZÉRO LLM dur, jamais 500 brut sur le chemin déterministe.
 *
 * Contrat FIGÉ : handleGetConversionScore(env, auth, leadId) -> Promise<Response>.
 */
export async function handleGetConversionScore(
  env: Env,
  auth: ConversionAuth,
  leadId: string,
): Promise<Response> {
  const g = conversionCapGuard(auth, 'ai.use');
  if (g) return g;

  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  // Bornage tenant : client_id depuis l'AUTH (jamais le body / l'URL).
  const clientId = resolveClientId(auth);

  try {
    // ── Cache lookup (frais < TTL) ──────────────────────────────────────────
    const cached = await env.DB.prepare(
      `SELECT lead_id, probability, calibrated, factors_json, computed_at
         FROM conversion_predictions
        WHERE lead_id = ?`,
    ).bind(leadId).first<ConversionCacheRow>().catch(() => null);

    if (cached) {
      const ageSec = ageSeconds(cached.computed_at);
      if (ageSec >= 0 && ageSec < CACHE_TTL_SECONDS) {
        let factors: { label: string; impact: number }[] = [];
        try {
          factors = cached.factors_json ? JSON.parse(cached.factors_json) : [];
        } catch { factors = []; }
        const payload: ConversionPredictionData = {
          probability: Number(cached.probability || 0),
          calibrated: Number(cached.calibrated || 0),
          factors,
          confidence: confidenceFromSample(estimateSampleFromFactors(factors)),
        };
        return json({ data: payload });
      }
    }

    // ── Charge le lead BORNÉ TENANT ─────────────────────────────────────────
    // En mode agence/tenant connu : WHERE id = ? AND client_id = ? (anti
    // cross-tenant). En legacy/mono-tenant (clientId null) : WHERE id = ? seul.
    const lead = clientId
      ? await env.DB.prepare(
          `SELECT id, client_id, score, status, source, deal_value,
                  updated_at, created_at, last_activity_at, tags
             FROM leads WHERE id = ? AND client_id = ?`,
        ).bind(leadId, clientId).first<ConversionLeadRow>().catch(() => null)
      : await env.DB.prepare(
          `SELECT id, client_id, score, status, source, deal_value,
                  updated_at, created_at, last_activity_at, tags
             FROM leads WHERE id = ?`,
        ).bind(leadId).first<ConversionLeadRow>().catch(() => null);

    if (!lead) return json({ error: 'Lead introuvable' }, 404);

    // ── Recompute calibré (déterministe, ZÉRO LLM) ──────────────────────────
    const result = await computeCalibratedProbability(env, lead as unknown as
      { id: string; client_id?: string | null } & Record<string, unknown>);

    // ── Upsert cache (delete+insert idempotent borné lead — pas d'UNIQUE SQL) ─
    try {
      await env.DB.prepare(
        `DELETE FROM conversion_predictions WHERE lead_id = ?`,
      ).bind(leadId).run();
      await env.DB.prepare(
        `INSERT INTO conversion_predictions
           (lead_id, client_id, probability, calibrated, factors_json, computed_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      ).bind(
        leadId,
        lead.client_id ?? clientId ?? null,
        result.probability,
        result.calibrated,
        JSON.stringify(result.factors),
      ).run();
    } catch (cacheErr) {
      // Best-effort : table absente ⇒ on sert quand même le calcul.
      console.error('handleGetConversionScore cache upsert failed', leadId, cacheErr);
    }

    const payload: ConversionPredictionData = {
      probability: result.probability,
      calibrated: result.calibrated,
      factors: result.factors,
      confidence: confidenceFromSample(estimateSampleFromFactors(result.factors)),
    };
    return json({ data: payload });
  } catch (err) {
    console.error('handleGetConversionScore failed', leadId, err);
    // Jamais 500 brut sur le chemin déterministe : fallback non-calibré sûr.
    return json({ data: { probability: 0, calibrated: 0, factors: [] } });
  }
}

// Âge en secondes d'un timestamp SQLite/ISO (-1 si illisible).
function ageSeconds(dateStr: string | null | undefined): number {
  if (!dateStr) return -1;
  const norm = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const t = Date.parse(norm);
  if (!Number.isFinite(t)) return -1;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

// Estime le sample_size depuis le facteur « taux historique … (n=…) » pour
// dériver la confiance affichée (low/medium/high). 0 si non calibré.
function estimateSampleFromFactors(
  factors: { label: string; impact: number }[],
): number {
  for (const f of factors) {
    const m = /\(n=(\d+)\)/.exec(f.label || '');
    if (m && m[1]) return parseInt(m[1], 10);
  }
  return 0;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/conversion/baselines — baselines agrégées du tenant (OPTIONNEL)
// ──────────────────────────────────────────────────────────────────────────
// ⚠ La route /api/conversion/baselines n'est PAS câblée par Phase A (cf. §6.C +
// IMPLEMENTATION-LOG). Ce handler est exporté/disponible MAIS inactif tant que le
// dispatch n'est pas posé dans worker.ts — qui est GELÉ Phase A et que Manager-B
// NE TOUCHE PAS. Le helper front getConversionBaselines() reste donc inactif sans
// erreur. Signalé dans le rapport.
// ════════════════════════════════════════════════════════════════════════════

export async function handleGetConversionBaselines(
  env: Env,
  auth: ConversionAuth,
): Promise<Response> {
  const g = conversionCapGuard(auth, 'ai.use');
  if (g) return g;

  const clientId = resolveClientId(auth);
  if (!clientId) {
    return json(
      { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
      400,
    );
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, agency_id, dimension, dimension_value,
              won_count, lost_count, conversion_rate, sample_size, computed_at
         FROM conversion_baselines
        WHERE client_id = ?
        ORDER BY dimension ASC, sample_size DESC`,
    ).bind(clientId).all();
    return json({ data: { baselines: results || [] } });
  } catch (err) {
    console.error('handleGetConversionBaselines failed', clientId, err);
    return json({ data: { baselines: [] } });
  }
}
