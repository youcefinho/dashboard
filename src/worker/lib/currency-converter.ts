// ── Currency converter — Sprint 39 (2026-05-24) ────────────────────────────
//
// Lib pure + cache D1 pour conversion multi-devises (CAD/USD/EUR/DZD/MAD).
//
// Conventions :
//   - Money TOUJOURS en cents (INTEGER). Conversion : amountCents * rate
//     (Math.round on output, JAMAIS Math.floor — éviter biais marchand).
//   - Rate REAL >0. base→quote : 1 base = rate quote (ex CAD→USD ≈ 0.73).
//   - Cache D1 `currency_rates` (seq134) : lecture ordonnée DESC fetched_at
//     → si entrée < 24h ⇒ servir cache ; sinon refresh via fetch Frankfurter
//     (proxy ECB public, pas de clé API requise).
//   - Pas d'inversion automatique : si quote→base demandée alors qu'on n'a
//     que base→quote, calcul 1/rate côté handler (PAS dans cette lib pure).
//   - Fallback chaîné : cache fresh <24h → fetch ECB → cache stale any-age
//     → throw 'rate_unavailable'.
//
// Régression-zéro : tout consumer existant mono-CAD passe par computeTax()
// legacy SANS appel à ce module. convertCents() est strictement opt-in.

import type { Env } from '../types';
import type { SupportedCurrencyExt } from '../../lib/types';

export interface RateLookup {
  rate: number;
  source: 'ecb' | 'frankfurter' | 'manual' | 'identity' | 'cached_stale';
  fetched_at: string;
}

// Symbols supportés par le cache D1 (cf seq134 + SupportedCurrencyExt).
const SUPPORTED_SYMBOLS = ['CAD', 'USD', 'EUR', 'DZD', 'MAD'] as const;

/**
 * Convertit un montant en cents d'une devise source vers une devise cible.
 * Pure : aucun I/O. Le rate doit être fourni par le caller (typiquement via
 * getRate() qui lit le cache D1).
 *
 * @param amountCents montant en cents (INTEGER, ≥ 0 attendu)
 * @param fromCur     devise source
 * @param toCur       devise cible
 * @param rate        taux change fromCur → toCur (1 fromCur = rate toCur)
 * @returns           montant converti en cents (INTEGER, arrondi)
 *
 * Identity si fromCur === toCur. Rate invalide (≤0 / NaN / Infinity) → 0
 * (refus silencieux — caller doit valider rate via getRate() avant appel).
 * Money : Math.round (pas Math.floor — éviter biais en faveur du marchand).
 */
export function convertCents(
  amountCents: number,
  fromCur: SupportedCurrencyExt,
  toCur: SupportedCurrencyExt,
  rate: number,
): number {
  if (fromCur === toCur) return amountCents;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(amountCents * rate);
}

/**
 * Fetch les taux de change pour une devise base donnée via Frankfurter API
 * (proxy public ECB, pas de clé requise, mis à jour quotidiennement).
 *
 * Endpoint : https://api.frankfurter.app/latest?base=<base>&symbols=CAD,USD,EUR,DZD,MAD
 * Response : { amount: 1, base: 'CAD', date: '2026-05-24', rates: { USD: 0.73, ... } }
 *
 * @throws Error('frankfurter_fetch_failed: <status>') si HTTP non-OK
 * @throws Error('frankfurter_parse_failed: <message>') si JSON invalide
 */
export async function fetchEcbRates(
  base: SupportedCurrencyExt,
): Promise<Record<string, number>> {
  const symbols = SUPPORTED_SYMBOLS.filter((s) => s !== base).join(',');
  const url = `https://api.frankfurter.app/latest?base=${encodeURIComponent(base)}&symbols=${symbols}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`frankfurter_fetch_failed: network: ${msg}`);
  }

  if (!response.ok) {
    throw new Error(`frankfurter_fetch_failed: HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`frankfurter_parse_failed: ${msg}`);
  }

  const rates = (payload as { rates?: unknown })?.rates;
  if (!rates || typeof rates !== 'object') {
    throw new Error('frankfurter_parse_failed: missing rates field');
  }

  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rates as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Résout un taux base→quote via cache D1 (`currency_rates`) avec fallback
 * fetch Frankfurter + cache stale.
 *
 * Stratégie (chaînée) :
 *   1. from === to ⇒ identity (rate=1, source='identity').
 *   2. SELECT fresh <24h depuis cache D1 ⇒ hit ? servir.
 *   3. fetchEcbRates(from) ⇒ INSERT chaque target dans cache D1 ⇒ servir.
 *   4. Fetch failed ⇒ SELECT any-age dans cache ⇒ servir avec source='cached_stale'.
 *   5. Rien trouvé ⇒ throw 'rate_unavailable'.
 *
 * @throws Error('rate_unavailable') si aucun chemin ne produit de taux.
 */
export async function getRate(
  env: Env,
  from: SupportedCurrencyExt,
  to: SupportedCurrencyExt,
): Promise<RateLookup> {
  // (1) Identity : pas d'I/O, pas de cache.
  if (from === to) {
    return {
      rate: 1,
      source: 'identity',
      fetched_at: new Date().toISOString(),
    };
  }

  // (2) Cache fresh <24h.
  const freshHit = await env.DB.prepare(
    `SELECT rate, source, fetched_at
       FROM currency_rates
      WHERE base_currency = ?
        AND quote_currency = ?
        AND fetched_at > datetime('now', '-1 day')
      ORDER BY fetched_at DESC
      LIMIT 1`,
  )
    .bind(from, to)
    .first<{ rate: number; source: string; fetched_at: string }>();

  if (freshHit && Number.isFinite(freshHit.rate) && freshHit.rate > 0) {
    return {
      rate: freshHit.rate,
      source: normalizeSource(freshHit.source),
      fetched_at: freshHit.fetched_at,
    };
  }

  // (3) Fetch réseau (Frankfurter).
  try {
    const rates = await fetchEcbRates(from);
    const fetchedAt = new Date().toISOString();

    // Upsert chaque target dans le cache D1 (un INSERT par paire).
    const entries = Object.entries(rates);
    if (entries.length > 0) {
      const stmts = entries.map(([quote, rate]) =>
        env.DB.prepare(
          `INSERT INTO currency_rates (base_currency, quote_currency, rate, source, fetched_at)
           VALUES (?, ?, ?, 'ecb', ?)`,
        ).bind(from, quote, rate, fetchedAt),
      );
      await env.DB.batch(stmts);
    }

    const target = rates[to];
    if (typeof target === 'number' && Number.isFinite(target) && target > 0) {
      return { rate: target, source: 'ecb', fetched_at: fetchedAt };
    }
    // Fetch a réussi mais la paire demandée n'est pas retournée — tombe en (4).
  } catch {
    // Fetch failed — tombe en (4).
  }

  // (4) Stale cache (any-age) en fallback.
  const staleHit = await env.DB.prepare(
    `SELECT rate, source, fetched_at
       FROM currency_rates
      WHERE base_currency = ?
        AND quote_currency = ?
      ORDER BY fetched_at DESC
      LIMIT 1`,
  )
    .bind(from, to)
    .first<{ rate: number; source: string; fetched_at: string }>();

  if (staleHit && Number.isFinite(staleHit.rate) && staleHit.rate > 0) {
    return {
      rate: staleHit.rate,
      source: 'cached_stale',
      fetched_at: staleHit.fetched_at,
    };
  }

  // (5) Échec total.
  throw new Error('rate_unavailable');
}

/** Normalise la valeur `source` lue en D1 vers le type RateLookup. */
function normalizeSource(raw: string): RateLookup['source'] {
  if (raw === 'ecb' || raw === 'frankfurter' || raw === 'manual') return raw;
  // Valeur inattendue en D1 : on retombe sur 'manual' (entrée legacy/admin).
  return 'manual';
}
