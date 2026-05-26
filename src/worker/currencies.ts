// ── Currencies — Sprint 39 impl (2026-05-24, A3) ──────────────────────────
//
// Handlers REST cache devises (`currency_rates` seq134). 4 endpoints :
//   - GET  /api/currencies                       → list devises supportées (public)
//   - GET  /api/currencies/rates                 → list cache rates (filtres)
//   - POST /api/currencies/rates/refresh         → refresh ECB (admin)
//   - POST /api/currencies/rates/override        → override manuel (admin)
//
// Capability `settings.manage` sur /rates et mutations (FIGÉE seq80). La route
// /api/currencies sert une liste STATIQUE des devises supportées (lecture
// publique authentifiée — pas de cap : data calque la const SUPPORTED).
//
// Réponses normalisées :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)        ← JAMAIS de champ `code`
//
// Bornage multi-tenant : currency_rates est PARTAGÉ (pas de client_id — taux
// globaux). Seul l'override manuel est borné `settings.manage` (admin tenant).

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { fetchEcbRates } from './lib/currency-converter';
import type { SupportedCurrencyExt } from '../lib/types';

type Auth = CapAuth & { capabilities?: Set<string> };

/** Résout capabilities (préférer celles injectées au choke-point). */
async function getCaps(env: Env, auth: Auth): Promise<Set<string>> {
  return auth.capabilities instanceof Set
    ? auth.capabilities
    : await resolveCapabilities(env, auth);
}

/** Garde-fou commun : `settings.manage` requis pour routes /rates et mutations. */
async function requireSettingsManage(env: Env, auth: Auth): Promise<Response | null> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'settings.manage');
  return denied || null;
}

// ── Liste statique des devises supportées ─────────────────────────────────
const SUPPORTED_CURRENCIES: ReadonlyArray<{ code: SupportedCurrencyExt; symbol: string }> = [
  { code: 'CAD', symbol: 'CA$' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'DZD', symbol: 'دج' },
  { code: 'MAD', symbol: 'د.م.' },
];

const VALID_CURRENCY_CODES = new Set<string>(
  SUPPORTED_CURRENCIES.map((c) => c.code),
);

// ── Handlers ──────────────────────────────────────────────────────────────

/**
 * GET /api/currencies — liste statique des devises supportées par le moteur
 * multi-currency. Lecture publique authentifiée (pas de cap : data fixe).
 */
export async function handleListCurrencies(
  _env: Env,
  _auth: Auth,
): Promise<Response> {
  try {
    return json({ data: SUPPORTED_CURRENCIES.map((c) => ({ ...c })) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * GET /api/currencies/rates — liste cache taux (filtres optionnels via query :
 *   ?base=CAD&quote=USD&limit=50).
 * SELECT ordonné DESC sur fetched_at (plus récent d'abord).
 */
export async function handleListRates(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    const base = url.searchParams.get('base');
    const quote = url.searchParams.get('quote');
    const limitRaw = url.searchParams.get('limit');
    let limit = Number.parseInt(limitRaw || '100', 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 500) limit = 500;

    const conds: string[] = [];
    const bindings: unknown[] = [];
    if (base && typeof base === 'string') {
      conds.push('base_currency = ?');
      bindings.push(base.toUpperCase());
    }
    if (quote && typeof quote === 'string') {
      conds.push('quote_currency = ?');
      bindings.push(quote.toUpperCase());
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

    const { results } = await env.DB.prepare(
      `SELECT id, base_currency, quote_currency, rate, source, fetched_at, created_at
       FROM currency_rates
       ${where}
       ORDER BY fetched_at DESC
       LIMIT ?`,
    )
      .bind(...bindings, limit)
      .all();

    return json({ data: results || [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/currencies/rates/refresh — déclenche refresh ECB (Frankfurter)
 * pour une devise base (default EUR). Pour chaque paire (base, quote) ⇒ INSERT
 * dans `currency_rates` avec source='ecb' et fetched_at=now.
 * Body : { base?: SupportedCurrencyExt } (default 'EUR').
 */
export async function handleRefreshRates(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    let base: SupportedCurrencyExt = 'EUR';
    if (typeof body.base === 'string' && body.base.length > 0) {
      const candidate = body.base.toUpperCase();
      if (!VALID_CURRENCY_CODES.has(candidate)) {
        return json(
          { error: 'base invalide (valeurs : CAD|USD|EUR|DZD|MAD)' },
          400,
        );
      }
      base = candidate as SupportedCurrencyExt;
    }

    const rates = await fetchEcbRates(base);
    const fetchedAt = new Date().toISOString();
    let updated = 0;

    for (const [quote, rate] of Object.entries(rates)) {
      const quoteUp = quote.toUpperCase();
      if (!VALID_CURRENCY_CODES.has(quoteUp)) continue;
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) continue;
      if (quoteUp === base) continue;

      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO currency_rates
             (id, base_currency, quote_currency, rate, source, fetched_at, created_at)
           VALUES (?, ?, ?, ?, 'ecb', ?, datetime('now'))`,
        )
          .bind(id, base, quoteUp, rate, fetchedAt)
          .run();
        updated += 1;
      } catch {
        // Ignore single-row failure ; continue batch.
      }
    }

    await audit(env, auth.userId, 'currency_rates_refreshed', 'currency_rates', base, {
      base,
      updated,
      fetched_at: fetchedAt,
    });

    return json({ data: { updated, fetched_at: fetchedAt, base } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/currencies/rates/override — override manuel admin pour une paire.
 * Body : { base, quote, rate }. INSERT avec source='manual'.
 */
export async function handleSetManualRate(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const denied = await requireSettingsManage(env, auth);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const baseRaw = typeof body.base === 'string' ? body.base.toUpperCase() : '';
    const quoteRaw = typeof body.quote === 'string' ? body.quote.toUpperCase() : '';
    const rate = typeof body.rate === 'number' ? body.rate : Number.NaN;

    if (!baseRaw || !VALID_CURRENCY_CODES.has(baseRaw)) {
      return json(
        { error: 'base invalide (valeurs : CAD|USD|EUR|DZD|MAD)' },
        400,
      );
    }
    if (!quoteRaw || !VALID_CURRENCY_CODES.has(quoteRaw)) {
      return json(
        { error: 'quote invalide (valeurs : CAD|USD|EUR|DZD|MAD)' },
        400,
      );
    }
    if (baseRaw === quoteRaw) {
      return json({ error: 'base et quote doivent différer' }, 400);
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      return json({ error: 'rate doit être un nombre > 0' }, 400);
    }

    const id = crypto.randomUUID();
    const fetchedAt = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO currency_rates
         (id, base_currency, quote_currency, rate, source, fetched_at, created_at)
       VALUES (?, ?, ?, ?, 'manual', ?, datetime('now'))`,
    )
      .bind(id, baseRaw, quoteRaw, rate, fetchedAt)
      .run();

    await audit(env, auth.userId, 'currency_rate_manual_override', 'currency_rates', id, {
      base: baseRaw,
      quote: quoteRaw,
      rate,
    });

    return json({
      data: {
        id,
        base_currency: baseRaw,
        quote_currency: quoteRaw,
        rate,
        source: 'manual',
        fetched_at: fetchedAt,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
