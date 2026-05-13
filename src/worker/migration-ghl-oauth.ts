import type { Env } from './types';
import { json } from './helpers';

// URL de base de l'OAuth GHL
const GHL_OAUTH_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

// ── Chiffrement AES-GCM pour les tokens ─────────────────────

async function deriveKey(tokenKeyStr: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const rawKey = encoder.encode(tokenKeyStr.padEnd(32, '0').slice(0, 32));
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plaintext: string, env: Env): Promise<string> {
  if (!env.TOKEN_KEY) return plaintext; // Fallback dev : pas de chiffrement
  const key = await deriveKey(env.TOKEN_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // Préfixer l'IV (12 octets) au ciphertext, encoder le tout en base64
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptToken(ciphertextB64: string, env: Env): Promise<string> {
  if (!env.TOKEN_KEY) return ciphertextB64; // Fallback dev : pas de chiffrement
  const key = await deriveKey(env.TOKEN_KEY);
  const combined = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// ── State CSRF helpers ──────────────────────────────────────

async function storeState(env: Env, stateKey: string, stateData: string): Promise<void> {
  if (env.STATE_STORE) {
    await env.STATE_STORE.put(stateKey, stateData, { expirationTtl: 600 }); // 10min
  }
  // Pas de fallback in-memory en prod — le KV est requis pour la sécurité CSRF
}

async function consumeState(env: Env, stateKey: string): Promise<string | null> {
  if (!env.STATE_STORE) return null;
  const value = await env.STATE_STORE.get(stateKey);
  if (value) {
    await env.STATE_STORE.delete(stateKey); // One-time use
  }
  return value;
}

// ── OAuth Start ─────────────────────────────────────────────

export async function handleGhlOauthStart(
  _request: Request, env: Env, auth: { role: string; userId: string }, url: URL
): Promise<Response> {
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const clientId = url.searchParams.get('client_id');
  if (!clientId) {
    return json({ error: 'client_id requis' }, 400);
  }

  const ghlClientId = env.GHL_CLIENT_ID;
  const redirectUri = env.GHL_REDIRECT_URI || `${url.origin}/api/migration/ghl/oauth/callback`;

  if (!ghlClientId) {
    return json({ error: 'GHL_CLIENT_ID non configuré sur le serveur' }, 500);
  }

  // Générer un nonce CSRF sécurisé
  const nonce = crypto.randomUUID();
  const stateData = JSON.stringify({ client_id: clientId, user_id: auth.userId, nonce });
  const stateKey = `oauth_state:${nonce}`;

  // Stocker dans KV avec TTL 10min
  await storeState(env, stateKey, stateData);

  // Le state envoyé à GHL contient uniquement le nonce (pas les données en clair)
  const state = btoa(JSON.stringify({ nonce }));

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

// ── OAuth Callback ──────────────────────────────────────────

export async function handleGhlOauthCallback(
  _request: Request, env: Env, url: URL
): Promise<Response> {
  const code = url.searchParams.get('code');
  const stateBase64 = url.searchParams.get('state');

  if (!code || !stateBase64) {
    return json({ error: 'Paramètres manquants (code ou state)' }, 400);
  }

  // Extraire le nonce du state
  let statePayload: { nonce: string };
  try {
    statePayload = JSON.parse(atob(stateBase64));
  } catch {
    return json({ error: 'State invalide' }, 400);
  }

  if (!statePayload.nonce) {
    return json({ error: 'State invalide — nonce manquant' }, 400);
  }

  // Valider le nonce via KV (one-time use)
  const stateKey = `oauth_state:${statePayload.nonce}`;
  const storedState = await consumeState(env, stateKey);

  if (!storedState) {
    return json({ error: 'Invalid state — possible CSRF ou state expiré' }, 403);
  }

  // Extraire les données originales du state stocké en KV
  let stateData: { client_id: string; user_id: string; nonce: string };
  try {
    stateData = JSON.parse(storedState);
  } catch {
    return json({ error: 'Données state corrompues' }, 400);
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
      user_type: 'Location'
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

  // Chiffrer les tokens avant stockage
  const encAccessToken = await encryptToken(tokenData.access_token, env);
  const encRefreshToken = await encryptToken(tokenData.refresh_token, env);
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
    clientId, locationId, encAccessToken, encRefreshToken, expiresAt
  ).run();

  return Response.redirect(`${url.origin}/admin/settings?ghl_connected=true`, 302);
}

// ── Cron Refresh Token ──────────────────────────────────────

export async function refreshExpiringGhlTokens(env: Env): Promise<void> {
  // Trouver tous les tokens qui expirent dans l'heure
  const { results } = await env.DB.prepare(
    "SELECT client_id, refresh_token FROM ghl_tokens WHERE expires_at < datetime('now', '+1 hour')"
  ).all();

  if (!results || results.length === 0) return;

  const ghlClientId = env.GHL_CLIENT_ID;
  const ghlClientSecret = env.GHL_CLIENT_SECRET;
  if (!ghlClientId || !ghlClientSecret) return;

  for (const row of results) {
    const record = row as { client_id: string; refresh_token: string };
    try {
      // Déchiffrer le refresh token
      const refreshToken = await decryptToken(record.refresh_token, env);

      const resp = await fetch(GHL_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          client_id: ghlClientId,
          client_secret: ghlClientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          user_type: 'Location'
        })
      });

      if (!resp.ok) {
        console.error(`GHL Refresh Token Error pour ${record.client_id}: ${resp.status}`);
        continue;
      }

      const data = await resp.json() as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      const encAccess = await encryptToken(data.access_token, env);
      const encRefresh = await encryptToken(data.refresh_token, env);
      const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

      await env.DB.prepare(
        `UPDATE ghl_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now') WHERE client_id = ?`
      ).bind(encAccess, encRefresh, expiresAt, record.client_id).run();
    } catch (e) {
      console.error(`Erreur refresh GHL token pour ${record.client_id}: ${e}`);
    }
  }
}
