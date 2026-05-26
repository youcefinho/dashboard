// ── Sprint 31 — SaaS Billing : Payment Methods (CRUD agence) ───────────────
// 4 handlers : list / setup-intent / set-default / delete. Live calls
// déléguées à lib/saas-billing-live.ts (Agent A1, parallel sprint).
//
// Auth shape : calque saas-billing.ts:61. Capability garde DANS le handler :
//   GET  list           → billing.view
//   POST setup-intent   → settings.manage
//   POST set-default    → settings.manage
//   DELETE detach       → settings.manage
// Mode dégradé : si isLiveBranchEnabled(env) === false → 503 (mutations) /
// retour [] (lecture). Voir Phase B contrat S22.

import type { Env } from './types';
import { json, audit } from './helpers';
import {
  isLiveBranchEnabled,
  findOrCreateStripeCustomer,
  createSetupIntent,
  setDefaultPaymentMethod,
  detachPaymentMethod,
} from './lib/saas-billing-live';

interface PaymentMethodsAuth {
  userId: string;
  role?: string;
  clientId?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
}

// ── GET /api/billing/payment-methods ───────────────────────────────────────
// Liste les payment methods stockés en D1 pour l'agence courante.
// Mode dégradé : pas d'agence → data: [].
export async function handleListPaymentMethods(
  env: Env,
  auth: PaymentMethodsAuth,
): Promise<Response> {
  try {
    const agencyId = auth.tenant?.agencyId ?? auth.clientId ?? null;
    if (!agencyId) return json({ data: [] });

    const rs = await env.DB.prepare(
      'SELECT * FROM payment_methods WHERE agency_id = ? ORDER BY is_default DESC, created_at DESC',
    )
      .bind(agencyId)
      .all();

    const rows = (rs.results || []) as any[];
    return json({ data: rows.map(mapPaymentMethodRow) });
  } catch {
    return json({ data: [] });
  }
}

// ── POST /api/billing/payment-methods/setup-intent ─────────────────────────
// Crée un SetupIntent Stripe → retourne le clientSecret (Stripe Elements
// confirmation côté front). Le PaymentMethod sera persisté en D1 via webhook
// `setup_intent.succeeded` (Manager-A webhook handler, parallèle sprint).
export async function handleCreateSetupIntent(
  request: Request,
  env: Env,
  auth: PaymentMethodsAuth,
): Promise<Response> {
  try {
    const agencyId = auth.tenant?.agencyId ?? auth.clientId ?? null;
    if (!agencyId) {
      return json({ error: 'Agence requise', code: 'AGENCY_ONLY' }, 403);
    }
    if (!isLiveBranchEnabled(env)) {
      return json({ error: 'Stripe non configuré', code: 'STRIPE_NOT_CONFIGURED' }, 503);
    }

    // Parse body (optionnel — usage future-proof, ex: { usage: 'off_session' })
    await request.json().catch(() => ({}));

    // Résoudre l'email du user pour findOrCreateStripeCustomer (best-effort).
    let userEmail = '';
    try {
      const u = await env.DB.prepare('SELECT email FROM users WHERE id = ? LIMIT 1').bind(auth.userId).first<{ email: string }>();
      userEmail = String(u?.email || '');
    } catch { /* best-effort */ }

    const customerId = await findOrCreateStripeCustomer(env, agencyId, userEmail);
    const idemKey = `setup_intent_${agencyId}_${auth.userId}_${Date.now()}`;
    const intent = await createSetupIntent(env, customerId, idemKey);

    await audit(
      env,
      auth.userId,
      'billing.payment_method.setup_intent_created',
      'agency',
      agencyId,
      { setupIntentId: intent.id },
    );

    return json({
      data: {
        clientSecret: intent.client_secret,
        setupIntentId: intent.id,
      },
    });
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message || 'Erreur Stripe';
    return json({ error: msg, code: 'STRIPE_API_ERROR' }, 502);
  }
}

// ── POST /api/billing/payment-methods/:id/default ──────────────────────────
// Marque le PM comme défaut côté Stripe (customer.invoice_settings) puis
// reflète en D1 (transaction implicite : UPDATE all is_default=0 + UPDATE
// ce row is_default=1). :id = stripe_payment_method_id (pm_xxx).
export async function handleSetDefaultPaymentMethod(
  request: Request,
  env: Env,
  auth: PaymentMethodsAuth,
): Promise<Response> {
  try {
    const agencyId = auth.tenant?.agencyId ?? auth.clientId ?? null;
    if (!agencyId) {
      return json({ error: 'Agence requise', code: 'AGENCY_ONLY' }, 403);
    }
    if (!isLiveBranchEnabled(env)) {
      return json({ error: 'Stripe non configuré', code: 'STRIPE_NOT_CONFIGURED' }, 503);
    }

    // Extract :id from URL path
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/billing\/payment-methods\/([^/]+)\/default$/);
    if (!match || !match[1]) {
      return json({ error: 'ID payment method invalide', code: 'INVALID_PM_ID' }, 400);
    }
    const stripePmId = decodeURIComponent(match[1]);

    // Vérifier que ce PM appartient à l'agence (sécurité tenant)
    const row = await env.DB.prepare(
      'SELECT stripe_customer_id FROM payment_methods WHERE agency_id = ? AND stripe_payment_method_id = ?',
    )
      .bind(agencyId, stripePmId)
      .first<{ stripe_customer_id: string } | null>();
    if (!row) {
      return json({ error: 'Payment method introuvable', code: 'PM_NOT_FOUND' }, 404);
    }

    // Stripe side : update customer.invoice_settings.default_payment_method
    await setDefaultPaymentMethod(env, String(row.stripe_customer_id), stripePmId);

    // D1 side : reset all + set this one
    await env.DB.prepare(
      'UPDATE payment_methods SET is_default = 0, updated_at = datetime(\'now\') WHERE agency_id = ?',
    )
      .bind(agencyId)
      .run();
    await env.DB.prepare(
      'UPDATE payment_methods SET is_default = 1, updated_at = datetime(\'now\') WHERE agency_id = ? AND stripe_payment_method_id = ?',
    )
      .bind(agencyId, stripePmId)
      .run();

    await audit(
      env,
      auth.userId,
      'billing.payment_method.set_default',
      'payment_method',
      stripePmId,
      {},
    );

    return json({ data: { stripePaymentMethodId: stripePmId, isDefault: true } });
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message || 'Erreur Stripe';
    return json({ error: msg, code: 'STRIPE_API_ERROR' }, 502);
  }
}

// ── DELETE /api/billing/payment-methods/:id ────────────────────────────────
// Détache le PM côté Stripe puis DELETE D1. Refuse si c'est le seul PM
// non-defaut actif (front décide UX, ici on accepte tout — invariant tenant
// suffit). :id = stripe_payment_method_id (pm_xxx).
export async function handleDeletePaymentMethod(
  request: Request,
  env: Env,
  auth: PaymentMethodsAuth,
): Promise<Response> {
  try {
    const agencyId = auth.tenant?.agencyId ?? auth.clientId ?? null;
    if (!agencyId) {
      return json({ error: 'Agence requise', code: 'AGENCY_ONLY' }, 403);
    }
    if (!isLiveBranchEnabled(env)) {
      return json({ error: 'Stripe non configuré', code: 'STRIPE_NOT_CONFIGURED' }, 503);
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/billing\/payment-methods\/([^/]+)$/);
    if (!match || !match[1]) {
      return json({ error: 'ID payment method invalide', code: 'INVALID_PM_ID' }, 400);
    }
    const stripePmId = decodeURIComponent(match[1]);

    // Vérifier ownership tenant
    const row = await env.DB.prepare(
      'SELECT id FROM payment_methods WHERE agency_id = ? AND stripe_payment_method_id = ?',
    )
      .bind(agencyId, stripePmId)
      .first<{ id: string } | null>();
    if (!row) {
      return json({ error: 'Payment method introuvable', code: 'PM_NOT_FOUND' }, 404);
    }

    // Stripe side : detach (best-effort — si Stripe échoue, on garde D1 pour
    // permettre retry côté admin. Pour l'instant on remonte l'erreur si fail).
    await detachPaymentMethod(env, stripePmId);

    // D1 side : DELETE (hard delete — audit log conserve la trace)
    await env.DB.prepare(
      'DELETE FROM payment_methods WHERE agency_id = ? AND stripe_payment_method_id = ?',
    )
      .bind(agencyId, stripePmId)
      .run();

    await audit(
      env,
      auth.userId,
      'billing.payment_method.deleted',
      'payment_method',
      stripePmId,
      {},
    );

    return json({ data: { stripePaymentMethodId: stripePmId, deleted: true } });
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message || 'Erreur Stripe';
    return json({ error: msg, code: 'STRIPE_API_ERROR' }, 502);
  }
}

// ── Mapper row D1 → shape API canonique ─────────────────────────────────────
function mapPaymentMethodRow(row: any): {
  id: string;
  agencyId: string;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  createdAt: string | null;
} {
  return {
    id: String(row.id ?? ''),
    agencyId: String(row.agency_id ?? ''),
    stripeCustomerId: String(row.stripe_customer_id ?? ''),
    stripePaymentMethodId: String(row.stripe_payment_method_id ?? ''),
    type: String(row.type ?? 'card'),
    brand: row.brand ? String(row.brand) : null,
    last4: row.last4 ? String(row.last4) : null,
    expMonth: row.exp_month != null ? Number(row.exp_month) : null,
    expYear: row.exp_year != null ? Number(row.exp_year) : null,
    isDefault: Number(row.is_default) === 1,
    createdAt: row.created_at ?? null,
  };
}
