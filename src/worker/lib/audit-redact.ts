// ── Sprint 23 — Sécurité / conformité — audit log PII redaction ──────────
// Sensitive keys (lowercase) that are systematically replaced by [REDACTED]
// in audit_log.details payloads. Whitelist STRICTE — email/ip restent (loggés
// dans colonnes dédiées audit_log.ip, audit_log.user_agent). Manager-B remplit
// le walk récursif Phase B + flippe `audit_log.redacted = 1` quand au moins
// une clé matche.

export const SENSITIVE_KEYS_REGEX = /^(password|password_hash|token|secret|.*_secret|.*_key|ciphertext|api_key|webhook_secret|stripe_secret_key|access_token|refresh_token)$/i;

const REDACTED = '[REDACTED]';

export function auditRedact(details: unknown): { sanitized: unknown; redacted: boolean } {
  let redacted = false;

  function walk(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object') {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src)) {
        if (SENSITIVE_KEYS_REGEX.test(k)) {
          // Whitelist stricte : on remplace la VALEUR par '[REDACTED]',
          // jamais la KEY (pour que la structure reste lisible côté viewer).
          out[k] = REDACTED;
          redacted = true;
        } else {
          out[k] = walk(src[k]);
        }
      }
      return out;
    }
    // Primitif (string/number/bool) → renvoyé tel quel.
    return v;
  }

  const sanitized = walk(details);
  return { sanitized, redacted };
}
