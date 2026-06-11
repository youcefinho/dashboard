// ── privacy-purge-engine.ts — Sprint 93 (seq188) ────────────────────────────
// Purge automatisée RGPD & Loi 25 des données personnelles inactives.
//
// Couvre :
//   - Validation des règles de purge (inactive_days, action whitelist)
//   - Identification des leads éligibles à la purge par inactivité
//   - Anonymisation Loi 25 (remplace PII par [SUPPRIMÉ])
//   - Rapport d'audit de purge (traçabilité Art 23)
//   - Limites de rétention par juridiction
//
// ZÉRO I/O. Helpers purs — le caller fait les requêtes D1.

// ── Codes d'erreur ────────────────────────────────────────────────────────

export const PURGE_ERROR_CODES = Object.freeze({
  RULE_INVALID: 'PURGE_RULE_INVALID',
  DAYS_INVALID: 'PURGE_DAYS_INVALID',
  ACTION_INVALID: 'PURGE_ACTION_INVALID',
  LEAD_INVALID: 'PURGE_LEAD_INVALID',
} as const);

export type PurgeErrorCode = (typeof PURGE_ERROR_CODES)[keyof typeof PURGE_ERROR_CODES];

// ── Types ─────────────────────────────────────────────────────────────────

export const PURGE_ACTIONS = Object.freeze([
  'anonymize',
  'delete',
  'archive',
] as const);

export type PurgeAction = (typeof PURGE_ACTIONS)[number];

const PURGE_ACTION_SET: ReadonlySet<string> = new Set<string>(PURGE_ACTIONS);

export interface PurgeRule {
  id?: string;
  client_id?: string;
  inactive_days: number;
  action: PurgeAction;
  applies_to?: string; // 'leads' | 'messages' | 'all' — défaut 'leads'
}

export interface PurgeRuleInput {
  inactive_days?: unknown;
  action?: unknown;
  applies_to?: unknown;
}

export interface PurgeRuleValidation {
  ok: boolean;
  error?: PurgeErrorCode;
  rule?: PurgeRule;
}

// ── Limites de rétention par juridiction ──────────────────────────────────

export const RETENTION_LIMITS = Object.freeze({
  /** Québec — Loi 25 : pas de limite légale fixe, mais recommandation 3 ans max. */
  QC: { minDays: 30, defaultDays: 1095, maxDays: 1095 },
  /** Canada hors QC — PIPEDA : rétention raisonnable, typiquement 2 ans. */
  CA: { minDays: 30, defaultDays: 730, maxDays: 1825 },
  /** Union Européenne — RGPD Art 5(1)(e) : pas plus longtemps que nécessaire. */
  EU: { minDays: 30, defaultDays: 1825, maxDays: 1825 },
} as const);

export type Jurisdiction = keyof typeof RETENTION_LIMITS;

// ── Validation ────────────────────────────────────────────────────────────

export function validatePurgeRule(input: PurgeRuleInput): PurgeRuleValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: PURGE_ERROR_CODES.RULE_INVALID };
  }
  const days = input.inactive_days;
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 1) {
    return { ok: false, error: PURGE_ERROR_CODES.DAYS_INVALID };
  }
  const action = input.action;
  if (typeof action !== 'string' || !PURGE_ACTION_SET.has(action)) {
    return { ok: false, error: PURGE_ERROR_CODES.ACTION_INVALID };
  }
  const appliesTo = typeof input.applies_to === 'string' ? input.applies_to : 'leads';
  return {
    ok: true,
    rule: {
      inactive_days: Math.floor(days),
      action: action as PurgeAction,
      applies_to: appliesTo,
    },
  };
}

// ── Identification des leads éligibles ────────────────────────────────────

export interface LeadForPurge {
  id: string;
  updated_at?: string | null;
  created_at?: string | null;
  status?: string | null;
}

/** Identifie les leads inactifs depuis plus de `inactiveDays` jours.
 *  Un lead "inactif" = dernière mise à jour (ou création si pas d'update) > seuil.
 *  Les leads avec status 'won' ou 'customer' sont EXCLUS (protection métier). */
export function identifyPurgeableLeads(
  leads: LeadForPurge[],
  rules: PurgeRule[],
  now: number = Date.now(),
): Array<{ lead: LeadForPurge; rule: PurgeRule; inactiveDays: number }> {
  if (!Array.isArray(leads) || leads.length === 0) return [];
  if (!Array.isArray(rules) || rules.length === 0) return [];

  // Statuts protégés — JAMAIS purgés automatiquement
  const PROTECTED_STATUSES = new Set(['won', 'customer', 'vip']);

  const results: Array<{ lead: LeadForPurge; rule: PurgeRule; inactiveDays: number }> = [];

  for (const lead of leads) {
    if (!lead || !lead.id) continue;
    if (lead.status && PROTECTED_STATUSES.has(lead.status)) continue;

    const lastActivity = lead.updated_at ?? lead.created_at;
    if (!lastActivity) continue;

    const lastMs = Date.parse(lastActivity);
    if (!Number.isFinite(lastMs)) continue;

    const inactiveDays = Math.floor((now - lastMs) / (24 * 60 * 60 * 1000));

    for (const rule of rules) {
      if (inactiveDays >= rule.inactive_days) {
        results.push({ lead, rule, inactiveDays });
        break; // Un seul match par lead (première règle applicable)
      }
    }
  }

  return results;
}

// ── Anonymisation Loi 25 ──────────────────────────────────────────────────

const ANONYMIZED_MARKER = '[SUPPRIMÉ]';

export interface AnonymizedLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  message: string;
  address?: string;
  [key: string]: unknown;
}

/** Anonymise un lead en remplaçant les champs PII par [SUPPRIMÉ].
 *  Conserve l'id, le status, les dates et les champs métier (score, source, etc.)
 *  pour maintenir l'intégrité statistique. */
export function anonymizeLead(lead: Record<string, unknown>): AnonymizedLead {
  if (!lead || typeof lead !== 'object') {
    throw new Error(PURGE_ERROR_CODES.LEAD_INVALID);
  }
  const PII_FIELDS = ['name', 'email', 'phone', 'notes', 'message', 'address', 'company'];
  const copy = { ...lead } as Record<string, unknown>;
  for (const field of PII_FIELDS) {
    if (field in copy && copy[field] !== null && copy[field] !== undefined) {
      copy[field] = ANONYMIZED_MARKER;
    }
  }
  return copy as unknown as AnonymizedLead;
}

/** Vérifie si un lead est déjà anonymisé. */
export function isAnonymized(lead: Record<string, unknown>): boolean {
  return lead.email === ANONYMIZED_MARKER || lead.name === ANONYMIZED_MARKER;
}

// ── Rapport d'audit de purge ──────────────────────────────────────────────

export interface PurgeReport {
  /** Date ISO de la purge. */
  executed_at: string;
  /** Nombre de leads traités. */
  total_processed: number;
  /** Ventilation par action. */
  by_action: Record<PurgeAction, number>;
  /** IDs des leads purgés (pour audit trail). */
  purged_ids: string[];
  /** Règles appliquées. */
  rules_applied: PurgeRule[];
  /** Juridiction. */
  jurisdiction: string;
}

/** Construit le rapport d'audit de la purge (traçabilité Loi 25 Art 23). */
export function buildPurgeReport(
  purgedItems: Array<{ lead: LeadForPurge; rule: PurgeRule }>,
  jurisdiction: string = 'QC',
  now: Date = new Date(),
): PurgeReport {
  const byAction: Record<PurgeAction, number> = {
    anonymize: 0,
    delete: 0,
    archive: 0,
  };
  const purgedIds: string[] = [];
  const rulesUsed = new Map<string, PurgeRule>();

  for (const item of purgedItems) {
    byAction[item.rule.action]++;
    purgedIds.push(item.lead.id);
    const ruleKey = `${item.rule.inactive_days}-${item.rule.action}`;
    if (!rulesUsed.has(ruleKey)) rulesUsed.set(ruleKey, item.rule);
  }

  return {
    executed_at: now.toISOString(),
    total_processed: purgedItems.length,
    by_action: byAction,
    purged_ids: purgedIds,
    rules_applied: Array.from(rulesUsed.values()),
    jurisdiction,
  };
}
