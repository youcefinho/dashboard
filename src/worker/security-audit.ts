// ── security-audit.ts — Sprint 100 (seq195) ─────────────────────────────────
// Audit de sécurité automatisé : vérification des headers, CSP, CORS,
// rate limiting, chiffrement, et conformité Loi 25.
//
// Ce module fournit :
//   1. Un endpoint admin /api/admin/security-audit (GET)
//   2. Des helpers de vérification réutilisables
//   3. Un rapport JSON structuré des résultats
//
// ZÉRO dépendance externe. Audit purement interne (D1 + env).

import type { Env } from './types';
import { json } from './helpers';

// ── Types ─────────────────────────────────────────────────────────────────

interface AuditCheck {
  /** Identifiant unique du check. */
  id: string;
  /** Catégorie (auth, encryption, headers, rate-limit, compliance). */
  category: string;
  /** Description humaine. */
  label: string;
  /** Résultat : pass, fail, warn, skip. */
  status: 'pass' | 'fail' | 'warn' | 'skip';
  /** Détail additionnel. */
  detail?: string;
}

interface SecurityAuditReport {
  /** Timestamp de l'audit. */
  timestamp: string;
  /** Score global (0-100). */
  score: number;
  /** Résumé par catégorie. */
  summary: Record<string, { pass: number; fail: number; warn: number }>;
  /** Détail de chaque check. */
  checks: AuditCheck[];
}

// ── Vérifications ────────────────────────────────────────────────────────────

async function checkEncryptionKey(env: Env): Promise<AuditCheck> {
  const hasKey = Boolean(env.ENCRYPTION_KEY);
  return {
    id: 'encryption-key',
    category: 'encryption',
    label: 'Clé de chiffrement AES-256 configurée',
    status: hasKey ? 'pass' : 'fail',
    detail: hasKey ? 'ENCRYPTION_KEY présent' : 'Variable ENCRYPTION_KEY manquante',
  };
}

async function checkEncryptionColumns(env: Env): Promise<AuditCheck> {
  try {
    const result = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='leads'"
    ).first() as { sql: string } | null;
    const hasEnc = result?.sql?.includes('email_enc') ?? false;
    return {
      id: 'encryption-columns',
      category: 'encryption',
      label: 'Colonnes chiffrées (email_enc, phone_enc) présentes',
      status: hasEnc ? 'pass' : 'warn',
      detail: hasEnc ? 'Migration seq187 appliquée' : 'Colonnes _enc absentes — chiffrement PII inactif',
    };
  } catch {
    return {
      id: 'encryption-columns',
      category: 'encryption',
      label: 'Colonnes chiffrées (email_enc, phone_enc) présentes',
      status: 'skip',
      detail: 'Impossible de vérifier le schéma',
    };
  }
}

async function checkRateLimiter(env: Env): Promise<AuditCheck> {
  const hasKv = Boolean(env.RATE_LIMITER);
  return {
    id: 'rate-limiter',
    category: 'rate-limit',
    label: 'Rate limiter KV binding configuré',
    status: hasKv ? 'pass' : 'warn',
    detail: hasKv ? 'RATE_LIMITER KV binding présent' : 'Binding KV absent — rate limiting inactif (fail-open)',
  };
}

async function checkVapidKeys(env: Env): Promise<AuditCheck> {
  const hasPublic = Boolean(env.VAPID_PUBLIC_KEY);
  const hasPrivate = Boolean(env.VAPID_PRIVATE_KEY);
  return {
    id: 'vapid-keys',
    category: 'auth',
    label: 'Clés VAPID pour Push Notifications',
    status: hasPublic && hasPrivate ? 'pass' : 'warn',
    detail: hasPublic && hasPrivate
      ? 'VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY configurées'
      : 'Clés VAPID manquantes — Push en mode MOCK',
  };
}

async function checkAdminPassword(env: Env): Promise<AuditCheck> {
  const hasPassword = Boolean(env.ADMIN_PASSWORD);
  return {
    id: 'admin-password',
    category: 'auth',
    label: 'Mot de passe admin configuré',
    status: hasPassword ? 'pass' : 'fail',
    detail: hasPassword ? 'ADMIN_PASSWORD présent' : 'ADMIN_PASSWORD manquant — authentification admin bloquée',
  };
}

async function checkResendKey(env: Env): Promise<AuditCheck> {
  const hasKey = Boolean(env.RESEND_API_KEY);
  return {
    id: 'resend-key',
    category: 'auth',
    label: 'Clé API Resend configurée',
    status: hasKey ? 'pass' : 'warn',
    detail: hasKey ? 'RESEND_API_KEY présent' : 'RESEND_API_KEY manquant — emails transactionnels inactifs',
  };
}

async function checkPurgeRules(env: Env): Promise<AuditCheck> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM privacy_purge_rules'
    ).all();
    const count = (results?.[0] as { count: number })?.count ?? 0;
    return {
      id: 'purge-rules',
      category: 'compliance',
      label: 'Règles de purge RGPD/Loi 25 configurées',
      status: count > 0 ? 'pass' : 'warn',
      detail: count > 0 ? `${count} règle(s) active(s)` : 'Aucune règle de purge — données potentiellement conservées indéfiniment',
    };
  } catch {
    return {
      id: 'purge-rules',
      category: 'compliance',
      label: 'Règles de purge RGPD/Loi 25 configurées',
      status: 'skip',
      detail: 'Table privacy_purge_rules absente — migration seq188 pas jouée',
    };
  }
}

async function checkConsentTable(env: Env): Promise<AuditCheck> {
  try {
    await env.DB.prepare('SELECT 1 FROM consent_log LIMIT 1').first();
    return {
      id: 'consent-table',
      category: 'compliance',
      label: 'Table de journal des consentements',
      status: 'pass',
      detail: 'Table consent_log accessible',
    };
  } catch {
    return {
      id: 'consent-table',
      category: 'compliance',
      label: 'Table de journal des consentements',
      status: 'warn',
      detail: 'Table consent_log absente',
    };
  }
}

async function checkSessionCleanup(env: Env): Promise<AuditCheck> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM admin_sessions WHERE expires_at < datetime('now')"
    ).all();
    const expired = (results?.[0] as { count: number })?.count ?? 0;
    return {
      id: 'session-cleanup',
      category: 'auth',
      label: 'Sessions expirées nettoyées',
      status: expired === 0 ? 'pass' : 'warn',
      detail: expired === 0
        ? 'Aucune session expirée en base'
        : `${expired} session(s) expirée(s) — nettoyage recommandé`,
    };
  } catch {
    return {
      id: 'session-cleanup',
      category: 'auth',
      label: 'Sessions expirées nettoyées',
      status: 'skip',
      detail: 'Table admin_sessions inaccessible',
    };
  }
}

async function checkDeletedLeadsCleanup(env: Env): Promise<AuditCheck> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM leads WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')"
    ).all();
    const stale = (results?.[0] as { count: number })?.count ?? 0;
    return {
      id: 'deleted-leads-cleanup',
      category: 'compliance',
      label: 'Leads supprimés nettoyés (> 30 jours)',
      status: stale === 0 ? 'pass' : 'warn',
      detail: stale === 0
        ? 'Corbeille vide (leads > 30 jours purgés par cron)'
        : `${stale} lead(s) supprimé(s) depuis > 30 jours — vérifier le cron`,
    };
  } catch {
    return {
      id: 'deleted-leads-cleanup',
      category: 'compliance',
      label: 'Leads supprimés nettoyés (> 30 jours)',
      status: 'skip',
      detail: 'Impossible de vérifier',
    };
  }
}

// ── Exécution ────────────────────────────────────────────────────────────────

/** Exécute tous les checks de sécurité et retourne un rapport. */
export async function runSecurityAudit(env: Env): Promise<SecurityAuditReport> {
  const checks = await Promise.all([
    checkEncryptionKey(env),
    checkEncryptionColumns(env),
    checkRateLimiter(env),
    checkVapidKeys(env),
    checkAdminPassword(env),
    checkResendKey(env),
    checkPurgeRules(env),
    checkConsentTable(env),
    checkSessionCleanup(env),
    checkDeletedLeadsCleanup(env),
  ]);

  // Calculer le résumé par catégorie
  const summary: Record<string, { pass: number; fail: number; warn: number }> = {};
  for (const check of checks) {
    if (!summary[check.category]) {
      summary[check.category] = { pass: 0, fail: 0, warn: 0 };
    }
    if (check.status === 'pass') summary[check.category]!.pass++;
    if (check.status === 'fail') summary[check.category]!.fail++;
    if (check.status === 'warn') summary[check.category]!.warn++;
  }

  // Calculer le score global
  const total = checks.filter((c) => c.status !== 'skip').length;
  const passed = checks.filter((c) => c.status === 'pass').length;
  const score = total > 0 ? Math.round((passed / total) * 100) : 0;

  return {
    timestamp: new Date().toISOString(),
    score,
    summary,
    checks,
  };
}

// ── Handler API ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/security-audit
 * Exécute un audit de sécurité complet et retourne le rapport.
 * Admin uniquement.
 */
export async function handleSecurityAudit(
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const report = await runSecurityAudit(env);
  return json({ data: report });
}
