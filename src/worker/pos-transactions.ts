// ── POS transactions (événements caisse) — Sprint 37 IMPL (2026-05-24) ──────
//
// Handlers AUTHED scan barcode + create/void transactions caisse.
// RÉUTILISE `createOrderCore` + `commitOrderSale` de `./ecommerce-orders` —
// AUCUNE duplication de logique commande/stock/taxe (régression-zéro QC).
//
// Bornage tenant strict (`WHERE client_id = ?`) defense-in-depth IDOR.
// Capabilities seq80 FIGÉES : `clients.manage` (opération caisse).
// Réponses normalisées : json({ data }) succès / json({ error }, status) erreur.
// PAS de champ `code`.
//
// ⚠️ FIGÉ contrat (docs/LOT-POS-S37.md §6) — signatures invariantes.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { getClientModules } from './modules';
import { createOrderCore, commitOrderSale } from './ecommerce-orders';
import {
  computeChange,
  chargeCardTerminal,
  validatePaymentSplit,
  type PaymentSplit,
} from './lib/pos-engine';
import {
  buildReceiptPdfStub,
  uploadReceiptToR2,
  type ReceiptPayload,
  type ReceiptItem,
  type ReceiptTaxLine,
} from './lib/pos-receipt';

type Auth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

async function getCaps(env: Env, auth: Auth): Promise<Set<string>> {
  return auth.capabilities instanceof Set
    ? auth.capabilities
    : await resolveCapabilities(env, auth);
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const ALLOWED_PAYMENT_METHODS = new Set<string>([
  'cash',
  'card_terminal',
  'gift_card',
  'other',
  'split',
]);

// ── GET /api/pos/products/scan/:barcode — résolution variante par EAN/UPC ──
export async function handleScanBarcode(
  env: Env,
  auth: Auth,
  barcode: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const code = (barcode || '').toString().trim();
    if (!code) return json({ error: 'barcode requis' }, 400);

    // Lookup via idx_product_variants_barcode (seq132). Bornage tenant via JOIN
    // products.client_id (variants n'ont pas client_id direct).
    const row = (await env.DB.prepare(
      `SELECT v.id AS variant_id, v.product_id, v.sku, v.barcode,
              v.price_override AS price_cents, v.title AS variant_title,
              p.title AS product_title,
              COALESCE(i.quantity, 0) AS in_stock,
              p.base_price AS base_price
         FROM product_variants v
         JOIN products p ON v.product_id = p.id
    LEFT JOIN inventory i ON i.variant_id = v.id
        WHERE v.barcode = ? AND p.client_id = ?
        LIMIT 1`,
    )
      .bind(code, clientId)
      .first()) as
      | {
          variant_id: string;
          product_id: string;
          sku: string | null;
          barcode: string | null;
          price_cents: number | null;
          variant_title: string | null;
          product_title: string | null;
          in_stock: number;
          base_price: number | null;
        }
      | null;

    if (!row) return json({ error: 'barcode_not_found' }, 404);

    // Prix effectif : price_override (si défini) sinon base_price (calque
    // createOrderCore.ts l.251). Source de vérité createOrderCore — ici on
    // expose juste pour pré-affichage caisse.
    const unitPriceCents =
      row.price_cents != null
        ? Math.max(0, Math.round(row.price_cents))
        : Math.max(0, Math.round(row.base_price ?? 0));

    return json({
      data: {
        variant: {
          id: row.variant_id,
          product_id: row.product_id,
          sku: row.sku,
          barcode: row.barcode,
          title: row.variant_title,
          price_cents: unitPriceCents,
        },
        product: {
          id: row.product_id,
          title: row.product_title,
        },
        in_stock: row.in_stock,
        unit_price_cents: unitPriceCents,
      },
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}

// ── POST /api/pos/transactions — finaliser un panier caisse ─────────────────
export async function handleCreatePosTransaction(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    // ── Validation entrée ────────────────────────────────────────────────
    const sessionId =
      typeof body.session_id === 'string' && body.session_id.trim().length > 0
        ? body.session_id.trim()
        : null;
    if (!sessionId) return json({ error: 'session_id requis' }, 400);

    const cartRaw = Array.isArray(body.cart) ? (body.cart as unknown[]) : [];
    if (cartRaw.length === 0) return json({ error: 'cart_empty' }, 400);

    const cart: Array<{ variant_id: string; quantity: number }> = [];
    for (const raw of cartRaw) {
      const item = (raw || {}) as Record<string, unknown>;
      const variantId =
        typeof item.variant_id === 'string' ? item.variant_id.trim() : '';
      const quantity = toInt(item.quantity);
      if (!variantId || quantity === null || quantity < 1) {
        return json({ error: 'cart_item_invalid' }, 400);
      }
      cart.push({ variant_id: variantId, quantity });
    }

    const payment = (body.payment || {}) as Record<string, unknown>;
    const method =
      typeof payment.method === 'string' ? payment.method.trim() : '';
    if (!ALLOWED_PAYMENT_METHODS.has(method)) {
      return json({ error: 'payment_method_invalid' }, 400);
    }
    const tenderedCents = toInt(payment.tendered_cents);

    const splitsRaw = Array.isArray(payment.splits)
      ? (payment.splits as unknown[])
      : null;
    let splits: PaymentSplit[] | null = null;
    if (method === 'split') {
      if (!splitsRaw || splitsRaw.length === 0) {
        return json({ error: 'splits_required' }, 400);
      }
      splits = [];
      for (const raw of splitsRaw) {
        const s = (raw || {}) as Record<string, unknown>;
        const sm = typeof s.method === 'string' ? s.method.trim() : '';
        const sa = toInt(s.amount_cents);
        if (!sm || sa === null || sa < 0) {
          return json({ error: 'split_item_invalid' }, 400);
        }
        splits.push({ method: sm, amountCents: sa });
      }
    }

    const customerId =
      typeof body.customer_id === 'string' && body.customer_id.trim().length > 0
        ? body.customer_id.trim()
        : null;

    // ── Tenant + session bornage ─────────────────────────────────────────
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const session = (await env.DB.prepare(
      `SELECT id, status, client_id, register_id
         FROM pos_sessions
        WHERE id = ? AND client_id = ?
        LIMIT 1`,
    )
      .bind(sessionId, clientId)
      .first()) as
      | {
          id: string;
          status: string;
          client_id: string;
          register_id: string;
        }
      | null;

    if (!session) return json({ error: 'session_not_open' }, 409);
    if (session.status !== 'open') {
      return json({ error: 'session_not_open' }, 409);
    }

    // Lookup register pour régime fiscal + nom (reçu).
    const register = (await env.DB.prepare(
      `SELECT id, name, default_tax_region
         FROM pos_registers
        WHERE id = ? AND client_id = ?
        LIMIT 1`,
    )
      .bind(session.register_id, clientId)
      .first()) as
      | { id: string; name: string | null; default_tax_region: string | null }
      | null;

    const region =
      (register?.default_tax_region || 'qc').toLowerCase() || 'qc';

    // ── Création de la commande (réutilise createOrderCore — verbatim) ──
    let orderResult: Awaited<ReturnType<typeof createOrderCore>>;
    try {
      orderResult = await createOrderCore(
        env,
        clientId,
        {
          customer_id: customerId,
          email: '',
          items: cart.map((c) => ({
            variant_id: c.variant_id,
            quantity: c.quantity,
          })),
          source: 'pos',
          tax_region: region,
        },
        auth.userId,
      );
    } catch (e) {
      // OrderError du createOrderCore propage status + payload. Fallback 400.
      const oe = e as { status?: number; payload?: Record<string, unknown> };
      if (oe && typeof oe.status === 'number' && oe.payload) {
        return json(oe.payload, oe.status);
      }
      return json(
        { error: e instanceof Error ? e.message : String(e) },
        400,
      );
    }

    const totalCents = orderResult.total_cents;
    const tpsCents = orderResult.tps_cents;
    const tvqCents = orderResult.tvq_cents;
    const subtotalCents = orderResult.subtotal_cents;
    const orderId = orderResult.id;
    const orderNumber = orderResult.order_number;

    // ── Validation paiement (selon méthode) ──────────────────────────────
    let changeDueCents = 0;
    let cardTerminalRef: string | null = null;

    if (method === 'cash') {
      if (tenderedCents === null) {
        return json({ error: 'insufficient_tender' }, 400);
      }
      const change = computeChange(totalCents, tenderedCents);
      if (change.error === 'insufficient') {
        return json({ error: 'insufficient_tender' }, 400);
      }
      changeDueCents = change.changeCents;
    } else if (method === 'card_terminal') {
      const charge = await chargeCardTerminal(env, totalCents, sessionId);
      if (!charge.success) {
        return json(
          { error: 'card_terminal_charge_failed' },
          400,
        );
      }
      cardTerminalRef = charge.providerRef || null;
    } else if (method === 'split') {
      const validation = validatePaymentSplit(totalCents, splits || []);
      if (!validation.valid) {
        return json(
          { error: `split_invalid_${validation.error || 'unknown'}` },
          400,
        );
      }
    }
    // 'gift_card' / 'other' : pas de validation supplémentaire (PSP externe).

    // ── Concrétisation vente (réutilise commitOrderSale — décrément stock +
    //    paid_at + financial_status='paid'). IDEMPOTENT.
    await commitOrderSale(env, clientId, orderId, auth.userId);

    // ── INSERT pos_transactions ──────────────────────────────────────────
    const txId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO pos_transactions
         (id, session_id, client_id, order_id, payment_method, amount_cents,
          tendered_cents, change_due_cents, card_terminal_ref, cashier_id,
          created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        txId,
        sessionId,
        clientId,
        orderId,
        method,
        totalCents,
        method === 'cash' ? tenderedCents : null,
        changeDueCents,
        cardTerminalRef,
        auth.userId,
      )
      .run();

    // ── Mise à jour agrégats session ─────────────────────────────────────
    await env.DB.prepare(
      `UPDATE pos_sessions
          SET total_sales_cents = total_sales_cents + ?,
              total_tax_cents   = total_tax_cents + ?,
              transaction_count = transaction_count + 1
        WHERE id = ? AND client_id = ?`,
    )
      .bind(totalCents, tpsCents + tvqCents, sessionId, clientId)
      .run();

    // ── Rattachement order ↔ POS (additif — colonnes seq132) ─────────────
    await env.DB.prepare(
      `UPDATE orders
          SET pos_session_id = ?, pos_register_id = ?
        WHERE id = ? AND client_id = ?`,
    )
      .bind(sessionId, session.register_id, orderId, clientId)
      .run();

    // ── Reçu best-effort (jamais bloquant) ───────────────────────────────
    let receiptUrl: string | null = null;
    try {
      // Tenant name pour le reçu (best-effort).
      const tenantRow = (await env.DB.prepare(
        'SELECT name FROM clients WHERE id = ? LIMIT 1',
      )
        .bind(clientId)
        .first()) as { name: string | null } | null;

      // Items pour reçu (relecture order_items pour snapshots figés).
      const itemsRes = await env.DB.prepare(
        `SELECT product_title_snapshot, variant_title_snapshot, sku_snapshot,
                quantity, unit_price_cents, total_cents
           FROM order_items
          WHERE order_id = ?
          ORDER BY created_at ASC`,
      )
        .bind(orderId)
        .all();
      const items: ReceiptItem[] = (
        (itemsRes.results || []) as Array<{
          product_title_snapshot: string | null;
          variant_title_snapshot: string | null;
          sku_snapshot: string | null;
          quantity: number;
          unit_price_cents: number;
          total_cents: number;
        }>
      ).map((r) => ({
        title: r.product_title_snapshot || '',
        variant_title: r.variant_title_snapshot || undefined,
        sku: r.sku_snapshot || undefined,
        quantity: r.quantity,
        unit_price_cents: r.unit_price_cents,
        line_total_cents: r.total_cents,
      }));

      const taxLines: ReceiptTaxLine[] = [];
      if (tpsCents > 0) {
        taxLines.push({ label: 'TPS (5%)', rate: 0.05, amount_cents: tpsCents });
      }
      if (tvqCents > 0) {
        taxLines.push({
          label: 'TVQ (9,975%)',
          rate: 0.09975,
          amount_cents: tvqCents,
        });
      }

      const receiptPayload: ReceiptPayload = {
        tenantName: tenantRow?.name || 'Boutique',
        transactionId: txId,
        orderNumber,
        placedAt: new Date().toISOString(),
        items,
        subtotalCents,
        taxLines,
        totalCents,
        paymentMethod: method as ReceiptPayload['paymentMethod'],
        tenderedCents:
          method === 'cash' && tenderedCents !== null
            ? tenderedCents
            : undefined,
        changeCents: method === 'cash' ? changeDueCents : undefined,
        cashierName: auth.userId,
        registerName: register?.name || session.register_id,
      };

      const pdfBytes = await buildReceiptPdfStub(receiptPayload, 'fr-CA');
      const uploaded = await uploadReceiptToR2(
        env,
        clientId,
        txId,
        pdfBytes,
      );
      if (uploaded?.r2Key) {
        receiptUrl = uploaded.r2Key;
        await env.DB.prepare(
          'UPDATE pos_transactions SET receipt_url = ? WHERE id = ? AND client_id = ?',
        )
          .bind(receiptUrl, txId, clientId)
          .run();
      }
    } catch {
      /* best-effort : reçu ne doit JAMAIS casser la transaction caisse */
    }

    await audit(
      env,
      auth.userId,
      'pos_transaction_created',
      'pos_transaction',
      txId,
      {
        session_id: sessionId,
        order_id: orderId,
        order_number: orderNumber,
        payment_method: method,
        total_cents: totalCents,
      },
    );

    return json({
      data: {
        transaction_id: txId,
        order_id: orderId,
        order_number: orderNumber,
        totals: {
          subtotal_cents: subtotalCents,
          tps_cents: tpsCents,
          tvq_cents: tvqCents,
          total_cents: totalCents,
        },
        change_due_cents: changeDueCents,
        receipt_url: receiptUrl,
      },
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}

// ── POST /api/pos/transactions/:id/void — annuler une transaction ──────────
export async function handleVoidPosTransaction(
  request: Request,
  env: Env,
  auth: Auth,
  txId: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const reason =
      typeof body.reason === 'string' ? body.reason.slice(0, 2000) : '';

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Bornage tenant + load tx.
    const tx = (await env.DB.prepare(
      `SELECT id, session_id, order_id, amount_cents, payment_method, voided_at
         FROM pos_transactions
        WHERE id = ? AND client_id = ?
        LIMIT 1`,
    )
      .bind(txId, clientId)
      .first()) as
      | {
          id: string;
          session_id: string;
          order_id: string | null;
          amount_cents: number | null;
          payment_method: string | null;
          voided_at: string | null;
        }
      | null;

    if (!tx) return json({ error: 'transaction_not_found' }, 404);
    if (tx.voided_at) return json({ error: 'already_voided' }, 409);

    const amountCents = tx.amount_cents ?? 0;

    // ── Mark as voided ────────────────────────────────────────────────────
    await env.DB.prepare(
      `UPDATE pos_transactions
          SET voided_at = datetime('now'),
              voided_by = ?,
              void_reason = ?
        WHERE id = ? AND client_id = ?`,
    )
      .bind(auth.userId, reason || null, txId, clientId)
      .run();

    // ── Cascade refund (best-effort, ne bloque pas le void) ──────────────
    let refundId: string | null = null;
    if (tx.order_id) {
      try {
        // Insertion directe d'une ligne refunds 'succeeded' (pas d'appel PSP
        // pour un void caisse — cash/cardterminal mock : remboursement local
        // équivalent au paiement caisse). Le pont financier
        // recordRefundTransition est invoqué pour cohérence orders.financial_status.
        const newRefundId = crypto.randomUUID();

        // Lookup d'un payment_id éventuel (peut être null pour POS cash —
        // refunds.payment_id contrainte schema E6 : si non null, doit pointer
        // un payment réel ; si POS sans payment row, on skip l'insert refund
        // formel et on se contente du restock + audit).
        const paymentRow = (await env.DB.prepare(
          `SELECT id, currency FROM payments
            WHERE client_id = ? AND order_id = ?
            ORDER BY created_at DESC LIMIT 1`,
        )
          .bind(clientId, tx.order_id)
          .first()) as { id: string; currency: string | null } | null;

        if (paymentRow) {
          const idemKey = `pos_void:${txId}`;
          await env.DB.prepare(
            `INSERT OR IGNORE INTO refunds
               (id, client_id, order_id, payment_id, amount_cents, currency,
                status, provider_ref, idempotency_key, reason, created_by)
             VALUES (?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?)`,
          )
            .bind(
              newRefundId,
              clientId,
              tx.order_id,
              paymentRow.id,
              amountCents,
              paymentRow.currency || 'CAD',
              `pos_void_${txId}`,
              idemKey,
              `pos_void: ${reason || 'annulation caisse'}`.slice(0, 500),
              auth.userId,
            )
            .run();

          // Pont financier (idempotent, recalcul déterministe).
          try {
            const { recordRefundTransition } = await import(
              './ecommerce-refunds'
            );
            await recordRefundTransition(env, {
              order_id: tx.order_id,
              refund_id: newRefundId,
              amount_cents: amountCents,
              status: 'succeeded',
            });
          } catch {
            /* best-effort */
          }
          refundId = newRefundId;
        }
      } catch {
        /* best-effort : la cascade refund ne doit pas bloquer le void */
      }

      // ── Restock : réincrémente la quantité pour chaque order_item ─────
      try {
        const itemsRes = await env.DB.prepare(
          `SELECT variant_id, quantity
             FROM order_items
            WHERE order_id = ?`,
        )
          .bind(tx.order_id)
          .all();
        const lines = (itemsRes.results || []) as Array<{
          variant_id: string | null;
          quantity: number;
        }>;
        for (const ln of lines) {
          if (!ln.variant_id || ln.quantity <= 0) continue;
          // UPDATE inventory + INSERT mouvement 'return' (réincrément stock).
          await env.DB.prepare(
            `UPDATE inventory
                SET quantity = COALESCE(quantity, 0) + ?,
                    updated_at = datetime('now')
              WHERE variant_id = ?`,
          )
            .bind(ln.quantity, ln.variant_id)
            .run();
          await env.DB.prepare(
            `INSERT INTO inventory_movements
               (id, variant_id, delta, reason, reference_type, reference_id,
                note, created_by)
             VALUES (?, ?, ?, 'return', 'pos_void', ?, ?, ?)`,
          )
            .bind(
              crypto.randomUUID(),
              ln.variant_id,
              ln.quantity,
              txId,
              `Void caisse : ${reason || 'annulation'}`.slice(0, 500),
              auth.userId,
            )
            .run();
        }
      } catch {
        /* best-effort : le restock ne doit pas bloquer le void */
      }
    }

    // ── Décrément agrégats session (soustraction atomique) ──────────────
    await env.DB.prepare(
      `UPDATE pos_sessions
          SET total_sales_cents = total_sales_cents - ?,
              transaction_count = transaction_count - 1
        WHERE id = ? AND client_id = ?`,
    )
      .bind(amountCents, tx.session_id, clientId)
      .run();

    await audit(
      env,
      auth.userId,
      'pos_transaction_voided',
      'pos_transaction',
      txId,
      { reason, refund_id: refundId },
    );

    // Re-lecture voided_at pour cohérence (datetime('now') côté DB).
    const voidedRow = (await env.DB.prepare(
      'SELECT voided_at FROM pos_transactions WHERE id = ? AND client_id = ?',
    )
      .bind(txId, clientId)
      .first()) as { voided_at: string | null } | null;

    return json({
      data: {
        transaction_id: txId,
        refund_id: refundId,
        voided_at: voidedRow?.voided_at ?? null,
      },
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}
