// ── Gift cards — Sprint 38 Phase B (2026-05-24, Agent A3) ──────────────────
//
// Handlers REST cartes-cadeaux. 9 endpoints :
//   - 6 protégés tenant (list / get / issue / void / transactions / cron)
//   - 2 protégés tenant invoice (redeem / refund)
//   - 1 PUBLIC rate-limited (balance par code)
//
// Capabilities FIGÉES seq80 (docs/LOT-GIFTCARDS-LOYALTY-S38.md §6) :
//   - clients.manage : opérations admin (list/get/issue/void/transactions/cron)
//   - invoices.write : opérations financières (redeem/refund)
//
// Réponses normalisées :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)        ← JAMAIS de champ `code`
//
// Bornage tenant strict : `WHERE client_id = ?` partout. SAUF
// /api/public/gift-cards/:code/balance qui résout via code (codes UNIQUE
// par (client_id, code) mais pour le visiteur anonyme on cherche cross-tenant
// — payload minimal anti-PII : balance/currency/expires_at/status uniquement).
//
// resolveClientId() = calque snapshots.ts:33 / chat-widgets.ts:26.
// lookupAgencyId() = calque snapshots.ts:42 / chat-widgets.ts:35.
// Idempotence : pickIdempotencyKey() lib A1 + body.idempotency_key client override.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { json, audit } from './helpers';
import { resolveCapabilities, requireCapability } from './capabilities';
import { getClientModules } from './modules';
import { checkRateLimit } from './lib/rate-limit';
import {
  normalizeCode,
  validateCodeFormat,
  isExpired,
  pickIdempotencyKey,
  issueGiftCard,
  applyTransaction,
} from './lib/gift-card-engine';
import type { GiftCardRow } from './lib/gift-card-engine';

type Auth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

/** Résout capabilities (préférer celles injectées au choke-point). */
async function getCaps(env: Env, auth: Auth): Promise<Set<string>> {
  return auth.capabilities instanceof Set
    ? auth.capabilities
    : await resolveCapabilities(env, auth);
}

/** Résout le client_id du tenant courant (calque snapshots.ts:33). */
async function resolveClientId(env: Env, auth: Auth): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Lookup agency_id depuis clients (best-effort, calque snapshots.ts:42). */
async function lookupAgencyId(env: Env, clientId: string): Promise<string | null> {
  try {
    const row = (await env.DB.prepare('SELECT agency_id FROM clients WHERE id = ?')
      .bind(clientId)
      .first()) as { agency_id: string | null } | null;
    return row?.agency_id ?? null;
  } catch {
    return null;
  }
}

/** Charge une carte par id+tenant (bornage strict). Retourne null si introuvable. */
async function loadCardForTenant(
  env: Env,
  clientId: string,
  id: string,
): Promise<GiftCardRow | null> {
  try {
    const row = (await env.DB.prepare(
      'SELECT * FROM gift_cards WHERE id = ? AND client_id = ? LIMIT 1',
    )
      .bind(id, clientId)
      .first()) as GiftCardRow | null;
    return row ?? null;
  } catch {
    return null;
  }
}

// Enums validés side-handler (migration seq133 §60 — pas de CHECK SQL).
const VALID_STATUSES = new Set(['active', 'redeemed', 'expired', 'voided']);
// Heuristique min/max raisonnable solde initial (cents). Anti-fat-finger
// et anti-overflow INTEGER (D1 = SQLite 64-bit signed → on reste très en deçà).
const MIN_INITIAL_VALUE_CENTS = 1;          // 0,01 $
const MAX_INITIAL_VALUE_CENTS = 100_000_000; // 1 000 000 $ (raisonnable cartes-cadeaux)

// ── GET /api/gift-cards — liste des cartes-cadeaux du tenant ────────────────
export async function handleListGiftCards(
  env: Env,
  auth: Auth,
  url: URL,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // ── filtres optionnels (query string) ───────────────────────────────────
    const where: string[] = ['client_id = ?'];
    const bindings: unknown[] = [clientId];

    const statusRaw = url.searchParams.get('status');
    if (statusRaw && VALID_STATUSES.has(statusRaw)) {
      where.push('status = ?');
      bindings.push(statusRaw);
    }

    const customerId = url.searchParams.get('customer_id');
    if (customerId && customerId.length > 0 && customerId.length <= 200) {
      where.push('issued_to_customer_id = ?');
      bindings.push(customerId);
    }

    // limit clampé [1..500], défaut 100
    let limit = 100;
    const limitRaw = url.searchParams.get('limit');
    if (limitRaw) {
      const parsed = parseInt(limitRaw, 10);
      if (Number.isFinite(parsed)) {
        limit = Math.min(500, Math.max(1, parsed));
      }
    }

    const sql =
      `SELECT * FROM gift_cards WHERE ${where.join(' AND ')} ` +
      `ORDER BY created_at DESC LIMIT ${limit}`;
    const { results } = await env.DB.prepare(sql).bind(...bindings).all();

    return json({ data: results ?? [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/gift-cards/:id — détail d'une carte ────────────────────────────
export async function handleGetGiftCard(
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const row = await loadCardForTenant(env, clientId, id);
    if (!row) return json({ error: 'Carte-cadeau introuvable' }, 404);

    return json({ data: row });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/gift-cards — émettre une carte-cadeau ─────────────────────────
export async function handleIssueGiftCard(
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

    // ── validation initial_value_cents ──────────────────────────────────────
    const initialValueRaw = body.initial_value_cents;
    const initialValueCents =
      typeof initialValueRaw === 'number' ? Math.round(initialValueRaw) : NaN;
    if (
      !Number.isFinite(initialValueCents) ||
      initialValueCents < MIN_INITIAL_VALUE_CENTS ||
      initialValueCents > MAX_INITIAL_VALUE_CENTS
    ) {
      return json({ error: 'initial_value_cents invalide (entier > 0 requis)' }, 400);
    }

    // ── champs optionnels ───────────────────────────────────────────────────
    const currency =
      typeof body.currency === 'string' && body.currency.length > 0
        ? body.currency.trim().toUpperCase().slice(0, 8)
        : 'CAD';
    const expiresAt =
      typeof body.expires_at === 'string' && body.expires_at.length > 0
        ? body.expires_at.slice(0, 64)
        : null;
    const issuedToCustomerId =
      typeof body.issued_to_customer_id === 'string' && body.issued_to_customer_id.length > 0
        ? body.issued_to_customer_id.slice(0, 200)
        : null;
    const issuedToEmail =
      typeof body.issued_to_email === 'string' && body.issued_to_email.length > 0
        ? body.issued_to_email.trim().slice(0, 320)
        : null;
    const notes =
      typeof body.notes === 'string' ? body.notes.slice(0, 2000) : undefined;

    // ── bornage tenant + lookup agency ──────────────────────────────────────
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }
    const agencyId = await lookupAgencyId(env, clientId);

    const result = await issueGiftCard(env.DB, clientId, agencyId, initialValueCents, currency, {
      expiresAt,
      issuedToCustomerId,
      issuedToEmail,
      issuedByUserId: auth.userId,
      notes,
    });

    if (!result.ok || !result.cardId) {
      return json({ error: result.error || 'Émission impossible' }, 500);
    }

    await audit(env, auth.userId, 'gift_card_issued', 'gift_card', result.cardId, {
      initial_value_cents: initialValueCents,
      currency,
      has_expiry: expiresAt !== null,
      has_recipient: issuedToCustomerId !== null || issuedToEmail !== null,
    });

    return json({
      data: {
        id: result.cardId,
        code: result.code,
        client_id: clientId,
        agency_id: agencyId,
        initial_value_cents: initialValueCents,
        current_balance_cents: initialValueCents,
        currency,
        expires_at: expiresAt,
        issued_to_customer_id: issuedToCustomerId,
        issued_to_email: issuedToEmail,
        status: 'active',
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/public/gift-cards/:code/balance — solde public ─────────────────
// PUBLIC (rate-limited par IP). PAS de capability (visiteur anonyme).
// Payload minimal anti-PII : balance/currency/expires_at/status UNIQUEMENT —
// JAMAIS id/issued_to_email/notes/client_id/agency_id.
export async function handleGetBalanceByCode(
  env: Env,
  request: Request,
  code: string,
): Promise<Response> {
  try {
    // ── rate-limit IP : 10 req / 60 s ───────────────────────────────────────
    const ip =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For') ||
      'unknown';
    const rl = await checkRateLimit(env, `gc_balance:${ip}`, 10, 60);
    if (!rl.allowed) {
      return json({ error: 'Trop de requêtes — réessayez plus tard' }, 429);
    }

    // ── validation format ───────────────────────────────────────────────────
    const normalizedCode = normalizeCode(code);
    if (!validateCodeFormat(normalizedCode)) {
      return json({ error: 'Code invalide' }, 400);
    }

    // ── lookup cross-tenant (code unique applicatif par tenant, mais le
    //    visiteur n'a pas de tenant context ; on prend la 1ère ligne).
    const row = (await env.DB.prepare(
      'SELECT current_balance_cents, currency, expires_at, status FROM gift_cards WHERE code = ? LIMIT 1',
    )
      .bind(normalizedCode)
      .first()) as {
        current_balance_cents: number | null;
        currency: string | null;
        expires_at: string | null;
        status: string | null;
      } | null;

    if (!row) return json({ error: 'Carte-cadeau introuvable' }, 404);

    return json({
      data: {
        balance_cents: Number(row.current_balance_cents ?? 0),
        currency: row.currency ?? 'CAD',
        expires_at: row.expires_at,
        status: row.status ?? 'active',
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/gift-cards/:id/redeem — débiter (ordre lié) ───────────────────
export async function handleRedeemGiftCard(
  request: Request,
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'invoices.write');
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const amountRaw = body.amount_cents;
    const amountCents = typeof amountRaw === 'number' ? Math.round(amountRaw) : NaN;
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return json({ error: 'amount_cents invalide (entier > 0 requis)' }, 400);
    }

    const orderId =
      typeof body.order_id === 'string' && body.order_id.length > 0
        ? body.order_id.slice(0, 200)
        : null;

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const card = await loadCardForTenant(env, clientId, id);
    if (!card) return json({ error: 'Carte-cadeau introuvable' }, 404);

    if (card.status !== 'active') {
      return json({ error: 'Carte-cadeau inactive' }, 400);
    }
    if (isExpired(card)) {
      return json({ error: 'Carte-cadeau expirée' }, 400);
    }

    const idempKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
        ? body.idempotency_key.slice(0, 200)
        : pickIdempotencyKey(id, orderId, 'debit');

    const result = await applyTransaction(
      env.DB,
      id,
      'debit',
      amountCents,
      orderId,
      auth.userId,
      idempKey,
    );

    if (!result.ok) {
      return json({ error: result.error || 'Débit impossible' }, 400);
    }

    await audit(env, auth.userId, 'gift_card_redeemed', 'gift_card', id, {
      amount_cents: amountCents,
      order_id: orderId,
      new_balance_cents: result.newBalance,
    });

    return json({
      data: {
        gift_card_id: id,
        new_balance_cents: result.newBalance,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/gift-cards/:id/void — annuler une carte ───────────────────────
export async function handleVoidGiftCard(
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const card = await loadCardForTenant(env, clientId, id);
    if (!card) return json({ error: 'Carte-cadeau introuvable' }, 404);

    if (card.status === 'voided') {
      return json({ data: { id, status: 'voided' } });
    }

    const remainingBalance = Number(card.current_balance_cents ?? 0);

    // 1) Annule la carte (balance → 0).
    await env.DB.prepare(
      `UPDATE gift_cards
         SET status = 'voided',
             current_balance_cents = 0,
             updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .run();

    // 2) Trace une transaction `void` (amount négatif du restant débité).
    const txId = crypto.randomUUID();
    const idempKey = pickIdempotencyKey(id, null, 'void');
    await env.DB.prepare(
      `INSERT INTO gift_card_transactions
         (id, gift_card_id, client_id, order_id, amount_cents, type,
          balance_after_cents, idempotency_key, created_by_user_id, created_at)
       VALUES (?, ?, ?, NULL, ?, 'void', 0, ?, ?, datetime('now'))`,
    )
      .bind(txId, id, clientId, -remainingBalance, idempKey, auth.userId)
      .run();

    await audit(env, auth.userId, 'gift_card_voided', 'gift_card', id, {
      voided_balance_cents: remainingBalance,
    });

    return json({ data: { id, status: 'voided' } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/gift-cards/:id/refund — recréditer (depuis un retour) ────────
export async function handleRefundToGiftCard(
  request: Request,
  env: Env,
  auth: Auth,
  id: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'invoices.write');
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const amountRaw = body.amount_cents;
    const amountCents = typeof amountRaw === 'number' ? Math.round(amountRaw) : NaN;
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return json({ error: 'amount_cents invalide (entier > 0 requis)' }, 400);
    }

    const orderId =
      typeof body.order_id === 'string' && body.order_id.length > 0
        ? body.order_id.slice(0, 200)
        : null;
    if (!orderId) {
      return json({ error: 'order_id requis pour un remboursement' }, 400);
    }

    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const card = await loadCardForTenant(env, clientId, id);
    if (!card) return json({ error: 'Carte-cadeau introuvable' }, 404);

    if (card.status === 'voided') {
      return json({ error: 'Carte-cadeau annulée — recrédit impossible' }, 400);
    }

    const idempKey =
      typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
        ? body.idempotency_key.slice(0, 200)
        : pickIdempotencyKey(id, orderId, 'refund');

    const result = await applyTransaction(
      env.DB,
      id,
      'refund',
      amountCents,
      orderId,
      auth.userId,
      idempKey,
    );

    if (!result.ok) {
      return json({ error: result.error || 'Recrédit impossible' }, 400);
    }

    await audit(env, auth.userId, 'gift_card_refunded', 'gift_card', id, {
      amount_cents: amountCents,
      order_id: orderId,
      new_balance_cents: result.newBalance,
    });

    return json({
      data: {
        gift_card_id: id,
        new_balance_cents: result.newBalance,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/gift-cards/:id/transactions — ledger des mouvements ────────────
export async function handleListTransactions(
  env: Env,
  auth: Auth,
  cardId: string,
): Promise<Response> {
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // ── bornage tenant : la carte DOIT appartenir au tenant courant ─────────
    const card = (await env.DB.prepare(
      'SELECT 1 AS ok FROM gift_cards WHERE id = ? AND client_id = ? LIMIT 1',
    )
      .bind(cardId, clientId)
      .first()) as { ok: number } | null;
    if (!card) return json({ error: 'Carte-cadeau introuvable' }, 404);

    const { results } = await env.DB.prepare(
      `SELECT * FROM gift_card_transactions
       WHERE gift_card_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
    )
      .bind(cardId)
      .all();

    return json({ data: results ?? [] });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/gift-cards/cron/expire — CRON expire cartes échues ───────────
// Garde `clients.manage` (admin opérationnel) — équivaut à un admin trigger
// manuel ou un scheduled worker authentifié.
export async function handleRunGiftCardExpiryCron(
  request: Request,
  env: Env,
  auth: Auth,
): Promise<Response> {
  void request;
  const caps = await getCaps(env, auth);
  const denied = requireCapability(caps, 'clients.manage');
  if (denied) return denied;

  try {
    // ── sélectionne toutes les cartes actives avec échéance dépassée ────────
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, current_balance_cents
       FROM gift_cards
       WHERE status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at < datetime('now')`,
    ).all();

    const rows = (results ?? []) as Array<{
      id: string;
      client_id: string;
      current_balance_cents: number | null;
    }>;

    let expiredCount = 0;
    for (const r of rows) {
      try {
        const remaining = Number(r.current_balance_cents ?? 0);

        // UPDATE statut → expired, balance → 0
        await env.DB.prepare(
          `UPDATE gift_cards
             SET status = 'expired',
                 current_balance_cents = 0,
                 updated_at = datetime('now')
           WHERE id = ? AND client_id = ?`,
        )
          .bind(r.id, r.client_id)
          .run();

        // INSERT ledger entry type='expire' (amount négatif du restant)
        const txId = crypto.randomUUID();
        const idempKey = pickIdempotencyKey(r.id, null, 'expire');
        await env.DB.prepare(
          `INSERT INTO gift_card_transactions
             (id, gift_card_id, client_id, order_id, amount_cents, type,
              balance_after_cents, idempotency_key, created_by_user_id, created_at)
           VALUES (?, ?, ?, NULL, ?, 'expire', 0, ?, ?, datetime('now'))`,
        )
          .bind(txId, r.id, r.client_id, -remaining, idempKey, auth.userId)
          .run();

        expiredCount++;
      } catch {
        // Best-effort : on continue même si une carte échoue (logguée par audit suivant).
      }
    }

    await audit(env, auth.userId, 'gift_card_expired_cron', 'gift_card', 'cron', {
      expired_count: expiredCount,
      scanned: rows.length,
    });

    return json({ data: { expired_count: expiredCount } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
