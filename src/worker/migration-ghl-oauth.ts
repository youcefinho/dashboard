import type { Env } from './types';
import { json } from './helpers';

// URL de base de l'OAuth GHL
const GHL_OAUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

export async function handleGhlOauthStart(
  _request: Request, env: Env, auth: { role: string; userId: string }, url: URL
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  // Si on est en localhost, on a besoin du bon clientId
  const clientId = url.searchParams.get('client_id');
  if (!clientId) {
    return json({ error: 'client_id requis' }, 400);
  }

  const ghlClientId = env.GHL_CLIENT_ID;
  const redirectUri = env.GHL_REDIRECT_URI || `${url.origin}/api/migration/ghl/oauth/callback`;

  if (!ghlClientId) {
    return json({ error: 'GHL_CLIENT_ID non configuré sur le serveur' }, 500);
  }

  // Générer un state pour la sécurité et pour passer le client_id
  const stateData = { client_id: clientId, user_id: auth.userId, nonce: crypto.randomUUID() };
  const state = btoa(JSON.stringify(stateData)); // Base64 encoding simple

  const scopes = [
    'contacts.readonly',
    'conversations.readonly',
    'opportunities.readonly',
    'calendars.readonly',
    'calendars/events.readonly'
  ].join(' ');

  const authUrl = `${GHL_OAUTH_URL}?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${ghlClientId}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;

  return Response.redirect(authUrl, 302);
}

export async function handleGhlOauthCallback(
  _request: Request, env: Env, url: URL
): Promise<Response> {
  const code = url.searchParams.get('code');
  const stateBase64 = url.searchParams.get('state');

  if (!code || !stateBase64) {
    return json({ error: 'Paramètres manquants (code ou state)' }, 400);
  }

  let stateData: { client_id: string; user_id: string; nonce: string };
  try {
    stateData = JSON.parse(atob(stateBase64));
  } catch (e) {
    return json({ error: 'State invalide' }, 400);
  }

  const clientId = stateData.client_id;
  const ghlClientId = env.GHL_CLIENT_ID;
  const ghlClientSecret = env.GHL_CLIENT_SECRET;
  const redirectUri = env.GHL_REDIRECT_URI || `${url.origin}/api/migration/ghl/oauth/callback`;

  if (!ghlClientId || !ghlClientSecret) {
    return json({ error: 'Configuration GHL manquante sur le serveur' }, 500);
  }

  // Échanger le code contre un access token
  const tokenResp = await fetch(GHL_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({
      client_id: ghlClientId,
      client_secret: ghlClientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      user_type: 'Location' // Important pour obtenir un token de niveau Location
    })
  });

  if (!tokenResp.ok) {
    const errorText = await tokenResp.text();
    console.error(`GHL Token Error: ${tokenResp.status} ${errorText}`);
    return json({ error: `Erreur lors de l'échange du token: ${tokenResp.status}` }, 400);
  }

  const tokenData = await tokenResp.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    locationId?: string;
  };

  const locationId = tokenData.locationId;
  if (!locationId) {
    return json({ error: 'Location ID manquant dans la réponse token GHL' }, 400);
  }

  // Sauvegarder dans la base de données
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO ghl_tokens (client_id, location_id, access_token, refresh_token, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_id) DO UPDATE SET
    location_id = excluded.location_id,
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    expires_at = excluded.expires_at,
    updated_at = datetime('now')
  `).bind(
    clientId, locationId, tokenData.access_token, tokenData.refresh_token, expiresAt
  ).run();

  // Rediriger vers le dashboard (Paramètre optionnel ou fixe)
  // Dans un cas réel, on renverrait vers une page de succès du dashboard
  return Response.redirect(`${url.origin}/admin/settings?ghl_connected=true`, 302);
}
