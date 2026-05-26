// ── gbp-oauth.ts — Sprint 32 Google Business Profile OAuth dédié ─────────────
//
// Flow OAuth Google Business Profile ISOLÉ du LOT G4 OAuth natives
// (oauth.ts gère google/slack pour Calendar). Endpoint/scopes/redirect_uri
// distincts pour ne pas mélanger avec le flow Google Calendar :
//   - Scope : https://www.googleapis.com/auth/business.manage
//   - Redirect : /api/gbp/oauth/callback (whitelist callback indépendante)
//   - Stockage tokens : oauth_connections.provider = 'google_business'
//   - Lien metier : gbp_connections (oauth_connection_id) — peuplé ici à
//     l'INSERT, gbp_account_id/name peuplés async par listGbpAccounts (A2).
//
// Conventions CALQUÉES sur oauth.ts handleOauthAuthorize/handleOauthCallback :
//   - State CSRF via env.STATE_STORE KV (TTL 600s, one-time, anti-replay).
//   - Tokens CHIFFRÉS AES-GCM via encryptToken/decryptToken (réutilisés
//     migration-ghl-oauth.ts) — env.TOKEN_KEY (fallback clair documenté).
//   - Capability 'settings.manage' au start (capGuard).
//   - Bornage tenant STRICT : client_id depuis auth (start) puis depuis state
//     (callback) — JAMAIS le body.
//   - Provider non configuré (GBP_OAUTH_CLIENT_ID/SECRET absents) :
//     - authorize → json({ error }, 400)
//     - callback → redirect /settings/integrations?gbp=error&reason=not_configured
//   - Redirect frontend : /settings/integrations?gbp=connected
//                       | /settings/integrations?gbp=error&reason=...

import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { encryptToken } from './migration-ghl-oauth';

// Auth enrichi au choke-point (worker.ts), même type que oauth.ts:OauthAuth.
export type GbpAuth = CapAuth & { capabilities?: Set<string> };

// ── Config OAuth Google Business Profile (constants figées). ────────────────
const GBP_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GBP_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

// ── Flag d'activation : credentials env GBP_OAUTH_*. Distincts de
//    GOOGLE_OAUTH_* (G4 Calendar) pour permettre une app Google séparée et
//    une révocation indépendante. Absents → provider non configuré. ─────────
function gbpCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  // Env typed via cast — types.ts ne déclare pas encore GBP_OAUTH_* (ajout
  // hors-scope agent A3). Lecture défensive : strings non-vides requises.
  const e = env as unknown as {
    GBP_OAUTH_CLIENT_ID?: string;
    GBP_OAUTH_CLIENT_SECRET?: string;
  };
  if (!e.GBP_OAUTH_CLIENT_ID || !e.GBP_OAUTH_CLIENT_SECRET) return null;
  return { clientId: e.GBP_OAUTH_CLIENT_ID, clientSecret: e.GBP_OAUTH_CLIENT_SECRET };
}

// ── Garde capability (settings.manage — aucun ajout à ALL_CAPABILITIES). ────
function capGuard(auth: GbpAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

// ── Résolution tenant STRICTE depuis l'auth (jamais body). ──────────────────
function tenantOf(auth: GbpAuth): { clientId: string | null; agencyId: string | null } {
  return {
    clientId: auth.tenant?.clientId ?? auth.clientId ?? null,
    agencyId: auth.tenant?.agencyId ?? null,
  };
}

// ── redirect_uri canonique GBP (origin courant + préfixe figé worker.ts). ───
function redirectUri(origin: string): string {
  return `${origin}/api/gbp/oauth/callback`;
}

// ── Forme persistée dans STATE_STORE (KV). Porte le tenant — JAMAIS body. ───
interface GbpOauthState {
  client_id: string;
  agency_id: string | null;
  origin: string;
}

// ── Échange code → tokens (normalisé Google OAuth2 standard). ───────────────
interface GbpTokenExchange {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scopes: string;
  account_email: string;
}

async function exchangeCode(
  code: string,
  creds: { clientId: string; clientSecret: string },
  redirect: string,
): Promise<GbpTokenExchange | null> {
  const resp = await fetch(GBP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) return null;
  const d = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  };
  if (d.error || !d.access_token) return null;
  // account_email via userinfo (best-effort — n'échoue pas l'échange).
  let email = '';
  try {
    const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${d.access_token}` },
    });
    if (ui.ok) {
      const u = (await ui.json()) as { email?: string };
      email = u.email || '';
    }
  } catch {
    /* userinfo best-effort */
  }
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token || '',
    expires_in: d.expires_in || 3600,
    scopes: d.scope || GBP_SCOPE,
    account_email: email,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  HANDLERS — exposés à worker.ts (signatures FIGÉES).
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/gbp/oauth/start (PROTÉGÉ, capability settings.manage) ──────────
//    Génère l'URL d'autorisation Google Business Profile + nonce CSRF en KV
//    (state porte le tenant, JAMAIS body), redirige 302 vers Google.
//    Provider non configuré ⇒ json({ error }, 400) — JAMAIS 500.
export async function handleGbpAuthorize(
  request: Request,
  env: Env,
  auth: GbpAuth,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const creds = gbpCredentials(env);
  if (!creds) {
    return json({ error: 'Intégration Google Business Profile non configurée' }, 400);
  }

  const { clientId, agencyId } = tenantOf(auth);
  if (!clientId) return json({ error: 'Tenant non résolu' }, 400);

  if (!env.STATE_STORE) {
    return json({ error: 'Stockage state OAuth indisponible' }, 503);
  }

  // Nonce CSRF one-time (KV, TTL 600s) — deux randomUUID pour entropie.
  const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const url = new URL(request.url);
  const statePayload: GbpOauthState = {
    client_id: clientId,
    agency_id: agencyId,
    origin: url.origin,
  };
  await env.STATE_STORE.put(`gbp_oauth_state:${nonce}`, JSON.stringify(statePayload), {
    expirationTtl: 600,
  });

  const redirect = redirectUri(url.origin);

  // Google : access_type=offline + prompt=consent → refresh_token garanti.
  const authUrl =
    `${GBP_AUTH_URL}?client_id=${encodeURIComponent(creds.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(GBP_SCOPE)}` +
    `&access_type=offline&prompt=consent` +
    `&state=${encodeURIComponent(nonce)}`;

  return Response.redirect(authUrl, 302);
}

// ── GET /api/gbp/oauth/callback (PUBLIC hors-try — retour navigateur) ───────
//    Valide state KV one-time (tenant extrait du state, jamais cross-tenant),
//    échange le code, chiffre les tokens (encryptToken), upsert
//    oauth_connections (provider='google_business') borné client_id du state,
//    INSERT gbp_connections (oauth_connection_id, gbp_account_id NULL pour
//    l'instant), trigger ASYNC listGbpAccounts (best-effort — peuplé plus
//    tard si A2 dispo). Redirige TOUJOURS vers /settings/integrations.
export async function handleGbpCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  // Retour navigateur : on redirige TOUJOURS vers /settings/integrations
  // (succès ou erreur via ?gbp=error&reason=), jamais de 500 brut.
  const back = (qs: string) =>
    Response.redirect(`${url.origin}/settings/integrations?${qs}`, 302);

  const creds = gbpCredentials(env);
  if (!creds) {
    // Flag INACTIF : no-op (zéro réseau). Retour navigateur propre.
    return back('gbp=error&reason=not_configured');
  }

  try {
    const code = url.searchParams.get('code');
    const nonce = url.searchParams.get('state');
    if (!code || !nonce) return back('gbp=error&reason=params');

    // State one-time : lecture PUIS delete (anti-replay/CSRF).
    if (!env.STATE_STORE) return back('gbp=error&reason=state');
    const stored = await env.STATE_STORE.get(`gbp_oauth_state:${nonce}`);
    if (stored) await env.STATE_STORE.delete(`gbp_oauth_state:${nonce}`);
    if (!stored) return back('gbp=error&reason=state');

    let st: GbpOauthState;
    try {
      st = JSON.parse(stored) as GbpOauthState;
    } catch {
      return back('gbp=error&reason=state');
    }
    if (!st.client_id) return back('gbp=error&reason=state');

    const redirect = redirectUri(url.origin);
    const tok = await exchangeCode(code, creds, redirect);
    if (!tok) return back('gbp=error&reason=token');

    // CHIFFREMENT AES-GCM avant stockage (jamais en clair en base).
    const encAccess = await encryptToken(tok.access_token, env);
    const encRefresh = tok.refresh_token ? await encryptToken(tok.refresh_token, env) : '';
    const expiresAt =
      tok.expires_in > 0 ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null;

    // UPSERT oauth_connections borné client_id DU STATE (jamais body). Pas
    // d'ON CONFLICT (aucune contrainte UNIQUE) → DELETE+INSERT idempotent
    // (client_id, provider='google_business'). Calque oauth.ts l.341.
    await env.DB.prepare(
      "DELETE FROM oauth_connections WHERE client_id = ? AND provider = 'google_business'",
    )
      .bind(st.client_id)
      .run();
    const oauthInsert = await env.DB.prepare(
      `INSERT INTO oauth_connections
         (client_id, agency_id, provider, access_token, refresh_token, expires_at,
          scopes, status, account_email, created_at, updated_at)
       VALUES (?, ?, 'google_business', ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
       RETURNING id`,
    )
      .bind(
        st.client_id,
        st.agency_id,
        encAccess,
        encRefresh,
        expiresAt,
        tok.scopes,
        tok.account_email,
      )
      .first<{ id: string }>();

    const oauthConnectionId = oauthInsert?.id;
    if (!oauthConnectionId) return back('gbp=error&reason=persist');

    // INSERT gbp_connections (oauth_connection_id, gbp_account_id NULL).
    // Idempotence : on supprime l'éventuelle ligne précédente du tenant.
    await env.DB.prepare(
      'DELETE FROM gbp_connections WHERE client_id = ?',
    )
      .bind(st.client_id)
      .run();
    await env.DB.prepare(
      `INSERT INTO gbp_connections
         (client_id, agency_id, oauth_connection_id, gbp_account_id, gbp_account_name,
          status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, 'active', datetime('now'), datetime('now'))`,
    )
      .bind(st.client_id, st.agency_id, oauthConnectionId)
      .run();

    // Trigger ASYNC listGbpAccounts pour peupler gbp_account_id/name.
    // Best-effort : si A2 (worker/gbp.ts) pas dispo ou échec → on ignore,
    // l'UI déclenchera un refresh manuel. Pas de await pour ne pas bloquer
    // le redirect navigateur (300ms+ Google API call).
    try {
      const m = (await import('./gbp')) as unknown as {
        listGbpAccounts?: (
          env: Env,
          clientId: string,
          oauthConnectionId: string,
        ) => Promise<unknown>;
      };
      if (typeof m.listGbpAccounts === 'function') {
        // Fire-and-forget : on enchaîne sans await, isolated context worker.
        void m.listGbpAccounts(env, st.client_id, oauthConnectionId).catch(() => {
          /* best-effort, l'UI re-déclenchera */
        });
      }
    } catch {
      /* module pas encore dispo (A2 en cours) — pas bloquant */
    }

    return back('gbp=connected');
  } catch {
    // Best-effort : jamais 500 brut au navigateur.
    return back('gbp=error&reason=unknown');
  }
}
