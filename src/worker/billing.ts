import type { Env } from './types';
import { json, sanitizeInput } from './helpers';

// ── Invoices CRUD ───────────────────────────────────────────

export async function handleGetInvoices(
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  let query = `
    SELECT i.*, l.name as lead_name, l.email as lead_email
    FROM invoices i
    LEFT JOIN leads l ON i.lead_id = l.id
  `;
  const params: string[] = [];

  if (auth.role !== 'admin' && auth.clientId) {
    query += ' WHERE i.client_id = ?';
    params.push(auth.clientId);
  }

  query += ' ORDER BY i.created_at DESC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return json({ data: results || [] });
}

export async function handleCreateInvoice(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const clientId = auth.role === 'admin' ? sanitizeInput(body.client_id as string, 100) : auth.clientId;
  const leadId = sanitizeInput(body.lead_id as string, 100);
  const amount = parseFloat(body.amount as string);
  const description = sanitizeInput(body.description as string, 500);

  if (!clientId || isNaN(amount) || amount <= 0) {
    return json({ error: 'Client et montant valide requis' }, 400);
  }

  const invoiceId = `inv_${crypto.randomUUID()}`;

  // Stripe mock for now
  const paymentUrl = `https://pay.intralys.com/checkout/${invoiceId}`;

  await env.DB.prepare(
    `INSERT INTO invoices (id, client_id, lead_id, amount, description, status, payment_url)
     VALUES (?, ?, ?, ?, ?, 'draft', ?)`
  ).bind(invoiceId, clientId, leadId || null, amount, description || null, paymentUrl).run();

  return json({ data: { id: invoiceId, payment_url: paymentUrl } }, 201);
}

export async function handleUpdateInvoiceStatus(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  invoiceId: string
): Promise<Response> {
  const body = await request.json() as { status: string };
  const status = sanitizeInput(body.status, 20);

  if (!['draft', 'sent', 'paid', 'cancelled'].includes(status)) {
    return json({ error: 'Statut invalide' }, 400);
  }

  const invoice = await env.DB.prepare('SELECT client_id FROM invoices WHERE id = ?').bind(invoiceId).first() as { client_id: string } | null;
  if (!invoice) return json({ error: 'Facture introuvable' }, 404);
  if (auth.role !== 'admin' && invoice.client_id !== auth.clientId) {
    return json({ error: 'Non autorisé' }, 403);
  }

  await env.DB.prepare(
    "UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(status, invoiceId).run();

  return json({ data: { success: true, status } });
}

// ── Stripe Webhook ──────────────────────────────────────────

export async function handleStripeWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  // En production, il faudrait vérifier la signature Stripe
  try {
    const event = await request.json() as any;
    
    if (event.type === 'invoice.paid' || event.type === 'checkout.session.completed') {
      // Identifier la facture Intralys correspondante (pour l'exemple on met à jour via ID)
      const clientReferenceId = event.data.object.client_reference_id;
      
      if (clientReferenceId) {
        await env.DB.prepare(
          "UPDATE invoices SET status = 'paid', updated_at = datetime('now') WHERE id = ?"
        ).bind(clientReferenceId).run();
      }
    }
    
    return json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err);
    return json({ error: 'Webhook payload invalid' }, 400);
  }
}
