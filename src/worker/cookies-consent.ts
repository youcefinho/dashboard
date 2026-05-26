// ── Sprint 23 — Sécurité / conformité — handlers cookie consent ──────────
// 2 handlers : POST PUBLIC (anonyme ou authed) + GET AUTHED (mon dernier
// consentement). Rate-limit 30/min/IP sur POST pour éviter spam log.

import type { Env } from './types';
import { json, extractToken, validateSession } from './helpers';
import { cookieConsentSchema } from '../lib/schemas';
import { checkRateLimit } from './lib/rate-limit';
import type { CookieConsentRecord } from '../lib/types';

interface MeAuth { userId: string; }

// ── POST /api/cookies/consent ───────────────────────────────── PUBLIC ──
// Câblée AVANT le chokepoint requireAuth (~ligne 1123 worker.ts). Le user
// peut être anonyme (anonymous_id généré client) OU authed (token Bearer
// présent → join user_id). Catégorie essential forcée à `true` par schema.
export async function handlePostCookieConsent(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // 1) Extract IP — utile pour rate-limit ET pour la traçabilité.
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';

    // 2) Rate-limit 30 / minute / IP. Anti-spam log cookie banner.
    const rl = await checkRateLimit(env, `cookie-consent:ip:${ip}`, 30, 60);
    if (!rl.allowed) {
      return json(
        { error: 'Trop de soumissions — réessayez plus tard', code: 'RATE_LIMITED' },
        429,
      );
    }

    // 3) Body validation.
    const body = await request.json().catch(() => ({}));
    const parsed = cookieConsentSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Consentement invalide', code: 'CONSENT_REQUIRED' }, 400);
    }
    const { anonymous_id, categories, policy_version, url } = parsed.data;

    // 4) Force essential = true (Loi 25 / RGPD : non négociable).
    const safeCategories = {
      essential: true as const,
      preferences: Boolean(categories.preferences),
      analytics: Boolean(categories.analytics),
      marketing: Boolean(categories.marketing),
    };

    // 5) Best-effort resolve user_id depuis token Bearer (si présent).
    //    Endpoint PUBLIC : token absent = OK, user_id reste null.
    let userId: string | null = null;
    const token = extractToken(request);
    if (token) {
      try {
        const session = await validateSession(token, env);
        if (session.valid && session.userId) userId = session.userId;
      } catch { /* swallow — token invalide = anonyme */ }
    }

    // 6) Extract user-agent + URL pour traçabilité.
    const ua = request.headers.get('User-Agent') || '';
    const pageUrl = url ?? request.headers.get('Referer') ?? '';

    // 7) INSERT cookie_consent_log.
    try {
      await env.DB.prepare(
        `INSERT INTO cookie_consent_log
           (anonymous_id, user_id, categories, policy_version, ip, user_agent, url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        anonymous_id,
        userId,
        JSON.stringify(safeCategories),
        policy_version,
        ip,
        ua,
        pageUrl,
      ).run();
    } catch { /* swallow — seq121 pas jouée. Le user n'a pas à être bloqué. */ }

    // NE PAS audit() ici (volume potentiellement élevé + table dédiée
    // cookie_consent_log déjà loggée).
    return json({ data: { ok: true as const } });
  } catch {
    return json({ error: 'Internal', code: 'INTERNAL' }, 500);
  }
}

// ── GET /api/cookies/consent/me ─────────────────────────────── AUTHED ──
// Dernier consentement enregistré pour ce user (utile pour pré-cocher
// le banner après login). Null si jamais consenti.
export async function handleGetMyCookieConsent(
  env: Env,
  auth: MeAuth,
): Promise<Response> {
  try {
    let row: Record<string, unknown> | null = null;
    try {
      row = await env.DB.prepare(
        `SELECT id, anonymous_id, user_id, categories, policy_version, ip, user_agent, url, granted_at
         FROM cookie_consent_log
         WHERE user_id = ?
         ORDER BY granted_at DESC LIMIT 1`,
      ).bind(auth.userId).first() as Record<string, unknown> | null;
    } catch {
      row = null;
    }

    if (!row) return json({ data: null });

    // Parse categories JSON best-effort.
    let parsedCategories: Record<string, boolean> = {
      essential: true,
      preferences: false,
      analytics: false,
      marketing: false,
    };
    try {
      const raw = row.categories;
      if (typeof raw === 'string') {
        parsedCategories = { ...parsedCategories, ...(JSON.parse(raw) as Record<string, boolean>) };
      } else if (raw && typeof raw === 'object') {
        parsedCategories = { ...parsedCategories, ...(raw as Record<string, boolean>) };
      }
    } catch { /* fallback à defaults */ }

    const result: CookieConsentRecord = {
      id: String(row.id ?? ''),
      anonymous_id: (row.anonymous_id as string | null) ?? null,
      user_id: (row.user_id as string | null) ?? auth.userId,
      categories: {
        essential: true,
        preferences: Boolean(parsedCategories.preferences),
        analytics: Boolean(parsedCategories.analytics),
        marketing: Boolean(parsedCategories.marketing),
      },
      policy_version: String(row.policy_version ?? '1.0'),
      ip: String(row.ip ?? ''),
      user_agent: String(row.user_agent ?? ''),
      url: String(row.url ?? ''),
      granted_at: String(row.granted_at ?? ''),
    };

    return json({ data: result });
  } catch {
    return json({ data: null });
  }
}
