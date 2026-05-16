// ── Moteur de taxes pluggable — Sprint E-R M1 (2026-05-16) ───────────────────
//
// Source UNIQUE du calcul fiscal du module Boutique (B2). Remplace les
// formules dupliquées (ecommerce-orders.ts, ecommerce-cart.ts) par un moteur
// pur, sans I/O, testable et consommable par M2/M3.
//
// ⚠️ RÉGRESSION-ZÉRO QUÉBEC : la stratégie 'qc' est un wrapper VERBATIM du
// calcul historique de createOrderCore (TPS 0.05 + TVQ 0.09975, chacune
// arrondie SÉPARÉMENT sur le sous-total, JAMAIS en cascade). Pour tout
// subtotalCents, la sortie est IDENTIQUE bit-pour-bit à l'ancien code.
// Réplique exacte de la logique Invoices.tsx (14.975% = 5% + 9.975%).
//
// Conventions strictes du projet :
//  - Money TOUJOURS en cents (INTEGER). `Math.round` par taxe.
//  - Pur : aucune lecture DB / réseau. Toute donnée vient des arguments.
//
// Régimes :
//  - 'qc'     : TPS 5% + TVQ 9.975% séparés, tax-EXCLUSIVE (verbatim E3).
//  - 'eu'     : TVA par pays destination, tax-INCLUSIVE (prix TTC), hooks
//               OSS/IOSS structurés (implémentation complète différée).
//  - 'dz'     : TVA 19% (+ TAP optionnel structuré), tax-EXCLUSIVE.
//  - 'exempt' : 0 taxe, lines vide.

export type TaxRegime = 'qc' | 'eu' | 'dz' | 'exempt';

export interface TaxLine {
  label: string;
  rate: number;
  amountCents: number;
}

export interface TaxResult {
  lines: TaxLine[];
  totalTaxCents: number;
  taxInclusive: boolean;
}

export interface ComputeTaxOpts {
  /** ISO 3166-1 alpha-2 du pays destination (UE : détermine le taux). */
  country?: string;
  /** Override explicite : true = prix TTC (taxe incluse), false = HT. */
  taxInclusive?: boolean;
  /** Lignes de la commande (réservé OSS/IOSS UE : ventilation par taux). */
  lineItems?: { totalCents: number }[];
}

// ── Constantes QC — verbatim ecommerce-orders.ts (NE PAS modifier) ───────────
const QC_TPS_RATE = 0.05;
const QC_TVQ_RATE = 0.09975;

// ── Table statique TVA UE par pays destination (taux standard, %) ────────────
// Source : taux standards UE. Le défaut 20% couvre tout pays non listé.
// OSS/IOSS : la TVA due est celle du pays de DESTINATION (B2C intra-UE).
const EU_VAT_RATES: Record<string, number> = {
  AT: 0.20, // Autriche
  BE: 0.21, // Belgique
  BG: 0.20, // Bulgarie
  HR: 0.25, // Croatie
  CY: 0.19, // Chypre
  CZ: 0.21, // Tchéquie
  DK: 0.25, // Danemark
  EE: 0.22, // Estonie
  FI: 0.255, // Finlande
  FR: 0.20, // France
  DE: 0.19, // Allemagne
  GR: 0.24, // Grèce
  HU: 0.27, // Hongrie
  IE: 0.23, // Irlande
  IT: 0.22, // Italie
  LV: 0.21, // Lettonie
  LT: 0.21, // Lituanie
  LU: 0.17, // Luxembourg
  MT: 0.18, // Malte
  NL: 0.21, // Pays-Bas
  PL: 0.23, // Pologne
  PT: 0.23, // Portugal
  RO: 0.19, // Roumanie
  SK: 0.23, // Slovaquie
  SI: 0.22, // Slovénie
  ES: 0.21, // Espagne
  SE: 0.25, // Suède
};
const EU_VAT_DEFAULT = 0.20;

// ── Constantes DZ (Algérie) ──────────────────────────────────────────────────
const DZ_TVA_RATE = 0.19;
// TAP (Taxe sur l'Activité Professionnelle) — structure prête, désactivée par
// défaut (s'applique au commerçant, pas systématiquement à la facture client).
const DZ_TAP_RATE = 0.02;
const DZ_TAP_ENABLED = false;

/**
 * QC — wrapper VERBATIM du calcul historique createOrderCore.
 * tps = round(sub * 0.05), tvq = round(sub * 0.09975), chacune séparément.
 * tax-EXCLUSIVE (prix HT, taxes ajoutées au total).
 */
function computeQc(subtotalCents: number): TaxResult {
  const tpsCents = Math.round(subtotalCents * QC_TPS_RATE);
  const tvqCents = Math.round(subtotalCents * QC_TVQ_RATE);
  return {
    lines: [
      { label: 'TPS', rate: QC_TPS_RATE, amountCents: tpsCents },
      { label: 'TVQ', rate: QC_TVQ_RATE, amountCents: tvqCents },
    ],
    totalTaxCents: tpsCents + tvqCents,
    taxInclusive: false,
  };
}

/**
 * UE — TVA du pays de DESTINATION. Tax-INCLUSIVE par défaut (prix affichés
 * TTC en UE) : la part de taxe est extraite du sous-total.
 *   taxIncluse = round(sub - sub / (1 + rate))
 * Override `taxInclusive=false` possible (B2B HT). Hooks OSS/IOSS : la
 * ventilation par taux/pays se fait via `lineItems` (chaque ligne pouvant à
 * terme cibler un pays distinct). Implémentation multi-taux complète différée :
 * ici un taux unique par commande (pays destination), signature en place.
 */
function computeEu(
  subtotalCents: number,
  country: string | undefined,
  taxInclusive: boolean,
): TaxResult {
  const cc = (country || '').toUpperCase();
  const rate = EU_VAT_RATES[cc] ?? EU_VAT_DEFAULT;

  // ── Hook OSS/IOSS (différé) ────────────────────────────────────────────
  // Quand le guichet OSS/IOSS sera activé : ventiler `lineItems` par taux de
  // destination et émettre une TaxLine par taux. Pour l'instant : taux unique
  // du pays destination appliqué au sous-total agrégé (structure prête).

  let amountCents: number;
  if (taxInclusive) {
    // Prix TTC : on extrait la part de TVA déjà comprise dans le sous-total.
    amountCents = Math.round(subtotalCents - subtotalCents / (1 + rate));
  } else {
    // Prix HT : TVA ajoutée par-dessus.
    amountCents = Math.round(subtotalCents * rate);
  }

  return {
    lines: [
      { label: `TVA (${cc || 'UE'})`, rate, amountCents },
    ],
    totalTaxCents: amountCents,
    taxInclusive,
  };
}

/**
 * DZ (Algérie) — TVA 19% tax-EXCLUSIVE (prix HT, TVA ajoutée). TAP 2%
 * structuré mais désactivé par défaut (DZ_TAP_ENABLED). Round par taxe.
 */
function computeDz(subtotalCents: number): TaxResult {
  const tvaCents = Math.round(subtotalCents * DZ_TVA_RATE);
  const lines: TaxLine[] = [
    { label: 'TVA', rate: DZ_TVA_RATE, amountCents: tvaCents },
  ];
  let totalTaxCents = tvaCents;

  if (DZ_TAP_ENABLED) {
    const tapCents = Math.round(subtotalCents * DZ_TAP_RATE);
    lines.push({ label: 'TAP', rate: DZ_TAP_RATE, amountCents: tapCents });
    totalTaxCents += tapCents;
  }

  return { lines, totalTaxCents, taxInclusive: false };
}

/** Régime exonéré — aucune taxe. */
function computeExempt(): TaxResult {
  return { lines: [], totalTaxCents: 0, taxInclusive: false };
}

/**
 * Calcul fiscal central — CONTRAT FIGÉ (M2/M3 le consomment).
 *
 * @param regime        'qc' | 'eu' | 'dz' | 'exempt'
 * @param subtotalCents sous-total en cents (INTEGER, ≥ 0 attendu)
 * @param opts          { country?, taxInclusive?, lineItems? }
 *
 * QC ⇒ lines:[{label:'TPS',rate:0.05,amountCents:round(sub*0.05)},
 *              {label:'TVQ',rate:0.09975,amountCents:round(sub*0.09975)}],
 *      taxInclusive:false  (IDENTIQUE bit-pour-bit à l'ancien createOrderCore)
 */
export function computeTax(
  regime: TaxRegime,
  subtotalCents: number,
  opts: ComputeTaxOpts = {},
): TaxResult {
  const sub = Math.max(0, Math.round(subtotalCents || 0));
  switch (regime) {
    case 'qc':
      return computeQc(sub);
    case 'eu': {
      // UE : tax-inclusive par défaut (prix TTC affichés en UE), override possible.
      const inclusive = opts.taxInclusive !== undefined ? opts.taxInclusive : true;
      return computeEu(sub, opts.country, inclusive);
    }
    case 'dz':
      return computeDz(sub);
    case 'exempt':
      return computeExempt();
    default:
      // Régime inconnu : sécurité défensive → exonéré (jamais de taxe fantôme).
      return computeExempt();
  }
}
