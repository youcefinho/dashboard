// ── Catalogue produits enrichi — Sprint E2 M1 (2026-05-16) ───────────────────
//
// Enrichit le skeleton E1 (src/worker/ecommerce.ts) : produits CRUD complet
// avec relations (variantes / images / catégories), gestion des collections
// hiérarchiques, images + SEO, et un endpoint public léger lecture catalogue.
//
// Conventions strictes du projet :
//  - Money toujours en cents INTEGER (jamais de float, jamais de TPS/TVQ ici).
//  - Multi-tenant STRICT : tout filtré WHERE client_id = ? (résolu via le
//    helper M2 getClientModules, jamais de fuite cross-tenant).
//  - Gating requireModule('ecommerce') géré AMONT par src/worker.ts.
//  - id TEXT applicatif via crypto.randomUUID() (cohérent skeleton E1).
//  - Réutilise json / sanitizeInput / audit (helpers partagés, zéro dup).
//
// Toutes les routes sont gated par requireModule(env, userId, 'ecommerce')
// AVANT d'atteindre ces handlers (cf. src/worker.ts § E-commerce).

import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';
import { getClientModules } from './modules';

type Auth = { userId: string; role: string };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/** Résout le client_id du tenant courant (réutilise le helper M2). */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

function parsePaging(url: URL): { limit: number; offset: number } {
  const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') || '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

/** Slugifie une chaîne (FR accents tolérés → ascii kebab). */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les diacritiques (accents FR)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Garantit un slug unique pour (client_id, table). Suffixe -2, -3… si collision.
 * `excludeId` permet l'update d'un même enregistrement sans faux positif.
 */
async function uniqueSlug(
  env: Env,
  table: 'products' | 'product_categories',
  clientId: string,
  base: string,
  excludeId?: string,
): Promise<string> {
  const root = base || crypto.randomUUID().slice(0, 8);
  let candidate = root;
  let n = 1;
  // Boucle bornée (garde-fou anti-boucle infinie)
  while (n < 100) {
    const row = excludeId
      ? await env.DB.prepare(
          `SELECT id FROM ${table} WHERE client_id = ? AND slug = ? AND id != ?`,
        ).bind(clientId, candidate, excludeId).first()
      : await env.DB.prepare(
          `SELECT id FROM ${table} WHERE client_id = ? AND slug = ?`,
        ).bind(clientId, candidate).first();
    if (!row) return candidate;
    n += 1;
    candidate = `${root}-${n}`.slice(0, 80);
  }
  return `${root}-${crypto.randomUUID().slice(0, 6)}`.slice(0, 80);
}

// ════════════════════════════════════════════════════════════════════════════
// M1.1 — PRODUCTS CRUD complet
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ecommerce/products
 * Filtres : status, category_id, search (title | variant SKU). Tri : sort=
 *   created_desc (défaut) | created_asc | title_asc | title_desc |
 *   price_asc | price_desc.
 */
export async function handleListProducts(env: Env, auth: Auth, url: URL): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  const { limit, offset } = parsePaging(url);

  const status = url.searchParams.get('status');
  const categoryId = url.searchParams.get('category_id');
  const search = sanitizeInput(url.searchParams.get('search') || '', 200);
  const sort = url.searchParams.get('sort') || 'created_desc';

  const where: string[] = ['p.client_id = ?'];
  const params: unknown[] = [clientId];

  if (status && ['draft', 'active', 'archived'].includes(status)) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (categoryId) {
    where.push(
      'p.id IN (SELECT product_id FROM product_category_links WHERE category_id = ?)',
    );
    params.push(categoryId);
  }
  if (search) {
    where.push(
      `(p.title LIKE ? OR p.id IN (
         SELECT product_id FROM product_variants WHERE sku LIKE ?
       ))`,
    );
    params.push(`%${search}%`, `%${search}%`);
  }

  const orderMap: Record<string, string> = {
    created_desc: 'p.created_at DESC',
    created_asc: 'p.created_at ASC',
    title_asc: 'p.title ASC',
    title_desc: 'p.title DESC',
    price_asc: 'p.base_price ASC',
    price_desc: 'p.base_price DESC',
  };
  const orderBy = orderMap[sort] || orderMap.created_desc;
  const whereSql = where.join(' AND ');

  const countRow = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM products p WHERE ${whereSql}`,
  ).bind(...params).first()) as { n: number } | null;

  // Sprint E3 M1 — fix join inventaire : agrège le disponible (quantity -
  // reserved) sur toutes les variantes du produit (corrige la limitation E2
  // « stock — » : LEFT JOIN inventory pour ne pas exclure les variantes sans
  // ligne stock encore créée).
  const { results } = await env.DB.prepare(
    `SELECT p.*,
       (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variants_count,
       (SELECT url FROM product_images i WHERE i.product_id = p.id
          ORDER BY i.position ASC LIMIT 1) AS primary_image,
       (SELECT COALESCE(SUM(iv.quantity), 0)
          FROM product_variants v
          LEFT JOIN inventory iv ON iv.variant_id = v.id
         WHERE v.product_id = p.id) AS stock_quantity,
       (SELECT COALESCE(SUM(iv.quantity - iv.reserved), 0)
          FROM product_variants v
          LEFT JOIN inventory iv ON iv.variant_id = v.id
         WHERE v.product_id = p.id) AS stock_available
     FROM products p
     WHERE ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
  ).bind(...params, limit, offset).all();

  return json({ data: results || [], total: countRow?.n || 0, limit, offset });
}

/**
 * GET /api/ecommerce/products/:id
 * Produit + variantes + images + catégories jointes.
 */
export async function handleGetProduct(env: Env, auth: Auth, id: string): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).first();
  if (!product) return json({ error: 'Produit introuvable' }, 404);

  // Sprint E3 M1 — fix join inventaire : chaque variante expose son stock
  // (quantity + available = quantity - reserved). LEFT JOIN pour ne pas perdre
  // les variantes dont la ligne inventory n'a pas encore été créée.
  const { results: variants } = await env.DB.prepare(
    `SELECT v.*,
        COALESCE(iv.quantity, 0) AS quantity,
        COALESCE(iv.reserved, 0) AS reserved,
        COALESCE(iv.quantity - iv.reserved, 0) AS available
       FROM product_variants v
       LEFT JOIN inventory iv ON iv.variant_id = v.id
      WHERE v.product_id = ?
      ORDER BY v.position ASC, v.created_at ASC`,
  ).bind(id).all();

  const { results: images } = await env.DB.prepare(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY position ASC, created_at ASC',
  ).bind(id).all();

  const { results: categories } = await env.DB.prepare(
    `SELECT c.* FROM product_categories c
       JOIN product_category_links l ON l.category_id = c.id
       WHERE l.product_id = ? AND c.client_id = ?
       ORDER BY c.sort_order ASC, c.name ASC`,
  ).bind(id, clientId).all();

  return json({
    data: {
      ...product,
      variants: variants || [],
      images: images || [],
      categories: categories || [],
    },
  });
}

/**
 * POST /api/ecommerce/products
 * Slug unique auto depuis title, base_price ≥ 0 (cents), status défaut draft.
 * SEO fallback : seo_title = title si vide. Crée au moins 1 variante "Default".
 */
export async function handleCreateProduct(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const title = sanitizeInput(body.title as string, 200);
  if (!title) return json({ error: 'Le titre du produit est requis' }, 400);

  const baseSlug = slugify(sanitizeInput((body.slug as string) || '', 200) || title);
  const slug = await uniqueSlug(env, 'products', clientId, baseSlug);

  const description = sanitizeInput((body.description as string) || '', 5000);
  const status = ['draft', 'active', 'archived'].includes(body.status as string)
    ? (body.status as string)
    : 'draft';
  const basePrice = Number.isFinite(body.base_price as number)
    ? Math.max(0, Math.round(body.base_price as number))
    : 0; // cents
  const productType = sanitizeInput((body.product_type as string) || '', 100);
  const vendor = sanitizeInput((body.vendor as string) || '', 100);
  const currency = sanitizeInput((body.currency as string) || 'CAD', 8) || 'CAD';
  const taxClass = sanitizeInput((body.tax_class as string) || 'standard', 50) || 'standard';
  const seoTitle = sanitizeInput((body.seo_title as string) || '', 200) || title;
  const seoDescription =
    sanitizeInput((body.seo_description as string) || '', 320) ||
    description.slice(0, 200);

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO products
        (id, client_id, title, slug, description, status, product_type, vendor,
         base_price, currency, tax_class, seo_title, seo_description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, clientId, title, slug, description, status, productType, vendor,
      basePrice, currency, taxClass, seoTitle, seoDescription,
    ).run();
  } catch {
    return json(
      { error: 'Création impossible', message: 'Un produit avec ce slug existe déjà.' },
      409,
    );
  }

  // Au moins 1 variante par défaut (sinon produit invendable).
  const providedVariants = Array.isArray(body.variants) ? body.variants : [];
  if (providedVariants.length === 0) {
    const vid = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO product_variants (id, product_id, sku, title, options_json, position)
       VALUES (?, ?, ?, 'Default', '{}', 0)`,
    ).bind(vid, id, null).run();
  } else {
    let pos = 0;
    for (const raw of providedVariants) {
      const v = raw as Record<string, unknown>;
      const vid = crypto.randomUUID();
      const vtitle = sanitizeInput((v.title as string) || '', 200) || 'Default';
      const sku = sanitizeInput((v.sku as string) || '', 100) || null;
      const priceOverride = Number.isFinite(v.price_override as number)
        ? Math.max(0, Math.round(v.price_override as number))
        : null;
      let optionsJson = '{}';
      try {
        if (v.options_json) optionsJson = JSON.stringify(JSON.parse(
          typeof v.options_json === 'string' ? v.options_json : JSON.stringify(v.options_json),
        ));
      } catch { optionsJson = '{}'; }
      const barcode = sanitizeInput((v.barcode as string) || '', 100) || null;
      const weight = Number.isFinite(v.weight_grams as number)
        ? Math.max(0, Math.round(v.weight_grams as number))
        : null;
      await env.DB.prepare(
        `INSERT INTO product_variants
          (id, product_id, sku, title, price_override, options_json, barcode, weight_grams, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(vid, id, sku, vtitle, priceOverride, optionsJson, barcode, weight, pos).run();
      pos += 1;
    }
  }

  await audit(env, auth.userId, 'create', 'product', id, { title, slug });
  return json({ data: { id, slug, success: true } }, 201);
}

/**
 * PATCH /api/ecommerce/products/:id — update partiel (incl. SEO).
 * Re-slug si slug fourni (unicité garantie, exclut soi-même).
 */
export async function handleUpdateProduct(
  request: Request, env: Env, auth: Auth, id: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const existing = await env.DB.prepare(
    'SELECT id, title FROM products WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).first() as { id: string; title: string } | null;
  if (!existing) return json({ error: 'Produit introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof body.title === 'string') {
    sets.push('title = ?'); params.push(sanitizeInput(body.title, 200));
  }
  if (typeof body.slug === 'string') {
    const s = await uniqueSlug(env, 'products', clientId, slugify(body.slug), id);
    sets.push('slug = ?'); params.push(s);
  }
  if (typeof body.description === 'string') {
    sets.push('description = ?'); params.push(sanitizeInput(body.description, 5000));
  }
  if (['draft', 'active', 'archived'].includes(body.status as string)) {
    sets.push('status = ?'); params.push(body.status);
  }
  if (Number.isFinite(body.base_price as number)) {
    sets.push('base_price = ?'); params.push(Math.max(0, Math.round(body.base_price as number)));
  }
  if (typeof body.product_type === 'string') {
    sets.push('product_type = ?'); params.push(sanitizeInput(body.product_type, 100));
  }
  if (typeof body.vendor === 'string') {
    sets.push('vendor = ?'); params.push(sanitizeInput(body.vendor, 100));
  }
  if (typeof body.tax_class === 'string') {
    sets.push('tax_class = ?'); params.push(sanitizeInput(body.tax_class, 50));
  }
  if (typeof body.seo_title === 'string') {
    // Fallback : seo_title vide → retombe sur le titre courant.
    const st = sanitizeInput(body.seo_title, 200) ||
      (typeof body.title === 'string' ? sanitizeInput(body.title, 200) : existing.title);
    sets.push('seo_title = ?'); params.push(st);
  }
  if (typeof body.seo_description === 'string') {
    sets.push('seo_description = ?'); params.push(sanitizeInput(body.seo_description, 320));
  }
  if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);

  params.push(id, clientId);
  const res = await env.DB.prepare(
    `UPDATE products SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
  ).bind(...params).run();
  if (!res.meta.changes) return json({ error: 'Produit introuvable' }, 404);

  await audit(env, auth.userId, 'update', 'product', id, {});
  return json({ data: { id, success: true } });
}

/**
 * DELETE /api/ecommerce/products/:id
 * CASCADE explicite variantes / images / liens catégories (FK ON DELETE
 * CASCADE déjà présent en schéma, on l'assure aussi côté code par robustesse).
 */
export async function handleDeleteProduct(env: Env, auth: Auth, id: string): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const owns = await env.DB.prepare(
    'SELECT id FROM products WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).first();
  if (!owns) return json({ error: 'Produit introuvable' }, 404);

  await env.DB.prepare('DELETE FROM product_images WHERE product_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM product_variants WHERE product_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM product_category_links WHERE product_id = ?').bind(id).run();
  await env.DB.prepare(
    'DELETE FROM products WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).run();

  await audit(env, auth.userId, 'delete', 'product', id, {});
  return json({ data: { success: true } });
}

// ════════════════════════════════════════════════════════════════════════════
// M1.2 — VARIANTES / SKU
// ════════════════════════════════════════════════════════════════════════════

/** Vérifie que le produit appartient bien au tenant courant. */
async function assertProductOwned(
  env: Env, clientId: string, productId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT id FROM products WHERE id = ? AND client_id = ?',
  ).bind(productId, clientId).first();
  return !!row;
}

/**
 * SKU unique par client : on vérifie via jointure produits du même tenant.
 * Retourne true si COLLISION (SKU déjà utilisé par un autre variant du client).
 */
async function skuCollision(
  env: Env, clientId: string, sku: string, excludeVariantId?: string,
): Promise<boolean> {
  if (!sku) return false;
  const row = await env.DB.prepare(
    `SELECT v.id FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE p.client_id = ? AND v.sku = ? AND v.id != ?`,
  ).bind(clientId, sku, excludeVariantId || '').first();
  return !!row;
}

/** GET /api/ecommerce/products/:id/variants — liste ordonnée. */
export async function handleListVariants(
  env: Env, auth: Auth, productId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  const { results } = await env.DB.prepare(
    'SELECT * FROM product_variants WHERE product_id = ? ORDER BY position ASC, created_at ASC',
  ).bind(productId).all();
  return json({ data: results || [] });
}

/** POST /api/ecommerce/products/:id/variants — crée une variante. */
export async function handleCreateVariant(
  request: Request, env: Env, auth: Auth, productId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const title = sanitizeInput((body.title as string) || '', 200) || 'Default';
  const sku = sanitizeInput((body.sku as string) || '', 100) || null;
  if (sku && (await skuCollision(env, clientId, sku))) {
    return json(
      { error: 'SKU déjà utilisé', message: `Le SKU « ${sku} » est déjà associé à une autre variante de ta boutique.` },
      409,
    );
  }
  const priceOverride = Number.isFinite(body.price_override as number)
    ? Math.max(0, Math.round(body.price_override as number))
    : null;
  let optionsJson = '{}';
  try {
    if (body.options_json) {
      const parsed = typeof body.options_json === 'string'
        ? JSON.parse(body.options_json) : body.options_json;
      optionsJson = JSON.stringify(parsed);
    }
  } catch { optionsJson = '{}'; }
  const barcode = sanitizeInput((body.barcode as string) || '', 100) || null;
  const weight = Number.isFinite(body.weight_grams as number)
    ? Math.max(0, Math.round(body.weight_grams as number))
    : null;

  // Position : à la fin par défaut.
  const posRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM product_variants WHERE product_id = ?',
  ).bind(productId).first() as { next: number } | null;
  const position = Number.isFinite(body.position as number)
    ? Math.max(0, Math.round(body.position as number))
    : (posRow?.next ?? 0);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO product_variants
      (id, product_id, sku, title, price_override, options_json, barcode, weight_grams, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, productId, sku, title, priceOverride, optionsJson, barcode, weight, position).run();

  await audit(env, auth.userId, 'create', 'product_variant', id, { productId, sku });
  return json({ data: { id, success: true } }, 201);
}

/** PATCH /api/ecommerce/products/:id/variants/:vid — update partiel. */
export async function handleUpdateVariant(
  request: Request, env: Env, auth: Auth, productId: string, variantId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  const exists = await env.DB.prepare(
    'SELECT id FROM product_variants WHERE id = ? AND product_id = ?',
  ).bind(variantId, productId).first();
  if (!exists) return json({ error: 'Variante introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof body.title === 'string') {
    sets.push('title = ?'); params.push(sanitizeInput(body.title, 200) || 'Default');
  }
  if (typeof body.sku === 'string') {
    const sku = sanitizeInput(body.sku, 100) || null;
    if (sku && (await skuCollision(env, clientId, sku, variantId))) {
      return json(
        { error: 'SKU déjà utilisé', message: `Le SKU « ${sku} » est déjà associé à une autre variante de ta boutique.` },
        409,
      );
    }
    sets.push('sku = ?'); params.push(sku);
  }
  if ('price_override' in body) {
    const po = Number.isFinite(body.price_override as number)
      ? Math.max(0, Math.round(body.price_override as number))
      : null;
    sets.push('price_override = ?'); params.push(po);
  }
  if (body.options_json !== undefined) {
    let oj = '{}';
    try {
      const parsed = typeof body.options_json === 'string'
        ? JSON.parse(body.options_json) : body.options_json;
      oj = JSON.stringify(parsed);
    } catch { oj = '{}'; }
    sets.push('options_json = ?'); params.push(oj);
  }
  if (typeof body.barcode === 'string') {
    sets.push('barcode = ?'); params.push(sanitizeInput(body.barcode, 100) || null);
  }
  if (Number.isFinite(body.weight_grams as number)) {
    sets.push('weight_grams = ?'); params.push(Math.max(0, Math.round(body.weight_grams as number)));
  }
  if (Number.isFinite(body.position as number)) {
    sets.push('position = ?'); params.push(Math.max(0, Math.round(body.position as number)));
  }
  if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);

  params.push(variantId, productId);
  const res = await env.DB.prepare(
    `UPDATE product_variants SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND product_id = ?`,
  ).bind(...params).run();
  if (!res.meta.changes) return json({ error: 'Variante introuvable' }, 404);

  await audit(env, auth.userId, 'update', 'product_variant', variantId, { productId });
  return json({ data: { id: variantId, success: true } });
}

/**
 * DELETE /api/ecommerce/products/:id/variants/:vid
 * Refuse de supprimer la dernière variante (produit doit garder ≥ 1 variante).
 */
export async function handleDeleteVariant(
  env: Env, auth: Auth, productId: string, variantId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  const cntRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM product_variants WHERE product_id = ?',
  ).bind(productId).first() as { n: number } | null;
  if ((cntRow?.n || 0) <= 1) {
    return json(
      {
        error: 'Suppression impossible',
        message: 'Un produit doit conserver au moins une variante. Crée une autre variante avant de supprimer celle-ci.',
      },
      409,
    );
  }

  const res = await env.DB.prepare(
    'DELETE FROM product_variants WHERE id = ? AND product_id = ?',
  ).bind(variantId, productId).run();
  if (!res.meta.changes) return json({ error: 'Variante introuvable' }, 404);

  await audit(env, auth.userId, 'delete', 'product_variant', variantId, { productId });
  return json({ data: { success: true } });
}

// ════════════════════════════════════════════════════════════════════════════
// M1.3 — CATÉGORIES / COLLECTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/ecommerce/categories
 * ?tree=1 → arbre hiérarchique imbriqué. Sinon liste plate + products_count.
 */
export async function handleListCategories(env: Env, auth: Auth, url: URL): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const { results } = await env.DB.prepare(
    `SELECT c.*,
       (SELECT COUNT(*) FROM product_category_links l WHERE l.category_id = c.id) AS products_count
     FROM product_categories c
     WHERE c.client_id = ?
     ORDER BY c.sort_order ASC, c.name ASC`,
  ).bind(clientId).all();

  const flat = (results || []) as Array<Record<string, unknown>>;

  if (url.searchParams.get('tree') === '1') {
    const byId = new Map<string, Record<string, unknown>>();
    flat.forEach((c) => byId.set(c.id as string, { ...c, children: [] }));
    const roots: Record<string, unknown>[] = [];
    byId.forEach((node) => {
      const pid = node.parent_id as string | null;
      if (pid && byId.has(pid)) {
        (byId.get(pid)!.children as unknown[]).push(node);
      } else {
        roots.push(node);
      }
    });
    return json({ data: roots });
  }

  return json({ data: flat });
}

/** POST /api/ecommerce/categories — crée une catégorie (slug unique). */
export async function handleCreateCategory(
  request: Request, env: Env, auth: Auth,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const name = sanitizeInput((body.name as string) || '', 200);
  if (!name) return json({ error: 'Le nom de la catégorie est requis' }, 400);

  const baseSlug = slugify(sanitizeInput((body.slug as string) || '', 200) || name);
  const slug = await uniqueSlug(env, 'product_categories', clientId, baseSlug);

  // parent_id : doit appartenir au même tenant si fourni.
  let parentId: string | null = null;
  if (body.parent_id) {
    const parent = await env.DB.prepare(
      'SELECT id FROM product_categories WHERE id = ? AND client_id = ?',
    ).bind(body.parent_id as string, clientId).first();
    if (!parent) return json({ error: 'Catégorie parente introuvable' }, 400);
    parentId = body.parent_id as string;
  }
  const sortOrder = Number.isFinite(body.sort_order as number)
    ? Math.round(body.sort_order as number)
    : 0;

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO product_categories (id, client_id, name, slug, parent_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, clientId, name, slug, parentId, sortOrder).run();
  } catch {
    return json(
      { error: 'Création impossible', message: 'Une catégorie avec ce slug existe déjà.' },
      409,
    );
  }

  await audit(env, auth.userId, 'create', 'product_category', id, { name, slug });
  return json({ data: { id, slug, success: true } }, 201);
}

/** PATCH /api/ecommerce/categories/:id — update partiel. */
export async function handleUpdateCategory(
  request: Request, env: Env, auth: Auth, id: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const existing = await env.DB.prepare(
    'SELECT id FROM product_categories WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).first();
  if (!existing) return json({ error: 'Catégorie introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof body.name === 'string') {
    sets.push('name = ?'); params.push(sanitizeInput(body.name, 200));
  }
  if (typeof body.slug === 'string') {
    const s = await uniqueSlug(env, 'product_categories', clientId, slugify(body.slug), id);
    sets.push('slug = ?'); params.push(s);
  }
  if ('parent_id' in body) {
    const pid = body.parent_id as string | null;
    if (pid) {
      if (pid === id) return json({ error: 'Une catégorie ne peut pas être son propre parent' }, 400);
      const parent = await env.DB.prepare(
        'SELECT id FROM product_categories WHERE id = ? AND client_id = ?',
      ).bind(pid, clientId).first();
      if (!parent) return json({ error: 'Catégorie parente introuvable' }, 400);
    }
    sets.push('parent_id = ?'); params.push(pid || null);
  }
  if (Number.isFinite(body.sort_order as number)) {
    sets.push('sort_order = ?'); params.push(Math.round(body.sort_order as number));
  }
  if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);

  params.push(id, clientId);
  const res = await env.DB.prepare(
    `UPDATE product_categories SET ${sets.join(', ')}, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
  ).bind(...params).run();
  if (!res.meta.changes) return json({ error: 'Catégorie introuvable' }, 404);

  await audit(env, auth.userId, 'update', 'product_category', id, {});
  return json({ data: { id, success: true } });
}

/**
 * DELETE /api/ecommerce/categories/:id
 * Détache les enfants (parent_id → NULL) + retire les liens produits.
 */
export async function handleDeleteCategory(
  env: Env, auth: Auth, id: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  const owns = await env.DB.prepare(
    'SELECT id FROM product_categories WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).first();
  if (!owns) return json({ error: 'Catégorie introuvable' }, 404);

  await env.DB.prepare(
    'UPDATE product_categories SET parent_id = NULL WHERE parent_id = ? AND client_id = ?',
  ).bind(id, clientId).run();
  await env.DB.prepare('DELETE FROM product_category_links WHERE category_id = ?').bind(id).run();
  await env.DB.prepare(
    'DELETE FROM product_categories WHERE id = ? AND client_id = ?',
  ).bind(id, clientId).run();

  await audit(env, auth.userId, 'delete', 'product_category', id, {});
  return json({ data: { success: true } });
}

/**
 * PUT /api/ecommerce/products/:id/categories
 * Body { category_ids: string[] } → remplace l'ensemble des liens du produit.
 */
export async function handleSetProductCategories(
  request: Request, env: Env, auth: Auth, productId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  let body: { category_ids?: unknown };
  try {
    body = (await request.json()) as { category_ids?: unknown };
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const requested = Array.isArray(body.category_ids)
    ? (body.category_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  // Ne garde que les catégories appartenant réellement au tenant.
  let valid: string[] = [];
  if (requested.length > 0) {
    const placeholders = requested.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id FROM product_categories
         WHERE client_id = ? AND id IN (${placeholders})`,
    ).bind(clientId, ...requested).all();
    valid = (results || []).map((r) => (r as { id: string }).id);
  }

  await env.DB.prepare(
    'DELETE FROM product_category_links WHERE product_id = ?',
  ).bind(productId).run();
  for (const catId of valid) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO product_category_links (product_id, category_id)
       VALUES (?, ?)`,
    ).bind(productId, catId).run();
  }

  await audit(env, auth.userId, 'update', 'product_categories_link', productId, {
    count: valid.length,
  });
  return json({ data: { product_id: productId, category_ids: valid, success: true } });
}

// ════════════════════════════════════════════════════════════════════════════
// M1.4 — IMAGES + SEO + API PUBLIQUE CATALOGUE
// ════════════════════════════════════════════════════════════════════════════

/** GET /api/ecommerce/products/:id/images — liste ordonnée. */
export async function handleListImages(
  env: Env, auth: Auth, productId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  const { results } = await env.DB.prepare(
    'SELECT * FROM product_images WHERE product_id = ? ORDER BY position ASC, created_at ASC',
  ).bind(productId).all();
  return json({ data: results || [] });
}

/**
 * POST /api/ecommerce/products/:id/images
 * { url, alt?, position?, variant_id? }. Position à la fin par défaut.
 */
export async function handleAddImage(
  request: Request, env: Env, auth: Auth, productId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const url = sanitizeInput((body.url as string) || '', 1000);
  if (!url) return json({ error: "L'URL de l'image est requise" }, 400);
  const alt = sanitizeInput((body.alt as string) || '', 300);

  // variant_id optionnel : doit appartenir au même produit si fourni.
  let variantId: string | null = null;
  if (body.variant_id) {
    const v = await env.DB.prepare(
      'SELECT id FROM product_variants WHERE id = ? AND product_id = ?',
    ).bind(body.variant_id as string, productId).first();
    if (!v) return json({ error: 'Variante introuvable pour ce produit' }, 400);
    variantId = body.variant_id as string;
  }

  const posRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM product_images WHERE product_id = ?',
  ).bind(productId).first() as { next: number } | null;
  const position = Number.isFinite(body.position as number)
    ? Math.max(0, Math.round(body.position as number))
    : (posRow?.next ?? 0);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO product_images (id, product_id, variant_id, url, alt, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, productId, variantId, url, alt, position).run();

  await audit(env, auth.userId, 'create', 'product_image', id, { productId });
  return json({ data: { id, success: true } }, 201);
}

/**
 * PATCH /api/ecommerce/products/:id/images/:imgId
 * Réordonner / changer alt / réassocier à une variante.
 */
export async function handleUpdateImage(
  request: Request, env: Env, auth: Auth, productId: string, imageId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  const exists = await env.DB.prepare(
    'SELECT id FROM product_images WHERE id = ? AND product_id = ?',
  ).bind(imageId, productId).first();
  if (!exists) return json({ error: 'Image introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof body.url === 'string' && body.url.trim()) {
    sets.push('url = ?'); params.push(sanitizeInput(body.url, 1000));
  }
  if (typeof body.alt === 'string') {
    sets.push('alt = ?'); params.push(sanitizeInput(body.alt, 300));
  }
  if (Number.isFinite(body.position as number)) {
    sets.push('position = ?'); params.push(Math.max(0, Math.round(body.position as number)));
  }
  if ('variant_id' in body) {
    const vid = body.variant_id as string | null;
    if (vid) {
      const v = await env.DB.prepare(
        'SELECT id FROM product_variants WHERE id = ? AND product_id = ?',
      ).bind(vid, productId).first();
      if (!v) return json({ error: 'Variante introuvable pour ce produit' }, 400);
    }
    sets.push('variant_id = ?'); params.push(vid || null);
  }
  if (sets.length === 0) return json({ error: 'Aucun champ à mettre à jour' }, 400);

  params.push(imageId, productId);
  const res = await env.DB.prepare(
    `UPDATE product_images SET ${sets.join(', ')}
       WHERE id = ? AND product_id = ?`,
  ).bind(...params).run();
  if (!res.meta.changes) return json({ error: 'Image introuvable' }, 404);

  await audit(env, auth.userId, 'update', 'product_image', imageId, { productId });
  return json({ data: { id: imageId, success: true } });
}

/** DELETE /api/ecommerce/products/:id/images/:imgId */
export async function handleDeleteImage(
  env: Env, auth: Auth, productId: string, imageId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  const res = await env.DB.prepare(
    'DELETE FROM product_images WHERE id = ? AND product_id = ?',
  ).bind(imageId, productId).run();
  if (!res.meta.changes) return json({ error: 'Image introuvable' }, 404);

  await audit(env, auth.userId, 'delete', 'product_image', imageId, { productId });
  return json({ data: { success: true } });
}

/**
 * PUT /api/ecommerce/products/:id/images/:imgId/primary
 * Définit l'image principale (position 0) ; les autres décalées de +1.
 */
export async function handleSetPrimaryImage(
  env: Env, auth: Auth, productId: string, imageId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();
  if (!(await assertProductOwned(env, clientId, productId)))
    return json({ error: 'Produit introuvable' }, 404);

  const target = await env.DB.prepare(
    'SELECT id FROM product_images WHERE id = ? AND product_id = ?',
  ).bind(imageId, productId).first();
  if (!target) return json({ error: 'Image introuvable' }, 404);

  // Décale toutes les autres images puis force la cible en position 0.
  await env.DB.prepare(
    'UPDATE product_images SET position = position + 1 WHERE product_id = ? AND id != ?',
  ).bind(productId, imageId).run();
  await env.DB.prepare(
    'UPDATE product_images SET position = 0 WHERE id = ? AND product_id = ?',
  ).bind(imageId, productId).run();

  await audit(env, auth.userId, 'update', 'product_image_primary', imageId, { productId });
  return json({ data: { id: imageId, success: true } });
}

// ── API publique catalogue (storefront futur) ────────────────────────────────
//
// Lecture seule du catalogue ACTIF. Scope-based : le clientId vient de la clé
// API publique (api-public-auth), aucune session admin. status='active' only.

/**
 * GET /api/public/v1/products?limit&offset&category=<slug>&search=
 * Liste produits actifs du tenant de la clé API + image principale.
 */
export async function handlePublicListProducts(
  env: Env, clientId: string, url: URL,
): Promise<Response> {
  const { limit, offset } = parsePaging(url);
  const categorySlug = sanitizeInput(url.searchParams.get('category') || '', 200);
  const search = sanitizeInput(url.searchParams.get('search') || '', 200);

  const where: string[] = ["p.client_id = ?", "p.status = 'active'"];
  const params: unknown[] = [clientId];
  if (categorySlug) {
    where.push(
      `p.id IN (
         SELECT l.product_id FROM product_category_links l
           JOIN product_categories c ON c.id = l.category_id
           WHERE c.client_id = ? AND c.slug = ?
       )`,
    );
    params.push(clientId, categorySlug);
  }
  if (search) {
    where.push('p.title LIKE ?');
    params.push(`%${search}%`);
  }
  const whereSql = where.join(' AND ');

  const countRow = (await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM products p WHERE ${whereSql}`,
  ).bind(...params).first()) as { n: number } | null;

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.slug, p.description, p.base_price, p.currency,
            p.product_type, p.vendor, p.seo_title, p.seo_description,
            (SELECT url FROM product_images i WHERE i.product_id = p.id
               ORDER BY i.position ASC LIMIT 1) AS primary_image
     FROM products p
     WHERE ${whereSql}
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(...params, limit, offset).all();

  return json({ data: results || [], total: countRow?.n || 0, limit, offset });
}

/**
 * GET /api/public/v1/products/:slug
 * Détail produit actif (variantes + images + catégories) par slug.
 */
export async function handlePublicGetProduct(
  env: Env, clientId: string, slug: string,
): Promise<Response> {
  const product = await env.DB.prepare(
    "SELECT id, title, slug, description, base_price, currency, product_type, vendor, seo_title, seo_description FROM products WHERE client_id = ? AND slug = ? AND status = 'active'",
  ).bind(clientId, slug).first() as { id: string } | null;
  if (!product) return json({ error: 'Produit introuvable' }, 404);

  const { results: variants } = await env.DB.prepare(
    `SELECT id, sku, title, price_override, options_json, barcode, weight_grams, position
       FROM product_variants WHERE product_id = ? ORDER BY position ASC`,
  ).bind(product.id).all();
  const { results: images } = await env.DB.prepare(
    'SELECT id, variant_id, url, alt, position FROM product_images WHERE product_id = ? ORDER BY position ASC',
  ).bind(product.id).all();
  const { results: categories } = await env.DB.prepare(
    `SELECT c.id, c.name, c.slug FROM product_categories c
       JOIN product_category_links l ON l.category_id = c.id
       WHERE l.product_id = ? AND c.client_id = ?`,
  ).bind(product.id, clientId).all();

  return json({
    data: {
      ...product,
      variants: variants || [],
      images: images || [],
      categories: categories || [],
    },
  });
}
