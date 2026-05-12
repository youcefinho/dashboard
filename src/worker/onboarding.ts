import type { Env } from './types';
import { json } from './helpers';

export async function handleCompleteOnboarding(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  try {
    const body = await request.json() as { 
      businessName?: string;
      businessType?: string;
      teamSize?: string;
      primaryColor?: string;
      packSlug?: string;
    };
    
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
