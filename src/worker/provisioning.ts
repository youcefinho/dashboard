// ── Module Provisioning — Intralys SaaS (LOT 1) ─────────────────────────────
// CONTRAT §6.4 (figé dans docs/LOT1-SAAS.md). Importé par auth.ts#handleRegister
// (M1) et beta.ts#handleMagicVerify (M2). NE renégocie PAS la signature.
//
// `provisionAgencyTenant(env,{email,name,passwordHash})` crée, de façon
// atomique-intra-batch, le tenant complet d'une nouvelle agence :
//   1. agencies            (id, name, owner_id)
//   2. clients             (id, name, email, agency_id)
//   3. users               (id, email, password_hash, name, role='admin',
//                            client_id, account_level='agency', agency_id)
//   4. user_sub_accounts   (id, user_id, client_id)            ← jonction
//   5. subscriptions       (id, client_id, agency_id, plan_name='free',
//                            status='active')
//
// ⚠️ Schéma RÉEL = migration_p3_9.sql (source de vérité, PAS schema.sql) :
//   - agencies   = (id,name,owner_id,branding_colors,logo_url,custom_domain,
//                   created_at) → on n'INSÈRE QUE (id,name,owner_id).
//   - subscriptions.plan_name SANS CHECK (p3_9) → 'free' OK.
//   - users.role a un CHECK ('admin','broker','store_manager') (seq 59) →
//     'admin' conforme.
//
// Atomicité : D1 `env.DB.batch([...])` est atomique intra-batch (même pattern
// que beta.ts:51). En cas d'échec, compensation best-effort : DELETE des 5
// rows par id (ordre inverse de l'insertion), puis `throw` — handleRegister
// (M1, auth.ts:186-188) mappe l'exception en {error,code:'PROVISION_FAILED'} 500.

import type { Env } from './types';
import { buildMockStripeCustomer } from './lib/saas-billing-mock';

/** Erreur distincte « email déjà pris » (course concurrente rare : un user
 *  peut être inséré entre le SELECT de handleRegister et ce batch). Marquée
 *  par `code='EMAIL_TAKEN'` pour permettre un mapping fin côté appelant si
 *  besoin. handleRegister (M1) traite déjà le 409 EMAIL_TAKEN en amont via son
 *  propre SELECT ; ce garde-fou défensif évite un tenant orphelin sur race. */
export class EmailTakenError extends Error {
  readonly code = 'EMAIL_TAKEN';
  constructor(message = 'Cet email est déjà utilisé') {
    super(message);
    this.name = 'EmailTakenError';
  }
}

export interface ProvisionInput {
  email: string;
  name: string;
  passwordHash: string;
}

export interface ProvisionResult {
  userId: string;
  agencyId: string;
  clientId: string;
}

/**
 * Provisionne une nouvelle agence-tenant complète.
 * CONTRAT §6.4 — signature stable, ne pas modifier.
 *
 * @throws {EmailTakenError} si l'email est déjà présent dans `users` (race).
 * @throws {Error} si le batch échoue (après compensation best-effort).
 */
export async function provisionAgencyTenant(
  env: Env,
  { email, name, passwordHash }: ProvisionInput,
): Promise<ProvisionResult> {
  // Garde-fou défensif : email déjà pris (race entre le SELECT amont de
  // handleRegister et ce batch). On vérifie AVANT le batch → aucun tenant
  // orphelin créé si l'email existe déjà.
  const existing = (await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first()) as { id: string } | null;
  if (existing) {
    throw new EmailTakenError();
  }

  // IDs — `crypto.randomUUID()` est le standard projet (auth.ts, beta.ts, etc.).
  const agencyId = crypto.randomUUID();
  const clientId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const subAccountId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();

  // ── Sprint 22 — Billing Stripe prod (E4 flag mock) ──────────────────────
  // EXTENSION ADDITIVE seq120 : provisioning pose dès le départ les colonnes
  // mock (stripe_customer_id mock_cus_*, provider='mock', billing_period,
  // current_period_start/end +30 jours, updated_at). Le batch atomique-intra
  // contient ces colonnes nullable ; si la migration seq120 n'est pas jouée
  // (test legacy, dev avant migration) → fallback batch SANS ces colonnes
  // (rétro-compat byte-identique). Ne PAS bloquer le runner provisioning.
  const mockStripeCustomer = buildMockStripeCustomer(clientId);
  try {
    // Atomique intra-batch (pattern beta.ts:51). Ordre = dépendances FK
    // logiques : agence → client → user → jonction → subscription.
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO agencies (id, name, owner_id) VALUES (?, ?, ?)',
      ).bind(agencyId, name, userId),
      env.DB.prepare(
        'INSERT INTO clients (id, name, email, agency_id) VALUES (?, ?, ?, ?)',
      ).bind(clientId, name, email, agencyId),
      env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, name, role, client_id, account_level, agency_id)
         VALUES (?, ?, ?, ?, 'admin', ?, 'agency', ?)`,
      ).bind(userId, email, passwordHash, name, clientId, agencyId),
      env.DB.prepare(
        'INSERT INTO user_sub_accounts (id, user_id, client_id) VALUES (?, ?, ?)',
      ).bind(subAccountId, userId, clientId),
      env.DB.prepare(
        `INSERT INTO subscriptions
           (id, client_id, agency_id, plan_name, status,
            stripe_customer_id, provider, billing_period,
            current_period_start, current_period_end, updated_at)
         VALUES (?, ?, ?, 'free', 'active',
                 ?, 'mock', 'monthly',
                 datetime('now'), datetime('now', '+30 days'), datetime('now'))`,
      ).bind(subscriptionId, clientId, agencyId, mockStripeCustomer),
    ]);
  } catch (err) {
    // Si l'erreur vient de colonnes seq120 absentes → on retombe sur l'INSERT
    // minimal legacy (provisioning runner ne doit PAS être bloqué).
    const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
    const isMissingSeq120Column = msg.includes('no such column') || msg.includes('has no column');
    if (isMissingSeq120Column) {
      try {
        await env.DB.batch([
          env.DB.prepare(
            'INSERT INTO agencies (id, name, owner_id) VALUES (?, ?, ?)',
          ).bind(agencyId, name, userId),
          env.DB.prepare(
            'INSERT INTO clients (id, name, email, agency_id) VALUES (?, ?, ?, ?)',
          ).bind(clientId, name, email, agencyId),
          env.DB.prepare(
            `INSERT INTO users (id, email, password_hash, name, role, client_id, account_level, agency_id)
             VALUES (?, ?, ?, ?, 'admin', ?, 'agency', ?)`,
          ).bind(userId, email, passwordHash, name, clientId, agencyId),
          env.DB.prepare(
            'INSERT INTO user_sub_accounts (id, user_id, client_id) VALUES (?, ?, ?)',
          ).bind(subAccountId, userId, clientId),
          env.DB.prepare(
            `INSERT INTO subscriptions (id, client_id, agency_id, plan_name, status)
             VALUES (?, ?, ?, 'free', 'active')`,
          ).bind(subscriptionId, clientId, agencyId),
        ]);
        // Succès du fallback : ré-attribue err pour ne plus compenser.
        return { userId, agencyId, clientId };
      } catch (err2) {
        // Erreur sur le fallback : compensation + throw l'erreur fallback.
        await compensate(env, {
          subscriptionId,
          subAccountId,
          userId,
          clientId,
          agencyId,
        });
        throw err2 instanceof Error
          ? err2
          : new Error(typeof err2 === 'string' ? err2 : 'Provisioning échoué');
      }
    }
    // Erreur non liée aux colonnes seq120 : compensation classique + rethrow.
    // Compensation best-effort : DELETE des 5 rows par id, ordre INVERSE de
    // l'insertion. Chaque DELETE est isolé (un échec n'empêche pas les autres).
    await compensate(env, {
      subscriptionId,
      subAccountId,
      userId,
      clientId,
      agencyId,
    });
    throw err instanceof Error
      ? err
      : new Error(typeof err === 'string' ? err : 'Provisioning échoué');
  }

  return { userId, agencyId, clientId };
}

/** Rollback best-effort : supprime les 5 rows par id, ordre inverse de
 *  l'insertion. Chaque DELETE est try/catch isolé pour ne jamais masquer
 *  l'erreur d'origine. */
async function compensate(
  env: Env,
  ids: {
    subscriptionId: string;
    subAccountId: string;
    userId: string;
    clientId: string;
    agencyId: string;
  },
): Promise<void> {
  const steps: Array<[string, string]> = [
    ['DELETE FROM subscriptions WHERE id = ?', ids.subscriptionId],
    ['DELETE FROM user_sub_accounts WHERE id = ?', ids.subAccountId],
    ['DELETE FROM users WHERE id = ?', ids.userId],
    ['DELETE FROM clients WHERE id = ?', ids.clientId],
    ['DELETE FROM agencies WHERE id = ?', ids.agencyId],
  ];
  for (const [sql, id] of steps) {
    try {
      await env.DB.prepare(sql).bind(id).run();
    } catch {
      /* compensation best-effort — ne jamais masquer l'erreur d'origine */
    }
  }
}
