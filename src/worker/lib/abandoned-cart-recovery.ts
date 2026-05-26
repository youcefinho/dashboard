// ── Abandoned cart recovery sequence — Sprint 40 Phase B (2026-05-24) ────────
//
// 4 helpers multi-touch sequence (1h/24h/72h, discount 0/5/10%) pour la
// séquence de récupération additive `carts.recovery_email_sent_count` seq135.
//
// NE TOUCHE PAS `ecommerce-cart-recovery.ts` (Sprint E7 single-touch reste
// fonctionnel — colonne `recovered_at` legacy intacte). La séquence Phase B
// LIT/ÉCRIT exclusivement les nouvelles colonnes :
//   - recovery_email_sent_count (compteur tentatives)
//   - last_recovery_at          (timestamp dernière touche)
//   - recovery_attempts_json    (historique JSON [{step,channel,ts,coupon...}])
//   - recovery_discount_code    (coupon généré pour le panier — engine `coupons`)
//   - recovery_completed_at     (panier converti via la séquence — checkout)
//
// Idempotence : UPDATE atomique conditionnel WHERE recovery_email_sent_count =
// ancien_compteur (anti-course concurrente entre crons). INSERT OR IGNORE pour
// coupons (retry cron safe). Best-effort : panne D1/réseau ⇒ skip silencieux.
// Templates email RGPD (lien unsubscribe obligatoire footer).

import type { Env } from '../types';
import {
  RECOVERY_DELAYS_MIN,
  RECOVERY_DISCOUNT_PCT,
} from '../../lib/types';

// ── Constantes internes ────────────────────────────────────────────────────

/** Origine par défaut pour les liens email (override via env si besoin futur). */
const DEFAULT_ORIGIN = 'https://intralys-dashboard.intralys.workers.dev';

/** TTL coupon recovery (7 jours après envoi). */
const RECOVERY_COUPON_TTL_DAYS = 7;

// ── Types internes ─────────────────────────────────────────────────────────

interface CartRow {
  id: string;
  client_id: string;
  cart_token: string;
  customer_id: string | null;
  recovery_email_sent_count: number | null;
  last_recovery_at: string | null;
  status: string;
}

interface CartWithCustomer {
  id: string;
  client_id: string;
  cart_token: string;
  customer_id: string | null;
  customer_email: string | null;
  customer_first_name: string | null;
  recovery_discount_code: string | null;
  currency: string | null;
}

interface CartItemRow {
  product_title: string | null;
  variant_title: string | null;
  quantity: number;
  unit_price_cents: number;
}

interface RecoveryAttempt {
  step: 1 | 2 | 3;
  channel: 'email' | 'sms';
  ts: string;
  coupon_code: string | null;
  opened_at: string | null;
  clicked_at: string | null;
}

// ── 1. processRecoverySequence ─────────────────────────────────────────────

/**
 * Cron multi-touch : scan paniers abandonnés éligibles à la prochaine touche
 * selon `recovery_email_sent_count` + `last_recovery_at` vs `RECOVERY_DELAYS_MIN`.
 *
 * Logique :
 *   1. SELECT carts WHERE status='abandoned' AND recovery_completed_at IS NULL
 *      AND recovery_email_sent_count < 3 LIMIT 50 (batch borné).
 *   2. Pour chaque cart : next_step = recovery_email_sent_count + 1.
 *   3. Si last_recovery_at IS NULL ⇒ éligible immédiat (step 1 depuis abandon).
 *      Sinon : éligible si last_recovery_at + delayMin minutes ≤ now.
 *   4. UPDATE atomique conditionnel (anti-race) WHERE recovery_email_sent_count
 *      = ancien_compteur. Si changes=0 ⇒ autre worker a gagné la course, skip.
 *   5. generateRecoveryCoupon + composeRecoveryEmail + enqueueEmail (stub).
 *   6. recordRecoveryAttempt(env, cartId, step, 'email', couponCode).
 *
 * Best-effort : panne D1/réseau ⇒ skip silencieux (jamais throw).
 */
export async function processRecoverySequence(
  env: Env,
): Promise<{ processed: number; sent: number }> {
  let processed = 0;
  let sent = 0;

  let candidates: CartRow[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, cart_token, customer_id,
              recovery_email_sent_count, last_recovery_at, status
         FROM carts
        WHERE status = 'abandoned'
          AND COALESCE(recovery_email_sent_count, 0) < 3
          AND recovery_completed_at IS NULL
        ORDER BY COALESCE(last_recovery_at, abandoned_at, updated_at) ASC
        LIMIT 50`,
    ).all();
    candidates = (results || []) as unknown as CartRow[];
  } catch (err) {
    console.error('processRecoverySequence SELECT failed', err);
    return { processed: 0, sent: 0 };
  }

  for (const cart of candidates) {
    processed += 1;
    const currentCount = Number(cart.recovery_email_sent_count || 0);
    const nextStep = (currentCount + 1) as 1 | 2 | 3;
    if (nextStep < 1 || nextStep > 3) continue;

    const delayMin = RECOVERY_DELAYS_MIN[nextStep];

    // Vérifier éligibilité par fenêtre de délai côté DB (cohérent datetime('now')).
    if (cart.last_recovery_at) {
      let eligibleRow: { eligible: number } | null = null;
      try {
        eligibleRow = (await env.DB.prepare(
          `SELECT CASE WHEN datetime(?, ?) <= datetime('now') THEN 1 ELSE 0 END AS eligible`,
        )
          .bind(cart.last_recovery_at, `+${delayMin} minutes`)
          .first()) as { eligible: number } | null;
      } catch {
        eligibleRow = null;
      }
      if (!eligibleRow || Number(eligibleRow.eligible) !== 1) continue;
    }
    // Si last_recovery_at IS NULL ⇒ step 1 immédiat (panier déjà abandoned,
    // le SELECT garantit status='abandoned' ⇒ abandoned_at déjà passé).

    // UPDATE atomique conditionnel anti-race : on RÉSERVE le créneau avant
    // d'envoyer l'email. Si un autre worker a déjà incrémenté ⇒ changes=0.
    let claimChanges = 0;
    try {
      const res = await env.DB.prepare(
        `UPDATE carts
            SET recovery_email_sent_count = COALESCE(recovery_email_sent_count, 0) + 1,
                last_recovery_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?
            AND COALESCE(recovery_email_sent_count, 0) = ?
            AND status = 'abandoned'
            AND recovery_completed_at IS NULL`,
      )
        .bind(cart.id, currentCount)
        .run();
      claimChanges = Number((res.meta?.changes as number) || 0);
    } catch (err) {
      console.error('processRecoverySequence claim UPDATE failed', cart.id, err);
      continue;
    }
    if (claimChanges === 0) continue; // course perdue ⇒ skip

    // Génère coupon (step 1 = '' no-coupon ; step 2/3 = REC-xxxxxxxx-N).
    let couponCode = '';
    try {
      couponCode = await generateRecoveryCoupon(
        env, cart.client_id, cart.cart_token, nextStep,
      );
    } catch (err) {
      console.error('generateRecoveryCoupon failed', cart.id, err);
    }

    // Persiste le code coupon courant sur le panier (best-effort).
    if (couponCode) {
      try {
        await env.DB.prepare(
          `UPDATE carts SET recovery_discount_code = ?, updated_at = datetime('now')
            WHERE id = ?`,
        ).bind(couponCode, cart.id).run();
      } catch (err) {
        console.error('processRecoverySequence set discount_code failed', cart.id, err);
      }
    }

    // Locale : à défaut, fr-CA (calque MULTILANG-B fallback).
    const locale = 'fr-CA';

    // Compose email (best-effort).
    let email: { subject: string; html: string; text: string } = {
      subject: '', html: '', text: '',
    };
    try {
      email = await composeRecoveryEmail(env, cart.id, nextStep, locale);
    } catch (err) {
      console.error('composeRecoveryEmail failed', cart.id, err);
    }

    // Enqueue email (stub — sera wiré ultérieurement à un vrai message queue).
    try {
      await enqueueRecoveryEmail(env, cart.id, email);
    } catch (err) {
      console.error('enqueueRecoveryEmail failed', cart.id, err);
    }

    // Enregistre la tentative dans le journal JSON (best-effort).
    try {
      await recordRecoveryAttempt(
        env, cart.id, nextStep, 'email', couponCode || null,
      );
    } catch (err) {
      console.error('recordRecoveryAttempt failed', cart.id, err);
    }

    sent += 1;
  }

  return { processed, sent };
}

// ── 2. generateRecoveryCoupon ──────────────────────────────────────────────

/**
 * Génère un coupon de récupération via l'engine `coupons` EXISTANT
 * (seq18 + ALTER seq85). Discount % piloté par `RECOVERY_DISCOUNT_PCT[step]`
 * (step 1 = 0%, step 2 = 5%, step 3 = 10%). Code : `REC-{token8}-{step}`.
 *
 * Idempotent : INSERT OR IGNORE évite doublon sur retry cron. expires_at
 * = now + 7 jours. usage_limit = 1 (one-shot par panier).
 * Best-effort : panne D1 ⇒ retourne '' (UI fallback : pas de discount).
 *
 * Retourne le code coupon, ou '' si step 1 (pas de coupon) ou si erreur.
 */
export async function generateRecoveryCoupon(
  env: Env,
  clientId: string,
  cartToken: string,
  step: 1 | 2 | 3,
): Promise<string> {
  const discountPct = Number(RECOVERY_DISCOUNT_PCT[step]);
  if (!discountPct || discountPct === 0) return '';

  const token8 = (cartToken || '').toString().slice(0, 8);
  if (!token8) return '';

  const code = `REC-${token8}-${step}`;
  const id = crypto.randomUUID();

  try {
    // INSERT OR IGNORE : si (client_id, code) existe déjà ⇒ no-op silencieux
    // (idempotence retry cron). discount_type='percent', usage_limit=1,
    // is_active=1, expires_at = now + RECOVERY_COUPON_TTL_DAYS jours.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO coupons
         (id, client_id, code, discount_type, discount_percent,
          usage_limit, times_used, is_active, expires_at, created_at)
       VALUES (?, ?, ?, 'percent', ?, 1, 0, 1, datetime('now', ?), datetime('now'))`,
    )
      .bind(id, clientId, code, discountPct, `+${RECOVERY_COUPON_TTL_DAYS} days`)
      .run();
  } catch (err) {
    console.error('generateRecoveryCoupon INSERT failed', clientId, code, err);
    return '';
  }

  return code;
}

// ── 3. composeRecoveryEmail ────────────────────────────────────────────────

/**
 * Compose subject/html/text bilingue (locale customer) du courriel de relance.
 *   - Step 1 = rappel doux, pas de discount.
 *   - Step 2 = incentive 5%.
 *   - Step 3 = last-chance 10% + urgence.
 *
 * Liens :
 *   - Recovery : `${origin}/api/recovery/${cart_token}/${step}`
 *   - Unsubscribe (RGPD) : `${origin}/api/unsubscribe?token=${cart_token}&list=recovery`
 *
 * Best-effort : cart introuvable ⇒ retourne template vide cohérent (jamais throw).
 */
export async function composeRecoveryEmail(
  env: Env,
  cartId: string,
  step: 1 | 2 | 3,
  locale: string,
): Promise<{ subject: string; html: string; text: string }> {
  // Load cart + customer (best-effort).
  let cart: CartWithCustomer | null = null;
  try {
    cart = (await env.DB.prepare(
      `SELECT c.id, c.client_id, c.cart_token, c.customer_id,
              c.recovery_discount_code, c.currency,
              cu.email AS customer_email,
              cu.first_name AS customer_first_name
         FROM carts c
         LEFT JOIN customers cu ON cu.id = c.customer_id
        WHERE c.id = ? LIMIT 1`,
    ).bind(cartId).first()) as CartWithCustomer | null;
  } catch {
    cart = null;
  }
  if (!cart) {
    return { subject: '', html: '', text: '' };
  }

  // Load items (best-effort).
  let items: CartItemRow[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(p.title, '') AS product_title,
              COALESCE(v.title, '') AS variant_title,
              it.quantity AS quantity,
              COALESCE(v.price_override, p.base_price, 0) AS unit_price_cents
         FROM cart_items it
         LEFT JOIN product_variants v ON v.id = it.variant_id
         LEFT JOIN products p ON p.id = v.product_id
        WHERE it.cart_id = ?
        ORDER BY it.added_at ASC
        LIMIT 50`,
    ).bind(cartId).all();
    items = ((results || []) as unknown) as CartItemRow[];
  } catch {
    items = [];
  }

  // Normalise locale.
  const loc = normalizeLocale(locale);
  const firstName = (cart.customer_first_name || '').toString().trim();
  const discountPct = RECOVERY_DISCOUNT_PCT[step];
  const couponCode = (cart.recovery_discount_code || '').toString();
  const cartToken = (cart.cart_token || '').toString();
  const origin = DEFAULT_ORIGIN;
  const recoveryUrl = `${origin}/api/recovery/${encodeURIComponent(cartToken)}/${step}`;
  const unsubscribeUrl =
    `${origin}/api/unsubscribe?token=${encodeURIComponent(cartToken)}&list=recovery`;

  const tpl = TEMPLATES[loc][step];
  const subject = tpl.subject(firstName);
  const greeting = tpl.greeting(firstName);
  const body = tpl.body(discountPct, couponCode);
  const cta = tpl.cta;
  const footer = tpl.footer(unsubscribeUrl);

  const itemsHtml = renderItemsHtml(items);
  const itemsText = renderItemsText(items);

  const html = renderHtmlEmail({
    subject, greeting, body, cta,
    recoveryUrl, itemsHtml, footer,
  });
  const text = renderTextEmail({
    greeting, body, cta, recoveryUrl, itemsText, footer,
  });

  return { subject, html, text };
}

// ── 4. recordRecoveryAttempt ───────────────────────────────────────────────

/**
 * Enregistre une tentative dans le journal JSON `recovery_attempts_json`.
 *
 * Logique :
 *   1. SELECT recovery_attempts_json WHERE id=? (lecture anti-race).
 *   2. Parse array existant + append {step, channel, ts, coupon_code,
 *      opened_at:null, clicked_at:null}.
 *   3. UPDATE atomique conditionnel WHERE recovery_email_sent_count = step
 *      (cohérent avec processRecoverySequence qui a déjà incrémenté à `step`).
 *   4. Si changes=0 ⇒ course perdue ou état changé ⇒ return false.
 *   5. Sinon return true.
 *
 * Best-effort : panne D1 ⇒ return false (jamais throw).
 */
export async function recordRecoveryAttempt(
  env: Env,
  cartId: string,
  step: 1 | 2 | 3,
  channel: 'email' | 'sms',
  couponCode: string | null,
): Promise<boolean> {
  // 1. Lecture courante (anti-race avant push).
  let row: { recovery_attempts_json: string | null } | null = null;
  try {
    row = (await env.DB.prepare(
      `SELECT recovery_attempts_json FROM carts WHERE id = ? LIMIT 1`,
    ).bind(cartId).first()) as { recovery_attempts_json: string | null } | null;
  } catch {
    return false;
  }
  if (!row) return false;

  // 2. Parse + append (best-effort sur JSON corrompu).
  let attempts: RecoveryAttempt[] = [];
  if (row.recovery_attempts_json) {
    try {
      const parsed = JSON.parse(row.recovery_attempts_json);
      if (Array.isArray(parsed)) attempts = parsed as RecoveryAttempt[];
    } catch {
      attempts = [];
    }
  }

  // Timestamp ISO via DB pour cohérence horloge (datetime('now') = même
  // référence que les DEFAULT colonnes).
  let nowIso = '';
  try {
    const r = (await env.DB.prepare(
      "SELECT datetime('now') AS now",
    ).first()) as { now: string } | null;
    nowIso = r?.now || '';
  } catch {
    nowIso = '';
  }
  if (!nowIso) nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

  attempts.push({
    step,
    channel,
    ts: nowIso,
    coupon_code: couponCode,
    opened_at: null,
    clicked_at: null,
  });

  const serialized = JSON.stringify(attempts);

  // 3. UPDATE atomique conditionnel (cohérent avec compteur déjà = step).
  let changes = 0;
  try {
    const res = await env.DB.prepare(
      `UPDATE carts
          SET recovery_attempts_json = ?,
              updated_at = datetime('now')
        WHERE id = ?
          AND COALESCE(recovery_email_sent_count, 0) = ?`,
    )
      .bind(serialized, cartId, step)
      .run();
    changes = Number((res.meta?.changes as number) || 0);
  } catch {
    return false;
  }

  return changes > 0;
}

// ── Helpers internes ───────────────────────────────────────────────────────

/**
 * Stub enqueue email : sera wiré ultérieurement à un vrai message queue
 * (Resend / BROADCAST_QUEUE / messages table). Pour Phase B, log JSON.
 */
async function enqueueRecoveryEmail(
  env: Env,
  cartId: string,
  email: { subject: string; html: string; text: string },
): Promise<void> {
  void env;
  if (!email.subject) return;
  console.log(JSON.stringify({
    type: 'recovery_email_enqueued',
    cart_id: cartId,
    subject: email.subject,
    has_html: !!email.html,
    has_text: !!email.text,
  }));
}

/** Normalise la locale d'entrée vers une clé connue (fallback fr-CA). */
function normalizeLocale(locale: string): 'fr-CA' | 'fr-FR' | 'en' | 'es' {
  const l = (locale || '').toString().toLowerCase().trim();
  if (l === 'fr-fr' || l === 'fr_fr' || l === 'fr-france') return 'fr-FR';
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('es')) return 'es';
  return 'fr-CA';
}

/** Rendu HTML de la liste d'articles (table simple, RGPD-friendly). */
function renderItemsHtml(items: CartItemRow[]): string {
  if (!items.length) return '';
  const rows = items.map((it) => {
    const title = escapeHtml((it.product_title || '').toString());
    const variant = it.variant_title ? ` — ${escapeHtml(it.variant_title)}` : '';
    const qty = Math.max(0, Math.round(Number(it.quantity) || 0));
    const price = formatCents(Number(it.unit_price_cents) || 0);
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${title}${variant}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${qty} × ${price}</td>
    </tr>`;
  }).join('');
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;">${rows}</table>`;
}

/** Rendu texte de la liste d'articles (fallback). */
function renderItemsText(items: CartItemRow[]): string {
  if (!items.length) return '';
  return items.map((it) => {
    const title = (it.product_title || '').toString();
    const variant = it.variant_title ? ` — ${it.variant_title}` : '';
    const qty = Math.max(0, Math.round(Number(it.quantity) || 0));
    const price = formatCents(Number(it.unit_price_cents) || 0);
    return `  • ${title}${variant} (${qty} × ${price})`;
  }).join('\n');
}

/** Échappement HTML minimal (anti-XSS dans subject/title customer). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format cents → "12,34 $" (FR par défaut, indicatif email). */
function formatCents(cents: number): string {
  const v = (Math.max(0, Math.round(cents)) / 100).toFixed(2).replace('.', ',');
  return `${v} $`;
}

/** Compose la coquille HTML (inline styles, compat clients email). */
function renderHtmlEmail(args: {
  subject: string;
  greeting: string;
  body: string;
  cta: string;
  recoveryUrl: string;
  itemsHtml: string;
  footer: string;
}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(args.subject)}</title></head>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#f6f6f6;margin:0;padding:24px;">
  <table role="presentation" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;">
    <tr><td>
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px 0;">${escapeHtml(args.greeting)}</p>
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px 0;">${escapeHtml(args.body)}</p>
      ${args.itemsHtml}
      <p style="text-align:center;margin:24px 0;">
        <a href="${args.recoveryUrl}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(args.cta)}</a>
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="font-size:12px;color:#777;line-height:1.5;margin:0;">${args.footer}</p>
    </td></tr>
  </table>
</body></html>`;
}

/** Compose la version texte fallback (clients sans HTML / RGPD-friendly). */
function renderTextEmail(args: {
  greeting: string;
  body: string;
  cta: string;
  recoveryUrl: string;
  itemsText: string;
  footer: string;
}): string {
  const parts = [
    args.greeting,
    '',
    args.body,
  ];
  if (args.itemsText) {
    parts.push('', args.itemsText);
  }
  parts.push(
    '',
    `${args.cta} : ${args.recoveryUrl}`,
    '',
    '---',
    stripHtml(args.footer),
  );
  return parts.join('\n');
}

/** Strip tags pour version texte du footer (qui peut contenir <a>). */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ── Templates i18n (embedded — Phase B) ────────────────────────────────────
//
// Tutoiement fr-CA, vouvoiement fr-FR (calque MULTILANG-B i18n-server.ts).
// Footer RGPD : lien unsubscribe obligatoire (Loi 25 + CASL + RGPD).

type LocaleKey = 'fr-CA' | 'fr-FR' | 'en' | 'es';

interface StepTemplate {
  subject: (firstName: string) => string;
  greeting: (firstName: string) => string;
  body: (discountPct: number, couponCode: string) => string;
  cta: string;
  footer: (unsubscribeUrl: string) => string;
}

const TEMPLATES: Record<LocaleKey, Record<1 | 2 | 3, StepTemplate>> = {
  'fr-CA': {
    1: {
      subject: (n) => n ? `${n}, tu as oublié quelque chose 🛒` : 'Tu as oublié quelque chose dans ton panier 🛒',
      greeting: (n) => n ? `Salut ${n},` : 'Salut,',
      body: () => `On a remarqué que tu as laissé des articles dans ton panier. Pas de souci, on les a gardés au chaud pour toi !`,
      cta: 'Reprendre ma commande',
      footer: (u) => `Tu reçois ce courriel parce que tu as commencé une commande. <a href="${u}">Me désabonner des relances</a>.`,
    },
    2: {
      subject: (n) => n ? `${n}, voici 5 % pour t'aider à finaliser` : 'Une petite remise de 5 % pour ton panier',
      greeting: (n) => n ? `Salut ${n},` : 'Salut,',
      body: (pct, code) => `Ton panier t'attend toujours. Pour t'aider à te décider, voici ${pct} % de remise avec le code ${code || ''} (valide 7 jours).`,
      cta: 'Profiter de ma remise',
      footer: (u) => `Tu reçois ce courriel parce que tu as commencé une commande. <a href="${u}">Me désabonner des relances</a>.`,
    },
    3: {
      subject: (n) => n ? `Dernière chance ${n} — 10 % sur ton panier` : 'Dernière chance — 10 % sur ton panier',
      greeting: (n) => n ? `Salut ${n},` : 'Salut,',
      body: (pct, code) => `C'est la dernière fois qu'on te relance. ${pct} % de remise immédiate avec le code ${code || ''} — après, ton panier sera libéré.`,
      cta: 'Finaliser maintenant',
      footer: (u) => `Tu reçois ce courriel parce que tu as commencé une commande. <a href="${u}">Me désabonner des relances</a>.`,
    },
  },
  'fr-FR': {
    1: {
      subject: (n) => n ? `${n}, vous avez oublié votre panier 🛒` : 'Vous avez oublié votre panier 🛒',
      greeting: (n) => n ? `Bonjour ${n},` : 'Bonjour,',
      body: () => `Nous avons remarqué que vous avez laissé des articles dans votre panier. Pas d'inquiétude, nous les avons gardés pour vous.`,
      cta: 'Reprendre ma commande',
      footer: (u) => `Vous recevez ce courriel parce que vous avez commencé une commande. <a href="${u}">Me désabonner des relances</a>.`,
    },
    2: {
      subject: (n) => n ? `${n}, voici 5 % pour finaliser votre commande` : 'Une remise de 5 % sur votre panier',
      greeting: (n) => n ? `Bonjour ${n},` : 'Bonjour,',
      body: (pct, code) => `Votre panier vous attend toujours. Pour vous aider à finaliser, voici ${pct} % de remise avec le code ${code || ''} (valable 7 jours).`,
      cta: 'Profiter de ma remise',
      footer: (u) => `Vous recevez ce courriel parce que vous avez commencé une commande. <a href="${u}">Me désabonner des relances</a>.`,
    },
    3: {
      subject: (n) => n ? `Dernière chance ${n} — 10 % sur votre panier` : 'Dernière chance — 10 % sur votre panier',
      greeting: (n) => n ? `Bonjour ${n},` : 'Bonjour,',
      body: (pct, code) => `Dernier rappel : ${pct} % de remise immédiate avec le code ${code || ''}. Après cela, votre panier sera libéré.`,
      cta: 'Finaliser maintenant',
      footer: (u) => `Vous recevez ce courriel parce que vous avez commencé une commande. <a href="${u}">Me désabonner des relances</a>.`,
    },
  },
  'en': {
    1: {
      subject: (n) => n ? `${n}, you left something behind 🛒` : 'You left something in your cart 🛒',
      greeting: (n) => n ? `Hi ${n},` : 'Hi,',
      body: () => `We noticed you left a few items in your cart. No worries — we saved them for you.`,
      cta: 'Resume my order',
      footer: (u) => `You're receiving this email because you started an order. <a href="${u}">Unsubscribe from recovery emails</a>.`,
    },
    2: {
      subject: (n) => n ? `${n}, here's 5% off your cart` : `Here's 5% off your cart`,
      greeting: (n) => n ? `Hi ${n},` : 'Hi,',
      body: (pct, code) => `Your cart is still waiting. Here's ${pct}% off with code ${code || ''} (valid 7 days).`,
      cta: 'Claim my discount',
      footer: (u) => `You're receiving this email because you started an order. <a href="${u}">Unsubscribe from recovery emails</a>.`,
    },
    3: {
      subject: (n) => n ? `Last chance ${n} — 10% off your cart` : 'Last chance — 10% off your cart',
      greeting: (n) => n ? `Hi ${n},` : 'Hi,',
      body: (pct, code) => `This is your last reminder: ${pct}% off with code ${code || ''}. After this, we'll release your cart.`,
      cta: 'Complete now',
      footer: (u) => `You're receiving this email because you started an order. <a href="${u}">Unsubscribe from recovery emails</a>.`,
    },
  },
  'es': {
    1: {
      subject: (n) => n ? `${n}, olvidaste algo en tu carrito 🛒` : 'Olvidaste algo en tu carrito 🛒',
      greeting: (n) => n ? `Hola ${n},` : 'Hola,',
      body: () => `Notamos que dejaste algunos artículos en tu carrito. No te preocupes, los guardamos para ti.`,
      cta: 'Retomar mi pedido',
      footer: (u) => `Recibes este correo porque iniciaste un pedido. <a href="${u}">Darme de baja de los recordatorios</a>.`,
    },
    2: {
      subject: (n) => n ? `${n}, aquí tienes 5 % en tu carrito` : 'Un descuento del 5 % en tu carrito',
      greeting: (n) => n ? `Hola ${n},` : 'Hola,',
      body: (pct, code) => `Tu carrito sigue esperando. Aquí tienes ${pct} % con el código ${code || ''} (válido 7 días).`,
      cta: 'Aprovechar mi descuento',
      footer: (u) => `Recibes este correo porque iniciaste un pedido. <a href="${u}">Darme de baja de los recordatorios</a>.`,
    },
    3: {
      subject: (n) => n ? `Última oportunidad ${n} — 10 % en tu carrito` : 'Última oportunidad — 10 % en tu carrito',
      greeting: (n) => n ? `Hola ${n},` : 'Hola,',
      body: (pct, code) => `Último recordatorio: ${pct} % con el código ${code || ''}. Después, liberaremos tu carrito.`,
      cta: 'Finalizar ahora',
      footer: (u) => `Recibes este correo porque iniciaste un pedido. <a href="${u}">Darme de baja de los recordatorios</a>.`,
    },
  },
};
