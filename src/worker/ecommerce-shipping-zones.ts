// ── Zones & tarifs d'expédition — Sprint E5 M2 (2026-05-16) ─────────────────
//
// Backend zones/tarifs du module Boutique (B2). Une zone = regroupement
// géographique (liste de pays ISO alpha-2). Un tarif est rattaché à une zone
// et porte un prix fixe en cents + un palier optionnel de déclenchement sur le
// sous-total du panier.
//
//   - CRUD zones   : GET/POST /api/ecommerce/shipping/zones,
//                    PATCH/DELETE /api/ecommerce/shipping/zones/:zid
//   - CRUD tarifs  : GET/POST /api/ecommerce/shipping/zones/:zid/rates,
//                    PATCH/DELETE /api/ecommerce/shipping/rates/:rid
//   - Résolution   : POST /api/ecommerce/shipping/resolve (region-aware via le
//                    pays du tenant — resolveRegionContext E-R — + sous-total)
//
// Invariants stricts (NON négociables) :
//   - Multi-tenant STRICT : WHERE client_id résolu via getClientModules
//     (pattern projet, jamais de fuite cross-tenant) — cf. ecommerce-region.
//   - Gating requireModule('ecommerce') hérité du bloc /api/ecommerce/*
//     (worker.ts). Les MUTATIONS exigent en plus role admin (pattern figé
//     handleUpdateRegion : auth.role === 'admin').
//   - Résolution DÉFENSIVE : aucune zone/tarif couvrant la destination ⇒
//     {matched:false, price_cents:0} (jamais d'exception — repli marchand).
//   - Additif / non destructif : aucun type/handler existant modifié. Types
//     canoniques M1 (types.ts) IMPORTÉS, jamais redéclarés.
//
// Conventions DB : id/created_at/updated_at via DEFAULT côté schéma
// (lower(hex(randomblob(16))) / datetime('now')) — on ne les bind PAS ici.

import type { Env } from './types';
import type { ShippingZone, ShippingRate, ShippingRateResult } from '../lib/types';
import { json, audit } from './helpers';
import { getClientModules } from './modules';
import { resolveRegionContext } from './ecommerce-region';

type Auth = { userId: string; role: string };

async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

function forbidden(): Response {
  return json(
    { error: 'Non autorisé', message: 'Action réservée aux administrateurs.' },
    403,
  );
}

// ── Sérialisation / parsing pays ─────────────────────────────────────────────

/** Parse safe de countries_json → string[] de codes ISO alpha-2 majuscules. */
function parseCountries(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    for (const v of arr) {
      const cc = String(v || '').toUpperCase().trim();
      if (/^[A-Z]{2}$/.test(cc) && !out.includes(cc)) out.push(cc);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Normalise une liste de pays fournie en entrée (ISO 3166-1 alpha-2 basique).
 * Retourne null si une entrée n'est pas un code 2 lettres valide (rejet 400).
 */
function normalizeCountries(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const v of input) {
    const cc = String(v || '').toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(cc)) return null;
    if (!out.includes(cc)) out.push(cc);
  }
  return out;
}

interface ZoneRow {
  id: string;
  client_id: string;
  name: string;
  countries_json: string | null;
  created_at: string;
  updated_at: string;
}

function rowToZone(r: ZoneRow): ShippingZone {
  return {
    id: r.id,
    client_id: r.client_id,
    name: r.name,
    countries: parseCountries(r.countries_json),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

interface RateRow {
  id: string;
  client_id: string;
  zone_id: string;
  name: string;
  price_cents: number;
  min_subtotal_cents: number | null;
  max_subtotal_cents: number | null;
  created_at: string;
  updated_at: string;
}

function rowToRate(r: RateRow): ShippingRate {
  return {
    id: r.id,
    client_id: r.client_id,
    zone_id: r.zone_id,
    name: r.name,
    price_cents: r.price_cents,
    min_subtotal_cents: r.min_subtotal_cents,
    max_subtotal_cents: r.max_subtotal_cents,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** Coercion entier ≥ 0 (cents). null si absent ; null retourné si invalide. */
function coerceCents(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return NaN; // sentinelle invalide
  return n;
}

// ════════════════════════════════════════════════════════════════════════════
// M2.2 — CRUD zones
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/ecommerce/shipping/zones — zones du tenant courant. */
export async function handleListZones(env: Env, auth: Auth): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const { results } = await env.DB.prepare(
    'SELECT id, client_id, name, countries_json, created_at, updated_at FROM shipping_zones WHERE client_id = ? ORDER BY name COLLATE NOCASE',
  )
    .bind(clientId)
    .all();

  return json({ data: ((results || []) as unknown as ZoneRow[]).map(rowToZone) });
}

/** POST /api/ecommerce/shipping/zones — crée une zone (ADMIN). */
export async function handleCreateZone(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: { name?: string; countries?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const name = String(body.name || '').trim();
  if (!name || name.length > 80) {
    return json({ error: 'Nom invalide', message: 'name doit être un libellé court non vide.' }, 400);
  }
  const countries = normalizeCountries(body.countries ?? []);
  if (countries === null) {
    return json(
      { error: 'Pays invalides', message: 'countries doit être une liste de codes ISO 3166-1 alpha-2.' },
      400,
    );
  }

  const row = (await env.DB.prepare(
    'INSERT INTO shipping_zones (client_id, name, countries_json) VALUES (?, ?, ?) RETURNING id, client_id, name, countries_json, created_at, updated_at',
  )
    .bind(clientId, name, JSON.stringify(countries))
    .first()) as ZoneRow | null;

  if (!row) return json({ error: 'Création échouée' }, 500);
  await audit(env, auth.userId, 'create', 'shipping_zone', row.id, { name });
  return json({ data: rowToZone(row) }, 201);
}

/** PATCH /api/ecommerce/shipping/zones/:zid — maj partielle (ADMIN). */
export async function handleUpdateZone(
  request: Request,
  env: Env,
  auth: Auth,
  zid: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const current = (await env.DB.prepare(
    'SELECT id, client_id, name, countries_json, created_at, updated_at FROM shipping_zones WHERE id = ? AND client_id = ?',
  )
    .bind(zid, clientId)
    .first()) as ZoneRow | null;
  if (!current) return json({ error: 'Zone introuvable' }, 404);

  let body: { name?: string; countries?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  let nextName = current.name;
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n || n.length > 80) {
      return json({ error: 'Nom invalide', message: 'name doit être un libellé court non vide.' }, 400);
    }
    nextName = n;
  }

  let nextCountriesJson = current.countries_json ?? '[]';
  if (body.countries !== undefined) {
    const c = normalizeCountries(body.countries);
    if (c === null) {
      return json(
        { error: 'Pays invalides', message: 'countries doit être une liste de codes ISO 3166-1 alpha-2.' },
        400,
      );
    }
    nextCountriesJson = JSON.stringify(c);
  }

  const row = (await env.DB.prepare(
    "UPDATE shipping_zones SET name = ?, countries_json = ?, updated_at = datetime('now') WHERE id = ? AND client_id = ? RETURNING id, client_id, name, countries_json, created_at, updated_at",
  )
    .bind(nextName, nextCountriesJson, zid, clientId)
    .first()) as ZoneRow | null;

  if (!row) return json({ error: 'Mise à jour échouée' }, 500);
  await audit(env, auth.userId, 'update', 'shipping_zone', zid, {});
  return json({ data: rowToZone(row) });
}

/** DELETE /api/ecommerce/shipping/zones/:zid — supprime (ADMIN, CASCADE tarifs). */
export async function handleDeleteZone(
  env: Env,
  auth: Auth,
  zid: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const existing = await env.DB.prepare(
    'SELECT id FROM shipping_zones WHERE id = ? AND client_id = ?',
  )
    .bind(zid, clientId)
    .first();
  if (!existing) return json({ error: 'Zone introuvable' }, 404);

  // Tarifs supprimés explicitement (ON DELETE CASCADE non garanti sans
  // PRAGMA foreign_keys=ON sur D1 — suppression défensive du scope tenant).
  await env.DB.prepare('DELETE FROM shipping_rates WHERE zone_id = ? AND client_id = ?')
    .bind(zid, clientId)
    .run();
  await env.DB.prepare('DELETE FROM shipping_zones WHERE id = ? AND client_id = ?')
    .bind(zid, clientId)
    .run();

  await audit(env, auth.userId, 'delete', 'shipping_zone', zid, {});
  return json({ data: { id: zid, deleted: true } });
}

// ════════════════════════════════════════════════════════════════════════════
// M2.3 — CRUD tarifs
// ════════════════════════════════════════════════════════════════════════════

/** Valide la cohérence min/max subtotal d'un tarif. Retourne un message ou null. */
function validateThresholds(
  min: number | null,
  max: number | null,
): string | null {
  if (min !== null && Number.isNaN(min)) return 'min_subtotal_cents doit être un entier ≥ 0.';
  if (max !== null && Number.isNaN(max)) return 'max_subtotal_cents doit être un entier ≥ 0.';
  if (min !== null && max !== null && (max as number) < (min as number)) {
    return 'max_subtotal_cents doit être ≥ min_subtotal_cents.';
  }
  return null;
}

/** GET /api/ecommerce/shipping/zones/:zid/rates — tarifs d'une zone. */
export async function handleListRates(
  env: Env,
  auth: Auth,
  zid: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const zone = await env.DB.prepare(
    'SELECT id FROM shipping_zones WHERE id = ? AND client_id = ?',
  )
    .bind(zid, clientId)
    .first();
  if (!zone) return json({ error: 'Zone introuvable' }, 404);

  const { results } = await env.DB.prepare(
    'SELECT id, client_id, zone_id, name, price_cents, min_subtotal_cents, max_subtotal_cents, created_at, updated_at FROM shipping_rates WHERE zone_id = ? AND client_id = ? ORDER BY price_cents',
  )
    .bind(zid, clientId)
    .all();

  return json({ data: ((results || []) as unknown as RateRow[]).map(rowToRate) });
}

/** POST /api/ecommerce/shipping/zones/:zid/rates — crée un tarif (ADMIN). */
export async function handleCreateRate(
  request: Request,
  env: Env,
  auth: Auth,
  zid: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const zone = await env.DB.prepare(
    'SELECT id FROM shipping_zones WHERE id = ? AND client_id = ?',
  )
    .bind(zid, clientId)
    .first();
  if (!zone) return json({ error: 'Zone introuvable' }, 404);

  let body: {
    name?: string;
    price_cents?: unknown;
    min_subtotal_cents?: unknown;
    max_subtotal_cents?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const name = String(body.name || '').trim();
  if (!name || name.length > 80) {
    return json({ error: 'Nom invalide', message: 'name doit être un libellé court non vide.' }, 400);
  }
  const price = coerceCents(body.price_cents ?? 0);
  if (price === null || Number.isNaN(price)) {
    return json({ error: 'Prix invalide', message: 'price_cents doit être un entier ≥ 0.' }, 400);
  }
  const min = coerceCents(body.min_subtotal_cents);
  const max = coerceCents(body.max_subtotal_cents);
  const thresholdErr = validateThresholds(min, max);
  if (thresholdErr) return json({ error: 'Palier invalide', message: thresholdErr }, 400);

  const row = (await env.DB.prepare(
    'INSERT INTO shipping_rates (client_id, zone_id, name, price_cents, min_subtotal_cents, max_subtotal_cents) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, client_id, zone_id, name, price_cents, min_subtotal_cents, max_subtotal_cents, created_at, updated_at',
  )
    .bind(clientId, zid, name, price, min, max)
    .first()) as RateRow | null;

  if (!row) return json({ error: 'Création échouée' }, 500);
  await audit(env, auth.userId, 'create', 'shipping_rate', row.id, { zone_id: zid, name });
  return json({ data: rowToRate(row) }, 201);
}

/** PATCH /api/ecommerce/shipping/rates/:rid — maj partielle (ADMIN). */
export async function handleUpdateRate(
  request: Request,
  env: Env,
  auth: Auth,
  rid: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const current = (await env.DB.prepare(
    'SELECT id, client_id, zone_id, name, price_cents, min_subtotal_cents, max_subtotal_cents, created_at, updated_at FROM shipping_rates WHERE id = ? AND client_id = ?',
  )
    .bind(rid, clientId)
    .first()) as RateRow | null;
  if (!current) return json({ error: 'Tarif introuvable' }, 404);

  let body: {
    name?: string;
    price_cents?: unknown;
    min_subtotal_cents?: unknown;
    max_subtotal_cents?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  let nextName = current.name;
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n || n.length > 80) {
      return json({ error: 'Nom invalide', message: 'name doit être un libellé court non vide.' }, 400);
    }
    nextName = n;
  }

  let nextPrice = current.price_cents;
  if (body.price_cents !== undefined) {
    const p = coerceCents(body.price_cents);
    if (p === null || Number.isNaN(p)) {
      return json({ error: 'Prix invalide', message: 'price_cents doit être un entier ≥ 0.' }, 400);
    }
    nextPrice = p;
  }

  let nextMin = current.min_subtotal_cents;
  if (body.min_subtotal_cents !== undefined) {
    const m = coerceCents(body.min_subtotal_cents);
    if (m !== null && Number.isNaN(m)) {
      return json({ error: 'Palier invalide', message: 'min_subtotal_cents doit être un entier ≥ 0.' }, 400);
    }
    nextMin = m;
  }

  let nextMax = current.max_subtotal_cents;
  if (body.max_subtotal_cents !== undefined) {
    const m = coerceCents(body.max_subtotal_cents);
    if (m !== null && Number.isNaN(m)) {
      return json({ error: 'Palier invalide', message: 'max_subtotal_cents doit être un entier ≥ 0.' }, 400);
    }
    nextMax = m;
  }

  const thresholdErr = validateThresholds(nextMin, nextMax);
  if (thresholdErr) return json({ error: 'Palier invalide', message: thresholdErr }, 400);

  const row = (await env.DB.prepare(
    "UPDATE shipping_rates SET name = ?, price_cents = ?, min_subtotal_cents = ?, max_subtotal_cents = ?, updated_at = datetime('now') WHERE id = ? AND client_id = ? RETURNING id, client_id, zone_id, name, price_cents, min_subtotal_cents, max_subtotal_cents, created_at, updated_at",
  )
    .bind(nextName, nextPrice, nextMin, nextMax, rid, clientId)
    .first()) as RateRow | null;

  if (!row) return json({ error: 'Mise à jour échouée' }, 500);
  await audit(env, auth.userId, 'update', 'shipping_rate', rid, {});
  return json({ data: rowToRate(row) });
}

/** DELETE /api/ecommerce/shipping/rates/:rid — supprime (ADMIN). */
export async function handleDeleteRate(
  env: Env,
  auth: Auth,
  rid: string,
): Promise<Response> {
  if (auth.role !== 'admin') return forbidden();
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const existing = await env.DB.prepare(
    'SELECT id FROM shipping_rates WHERE id = ? AND client_id = ?',
  )
    .bind(rid, clientId)
    .first();
  if (!existing) return json({ error: 'Tarif introuvable' }, 404);

  await env.DB.prepare('DELETE FROM shipping_rates WHERE id = ? AND client_id = ?')
    .bind(rid, clientId)
    .run();

  await audit(env, auth.userId, 'delete', 'shipping_rate', rid, {});
  return json({ data: { id: rid, deleted: true } });
}

// ════════════════════════════════════════════════════════════════════════════
// M2.4 — Résolution region-aware
// ════════════════════════════════════════════════════════════════════════════

const NO_MATCH: ShippingRateResult = {
  zone_id: null,
  rate_id: null,
  name: null,
  price_cents: 0,
  matched: false,
};

/**
 * Résout le tarif d'expédition applicable pour un tenant donné.
 *
 * Region-aware : le pays cible vient de `country` si fourni, sinon du
 * contexte région du tenant (resolveRegionContext E-R — devise/région).
 * Stratégie : on retient la PREMIÈRE zone du tenant dont la liste de pays
 * couvre la destination, puis le tarif le MOINS cher dont le palier
 * (min/max subtotal) est satisfait par `subtotal_cents`. Aucun tarif
 * éligible ⇒ repli défensif {matched:false, price_cents:0} — JAMAIS
 * d'exception (pattern défensif ecommerce-invoice / no_zone).
 */
export async function resolveShippingRate(
  env: Env,
  clientId: string,
  opts: {
    country?: string | null;
    weight_grams?: number | null;
    subtotal_cents?: number | null;
    currency?: string | null;
  },
): Promise<ShippingRateResult> {
  try {
    if (!clientId) return { ...NO_MATCH };

    // Pays cible : explicite > contexte région tenant.
    let country = String(opts.country || '').toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(country)) {
      try {
        const ctx = await resolveRegionContext(env, clientId);
        country = String(ctx.country || '').toUpperCase().trim();
      } catch {
        country = '';
      }
    }
    if (!/^[A-Z]{2}$/.test(country)) return { ...NO_MATCH };

    const subtotal = Number.isFinite(Number(opts.subtotal_cents))
      ? Math.max(0, Math.trunc(Number(opts.subtotal_cents)))
      : 0;

    const { results: zoneRows } = await env.DB.prepare(
      'SELECT id, client_id, name, countries_json, created_at, updated_at FROM shipping_zones WHERE client_id = ? ORDER BY created_at',
    )
      .bind(clientId)
      .all();

    const zones = (zoneRows || []) as unknown as ZoneRow[];
    const zone = zones.find((z) => parseCountries(z.countries_json).includes(country));
    if (!zone) return { ...NO_MATCH };

    const { results: rateRows } = await env.DB.prepare(
      'SELECT id, client_id, zone_id, name, price_cents, min_subtotal_cents, max_subtotal_cents, created_at, updated_at FROM shipping_rates WHERE zone_id = ? AND client_id = ? ORDER BY price_cents',
    )
      .bind(zone.id, clientId)
      .all();

    const rates = (rateRows || []) as unknown as RateRow[];
    // Premier tarif (le moins cher — tri SQL price_cents) dont le palier
    // de sous-total est satisfait.
    const eligible = rates.find((r) => {
      const minOk = r.min_subtotal_cents == null || subtotal >= r.min_subtotal_cents;
      const maxOk = r.max_subtotal_cents == null || subtotal <= r.max_subtotal_cents;
      return minOk && maxOk;
    });

    if (!eligible) {
      // Zone trouvée mais aucun tarif éligible : on expose la zone, repli prix 0.
      return { zone_id: zone.id, rate_id: null, name: null, price_cents: 0, matched: false };
    }

    return {
      zone_id: zone.id,
      rate_id: eligible.id,
      name: eligible.name,
      price_cents: eligible.price_cents,
      matched: true,
    };
  } catch {
    // Garde défensive ultime — la résolution ne lève JAMAIS.
    return { ...NO_MATCH };
  }
}

/** POST /api/ecommerce/shipping/resolve — résout le tarif pour le tenant. */
export async function handleResolveShippingRate(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: {
    country?: string | null;
    weight_grams?: number | null;
    subtotal_cents?: number | null;
    currency?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await resolveShippingRate(env, clientId, {
    country: body.country ?? null,
    weight_grams: body.weight_grams ?? null,
    subtotal_cents: body.subtotal_cents ?? null,
    currency: body.currency ?? null,
  });

  return json({ data: result });
}
