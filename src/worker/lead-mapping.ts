// ── Sprint 51 M2 — Moteur de mapping + attribution (connecteur entrant) ──────
// Résout des chemins dot-path d'un payload JSON entrant → champs Lead canoniques.
// Capture l'attribution marketing (UTM, gclid, fbclid, referrer) et le consentement.
import { sanitizeInput } from './helpers';

export interface LeadMappingResult {
  name: string;
  email: string;
  phone: string;
  message: string;
  type: string;
  company: string;
  customFields: Record<string, string>;
  attribution: {
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    utm_term: string;
    utm_content: string;
    gclid: string;
    fbclid: string;
    referrer: string;
  };
  // null = non renseigné dans le payload (≠ false = opt-out explicite)
  consent: boolean | null;
}

// Mapping par défaut : champ canonique → liste d'alias possibles (clés directes ou dot-path).
// Inclut les alias FR québécois déjà supportés par les handlers existants.
const DEFAULT_MAPPING: Record<string, string[]> = {
  name: ['name', 'nom', 'full_name', 'fullName', 'nom_complet', 'contact.name', 'fields.name'],
  email: ['email', 'courriel', 'e-mail', 'mail', 'contact.email', 'fields.email'],
  phone: ['phone', 'telephone', 'téléphone', 'tel', 'cellulaire', 'mobile', 'contact.phone', 'fields.phone'],
  message: ['message', 'note', 'notes', 'comment', 'commentaire', 'fields.message'],
  type: ['type', 'lead_type'],
  company: ['company', 'entreprise', 'societe', 'société', 'organization', 'contact.company'],
};

const ATTRIBUTION_ALIASES: Record<string, string[]> = {
  utm_source: ['utm_source', 'utmSource', 'utm.source', 'attribution.utm_source'],
  utm_medium: ['utm_medium', 'utmMedium', 'utm.medium', 'attribution.utm_medium'],
  utm_campaign: ['utm_campaign', 'utmCampaign', 'utm.campaign', 'attribution.utm_campaign'],
  utm_term: ['utm_term', 'utmTerm', 'utm.term'],
  utm_content: ['utm_content', 'utmContent', 'utm.content'],
  gclid: ['gclid', 'gclID', 'google_click_id'],
  fbclid: ['fbclid', 'fbc', 'facebook_click_id'],
  referrer: ['referrer', 'referer', 'ref', 'http_referer'],
};

const CONSENT_ALIASES = ['consent', 'consentement', 'opt_in', 'optin', 'opt-in', 'marketing_consent', 'accepte_communications'];

// Résout un chemin dot-path ("contact.email") dans un objet imbriqué.
// Exporté (additif, Sprint E2 M2) : réutilisé par l'import produits e-commerce
// — le moteur dot-path est agnostique du type cible (lead OU produit).
export function resolvePath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  if (!path.includes('.')) return (obj as Record<string, unknown>)[path];
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

// Première valeur non-vide parmi une liste d'alias.
function firstValue(payload: Record<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) {
    const v = resolvePath(payload, alias);
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return '';
}

function asBoolOrNull(v: unknown): boolean | null {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'oui', 'on', 'accepte', 'accepté'].includes(s)) return true;
  if (['false', '0', 'no', 'non', 'off', 'refuse', 'refusé'].includes(s)) return false;
  return null;
}

// Normalisations légères, alignées sur les handlers existants.
function normEmail(s: string): string { return sanitizeInput(s, 255).toLowerCase(); }
function normPhone(s: string): string {
  const trimmed = sanitizeInput(s, 30);
  const digits = trimmed.replace(/[^\d+]/g, '');
  return digits || trimmed;
}

/**
 * Applique un mapping (perso ou par défaut) sur un payload entrant.
 * @param payload  body JSON entrant
 * @param mappingJson  JSON string {name:"contact.fullName", ...} ou null/'' = défaut.
 *   Clé spéciale "consent" dans le mapping = chemin vers le champ de consentement.
 *   Clé spéciale "custom" = objet { libelle: "chemin.payload" } pour custom fields.
 */
export function applyLeadMapping(
  payload: Record<string, unknown>,
  mappingJson?: string | null
): LeadMappingResult {
  let custom: Record<string, string> = {};
  let mapping: Record<string, string> | null = null;

  if (mappingJson && mappingJson.trim()) {
    try {
      const parsed = JSON.parse(mappingJson) as Record<string, unknown>;
      mapping = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k === 'custom' && v && typeof v === 'object') {
          custom = v as Record<string, string>;
        } else if (typeof v === 'string') {
          mapping[k] = v;
        }
      }
    } catch {
      mapping = null; // mapping invalide → fallback défaut
    }
  }

  const pick = (field: keyof typeof DEFAULT_MAPPING): string => {
    if (mapping && mapping[field]) {
      const v = resolvePath(payload, mapping[field]);
      if (v != null && String(v).trim() !== '') return String(v);
    }
    return firstValue(payload, DEFAULT_MAPPING[field]!);
  };

  const rawType = sanitizeInput(pick('type'), 20).toLowerCase();
  const type = ['inbound', 'qualified', 'customer'].includes(rawType) ? rawType : 'inbound';

  // Custom fields perso (libellé → chemin payload)
  const customFields: Record<string, string> = {};
  for (const [label, path] of Object.entries(custom)) {
    const v = resolvePath(payload, path);
    if (v != null && String(v).trim() !== '') {
      customFields[sanitizeInput(label, 100)] = sanitizeInput(String(v), 500);
    }
  }

  // Attribution
  const attribution = {
    utm_source: sanitizeInput(firstValue(payload, ATTRIBUTION_ALIASES.utm_source!), 120),
    utm_medium: sanitizeInput(firstValue(payload, ATTRIBUTION_ALIASES.utm_medium!), 120),
    utm_campaign: sanitizeInput(firstValue(payload, ATTRIBUTION_ALIASES.utm_campaign!), 200),
    utm_term: sanitizeInput(firstValue(payload, ATTRIBUTION_ALIASES.utm_term!), 200),
    utm_content: sanitizeInput(firstValue(payload, ATTRIBUTION_ALIASES.utm_content!), 200),
    gclid: sanitizeInput(firstValue(payload, ATTRIBUTION_ALIASES.gclid!), 255),
    fbclid: sanitizeInput(firstValue(payload, ATTRIBUTION_ALIASES.fbclid!), 255),
    referrer: sanitizeInput(firstValue(payload, ATTRIBUTION_ALIASES.referrer!), 500),
  };

  // Consentement : chemin déclaré dans le mapping, sinon alias standards
  let consentRaw: unknown;
  if (mapping && mapping.consent) consentRaw = resolvePath(payload, mapping.consent);
  if (consentRaw == null) {
    for (const a of CONSENT_ALIASES) {
      const v = resolvePath(payload, a);
      if (v != null && v !== '') { consentRaw = v; break; }
    }
  }

  return {
    name: sanitizeInput(pick('name'), 100),
    email: normEmail(pick('email')),
    phone: normPhone(pick('phone')),
    message: sanitizeInput(pick('message'), 2000),
    type,
    company: sanitizeInput(pick('company'), 150),
    customFields,
    attribution,
    consent: asBoolOrNull(consentRaw),
  };
}
