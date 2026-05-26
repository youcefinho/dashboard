// ── Sprint 30 — Release Candidate / Beta — handler check go-live ────────────
// Read-only health check programmatique pour valider l'état production-ready.
// Capability `settings.manage` (figée seq80). Best-effort dégradé.
// Manager-B remplit le corps des checks (migrations, env, endpoints, beta codes).
//
// ⚠️ ZÉRO LEAK secrets : les checks env retournent `ok: boolean` + `missing: string[]`
// (noms de clés uniquement), JAMAIS la valeur réelle.

import type { Env } from './types';
import { json } from './helpers';
import type { ReleaseGatesStatus } from '../lib/types';

interface AdminAuth {
  userId: string;
  role?: string;
}

const EMPTY_GATES_STATUS: ReleaseGatesStatus = {
  all_green: false,
  checks: {
    migrations_last_seq: { ok: false, value: 0 },
    env_critical_present: { ok: false, missing: [] },
    env_optional_present: { ok: false, missing: [] },
    dev_bypass_off: { ok: false },
    payments_live_disabled: { ok: false, value: 0 },
    health_endpoint: { ok: false, status: 0 },
    web_vitals_endpoint: { ok: false, status: 0 },
    beta_codes_seeded: { ok: false, count: 0 },
  },
  checked_at: new Date().toISOString(),
};

// Clés critiques : leur absence = no-go production (auth admin, webhooks, CORS).
const CRITICAL_ENV_KEYS = [
  'DB',
  'ADMIN_PASSWORD',
  'WEBHOOK_SECRET',
  'NOTIFICATION_EMAIL',
  'ALLOWED_ORIGINS',
];

// Clés optionnelles : informatif uniquement (intégrations désactivables).
const OPTIONAL_ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'WHATSAPP_ACCESS_TOKEN',
  'FCM_SERVER_KEY',
  'GHL_CLIENT_ID',
  'SHOPIFY_CLIENT_ID',
  'WOO_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_ID',
  'RATE_LIMITER',
];

const FETCH_TIMEOUT_MS = 5000;

export async function handleReleaseGatesCheck(
  request: Request,
  env: Env,
  auth: AdminAuth,
): Promise<Response> {
  const checkedAt = new Date().toISOString();
  const checks: ReleaseGatesStatus['checks'] = {
    migrations_last_seq: { ok: false, value: 0 },
    env_critical_present: { ok: false, missing: [] },
    env_optional_present: { ok: false, missing: [] },
    dev_bypass_off: { ok: false },
    payments_live_disabled: { ok: false, value: 0 },
    health_endpoint: { ok: false, status: 0 },
    web_vitals_endpoint: { ok: false, status: 0 },
    beta_codes_seeded: { ok: false, count: 0 },
  };

  // ── Check 1 : migrations_last_seq ──────────────────────────────────────────
  // Parse seq depuis nom migration (ex: 'migration-foo-seq125.sql' → 125).
  // Fallback : COUNT(*) si le parse SUBSTR/INSTR retourne NULL.
  try {
    let sequenceValue = 0;
    try {
      const row = await env.DB.prepare(
        `SELECT MAX(CAST(SUBSTR(name, INSTR(name, 'seq') + 3) AS INTEGER)) as max_seq FROM _migrations`,
      ).first<{ max_seq: number | null }>();
      sequenceValue = Number(row?.max_seq ?? 0);
    } catch {
      sequenceValue = 0;
    }
    if (!sequenceValue) {
      try {
        const fallback = await env.DB.prepare(
          `SELECT COUNT(*) as c FROM _migrations`,
        ).first<{ c: number }>();
        sequenceValue = Number(fallback?.c ?? 0);
      } catch {
        sequenceValue = 0;
      }
    }
    checks.migrations_last_seq = {
      ok: sequenceValue >= 125,
      value: sequenceValue,
    };
  } catch {
    checks.migrations_last_seq = { ok: false, value: 0 };
  }

  // ── Check 2 : env_critical_present (sans leak valeur) ──────────────────────
  const envRecord = env as unknown as Record<string, unknown>;
  const criticalMissing = CRITICAL_ENV_KEYS.filter((k) => {
    const v = envRecord[k];
    return v === undefined || v === null || v === '';
  });
  checks.env_critical_present = {
    ok: criticalMissing.length === 0,
    missing: criticalMissing,
  };

  // ── Check 3 : env_optional_present (informatif, missing[] noms seulement) ──
  const optionalMissing = OPTIONAL_ENV_KEYS.filter((k) => {
    const v = envRecord[k];
    return v === undefined || v === null || v === '';
  });
  checks.env_optional_present = {
    ok: true, // toujours ok : informatif, n'impacte pas all_green
    missing: optionalMissing,
  };

  // ── Check 4 : dev_bypass_off (CRITIQUE) ────────────────────────────────────
  checks.dev_bypass_off = {
    ok: env.DEV_BYPASS_AUTH !== 'true',
  };

  // ── Check 5 : payments_live_disabled ───────────────────────────────────────
  // Lecture best-effort : si table settings absente → safe default (désactivé).
  try {
    const row = await env.DB.prepare(
      `SELECT value FROM settings WHERE key = 'payments_live_enabled' LIMIT 1`,
    ).first<{ value: string | number | null }>();
    const v = Number(row?.value ?? 0);
    checks.payments_live_disabled = {
      ok: v === 0,
      value: v,
    };
  } catch {
    checks.payments_live_disabled = { ok: true, value: 0 };
  }

  // ── Check 6 : health_endpoint (fetch interne timeout 5s) ──────────────────
  try {
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: ctrl.signal });
      checks.health_endpoint = {
        ok: res.status === 200,
        status: res.status,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    checks.health_endpoint = { ok: false, status: 0 };
  }

  // ── Check 7 : web_vitals_endpoint (fetch interne timeout 5s, propage auth) ─
  try {
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/api/admin/web-vitals`, {
        signal: ctrl.signal,
        headers: { Authorization: request.headers.get('Authorization') ?? '' },
      });
      checks.web_vitals_endpoint = {
        ok: res.status === 200,
        status: res.status,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    checks.web_vitals_endpoint = { ok: false, status: 0 };
  }

  // ── Check 8 : beta_codes_seeded ────────────────────────────────────────────
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM beta_invite_codes`,
    ).first<{ c: number }>();
    const count = Number(row?.c ?? 0);
    checks.beta_codes_seeded = {
      ok: count >= 5,
      count,
    };
  } catch {
    checks.beta_codes_seeded = { ok: false, count: 0 };
  }

  // ── Calcule all_green sur checks CRITIQUES uniquement ─────────────────────
  // env_optional_present est exclu (informatif, ne bloque jamais).
  const allGreen =
    checks.migrations_last_seq.ok &&
    checks.env_critical_present.ok &&
    checks.dev_bypass_off.ok &&
    checks.payments_live_disabled.ok &&
    checks.health_endpoint.ok &&
    checks.web_vitals_endpoint.ok &&
    checks.beta_codes_seeded.ok;

  const status: ReleaseGatesStatus = {
    all_green: allGreen,
    checks,
    checked_at: checkedAt,
  };

  // ── Trace audit : INSERT release_gates_runs (best-effort silencieux) ──────
  try {
    await env.DB.prepare(
      `INSERT INTO release_gates_runs (ran_by, all_green, payload) VALUES (?, ?, ?)`,
    )
      .bind(auth.userId, allGreen ? 1 : 0, JSON.stringify({ checks, checked_at: checkedAt }))
      .run();
  } catch {
    /* best-effort : table absente ou erreur D1 → silencieux */
  }

  return json({ data: status });
}

// Export pour usage tests (référence statut vide neutre).
export { EMPTY_GATES_STATUS };
