// ── Tax engine multi-région — Sprint 39 Phase B (2026-05-24) ───────────────
//
// Sur-couche déléguante au-dessus du moteur fiscal LEGACY
// (`src/worker/ecommerce-tax-engine.ts` — régimes 'qc'/'eu'/'dz'/'exempt').
//
// ⚠️ RÉGRESSION-ZÉRO QC/EU/DZ : ce module APPELLE computeTax() legacy quand
// `opts.region` n'est pas fourni. Pour tout subtotalCents en régime 'qc',
// la sortie reste IDENTIQUE bit-pour-bit à l'ancien code (verbatim
// TPS 0.05 + TVQ 0.09975 — calque E3 §47-49 ecommerce-tax-engine.ts).
//
// Phase B : stratégies admin-managed via TaxRegion (vat / gst_pst / sales_tax /
// tva_dz / exempt). Override par catégorie produit via TaxRule[]. Multi-ligne
// pour line items hétérogènes (chaque ligne sa catégorie, agrégation finale).
// Cascade (`compound`) : la taxe s'applique sur sub + taxes précédentes.
//
// Conventions :
//   - Pure : aucune lecture DB / réseau. Toute donnée vient des arguments
//     (TaxRegion + TaxRule[] résolus EN AMONT par le caller).
//   - Money TOUJOURS en cents (INTEGER). Math.round par taxe (PAS floor).
//   - Bornage défensif : sub < 0 / NaN ⇒ 0. Aucune taxe fantôme.
//   - Pas de champ `code` dans erreurs (alignement contrat REST projet).

import {
  computeTax,
  type TaxRegime,
  type TaxResult,
  type TaxLine,
  type ComputeTaxOpts,
} from '../ecommerce-tax-engine';
import type { TaxRegimeExt, TaxRegion, TaxRule } from '../../lib/types';

export interface ComputeTaxMultiOpts extends ComputeTaxOpts {
  /** Région fiscale admin-managed résolue (objet complet, pas le code).
   *  Si ABSENT ⇒ délégation directe au moteur legacy via `regime` (régression-zéro). */
  region?: TaxRegion;
  /** Catégorie produit pour lookup `tax_rules.product_category`. Défaut 'standard'. */
  productCategory?: string;
  /** Règles de la région (préchargées par le caller). Match par product_category. */
  rules?: TaxRule[];
  /** Lignes pour ventilation multi-catégorie (chaque ligne peut avoir SA catégorie). */
  lineItems?: { totalCents: number; productCategory?: string }[];
}

/**
 * Calcul fiscal multi-région — CONTRAT FIGÉ.
 *
 * Décision (cascade) :
 *   1. opts.region ABSENT  ⇒ délégation legacy computeTax (régression-zéro stricte).
 *   2. opts.region présent ⇒ stratégie selon region.type :
 *        - 'vat'        ⇒ TVA % unique (rates_json.vat), inclusive selon tax_inclusive
 *        - 'gst_pst'    ⇒ 2 lignes GST + PST séparées (calque QC TPS+TVQ)
 *        - 'sales_tax'  ⇒ sales tax flat US (rates_json.sales_tax), exclusive
 *        - 'tva_dz'     ⇒ TVA Algérie (rates_json.tva || 0.19)
 *        - 'exempt'     ⇒ aucune taxe
 *   3. opts.lineItems présent + opts.region ⇒ ventilation par ligne (rule par catégorie)
 *
 * Override par rule (si opts.rules fourni) :
 *   - Match exact rules.find(r => r.product_category === (opts.productCategory || 'standard'))
 *   - Si trouvé : rate par défaut de la région REMPLACÉ par rule.rate
 *   - Si rule.compound : taxe s'applique sur (sub + taxes précédentes) — cascade tier-2
 *
 * @param regime         régime fiscal ('qc'|'eu'|'dz'|'exempt'|'us_sales_tax')
 * @param subtotalCents  sous-total en cents (INTEGER, ≥ 0 attendu)
 * @param opts           { country?, taxInclusive?, lineItems?, region?, productCategory?, rules? }
 *
 * Régression-zéro QC : opts.region ABSENT + regime='qc' ⇒ sortie identique
 * bit-pour-bit à l'ancien code (computeTax legacy invoquée verbatim).
 */
export function computeTaxMulti(
  regime: TaxRegimeExt,
  subtotalCents: number,
  opts: ComputeTaxMultiOpts = {},
): TaxResult {
  // ── 1) Pas de région admin-managed : délégation legacy stricte ───────────
  // Régression-zéro garantie pour QC/EU/DZ/exempt (bit-pour-bit).
  if (!opts.region) {
    if (regime === 'qc' || regime === 'eu' || regime === 'dz' || regime === 'exempt') {
      return computeTax(regime as TaxRegime, subtotalCents, opts);
    }
    // 'us_sales_tax' sans région admin ⇒ exonéré (sécurité défensive : jamais
    // de taxe fantôme — la stratégie sales_tax exige une TaxRegion).
    return { lines: [], totalTaxCents: 0, taxInclusive: false };
  }

  // ── 2) Région admin-managed présente ────────────────────────────────────
  const region = opts.region;
  const sub = Math.max(0, Math.round(subtotalCents || 0));

  // Multi-ligne : ventilation par catégorie (chaque ligne peut matcher SA rule).
  if (Array.isArray(opts.lineItems) && opts.lineItems.length > 0) {
    return computeMultiLine(region, opts.lineItems, opts.rules, opts);
  }

  // Ligne unique : compute selon stratégie + override rule globale éventuelle.
  return computeSingle(region, sub, opts.productCategory, opts.rules, opts);
}

// ── Stratégies par region.type ────────────────────────────────────────────

/**
 * Compute UNE ligne selon region.type + rule override éventuelle.
 * Renvoie un TaxResult complet (lines + total + taxInclusive).
 */
function computeSingle(
  region: TaxRegion,
  sub: number,
  productCategory: string | undefined,
  rules: TaxRule[] | undefined,
  opts: ComputeTaxMultiOpts,
): TaxResult {
  const inclusive = resolveInclusive(region, opts);
  const matched = matchRule(rules, productCategory);

  switch (region.type) {
    case 'vat': {
      const rate = matched ? matched.rate : (region.rates_json.vat ?? 0);
      const base = matched?.compound ? sub /* + 0 (pas de taxe précédente en single) */ : sub;
      const amountCents = computeAmount(base, rate, inclusive);
      const label = region.country_subdiv
        ? `VAT (${region.country_subdiv})`
        : `VAT (${region.country || ''})`.trim();
      return {
        lines: [{ label, rate, amountCents }],
        totalTaxCents: amountCents,
        taxInclusive: inclusive,
      };
    }

    case 'gst_pst': {
      // Multi-ligne GST + PST séparées (calque QC TPS+TVQ, arrondi SÉPARÉ).
      // Si rule match : applique rule.rate UNIQUEMENT à GST (heuristique simple :
      // un override par catégorie remplace la fiscalité fédérale principale).
      const gstRate = matched ? matched.rate : (region.rates_json.gst ?? 0);
      const pstRate = region.rates_json.pst ?? 0;
      const lines: TaxLine[] = [];
      let totalTaxCents = 0;

      if (gstRate > 0) {
        const gstCents = computeAmount(sub, gstRate, inclusive);
        lines.push({ label: 'GST', rate: gstRate, amountCents: gstCents });
        totalTaxCents += gstCents;
      }
      if (pstRate > 0) {
        // PST compound : s'applique sur sub + GST (rare, ex QC pré-2013).
        const pstBase = matched?.compound ? sub + totalTaxCents : sub;
        const pstCents = computeAmount(pstBase, pstRate, inclusive);
        lines.push({ label: 'PST', rate: pstRate, amountCents: pstCents });
        totalTaxCents += pstCents;
      }
      return { lines, totalTaxCents, taxInclusive: inclusive };
    }

    case 'sales_tax': {
      // Sales tax US flat (state-level — county/city aggregation = future). Exclusive.
      const rate = matched ? matched.rate : (region.rates_json.sales_tax ?? 0);
      const amountCents = computeAmount(sub, rate, inclusive);
      const subdiv = region.country_subdiv || region.country || '';
      const label = `Sales tax${subdiv ? ` ${subdiv}` : ''}`;
      return {
        lines: [{ label, rate, amountCents }],
        totalTaxCents: amountCents,
        taxInclusive: inclusive,
      };
    }

    case 'tva_dz': {
      // TVA Algérie : 19% par défaut (rates_json.tva override possible).
      const rate = matched ? matched.rate : (region.rates_json.tva ?? 0.19);
      const amountCents = computeAmount(sub, rate, inclusive);
      return {
        lines: [{ label: 'TVA', rate, amountCents }],
        totalTaxCents: amountCents,
        taxInclusive: inclusive,
      };
    }

    case 'exempt':
      return { lines: [], totalTaxCents: 0, taxInclusive: false };

    default:
      // Type inconnu : sécurité défensive ⇒ exonéré (jamais de taxe fantôme).
      return { lines: [], totalTaxCents: 0, taxInclusive: false };
  }
}

/**
 * Ventilation multi-ligne : compute par line item, agrège les TaxLines par label,
 * somme les totalTaxCents. taxInclusive reflète la région.
 *
 * Chaque line item peut avoir SA propre productCategory ⇒ SA propre rule match.
 * Round PAR ligne (cohérent avec l'arrondi-au-cent des e-commerces) puis somme.
 */
function computeMultiLine(
  region: TaxRegion,
  lineItems: { totalCents: number; productCategory?: string }[],
  rules: TaxRule[] | undefined,
  opts: ComputeTaxMultiOpts,
): TaxResult {
  const inclusive = resolveInclusive(region, opts);
  const aggregated = new Map<string, TaxLine>();
  let totalTaxCents = 0;

  for (const item of lineItems) {
    const itemSub = Math.max(0, Math.round(item.totalCents || 0));
    if (itemSub === 0) continue;
    const sub = computeSingle(region, itemSub, item.productCategory, rules, opts);
    totalTaxCents += sub.totalTaxCents;
    for (const line of sub.lines) {
      const existing = aggregated.get(line.label);
      if (existing) {
        // Agrège par label : somme amountCents. Conserve le rate du premier
        // match (les rates hétérogènes par catégorie sont représentés via
        // plusieurs lignes au label distinct si nécessaire — ici on consolide).
        existing.amountCents += line.amountCents;
      } else {
        aggregated.set(line.label, { ...line });
      }
    }
  }

  return {
    lines: Array.from(aggregated.values()),
    totalTaxCents,
    taxInclusive: inclusive,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Résout si la fiscalité est inclusive : override explicite opts > flag région.
 * Aligné avec computeEu legacy (inclusive par défaut UE), exclusive pour US/QC/DZ.
 */
function resolveInclusive(region: TaxRegion, opts: ComputeTaxMultiOpts): boolean {
  if (opts.taxInclusive !== undefined) return opts.taxInclusive;
  return region.tax_inclusive === true;
}

/**
 * Calcule le montant de taxe en cents selon le mode (inclusive vs exclusive).
 * - exclusive : amount = round(base * rate)
 * - inclusive : amount = round(base − base / (1 + rate))   ← extraction
 * Round (PAS floor), aligné convention projet + computeEu legacy.
 */
function computeAmount(base: number, rate: number, inclusive: boolean): number {
  if (!rate || rate <= 0) return 0;
  if (inclusive) {
    return Math.round(base - base / (1 + rate));
  }
  return Math.round(base * rate);
}

/**
 * Cherche une rule matchant la productCategory (défaut 'standard').
 * Renvoie undefined si pas de rules ou pas de match (⇒ rate par défaut région).
 */
function matchRule(
  rules: TaxRule[] | undefined,
  productCategory: string | undefined,
): TaxRule | undefined {
  if (!Array.isArray(rules) || rules.length === 0) return undefined;
  const cat = productCategory || 'standard';
  return rules.find((r) => r.product_category === cat);
}
