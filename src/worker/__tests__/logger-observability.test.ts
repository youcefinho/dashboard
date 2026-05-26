// ── logger-observability.test.ts — Sprint 24 (Manager-B) ────────────────
//
// Couvre les ajouts Phase A au logger :
//   1. `debug()` actif uniquement si LOG_LEVEL='debug' (off en default 'warn').
//   2. `createCorrelatedLogger(env, requestId)` enrichit chaque ctx avec
//      `request_id`. Si requestId=null → pass-through byte-identique à
//      createLogger (pas de champ request_id ajouté).
//
// ⚠ Tests NON exécutés (VM VMware). Écrits pour vitest.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, createCorrelatedLogger } from '../lib/logger';

describe('Sprint 24 — logger.debug()', () => {
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

  beforeEach(() => {
    debugSpy.mockClear();
    warnSpy.mockClear();
    errSpy.mockClear();
    infoSpy.mockClear();
  });

  it("LOG_LEVEL='debug' → debug() émet sur console.debug", () => {
    const log = createLogger({ LOG_LEVEL: 'debug' });
    log.debug('something', { route: '/api/x' });
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const line = String(debugSpy.mock.calls[0]![0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.lvl).toBe('debug');
    expect(parsed.msg).toBe('something');
    expect(parsed.route).toBe('/api/x');
  });

  it("LOG_LEVEL='warn' (défaut) → debug() ignoré", () => {
    const log = createLogger({}); // resolve → défaut 'warn'
    log.debug('something');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("LOG_LEVEL='info' → debug() encore ignoré (info < debug en sévérité)", () => {
    const log = createLogger({ LOG_LEVEL: 'info' });
    log.debug('something');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("LOG_LEVEL='debug' → info/warn/error toujours émis", () => {
    const log = createLogger({ LOG_LEVEL: 'debug' });
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Sprint 24 — createCorrelatedLogger', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

  beforeEach(() => {
    warnSpy.mockClear();
    errSpy.mockClear();
    infoSpy.mockClear();
    debugSpy.mockClear();
  });
  afterEach(() => {
    /* spies persist between tests */
  });

  it('injecte request_id dans chaque ligne JSON quand requestId fourni', () => {
    const log = createCorrelatedLogger({ LOG_LEVEL: 'debug' }, 'req-abc-123');
    log.info('i', { route: '/api/x' });
    log.warn('w');
    log.error('e');
    log.debug('d');

    const lineInfo = JSON.parse(String(infoSpy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(lineInfo.request_id).toBe('req-abc-123');
    expect(lineInfo.route).toBe('/api/x');

    const lineWarn = JSON.parse(String(warnSpy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(lineWarn.request_id).toBe('req-abc-123');

    const lineErr = JSON.parse(String(errSpy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(lineErr.request_id).toBe('req-abc-123');

    const lineDbg = JSON.parse(String(debugSpy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(lineDbg.request_id).toBe('req-abc-123');
  });

  it('requestId=null → pas de champ request_id (pass-through byte-équivalent)', () => {
    const log = createCorrelatedLogger({ LOG_LEVEL: 'debug' }, null);
    log.info('i', { route: '/api/x' });
    const lineInfo = JSON.parse(String(infoSpy.mock.calls[0]![0])) as Record<string, unknown>;
    expect('request_id' in lineInfo).toBe(false);
    expect(lineInfo.route).toBe('/api/x');
  });

  it('requestId vide string "" → pas de champ request_id (falsy)', () => {
    const log = createCorrelatedLogger({ LOG_LEVEL: 'debug' }, '');
    log.warn('w');
    const lineWarn = JSON.parse(String(warnSpy.mock.calls[0]![0])) as Record<string, unknown>;
    expect('request_id' in lineWarn).toBe(false);
  });

  it('respecte le LOG_LEVEL hérité (debug filtré si LOG_LEVEL=warn)', () => {
    const log = createCorrelatedLogger({ LOG_LEVEL: 'warn' }, 'req-xyz');
    log.debug('d');
    expect(debugSpy).not.toHaveBeenCalled();
    log.warn('w');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
