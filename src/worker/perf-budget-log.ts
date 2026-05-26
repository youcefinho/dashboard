// ── Sprint 25 — Perf : log budget côté worker (best-effort) ────────────────
// Appelé depuis le handler POST /api/telemetry/web-vitals existant. Lit la
// metric reçue, compare au budget, console.warn + audit_log si rating poor.
// NE BLOQUE JAMAIS la réponse (déjà 200 instantané côté handler).
//
// Note signature audit() : `audit(env, userId, action, resourceType, resourceId, details)`
// → resourceId est typé `string` (pas nullable). On passe `''` (chaîne vide)
// quand on n'a pas d'ID concret — convention déjà utilisée ailleurs dans le
// worker pour audits "non liés à une ressource précise".

import type { Env } from './types';
import { checkVitalBudget, type WebVitalName } from '../lib/perf-budgets';
import { audit } from './helpers';

const TRACKED: ReadonlySet<WebVitalName> = new Set<WebVitalName>(['LCP', 'CLS', 'INP']);

interface WebVitalPayload {
  name: string;
  value: number;
  rating?: string;
  navigationType?: string;
}

export async function logPerfBudget(
  env: Env,
  payload: WebVitalPayload,
  userId?: string,
): Promise<void> {
  try {
    if (!TRACKED.has(payload.name as WebVitalName)) return;
    const result = checkVitalBudget(payload.name as WebVitalName, payload.value);
    if (result.severity === 'fail') {
      // eslint-disable-next-line no-console
      console.warn('[PerfBudget] FAIL', payload.name, payload.value, 'budget:', result.budget);
      try {
        await audit(
          env,
          userId ?? 'system',
          'perf.budget_exceeded',
          'web_vitals',
          '',
          { name: payload.name, value: payload.value, url: payload.navigationType },
        );
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* never throws */
  }
}
