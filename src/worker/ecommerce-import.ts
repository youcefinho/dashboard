// ── Import bulk produits — Sprint E2 M2.4 (2026-05-16) ──────────────────────
//
// Import en masse de produits dans le module Boutique (B2). Réutilise le
// moteur dot-path de Sprint 51 (`resolvePath` de ./lead-mapping) : le moteur
// est agnostique du type cible (lead OU produit). On NE duplique PAS la
// résolution de chemins.
//
// Conventions strictes du projet :
//  - Money TOUJOURS en cents INTEGER. Le parseur accepte "19.99" / "19,99" /
//    "1 999,00 $" → 1999 cents (jamais de float stocké).
//  - Multi-tenant STRICT : tout créé WHERE client_id = ? (tenant courant).
//  - Gating requireModule('ecommerce') géré AMONT par src/worker.ts.
//  - id TEXT applicatif via crypto.randomUUID() (cohérent E1/E2-M1).
//  - Crée produit + variante "Default" + ligne inventory en une passe.
//  - Dédoublonnage par SKU (param on_conflict = skip | update).
//  - ?dryRun=1 → aperçu sans aucune écriture (pattern lead-sources S51).

import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';
import { resolvePath } from './lead-mapping';
import { getClientModules } from './modules';

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

// Mapping par défaut : champ produit canonique → alias possibles (clé directe
// ou dot-path). Couvre l'export typique CSV→JSON FR québécois / Shopify.
const DEFAULT_PRODUCT_MAPPING: Record<string, string[]> = {
  title: ['title', 'titre', 'name', 'nom', 'product', 'produit', 'Title', 'Name'],
  sku: ['sku', 'SKU', 'code', 'reference', 'référence', 'variant_sku'],
  price: ['price', 'prix', 'base_price', 'amount', 'montant', 'Price', 'Variant Price'],
  description: ['description', 'desc', 'Body (HTML)', 'body', 'détails'],
  category: ['category', 'categorie', 'catégorie', 'collection', 'Type', 'product_type'],
  quantity: ['quantity', 'quantite', 'quantité', 'qty', 'stock', 'inventory', 'Variant Inventory Qty'],
  vendor: ['vendor', 'fournisseur', 'marque', 'brand', 'Vendor'],
};

/** Parse un prix texte/nombre → cents INTEGER. "19,99" / "19.99" / "1 999 $" → 1999. */
function parsePriceCents(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Heuristique : un nombre est interprété comme un montant en dollars.
    return Math.max(0, Math.round(raw * 100));
  }
  let s = String(raw).trim();
  // Retire symboles monétaires + espaces (incl. insécables) + lettres CAD/USD.
  s = s.replace(/[^\d.,-]/g, '').replace(/\s/g, '');
  if (!s) return 0;
  // Si virgule ET point présents : le dernier séparateur est la décimale.
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    const decSep = lastComma > lastDot ? ',' : '.';
    const thouSep = decSep === ',' ? '.' : ',';
    s = s.split(thouSep).join('');
    s = s.replace(decSep, '.');
  } else if (lastComma !== -1) {
    // Seulement virgule → décimale FR (sauf si c'est un séparateur de milliers
    // suivi de 3 chiffres : "1,999" → 1999 dollars).
    const afterComma = s.length - lastComma - 1;
    s = afterComma === 3 && !s.includes('.') ? s.replace(',', '') : s.replace(',', '.');
  }
  const num = parseFloat(s);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num * 100));
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function uniqueProductSlug(
  env: Env, clientId: string, base: string,
): Promise<string> {
  const root = base || crypto.randomUUID().slice(0, 8);
  let candidate = root;
  let n = 1;
  while (n < 100) {
    const row = await env.DB.prepare(
      'SELECT id FROM products WHERE client_id = ? AND slug = ?',
    ).bind(clientId, candidate).first();
    if (!row) return candidate;
    n += 1;
    candidate = `${root}-${n}`.slice(0, 80);
  }
  return `${root}-${crypto.randomUUID().slice(0, 6)}`.slice(0, 80);
}

/** Extrait un champ depuis une ligne via mapping perso (dot-path) ou défaut. */
function pickField(
  row: Record<string, unknown>,
  field: keyof typeof DEFAULT_PRODUCT_MAPPING,
  mapping: Record<string, string> | null,
): string {
  if (mapping && mapping[field]) {
    const v = resolvePath(row, mapping[field]!);
    if (v != null && String(v).trim() !== '') return String(v);
  }
  for (const alias of DEFAULT_PRODUCT_MAPPING[field]!) {
    const v = resolvePath(row, alias);
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return '';
}

interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; sku?: string; title?: string; reason: string }>;
  preview?: Array<Record<string, unknown>>;
}

/**
 * POST /api/ecommerce/products/import?dryRun=1
 * Body { rows: [...], mapping?: object|string, on_conflict?: 'skip'|'update' }.
 * Crée produit + variante "Default" + inventory en une passe. Dédoublonnage
 * par SKU. dryRun=1 → aperçu sans écriture.
 */
export async function handleImportProducts(
  request: Request, env: Env, auth: Auth, url: URL,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];
  if (rows.length === 0) {
    return json(
      { error: 'Aucune ligne', message: 'Le tableau « rows » est vide ou absent.' },
      400,
    );
  }
  if (rows.length > 2000) {
    return json(
      { error: 'Trop de lignes', message: 'Maximum 2000 produits par import. Découpe ton fichier.' },
      400,
    );
  }

  // Mapping perso : objet OU JSON string (cohérent lead-sources S51).
  let mapping: Record<string, string> | null = null;
  if (body.mapping) {
    try {
      const parsed = typeof body.mapping === 'string'
        ? JSON.parse(body.mapping) : body.mapping;
      if (parsed && typeof parsed === 'object') {
        mapping = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string') mapping[k] = v;
        }
      }
    } catch {
      return json({ error: 'mapping invalide (JSON malformé)' }, 400);
    }
  }

  const onConflict = body.on_conflict === 'update' ? 'update' : 'skip';
  const dryRun = url.searchParams.get('dryRun') === '1';

  const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [] };
  if (dryRun) report.preview = [];

  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i] || {};
    const title = sanitizeInput(pickField(raw, 'title', mapping), 200);
    const sku = sanitizeInput(pickField(raw, 'sku', mapping), 100) || null;

    if (!title) {
      report.errors.push({ row: i + 1, sku: sku || undefined, reason: 'Titre manquant' });
      continue;
    }

    const description = sanitizeInput(pickField(raw, 'description', mapping), 5000);
    const priceCents = parsePriceCents(pickField(raw, 'price', mapping));
    const categoryName = sanitizeInput(pickField(raw, 'category', mapping), 200);
    const vendor = sanitizeInput(pickField(raw, 'vendor', mapping), 100);
    const qtyRaw = pickField(raw, 'quantity', mapping);
    const quantity = Number.isFinite(parseInt(qtyRaw, 10))
      ? Math.max(0, parseInt(qtyRaw, 10))
      : 0;

    // Dédoublonnage par SKU (scopé tenant via jointure produits).
    let existingVariant: { variant_id: string; product_id: string } | null = null;
    if (sku) {
      existingVariant = await env.DB.prepare(
        `SELECT v.id AS variant_id, v.product_id AS product_id
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
          WHERE p.client_id = ? AND v.sku = ? LIMIT 1`,
      ).bind(clientId, sku).first() as { variant_id: string; product_id: string } | null;
    }

    if (existingVariant && onConflict === 'skip') {
      report.skipped += 1;
      if (dryRun) {
        report.preview!.push({ row: i + 1, sku, title, action: 'skip (SKU existant)' });
      }
      continue;
    }

    if (dryRun) {
      report.preview!.push({
        row: i + 1, sku, title,
        price_cents: priceCents, quantity, category: categoryName || null, vendor: vendor || null,
        action: existingVariant ? 'update (SKU existant)' : 'create',
      });
      if (existingVariant) report.updated += 1; else report.created += 1;
      continue;
    }

    try {
      if (existingVariant && onConflict === 'update') {
        // Update produit + variante + inventory (set quantité absolu).
        await env.DB.prepare(
          `UPDATE products SET title = ?, description = ?, base_price = ?,
                  vendor = ?, updated_at = datetime('now')
             WHERE id = ? AND client_id = ?`,
        ).bind(
          title, description, priceCents, vendor,
          existingVariant.product_id, clientId,
        ).run();
        await env.DB.prepare(
          `INSERT OR IGNORE INTO inventory (id, variant_id, quantity, reserved)
           VALUES (?, ?, 0, 0)`,
        ).bind(crypto.randomUUID(), existingVariant.variant_id).run();
        await env.DB.prepare(
          `UPDATE inventory SET quantity = ?, updated_at = datetime('now')
             WHERE variant_id = ?`,
        ).bind(quantity, existingVariant.variant_id).run();
        report.updated += 1;
        continue;
      }

      // Création complète : produit + variante Default + inventory.
      const slug = await uniqueProductSlug(env, clientId, slugify(title));
      const productId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO products
           (id, client_id, title, slug, description, status, vendor,
            base_price, currency, tax_class, seo_title, seo_description)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, 'CAD', 'standard', ?, ?)`,
      ).bind(
        productId, clientId, title, slug, description, vendor,
        priceCents, title, description.slice(0, 200),
      ).run();

      const variantId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO product_variants
           (id, product_id, sku, title, options_json, position)
         VALUES (?, ?, ?, 'Default', '{}', 0)`,
      ).bind(variantId, productId, sku).run();

      await env.DB.prepare(
        `INSERT OR IGNORE INTO inventory (id, variant_id, quantity, reserved)
         VALUES (?, ?, ?, 0)`,
      ).bind(crypto.randomUUID(), variantId, quantity).run();

      // Catégorie : crée/retrouve par nom (slug) + lie le produit.
      if (categoryName) {
        const catSlug = slugify(categoryName);
        let cat = await env.DB.prepare(
          'SELECT id FROM product_categories WHERE client_id = ? AND slug = ?',
        ).bind(clientId, catSlug).first() as { id: string } | null;
        if (!cat) {
          const catId = crypto.randomUUID();
          try {
            await env.DB.prepare(
              `INSERT INTO product_categories (id, client_id, name, slug, sort_order)
               VALUES (?, ?, ?, ?, 0)`,
            ).bind(catId, clientId, categoryName, catSlug).run();
            cat = { id: catId };
          } catch {
            cat = await env.DB.prepare(
              'SELECT id FROM product_categories WHERE client_id = ? AND slug = ?',
            ).bind(clientId, catSlug).first() as { id: string } | null;
          }
        }
        if (cat) {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO product_category_links (product_id, category_id)
             VALUES (?, ?)`,
          ).bind(productId, cat.id).run();
        }
      }

      report.created += 1;
    } catch (e) {
      report.errors.push({
        row: i + 1, sku: sku || undefined, title,
        reason: e instanceof Error ? e.message : 'Erreur inconnue lors de la création',
      });
    }
  }

  if (!dryRun) {
    await audit(env, auth.userId, 'import', 'product', 'bulk', {
      created: report.created, updated: report.updated,
      skipped: report.skipped, errors: report.errors.length,
    });
  }

  return json({ data: { ...report, dryRun, on_conflict: onConflict } });
}
