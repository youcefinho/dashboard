// ── POS sessions (shifts caissier) — Sprint 37 IMPL (2026-05-24) ───────────
//
// Handlers AUTHED ouverture/fermeture/get/report `pos_sessions`.
// Bornage tenant strict (`WHERE client_id = ?`) defense-in-depth IDOR.
// Capabilities seq80 FIGÉES :
//   - `clients.manage` pour open/close/get (opération caisse).
//   - `reports.view`   pour /report (X/Z report quotidien/shift).
// Réponses normalisées : json({ data }) succès / json({ error }, status) erreur.
// PAS de champ `code`.
//
// ⚠️ FIGÉ contrat (docs/LOT-POS-S37.md §6) — signatures invariantes.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { getClientModules } from './modules';
import { computeSessionVariance } from './lib/pos-engine';

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

// ── POST /api/pos/sessions/open — ouvrir un shift ───────────────────────────
export async function handleOpenSession(
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

    const registerId =
      typeof body.register_id === 'string' && body.register_id.trim().length > 0
        ? body.register_id.trim()
        : null;
    if (!registerId) {
      return json({ error: 'register_id requis' }, 400);
    }

    const openingCash = toInt(body.opening_cash_cents);
    if (openingCash === null || openingCash < 0) {
      return json(
        { error: 'opening_cash_cents requis (entier >= 0)' },
        400,
      );
    }

    const notes =
      typeof body.notes === 'string' ? body.notes.slice(0, 2000) : '';

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Vérifier que le register appartient au tenant et est actif.
    const reg = (await env.DB.prepare(
      `SELECT 1 AS ok FROM pos_registers
       WHERE id = ? AND client_id = ? AND is_active = 1`,
    )
      .bind(registerId, clientId)
      .first()) as { ok: number } | null;
    if (!reg) {
      return json({ error: 'Caisse introuvable ou inactive' }, 404);
    }

    // Vérifier qu'aucune session n'est déjà ouverte sur ce register.
    const openSess = (await env.DB.prepare(
      `SELECT id FROM pos_sessions
       WHERE register_id = ? AND status = 'open' LIMIT 1`,
    )
      .bind(registerId)
      .first()) as { id: string } | null;
    if (openSess) {
      return json({ error: 'session_already_open' }, 409);
    }

    const sessionId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO pos_sessions (
         id, register_id, client_id, opened_by, opened_at,
         opening_cash_cents, status, total_sales_cents, total_tax_cents,
         transaction_count, notes, created_at
       ) VALUES (?, ?, ?, ?, datetime('now'), ?, 'open', 0, 0, 0, ?, datetime('now'))`,
    )
      .bind(sessionId, registerId, clientId, auth.userId, openingCash, notes)
      .run();

    await audit(env, auth.userId, 'pos_session_opened', 'pos_session', sessionId, {
      register_id: registerId,
      opening_cash_cents: openingCash,
    });

    // Re-lecture opened_at pour cohérence (datetime('now') côté DB).
    const row = (await env.DB.prepare(
      'SELECT opened_at FROM pos_sessions WHERE id = ?',
    )
      .bind(sessionId)
      .first()) as { opened_at: string | null } | null;

    return json({
      data: {
        session_id: sessionId,
        register_id: registerId,
        opened_at: row?.opened_at ?? null,
        status: 'open',
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/pos/sessions/:id/close — fermer un shift ──────────────────────
export async function handleCloseSession(
  request: Request,
  env: Env,
  auth: Auth,
  sessionId: string,
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

    const closingCash = toInt(body.closing_cash_cents);
    if (closingCash === null || closingCash < 0) {
      return json({ error: 'closing_cash_cents requis (entier >= 0)' }, 400);
    }
    const notes =
      typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Bornage tenant + status='open' obligatoire.
    const session = (await env.DB.prepare(
      `SELECT id, status, opening_cash_cents, total_sales_cents, total_tax_cents,
              transaction_count
       FROM pos_sessions
       WHERE id = ? AND client_id = ? AND status = 'open'`,
    )
      .bind(sessionId, clientId)
      .first()) as
      | {
          id: string;
          status: string;
          opening_cash_cents: number | null;
          total_sales_cents: number | null;
          total_tax_cents: number | null;
          transaction_count: number | null;
        }
      | null;
    if (!session) {
      return json({ error: 'Session introuvable ou déjà fermée' }, 404);
    }

    // Calcul cash attendu = opening + SUM des transactions cash non-voided.
    const cashSumRow = (await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM pos_transactions
       WHERE session_id = ? AND payment_method = 'cash' AND voided_at IS NULL`,
    )
      .bind(sessionId)
      .first()) as { total: number | null } | null;

    const openingCents = session.opening_cash_cents ?? 0;
    const cashTransactions = cashSumRow?.total ?? 0;
    const expectedCash = openingCents + cashTransactions;

    // Variance via helper pos-engine (A1).
    const variance = computeSessionVariance(expectedCash, closingCash);

    // UPDATE (notes uniquement si fournie pour ne pas écraser à null).
    const sets = [
      "status = 'closed'",
      "closed_at = datetime('now')",
      'closed_by = ?',
      'closing_cash_cents = ?',
      'expected_cash_cents = ?',
      'variance_cents = ?',
    ];
    const bindings: unknown[] = [
      auth.userId,
      closingCash,
      expectedCash,
      variance.varianceCents,
    ];
    if (notes !== null) {
      sets.push('notes = ?');
      bindings.push(notes);
    }
    bindings.push(sessionId, clientId);

    await env.DB.prepare(
      `UPDATE pos_sessions SET ${sets.join(', ')}
       WHERE id = ? AND client_id = ?`,
    )
      .bind(...bindings)
      .run();

    await audit(env, auth.userId, 'pos_session_closed', 'pos_session', sessionId, {
      variance_cents: variance.varianceCents,
      warning_level: variance.warningLevel,
      expected_cash_cents: expectedCash,
      closing_cash_cents: closingCash,
    });

    return json({
      data: {
        session_id: sessionId,
        expected_cash_cents: expectedCash,
        variance_cents: variance.varianceCents,
        warning_level: variance.warningLevel,
        totals: {
          total_sales_cents: session.total_sales_cents ?? 0,
          total_tax_cents: session.total_tax_cents ?? 0,
          transaction_count: session.transaction_count ?? 0,
        },
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/pos/sessions/:id — détail session + transactions ───────────────
export async function handleGetSession(
  env: Env,
  auth: Auth,
  sessionId: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const session = (await env.DB.prepare(
      `SELECT id, register_id, client_id, opened_by, opened_at, closed_at, closed_by,
              opening_cash_cents, closing_cash_cents, expected_cash_cents,
              variance_cents, status, total_sales_cents, total_tax_cents,
              transaction_count, notes, created_at
       FROM pos_sessions
       WHERE id = ? AND client_id = ?`,
    )
      .bind(sessionId, clientId)
      .first()) as Record<string, unknown> | null;

    if (!session) {
      return json({ error: 'Session introuvable' }, 404);
    }

    // Transactions : 100 dernières (DESC by created_at).
    const { results: txResults } = await env.DB.prepare(
      `SELECT id, payment_method, amount_cents, change_due_cents, voided_at, created_at
       FROM pos_transactions
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
    )
      .bind(sessionId)
      .all();
    const transactions = (txResults || []) as Array<Record<string, unknown>>;

    // Live totals : recalc des agrégats actifs (non-voided).
    const liveAggRow = (await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total_amount,
              COUNT(id) AS tx_count
       FROM pos_transactions
       WHERE session_id = ? AND voided_at IS NULL`,
    )
      .bind(sessionId)
      .first()) as { total_amount: number | null; tx_count: number | null } | null;

    const cashLiveRow = (await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM pos_transactions
       WHERE session_id = ? AND payment_method = 'cash' AND voided_at IS NULL`,
    )
      .bind(sessionId)
      .first()) as { total: number | null } | null;

    const openingCents =
      typeof session.opening_cash_cents === 'number'
        ? (session.opening_cash_cents as number)
        : 0;

    const live_totals = {
      total_amount_cents: liveAggRow?.total_amount ?? 0,
      transaction_count: liveAggRow?.tx_count ?? 0,
      cash_collected_cents: cashLiveRow?.total ?? 0,
      expected_cash_cents: openingCents + (cashLiveRow?.total ?? 0),
    };

    return json({ data: { session, transactions, live_totals } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/pos/sessions/:id/report — X/Z report (rapport shift) ──────────
export async function handleSessionReport(
  env: Env,
  auth: Auth,
  sessionId: string,
  url: URL,
): Promise<Response> {
  void url; // export CSV/PDF = Phase ultérieure ; le param est réservé.
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'reports.view');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Bornage tenant + load session pour les totals agrégés.
    const session = (await env.DB.prepare(
      `SELECT id, register_id, opened_at, closed_at, status,
              opening_cash_cents, closing_cash_cents, expected_cash_cents,
              variance_cents, total_sales_cents, total_tax_cents,
              transaction_count
       FROM pos_sessions
       WHERE id = ? AND client_id = ?`,
    )
      .bind(sessionId, clientId)
      .first()) as Record<string, unknown> | null;
    if (!session) {
      return json({ error: 'Session introuvable' }, 404);
    }

    // ── by_payment_method ─────────────────────────────────────────────────
    const { results: byPmResults } = await env.DB.prepare(
      `SELECT payment_method,
              COALESCE(SUM(amount_cents), 0) AS total_cents,
              COUNT(id) AS tx_count
       FROM pos_transactions
       WHERE session_id = ? AND voided_at IS NULL
       GROUP BY payment_method
       ORDER BY total_cents DESC`,
    )
      .bind(sessionId)
      .all();
    const by_payment_method = (byPmResults || []) as Array<
      Record<string, unknown>
    >;

    // ── top_products via JOIN orders → order_items (best-effort) ──────────
    // Filet : si tables/colonnes absentes (DB hors-séquence), renvoyer []
    // plutôt que casser le report.
    let top_products: Array<Record<string, unknown>> = [];
    try {
      const { results: topResults } = await env.DB.prepare(
        `SELECT oi.variant_id AS variant_id,
                oi.name        AS name,
                COALESCE(SUM(oi.quantity), 0) AS quantity,
                COALESCE(SUM(oi.subtotal_cents), 0) AS subtotal_cents
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE o.pos_session_id = ?
         GROUP BY oi.variant_id, oi.name
         ORDER BY quantity DESC
         LIMIT 20`,
      )
        .bind(sessionId)
        .all();
      top_products = (topResults || []) as Array<Record<string, unknown>>;
    } catch {
      top_products = [];
    }

    // ── hourly_breakdown : group by heure de created_at ───────────────────
    const { results: hourlyResults } = await env.DB.prepare(
      `SELECT strftime('%Y-%m-%d %H:00', created_at) AS hour,
              COUNT(id) AS tx_count,
              COALESCE(SUM(amount_cents), 0) AS total_cents
       FROM pos_transactions
       WHERE session_id = ? AND voided_at IS NULL
       GROUP BY hour
       ORDER BY hour ASC`,
    )
      .bind(sessionId)
      .all();
    const hourly_breakdown = (hourlyResults || []) as Array<
      Record<string, unknown>
    >;

    const totals = {
      total_sales_cents: session.total_sales_cents ?? 0,
      total_tax_cents: session.total_tax_cents ?? 0,
      transaction_count: session.transaction_count ?? 0,
      opening_cash_cents: session.opening_cash_cents ?? 0,
      closing_cash_cents: session.closing_cash_cents ?? null,
      expected_cash_cents: session.expected_cash_cents ?? null,
      variance_cents: session.variance_cents ?? null,
    };

    return json({
      data: {
        session_id: sessionId,
        register_id: session.register_id,
        opened_at: session.opened_at,
        closed_at: session.closed_at,
        status: session.status,
        by_payment_method,
        top_products,
        hourly_breakdown,
        totals,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
