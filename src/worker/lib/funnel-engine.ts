// ── Sprint 44 — funnel-engine.ts — Funnels Builder core (PHASE B implém) ───
//
// 4 helpers : pickVariantForVisitor (déterministe FNV-1a hash) +
// computeFunnelAnalytics (SELECT D1 agrégats par step + variant) +
// recordView (best-effort INSERT fb_step_views) + recordConversion
// (best-effort INSERT fb_step_conversions).
//
// Contrat FIGÉ §6 docs/LOT-FUNNELS-S44.md :
//   - pickVariantForVisitor   → FunnelStepVariant déterministe (hash modulo
//                                cumulé traffic_pct)
//   - computeFunnelAnalytics  → Promise<FunnelStepAnalytics>
//   - recordView              → Promise<void> (best-effort, ne throw jamais)
//   - recordConversion        → Promise<void> (best-effort, ne throw jamais)
//
// Tables `fb_*` (préfixe Sprint 44, voir migration-funnels-seq139.sql) :
//   fb_funnels, fb_steps, fb_step_variants, fb_step_views, fb_step_conversions.
// Bornage tenant : analytics borné via fb_funnels.client_id (join applicatif).

import type { Env } from '../types';
import type {
  FunnelStepVariant,
  FunnelStepAnalytics,
  FunnelStepType,
} from '../../lib/api';

// ── Constantes (Sprint 44 renforcement) ─────────────────────────────────────

/**
 * Whitelist des `step_type` (snake_case TS — mirror seq139 enum HANDLER).
 * Frozen pour interdire les mutations runtime. Source unique de vérité côté
 * engine (le handler garde sa propre Set pour ne pas créer de dépendance
 * circulaire engine→handler).
 */
export const FUNNEL_STEP_TYPES = Object.freeze([
  'landing',
  'optin',
  'upsell',
  'downsell',
  'thank_you',
  'custom',
] as const);

/**
 * Codes d'erreur normalisés pour les helpers de validation/calcul (engine).
 * Le handler conserve son contrat figé `json({ error: '...' })` sans champ
 * `code` (cf. docs/LOT-FUNNELS-S44.md §6) — ces codes restent INTERNES à
 * l'engine pour les retours `{ ok: false, error: { code, message } }`.
 */
export const FUNNEL_ERROR_CODES = Object.freeze({
  FUNNEL_NOT_FOUND: 'FUNNEL_NOT_FOUND',
  STEP_INVALID: 'STEP_INVALID',
  VARIANT_NOT_FOUND: 'VARIANT_NOT_FOUND',
  INVALID_SPLIT: 'INVALID_SPLIT',
  INVALID_STEP_TYPE: 'INVALID_STEP_TYPE',
  DUPLICATE_ORDER_INDEX: 'DUPLICATE_ORDER_INDEX',
  EMPTY_VARIANTS: 'EMPTY_VARIANTS',
} as const);

export type FunnelErrorCode =
  (typeof FUNNEL_ERROR_CODES)[keyof typeof FUNNEL_ERROR_CODES];

/** Erreur structurée retournée par les validators (additif). */
export interface FunnelValidationError {
  code: FunnelErrorCode;
  message: string;
}

/** Result type uniforme pour validators (additif). */
export type ValidationResult =
  | { ok: true }
  | { ok: false; error: FunnelValidationError };

/**
 * Sélection déterministe d'une variante pour un visiteur donné.
 *
 * Algorithme :
 *   1. Hash visitor_id → entier 32 bits (FNV-1a).
 *   2. Bucket = hash / 2^32 ∈ [0, 1).
 *   3. Parcours des variantes (ordre stable par id ASC) en cumulant
 *      `traffic_pct` ; retourne la variante dont l'intervalle cumulé contient
 *      `bucket`.
 *   4. Si la somme des `traffic_pct` < 1 OU > 1 : normalisation interne.
 *      Si liste vide : retourne null (caller utilise fallback HTML).
 *
 * Garantit : un même visitor_id voit TOUJOURS la même variante (pas de
 * contamination des analytics A/B test).
 */
export function pickVariantForVisitor(
  variants: FunnelStepVariant[],
  visitorId: string,
): FunnelStepVariant | null {
  if (!variants || variants.length === 0) return null;
  if (variants.length === 1) return variants[0]!;

  // Stable sort by id ASC pour déterminisme cross-call.
  const sorted = [...variants].sort((a, b) => a.id.localeCompare(b.id));

  // Somme des traffic_pct (normalisation si != 1).
  const totalPct = sorted.reduce(
    (sum, v) => sum + (Number.isFinite(v.traffic_pct) ? Math.max(0, v.traffic_pct) : 0),
    0,
  );
  if (totalPct <= 0) return sorted[0]!;

  // Hash FNV-1a sur visitor_id → bucket ∈ [0, 1).
  const hash = fnv1a(visitorId);
  const bucket = (hash >>> 0) / 0x100000000;

  let cumulative = 0;
  for (const v of sorted) {
    const pct = Number.isFinite(v.traffic_pct) ? Math.max(0, v.traffic_pct) : 0;
    cumulative += pct / totalPct;
    if (bucket < cumulative) return v;
  }
  // Edge case (cumulative arrondi < 1) : retourne la dernière.
  return sorted[sorted.length - 1]!;
}

/** FNV-1a 32-bit hash (pure, déterministe, sans dépendance externe). */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** SHA-256 court (32 hex chars) pour anonymiser le user-agent (Loi 25). */
async function sha256Short(input: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(input.slice(0, 256));
    const buf = await crypto.subtle.digest('SHA-256', data);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  } catch {
    return '';
  }
}

/**
 * Calcule les analytics agrégées d'un funnel.
 *
 * Pipeline :
 *   1. SELECT fb_steps WHERE funnel_id=? ORDER BY order_index ASC → steps.
 *   2. Pour chaque step : SELECT fb_step_variants WHERE step_id=? → variants.
 *   3. Agrégat views/conversions :
 *      - COUNT(*) views par step+variant (jointure applicative).
 *      - COUNT(*) conversions par step+variant.
 *   4. conversion_rate global : conversions(step 1) / views(step 1).
 *   5. top_variants : sort DESC conversion_rate, slice 5.
 *
 * Best-effort : toute erreur D1 → shape vide. Bornage tenant : caller
 * (handler) doit pré-vérifier funnel_id ∈ client_id.
 */
export async function computeFunnelAnalytics(
  env: Env,
  funnelId: string,
): Promise<FunnelStepAnalytics> {
  const empty: FunnelStepAnalytics = {
    steps_breakdown: [],
    conversion_rate: 0,
    top_variants: [],
  };
  if (!funnelId) return empty;

  try {
    // 1) Steps du funnel ordonnés.
    const stepsRows = await env.DB.prepare(
      `SELECT id, name, step_type, order_index
         FROM fb_steps
        WHERE funnel_id = ?
        ORDER BY order_index ASC`,
    )
      .bind(funnelId)
      .all();

    const steps = ((stepsRows.results || []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      step_type: String(r.step_type ?? 'landing') as FunnelStepType,
      order_index: Number(r.order_index ?? 0),
    }));

    if (steps.length === 0) return empty;

    const stepIds = steps.map((s) => s.id);
    const placeholders = stepIds.map(() => '?').join(',');

    // 2) Variants de tous les steps en un shot (évite N+1).
    const variantsRows = await env.DB.prepare(
      `SELECT id, step_id, variant_name, is_control
         FROM fb_step_variants
        WHERE step_id IN (${placeholders})`,
    )
      .bind(...stepIds)
      .all();

    const variants = ((variantsRows.results || []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id ?? ''),
      step_id: String(r.step_id ?? ''),
      variant_name: String(r.variant_name ?? ''),
      is_control: r.is_control === 1 || r.is_control === true,
    }));

    // 3) Counts views par (step_id, variant_id).
    const viewsRows = await env.DB.prepare(
      `SELECT step_id, variant_id, COUNT(*) AS c
         FROM fb_step_views
        WHERE step_id IN (${placeholders})
        GROUP BY step_id, variant_id`,
    )
      .bind(...stepIds)
      .all();

    const viewsMap = new Map<string, number>();
    const viewsByStep = new Map<string, number>();
    for (const r of (viewsRows.results || []) as Array<Record<string, unknown>>) {
      const stepId = String(r.step_id ?? '');
      const variantId = String(r.variant_id ?? '');
      const c = Number(r.c ?? 0);
      viewsMap.set(`${stepId}|${variantId}`, c);
      viewsByStep.set(stepId, (viewsByStep.get(stepId) ?? 0) + c);
    }

    // 4) Counts conversions par (step_id, variant_id).
    const convRows = await env.DB.prepare(
      `SELECT step_id, variant_id, COUNT(*) AS c
         FROM fb_step_conversions
        WHERE step_id IN (${placeholders})
        GROUP BY step_id, variant_id`,
    )
      .bind(...stepIds)
      .all();

    const convMap = new Map<string, number>();
    const convByStep = new Map<string, number>();
    for (const r of (convRows.results || []) as Array<Record<string, unknown>>) {
      const stepId = String(r.step_id ?? '');
      const variantId = String(r.variant_id ?? '');
      const c = Number(r.c ?? 0);
      convMap.set(`${stepId}|${variantId}`, c);
      convByStep.set(stepId, (convByStep.get(stepId) ?? 0) + c);
    }

    // 5) Construction du breakdown.
    const stepsBreakdown = steps.map((s) => {
      const stepViews = viewsByStep.get(s.id) ?? 0;
      const stepConvs = convByStep.get(s.id) ?? 0;
      const stepRate = stepViews > 0 ? stepConvs / stepViews : 0;
      const stepVariants = variants
        .filter((v) => v.step_id === s.id)
        .map((v) => {
          const vViews = viewsMap.get(`${s.id}|${v.id}`) ?? 0;
          const vConvs = convMap.get(`${s.id}|${v.id}`) ?? 0;
          const vRate = vViews > 0 ? vConvs / vViews : 0;
          return {
            variant_id: v.id,
            variant_name: v.variant_name,
            is_control: v.is_control,
            views: vViews,
            conversions: vConvs,
            conversion_rate: vRate,
          };
        });
      return {
        step_id: s.id,
        step_name: s.name,
        step_type: s.step_type,
        order_index: s.order_index,
        views: stepViews,
        conversions: stepConvs,
        conversion_rate: stepRate,
        variants: stepVariants,
      };
    });

    // 6) conversion_rate global : conversions step 1 / views step 1.
    const firstStep = steps[0]!;
    const firstViews = viewsByStep.get(firstStep.id) ?? 0;
    const firstConvs = convByStep.get(firstStep.id) ?? 0;
    const globalRate = firstViews > 0 ? firstConvs / firstViews : 0;

    // 7) top_variants : sort DESC conversion_rate, slice 5.
    const topVariants = stepsBreakdown
      .flatMap((s) =>
        s.variants.map((v) => ({
          variant_id: v.variant_id,
          step_id: s.step_id,
          variant_name: v.variant_name,
          conversion_rate: v.conversion_rate,
        })),
      )
      .sort((a, b) => b.conversion_rate - a.conversion_rate)
      .slice(0, 5);

    return {
      steps_breakdown: stepsBreakdown,
      conversion_rate: globalRate,
      top_variants: topVariants,
    };
  } catch {
    return empty;
  }
}

/**
 * Enregistre une vue de variante (anonyme, best-effort).
 *
 * Pipeline :
 *   1. Calcul user_agent_hash (SHA-256 court 32 hex chars).
 *   2. Lecture header CF-IPCountry (2 lettres ISO, non-PII).
 *   3. Résolution client_id via fb_steps.funnel_id → fb_funnels.client_id.
 *   4. INSERT fb_step_views (id, step_id, variant_id, visitor_id, client_id,
 *      user_agent_hash, country) — ZÉRO PII brute.
 *   5. Si INSERT fail (table absente, etc.) → swallow.
 */
export async function recordView(
  env: Env,
  stepId: string,
  variantId: string,
  visitorId: string,
  request: Request,
): Promise<void> {
  if (!stepId || !variantId || !visitorId) return;
  try {
    const ua = request.headers.get('User-Agent') || '';
    const country = (request.headers.get('CF-IPCountry') || '').slice(0, 2);
    const uaHash = ua ? await sha256Short(ua) : '';

    // Résolution client_id via jointure applicative (best-effort).
    let clientId: string | null = null;
    try {
      const row = (await env.DB.prepare(
        `SELECT f.client_id AS client_id
           FROM fb_steps s
           JOIN fb_funnels f ON f.id = s.funnel_id
          WHERE s.id = ?
          LIMIT 1`,
      )
        .bind(stepId)
        .first()) as { client_id?: string } | null;
      clientId = row?.client_id ? String(row.client_id) : null;
    } catch {
      clientId = null;
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO fb_step_views
         (id, step_id, variant_id, visitor_id, client_id, viewed_at, user_agent_hash, country)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
    )
      .bind(id, stepId, variantId, visitorId, clientId, uaHash || null, country || null)
      .run();
  } catch {
    // Best-effort : ne JAMAIS throw côté caller public.
  }
}

/**
 * Enregistre une conversion (anonyme, best-effort).
 *
 * Pipeline :
 *   1. Résolution client_id via fb_steps.funnel_id → fb_funnels.client_id.
 *   2. INSERT fb_step_conversions (id, step_id, variant_id, visitor_id,
 *      client_id, next_step_id, conversion_value_cents).
 *   3. Si INSERT fail → swallow.
 */
export async function recordConversion(
  env: Env,
  stepId: string,
  variantId: string,
  visitorId: string,
  nextStepId: string | null,
  valueCents: number,
): Promise<void> {
  if (!stepId || !variantId || !visitorId) return;
  try {
    // Résolution client_id (best-effort).
    let clientId: string | null = null;
    try {
      const row = (await env.DB.prepare(
        `SELECT f.client_id AS client_id
           FROM fb_steps s
           JOIN fb_funnels f ON f.id = s.funnel_id
          WHERE s.id = ?
          LIMIT 1`,
      )
        .bind(stepId)
        .first()) as { client_id?: string } | null;
      clientId = row?.client_id ? String(row.client_id) : null;
    } catch {
      clientId = null;
    }

    const safeValue = Number.isFinite(valueCents) ? Math.max(0, Math.floor(valueCents)) : 0;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO fb_step_conversions
         (id, step_id, variant_id, visitor_id, client_id, next_step_id, conversion_value_cents, converted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(id, stepId, variantId, visitorId, clientId, nextStepId, safeValue)
      .run();
  } catch {
    // Best-effort.
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PURE HELPERS (Sprint 44 renforcement — additif, zéro régression)
//
// Ces fonctions sont SANS effet de bord (pas de D1, pas de Request) et
// déterministes. Elles complètent l'engine async existant :
//   - hashVisitorId            : FNV-1a → [0, 99] (bucketing percent)
//   - assignVariant            : assignation déterministe via split_pct ∈[1,99]
//   - validateStepOrder        : order_index unique séquentiel 0..N-1
//   - validateSplitPct         : sum=100 + chaque ∈[1,99]
//   - validateStepType         : whitelist FUNNEL_STEP_TYPES
//   - computeFunnelConversion  : pure calc views[]→breakdown + global
//   - identifyDropoff          : max écart between consecutive steps
//   - aggregateFunnelAnalytics : orchestrator pure (par segment UTM optionnel)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hash déterministe d'un visitor_id → entier ∈ [0, 99] (bucket percent).
 *
 * Utilisé pour le bucketing A/B (assignVariant). Wrapper expose le FNV-1a
 * interne avec normalisation mod 100. Garantit qu'un même visitor_id retourne
 * toujours le même bucket entre runs/sessions.
 *
 * @param visitorId — UUID v4 ou identifiant stable (cookie `_intralys_fid`).
 * @returns Entier ∈ [0, 99] (jamais throw, fallback 0 si input vide).
 */
export function hashVisitorId(visitorId: string): number {
  if (!visitorId || typeof visitorId !== 'string') return 0;
  return fnv1a(visitorId) % 100;
}

/**
 * Variante "split_pct integer" pour assignVariant (1..99, sum=100).
 *
 * Différent de FunnelStepVariant côté API qui utilise `traffic_pct` ∈ [0, 1]
 * (REAL). Ici on travaille en INTEGER percent — convention plus lisible côté
 * builder UI ("variant A: 50%, variant B: 50%"). Le mapping est trivial :
 *   split_pct = Math.round(traffic_pct * 100)
 */
export interface VariantSplit {
  id: string;
  split_pct: number; // entier ∈ [1, 99] (somme = 100 sur l'ensemble)
}

/**
 * Assignation déterministe d'une variante pour un visiteur (Sprint 44 renforcement).
 *
 * Différent de `pickVariantForVisitor` (qui consomme `FunnelStepVariant.traffic_pct`
 * en [0, 1]) — `assignVariant` consomme `VariantSplit.split_pct` en [1, 99]
 * entier. Algorithme identique : FNV-1a hash → bucket [0, 99] → cumulative
 * split_pct → première variante dont l'intervalle contient le bucket.
 *
 * Contrats :
 *   - vide → null (caller fallback).
 *   - 1 seule variante → cette variante (court-circuit).
 *   - somme split_pct invalide (≠ 100) → assignation par normalisation
 *     interne (best-effort, le validator `validateSplitPct` doit être appelé
 *     en amont pour rejeter proprement avec INVALID_SPLIT).
 *
 * @param visitorId — identifiant stable du visiteur (cookie).
 * @param variants  — array de splits (id + percent entier).
 * @returns Variant choisi ou null si liste vide.
 */
export function assignVariant<T extends VariantSplit>(
  visitorId: string,
  variants: T[],
): T | null {
  if (!variants || variants.length === 0) return null;
  if (variants.length === 1) return variants[0]!;

  // Stable sort par id ASC (déterminisme cross-call indépendant de l'ordre
  // d'insertion D1).
  const sorted = [...variants].sort((a, b) => a.id.localeCompare(b.id));

  // Somme effective (sanitize NaN/négatifs → 0).
  const totalPct = sorted.reduce(
    (sum, v) =>
      sum + (Number.isFinite(v.split_pct) ? Math.max(0, v.split_pct) : 0),
    0,
  );
  if (totalPct <= 0) return sorted[0]!;

  const bucket = hashVisitorId(visitorId); // [0, 99]
  // Normalisation : on convertit le bucket en fraction puis on parcourt en
  // cumulant la fraction normalisée des split_pct (gère sum != 100).
  const fraction = bucket / 100;

  let cumulative = 0;
  for (const v of sorted) {
    const pct = Number.isFinite(v.split_pct) ? Math.max(0, v.split_pct) : 0;
    cumulative += pct / totalPct;
    if (fraction < cumulative) return v;
  }
  // Edge : arrondi cumulative < 1 → dernière variante.
  return sorted[sorted.length - 1]!;
}

/**
 * Step minimal pour validateStepOrder (compatible FunnelStep API).
 */
export interface StepOrderInput {
  id?: string;
  order_index: number;
}

/**
 * Validation : `order_index` unique et séquentiel 0..N-1.
 *
 * Règle stricte (Sprint 44 §6) :
 *   - chaque step doit avoir un `order_index` entier.
 *   - pas de duplicate (deux steps même order_index = collision UI).
 *   - séquence continue 0..N-1 (pas de gaps).
 *
 * @returns ok=true si valide, sinon { code: DUPLICATE_ORDER_INDEX | STEP_INVALID, message }.
 */
export function validateStepOrder(steps: StepOrderInput[]): ValidationResult {
  if (!Array.isArray(steps) || steps.length === 0) return { ok: true };

  // Vérif entiers + ≥ 0.
  for (const s of steps) {
    const oi = s.order_index;
    if (!Number.isInteger(oi) || oi < 0) {
      return {
        ok: false,
        error: {
          code: FUNNEL_ERROR_CODES.STEP_INVALID,
          message: `order_index doit être un entier ≥ 0 (reçu: ${oi})`,
        },
      };
    }
  }

  // Vérif duplicates.
  const indices = steps.map((s) => s.order_index);
  const set = new Set(indices);
  if (set.size !== indices.length) {
    return {
      ok: false,
      error: {
        code: FUNNEL_ERROR_CODES.DUPLICATE_ORDER_INDEX,
        message: 'order_index dupliqué détecté (chaque étape doit avoir un index unique)',
      },
    };
  }

  // Vérif séquence continue 0..N-1.
  const sorted = [...indices].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i) {
      return {
        ok: false,
        error: {
          code: FUNNEL_ERROR_CODES.STEP_INVALID,
          message: `order_index doit être séquentiel 0..${sorted.length - 1} sans gap (manque: ${i})`,
        },
      };
    }
  }

  return { ok: true };
}

/**
 * Validation : somme `split_pct` = exactement 100, chaque ∈ [1, 99].
 *
 * Règle stricte (Sprint 44 §6) :
 *   - 0% = variante désactivée → forcer suppression côté UI (rejeter ici).
 *   - 100% = pas d'A/B test → utiliser une seule variante.
 *   - somme = 100 ± 0 (pas de tolérance flottante — split_pct est INTEGER).
 *
 * @returns ok=true si valide, sinon { code: INVALID_SPLIT, message }.
 */
export function validateSplitPct(
  variants: Array<{ split_pct: number }>,
): ValidationResult {
  if (!Array.isArray(variants) || variants.length === 0) {
    return {
      ok: false,
      error: {
        code: FUNNEL_ERROR_CODES.EMPTY_VARIANTS,
        message: 'Au moins une variante est requise',
      },
    };
  }

  // Cas court-circuit : 1 seule variante → doit être 100%.
  if (variants.length === 1) {
    const pct = variants[0]!.split_pct;
    if (pct !== 100) {
      return {
        ok: false,
        error: {
          code: FUNNEL_ERROR_CODES.INVALID_SPLIT,
          message: `Variante seule doit avoir split_pct=100 (reçu: ${pct})`,
        },
      };
    }
    return { ok: true };
  }

  // Validation per-variant : entier ∈ [1, 99].
  for (const v of variants) {
    const pct = v.split_pct;
    if (!Number.isInteger(pct) || pct < 1 || pct > 99) {
      return {
        ok: false,
        error: {
          code: FUNNEL_ERROR_CODES.INVALID_SPLIT,
          message: `split_pct doit être un entier ∈ [1, 99] (reçu: ${pct})`,
        },
      };
    }
  }

  // Validation sum = 100 exact.
  const sum = variants.reduce((acc, v) => acc + v.split_pct, 0);
  if (sum !== 100) {
    return {
      ok: false,
      error: {
        code: FUNNEL_ERROR_CODES.INVALID_SPLIT,
        message: `Somme split_pct doit être exactement 100 (reçu: ${sum})`,
      },
    };
  }

  return { ok: true };
}

/**
 * Validation : `step_type` ∈ FUNNEL_STEP_TYPES.
 *
 * Helper trivial utilisé par les handlers et par les batch-validators
 * (validateFunnelStructure futur). Court-circuit handler pour éviter le
 * INSERT D1 sur enum invalide.
 */
export function validateStepType(stepType: string): ValidationResult {
  if (!stepType || typeof stepType !== 'string') {
    return {
      ok: false,
      error: {
        code: FUNNEL_ERROR_CODES.INVALID_STEP_TYPE,
        message: 'step_type est requis',
      },
    };
  }
  if (!(FUNNEL_STEP_TYPES as readonly string[]).includes(stepType)) {
    return {
      ok: false,
      error: {
        code: FUNNEL_ERROR_CODES.INVALID_STEP_TYPE,
        message: `step_type invalide (reçu: ${stepType}, attendu: ${FUNNEL_STEP_TYPES.join('|')})`,
      },
    };
  }
  return { ok: true };
}

/**
 * Step minimal pour computeFunnelConversion (id + order_index).
 */
export interface StepIdentity {
  id: string;
  order_index: number;
}

/**
 * Vues par step (id → count).
 */
export type ViewsByStep = Map<string, number> | Record<string, number>;

/**
 * Breakdown par step retourné par computeFunnelConversion.
 */
export interface StepConversionRow {
  id: string;
  views: number;
  /** Nombre de vues sur l'étape SUIVANTE (=conversions du step courant). */
  next: number;
  /** (next/views) * 100 — % conversion vers step suivant. 0 si views=0. */
  conversion_pct: number;
}

/**
 * Résultat de computeFunnelConversion.
 */
export interface FunnelConversionResult {
  steps: StepConversionRow[];
  /** Conversion globale du funnel = (views(last) / views(first)) * 100. */
  total_conversion: number;
}

/** Petit helper : lit une map OU un record. */
function getViews(views: ViewsByStep, id: string): number {
  if (views instanceof Map) return Math.max(0, Number(views.get(id) ?? 0));
  return Math.max(0, Number((views as Record<string, number>)[id] ?? 0));
}

/**
 * Calcule la conversion d'un funnel (pure, sans D1).
 *
 * Sémantique :
 *   - on trie les steps par `order_index` ASC.
 *   - pour chaque step : `next` = views(step+1) (0 pour le dernier).
 *   - `conversion_pct` = (next / views) * 100 ; 0 si views=0.
 *   - `total_conversion` = (views(last) / views(first)) * 100.
 *
 * Distinct de `computeFunnelAnalytics` (async D1 read) — utilisable côté UI
 * dashboard sans round-trip serveur si on a déjà les counts (chart live).
 */
export function computeFunnelConversion(
  steps: StepIdentity[],
  views: ViewsByStep,
): FunnelConversionResult {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { steps: [], total_conversion: 0 };
  }

  const sorted = [...steps].sort((a, b) => a.order_index - b.order_index);
  const rows: StepConversionRow[] = sorted.map((step, idx) => {
    const v = getViews(views, step.id);
    const nextStep = sorted[idx + 1];
    const next = nextStep ? getViews(views, nextStep.id) : 0;
    const pct = v > 0 ? Math.min(100, (next / v) * 100) : 0;
    return {
      id: step.id,
      views: v,
      next,
      conversion_pct: round2(pct),
    };
  });

  const firstViews = rows[0]?.views ?? 0;
  const lastViews = rows[rows.length - 1]?.views ?? 0;
  const total = firstViews > 0 ? Math.min(100, (lastViews / firstViews) * 100) : 0;

  return {
    steps: rows,
    total_conversion: round2(total),
  };
}

/**
 * Résultat de identifyDropoff.
 */
export interface DropoffResult {
  /** id du step où l'écart absolu de views avec le suivant est le plus grand. */
  biggest_dropoff_step_id: string | null;
  /** % de drop-off (1 - next/views) * 100. 0 si views=0 ou pas de next. */
  dropoff_pct: number;
}

/**
 * Identifie l'étape où le plus gros drop-off se produit.
 *
 * Sémantique : on prend les rows de `computeFunnelConversion.steps`,
 * on calcule (1 - next/views)*100 pour chaque step ayant un next, on
 * retourne celui avec le pct de drop-off MAX (= plus gros pourcentage de
 * visiteurs perdus à cette étape).
 *
 * Cas dégénérés :
 *   - 0 ou 1 step → { null, 0 }.
 *   - tous les steps ont views=0 → { null, 0 }.
 */
export function identifyDropoff(
  conversionData: FunnelConversionResult,
): DropoffResult {
  const rows = conversionData?.steps ?? [];
  if (rows.length < 2) {
    return { biggest_dropoff_step_id: null, dropoff_pct: 0 };
  }

  let worstId: string | null = null;
  let worstPct = -1;

  for (let i = 0; i < rows.length - 1; i++) {
    const row = rows[i]!;
    if (row.views <= 0) continue;
    const dropoffPct = (1 - row.next / row.views) * 100;
    if (dropoffPct > worstPct) {
      worstPct = dropoffPct;
      worstId = row.id;
    }
  }

  if (worstId === null) {
    return { biggest_dropoff_step_id: null, dropoff_pct: 0 };
  }
  return {
    biggest_dropoff_step_id: worstId,
    dropoff_pct: round2(Math.max(0, worstPct)),
  };
}

/**
 * Conversions par step (id → count).
 */
export type ConversionsByStep = Map<string, number> | Record<string, number>;

/**
 * Segment cohort (par UTM source / device / etc.).
 */
export interface CohortSegment {
  /** Label du segment (ex: 'google', 'facebook', 'direct'). */
  key: string;
  /** Views par step pour CE segment. */
  views: ViewsByStep;
  /** Conversions par step pour CE segment (optionnel). */
  conversions?: ConversionsByStep;
}

/**
 * Analytics aggregées avec segmentation cohort optionnelle.
 */
export interface AggregatedAnalytics {
  /** Conversion globale (tous segments confondus). */
  global: FunnelConversionResult;
  /** Drop-off principal. */
  dropoff: DropoffResult;
  /** Breakdown par cohort (UTM source / device / etc.) — vide si pas fourni. */
  by_cohort: Array<{
    key: string;
    conversion: FunnelConversionResult;
    dropoff: DropoffResult;
  }>;
}

/**
 * Orchestrator : agrège conversion + dropoff + cohorts en un seul shape.
 *
 * Pure (pas de D1). Utilisable côté UI dashboard pour les charts live, ou
 * côté handler pour wrapper `computeFunnelAnalytics` (async D1) avec segments
 * supplémentaires sans round-trip multiple.
 *
 * Si `segments` est vide/non fourni → seul `global` + `dropoff` sont calculés
 * (by_cohort = []).
 *
 * NOTE: nommée `aggregateFunnelAnalytics` (pas `computeFunnelAnalytics`) pour
 * NE PAS écraser la fonction async D1 existante de même nom (load-bearing
 * dans `funnels-builder.ts` + tests). Cf. principe additif zéro régression.
 */
export function aggregateFunnelAnalytics(
  steps: StepIdentity[],
  views: ViewsByStep,
  _conversions?: ConversionsByStep,
  segments?: CohortSegment[],
): AggregatedAnalytics {
  const global = computeFunnelConversion(steps, views);
  const dropoff = identifyDropoff(global);

  const by_cohort: AggregatedAnalytics['by_cohort'] = [];
  if (Array.isArray(segments) && segments.length > 0) {
    for (const seg of segments) {
      if (!seg?.key || !seg.views) continue;
      const segConv = computeFunnelConversion(steps, seg.views);
      const segDrop = identifyDropoff(segConv);
      by_cohort.push({
        key: seg.key,
        conversion: segConv,
        dropoff: segDrop,
      });
    }
  }

  return { global, dropoff, by_cohort };
}

/** Arrondi 2 décimales (évite les flottants laids dans les API responses). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
