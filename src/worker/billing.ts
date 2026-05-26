import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { requireCapability, type Capability } from './capabilities';

// ── LOT TEAM B-bis — garde de capability CONDITIONNELLE (mode-agence-only) ───
// Enforce UNIQUEMENT si l'auth porte un contexte agence (tenant.agencyId !=
// null) ET un set capabilities (injecté choke-point worker.ts). Legacy/mono-
// tenant, chemin API-key et suites de test ⇒ condition FALSE ⇒ skip ⇒
// comportement BYTE-IDENTIQUE. NB : garde sur la CRÉATION/ÉDITION de facture
// uniquement — n'active AUCUNE logique paiement/Stripe (webhook intact).
function capGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> },
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;
}

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

// Arrondi monétaire 2 décimales (docs/LOT-INVOICE.md §6.C).
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

type InvLine = { label: string; qty: number; unit_price: number; line_total: number };

// Normalise + calcule lignes et taxes SERVEUR (§6.C VERBATIM). null si vide.
function computeInvoiceTotals(
  rawItems: unknown,
): { lines: InvLine[]; subtotal: number; tax_tps: number; tax_tvq: number; total: number } | null {
  if (!Array.isArray(rawItems)) return null;
  const lines: InvLine[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const label = sanitizeInput(String(o.label ?? ''), 300);
    const qty = Number(o.qty);
    const unit_price = Number(o.unit_price);
    if (!label || !isFinite(qty) || !isFinite(unit_price)) continue;
    const line_total = round2(qty * unit_price);
    lines.push({ label, qty, unit_price, line_total });
  }
  if (lines.length === 0) return null;
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const tax_tps = round2(subtotal * 0.05);
  const tax_tvq = round2(subtotal * 0.09975);
  const total = round2(subtotal + tax_tps + tax_tvq);
  return { lines, subtotal, tax_tps, tax_tvq, total };
}

// Génère INV-<YYYY>-<NNNN> borné scope tenant pour l'année courante (§6.C).
// `invoices` n'a PAS d'agency_id (migration_p3_8.sql) ⇒ scope = client_id
// (legacy/mono-tenant, cohérent avec handleGetInvoices/UpdateInvoiceStatus).
async function nextInvoiceNumber(env: Env, clientId: string | null): Promise<string> {
  const year = new Date().getFullYear();
  const like = `INV-${year}-%`;
  let count = 0;
  try {
    let sql = 'SELECT COUNT(*) AS n FROM invoices WHERE invoice_number LIKE ?';
    const binds: unknown[] = [like];
    if (clientId != null) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    const row = (await env.DB.prepare(sql).bind(...binds).first()) as { n: number } | null;
    count = Number(row?.n) || 0;
  } catch {
    count = 0;
  }
  return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
}

export async function handleCreateInvoice(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  const cg = capGuard(auth as never, 'invoices.write');
  if (cg) return cg;

  const body = await request.json() as Record<string, unknown>;
  const clientId = auth.role === 'admin' ? sanitizeInput(body.client_id as string, 100) : auth.clientId;
  const leadId = sanitizeInput(body.lead_id as string, 100);
  const description = sanitizeInput(body.description as string, 500);

  // ── Chemin ENRICHI : lignes d'articles + taxes SERVEUR (§6.C) ────────────
  // payment_url = NULL (§6.E — JAMAIS d'URL Stripe factice). Rétro-compat :
  // si pas d'`items`, on retombe sur le chemin legacy `amount`-seul ci-après.
  const totals = computeInvoiceTotals(body.items);
  if (totals) {
    if (!clientId) {
      return json({ error: 'Client et montant valide requis' }, 400);
    }
    const invoiceId = `inv_${crypto.randomUUID()}`;
    const dueDate = sanitizeInput(body.due_date as string, 40) || null;
    const tpsNumber = sanitizeInput(body.tps_number as string, 60) || null;
    const tvqNumber = sanitizeInput(body.tvq_number as string, 60) || null;
    const invoiceNumber = await nextInvoiceNumber(env, clientId || null);

    await env.DB.prepare(
      `INSERT INTO invoices
         (id, client_id, lead_id, amount, description, status, payment_url,
          invoice_number, subtotal, tax_tps, tax_tvq, total, due_date,
          tps_number, tvq_number)
       VALUES (?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        invoiceId,
        clientId,
        leadId || null,
        totals.total,
        description || null,
        invoiceNumber,
        totals.subtotal,
        totals.tax_tps,
        totals.tax_tvq,
        totals.total,
        dueDate,
        tpsNumber,
        tvqNumber,
      )
      .run();

    for (const l of totals.lines) {
      await env.DB.prepare(
        `INSERT INTO invoice_items (invoice_id, label, qty, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(invoiceId, l.label, l.qty, l.unit_price, l.line_total)
        .run();
    }

    return json({ data: { id: invoiceId, invoice_number: invoiceNumber } }, 201);
  }

  // ── Chemin LEGACY rétro-compatible : { amount } seul, total = NULL (§6.I).
  // Comportement BYTE-IDENTIQUE à l'historique SAUF payment_url honnête
  // (§6.E : NULL au lieu de l'URL Stripe factice — décision FIGÉE).
  const amount = parseFloat(body.amount as string);
  if (!clientId || isNaN(amount) || amount <= 0) {
    return json({ error: 'Client et montant valide requis' }, 400);
  }

  const invoiceId = `inv_${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT INTO invoices (id, client_id, lead_id, amount, description, status, payment_url)
     VALUES (?, ?, ?, ?, ?, 'draft', NULL)`
  ).bind(invoiceId, clientId, leadId || null, amount, description || null).run();

  return json({ data: { id: invoiceId, payment_url: null } }, 201);
}

export async function handleUpdateInvoiceStatus(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  invoiceId: string
): Promise<Response> {
  const cg = capGuard(auth as never, 'invoices.write');
  if (cg) return cg;

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

// ── LOT FACTURATION-RÉELLE — État : IMPLÉMENTÉ (corps réels présents) ────────
// Signatures FIGÉES (docs/LOT-INVOICE.md §6.D). Corps en place
// (lignes invoice_items, taxes calculées SERVEUR §6.C, payment_url honnête
// §6.E = null + instructions, JAMAIS d'URL Stripe factice). La garde
// `capGuard(auth, 'invoices.write')` (billing.ts:11-19, mode-agence-only,
// byte-identique legacy) reste OBLIGATOIRE sur la création/édition enrichie.
// NB : `handleCreateInvoice` (garde capGuard LOT B-bis posée) est ENRICHI
// (lignes + taxes + payment_url=null) — sa signature/endpoint sont FIGÉS.

// GET /api/invoices/:id — une facture + ses lignes (jointure applicative
// invoice_items par invoice_id, PAS de FK). Bornage tenant §6.D. Fallback
// rétro-compat : total ?? amount, subtotal/tax_tps/tax_tvq peuvent être NULL
// pour les factures legacy (colonnes seq 82 nullable).
// Charge une facture bornée tenant. null si introuvable / hors périmètre.
// `invoices` n'a PAS d'agency_id (migration_p3_8.sql) ⇒ bornage client_id
// (calque EXACT handleUpdateInvoiceStatus:92-96 : admin ⇒ scope plein,
// sinon client_id == auth.clientId). Best-effort : panne D1 ⇒ null.
async function loadInvoiceScoped(
  env: Env,
  invoiceId: string,
  auth: { role: string; clientId?: string },
): Promise<Record<string, unknown> | null> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM invoices WHERE id = ?')
      .bind(invoiceId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  if (!row) return null;
  if (auth.role !== 'admin' && row.client_id !== auth.clientId) return null;
  return row;
}

async function loadInvoiceItems(
  env: Env,
  invoiceId: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY created_at ASC',
    )
      .bind(invoiceId)
      .all();
    return (results || []) as Array<Record<string, unknown>>;
  } catch {
    // Table seq 82 absente (facture legacy) : pas de lignes, dégradé propre.
    return [];
  }
}

export async function handleGetInvoice(
  _request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  invoiceId: string,
): Promise<Response> {
  const row = await loadInvoiceScoped(env, invoiceId, auth);
  if (!row) return json({ error: 'Facture introuvable' }, 404);
  const items = await loadInvoiceItems(env, invoiceId);
  // Rétro-compat §6.I : facture legacy ⇒ subtotal/tax_tps/tax_tvq/total NULL,
  // le front lit `total ?? amount` en fallback. payment_url honnête (§6.E).
  return json({ data: { ...row, items } });
}

// GET /api/invoices/:id/pdf-data — données structurées pour le gabarit PDF
// (entête tenant + n° d'inscription tps/tvq snapshot + lignes + ventilation
// TPS 5 % / TVQ 9,975 % stockée serveur §6.C). Réponse bien formée.
export async function handleGetInvoicePdfData(
  _request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  invoiceId: string,
): Promise<Response> {
  const row = await loadInvoiceScoped(env, invoiceId, auth);
  if (!row) return json({ error: 'Facture introuvable' }, 404);
  const items = await loadInvoiceItems(env, invoiceId);

  // Structure attendue par api.ts InvoicePdfData (§6.D) : { invoice, items,
  // issuer }. issuer = snapshot n° d'inscription porté SUR la pièce (§6.C —
  // pas sur clients). Nom émetteur best-effort depuis le client lié.
  let issuerName: string | undefined;
  try {
    const clientId = row.client_id == null ? null : String(row.client_id);
    if (clientId) {
      const c = (await env.DB.prepare('SELECT name FROM clients WHERE id = ?')
        .bind(clientId)
        .first()) as { name: string | null } | null;
      issuerName = c?.name ?? undefined;
    }
  } catch {
    issuerName = undefined;
  }

  return json({
    data: {
      invoice: row,
      items,
      issuer: {
        name: issuerName,
        tps_number: row.tps_number ?? null,
        tvq_number: row.tvq_number ?? null,
      },
    },
  });
}

// ── Stripe Webhook ──────────────────────────────────────────
//
// EXTENSION CHIRURGICALE Sprint 22 (Manager-B) : dispatcher SaaS AVANT le bloc
// legacy. Le bloc legacy `invoice.paid` + `checkout.session.completed` reste
// BYTE-IDENTIQUE pour rétro-compat (UPDATE invoices.status). Le dispatcher
// SaaS persiste les events de subscription/facture côté billing_events +
// billing_invoices_mock (seq120), sans toucher au flow legacy.

export async function handleStripeWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Lire le body brut une seule fois (verifier signature + parser event).
    const rawBody = await request.text();

    // ── Dispatcher SaaS (Sprint 22) — additif AVANT le bloc legacy ─────────
    let saasSignatureVerified = false;
    try {
      const { verifyStripeWebhookSignatureSaas } = await import('./lib/saas-billing-mock');
      const verify = await verifyStripeWebhookSignatureSaas(
        env,
        rawBody,
        request.headers.get('stripe-signature'),
      );
      // Si secret bindé ET signature présente mais invalide → 400 net.
      // (mode démo sans secret OU `mock:true` → on tolère, signature_verified=0)
      if (!verify.verified && !verify.mock) {
        return json({ error: 'invalid signature', code: 'WEBHOOK_SIGNATURE_INVALID' }, 400);
      }
      saasSignatureVerified = verify.verified;
    } catch {
      // Helper indisponible (devrait jamais arriver) → on continue best-effort.
      saasSignatureVerified = false;
    }

    // Parse event (legacy + SaaS partagent ce JSON).
    const event = JSON.parse(rawBody) as any;

    // SaaS dispatch — events subscription/invoice non-paid (ou paid en // de legacy).
    try {
      const { dispatchStripeSaasEvent } = await import('./saas-billing');
      await dispatchStripeSaasEvent(env, event, saasSignatureVerified);
    } catch {
      /* best-effort SaaS — ne jamais casser le flow legacy ni le 200 webhook */
    }

    // ── Sprint 31 extension chirurgicale (Agent A4) — 3 events Connect / PM ─
    // Additif AVANT le bloc legacy, APRÈS le dispatcher SaaS Sprint 22. Chaque
    // handler est best-effort, jamais throw (catch silencieux). Audit + log
    // billing_events via logBillingEvent (idempotence via UNIQUE provider+id).
    try {
      const eventType: string = typeof event?.type === 'string' ? event.type : '';
      const eventId: string =
        typeof event?.id === 'string' && event.id ? event.id : `mock_evt_${crypto.randomUUID().replace(/-/g, '')}`;

      if (eventType === 'account.updated') {
        // Connect onboarding webhook → UPDATE stripe_connect_accounts.
        const acct = (event.data?.object ?? {}) as Record<string, unknown>;
        const stripeAccountId = typeof acct.id === 'string' ? acct.id : null;
        if (stripeAccountId) {
          const chargesEnabled = acct.charges_enabled === true || acct.charges_enabled === 1 ? 1 : 0;
          const payoutsEnabled = acct.payouts_enabled === true || acct.payouts_enabled === 1 ? 1 : 0;
          const detailsSubmitted = acct.details_submitted === true || acct.details_submitted === 1 ? 1 : 0;
          const capabilitiesJson = (() => {
            try { return JSON.stringify(acct.capabilities ?? {}); } catch { return '{}'; }
          })();
          const requirementsJson = (() => {
            try { return JSON.stringify(acct.requirements ?? {}); } catch { return '{}'; }
          })();
          const completedAt = detailsSubmitted === 1 ? new Date().toISOString() : null;
          try {
            await env.DB.prepare(
              `UPDATE stripe_connect_accounts
                 SET charges_enabled = ?, payouts_enabled = ?, details_submitted = ?,
                     capabilities_json = ?, requirements_json = ?,
                     onboarding_completed_at = COALESCE(?, onboarding_completed_at),
                     updated_at = datetime('now')
               WHERE stripe_account_id = ?`,
            )
              .bind(
                chargesEnabled,
                payoutsEnabled,
                detailsSubmitted,
                capabilitiesJson,
                requirementsJson,
                completedAt,
                stripeAccountId,
              )
              .run();
          } catch {
            /* best-effort — table seq absente */
          }
        }
        // log SaaS event for traceability (best-effort, ignore if logger module unavailable)
        try {
          const { logBillingEvent } = await import('./saas-billing');
          await logBillingEvent(env, {
            providerEventId: eventId,
            eventType: 'account.updated',
            signatureVerified: saasSignatureVerified,
            isMock: !saasSignatureVerified,
            payload: acct,
          });
        } catch { /* silent */ }
      } else if (eventType === 'payment_method.attached') {
        // PM webhook → INSERT payment_methods (agency_id résolu via customer metadata).
        const pm = (event.data?.object ?? {}) as Record<string, unknown>;
        const stripePmId = typeof pm.id === 'string' ? pm.id : null;
        const stripeCustomerId = typeof pm.customer === 'string' ? pm.customer : null;
        const type = typeof pm.type === 'string' ? pm.type : 'card';
        // brand / last4 / exp_month / exp_year extraits depuis pm.card si type=card
        const card = (pm.card ?? {}) as Record<string, unknown>;
        const brand = typeof card.brand === 'string' ? card.brand : null;
        const last4 = typeof card.last4 === 'string' ? card.last4 : null;
        const expMonth =
          typeof card.exp_month === 'number' ? card.exp_month : null;
        const expYear = typeof card.exp_year === 'number' ? card.exp_year : null;
        // Résolution agency_id via metadata.agencyId du customer (Stripe expand: ['customer'])
        // ou fallback metadata directement sur le PaymentMethod (test path).
        let agencyId: string | null = null;
        const pmMeta = (pm.metadata ?? {}) as Record<string, unknown>;
        // Support BOTH `agencyId` (camelCase, frontend SetupIntent metadata)
        // ET `agency_id` (snake_case, calque findOrCreateStripeCustomer A1).
        if (typeof pmMeta.agencyId === 'string' && pmMeta.agencyId) {
          agencyId = pmMeta.agencyId;
        } else if (typeof pmMeta.agency_id === 'string' && pmMeta.agency_id) {
          agencyId = pmMeta.agency_id;
        } else {
          const customer = (pm.customer && typeof pm.customer === 'object'
            ? (pm.customer as Record<string, unknown>)
            : null);
          const custMeta = (customer?.metadata ?? {}) as Record<string, unknown>;
          if (typeof custMeta.agencyId === 'string' && custMeta.agencyId) {
            agencyId = custMeta.agencyId;
          } else if (typeof custMeta.agency_id === 'string' && custMeta.agency_id) {
            agencyId = custMeta.agency_id;
          } else if (stripeCustomerId) {
            // Lookup D1 : subscriptions.stripe_customer_id → agency_id
            try {
              const row = (await env.DB.prepare(
                'SELECT agency_id FROM subscriptions WHERE stripe_customer_id = ? LIMIT 1',
              )
                .bind(stripeCustomerId)
                .first()) as { agency_id: string | null } | null;
              agencyId = row?.agency_id ?? null;
            } catch {
              agencyId = null;
            }
          }
        }
        if (stripePmId && agencyId) {
          try {
            await env.DB.prepare(
              `INSERT INTO payment_methods
                 (agency_id, stripe_payment_method_id, stripe_customer_id, type,
                  brand, last4, exp_month, exp_year, is_default, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
            )
              .bind(
                agencyId,
                stripePmId,
                stripeCustomerId,
                type,
                brand,
                last4,
                expMonth,
                expYear,
              )
              .run();
          } catch {
            /* best-effort — UNIQUE collision (rejeu webhook) ou table absente */
          }
        }
        try {
          const { logBillingEvent } = await import('./saas-billing');
          await logBillingEvent(env, {
            agencyId,
            providerEventId: eventId,
            eventType: 'payment_method.attached',
            signatureVerified: saasSignatureVerified,
            isMock: !saasSignatureVerified,
            // payload trimmed : on log brand/last4 only, jamais le PAN complet
            payload: {
              id: stripePmId,
              customer: stripeCustomerId,
              type,
              card: { brand, last4, exp_month: expMonth, exp_year: expYear },
            },
          });
        } catch { /* silent */ }
      } else if (eventType === 'setup_intent.succeeded') {
        // SetupIntent confirmation → log audit only. Le payment_method.attached
        // qui suit dans la séquence Stripe persistera réellement le PM.
        const si = (event.data?.object ?? {}) as Record<string, unknown>;
        const setupIntentId = typeof si.id === 'string' ? si.id : null;
        const customerId = typeof si.customer === 'string' ? si.customer : null;
        try {
          const { logBillingEvent } = await import('./saas-billing');
          await logBillingEvent(env, {
            providerEventId: eventId,
            eventType: 'billing.setup_intent.succeeded',
            signatureVerified: saasSignatureVerified,
            isMock: !saasSignatureVerified,
            payload: { id: setupIntentId, customer: customerId },
          });
        } catch { /* silent */ }
      }
    } catch {
      /* best-effort — ne jamais casser le flow webhook */
    }

    // ── BLOC LEGACY — BYTE-IDENTIQUE (NE PAS MODIFIER) ─────────────────────
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
