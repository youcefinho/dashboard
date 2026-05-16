// ── Config région boutique — Sprint E-R M2 (2026-05-16) ─────────────────────
//
// Porte la configuration RÉGION/PAYS/DEVISE/RÉGIME FISCAL au niveau du tenant
// (table `clients`, colonnes ajoutées par migration-sprintER-m2.sql) et
// l'expose :
//   - GET  /api/ecommerce/region  → config résolue du tenant courant
//   - PUT  /api/ecommerce/region  → maj (admin only, valeurs validées)
//   - resolveRegionContext(env, clientId) → contexte consommable par le
//     backend commande (M1) pour résoudre regime/country/currency au lieu
//     d'un défaut 'qc' codé en dur.
//
// Conventions strictes du projet :
//   - Multi-tenant STRICT : clientId résolu via getClientModules (pattern
//     projet, jamais de fuite cross-tenant) — cf. ecommerce-orders.ts.
//   - Gating requireModule('ecommerce') géré AMONT par src/worker.ts (bloc
//     /api/ecommerce/* gated globalement) ; PUT exige en plus role admin.
//   - Additif / non destructif : RÉTRO-COMPAT TOTALE — défauts Québec
//     (region 'QC', country 'CA', currency 'CAD', tax_regime 'qc') ⇒ tout
//     client pré-existant reste strictement Québec (régression-zéro).
//   - Aucune logique fiscale ici : le calcul reste l'unique responsabilité
//     du moteur M1 (ecommerce-tax-engine.ts). On ne fournit QUE le contexte.
//
// legal_flags_json : FLAGS uniquement (loi25/rgpd/casl/conso_dz). Aucune
// implémentation légale (vient Sprint E6) — get/set structurés seulement.

import type { Env } from './types';
import type {
  TaxRegime,
  SupportedCurrency,
  CountryCode,
  LegalFlags,
  RegionConfig,
  RegionContext,
} from '../lib/types';
import { json } from './helpers';
import { getClientModules } from './modules';

type Auth = { userId: string; role: string };

// ── Référentiels figés ───────────────────────────────────────────────────────

const VALID_REGIMES: TaxRegime[] = ['qc', 'eu', 'dz', 'exempt'];
const VALID_CURRENCIES: SupportedCurrency[] = ['CAD', 'EUR', 'DZD'];

/** Défauts Québec — utilisés si colonnes absentes/NULL (rétro-compat E1). */
const DEFAULT_REGION = 'QC';
const DEFAULT_COUNTRY: CountryCode = 'CA';
const DEFAULT_CURRENCY: SupportedCurrency = 'CAD';
const DEFAULT_REGIME: TaxRegime = 'qc';

/**
 * Formats locaux par pays (ISO alpha-2). Statique, sans I/O. Consommable par
 * l'UI boutique (M3) pour ordonner les champs d'adresse / formater le tél.
 * `currency` = devise par défaut indicative du pays (ne supplante PAS la
 * config tenant explicite, sert de fallback de résolution).
 */
export interface CountryFormat {
  /** Ordre d'affichage des champs d'adresse pour ce pays. */
  address_order: string[];
  /** Indicatif téléphonique international (ex '+1'). */
  phone_prefix: string;
  /** Masque indicatif du format national (purement informatif UI). */
  phone_format: string;
  /** Devise par défaut indicative du pays. */
  currency: SupportedCurrency;
  /** Régime fiscal par défaut indicatif du pays (aligné moteur M1). */
  default_regime: TaxRegime;
}

export const COUNTRY_FORMATS: Record<string, CountryFormat> = {
  CA: {
    address_order: ['line1', 'line2', 'city', 'province', 'postal_code', 'country'],
    phone_prefix: '+1',
    phone_format: '(###) ###-####',
    currency: 'CAD',
    default_regime: 'qc',
  },
  FR: {
    address_order: ['line1', 'line2', 'postal_code', 'city', 'country'],
    phone_prefix: '+33',
    phone_format: '## ## ## ## ##',
    currency: 'EUR',
    default_regime: 'eu',
  },
  DZ: {
    address_order: ['line1', 'line2', 'city', 'wilaya', 'postal_code', 'country'],
    phone_prefix: '+213',
    phone_format: '## ## ## ## ##',
    currency: 'DZD',
    default_regime: 'dz',
  },
};

/** Fallback de format quand le pays n'est pas dans la table (≈ format CA). */
export const FALLBACK_COUNTRY_FORMAT: CountryFormat = COUNTRY_FORMATS.CA!;

/** Format d'un pays (jamais d'erreur : fallback déterministe). */
export function getCountryFormat(country: string | null | undefined): CountryFormat {
  const cc = (country || '').toUpperCase();
  return COUNTRY_FORMATS[cc] ?? FALLBACK_COUNTRY_FORMAT;
}

// ── Drapeaux légaux (get/set structurés — FLAGS uniquement) ──────────────────

/** Parse safe de legal_flags_json. Tolère null / JSON invalide / clés inconnues. */
export function parseLegalFlags(raw: string | null | undefined): LegalFlags {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    const out: LegalFlags = {};
    if (typeof obj.loi25 === 'boolean') out.loi25 = obj.loi25;
    if (typeof obj.rgpd === 'boolean') out.rgpd = obj.rgpd;
    if (typeof obj.casl === 'boolean') out.casl = obj.casl;
    if (typeof obj.conso_dz === 'boolean') out.conso_dz = obj.conso_dz;
    return out;
  } catch {
    return {};
  }
}

/** Sérialise les flags (clés booléennes connues uniquement). */
export function serializeLegalFlags(flags: LegalFlags | null | undefined): string {
  const f = flags || {};
  const out: LegalFlags = {};
  if (typeof f.loi25 === 'boolean') out.loi25 = f.loi25;
  if (typeof f.rgpd === 'boolean') out.rgpd = f.rgpd;
  if (typeof f.casl === 'boolean') out.casl = f.casl;
  if (typeof f.conso_dz === 'boolean') out.conso_dz = f.conso_dz;
  return JSON.stringify(out);
}

/**
 * Flags légaux par défaut selon le régime (utilisés si legal_flags_json NULL).
 * FLAGS uniquement — aucune logique légale (impl. Sprint E6).
 */
function defaultLegalFlags(regime: TaxRegime): LegalFlags {
  switch (regime) {
    case 'qc':
      return { loi25: true, casl: true };
    case 'eu':
      return { rgpd: true };
    case 'dz':
      return { conso_dz: true };
    default:
      return {};
  }
}

// ── Résolution ───────────────────────────────────────────────────────────────

interface ClientRegionRow {
  region: string | null;
  country: string | null;
  default_currency: string | null;
  tax_regime: string | null;
  legal_flags_json: string | null;
}

function coerceRegime(raw: string | null | undefined): TaxRegime {
  const v = (raw || '').toLowerCase().trim();
  return (VALID_REGIMES as string[]).includes(v) ? (v as TaxRegime) : DEFAULT_REGIME;
}

function coerceCurrency(raw: string | null | undefined): SupportedCurrency {
  const v = (raw || '').toUpperCase().trim();
  return (VALID_CURRENCIES as string[]).includes(v)
    ? (v as SupportedCurrency)
    : DEFAULT_CURRENCY;
}

/**
 * Lit la config région brute du tenant (défauts Québec si colonnes/valeurs
 * absentes). Défensif : SELECT colonne par colonne tolérant (toute commande
 * antérieure à la migration M2 ⇒ NULL ⇒ défauts QC ⇒ régression-zéro).
 */
async function loadClientRegion(
  env: Env,
  clientId: string,
): Promise<RegionConfig> {
  const row = (await env.DB.prepare(
    'SELECT region, country, default_currency, tax_regime, legal_flags_json FROM clients WHERE id = ?',
  )
    .bind(clientId)
    .first()) as ClientRegionRow | null;

  const region = row?.region || DEFAULT_REGION;
  const country = (row?.country || DEFAULT_COUNTRY) as CountryCode;
  const currency = coerceCurrency(row?.default_currency);
  const tax_regime = coerceRegime(row?.tax_regime);
  const legal_flags = row?.legal_flags_json
    ? parseLegalFlags(row.legal_flags_json)
    : defaultLegalFlags(tax_regime);

  return { region, country, currency, tax_regime, legal_flags };
}

/**
 * Contexte région consommable par le BACKEND COMMANDE (M1). Exposé proprement :
 * M1 peut résoudre regime/country/currency via ce helper plutôt qu'un défaut
 * 'qc' codé en dur. `tax_inclusive_default` cohérent moteur M1 : true UE
 * (prix TTC), false QC/DZ (prix HT) / exempt sans objet (false).
 */
export async function resolveRegionContext(
  env: Env,
  clientId: string,
): Promise<RegionContext> {
  const cfg = await loadClientRegion(env, clientId);
  return {
    region: cfg.region,
    country: cfg.country,
    currency: cfg.currency,
    tax_regime: cfg.tax_regime,
    tax_inclusive_default: cfg.tax_regime === 'eu',
  };
}

// ── Endpoints ────────────────────────────────────────────────────────────────

async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

/**
 * GET /api/ecommerce/region — config région résolue du tenant courant.
 * Contrat figé : {region, country, currency, tax_regime, legal_flags}.
 */
export async function handleGetRegion(env: Env, auth: Auth): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const cfg = await loadClientRegion(env, clientId);
  return json({ data: cfg });
}

/**
 * PUT /api/ecommerce/region — maj de la config région (ADMIN uniquement).
 * Body : {region?, country?, currency?, tax_regime?, legal_flags?}.
 * Validation stricte : tax_regime ∈ enum, currency ∈ enum, country ISO basique.
 * Champs absents = inchangés (patch partiel non destructif).
 */
export async function handleUpdateRegion(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json(
      { error: 'Non autorisé', message: 'Action réservée aux administrateurs.' },
      403,
    );
  }

  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: {
    region?: string;
    country?: string;
    currency?: string;
    tax_regime?: string;
    legal_flags?: LegalFlags;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const current = await loadClientRegion(env, clientId);

  // tax_regime — validation enum stricte (aligné moteur M1).
  let nextRegime = current.tax_regime;
  if (body.tax_regime !== undefined) {
    const r = String(body.tax_regime).toLowerCase().trim();
    if (!(VALID_REGIMES as string[]).includes(r)) {
      return json(
        { error: 'Régime invalide', message: "tax_regime doit être 'qc', 'eu', 'dz' ou 'exempt'." },
        400,
      );
    }
    nextRegime = r as TaxRegime;
  }

  // currency — validation enum stricte.
  let nextCurrency = current.currency;
  if (body.currency !== undefined) {
    const c = String(body.currency).toUpperCase().trim();
    if (!(VALID_CURRENCIES as string[]).includes(c)) {
      return json(
        { error: 'Devise invalide', message: "currency doit être 'CAD', 'EUR' ou 'DZD'." },
        400,
      );
    }
    nextCurrency = c as SupportedCurrency;
  }

  // country — ISO 3166-1 alpha-2 basique (2 lettres).
  let nextCountry = current.country;
  if (body.country !== undefined) {
    const cc = String(body.country).toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(cc)) {
      return json(
        { error: 'Pays invalide', message: 'country doit être un code ISO 3166-1 alpha-2 (2 lettres).' },
        400,
      );
    }
    nextCountry = cc as CountryCode;
  }

  // region — libre (texte court non vide si fourni).
  let nextRegion = current.region;
  if (body.region !== undefined) {
    const reg = String(body.region).trim();
    if (!reg || reg.length > 32) {
      return json(
        { error: 'Région invalide', message: 'region doit être un libellé court non vide.' },
        400,
      );
    }
    nextRegion = reg;
  }

  // legal_flags — FLAGS uniquement (pas d'implémentation légale).
  const nextFlags = body.legal_flags
    ? { ...current.legal_flags, ...parseLegalFlags(serializeLegalFlags(body.legal_flags)) }
    : current.legal_flags;

  await env.DB.prepare(
    "UPDATE clients SET region = ?, country = ?, default_currency = ?, tax_regime = ?, legal_flags_json = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(
      nextRegion,
      nextCountry,
      nextCurrency,
      nextRegime,
      serializeLegalFlags(nextFlags),
      clientId,
    )
    .run();

  const updated: RegionConfig = {
    region: nextRegion,
    country: nextCountry,
    currency: nextCurrency,
    tax_regime: nextRegime,
    legal_flags: nextFlags,
  };
  return json({ data: updated });
}
