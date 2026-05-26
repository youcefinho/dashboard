// ── Sprint 31 — SaaS Billing : Stripe Connect (onboarding agence) ──────────
// 2 handlers : POST /api/billing/connect/onboard (génère AccountLink hosted
// onboarding) + GET /api/billing/connect/status (statut capabilities/payouts
// avec refresh live + cache D1). Importé seulement par worker.ts. Live calls
// déléguées à lib/saas-billing-live.ts (Agent A1, parallel sprint).
//
// Auth shape : calque saas-billing.ts:61. Capability garde DANS le handler :
//   POST onboard  → settings.manage (mutation)
//   GET  status   → billing.view    (lecture)
// Mode dégradé : si isLiveBranchEnabled(env) === false → 503 STRIPE_NOT_CONFIGURED
// (onboard) / fallback D1 cached (status). Voir Phase B contrat S22.

import type { Env } from './types';
import { json, audit } from './helpers';
import {
  isLiveBranchEnabled,
  createConnectAccount,
  createConnectAccountLink,
  retrieveConnectAccount,
} from './lib/saas-billing-live';

// Auth shape calque saas-billing.ts:61 (BillingAuth). On utilise auth.clientId
// au top-level (tenant courant) et auth.tenant?.agencyId pour la garde mode-agence.
interface ConnectAuth {
  userId: string;
  role?: string;
  clientId?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
}

// ── POST /api/billing/connect/onboard ──────────────────────────────────────
// Génère un AccountLink Stripe hosted-onboarding (lien éphémère ~5 min).
// Crée le compte Connect Express en lazy si absent en D1.
// Body : { refreshUrl?: string, returnUrl?: string } (defaults app.intralys.io).
export async function handleConnectOnboard(
  request: Request,
  env: Env,
  auth: ConnectAuth,
): Promise<Response> {
  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) {
      return json({ error: 'Agence requise', code: 'AGENCY_ONLY' }, 403);
    }
    if (!isLiveBranchEnabled(env)) {
      return json({ error: 'Stripe non configuré', code: 'STRIPE_NOT_CONFIGURED' }, 503);
    }

    // SELECT existant — sinon createConnectAccount + INSERT D1
    const row = await env.DB.prepare(
      'SELECT stripe_account_id FROM stripe_connect_accounts WHERE client_id = ?',
    )
      .bind(clientId)
      .first<{ stripe_account_id: string } | null>();

    let accountId: string;
    if (!row) {
      // Lookup email user (best-effort, fallback empty si schema absent)
      let userEmail = '';
      try {
        const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
          .bind(auth.userId)
          .first<{ email: string } | null>();
        userEmail = String(u?.email ?? '');
      } catch {
        /* fallback empty — Stripe accepte la création sans email */
      }
      const acct = await createConnectAccount(env, clientId, userEmail, 'CA');
      accountId = acct.id;
      await env.DB.prepare(
        'INSERT INTO stripe_connect_accounts (client_id, stripe_account_id, account_type, created_at, updated_at) VALUES (?, ?, ?, datetime(\'now\'), datetime(\'now\'))',
      )
        .bind(clientId, accountId, 'express')
        .run();
    } else {
      accountId = String(row.stripe_account_id);
    }

    // Parse body (URLs custom optionnelles)
    const body = (await request.json().catch(() => ({}))) as {
      refreshUrl?: string;
      returnUrl?: string;
    };
    const refreshUrl =
      typeof body.refreshUrl === 'string' && body.refreshUrl
        ? body.refreshUrl
        : 'https://app.intralys.io/settings/billing?refresh=1';
    const returnUrl =
      typeof body.returnUrl === 'string' && body.returnUrl
        ? body.returnUrl
        : 'https://app.intralys.io/settings/billing?return=1';

    const link = await createConnectAccountLink(env, accountId, refreshUrl, returnUrl);

    await audit(
      env,
      auth.userId,
      'billing.connect.onboarding_link_created',
      'stripe_connect_account',
      accountId,
      {},
    );

    return json({
      data: {
        url: link.url,
        expiresAt: new Date(link.expires_at * 1000).toISOString(),
      },
    });
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message || 'Erreur Stripe';
    return json({ error: msg, code: 'STRIPE_API_ERROR' }, 502);
  }
}

// ── GET /api/billing/connect/status ────────────────────────────────────────
// Retourne le statut Connect (capabilities + payouts + requirements). Si
// live activé : refresh depuis Stripe + UPDATE D1 (cache). Sinon : D1 only.
// Mode dégradé (pas d'agence courante OU pas de row) : data = null.
export async function handleConnectStatus(env: Env, auth: ConnectAuth): Promise<Response> {
  try {
    const clientId = auth.clientId ?? null;
    if (!clientId) return json({ data: null });

    const row = await env.DB.prepare(
      'SELECT * FROM stripe_connect_accounts WHERE client_id = ?',
    )
      .bind(clientId)
      .first();

    if (!row) return json({ data: null });

    // Refresh live + UPDATE D1 (best-effort, fallback D1 cached si échec)
    if (isLiveBranchEnabled(env)) {
      try {
        const fresh = await retrieveConnectAccount(env, String((row as any).stripe_account_id));
        const completedAt = fresh.details_submitted
          ? ((row as any).onboarding_completed_at ?? new Date().toISOString())
          : null;
        await env.DB.prepare(
          'UPDATE stripe_connect_accounts SET charges_enabled = ?, payouts_enabled = ?, details_submitted = ?, capabilities_json = ?, requirements_json = ?, onboarding_completed_at = ?, updated_at = datetime(\'now\') WHERE client_id = ?',
        )
          .bind(
            fresh.charges_enabled ? 1 : 0,
            fresh.payouts_enabled ? 1 : 0,
            fresh.details_submitted ? 1 : 0,
            JSON.stringify(fresh.capabilities || {}),
            JSON.stringify(fresh.requirements || {}),
            completedAt,
            clientId,
          )
          .run();
        const refreshed = await env.DB.prepare(
          'SELECT * FROM stripe_connect_accounts WHERE client_id = ?',
        )
          .bind(clientId)
          .first();
        return json({ data: mapConnectRow(refreshed) });
      } catch {
        /* fallback to D1 cached row */
      }
    }

    return json({ data: mapConnectRow(row) });
  } catch {
    // Best-effort : ne jamais 500 sur lecture statut, retourner null
    return json({ data: null });
  }
}

// ── Mapper row D1 → shape API canonique ─────────────────────────────────────
function mapConnectRow(row: any): {
  id: string;
  clientId: string;
  stripeAccountId: string;
  accountType: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities: Record<string, unknown>;
  requirements: { currently_due: string[]; eventually_due: string[]; past_due: string[] };
  onboardingCompletedAt: string | null;
} {
  return {
    id: String(row.id ?? ''),
    clientId: String(row.client_id ?? ''),
    stripeAccountId: String(row.stripe_account_id ?? ''),
    accountType: String(row.account_type ?? 'express'),
    chargesEnabled: Number(row.charges_enabled) === 1,
    payoutsEnabled: Number(row.payouts_enabled) === 1,
    detailsSubmitted: Number(row.details_submitted) === 1,
    capabilities: row.capabilities_json ? safeParse(row.capabilities_json, {}) : {},
    requirements: row.requirements_json
      ? safeParse(row.requirements_json, {
          currently_due: [],
          eventually_due: [],
          past_due: [],
        })
      : { currently_due: [], eventually_due: [], past_due: [] },
    onboardingCompletedAt: row.onboarding_completed_at ?? null,
  };
}

function safeParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
