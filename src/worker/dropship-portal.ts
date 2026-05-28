import type { Env } from './types';
import type { WarehouseDropshipAuth } from './warehouse-dropship';
import { json, audit } from './helpers';

// Garde de capability clients.manage (CRUD partenaires)
function clientsCapGuard(auth: WarehouseDropshipAuth): Response | undefined {
  if (!auth.capabilities || !auth.capabilities.has('clients.manage')) {
    return json({ error: 'Autorisation insuffisante (clients.manage requis)' }, 403);
  }
  return undefined;
}

// Helper pour générer un ID propre
function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * GET /api/dropship-portal/orders
 *
 * Liste les commandes associées aux fournisseurs du partenaire connecté.
 * Résout les détails de livraison de la table `orders`.
 */
export async function handleListPortalDropshipOrders(
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const dropshipPartnerId = auth.tenant?.dropshipPartnerId ?? null;
  const clientId = auth.clientId ?? null;

  if (!dropshipPartnerId || !clientId) {
    return json({ error: 'Accès portail non configuré pour cet utilisateur' }, 403);
  }

  try {
    // 1) Trouver tous les supplier_ids liés à ce dropshipPartnerId
    const suppliersRes = await env.DB.prepare(
      `SELECT id FROM dropship_suppliers WHERE dropship_partner_id = ? AND client_id = ?`,
    )
      .bind(dropshipPartnerId, clientId)
      .all();

    const supplierIds = (suppliersRes.results || []).map((r) => r.id as string);
    if (supplierIds.length === 0) {
      return json({ data: [] });
    }

    const placeholders = supplierIds.map(() => '?').join(',');

    // 2) Récupérer les dropship_orders
    const ordersRes = await env.DB.prepare(
      `SELECT
        do.id as id,
        do.order_id,
        do.supplier_id,
        do.supplier_order_ref,
        do.status,
        do.tracking_number,
        do.created_at,
        do.updated_at,
        o.customer_id,
        o.shipping_address,
        o.contact_email,
        o.contact_phone,
        o.notes as order_notes
       FROM dropship_orders do
       JOIN orders o ON do.order_id = o.id
       WHERE do.supplier_id IN (${placeholders}) AND do.client_id = ?
       ORDER BY do.created_at DESC LIMIT 200`,
    )
      .bind(...supplierIds, clientId)
      .all();

    const dropshipOrders = ordersRes.results || [];
    if (dropshipOrders.length === 0) {
      return json({ data: [] });
    }

    // 3) Pour chaque dropship_order, récupérer également les items de la commande correspondants
    const orderIds = Array.from(new Set(dropshipOrders.map((o) => o.order_id as string)));
    const orderPlaceholders = orderIds.map(() => '?').join(',');

    const itemsRes = await env.DB.prepare(
      `SELECT
        oi.id,
        oi.order_id,
        oi.product_id,
        oi.variant_id,
        oi.quantity,
        oi.price_cents,
        oi.name,
        dr.supplier_sku
       FROM order_items oi
       LEFT JOIN dropship_routings dr ON oi.variant_id = dr.variant_id AND dr.client_id = ?
       WHERE oi.order_id IN (${orderPlaceholders})`,
    )
      .bind(clientId, ...orderIds)
      .all();

    const allItems = itemsRes.results || [];

    // Regrouper les items par order_id
    const itemsByOrder = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const oid = item.order_id as string;
      const list = itemsByOrder.get(oid) || [];
      list.push(item);
      itemsByOrder.set(oid, list);
    }

    // Assembler la réponse
    const data = dropshipOrders.map((doOrder) => {
      const oid = doOrder.order_id as string;
      const orderItems = itemsByOrder.get(oid) || [];
      return {
        ...doOrder,
        items: orderItems,
      };
    });

    return json({ data });
  } catch (err) {
    return json({ error: 'Erreur lors de la récupération des commandes du portail' }, 500);
  }
}

/**
 * POST /api/dropship-portal/orders/:id/ship
 *
 * Marque la commande dropship comme expédiée et ajoute le tracking_number.
 */
export async function handleShipPortalDropshipOrder(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
  dropshipOrderId: string,
): Promise<Response> {
  const dropshipPartnerId = auth.tenant?.dropshipPartnerId ?? null;
  const clientId = auth.clientId ?? null;

  if (!dropshipPartnerId || !clientId) {
    return json({ error: 'Accès portail non autorisé' }, 403);
  }

  try {
    const rawBody = await request.text();
    const body = rawBody ? JSON.parse(rawBody) : {};
    const trackingNumber = typeof body.tracking_number === 'string' ? body.tracking_number.trim().slice(0, 100) : '';

    if (!trackingNumber) {
      return json({ error: 'Le numéro de suivi (tracking_number) est requis' }, 400);
    }

    // 1) Vérifier que la dropship_order existe et appartient au partenaire
    const existing = await env.DB.prepare(
      `SELECT do.id, do.supplier_id, do.order_id
       FROM dropship_orders do
       JOIN dropship_suppliers ds ON do.supplier_id = ds.id AND ds.dropship_partner_id = ?
       WHERE do.id = ? AND do.client_id = ?`,
    )
      .bind(dropshipPartnerId, dropshipOrderId, clientId)
      .first();

    if (!existing) {
      return json({ error: 'Commande dropship introuvable ou non associée' }, 404);
    }

    // 2) Mettre à jour le statut et le tracking number
    await env.DB.prepare(
      `UPDATE dropship_orders
       SET status = 'shipped', tracking_number = ?, updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
    )
      .bind(trackingNumber, dropshipOrderId, clientId)
      .run();

    // 3) Écrire un log d'audit
    try {
      await audit(
        env,
        auth.userId ?? 'system',
        'dropship.order.shipped',
        'dropship_order',
        dropshipOrderId,
        { tracking_number: trackingNumber, order_id: existing.order_id },
      );
    } catch {
      /* ignore errors */
    }

    return json({ data: { success: true, id: dropshipOrderId, status: 'shipped', tracking_number: trackingNumber } });
  } catch (err) {
    return json({ error: 'Erreur lors de la confirmation d’expédition' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ADMINISTRATION DES PARTENAIRES (CRUD)
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/dropship-partners
 */
export async function handleListDropshipPartners(
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  const clientId = auth.clientId ?? null;
  if (!clientId) return json({ data: [] });

  try {
    const res = await env.DB.prepare(
      `SELECT * FROM dropship_partners WHERE client_id = ? ORDER BY company_name ASC`,
    )
      .bind(clientId)
      .all();
    return json({ data: res.results || [] });
  } catch {
    return json({ data: [] });
  }
}

/**
 * POST /api/dropship-partners
 */
export async function handleCreateDropshipPartner(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  const clientId = auth.clientId ?? null;
  if (!clientId) return json({ error: 'Client requis' }, 400);

  try {
    const rawBody = await request.text();
    const body = rawBody ? JSON.parse(rawBody) : {};

    const companyName = typeof body.company_name === 'string' ? body.company_name.trim().slice(0, 200) : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
    const status = typeof body.status === 'string' ? body.status.trim().slice(0, 50) : 'active';

    if (!companyName) return json({ error: 'company_name requis' }, 400);
    if (!email || !email.includes('@')) return json({ error: 'email invalide' }, 400);

    const id = newId();

    await env.DB.prepare(
      `INSERT INTO dropship_partners (id, client_id, company_name, email, status)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, clientId, companyName, email, status)
      .run();

    try {
      await audit(env, auth.userId ?? 'system', 'dropship.partner.create', 'dropship_partner', id, {
        company_name: companyName,
        email,
      });
    } catch {
      /* ignore */
    }

    return json({
      data: { id, client_id: clientId, company_name: companyName, email, status, created_at: new Date().toISOString() },
    });
  } catch {
    return json({ error: 'Erreur lors de la création du partenaire' }, 500);
  }
}

/**
 * PATCH /api/dropship-partners/:id
 */
export async function handleUpdateDropshipPartner(
  request: Request,
  env: Env,
  auth: WarehouseDropshipAuth,
  partnerId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  const clientId = auth.clientId ?? null;
  if (!clientId || !partnerId) return json({ error: 'Paramètres manquants' }, 400);

  try {
    const rawBody = await request.text();
    const body = rawBody ? JSON.parse(rawBody) : {};

    const sets: string[] = [];
    const binds: unknown[] = [];

    if (typeof body.company_name === 'string') {
      sets.push('company_name = ?');
      binds.push(body.company_name.trim().slice(0, 200));
    }
    if (typeof body.email === 'string') {
      const email = body.email.trim().toLowerCase().slice(0, 200);
      if (!email.includes('@')) return json({ error: 'email invalide' }, 400);
      sets.push('email = ?');
      binds.push(email);
    }
    if (typeof body.status === 'string') {
      sets.push('status = ?');
      binds.push(body.status.trim().slice(0, 50));
    }

    if (sets.length === 0) {
      const existing = await env.DB.prepare(
        `SELECT * FROM dropship_partners WHERE id = ? AND client_id = ?`,
      )
        .bind(partnerId, clientId)
        .first();
      return json({ data: existing });
    }

    sets.push("updated_at = datetime('now')");
    binds.push(partnerId, clientId);

    const updateRes = await env.DB.prepare(
      `UPDATE dropship_partners SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
    )
      .bind(...binds)
      .run();

    if (updateRes.meta.changes === 0) {
      return json({ error: 'Partenaire introuvable' }, 404);
    }

    const updated = await env.DB.prepare(
      `SELECT * FROM dropship_partners WHERE id = ? AND client_id = ?`,
    )
      .bind(partnerId, clientId)
      .first();

    try {
      await audit(env, auth.userId ?? 'system', 'dropship.partner.update', 'dropship_partner', partnerId, {});
    } catch {
      /* ignore */
    }

    return json({ data: updated });
  } catch {
    return json({ error: 'Erreur lors de la mise à jour du partenaire' }, 500);
  }
}

/**
 * DELETE /api/dropship-partners/:id
 */
export async function handleDeleteDropshipPartner(
  env: Env,
  auth: WarehouseDropshipAuth,
  partnerId: string,
): Promise<Response> {
  const cap = clientsCapGuard(auth);
  if (cap) return cap;

  const clientId = auth.clientId ?? null;
  if (!clientId || !partnerId) return json({ error: 'Paramètres manquants' }, 400);

  try {
    // 1) Passer le statut à 'inactive' ou faire un DELETE hard ?
    // Faisons un hard delete ou passons le statut à 'deleted' pour être sûr.
    // Un hard delete est plus simple si pas utilisé, ou un soft-delete (status = 'inactive')
    // Pour être cohérent avec handleDeleteWarehouse, faisons un soft-delete ou modifions à 'inactive'.
    // Faisons un DELETE hard si le partenaire n'est pas utilisé ou un DELETE simple pour le moment car
    // la roadmap ou le pitch n'exclut pas le hard delete.
    const delRes = await env.DB.prepare(
      `DELETE FROM dropship_partners WHERE id = ? AND client_id = ?`,
    )
      .bind(partnerId, clientId)
      .run();

    if (delRes.meta.changes === 0) {
      return json({ error: 'Partenaire introuvable' }, 404);
    }

    // 2) Nettoyer la référence dropship_partner_id dans users et dropship_suppliers
    await env.DB.prepare(`UPDATE users SET dropship_partner_id = NULL WHERE dropship_partner_id = ?`)
      .bind(partnerId)
      .run();

    await env.DB.prepare(
      `UPDATE dropship_suppliers SET dropship_partner_id = NULL WHERE dropship_partner_id = ? AND client_id = ?`,
    )
      .bind(partnerId, clientId)
      .run();

    try {
      await audit(env, auth.userId ?? 'system', 'dropship.partner.delete', 'dropship_partner', partnerId, {});
    } catch {
      /* ignore */
    }

    return json({ data: { id: partnerId, deleted: true } });
  } catch {
    return json({ error: 'Erreur lors de la suppression du partenaire' }, 500);
  }
}
