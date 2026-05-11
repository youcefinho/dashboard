// ── Module Reviews & Reputation — Intralys CRM ──────────────
import { Resend } from 'resend';
import type { Env } from './types';
import { sanitizeInput, json, audit, isLeadDnd } from './helpers';

// ── Review Requests ─────────────────────────────────────────

export async function handleGetReviewRequests(
  env: Env, _auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  const clientId = url.searchParams.get('client_id');
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let query = `SELECT rr.*, l.name as lead_name, l.email as lead_email
               FROM review_requests rr
               LEFT JOIN leads l ON rr.lead_id = l.id
               WHERE 1=1`;
  const params: (string | number)[] = [];

  if (clientId) { query += ' AND rr.client_id = ?'; params.push(clientId); }
  if (status) { query += ' AND rr.status = ?'; params.push(status); }
  query += ' ORDER BY rr.created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

export async function handleCreateReviewRequest(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as Record<string, unknown>;
  const leadId = body.lead_id as string;
  const channel = sanitizeInput(body.channel as string, 20) || 'email';
  const reviewUrl = sanitizeInput(body.review_url as string, 500);

  if (!leadId) return json({ error: 'lead_id requis' }, 400);
  if (!['email', 'sms'].includes(channel)) return json({ error: 'Canal invalide (email ou sms)' }, 400);

  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) return json({ error: 'Lead introuvable' }, 404);

  // Vérifier DND
  const dnd = await isLeadDnd(env, leadId, channel as 'email' | 'sms');
  if (dnd) return json({ error: `Envoi bloqué : DND activé pour ${channel}` }, 403);

  // Vérifier qu'on n'a pas déjà envoyé récemment (30 jours)
  const recent = await env.DB.prepare(
    "SELECT id FROM review_requests WHERE lead_id = ? AND created_at > datetime('now', '-30 days')"
  ).bind(leadId).first();
  if (recent) return json({ error: 'Demande déjà envoyée dans les 30 derniers jours' }, 409);

  const id = crypto.randomUUID();
  const clientId = lead.client_id as string;

  // Déterminer l'URL de review (Google Business Profile par défaut)
  let finalReviewUrl = reviewUrl;
  if (!finalReviewUrl) {
    const client = await env.DB.prepare('SELECT google_place_id FROM clients WHERE id = ?').bind(clientId).first() as { google_place_id?: string } | null;
    if (client?.google_place_id) {
      finalReviewUrl = `https://search.google.com/local/writereview?placeid=${client.google_place_id}`;
    }
  }

  await env.DB.prepare(
    `INSERT INTO review_requests (id, lead_id, client_id, channel, review_url)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, leadId, clientId, channel, finalReviewUrl || '').run();

  // Envoyer la demande
  const leadName = lead.name as string || '';
  if (channel === 'email' && env.RESEND_API_KEY && lead.email) {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com',
        to: [lead.email as string],
        subject: `${leadName}, votre avis compte pour nous !`,
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a2e;">⭐ Comment s'est passée votre expérience ?</h2>
            <p>Bonjour ${leadName},</p>
            <p>Merci de nous avoir fait confiance ! Votre avis nous aide à nous améliorer et à aider d'autres personnes comme vous.</p>
            <p>Cela ne prend que 30 secondes :</p>
            ${finalReviewUrl ? `
            <p style="text-align: center; margin: 30px 0;">
              <a href="${finalReviewUrl}" style="background: #f59e0b; color: #1a1a2e; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 18px;">
                ⭐⭐⭐⭐⭐ Laisser un avis
              </a>
            </p>
            ` : '<p style="text-align: center; font-size: 18px;">⭐⭐⭐⭐⭐</p>'}
            <p style="color: #666; font-size: 12px;">Votre avis est important pour nous.</p>
          </div>
        `,
      });
      await env.DB.prepare("UPDATE review_requests SET status = 'sent', sent_at = datetime('now') WHERE id = ?").bind(id).run();
    } catch (err) {
      console.error('Erreur envoi review request email:', err);
    }
  }

  await audit(env, auth.userId, 'review.request', 'review_request', id, { lead_id: leadId, channel });
  return json({ data: { id, status: 'sent' } }, 201);
}

// ── Bulk review request (pour leads signés) ─────────────────

export async function handleBulkReviewRequest(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { client_id?: string; review_url?: string };
  const clientId = body.client_id;

  // Trouver tous les leads signés sans demande récente
  let query = `SELECT l.id, l.name, l.email, l.client_id
               FROM leads l
               WHERE l.status = 'won'
               AND l.email IS NOT NULL AND l.email != ''
               AND (l.dnd = 0 OR l.dnd IS NULL)
               AND l.id NOT IN (
                 SELECT lead_id FROM review_requests WHERE created_at > datetime('now', '-30 days')
               )`;
  const params: string[] = [];
  if (clientId) { query += ' AND l.client_id = ?'; params.push(clientId); }
  query += ' LIMIT 50';

  const stmt = env.DB.prepare(query);
  const { results: leads } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  if (!leads || leads.length === 0) {
    return json({ data: { sent: 0, message: 'Aucun lead éligible' } });
  }

  let sent = 0;
  for (const lead of leads as Array<{ id: string; name: string; email: string; client_id: string }>) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO review_requests (id, lead_id, client_id, channel, review_url, status, sent_at)
       VALUES (?, ?, ?, 'email', ?, 'sent', datetime('now'))`
    ).bind(id, lead.id, lead.client_id, body.review_url || '').run();
    sent++;
  }

  await audit(env, auth.userId, 'review.bulk_request', 'review_request', 'bulk', { sent, client_id: clientId });
  return json({ data: { sent, total_eligible: leads.length } });
}

// ── Reviews cache (Google Business Profile) ─────────────────

export async function handleGetReviews(
  env: Env, _auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  const clientId = url.searchParams.get('client_id');
  const source = url.searchParams.get('source');
  const minRating = url.searchParams.get('min_rating');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let query = 'SELECT * FROM reviews_cache WHERE 1=1';
  const params: (string | number)[] = [];

  if (clientId) { query += ' AND client_id = ?'; params.push(clientId); }
  if (source) { query += ' AND source = ?'; params.push(source); }
  if (minRating) { query += ' AND rating >= ?'; params.push(parseInt(minRating)); }
  query += ' ORDER BY review_date DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

export async function handleGetReviewStats(
  env: Env, _auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  const clientId = url.searchParams.get('client_id');

  let whereClause = '1=1';
  const params: string[] = [];
  if (clientId) { whereClause += ' AND client_id = ?'; params.push(clientId); }

  const stmt = env.DB.prepare(`
    SELECT
      COUNT(*) as total_reviews,
      ROUND(AVG(rating), 1) as average_rating,
      SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
      SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
      SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
      SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
      SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star,
      SUM(CASE WHEN reply IS NOT NULL AND reply != '' THEN 1 ELSE 0 END) as replied_count,
      (SELECT COUNT(*) FROM review_requests rr WHERE ${clientId ? 'rr.client_id = ?' : '1=1'}) as total_requests,
      (SELECT COUNT(*) FROM review_requests rr WHERE rr.status = 'sent' ${clientId ? 'AND rr.client_id = ?' : ''}) as pending_requests
    FROM reviews_cache
    WHERE ${whereClause}
  `);
  const allParams = [...params, ...(clientId ? [clientId, clientId] : [])];
  const stats = allParams.length > 0 ? await stmt.bind(...allParams).first() : await stmt.first();

  return json({ data: stats || { total_reviews: 0, average_rating: 0 } });
}

// ── Suggestion AI de réponse aux reviews ────────────────────

export async function handleSuggestReviewReply(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { review_id: string };
  const review = await env.DB.prepare('SELECT * FROM reviews_cache WHERE id = ?').bind(body.review_id).first() as Record<string, unknown> | null;
  if (!review) return json({ error: 'Review introuvable' }, 404);

  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Clé API Anthropic non configurée' }, 500);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20250401',
        max_tokens: 300,
        system: `Tu es l'assistant d'une PME québécoise. Rédige une réponse courte, professionnelle et chaleureuse à un avis Google. Tutoie le client. Reste bref (3-4 phrases max). Ton québécois naturel.`,
        messages: [{ role: 'user', content: `Avis ${review.rating} étoiles de ${review.author_name}: "${review.comment || '(pas de commentaire)'}"\n\nRédige une réponse appropriée.` }],
      }),
    });

    const result = await resp.json() as { content?: Array<{ text: string }> };
    const suggestion = result.content?.[0]?.text || 'Impossible de générer une suggestion.';

    await audit(env, auth.userId, 'review.ai_suggest', 'review', body.review_id, { rating: review.rating });
    return json({ data: { suggestion } });
  } catch (err) {
    console.error('Erreur AI review reply:', err);
    return json({ error: 'Échec génération suggestion' }, 500);
  }
}

// ── Sauvegarder une réponse à un review ─────────────────────

export async function handleReplyToReview(
  request: Request, env: Env, auth: { userId: string; role: string }, reviewId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as { reply: string };
  if (!body.reply) return json({ error: 'Réponse requise' }, 400);

  await env.DB.prepare(
    "UPDATE reviews_cache SET reply = ?, reply_date = datetime('now') WHERE id = ?"
  ).bind(sanitizeInput(body.reply, 2000), reviewId).run();

  await audit(env, auth.userId, 'review.reply', 'review', reviewId, {});
  return json({ data: { success: true } });
}
