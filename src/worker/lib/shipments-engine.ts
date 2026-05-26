// ── Shipments engine — Sprint E5 helpers PURS (2026-05-26) ─────────────────
//
// Helpers PURS (zéro I/O, zéro D1, zéro mock) pour renforcer la validation
// d'expéditions e-commerce. Additif : NE remplace PAS la logique handler
// existante (ecommerce-shipments.ts), il fournit des bricks réutilisables
// importables côté handler ET côté tests.
//
// Conventions :
//   - Aucune dépendance Env / D1.
//   - Aucun side-effect (pas de crypto, pas de fetch).
//   - Discriminated unions {ok, error?, field?} pour erreurs typées stables.
//   - Tracking number regex calqués sur les patterns publics des opérateurs
//     UPS/FedEx/Canada Post/DHL. Heuristique permissive (false positive < false
//     negative — un format inconnu/exotique ne doit pas bloquer un envoi).

// ── Codes erreur stables (export pour assertions tests + handlers) ───────────

export const SHIPMENT_ERROR_CODES = {
  INVALID_PROVIDER: 'invalid_provider',
  INVALID_STATUS: 'invalid_status',
  INVALID_TRACKING: 'invalid_tracking',
  MISSING_TRACKING: 'missing_tracking',
  INVALID_ETA: 'invalid_eta',
  EMPTY_ITEMS: 'empty_items',
  INVALID_ITEM: 'invalid_item',
} as const;

export type ShipmentErrorCode =
  (typeof SHIPMENT_ERROR_CODES)[keyof typeof SHIPMENT_ERROR_CODES];

// ── Providers + statuses connus (alignés ecommerce-shipments.ts machine) ────-

export const VALID_PROVIDERS = [
  'ups',
  'fedex',
  'canada_post',
  'dhl',
  'purolator',
  'usps',
  'generic',
] as const;

export type ShipmentProvider = (typeof VALID_PROVIDERS)[number];

export const VALID_STATUSES = [
  'preparing',
  'shipped',
  'in_transit',
  'delivered',
  'failed',
] as const;

export type ShipmentEngineStatus = (typeof VALID_STATUSES)[number];

// ── Helpers introspection (string → boolean) ─────────────────────────────────

/** Vrai si le provider est dans la whitelist (case-insensitive). */
export function isValidProvider(p: unknown): p is ShipmentProvider {
  if (typeof p !== 'string') return false;
  return (VALID_PROVIDERS as readonly string[]).includes(p.toLowerCase());
}

/** Vrai si le status est dans la whitelist (case-insensitive). */
export function isValidStatus(s: unknown): s is ShipmentEngineStatus {
  if (typeof s !== 'string') return false;
  return (VALID_STATUSES as readonly string[]).includes(s.toLowerCase());
}

// ── Tracking number validation par provider ─────────────────────────────────-

/**
 * Valide un tracking number selon le format publique du provider.
 *
 * Heuristiques (intentionnellement permissives — refuse seulement les formats
 * clairement invalides type "abc" ou ascii < 8 chars) :
 *   - ups          : commence par `1Z` + 16 alphanum (total 18).
 *   - fedex        : 12 chiffres OU 15 chiffres (ground / express).
 *   - canada_post  : 16 alphanum (ex: 1234 5678 9012 3456) ou 13 alphanum + lettres.
 *   - dhl          : 10 ou 11 chiffres.
 *   - purolator    : 10 ou 12 chiffres OU "PI" + 8-10 chiffres.
 *   - usps         : 20 à 22 chiffres (typique tracking USPS).
 *   - generic      : 8-40 caractères alphanum/dashes (catch-all permissif).
 */
export function validateTrackingNumber(
  provider: unknown,
  tracking: unknown,
): boolean {
  if (typeof tracking !== 'string') return false;
  const tn = tracking.trim().toUpperCase().replace(/[\s-]/g, '');
  if (tn.length < 6 || tn.length > 40) return false;

  const prov =
    typeof provider === 'string' ? provider.toLowerCase() : 'generic';

  switch (prov) {
    case 'ups':
      return /^1Z[0-9A-Z]{16}$/.test(tn);
    case 'fedex':
      return /^[0-9]{12}$/.test(tn) || /^[0-9]{15}$/.test(tn);
    case 'canada_post':
      // 16 alphanum (numérique pur) OU 13 chars avec lettres+chiffres.
      return /^[0-9]{16}$/.test(tn) || /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/.test(tn);
    case 'dhl':
      return /^[0-9]{10}$/.test(tn) || /^[0-9]{11}$/.test(tn);
    case 'purolator':
      return /^[0-9]{10}$/.test(tn) || /^[0-9]{12}$/.test(tn) || /^PI[0-9]{8,10}$/.test(tn);
    case 'usps':
      return /^[0-9]{20,22}$/.test(tn);
    case 'generic':
    default:
      return /^[0-9A-Z]{6,40}$/.test(tn);
  }
}

// ── ETA computation ─────────────────────────────────────────────────────────-

/**
 * Calcule l'ETA d'un shipment à partir de la date d'expédition + nombre de
 * jours ouvrables estimés par le provider.
 *
 * Retourne null si entrée invalide (anti-NaN dans la chaîne).
 */
export function computeETA(
  shippedAt: Date | string | null,
  providerETADays: number,
): Date | null {
  if (shippedAt == null) return null;
  if (!Number.isFinite(providerETADays) || providerETADays < 0 || providerETADays > 365) {
    return null;
  }
  const base = shippedAt instanceof Date ? shippedAt : new Date(shippedAt);
  if (Number.isNaN(base.getTime())) return null;
  const out = new Date(base.getTime());
  out.setUTCDate(out.getUTCDate() + Math.round(providerETADays));
  return out;
}

// ── Shipment input validation (création) ────────────────────────────────────-

export interface ShipmentInput {
  provider?: unknown;
  tracking_number?: unknown;
  tracking_url?: unknown;
  items?: unknown;
  status?: unknown;
}

export type ShipmentValidationResult =
  | { ok: true }
  | { ok: false; error: string; field: string; code: ShipmentErrorCode };

/**
 * Valide un input de création/maj d'expédition côté API.
 *
 * - provider : optionnel — si fourni, doit être dans VALID_PROVIDERS.
 * - tracking_number : optionnel — si fourni, doit être un format provider-valide.
 * - items : si fourni, array non-vide d'objets avec order_item_id (string) +
 *   quantity (int ≥ 1).
 * - status : optionnel — si fourni, doit être dans VALID_STATUSES.
 *
 * Multi-tenant : aucune vérif client_id ici (helpers PURS) — le handler
 * conserve la responsabilité du gating tenant.
 */
export function validateShipmentInput(
  input: ShipmentInput,
): ShipmentValidationResult {
  if (input == null || typeof input !== 'object') {
    return {
      ok: false,
      error: 'Body invalide',
      field: '_body',
      code: SHIPMENT_ERROR_CODES.INVALID_ITEM,
    };
  }

  if (input.provider !== undefined && input.provider !== null) {
    if (!isValidProvider(input.provider)) {
      return {
        ok: false,
        error: `Provider d'expédition inconnu : ${String(input.provider)}`,
        field: 'provider',
        code: SHIPMENT_ERROR_CODES.INVALID_PROVIDER,
      };
    }
  }

  if (input.status !== undefined && input.status !== null) {
    if (!isValidStatus(input.status)) {
      return {
        ok: false,
        error: `Statut d'expédition inconnu : ${String(input.status)}`,
        field: 'status',
        code: SHIPMENT_ERROR_CODES.INVALID_STATUS,
      };
    }
  }

  if (input.tracking_number !== undefined && input.tracking_number !== null && input.tracking_number !== '') {
    const ok = validateTrackingNumber(
      input.provider ?? 'generic',
      input.tracking_number,
    );
    if (!ok) {
      return {
        ok: false,
        error: 'Format de tracking number invalide pour ce transporteur.',
        field: 'tracking_number',
        code: SHIPMENT_ERROR_CODES.INVALID_TRACKING,
      };
    }
  }

  if (input.items !== undefined) {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      return {
        ok: false,
        error: 'Précise au moins une ligne à expédier.',
        field: 'items',
        code: SHIPMENT_ERROR_CODES.EMPTY_ITEMS,
      };
    }
    for (let i = 0; i < input.items.length; i++) {
      const raw = input.items[i] as { order_item_id?: unknown; quantity?: unknown };
      const oid = typeof raw?.order_item_id === 'string' ? raw.order_item_id.trim() : '';
      const qty = Math.round(Number(raw?.quantity) || 0);
      if (!oid || qty < 1) {
        return {
          ok: false,
          error: `Ligne ${i + 1} invalide : order_item_id + quantity ≥ 1 requis.`,
          field: `items[${i}]`,
          code: SHIPMENT_ERROR_CODES.INVALID_ITEM,
        };
      }
    }
  }

  return { ok: true };
}
