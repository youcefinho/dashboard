// ════════════════════════════════════════════════════════════
// S4 M1 — Tests : logger structuré + errorResponse 500 normalisé
// ════════════════════════════════════════════════════════════
//
// Couvre :
//  1. errorResponse → 500 { error: string FR, code: 'INTERNAL' }
//     (forme rétro-compat front : `error` STRING racine).
//  2. errorResponse ne throw jamais (même si le log échoue).
//  3. Logger : respecte LOG_LEVEL (défaut 'warn' ; 'error' masque
//     warn/info ; 'info' laisse tout passer).
//  4. Logger : ne fabrique JAMAIS de sortie qui expose un champ
//     sensible que l'appelant n'a pas passé — et errorResponse ne
//     logge QUE name/message/route (jamais token/body/PII).
//  5. Non-régression : le format 500 est distinct d'un 400 de
//     validation explicite (les `return json(...,4xx)` ne passent
//     jamais par errorResponse — seuls les `throw` y arrivent).
//
// `environment: 'node'`, déterministe, zéro I/O réseau.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, logger } from '../lib/logger';
import { errorResponse } from '../lib/error-response';

describe('S4 M1 — errorResponse()', () => {
  it('retourne 500 avec { error:"Erreur serveur interne", code:"INTERNAL" } (error string racine)', async () => {
    const res = errorResponse(new Error('boom interne'), {} as unknown);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['error']).toBe('Erreur serveur interne');
    expect(typeof body['error']).toBe('string'); // rétro-compat front
    expect(body['code']).toBe('INTERNAL'); // champ additif
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it("accepte n'importe quel type d'exception sans throw (string / non-Error / undefined)", async () => {
    expect(() => errorResponse('erreur string', undefined)).not.toThrow();
    expect(() => errorResponse(undefined, {} as unknown)).not.toThrow();
    expect(() => errorResponse({ weird: true }, {} as unknown)).not.toThrow();
    const res = errorResponse(undefined, {} as unknown);
    expect(res.status).toBe(500);
  });

  it("ne logge QUE des métadonnées sûres (name/message/route) — jamais token/body/PII", () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // env avec LOG_LEVEL=error pour garantir l'émission du error()
    errorResponse(new Error('échec paiement'), { LOG_LEVEL: 'error' }, '/api/secret/x');
    expect(errSpy).toHaveBeenCalledTimes(1);
    const line = errSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    // Champs attendus : sûrs uniquement.
    expect(parsed['lvl']).toBe('error');
    expect(parsed['msg']).toBe('unhandled');
    expect(parsed['name']).toBe('Error');
    expect(parsed['message']).toBe('échec paiement');
    expect(parsed['route']).toBe('/api/secret/x');
    // Aucune clé sensible n'a pu apparaître (errorResponse n'en passe pas).
    expect(Object.keys(parsed)).not.toContain('token');
    expect(Object.keys(parsed)).not.toContain('body');
    expect(Object.keys(parsed)).not.toContain('authorization');
    expect(line).not.toContain('Bearer');
    errSpy.mockRestore();
  });

  it('ne throw pas même si console.error lève (logging best-effort)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console down');
    });
    expect(() =>
      errorResponse(new Error('x'), { LOG_LEVEL: 'error' }),
    ).not.toThrow();
    errSpy.mockRestore();
  });
});

describe('S4 M1 — logger niveaux (LOG_LEVEL)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("LOG_LEVEL='error' : masque warn et info, laisse error", () => {
    const log = createLogger({ LOG_LEVEL: 'error' });
    log.info('i', { a: 1 });
    log.warn('w');
    log.error('e');
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("défaut (LOG_LEVEL absent) = 'warn' : error+warn passent, info masqué", () => {
    const log = createLogger({}); // pas de LOG_LEVEL → défaut 'warn'
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("valeur LOG_LEVEL inconnue → retombe sur défaut 'warn'", () => {
    const log = createLogger({ LOG_LEVEL: 'verbose' });
    log.info('i');
    log.warn('w');
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("LOG_LEVEL='info' : tout passe, sortie = 1 ligne JSON {lvl,msg,ts,...ctx}", () => {
    const log = createLogger({ LOG_LEVEL: 'info' });
    log.info('hello', { route: '/api/x', status: 200 });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(infoSpy.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(parsed['lvl']).toBe('info');
    expect(parsed['msg']).toBe('hello');
    expect(typeof parsed['ts']).toBe('string');
    expect(parsed['route']).toBe('/api/x');
    expect(parsed['status']).toBe(200);
  });

  it('logger par défaut exporté = seuil warn (info masqué)', () => {
    logger.info('should-not-emit');
    logger.warn('should-emit');
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('ctx non sérialisable (circulaire) → ne throw pas, dégrade proprement', () => {
    const log = createLogger({ LOG_LEVEL: 'error' });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => log.error('x', circular)).not.toThrow();
    expect(errSpy).toHaveBeenCalledTimes(1);
    const line = errSpy.mock.calls[0]![0] as string;
    expect(line).toContain('log-serialize-failed');
  });
});

describe('S4 M1 — non-régression format', () => {
  it("le 500 errorResponse est DISTINCT d'un 400 de validation (code différent)", async () => {
    // Un handler renvoyant explicitement json({...},400) ne passe JAMAIS
    // par errorResponse (les catch racine n'interceptent que les `throw`).
    // On vérifie juste que les deux formats ne se confondent pas.
    const internal = (await errorResponse(new Error('x'), {} as unknown).json()) as Record<
      string,
      unknown
    >;
    expect(internal['code']).toBe('INTERNAL');
    expect(internal['code']).not.toBe('VALIDATION');
    // `error` reste une string dans les deux cas (contrat front rétro-compat).
    expect(typeof internal['error']).toBe('string');
  });
});
