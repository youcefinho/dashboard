// ── request-metrics.test.ts — Sprint 24 (Manager-B) ─────────────────────
//
// Couvre `normalizeRoute` (regex defensive segments dynamiques) et
// `recordRequestMetric` (INSERT D1 best-effort never-throw).
//
// ⚠ Tests NON exécutés (VM VMware, aucune commande bun/node). Écrits pour
//    vitest, vérifiés statiquement. Glob : src/worker/__tests__/**/*.test.ts.

import { describe, it, expect } from 'vitest';
import type { Env } from '../types';
import { createMockD1 } from './_helpers';
import { normalizeRoute, recordRequestMetric } from '../lib/request-metrics';

describe('Sprint 24 — normalizeRoute', () => {
  it('remplace un UUID v4 par :id', () => {
    expect(normalizeRoute('/api/leads/123e4567-e89b-12d3-a456-426614174000'))
      .toBe('/api/leads/:id');
  });

  it('remplace un segment hex 16+ par :id', () => {
    expect(
      normalizeRoute(
        '/api/admin/observability/alert-rules/7c4a8d09ca3762af61e59520943dc26494f8941b',
      ),
    ).toBe('/api/admin/observability/alert-rules/:id');
  });

  it('remplace un CUID par :id', () => {
    // CUID typique : c + 24 chars [a-z0-9]
    expect(normalizeRoute('/api/leads/cjld2cjxh0000qzrmn831i7rn'))
      .toBe('/api/leads/:id');
  });

  it('remplace un ObjectId Mongo (24 hex) par :id', () => {
    // 24 hex est inclus dans la regex hex 16+
    expect(normalizeRoute('/api/x/507f1f77bcf86cd799439011'))
      .toBe('/api/x/:id');
  });

  it('laisse un path statique inchangé', () => {
    expect(normalizeRoute('/api/health')).toBe('/api/health');
    expect(normalizeRoute('/api/admin/observability/health')).toBe('/api/admin/observability/health');
  });

  it('laisse les segments courts non-hex inchangés', () => {
    expect(normalizeRoute('/api/leads/list')).toBe('/api/leads/list');
    expect(normalizeRoute('/api/v1/clients')).toBe('/api/v1/clients');
  });

  it('normalise plusieurs segments dynamiques', () => {
    expect(
      normalizeRoute(
        '/api/leads/123e4567-e89b-12d3-a456-426614174000/notes/507f1f77bcf86cd799439011',
      ),
    ).toBe('/api/leads/:id/notes/:id');
  });
});

describe('Sprint 24 — recordRequestMetric', () => {
  it('INSERT request_metrics avec bindings corrects', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;

    await recordRequestMetric(env, {
      method: 'GET',
      rawPath: '/api/leads/123e4567-e89b-12d3-a456-426614174000',
      status: 200,
      tenantId: 'tenant-1',
      latencyMs: 42,
    });

    expect(db.calls.length).toBe(1);
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/INSERT INTO request_metrics/i);
    expect(call.sql).toMatch(/strftime\('%Y-%m-%d %H:%M:00','now'\)/i);
    // Bindings : route normalisé, method, status, tenantId, count latence x2
    expect(call.args[0]).toBe('/api/leads/:id');
    expect(call.args[1]).toBe('GET');
    expect(call.args[2]).toBe(200);
    expect(call.args[3]).toBe('tenant-1');
    expect(call.args[4]).toBe(42); // latency_sum_ms
    expect(call.args[5]).toBe(42); // latency_max_ms
  });

  it('best-effort SWALLOW : table absente → never throws', async () => {
    const env = {
      DB: {
        prepare(_sql: string) {
          return {
            bind() {
              return this;
            },
            run() {
              throw new Error('no such table: request_metrics');
            },
            all() {
              return { results: [] };
            },
            first() {
              return null;
            },
          };
        },
      },
    } as unknown as Env;

    await expect(
      recordRequestMetric(env, {
        method: 'POST',
        rawPath: '/api/webhook/lead',
        status: 500,
        tenantId: null,
        latencyMs: 1234,
      }),
    ).resolves.toBeUndefined();
  });

  it('accepte tenantId null', async () => {
    const db = createMockD1();
    const env = { DB: db } as unknown as Env;
    await recordRequestMetric(env, {
      method: 'GET',
      rawPath: '/api/health',
      status: 200,
      tenantId: null,
      latencyMs: 5,
    });
    expect(db.calls[0]!.args[3]).toBeNull();
  });
});
