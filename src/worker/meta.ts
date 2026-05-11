// ── Module Meta — Intralys CRM ──────────────────────────────
import type { Env } from './types';
import { json } from './helpers';
import { mockMetaSendMessage } from './mocks/mock-meta';

export async function handleMetaOauthStart(env: Env, auth: { role: string }, url: URL): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  
  if (env.USE_MOCKS === 'true') {
    // Mode dev : redirect direct avec un code mock
    return Response.redirect(`${url.origin}/api/meta/oauth/callback?code=mock_code_123&state=mock_state`, 302);
  }

  if (!env.META_APP_ID) return json({ error: 'META_APP_ID manquant' }, 500);
  
  const redirectUri = encodeURIComponent(`${url.origin}/api/meta/oauth/callback`);
  const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${env.META_APP_ID}&redirect_uri=${redirectUri}&state=intralys_oauth&scope=pages_manage_metadata,pages_read_engagement,pages_messaging,instagram_basic,instagram_manage_messages`;
  
  return Response.redirect(oauthUrl, 302);
}

export async function handleMetaOauthCallback(request: Request, env: Env, _auth: { userId: string }): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return json({ error: 'Code OAuth manquant' }, 400);

  // Todo : Extraire client_id du state ou via l'auth user si admin d'un client spécifique
  // Pour le MVP on va supposer client_id = demo_client_1 (ou le 1er dispo)
  const client = await env.DB.prepare('SELECT id FROM clients LIMIT 1').first() as { id: string } | null;
  const clientId = client?.id || 'demo-client';

  let accessToken = '';
  let pageId = '';
  let pageName = '';
  let igBusinessId = '';

  if (env.USE_MOCKS === 'true') {
    accessToken = 'mock_access_token';
    pageId = 'mock_page_id';
    pageName = 'Mock Facebook Page';
    igBusinessId = 'mock_ig_id';
  } else {
    if (!env.META_APP_ID || !env.META_APP_SECRET) return json({ error: 'Clés Meta manquantes' }, 500);
    const redirectUri = `${url.origin}/api/meta/oauth/callback`;
    
    // Echange code contre access_token
    const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${env.META_APP_ID}&redirect_uri=${redirectUri}&client_secret=${env.META_APP_SECRET}&code=${code}`);
    const tokenData = await tokenRes.json() as { access_token: string };
    accessToken = tokenData.access_token;
    
    // Obtenir la page de l'utilisateur (simplifié pour le MVP)
    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`);
    const pagesData = await pagesRes.json() as { data?: Array<{ id: string; name: string; access_token: string }> };
    
    if (pagesData.data && pagesData.data.length > 0) {
      const firstPage = pagesData.data[0]!;
      pageId = firstPage.id;
      pageName = firstPage.name;
      accessToken = firstPage.access_token; // Page access token
      
      // Obtenir IG business ID si dispo
      const igRes = await fetch(`https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`);
      const igData = await igRes.json() as { instagram_business_account?: { id: string } };
      igBusinessId = igData.instagram_business_account?.id || '';
    }
  }

  if (!pageId) return json({ error: 'Aucune page Facebook trouvée' }, 400);

  // Enregistrer dans la DB
  await env.DB.prepare(
    `INSERT INTO meta_connections (id, client_id, platform, page_id, page_name, access_token_encrypted, ig_business_id)
     VALUES (?, ?, 'facebook', ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), clientId, pageId, pageName, accessToken, igBusinessId).run();

  // Redirect to integrations page
  return Response.redirect(`${url.origin}/integrations?success=meta`, 302);
}

export async function handleMetaWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  
  // Validation Webhook Meta (GET)
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    
    if (mode === 'subscribe' && token === env.WEBHOOK_SECRET) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  
  // Réception Webhook (POST)
  if (request.method === 'POST') {
    // Vérification signature X-Hub-Signature-256 (omis ici pour simplifier le MVP)
    const body = await request.json() as any;
    
    if (body.object === 'page') {
      for (const entry of body.entry) {
        const pageId = entry.id;
        for (const messaging of entry.messaging) {
          if (messaging.message) {
            const senderPsid = messaging.sender.id;
            const messageText = messaging.message.text;
            
            // Trouver la connexion Meta via pageId
            const conn = await env.DB.prepare('SELECT client_id FROM meta_connections WHERE page_id = ?').bind(pageId).first() as { client_id: string } | null;
            if (conn) {
              if (env.USE_MOCKS === 'true') {
                const { mockMetaWebhookInbound } = await import('./mocks/mock-meta');
                await mockMetaWebhookInbound(env, conn.client_id, 'facebook', senderPsid, messageText);
              } else {
                // Logique réelle : récupérer nom du profil public puis INSERT message
                // Meta inbound message reçu
              }
            }
          }
        }
      }
      return new Response('EVENT_RECEIVED', { status: 200 });
    } else {
      return new Response('NOT_FOUND', { status: 404 });
    }
  }
  
  return new Response('Method Not Allowed', { status: 405 });
}

export async function sendMetaMessage(env: Env, leadId: string, clientId: string, text: string, platform: 'facebook'|'instagram', authUserId: string) {
  if (env.USE_MOCKS === 'true') {
    return mockMetaSendMessage(env, leadId, clientId, text, platform, authUserId);
  }
  
  const conn = await env.DB.prepare('SELECT access_token_encrypted FROM meta_connections WHERE client_id = ? AND platform = ? AND is_active = 1').bind(clientId, platform).first() as { access_token_encrypted: string } | null;
  if (!conn) throw new Error('Meta non connecté');
  
  const lead = await env.DB.prepare('SELECT external_id FROM leads WHERE id = ?').bind(leadId).first() as { external_id: string } | null;
  if (!lead?.external_id) throw new Error('Lead non associé à un profil Meta');
  
  const res = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${conn.access_token_encrypted}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: lead.external_id },
      message: { text }
    })
  });
  
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.message);
  
  // Appeler la DB pour enregistrer (idem mock)
  const { findOrCreateConversation } = await import('./conversations');
  const convId = await findOrCreateConversation(env, leadId, clientId, platform);
  
  await env.DB.prepare(
    `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, body, status, sent_by, external_id)
     VALUES (?, ?, ?, ?, 'outbound', ?, ?, 'delivered', ?, ?)`
  ).bind(
    crypto.randomUUID(), leadId, clientId, convId, platform, text, authUserId, data.message_id
  ).run();
  
  return { success: true, message_id: data.message_id };
}
