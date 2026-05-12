import type { Env } from './types';
import { json } from './helpers';

export async function handleFeedback(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  try {
    const body = await request.json() as { rating: number; comment?: string };
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO feedback (id, user_id, rating, comment) VALUES (?, ?, ?, ?)`
    ).bind(id, auth.userId, body.rating, body.comment || '').run();
    return json({ data: { success: true } }, 201);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

export async function handleNps(request: Request, env: Env, auth: { userId: string }): Promise<Response> {
  try {
    const body = await request.json() as { score: number; comment?: string };
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO nps_responses (id, user_id, score, comment) VALUES (?, ?, ?, ?)`
    ).bind(id, auth.userId, body.score, body.comment || '').run();
    return json({ data: { success: true } }, 201);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}
