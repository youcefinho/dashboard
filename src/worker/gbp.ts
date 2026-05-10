// ── Module Google Business Profile — Intralys CRM ───────────
import type { Env } from './types';
import { json } from './helpers';

export async function handleGbpReviews(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  if (!env.GBP_API_KEY) return json({ error: 'GBP_API_KEY non configurée' }, 500);
  const accountId = url.searchParams.get('account_id');
  const locationId = url.searchParams.get('location_id');
  if (!accountId || !locationId) return json({ error: 'account_id et location_id requis' }, 400);
  const pageSize = url.searchParams.get('page_size') || '20';
  const apiUrl = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews?pageSize=${pageSize}&key=${env.GBP_API_KEY}`;
  const res = await fetch(apiUrl);
  const data = await res.json() as { reviews?: Array<Record<string, unknown>>; averageRating?: number; totalReviewCount?: number; error?: unknown };
  if (data.error) return json({ error: 'Erreur Google Business Profile', details: data.error }, 502);
  return json({ data: { reviews: data.reviews || [], average_rating: data.averageRating || 0, total_count: data.totalReviewCount || 0 } });
}

export async function handleGbpStats(env: Env, auth: { role: string }): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  if (!env.GBP_API_KEY) return json({ error: 'GBP_API_KEY non configurée' }, 500);
  const res = await fetch(`https://mybusiness.googleapis.com/v4/accounts?key=${env.GBP_API_KEY}`);
  const data = await res.json() as { accounts?: Array<{ name: string; accountName: string }> };
  return json({ data: { accounts: (data.accounts || []).map(a => ({ id: a.name, name: a.accountName })), note: 'Utilisez /api/gbp/reviews?account_id=...&location_id=... pour voir les avis' } });
}
