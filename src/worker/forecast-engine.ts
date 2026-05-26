// ══════════════════════════════════════════════════════════════════════════
// ██  Module Forecast Engine — SPRINT 14 « Forecasting — projection + objectifs
// ██  + scénarios »  (Phase A SOLO posa les stubs — corps réels Phase B Manager-B)
// ══════════════════════════════════════════════════════════════════════════
//
// GAP comblé : un forecast pondéré existe DÉJÀ (pipelines.ts
// handleGetPipelineForecast : deal_value × stage.probability, route
// GET /api/pipelines/:id/forecast, vue ForecastView.tsx — testé) mais NAÏF :
// date de close SIMULÉE +90j (`expectedDate.setDate(+90)`), pas de projection de
// tendance, pas de group-by commercial/source, pas d'objectifs/quotas, pas de
// scénarios. Ce module AJOUTE un moteur ENRICHI (DÉTERMINISTE, offline-safe,
// ZÉRO LLM) servi par des routes NEUVES /api/forecast* + une table NEUVE
// `forecast_targets` (seq 114). IL NE RÉÉCRIT PAS handleGetPipelineForecast.
//
// RÉUTILISE EN LECTURE (NE RÉÉCRIT RIEN) :
//   - leads : status / deal_value / assigned_to / utm_source / stage_id /
//     pipeline_id / created_at / updated_at (won/closed = réalisé). JOIN
//     pipeline_stages pour la probability (pondération deal_value × probability
//     — comme l'existant handleGetPipelineForecast).
//   - orders : total_cents (÷100) / status / created_at — réalisé e-commerce.
//   - conversion_baselines (seq 113) : conversion_rate observé du tenant —
//     LECTURE pour calibrer les scénarios best/likely/worst (sinon stage
//     probability). reports.ts:30-41 = pattern d'agrégat de référence.
//
// ⚠ BUG CORRIGÉ (Phase B) : la date de close +90j naïve de
//   handleGetPipelineForecast est REMPLACÉE ici par un buckétage DÉTERMINISTE
//   documenté (heuristique stage.probability → horizon en mois, ancrée sur le
//   mois courant fourni par `period` ou dérivé des données — voir
//   `stageHorizonMonths` / `bucketMonth` plus bas). JAMAIS le +90j simulé.
//
// Storage : table `forecast_targets` (D1, seq 114 — voir
// migration-forecast-seq114.sql). Choix figés docs/LOT-FORECASTING.md §6.
//
// Capability mutualisée : LECTURE → 'reports.view' (déjà dans ALL_CAPABILITIES,
// ZÉRO ajout). Garde mode-agence-only (calque conversion-engine.conversionCapGuard).
//
// Réponses { data } / { error } normalisées (apiFetch GELÉ, JAMAIS `code`).
// Borné tenant (resolveClientId depuis l'auth, JAMAIS le body/URL). 100%
// DÉTERMINISTE — ZÉRO LLM.
//
import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth, Capability } from './capabilities';
import { requireCapability } from './capabilities';

// Auth enrichi tel que produit au choke-point worker.ts (authCtx) — calque
// ConversionAuth (conversion-engine.ts). `id` legacy historique conservé.
type ForecastAuth = CapAuth & {
  capabilities?: Set<string>;
  id?: string;
};

// Enums validés HANDLER (jamais CHECK SQL — cf. migration seq 114).
const VALID_GROUP_BY = ['month', 'rep', 'source'];
const VALID_SCENARIO = ['best', 'likely', 'worst'];

// Garde capability mode-agence-only (calque conversion-engine.conversionCapGuard) :
// legacy/mono-tenant non bridé, viewer bridé en mode agence.
function forecastCapGuard(
  auth: ForecastAuth,
  cap: Capability,
): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, cap);
}

// Résout le client_id du tenant courant. Bornage tenant : provient TOUJOURS de
// l'auth, JAMAIS du body / de l'URL.
function resolveClientId(auth: ForecastAuth): string | null {
  return (auth.tenant?.clientId ?? auth.clientId ?? null) as string | null;
}

// Réexport interne pour la Phase B (évite des enums divergents entre phases).
export const FORECAST_ENUMS = {
  group_by: VALID_GROUP_BY,
  scenario: VALID_SCENARIO,
} as const;

// ════════════════════════════════════════════════════════════════════════════
// HELPERS DÉTERMINISTES (offline-safe, ZÉRO LLM, ZÉRO Date.now() non-borné)
// ════════════════════════════════════════════════════════════════════════════

// Borne une probabilité 0..100 (clamp défensif).
function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 100) return 100;
  return p;
}

// Arrondi monétaire stable (2 décimales) — déterministe, évite le bruit float.
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Parse 'YYYY-MM' -> {y, m} (m: 1..12). Retourne null si invalide.
function parseMonth(s: string | null | undefined): { y: number; m: number } | null {
  if (!s) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(s.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  return { y, m };
}

// {y, m} -> 'YYYY-MM' (m: 1..12, normalisation des débordements).
function fmtMonth(y: number, m: number): string {
  // Normalise les débordements de mois (m peut être >12 ou <1 après offset).
  let yy = y;
  let mm = m;
  while (mm > 12) { mm -= 12; yy += 1; }
  while (mm < 1) { mm += 12; yy -= 1; }
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}

// Mois ancre = `period` ('YYYY-MM') si fourni & valide, sinon le mois de la date
// de référence fournie par l'env-context (ici dérivé d'une chaîne ISO stable).
// On évite Date.now() opaque : on prend le max(created_at|updated_at) des données
// comme ancre déterministe si aucun `period`. Voir handleGetForecast.
function addMonths(anchor: { y: number; m: number }, offset: number): string {
  return fmtMonth(anchor.y, anchor.m + offset);
}

// ── BUCKÉTAGE DÉTERMINISTE STAGE→HORIZON (remplace le +90j naïf) ─────────────
//
// JUSTIFICATION DU CHOIX (cf. docs/LOT-FORECASTING.md §6.I.4) :
//   Le code existant (pipelines.ts:246-248) simulait une date de close en
//   ajoutant 90 JOURS à updated_at|created_at — non documenté, non déterministe
//   (dépend de l'horloge des données), et indépendant du stage. On le REMPLACE
//   par une heuristique stage.probability → horizon en MOIS, ancrée sur un mois
//   de référence déterministe :
//     - proba HAUTE  (≥75) → horizon 0 mois  (close imminente, mois courant)
//     - proba MOYENNE (50..74) → horizon 1 mois
//     - proba BASSE  (25..49) → horizon 2 mois
//     - proba TRÈS BASSE (<25) → horizon 3 mois
//   Plus un deal est avancé (proba haute), plus sa close est proche → bucket
//   proche du mois courant. Totalement déterministe, indépendant de l'horloge,
//   et cohérent avec la pondération deal_value × probability réutilisée.
function stageHorizonMonths(prob: number): number {
  const p = clampProb(prob);
  if (p >= 75) return 0;
  if (p >= 50) return 1;
  if (p >= 25) return 2;
  return 3;
}

// ── PROJECTION DE TENDANCE (déterministe) ───────────────────────────────────
// Moyenne mobile simple 3 mois + régression linéaire simple (moindres carrés)
// sur l'historique réalisé, projetée sur 3 mois. Offline-safe, ZÉRO LLM.
function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: values[0]! };
  // x = 0..n-1 (indices déterministes).
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i]!;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function movingAverage3(values: number[]): number {
  if (values.length === 0) return 0;
  const last3 = values.slice(-3);
  const sum = last3.reduce((a, b) => a + b, 0);
  return sum / last3.length;
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/forecast — forecast enrichi (projection + scénarios + group-by)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Forecast enrichi du tenant. capGuard 'reports.view' (mode-agence-only).
 * Borné tenant (WHERE client_id = ?), ZÉRO LLM, jamais 500 brut.
 *
 * Contrat FIGÉ : handleGetForecast(env, auth, url) -> Promise<Response>.
 */
export async function handleGetForecast(
  env: Env,
  auth: ForecastAuth,
  url: URL,
): Promise<Response> {
  const g = forecastCapGuard(auth, 'reports.view');
  if (g) return g;

  // Enum validé HANDLER (jamais CHECK SQL). Défaut 'month'.
  const groupByRaw = url.searchParams.get('group_by') || 'month';
  const group_by = VALID_GROUP_BY.includes(groupByRaw) ? groupByRaw : 'month';

  // Filtre pipeline optionnel (le moteur agrège au niveau TENANT, pipeline_id
  // n'est qu'un filtre — contrairement à handleGetPipelineForecast PAR pipeline).
  const pipelineFilter = url.searchParams.get('pipeline_id') || null;
  const periodParam = url.searchParams.get('period'); // 'YYYY-MM' ancre optionnelle

  // Bornage tenant : client_id depuis l'AUTH (jamais le body / l'URL).
  const clientId = resolveClientId(auth);
  if (!clientId) {
    // Pas de tenant résolu → réponse déterministe vide (jamais 500 brut).
    return json({
      data: {
        points: [],
        scenarios: { best: 0, likely: 0, worst: 0 },
        trend: [],
        ...(group_by === 'rep' ? { by_rep: [] } : {}),
        ...(group_by === 'source' ? { by_source: [] } : {}),
      },
    });
  }

  try {
    // ── 1) PIPELINE PONDÉRÉ (open deals) : deal_value × stage.probability ─────
    // Pondération RÉUTILISÉE (lecture, comme handleGetPipelineForecast).
    // Exclut 'lost' ET les réalisés ('won','closed') : pipeline = deals OUVERTS.
    const openParams: (string | null)[] = [clientId];
    let openPipelineClause = '';
    if (pipelineFilter) {
      openPipelineClause = ' AND l.pipeline_id = ?';
      openParams.push(pipelineFilter);
    }
    const openQuery = `
      SELECT l.deal_value AS deal_value, s.probability AS probability,
             l.assigned_to AS assigned_to, l.utm_source AS utm_source,
             l.created_at AS created_at, l.updated_at AS updated_at
      FROM leads l
      JOIN pipeline_stages s ON l.stage_id = s.id
      WHERE l.client_id = ?
        AND l.status NOT IN ('lost','won','closed')${openPipelineClause}
    `;
    const openRes = await env.DB.prepare(openQuery).bind(...openParams).all();
    const openLeads = (openRes.results || []) as Array<{
      deal_value: number | null;
      probability: number | null;
      assigned_to: string | null;
      utm_source: string | null;
      created_at: string | null;
      updated_at: string | null;
    }>;

    // ── Ancre déterministe du forecast (mois courant) ─────────────────────────
    // Priorité : `period` param valide. Sinon, max(updated_at|created_at) des
    // open leads (ancre stable issue des données). Sinon, fallback 'now' borné
    // à YYYY-MM (offline-safe : seul cas où l'horloge est utilisée, jamais
    // injectée dans un calcul itératif).
    let anchor = parseMonth(periodParam);
    if (!anchor) {
      let maxIso = '';
      for (const l of openLeads) {
        const iso = (l.updated_at || l.created_at || '') as string;
        if (iso > maxIso) maxIso = iso;
      }
      anchor = parseMonth(maxIso ? maxIso.substring(0, 7) : null);
    }
    if (!anchor) {
      anchor = parseMonth(new Date().toISOString().substring(0, 7));
    }
    if (!anchor) anchor = { y: 1970, m: 1 };

    // ── Buckétage stage→horizon (remplace le +90j naïf) + pondération ─────────
    let weightedTotal = 0;
    const monthWeighted: Record<string, number> = {};
    const repWeighted: Record<string, number> = {};
    const sourceWeighted: Record<string, number> = {};

    for (const l of openLeads) {
      const val = Number(l.deal_value) || 0;
      const prob = clampProb(Number(l.probability) || 0);
      const weighted = (val * prob) / 100; // pondération RÉUTILISÉE
      weightedTotal += weighted;

      // Bucket déterministe : mois ancre + horizon dérivé de la proba de stage.
      const monthKey = addMonths(anchor, stageHorizonMonths(prob));
      monthWeighted[monthKey] = (monthWeighted[monthKey] || 0) + weighted;

      const repKey = (l.assigned_to || '').trim() || '(non assigné)';
      repWeighted[repKey] = (repWeighted[repKey] || 0) + weighted;

      const srcKey = (l.utm_source || '').trim() || '(direct)';
      sourceWeighted[srcKey] = (sourceWeighted[srcKey] || 0) + weighted;
    }

    // ── 2) RÉALISÉ par mois (objectifs vs réalisé) ────────────────────────────
    // Réalisé CRM = Σ leads status IN ('won','closed') × deal_value, groupé par
    // mois de close (calque reports.ts : status IN ('won','closed')). On groupe
    // par mois calendaire de updated_at (date de transition vers won/closed).
    const realizedParams: (string | null)[] = [clientId];
    let realizedPipelineClause = '';
    if (pipelineFilter) {
      realizedPipelineClause = ' AND pipeline_id = ?';
      realizedParams.push(pipelineFilter);
    }
    const realizedQuery = `
      SELECT substr(COALESCE(updated_at, created_at), 1, 7) AS period_month,
             SUM(COALESCE(deal_value, 0)) AS actual
      FROM leads
      WHERE client_id = ?
        AND status IN ('won','closed')${realizedPipelineClause}
      GROUP BY period_month
    `;
    const realizedRes = await env.DB.prepare(realizedQuery).bind(...realizedParams).all();
    const realizedRows = (realizedRes.results || []) as Array<{
      period_month: string | null; actual: number | null;
    }>;
    const monthActual: Record<string, number> = {};
    for (const r of realizedRows) {
      if (!r.period_month) continue;
      monthActual[r.period_month] = (monthActual[r.period_month] || 0) + (Number(r.actual) || 0);
    }

    // Réalisé e-commerce = Σ orders.total_cents/100 pour status réalisé.
    // CHOIX DOCUMENTÉ : réalisé e-commerce = status IN ('paid','delivered')
    // (commande encaissée OU livrée). orders.total_cents ÷100 → unité monétaire.
    // Le filtre pipeline ne s'applique PAS aux orders (e-commerce hors pipeline).
    if (!pipelineFilter) {
      const ordersQuery = `
        SELECT substr(COALESCE(placed_at, created_at), 1, 7) AS period_month,
               SUM(COALESCE(total_cents, 0)) AS total_cents
        FROM orders
        WHERE client_id = ?
          AND status IN ('paid','delivered')
        GROUP BY period_month
      `;
      const ordersRes = await env.DB.prepare(ordersQuery).bind(clientId).all();
      const orderRows = (ordersRes.results || []) as Array<{
        period_month: string | null; total_cents: number | null;
      }>;
      for (const o of orderRows) {
        if (!o.period_month) continue;
        const amount = (Number(o.total_cents) || 0) / 100; // ÷100 cents → monétaire
        monthActual[o.period_month] = (monthActual[o.period_month] || 0) + amount;
      }
    }

    // ── 3) OBJECTIFS (forecast_targets) par mois ──────────────────────────────
    const targetsParams: (string | null)[] = [clientId];
    let targetsPipelineClause = '';
    if (pipelineFilter) {
      // pipeline_id NULL = global tenant (s'applique à tous) → inclus aussi.
      targetsPipelineClause = ' AND (pipeline_id = ? OR pipeline_id IS NULL)';
      targetsParams.push(pipelineFilter);
    }
    const targetsQuery = `
      SELECT period_month, SUM(COALESCE(target_amount, 0)) AS target
      FROM forecast_targets
      WHERE client_id = ?${targetsPipelineClause}
      GROUP BY period_month
    `;
    const targetsRes = await env.DB.prepare(targetsQuery).bind(...targetsParams).all();
    const targetRows = (targetsRes.results || []) as Array<{
      period_month: string | null; target: number | null;
    }>;
    const monthTarget: Record<string, number> = {};
    for (const t of targetRows) {
      if (!t.period_month) continue;
      monthTarget[t.period_month] = (monthTarget[t.period_month] || 0) + (Number(t.target) || 0);
    }

    // ── 4) POINTS unifiés (weighted + target + actual) par mois trié ──────────
    const allMonths = new Set<string>([
      ...Object.keys(monthWeighted),
      ...Object.keys(monthActual),
      ...Object.keys(monthTarget),
    ]);
    const sortedMonths = Array.from(allMonths).sort();
    const points = sortedMonths.map((pm) => {
      const point: {
        period_month: string; weighted: number; target?: number; actual?: number;
      } = {
        period_month: pm,
        weighted: round2(monthWeighted[pm] || 0),
      };
      if (pm in monthTarget) point.target = round2(monthTarget[pm]!);
      if (pm in monthActual) point.actual = round2(monthActual[pm]!);
      return point;
    });

    // ── 5) TENDANCE : moyenne mobile 3 mois + régression linéaire (déterministe)
    // Historique réalisé = série mensuelle des `actual` triée. On projette 3 mois
    // au-delà du dernier mois réalisé. Offline-safe.
    const realizedMonths = Object.keys(monthActual).sort();
    const realizedSeries = realizedMonths.map((m) => monthActual[m]!);
    const trend: Array<{ period_month: string; weighted: number }> = [];
    if (realizedSeries.length > 0) {
      const { slope, intercept } = linearRegression(realizedSeries);
      const ma3 = movingAverage3(realizedSeries);
      const lastRealized = parseMonth(realizedMonths[realizedMonths.length - 1]!)
        ?? anchor;
      const n = realizedSeries.length;
      for (let h = 1; h <= 3; h++) {
        // Régression : valeur à l'indice (n-1+h). Lissée avec la MA3 (moyenne des
        // deux estimateurs déterministes) pour atténuer la volatilité.
        const reg = slope * (n - 1 + h) + intercept;
        const projected = Math.max(0, (reg + ma3) / 2);
        trend.push({
          period_month: addMonths(lastRealized, h),
          weighted: round2(projected),
        });
      }
    }

    // ── 6) SCÉNARIOS best/likely/worst (déterministes, bornés) ────────────────
    // Base = pondération totale (Σ deal_value × proba). Facteurs déterministes
    // BORNÉS : best ×1.25 / likely ×1.0 / worst ×0.7. Si conversion_baselines
    // (seq 113, dimension='overall') présent, on AJUSTE le facteur likely par le
    // ratio conversion_rate observé / proba moyenne implicite (borné [0.5,1.5]),
    // sinon on garde stage.probability via la pondération (fallback). LECTURE.
    let likelyFactor = 1.0;
    try {
      const baseRes = await env.DB.prepare(
        `SELECT conversion_rate, sample_size
           FROM conversion_baselines
          WHERE client_id = ? AND dimension = 'overall'
          ORDER BY sample_size DESC
          LIMIT 1`,
      ).bind(clientId).first() as { conversion_rate: number | null; sample_size: number | null } | null;
      if (baseRes && baseRes.conversion_rate != null && Number(baseRes.sample_size) > 0) {
        // Proba moyenne implicite des open deals (pondération / valeur brute).
        let grossValue = 0;
        for (const l of openLeads) grossValue += Number(l.deal_value) || 0;
        const impliedProb = grossValue > 0 ? (weightedTotal / grossValue) : 0; // 0..1
        const observed = clampProb(Number(baseRes.conversion_rate) * 100) / 100; // 0..1
        if (impliedProb > 0) {
          let ratio = observed / impliedProb;
          // Bornage déterministe du facteur de calibration.
          if (ratio < 0.5) ratio = 0.5;
          if (ratio > 1.5) ratio = 1.5;
          likelyFactor = ratio;
        }
      }
    } catch {
      // conversion_baselines absent / non migré → fallback stage.probability
      // (likelyFactor reste 1.0). Jamais 500 brut.
      likelyFactor = 1.0;
    }

    const likely = round2(weightedTotal * likelyFactor);
    const scenarios = {
      best: round2(weightedTotal * likelyFactor * 1.25),
      likely,
      worst: round2(weightedTotal * likelyFactor * 0.7),
    };

    // ── 7) GROUP-BY (rep / source) ────────────────────────────────────────────
    const toGroups = (map: Record<string, number>) =>
      Object.keys(map)
        .map((key) => ({ key, weighted: round2(map[key]!) }))
        .sort((a, b) => b.weighted - a.weighted);

    const data: {
      points: typeof points;
      scenarios: typeof scenarios;
      trend: typeof trend;
      by_rep?: Array<{ key: string; weighted: number }>;
      by_source?: Array<{ key: string; weighted: number }>;
    } = { points, scenarios, trend };

    if (group_by === 'rep') data.by_rep = toGroups(repWeighted);
    if (group_by === 'source') data.by_source = toGroups(sourceWeighted);

    return json({ data });
  } catch (err) {
    // Jamais 500 brut : réponse déterministe dégradée (offline-safe).
    return json({
      data: {
        points: [],
        scenarios: { best: 0, likely: 0, worst: 0 },
        trend: [],
        ...(group_by === 'rep' ? { by_rep: [] } : {}),
        ...(group_by === 'source' ? { by_source: [] } : {}),
      },
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CRUD /api/forecast/targets — objectifs / quotas de revenu
// ════════════════════════════════════════════════════════════════════════════

/**
 * Liste les objectifs / quotas du tenant. capGuard 'reports.view'.
 * Borné tenant (WHERE client_id = ?).
 *
 * Contrat FIGÉ : handleGetForecastTargets(env, auth, url) -> Promise<Response>.
 */
export async function handleGetForecastTargets(
  env: Env,
  auth: ForecastAuth,
  url: URL,
): Promise<Response> {
  const g = forecastCapGuard(auth, 'reports.view');
  if (g) return g;

  const clientId = resolveClientId(auth);
  if (!clientId) return json({ data: { targets: [] } });

  // Filtres optionnels (lecture seule, bornés tenant).
  const pipelineFilter = url.searchParams.get('pipeline_id') || null;
  const periodFilter = url.searchParams.get('period') || null;

  const params: (string | null)[] = [clientId];
  let clause = '';
  if (pipelineFilter) { clause += ' AND pipeline_id = ?'; params.push(pipelineFilter); }
  if (periodFilter) { clause += ' AND period_month = ?'; params.push(periodFilter); }

  try {
    const res = await env.DB.prepare(
      `SELECT id, client_id, agency_id, pipeline_id, assigned_to,
              period_month, target_amount, created_at
         FROM forecast_targets
        WHERE client_id = ?${clause}
        ORDER BY period_month DESC, created_at DESC`,
    ).bind(...params).all();
    const targets = (res.results || []).map((r: any) => ({
      id: String(r.id),
      client_id: r.client_id ?? null,
      agency_id: r.agency_id ?? null,
      pipeline_id: r.pipeline_id ?? null,
      assigned_to: r.assigned_to ?? null,
      period_month: String(r.period_month ?? ''),
      target_amount: Number(r.target_amount) || 0,
      created_at: r.created_at ?? undefined,
    }));
    return json({ data: { targets } });
  } catch {
    return json({ data: { targets: [] } });
  }
}

/**
 * Crée un objectif / quota de revenu. capGuard 'reports.view'.
 * client_id renseigné depuis l'AUTH (JAMAIS le body). period_month 'YYYY-MM'.
 * pipeline_id / assigned_to NULLABLES (null = global tenant / équipe).
 *
 * Contrat FIGÉ : handleCreateForecastTarget(request, env, auth) -> Promise<Response>.
 */
export async function handleCreateForecastTarget(
  request: Request,
  env: Env,
  auth: ForecastAuth,
): Promise<Response> {
  const g = forecastCapGuard(auth, 'reports.view');
  if (g) return g;

  const clientId = resolveClientId(auth);
  if (!clientId) return json({ error: 'Tenant introuvable' }, 403);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Corps JSON invalide' }, 400);
  }

  // Validation HANDLER (jamais CHECK SQL). period_month 'YYYY-MM' obligatoire.
  const periodMonth = typeof body?.period_month === 'string' ? body.period_month.trim() : '';
  if (!parseMonth(periodMonth)) {
    return json({ error: 'period_month requis au format YYYY-MM' }, 400);
  }
  const targetAmount = Number(body?.target_amount);
  if (!Number.isFinite(targetAmount) || targetAmount < 0) {
    return json({ error: 'target_amount invalide (nombre >= 0)' }, 400);
  }
  // Nullables : pipeline_id / assigned_to (null = global tenant / équipe).
  const pipelineId = typeof body?.pipeline_id === 'string' && body.pipeline_id.trim()
    ? body.pipeline_id.trim() : null;
  const assignedTo = typeof body?.assigned_to === 'string' && body.assigned_to.trim()
    ? body.assigned_to.trim() : null;

  // agency_id depuis l'auth (jamais le body), si présent.
  const agencyId = (auth.tenant?.agencyId ?? null) as string | null;

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO forecast_targets
         (id, client_id, agency_id, pipeline_id, assigned_to, period_month, target_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(id, clientId, agencyId, pipelineId, assignedTo, periodMonth, targetAmount).run();
    return json({ data: { id } }, 201);
  } catch {
    return json({ error: 'Création impossible' }, 400);
  }
}

/**
 * Supprime un objectif / quota. capGuard 'reports.view'.
 * Suppression BORNÉE TENANT (WHERE id = ? AND client_id = ? — client_id de
 * l'AUTH, jamais du body/URL).
 *
 * Contrat FIGÉ : handleDeleteForecastTarget(env, auth, id) -> Promise<Response>.
 */
export async function handleDeleteForecastTarget(
  env: Env,
  auth: ForecastAuth,
  id: string,
): Promise<Response> {
  const g = forecastCapGuard(auth, 'reports.view');
  if (g) return g;

  if (!id) return json({ error: 'id requis' }, 400);

  const clientId = resolveClientId(auth);
  if (!clientId) return json({ error: 'Tenant introuvable' }, 403);

  try {
    // DELETE borné tenant : id ET client_id (de l'AUTH, jamais du body/URL).
    await env.DB.prepare(
      `DELETE FROM forecast_targets WHERE id = ? AND client_id = ?`,
    ).bind(id, clientId).run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Suppression impossible' }, 400);
  }
}
