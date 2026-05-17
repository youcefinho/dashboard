// ── Données facture PDF — Sprint E3 M2 (2026-05-16) ──────────────────────────
//
// Produit le payload structuré d'une facture de commande, prêt à être rendu
// côté front (M3 branchera `triggerPdfExport('invoice')` de lib/pdfExport.ts).
//
// Conventions strictes du projet :
//  - Money TOUJOURS en cents (INTEGER). Les totaux/taxes sont LUS depuis la
//    commande (figés par createOrderCore M1 à la création) — on ne recalcule
//    JAMAIS la fiscalité ici : single source of truth = la commande.
//  - Multi-tenant STRICT : WHERE client_id = ? résolu via getClientModules.
//  - FR québécois. Mention TPS 5 % + TVQ 9,975 % (Québec). Numéros de taxes du
//    commerçant inclus s'ils existent sur le client, omis proprement sinon
//    (lookup défensif : aucune dépendance à un schéma de colonnes incertain).
//  - Gating requireModule('ecommerce') géré AMONT par src/worker.ts.

import type { Env } from './types';
import { json } from './helpers';
import { getClientModules } from './modules';

type Auth = { userId: string; role: string };

/** Résout le client_id du tenant courant (réutilise le helper modules). */
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

/**
 * Récupère les numéros de taxes du commerçant de façon défensive : on tente la
 * lecture des colonnes optionnelles, mais une erreur SQL (colonne absente sur
 * un déploiement donné) ne casse jamais la facture — on omet proprement.
 */
async function fetchMerchant(
  env: Env, clientId: string,
): Promise<{ name: string | null; email: string | null; gst_number: string | null; qst_number: string | null }> {
  // [S2 multi-tenant] tenant-scoped OK : clientId est le tenant courant résolu
  // via getClientModules(auth.userId) — WHERE id = ? lit la fiche du tenant
  // lui-même (pas de fuite : un user ne résout que son propre clientId).
  // Base sûre : colonnes connues du schéma clients.
  let base: { name: string | null; email: string | null } = { name: null, email: null };
  try {
    base = (await env.DB.prepare(
      'SELECT name, email FROM clients WHERE id = ?',
    ).bind(clientId).first()) as { name: string | null; email: string | null } | null
      || { name: null, email: null };
  } catch {
    /* schéma minimal : on continue sans nom/courriel commerçant */
  }

  // Numéros de taxes : optionnels, lecture best-effort (omis si colonnes absentes).
  let gst: string | null = null;
  let qst: string | null = null;
  try {
    const tax = (await env.DB.prepare(
      'SELECT gst_number, qst_number FROM clients WHERE id = ?',
    ).bind(clientId).first()) as { gst_number?: string | null; qst_number?: string | null } | null;
    gst = tax?.gst_number ?? null;
    qst = tax?.qst_number ?? null;
  } catch {
    /* colonnes taxes non présentes → mention générique, pas de numéros */
  }

  return { name: base?.name ?? null, email: base?.email ?? null, gst_number: gst, qst_number: qst };
}

/**
 * GET /api/ecommerce/orders/:id/invoice
 *
 * Payload structuré prêt pour le template print 'invoice' (lib/pdfExport.ts) :
 *   {
 *     order:    { id, order_number, placed_at, status, financial_status, … },
 *     items:    [ { product_title, variant_title, sku, unit_price_cents,
 *                   quantity, total_cents, tax_cents } ]  (snapshots figés),
 *     totals:   { subtotal_cents, tps_cents, tvq_cents, shipping_cents,
 *                 discount_cents, total_cents },
 *     client:   { name, email, gst_number?, qst_number?, tax_note },
 *     customer: { … } | null
 *   }
 * M3 branchera le bouton « Télécharger la facture » sur triggerPdfExport.
 */
export async function handleGetOrderInvoice(
  env: Env, auth: Auth, orderId: string,
): Promise<Response> {
  const clientId = await resolveClientId(env, auth);
  if (!clientId) return noClient();

  // [S2 multi-tenant] tenant-scoped OK : WHERE id = ? AND client_id = ?.
  // Ce gate est le SEUL point d'isolation pour la facture — order_items n'a
  // PAS de colonne client_id (schéma E1 ~l.195-207), son scope tenant dérive
  // exclusivement de cet order validé. Plaquer un client_id sur order_items
  // casserait (no such column).
  const order = (await env.DB.prepare(
    'SELECT * FROM orders WHERE id = ? AND client_id = ?',
  ).bind(orderId, clientId).first()) as Record<string, unknown> | null;
  if (!order) return json({ error: 'Commande introuvable' }, 404);

  // [S2 multi-tenant] défense en profondeur : on ne lit les items QUE si
  // l'order vérifié ci-dessus appartient bien au tenant. order.id provient de
  // la ligne déjà filtrée par client_id — on relie order_items sur cet id
  // prouvé tenant (jamais l'orderId brut de l'URL non re-validé).
  const verifiedOrderId = String(order.id ?? orderId);
  const { results: itemRows } = await env.DB.prepare(
    'SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at ASC',
  ).bind(verifiedOrderId).all();
  const items = (itemRows || []).map((r) => {
    const it = r as Record<string, unknown>;
    return {
      product_title: it.product_title_snapshot ?? '',
      variant_title: it.variant_title_snapshot ?? '',
      sku: it.sku_snapshot ?? '',
      unit_price_cents: Number(it.unit_price_cents ?? 0),
      quantity: Number(it.quantity ?? 0),
      total_cents: Number(it.total_cents ?? 0),
      tax_cents: Number(it.tax_cents ?? 0),
    };
  });

  // [S2 multi-tenant] tenant-scoped OK : WHERE id = ? AND client_id = ?
  // (customers a un client_id propre — double garde id + tenant).
  let customer: unknown = null;
  if (order.customer_id) {
    customer = await env.DB.prepare(
      'SELECT * FROM customers WHERE id = ? AND client_id = ?',
    ).bind(order.customer_id as string, clientId).first();
  }

  const merchant = await fetchMerchant(env, clientId);

  // Devise réelle de la commande (colonne E1, défaut 'CAD' au schéma). On ne
  // hardcode plus 'CAD' : une commande UE/DZ porte sa propre devise.
  const currency = (typeof order.currency === 'string' && order.currency.trim())
    ? order.currency.trim().toUpperCase()
    : 'CAD';

  // Régime fiscal figé de la commande (défaut 'QC' : données E3 sans colonne).
  const taxRegion = (typeof order.tax_region === 'string' && order.tax_region.trim())
    ? order.tax_region.trim().toUpperCase()
    : 'QC';

  // Ventilation fiscale réelle. Priorité : tax_breakdown_json figé par
  // createOrderCore (multi-lignes, ex. TVA UE). Fallback DÉFENSIF si commande
  // E3 ancienne (colonne NULL/absente) : on reconstruit depuis tps/tvq legacy
  // (même pattern défensif que fetchMerchant). Jamais d'exception → facture
  // toujours rendue.
  type TaxBreakdownLine = { label: string; rate: number; amountCents: number };
  let taxBreakdown: TaxBreakdownLine[] = [];
  const rawBreakdown = order.tax_breakdown_json;
  if (typeof rawBreakdown === 'string' && rawBreakdown.trim()) {
    try {
      const parsed = JSON.parse(rawBreakdown);
      if (Array.isArray(parsed)) {
        taxBreakdown = parsed
          .filter((l): l is TaxBreakdownLine =>
            l && typeof l.label === 'string' && typeof l.amountCents === 'number')
          .map((l) => ({
            label: l.label,
            rate: Number(l.rate ?? 0),
            amountCents: Number(l.amountCents ?? 0),
          }));
      }
    } catch {
      /* JSON corrompu : on bascule sur le fallback legacy ci-dessous */
    }
  }
  if (taxBreakdown.length === 0) {
    // Fallback legacy E3 : ventilation reconstruite depuis tps_cents/tvq_cents.
    const tpsLegacy = Number(order.tps_cents ?? 0);
    const tvqLegacy = Number(order.tvq_cents ?? 0);
    if (tpsLegacy > 0) taxBreakdown.push({ label: 'TPS', rate: 0.05, amountCents: tpsLegacy });
    if (tvqLegacy > 0) taxBreakdown.push({ label: 'TVQ', rate: 0.09975, amountCents: tvqLegacy });
  }

  // Mention fiscale. QC = mention TPS/TVQ Québec (numéros si présents).
  // Régimes non-QC : mention générique dérivée de la ventilation réelle.
  const taxParts: string[] = [];
  if (merchant.gst_number) taxParts.push(`N° TPS : ${merchant.gst_number}`);
  if (merchant.qst_number) taxParts.push(`N° TVQ : ${merchant.qst_number}`);
  let taxNote: string;
  if (taxRegion === 'QC') {
    taxNote = taxParts.length
      ? `Taxes du Québec — TPS 5 % et TVQ 9,975 %. ${taxParts.join(' · ')}.`
      : 'Taxes du Québec — TPS 5 % et TVQ 9,975 %.';
  } else if (taxBreakdown.length) {
    const labels = taxBreakdown.map((l) => l.label).join(' · ');
    taxNote = `Taxes applicables — ${labels}.`;
  } else {
    taxNote = 'Aucune taxe applicable.';
  }

  return json({
    data: {
      order: {
        id: order.id,
        order_number: order.order_number,
        placed_at: order.placed_at ?? order.created_at ?? null,
        created_at: order.created_at ?? null,
        status: order.status,
        financial_status: order.financial_status,
        fulfillment_status: order.fulfillment_status,
        email: order.email ?? null,
        note: order.note ?? null,
        source: order.source ?? null,
        currency,
        tax_region: taxRegion,
      },
      items,
      totals: {
        subtotal_cents: Number(order.subtotal_cents ?? 0),
        tps_cents: Number(order.tps_cents ?? 0),
        tvq_cents: Number(order.tvq_cents ?? 0),
        shipping_cents: Number(order.shipping_cents ?? 0),
        discount_cents: Number(order.discount_cents ?? 0),
        total_cents: Number(order.total_cents ?? 0),
        // Ventilation fiscale réelle multi-lignes (UE) ou QC TPS/TVQ.
        // Fallback legacy défensif déjà appliqué (commandes E3 anciennes).
        tax_breakdown: taxBreakdown,
      },
      client: {
        name: merchant.name,
        email: merchant.email,
        gst_number: merchant.gst_number,
        qst_number: merchant.qst_number,
        tax_note: taxNote,
      },
      customer,
    },
  });
}
