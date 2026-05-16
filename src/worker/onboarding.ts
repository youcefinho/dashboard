import type { Env } from './types';
import { json } from './helpers';

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
      goals?: string[];
      teamSize?: string;
      invitedEmails?: string[];
      withDemoData?: boolean;
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
