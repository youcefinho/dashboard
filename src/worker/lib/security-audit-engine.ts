// ── security-audit-engine.ts — Sprint 100 (seq195) ──────────────────────────
// Audit de sécurité global, préparation SOC2 & Release Candidate.
//
// Couvre :
//   - Audit des headers CSP (analyse et score)
//   - Audit des dépendances (détection de vulnérabilités structurelles)
//   - Audit de la surface d'API (couverture auth)
//   - Checklist SOC2 Type II
//   - Score global de sécurité (0-100, lettre A-F)
//   - Rapport de sécurité structuré
//
// ZÉRO I/O. Helpers purs d'analyse — le caller fournit les données brutes.

// ── Types ─────────────────────────────────────────────────────────────────

export interface SecurityFinding {
  /** Identifiant unique du finding. */
  id: string;
  /** Sévérité. */
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** Catégorie (CSP, deps, api, auth, config). */
  category: string;
  /** Description du problème. */
  description: string;
  /** Recommandation de correction. */
  recommendation: string;
}

export interface AuditResult {
  score: number; // 0-100
  findings: SecurityFinding[];
  passed: number;
  failed: number;
  total: number;
}

// ── Audit CSP ─────────────────────────────────────────────────────────────

/** Directives CSP recommandées pour Cloudflare Workers. */
export const CSP_BEST_PRACTICES = Object.freeze({
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline'", // unsafe-inline souvent nécessaire pour CSS-in-JS
  'img-src': "'self' data: https:",
  'font-src': "'self' https://fonts.gstatic.com",
  'connect-src': "'self'",
  'frame-ancestors': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'object-src': "'none'",
  'upgrade-insecure-requests': '',
} as const);

/** Analyse les headers CSP et retourne un score + findings. */
export function auditCspHeaders(cspHeader: string | null): AuditResult {
  const findings: SecurityFinding[] = [];
  let passed = 0;
  let total = 0;

  if (!cspHeader || cspHeader.trim().length === 0) {
    return {
      score: 0,
      findings: [{
        id: 'csp-missing',
        severity: 'critical',
        category: 'CSP',
        description: 'Aucune politique Content-Security-Policy configurée',
        recommendation: 'Ajouter des headers CSP dans public/_headers',
      }],
      passed: 0,
      failed: 1,
      total: 1,
    };
  }

  // Parser les directives
  const directives = new Map<string, string>();
  for (const part of cspHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) {
      directives.set(trimmed, '');
    } else {
      directives.set(trimmed.slice(0, spaceIdx), trimmed.slice(spaceIdx + 1));
    }
  }

  // Vérifier les directives recommandées
  const requiredDirectives = [
    'default-src', 'script-src', 'style-src', 'img-src',
    'frame-ancestors', 'object-src', 'base-uri',
  ];

  for (const dir of requiredDirectives) {
    total++;
    if (directives.has(dir)) {
      passed++;
    } else {
      findings.push({
        id: `csp-missing-${dir}`,
        severity: dir === 'default-src' || dir === 'script-src' ? 'high' : 'medium',
        category: 'CSP',
        description: `Directive "${dir}" manquante`,
        recommendation: `Ajouter "${dir}" à la politique CSP`,
      });
    }
  }

  // Vérifications spécifiques
  total++;
  const scriptSrc = directives.get('script-src') ?? '';
  if (scriptSrc.includes("'unsafe-eval'")) {
    findings.push({
      id: 'csp-unsafe-eval',
      severity: 'critical',
      category: 'CSP',
      description: "script-src contient 'unsafe-eval' — risque d'injection XSS",
      recommendation: "Supprimer 'unsafe-eval' et utiliser des nonces CSP",
    });
  } else {
    passed++;
  }

  total++;
  if (scriptSrc.includes("'unsafe-inline'")) {
    findings.push({
      id: 'csp-unsafe-inline-script',
      severity: 'high',
      category: 'CSP',
      description: "script-src contient 'unsafe-inline'",
      recommendation: "Utiliser des nonces ou des hashes SHA-256 au lieu de 'unsafe-inline'",
    });
  } else {
    passed++;
  }

  const failed = total - passed;
  const score = total > 0 ? Math.round((passed / total) * 100) : 0;

  return { score, findings, passed, failed, total };
}

// ── Audit dépendances ─────────────────────────────────────────────────────

export interface DepInfo {
  name: string;
  version: string;
  isDevDependency?: boolean;
}

/** Analyse les dépendances pour détecter des vulnérabilités structurelles.
 *  NOTE : ceci est une analyse statique basée sur des patterns connus,
 *  pas un scan CVE (qui nécessite un service externe comme npm audit). */
export function auditDependencies(deps: DepInfo[]): AuditResult {
  const findings: SecurityFinding[] = [];
  let passed = 0;
  let total = 0;

  // Packages connus comme risqués ou à éviter
  const RISKY_PACKAGES = new Map<string, string>([
    ['event-stream', 'Package compromis en 2018 (cryptojacking)'],
    ['ua-parser-js', 'Package compromis en 2021 (malware)'],
    ['colors', 'Package saboté par son auteur en 2022'],
    ['faker', 'Package saboté par son auteur en 2022'],
    ['node-ipc', 'Package compromis en 2022 (protestware)'],
    ['lodash', 'Bibliothèque monolithique — préférer lodash-es ou des imports ciblés'],
    ['moment', 'Bibliothèque obsolète — préférer date-fns ou Intl'],
  ]);

  for (const dep of deps) {
    if (!dep || !dep.name) continue;
    total++;

    const risk = RISKY_PACKAGES.get(dep.name);
    if (risk) {
      findings.push({
        id: `dep-risky-${dep.name}`,
        severity: dep.name === 'lodash' || dep.name === 'moment' ? 'low' : 'critical',
        category: 'dependencies',
        description: `Dépendance risquée : ${dep.name}@${dep.version} — ${risk}`,
        recommendation: `Remplacer ou supprimer ${dep.name}`,
      });
    } else {
      passed++;
    }
  }

  const failed = total - passed;
  const score = total > 0 ? Math.round((passed / total) * 100) : 100;

  return { score, findings, passed, failed, total };
}

// ── Audit surface d'API ───────────────────────────────────────────────────

export interface ApiRouteInfo {
  method: string;
  path: string;
  requiresAuth: boolean;
  hasRateLimit?: boolean;
}

/** Analyse la couverture d'authentification des routes API. */
export function auditApiSurface(routes: ApiRouteInfo[]): AuditResult {
  const findings: SecurityFinding[] = [];
  let passed = 0;
  let total = 0;

  const publicWriteRoutes: ApiRouteInfo[] = [];

  for (const route of routes) {
    if (!route || !route.path) continue;
    total++;

    if (!route.requiresAuth) {
      // Route publique avec méthode d'écriture → finding
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method.toUpperCase())) {
        publicWriteRoutes.push(route);
        findings.push({
          id: `api-unprotected-${route.method}-${route.path.replace(/\//g, '_')}`,
          severity: 'high',
          category: 'api',
          description: `Route d'écriture publique : ${route.method} ${route.path}`,
          recommendation: 'Ajouter requireAuth() ou rate-limiting strict',
        });
      } else {
        // GET public = OK (formulaires, widgets)
        passed++;
      }
    } else {
      passed++;
    }

    // Vérifier le rate-limiting
    if (!route.hasRateLimit && !route.requiresAuth) {
      total++;
      findings.push({
        id: `api-no-ratelimit-${route.path.replace(/\//g, '_')}`,
        severity: 'medium',
        category: 'api',
        description: `Route publique sans rate-limiting : ${route.path}`,
        recommendation: 'Ajouter un tier de rate-limiting KV',
      });
    } else if (route.hasRateLimit || route.requiresAuth) {
      // Rate limited OU auth → OK pour cette vérification
    }
  }

  const failed = total - passed;
  const score = total > 0 ? Math.round((passed / total) * 100) : 100;

  return { score, findings, passed, failed, total };
}

// ── Checklist SOC2 Type II ────────────────────────────────────────────────

export interface Soc2Control {
  /** Identifiant du contrôle (ex: CC6.1). */
  id: string;
  /** Titre court. */
  title: string;
  /** Description de l'exigence. */
  description: string;
  /** Status : implémenté, partiel, manquant. */
  status: 'implemented' | 'partial' | 'missing';
  /** Justification ou référence au code. */
  evidence?: string;
}

/** Matrice SOC2 Type II — contrôles Common Criteria pertinents pour un SaaS. */
export const SOC2_CONTROLS: readonly Soc2Control[] = Object.freeze([
  {
    id: 'CC6.1',
    title: 'Logical Access Controls',
    description: "Contrôles d'accès logiques : authentification, RBAC, sessions sécurisées",
    status: 'implemented',
    evidence: 'auth-engine.ts, security-engine.ts, RBAC dans capabilities-engine.ts',
  },
  {
    id: 'CC6.2',
    title: 'Credentials Management',
    description: 'Gestion des identifiants : hashing PBKDF2, rotation de tokens, MFA',
    status: 'implemented',
    evidence: 'crypto.ts (PBKDF2), TOTP dans security-admin-engine.ts',
  },
  {
    id: 'CC6.3',
    title: 'Access Revocation',
    description: "Révocation d'accès : invalidation de sessions, blocage de comptes",
    status: 'implemented',
    evidence: 'auth-engine.ts (session invalidation), rate-limit-kv.ts (IP blocking)',
  },
  {
    id: 'CC6.6',
    title: 'System Boundaries',
    description: 'Limites du système : CSP, CORS, rate-limiting, firewall applicatif',
    status: 'implemented',
    evidence: '_headers (CSP), rate-limit-kv.ts, chat-origin-check.ts',
  },
  {
    id: 'CC6.7',
    title: 'Data Classification',
    description: 'Classification des données : PII identifié et chiffré, audit des accès',
    status: 'implemented',
    evidence: 'field-encryption-engine.ts (AES-GCM), audit-engine.ts',
  },
  {
    id: 'CC6.8',
    title: 'Data Disposal',
    description: 'Destruction des données : purge automatisée, anonymisation Loi 25',
    status: 'implemented',
    evidence: 'privacy-purge-engine.ts, compliance-engine.ts',
  },
  {
    id: 'CC7.1',
    title: 'Monitoring Detection',
    description: 'Détection : monitoring des tentatives de connexion, alertes de sécurité',
    status: 'implemented',
    evidence: 'security-admin-engine.ts (login alerts), audit-engine.ts (system logs)',
  },
  {
    id: 'CC7.2',
    title: 'Incident Response',
    description: "Réponse aux incidents : journalisation, traçabilité, procédures d'escalade",
    status: 'partial',
    evidence: 'audit-engine.ts (logging), mais pas de procédure formelle documentée',
  },
  {
    id: 'CC8.1',
    title: 'Change Management',
    description: 'Gestion du changement : versionning, déploiement contrôlé, rollback',
    status: 'implemented',
    evidence: 'Git workflow, wrangler deploy (pas de CD automatique), CHANGELOG.md',
  },
  {
    id: 'A1.2',
    title: 'Recovery Procedures',
    description: 'Procédures de récupération : backups, snapshots, exports',
    status: 'implemented',
    evidence: 'snapshot-engine.ts, compliance-engine.ts (data export)',
  },
]);

// ── Score global ──────────────────────────────────────────────────────────

export interface SecurityReport {
  overall_score: number;
  grade: string;
  audits: {
    csp: AuditResult;
    dependencies: AuditResult;
    api: AuditResult;
  };
  soc2_compliance: {
    implemented: number;
    partial: number;
    missing: number;
    total: number;
  };
  all_findings: SecurityFinding[];
  generated_at: string;
}

/** Calcule le score global de sécurité et la note lettrée. */
export function scoreOverall(audits: {
  csp: AuditResult;
  dependencies: AuditResult;
  api: AuditResult;
}): { score: number; grade: string } {
  // Pondération : CSP 30%, deps 30%, API 40%
  const weighted =
    audits.csp.score * 0.3 +
    audits.dependencies.score * 0.3 +
    audits.api.score * 0.4;
  const score = Math.round(weighted);

  let grade: string;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';

  return { score, grade };
}

/** Construit le rapport de sécurité complet. */
export function buildSecurityReport(
  cspHeader: string | null,
  deps: DepInfo[],
  routes: ApiRouteInfo[],
  now: Date = new Date(),
): SecurityReport {
  const csp = auditCspHeaders(cspHeader);
  const dependencies = auditDependencies(deps);
  const api = auditApiSurface(routes);
  const { score, grade } = scoreOverall({ csp, dependencies, api });

  const soc2Implemented = SOC2_CONTROLS.filter((c) => c.status === 'implemented').length;
  const soc2Partial = SOC2_CONTROLS.filter((c) => c.status === 'partial').length;
  const soc2Missing = SOC2_CONTROLS.filter((c) => c.status === 'missing').length;

  return {
    overall_score: score,
    grade,
    audits: { csp, dependencies, api },
    soc2_compliance: {
      implemented: soc2Implemented,
      partial: soc2Partial,
      missing: soc2Missing,
      total: SOC2_CONTROLS.length,
    },
    all_findings: [...csp.findings, ...dependencies.findings, ...api.findings],
    generated_at: now.toISOString(),
  };
}
