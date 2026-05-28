// ── catalog.ts — LOT CATALOGUE DE SERVICES — Phase B Manager-B (corps réels) ──
//
// Signatures FIGÉES Phase A (docs/LOT-CATALOG.md §6.E/§6.H). Ce fichier
// appartient en EXCLUSIVITÉ à Manager-B. worker.ts / api.ts / migration seq 118 /
// 4 catalogues i18n / docs = GELÉS Phase A — NON touchés ici. Manager-B NE
// TOUCHE PAS quotes.ts ni ecommerce-products.ts (lecture/import seulement).
//
// Contrat de retour GELÉ (apiFetch, §6.A) : succès = json({ data }) ; erreur =
//   json({ error: '<msg>' }, status). JAMAIS de champ `code`.
//
// MONEY — catalog_items.unit_price en DOLLARS REAL (aligné quote_items seq 82,
//   PAS cents). L'import depuis `products` CONVERTIT base_price/100 → dollars.
//
// GATING — routes /api/catalog/* sous requireAuth SEUL (worker.ts), PAS
//   requireModule('ecommerce') : un catalogue de services vit SANS Boutique.
//
// Bornage tenant = calque ecommerce-products.ts resolveClientId + quotes.ts
//   loadQuoteScoped/isLegacy. Mutations gardées par capGuard('invoices.write')
//   mode-agence-only (calque quotes.ts:53 — devis/catalogue = même domaine
//   pré-comptable). Lectures = pas de garde bloquante (bornage tenant suffit).
//   try/catch best-effort : table seq 118 absente ⇒ { data: [] } / réponse
//   propre, JAMAIS de throw/500.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { getClientModules } from './modules';
import { requireCapability, type Capability } from './capabilities';
// Renforcement V2 — helpers PUR engine (validation kind/recurrence).
import {
  isValidKind,
  isValidRecurrence,
} from './lib/catalog-engine';

// auth = CapAuth enrichi choke-point (worker.ts) — calque QuoteAuth (quotes.ts:42).
type CatalogAuth = {
  userId: string;
  role: string;
  clientId?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
};

// ── Garde capability CONDITIONNELLE (mode-agence-only) ──────────────────────
// Calque byte-identique de quotes.ts:53 / billing.ts. Legacy/mono-tenant/
// api-key/tests ⇒ condition FALSE ⇒ skip ⇒ comportement BYTE-IDENTIQUE.
function capGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> },
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;
}

// Vrai si l'appel est legacy/mono-tenant (calque quotes.ts:64 / team.ts:isLegacy).
function isLegacy(auth?: CatalogAuth): boolean {
  return !auth?.tenant || auth.tenant.agencyId == null;
}

/** Résout le client_id du tenant courant (calque ecommerce-products.ts:31). */
async function resolveClientId(env: Env, auth: CatalogAuth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

// kind/recurrence gardés APPLICATIVEMENT (pas de CHECK SQL — seq 118).
// Renforcement V2 — whitelists centralisées dans catalog-engine.
const SEARCH_LIMIT = 20;

function normKind(raw: unknown, fallback = 'service'): string {
  const v = sanitizeInput(typeof raw === 'string' ? raw : '', 40);
  return isValidKind(v) ? v : fallback;
}

function normRecurrence(raw: unknown, fallback = 'one_time'): string {
  const v = sanitizeInput(typeof raw === 'string' ? raw : '', 40);
  return isValidRecurrence(v) ? v : fallback;
}

// Charge un item de catalogue borné tenant. Renvoie la row, ou null si
// introuvable/hors périmètre (calque quotes.ts:loadQuoteScoped — on confirme
// l'appartenance AVANT toute mutation).
async function loadItemScoped(
  env: Env,
  itemId: string,
  auth: CatalogAuth,
): Promise<Record<string, unknown> | null> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM catalog_items WHERE id = ?')
      .bind(itemId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  if (!row) return null;
  if (isLegacy(auth)) return row;

  // Mode agence : la pièce doit appartenir au périmètre.
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowAgency = row.agency_id == null ? null : String(row.agency_id);
  const rowClient = row.client_id == null ? null : String(row.client_id);
  const inTenant =
    (rowAgency != null && rowAgency === agencyId) ||
    (rowClient != null && accessible.includes(rowClient));
  return inTenant ? row : null;
}

// ════════════════════════════════════════════════════════════════════════════
// CRUD catalog_items — stubs Phase A (corps réels Manager-B)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/catalog/items — liste bornée tenant. Filtres optionnels (kind,
// category, is_active) en query. Lecture : pas de capGuard bloquant.
export async function handleListCatalogItems(
  _request: Request,
  env: Env,
  auth: CatalogAuth,
  url: URL,
): Promise<Response> {
  // Filtres optionnels (query). kind/is_active validés applicativement.
  const where: string[] = [];
  const params: unknown[] = [];

  const kind = sanitizeInput(url.searchParams.get('kind') || '', 40);
  if (kind && isValidKind(kind)) {
    where.push('kind = ?');
    params.push(kind);
  }
  const category = sanitizeInput(url.searchParams.get('category') || '', 100);
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  const isActiveRaw = url.searchParams.get('is_active');
  if (isActiveRaw === 'true' || isActiveRaw === '1') {
    where.push('is_active = 1');
  } else if (isActiveRaw === 'false' || isActiveRaw === '0') {
    where.push('is_active = 0');
  }

  // Bornage tenant (calque quotes.ts:handleListQuotes). Legacy ⇒ scope complet ;
  // mode agence ⇒ agency_id OU client_id ∈ accessibleClientIds.
  if (!isLegacy(auth)) {
    const agencyId = auth.tenant!.agencyId as string;
    const accessible = auth.tenant!.accessibleClientIds || [];
    const placeholders = accessible.map(() => '?').join(',');
    where.push(
      placeholders
        ? `(agency_id = ? OR client_id IN (${placeholders}))`
        : 'agency_id = ?',
    );
    params.push(agencyId, ...accessible);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM catalog_items ${whereSql} ORDER BY name ASC LIMIT 200`,
    )
      .bind(...params)
      .all();
    return json({ data: results || [] });
  } catch {
    // Table seq 118 absente / panne D1 : réponse propre, jamais de 500/throw.
    return json({ data: [] });
  }
}

// POST /api/catalog/items — crée un item. capGuard invoices.write (mutation).
export async function handleCreateCatalogItem(
  _request: Request,
  _env: Env,
  auth: CatalogAuth,
): Promise<Response> {
  const cg = capGuard(auth, 'invoices.write');
  if (cg) return cg;

  let body: Record<string, unknown>;
  try {
    body = (await _request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const name = sanitizeInput(body.name as string, 200);
  if (!name) return json({ error: 'Le nom est requis' }, 400);

  const description = sanitizeInput((body.description as string) || '', 5000) || null;
  const kind = normKind(body.kind); // DEFAULT 'service'
  const recurrence = normRecurrence(body.recurrence); // DEFAULT 'one_time'
  const unitPrice = Number.isFinite(Number(body.unit_price))
    ? Math.max(0, Number(body.unit_price)) // DOLLARS REAL (PAS cents)
    : 0;
  const currency = sanitizeInput((body.currency as string) || 'CAD', 8) || 'CAD';
  const category = sanitizeInput((body.category as string) || '', 100) || null;
  const isActive = body.is_active === false || body.is_active === 0 ? 0 : 1;

  // Bornage tenant : client_id/agency_id résolus SERVEUR, jamais body.
  const clientId = await resolveClientId(_env, auth);
  const agencyId = !isLegacy(auth) ? (auth.tenant!.agencyId as string) : null;

  const id = crypto.randomUUID();
  try {
    await _env.DB.prepare(
      `INSERT INTO catalog_items
         (id, client_id, agency_id, name, description, kind, unit_price,
          currency, category, recurrence, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id, clientId, agencyId, name, description, kind, unitPrice,
        currency, category, recurrence, isActive,
      )
      .run();
  } catch {
    return json({ error: "Impossible de créer l'élément du catalogue" }, 400);
  }

  return json(
    {
      data: {
        id,
        name,
        description,
        kind,
        unit_price: unitPrice,
        currency,
        category,
        recurrence,
        is_active: isActive,
        product_id: null,
      },
    },
    201,
  );
}

// PATCH /api/catalog/items/:id — met à jour un item borné tenant. capGuard.
export async function handleUpdateCatalogItem(
  _request: Request,
  env: Env,
  auth: CatalogAuth,
  itemId: string,
): Promise<Response> {
  const cg = capGuard(auth, 'invoices.write');
  if (cg) return cg;

  // Charge l'item borné tenant AVANT mutation (404 si hors périmètre).
  const existing = await loadItemScoped(env, itemId, auth);
  if (!existing) return json({ error: 'Élément introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await _request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  // UPDATE PARTIEL : seuls les champs fournis sont touchés.
  const sets: string[] = [];
  const params: unknown[] = [];

  if (typeof body.name === 'string') {
    const name = sanitizeInput(body.name, 200);
    if (!name) return json({ error: 'Le nom ne peut pas être vide' }, 400);
    sets.push('name = ?');
    params.push(name);
  }
  if ('description' in body) {
    sets.push('description = ?');
    params.push(sanitizeInput((body.description as string) || '', 5000) || null);
  }
  if (typeof body.kind === 'string') {
    sets.push('kind = ?');
    params.push(normKind(body.kind, String(existing.kind ?? 'service')));
  }
  if ('unit_price' in body && Number.isFinite(Number(body.unit_price))) {
    sets.push('unit_price = ?');
    params.push(Math.max(0, Number(body.unit_price))); // DOLLARS REAL
  }
  if (typeof body.currency === 'string') {
    sets.push('currency = ?');
    params.push(sanitizeInput(body.currency, 8) || 'CAD');
  }
  if ('category' in body) {
    sets.push('category = ?');
    params.push(sanitizeInput((body.category as string) || '', 100) || null);
  }
  if (typeof body.recurrence === 'string') {
    sets.push('recurrence = ?');
    params.push(normRecurrence(body.recurrence, String(existing.recurrence ?? 'one_time')));
  }
  if ('is_active' in body) {
    sets.push('is_active = ?');
    params.push(body.is_active === false || body.is_active === 0 ? 0 : 1);
  }

  if (sets.length === 0) return json({ data: { success: true } });

  sets.push("updated_at = datetime('now')");
  try {
    await env.DB.prepare(
      `UPDATE catalog_items SET ${sets.join(', ')} WHERE id = ?`,
    )
      .bind(...params, itemId)
      .run();
  } catch {
    return json({ error: "Mise à jour impossible" }, 400);
  }
  return json({ data: { success: true } });
}

// DELETE /api/catalog/items/:id — supprime (ou désactive) un item. capGuard.
export async function handleDeleteCatalogItem(
  _request: Request,
  env: Env,
  auth: CatalogAuth,
  itemId: string,
): Promise<Response> {
  const cg = capGuard(auth, 'invoices.write');
  if (cg) return cg;

  // Charge l'item borné tenant AVANT mutation (404 si hors périmètre).
  const existing = await loadItemScoped(env, itemId, auth);
  if (!existing) return json({ error: 'Élément introuvable' }, 404);

  try {
    await env.DB.prepare('DELETE FROM catalog_items WHERE id = ?')
      .bind(itemId)
      .run();
  } catch {
    return json({ error: 'Suppression impossible' }, 400);
  }
  return json({ data: { success: true } });
}

// GET /api/catalog/search?q= — recherche légère (name + description), bornée
// tenant. Calque ecommerce-products.ts handleListProducts search (title+name).
// Lecture : pas de capGuard bloquant.
export async function handleSearchCatalogItems(
  _request: Request,
  env: Env,
  auth: CatalogAuth,
  url: URL,
): Promise<Response> {
  const q = sanitizeInput(url.searchParams.get('q') || '', 200);

  // is_active = 1 + recherche name/description (calque ecommerce-products.ts
  // handleListProducts search : title LIKE → ici name LIKE OR description LIKE).
  const where: string[] = ['is_active = 1'];
  const params: unknown[] = [];
  if (q) {
    where.push('(name LIKE ? OR description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  // Bornage tenant (calque handleListQuotes).
  if (!isLegacy(auth)) {
    const agencyId = auth.tenant!.agencyId as string;
    const accessible = auth.tenant!.accessibleClientIds || [];
    const placeholders = accessible.map(() => '?').join(',');
    where.push(
      placeholders
        ? `(agency_id = ? OR client_id IN (${placeholders}))`
        : 'agency_id = ?',
    );
    params.push(agencyId, ...accessible);
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM catalog_items WHERE ${where.join(' AND ')} ORDER BY name ASC LIMIT ${SEARCH_LIMIT}`,
    )
      .bind(...params)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// POST /api/catalog/import-products — (optionnel) importe les produits Boutique
// dans le catalogue. capGuard invoices.write (mutation). LECTURE products
// uniquement (ne modifie PAS products / ecommerce-products.ts).
export async function handleImportCatalogFromProducts(
  _request: Request,
  env: Env,
  auth: CatalogAuth,
): Promise<Response> {
  const cg = capGuard(auth, 'invoices.write');
  if (cg) return cg;

  // Bornage tenant : import borné au client courant (jamais body).
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return json({ data: { imported: 0 } });
  const agencyId = !isLegacy(auth) ? (auth.tenant!.agencyId as string) : null;

  let imported = 0;
  try {
    // LECTURE seule de products (NE MODIFIE PAS products/ecommerce-products.ts).
    const { results } = await env.DB.prepare(
      `SELECT id, title, description, base_price, product_type, currency
         FROM products WHERE client_id = ?`,
    )
      .bind(clientId)
      .all();

    for (const p of (results || []) as Record<string, unknown>[]) {
      const productId = p.id == null ? null : String(p.id);
      if (!productId) continue;

      // Idempotence : ignore les produits déjà importés (product_id présent).
      let already: unknown = null;
      try {
        already = await env.DB.prepare(
          'SELECT id FROM catalog_items WHERE client_id = ? AND product_id = ?',
        )
          .bind(clientId, productId)
          .first();
      } catch {
        already = null;
      }
      if (already) continue;

      const name = sanitizeInput(String(p.title ?? ''), 200);
      if (!name) continue;
      const description = sanitizeInput(String(p.description ?? ''), 5000) || null;
      // Mapping cents → DOLLARS : products.base_price (CENTS INTEGER) / 100.
      const cents = Number.isFinite(Number(p.base_price)) ? Number(p.base_price) : 0;
      const unitPrice = Math.max(0, cents) / 100;
      // kind selon product_type, validé applicativement (DEFAULT 'product').
      const kind = normKind(p.product_type, 'product');
      const currency = sanitizeInput(String(p.currency ?? 'CAD'), 8) || 'CAD';

      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO catalog_items
             (id, client_id, agency_id, name, description, kind, unit_price,
              currency, product_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(id, clientId, agencyId, name, description, kind, unitPrice, currency, productId)
          .run();
        imported += 1;
      } catch {
        // best-effort : un échec d'INSERT n'arrête pas l'import global.
      }
    }
  } catch {
    // products absent / panne D1 : best-effort, jamais de 500/throw.
    return json({ data: { imported } });
  }

  return json({ data: { imported } });
}
