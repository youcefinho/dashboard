// ── snippetVars — Sprint 30 vague 30-2A ────────────────────────────────────
// Runtime interpolation des variables `{{var}}` dans le MessageComposer.
// Slash-commands `/var name`, `/var deal_value`, etc. insèrent un token `{{var}}`
// qui est résolu au moment de l'envoi (ou en preview) via `resolveVars`.
//
// 8 variables supportées :
//   - name          : nom du lead
//   - email         : email du lead
//   - phone         : téléphone du lead
//   - deal_value    : valeur du deal formatée (CAD)
//   - stage         : nom de l'étape pipeline (fallback statut)
//   - client_name   : nom du client (workspace)
//   - score         : score IA du lead (0-100)
//   - today         : date du jour locale (fr-CA)
//
// Pattern de token : `{{name}}` (double accolades, insensible aux espaces).
//
// `resolveVars(text, leadCtx)` retourne `{ resolved, missing[] }` où missing
// liste les vars dont la valeur est null/undefined/empty → le composer peut
// afficher un chip warning à l'utilisateur avant envoi.

import type { Lead } from './types';

export type SnippetVarKey =
  | 'name'
  | 'email'
  | 'phone'
  | 'deal_value'
  | 'stage'
  | 'client_name'
  | 'score'
  | 'today';

export interface SnippetVarDescriptor {
  key: SnippetVarKey;
  label: string;
  description: string;
  example: string;
}

export const SNIPPET_VARS: SnippetVarDescriptor[] = [
  { key: 'name', label: 'Nom du lead', description: 'Prénom + nom du contact', example: 'Marie Tremblay' },
  { key: 'email', label: 'Courriel', description: 'Adresse courriel principale', example: 'marie@exemple.ca' },
  { key: 'phone', label: 'Téléphone', description: 'Numéro principal', example: '514-555-0123' },
  { key: 'deal_value', label: 'Valeur du deal', description: 'Montant formaté CAD', example: '12 500 $' },
  { key: 'stage', label: 'Étape pipeline', description: 'Nom de l\'étape courante', example: 'Négociation' },
  { key: 'client_name', label: 'Nom client', description: 'Workspace / entreprise', example: 'Atelier Tremblay inc.' },
  { key: 'score', label: 'Score IA', description: 'Score 0-100 du lead', example: '82' },
  { key: 'today', label: 'Date du jour', description: 'Date locale fr-CA', example: '14 mai 2026' },
];

export interface LeadCtx {
  lead?: Pick<Lead, 'name' | 'email' | 'phone' | 'deal_value' | 'client_name' | 'score'> | null;
  stageName?: string | null;
}

const CAD_FORMATTER = new Intl.NumberFormat('fr-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-CA', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function valueFor(key: SnippetVarKey, ctx: LeadCtx): string | null {
  const lead = ctx.lead ?? null;
  switch (key) {
    case 'name':
      return lead?.name?.trim() || null;
    case 'email':
      return lead?.email?.trim() || null;
    case 'phone':
      return lead?.phone?.trim() || null;
    case 'deal_value':
      if (!lead || lead.deal_value == null || !Number.isFinite(lead.deal_value) || lead.deal_value <= 0) return null;
      return CAD_FORMATTER.format(lead.deal_value);
    case 'stage':
      return ctx.stageName?.trim() || null;
    case 'client_name':
      return lead?.client_name?.trim() || null;
    case 'score':
      if (!lead || lead.score == null || !Number.isFinite(lead.score) || lead.score <= 0) return null;
      return String(Math.round(lead.score));
    case 'today':
      return DATE_FORMATTER.format(new Date());
    default:
      return null;
  }
}

const TOKEN_REGEX = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export interface ResolveResult {
  resolved: string;
  missing: SnippetVarKey[];
  used: SnippetVarKey[];
}

/**
 * Remplace les `{{var}}` par leurs valeurs résolues. Si une var est absente,
 * le token est conservé et la clé ajoutée à `missing` (déduplique).
 */
export function resolveVars(text: string, ctx: LeadCtx): ResolveResult {
  const missingSet = new Set<SnippetVarKey>();
  const usedSet = new Set<SnippetVarKey>();
  const validKeys = new Set<string>(SNIPPET_VARS.map((v) => v.key));

  const resolved = text.replace(TOKEN_REGEX, (match, rawKey: string) => {
    const key = rawKey.toLowerCase() as SnippetVarKey;
    if (!validKeys.has(key)) return match;
    const value = valueFor(key, ctx);
    if (value === null) {
      missingSet.add(key);
      return match;
    }
    usedSet.add(key);
    return value;
  });

  return {
    resolved,
    missing: Array.from(missingSet),
    used: Array.from(usedSet),
  };
}

/**
 * Détecte les `{{var}}` présents dans le texte (utile pour preview chips).
 */
export function listTokens(text: string): SnippetVarKey[] {
  const set = new Set<SnippetVarKey>();
  const validKeys = new Set<string>(SNIPPET_VARS.map((v) => v.key));
  let m: RegExpExecArray | null;
  TOKEN_REGEX.lastIndex = 0;
  while ((m = TOKEN_REGEX.exec(text)) !== null) {
    const k = (m[1] ?? '').toLowerCase();
    if (validKeys.has(k)) set.add(k as SnippetVarKey);
  }
  return Array.from(set);
}

/**
 * Filtre les vars matchant un préfixe (autocomplete `/var na` → name).
 */
export function filterVars(query: string): SnippetVarDescriptor[] {
  const q = query.trim().toLowerCase();
  if (!q) return SNIPPET_VARS;
  return SNIPPET_VARS.filter(
    (v) => v.key.includes(q) || v.label.toLowerCase().includes(q),
  );
}
