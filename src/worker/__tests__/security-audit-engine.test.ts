// ── security-audit-engine.test.ts — Sprint 100 (seq195) ─────────────────────
// Tests pour l'audit de sécurité global et la préparation SOC2.
// 15 cas : audit CSP, dépendances, API, SOC2, scoring, rapport.

import { describe, it, expect } from 'vitest';
import {
  auditCspHeaders,
  auditDependencies,
  auditApiSurface,
  scoreOverall,
  buildSecurityReport,
  SOC2_CONTROLS,
  CSP_BEST_PRACTICES,
  type DepInfo,
  type ApiRouteInfo,
} from '../lib/security-audit-engine';

// ──────────────────────────────────────────────────────────────────────────
// auditCspHeaders — 4 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S100 — auditCspHeaders', () => {
  it('1. Pas de CSP → score 0, finding critical', () => {
    const result = auditCspHeaders(null);
    expect(result.score).toBe(0);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]!.severity).toBe('critical');
    expect(result.findings[0]!.id).toBe('csp-missing');
  });

  it('2. CSP complet → score élevé', () => {
    const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'";
    const result = auditCspHeaders(csp);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.findings.length).toBe(0);
  });

  it('3. CSP avec unsafe-eval → finding critical', () => {
    const csp = "default-src 'self'; script-src 'self' 'unsafe-eval'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; img-src 'self'; style-src 'self'";
    const result = auditCspHeaders(csp);
    const evalFinding = result.findings.find((f) => f.id === 'csp-unsafe-eval');
    expect(evalFinding).toBeDefined();
    expect(evalFinding!.severity).toBe('critical');
  });

  it('4. CSP partiel (directives manquantes) → findings medium', () => {
    const csp = "default-src 'self'";
    const result = auditCspHeaders(csp);
    expect(result.score).toBeLessThan(50);
    expect(result.findings.some((f) => f.id === 'csp-missing-script-src')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// auditDependencies — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S100 — auditDependencies', () => {
  it('5. Dépendances saines → score 100', () => {
    const deps: DepInfo[] = [
      { name: 'react', version: '19.0.0' },
      { name: 'typescript', version: '5.8.0' },
    ];
    const result = auditDependencies(deps);
    expect(result.score).toBe(100);
    expect(result.findings.length).toBe(0);
  });

  it('6. Dépendance risquée (event-stream) → finding critical', () => {
    const deps: DepInfo[] = [
      { name: 'react', version: '19.0.0' },
      { name: 'event-stream', version: '3.3.6' },
    ];
    const result = auditDependencies(deps);
    expect(result.score).toBe(50);
    const finding = result.findings.find((f) => f.id === 'dep-risky-event-stream');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
  });

  it('7. lodash/moment → finding low (pas critique mais déconseillé)', () => {
    const deps: DepInfo[] = [
      { name: 'lodash', version: '4.17.21' },
      { name: 'moment', version: '2.30.0' },
    ];
    const result = auditDependencies(deps);
    expect(result.findings.every((f) => f.severity === 'low')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// auditApiSurface — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S100 — auditApiSurface', () => {
  it('8. Routes protégées → score élevé', () => {
    const routes: ApiRouteInfo[] = [
      { method: 'GET', path: '/api/leads', requiresAuth: true, hasRateLimit: true },
      { method: 'POST', path: '/api/leads', requiresAuth: true, hasRateLimit: true },
    ];
    const result = auditApiSurface(routes);
    expect(result.score).toBe(100);
    expect(result.findings.length).toBe(0);
  });

  it('9. Route d\'écriture publique → finding high', () => {
    const routes: ApiRouteInfo[] = [
      { method: 'POST', path: '/api/public/forms/submit', requiresAuth: false, hasRateLimit: true },
      { method: 'GET', path: '/api/public/forms/config', requiresAuth: false, hasRateLimit: true },
    ];
    const result = auditApiSurface(routes);
    expect(result.score).toBeLessThan(100);
    expect(result.findings.some((f) => f.severity === 'high')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// scoreOverall — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S100 — scoreOverall', () => {
  it('10. Tous scores 100 → grade A', () => {
    const result = scoreOverall({
      csp: { score: 100, findings: [], passed: 10, failed: 0, total: 10 },
      dependencies: { score: 100, findings: [], passed: 20, failed: 0, total: 20 },
      api: { score: 100, findings: [], passed: 15, failed: 0, total: 15 },
    });
    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
  });

  it('11. Scores moyens → grade C ou D', () => {
    const result = scoreOverall({
      csp: { score: 70, findings: [], passed: 7, failed: 3, total: 10 },
      dependencies: { score: 80, findings: [], passed: 16, failed: 4, total: 20 },
      api: { score: 65, findings: [], passed: 10, failed: 5, total: 15 },
    });
    // 70*0.3 + 80*0.3 + 65*0.4 = 21 + 24 + 26 = 71 → grade C
    expect(result.score).toBeLessThanOrEqual(80);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(['C', 'D']).toContain(result.grade);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildSecurityReport — 1 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S100 — buildSecurityReport', () => {
  it('12. Rapport complet structuré', () => {
    const report = buildSecurityReport(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      [{ name: 'react', version: '19.0.0' }],
      [{ method: 'GET', path: '/api/leads', requiresAuth: true, hasRateLimit: true }],
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(report.overall_score).toBeGreaterThanOrEqual(0);
    expect(report.grade).toBeDefined();
    expect(report.audits.csp).toBeDefined();
    expect(report.audits.dependencies).toBeDefined();
    expect(report.audits.api).toBeDefined();
    expect(report.soc2_compliance.total).toBe(SOC2_CONTROLS.length);
    expect(report.generated_at).toBe('2026-06-01T00:00:00.000Z');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// SOC2_CONTROLS — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S100 — SOC2_CONTROLS', () => {
  it('13. Au moins 10 contrôles définis', () => {
    expect(SOC2_CONTROLS.length).toBeGreaterThanOrEqual(10);
  });

  it('14. Chaque contrôle a id, title, status', () => {
    for (const control of SOC2_CONTROLS) {
      expect(typeof control.id).toBe('string');
      expect(typeof control.title).toBe('string');
      expect(['implemented', 'partial', 'missing']).toContain(control.status);
    }
  });

  it('15. Majorité des contrôles implémentés', () => {
    const implemented = SOC2_CONTROLS.filter((c) => c.status === 'implemented').length;
    expect(implemented).toBeGreaterThanOrEqual(8);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// CSP_BEST_PRACTICES — 1 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S100 — CSP_BEST_PRACTICES', () => {
  it('16. Contient les directives essentielles', () => {
    expect(CSP_BEST_PRACTICES['default-src']).toBeDefined();
    expect(CSP_BEST_PRACTICES['script-src']).toBeDefined();
    expect(CSP_BEST_PRACTICES['frame-ancestors']).toBe("'none'");
    expect(CSP_BEST_PRACTICES['object-src']).toBe("'none'");
  });
});
