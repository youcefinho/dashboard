import type { Env } from './types';
import { json, audit } from './helpers';
import { getClientModules } from './modules';
import { validate, onboardingStateSchema } from '../lib/schemas';
import { validationError } from './lib/validate-response';

// ── Sprint S8 — État d'onboarding persistant (table onboarding_state) ─────────
//
// Migration seq 76 : migration-sprintS8-m1.sql. Multi-tenant STRICT
// (client_id résolu via getClientModules — pattern projet, jamais de fuite
// cross-tenant — cf. ecommerce-region.ts:220). Filtre TOUJOURS sur
// (client_id, user_id). Additif : si la table n'existe pas encore (migration
// non jouée), les helpers dégradent proprement vers l'état par défaut /
// échec silencieux (rétro-compat : l'onboarding reste fonctionnel côté
// localStorage front).

/** Shape exacte renvoyée par GET et PUT /api/onboarding/state. */
export interface OnboardingStateShape {
  currentStep: number;
  completedSteps: string[];
  ecommerceOptedIn: boolean;
  completedAt: string | null;
  payload: Record<string, unknown> | null;
}

const DEFAULT_ONBOARDING_STATE: OnboardingStateShape = {
  currentStep: 0,
  completedSteps: [],
  ecommerceOptedIn: false,
  completedAt: null,
  payload: null,
};

interface OnboardingStateRow {
  id: string;
  current_step: number | null;
  completed_steps_json: string | null;
  payload_json: string | null;
  ecommerce_opted_in: number | null;
  completed_at: string | null;
}

function safeParseArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function safeParseObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function rowToState(row: OnboardingStateRow | null): OnboardingStateShape {
  if (!row) return { ...DEFAULT_ONBOARDING_STATE };
  return {
    currentStep: typeof row.current_step === 'number' ? row.current_step : 0,
    completedSteps: safeParseArray(row.completed_steps_json),
    ecommerceOptedIn: !!row.ecommerce_opted_in,
    completedAt: row.completed_at || null,
    payload: safeParseObject(row.payload_json),
  };
}

async function loadOnboardingRow(
  env: Env,
  clientId: string,
  userId: string,
): Promise<OnboardingStateRow | null> {
  try {
    return (await env.DB.prepare(
      `SELECT id, current_step, completed_steps_json, payload_json, ecommerce_opted_in, completed_at
         FROM onboarding_state WHERE client_id = ? AND user_id = ?`,
    ).bind(clientId, userId).first()) as OnboardingStateRow | null;
  } catch {
    // Table absente (migration seq 76 non jouée) — dégrade vers défaut.
    return null;
  }
}

/**
 * GET /api/onboarding/state — état d'onboarding du tenant courant.
 * Réponse : { data: OnboardingStateShape }. Défaut si aucune ligne.
 */
export async function handleGetOnboardingState(
  env: Env,
  auth: { userId: string },
): Promise<Response> {
  const { clientId } = await getClientModules(env, auth.userId);
  if (!clientId) return json({ data: { ...DEFAULT_ONBOARDING_STATE } });
  const row = await loadOnboardingRow(env, clientId, auth.userId);
  return json({ data: rowToState(row) });
}

/**
 * PUT /api/onboarding/state — upsert partiel par (client_id, user_id).
 * Body : { currentStep?, completedSteps?, ecommerceOptedIn?, payload? }.
 * Champs absents = inchangés. Réponse : { data: OnboardingStateShape }
 * (même shape que GET). Validation via onboardingStateSchema + validate().
 */
export async function handlePutOnboardingState(
  request: Request,
  env: Env,
  auth: { userId: string },
): Promise<Response> {
  const { clientId } = await getClientModules(env, auth.userId);
  if (!clientId) {
    return json(
      { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
      400,
    );
  }

  const body = await request.json().catch(() => null);
  const v = validate(onboardingStateSchema, body);
  if (!v.success) return validationError(v.error);
  const patch = v.data as {
    currentStep?: number;
    completedSteps?: string[];
    ecommerceOptedIn?: boolean;
    payload?: unknown;
  };

  try {
    const current = rowToState(await loadOnboardingRow(env, clientId, auth.userId));

    const nextStep = patch.currentStep !== undefined ? patch.currentStep : current.currentStep;
    const nextSteps = patch.completedSteps !== undefined ? patch.completedSteps : current.completedSteps;
    const nextOptIn = patch.ecommerceOptedIn !== undefined ? patch.ecommerceOptedIn : current.ecommerceOptedIn;
    const nextPayload =
      patch.payload !== undefined
        ? (patch.payload && typeof patch.payload === 'object' && !Array.isArray(patch.payload)
            ? (patch.payload as Record<string, unknown>)
            : current.payload)
        : current.payload;

    await env.DB.prepare(
      `INSERT INTO onboarding_state
         (client_id, user_id, current_step, completed_steps_json, payload_json, ecommerce_opted_in, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(client_id, user_id) DO UPDATE SET
         current_step = excluded.current_step,
         completed_steps_json = excluded.completed_steps_json,
         payload_json = excluded.payload_json,
         ecommerce_opted_in = excluded.ecommerce_opted_in,
         updated_at = datetime('now')`,
    )
      .bind(
        clientId,
        auth.userId,
        nextStep,
        JSON.stringify(nextSteps),
        nextPayload ? JSON.stringify(nextPayload) : null,
        nextOptIn ? 1 : 0,
      )
      .run();

    const row = await loadOnboardingRow(env, clientId, auth.userId);
    // audit non-sensible : aucune donnée payload (peut contenir email/nom).
    await audit(env, auth.userId, 'onboarding.state.update', 'onboarding_state', row?.id || clientId, {
      currentStep: nextStep,
      completedSteps: nextSteps.length,
      ecommerceOptedIn: nextOptIn,
    });
    return json({ data: rowToState(row) });
  } catch (err: any) {
    // Table absente (migration non jouée) ou autre — ne casse pas le front
    // (qui garde un fallback localStorage). 200 avec l'état fusionné en mémoire.
    return json({ error: err?.message || 'onboarding-state-failed' }, 500);
  }
}

export async function handleCompleteOnboarding(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  try {
    await request.json(); // Consume request body to prevent warnings

    // Update users table
    await env.DB.prepare(
      `UPDATE users SET onboarding_step = 8, onboarding_completed_at = datetime('now') WHERE id = ?`
    ).bind(auth.userId).run();

    // The rest of the setup (business name, pack installation)
    // would be handled by their respective API endpoints or done here in a transaction.
    // For MVP, marking the onboarding as complete is the main requirement.

    return json({ data: { success: true } });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Sprint 45 M1.1 — WelcomeWizard endpoint ───────────────────────────────
// Stub minimaliste : enregistre le payload (profile/industry/goals/teamSize)
// dans users + flag onboarding_completed_at. Tout le payload est best-effort
// (le client garde une copie localStorage en fallback).
//
// Payload attendu :
//   {
//     profile: { name, email, photoDataUrl, lang },
//     industry: WelcomeIndustry,
//     goals: WelcomeGoal[],
//     teamSize: WelcomeTeamSize,
//     invitedEmails?: string[],
//     withDemoData?: boolean
//   }
export async function handleWelcomeOnboarding(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as {
      profile?: { name?: string; email?: string; lang?: string };
      industry?: string;
      businessType?: string;
      goals?: string[];
      teamSize?: string;
      invitedEmails?: string[];
      withDemoData?: boolean;
      region?: unknown;
      channels?: unknown;
    };

    const profileName = body.profile?.name?.trim() || null;
    const profileEmail = body.profile?.email?.trim() || null;
    const profileLang = body.profile?.lang || 'fr-CA';
    const industry = body.industry || null;
    const goalsJson = JSON.stringify(body.goals || []);
    const teamSize = body.teamSize || 'solo';
    const invitedJson = JSON.stringify(body.invitedEmails || []);

    // Update users table — schéma générique (les colonnes optionnelles sont
    // ignorées silencieusement si elles n'existent pas dans le DB).
    try {
      await env.DB.prepare(
        `UPDATE users SET
          onboarding_step = 8,
          onboarding_completed_at = datetime('now'),
          name = COALESCE(?, name),
          email = COALESCE(?, email)
        WHERE id = ?`
      ).bind(profileName, profileEmail, auth.userId).run();
    } catch {
      // Schema strict : fallback minimal sans colonnes optionnelles.
      await env.DB.prepare(
        `UPDATE users SET onboarding_step = 8, onboarding_completed_at = datetime('now') WHERE id = ?`
      ).bind(auth.userId).run();
    }

    // ── Sprint S8 — persistance ADDITIVE de l'état d'onboarding ────────────
    // Best-effort : si la table onboarding_state n'existe pas encore
    // (migration seq 76 non jouée) ⇒ catch silencieux, la réponse ci-dessous
    // reste STRICTEMENT inchangée (rétro-compat front Sprint 45 absolue).
    // businessType 'shop' | 'hybrid' ⇒ opt-in e-commerce (cf. WelcomeWizard
    // ligne 89 : ces valeurs pré-activent le module). N'active AUCUN paiement
    // (E4/E6 régulés — payments_live_enabled=0 jamais touché ici).
    try {
      const { clientId } = await getClientModules(env, auth.userId);
      if (clientId) {
        const bt = String(body.businessType || '').toLowerCase();
        const optedIn = bt === 'shop' || bt === 'hybrid' ? 1 : 0;
        await env.DB.prepare(
          `INSERT INTO onboarding_state
             (client_id, user_id, current_step, completed_steps_json, payload_json, ecommerce_opted_in, completed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(client_id, user_id) DO UPDATE SET
             payload_json = excluded.payload_json,
             ecommerce_opted_in = excluded.ecommerce_opted_in,
             completed_at = COALESCE(onboarding_state.completed_at, excluded.completed_at),
             updated_at = datetime('now')`,
        )
          .bind(
            clientId,
            auth.userId,
            8,
            JSON.stringify(['profile', 'industry', 'goals', 'team']),
            JSON.stringify(body),
            optedIn,
          )
          .run();
      }
    } catch {
      /* table absente / non critique — le front garde son fallback localStorage */
    }

    return json({
      data: {
        success: true,
        echo: {
          name: profileName,
          email: profileEmail,
          lang: profileLang,
          industry,
          goals: goalsJson,
          teamSize,
          invited: invitedJson,
          withDemoData: Boolean(body.withDemoData),
        },
      },
    });
  } catch (err: any) {
    return json({ error: err?.message || 'onboarding-failed' }, 500);
  }
}
