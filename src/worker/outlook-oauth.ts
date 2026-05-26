// ── outlook-oauth.ts — Sprint 33 Microsoft Outlook OAuth dédié (WRITE) ───────
//
// Flow OAuth Microsoft Graph (Outlook Calendar) ISOLÉ : provider 'outlook'
// dans oauth_connections (distinct des providers Google/Slack du G4). Endpoint
// /api/outlook/oauth/callback dédié, redirect frontend
// /settings/integrations?outlook=connected.
//
//   - Scope : Calendars.ReadWrite offline_access User.Read
//   - Redirect : /api/outlook/oauth/callback (whitelist callback indépendante)
//   - Stockage tokens : oauth_connections.provider = 'outlook'
//
// Conventions CALQUÉES sur gbp-oauth.ts (Sprint 32 A2) byte-identique :
//   - State CSRF via env.STATE_STORE KV (TTL 600s, one-time, anti-replay).
//   - Tokens CHIFFRÉS AES-GCM via encryptToken (migration-ghl-oauth.ts) —
//     env.TOKEN_KEY (fallback clair documenté).
//   - Capability 'settings.manage' au start (capGuard).
//   - Bornage tenant STRICT : client_id depuis auth (start) puis depuis state
//     (callback) — JAMAIS le body.
//   - Provider non configuré (MS_OAUTH_CLIENT_ID/SECRET absents) :
//     - authorize → json({ error }, 400)
//     - callback → redirect /settings/integrations?outlook=error&reason=not_configured
//   - Redirect frontend : /settings/integrations?outlook=connected
//                       | /settings/integrations?outlook=error&reason=...
//
// Tenant Microsoft : MS_OAUTH_TENANT (fallback 'common' = multi-tenant
// personnel + organisationnel — couvre comptes perso outlook.com ET orgs Azure
// AD). Override possible via env si l'opérateur restreint à son tenant unique.

import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { encryptToken } from './migration-ghl-oauth';

// Auth enrichi au choke-point (worker.ts), même type que gbp-oauth.ts:GbpAuth.
export type OutlookAuth = CapAuth & { capabilities?: Set<string> };

// ── Config OAuth Microsoft Graph (constants figées). Scope WRITE Calendar +
//    offline_access (refresh_token) + User.Read (userinfo pour account_email).
const OUTLOOK_SCOPE = 'Calendars.ReadWrite offline_access User.Read';

function tenantSegment(env: Env): string {
  const e = env as unknown as { MS_OAUTH_TENANT?: string };
  const t = (e.MS_OAUTH_TENANT || '').trim();
  return t || 'common';
}

function outlookAuthUrl(env: Env): string {
  return `https://login.microsoftonline.com/${tenantSegment(env)}/oauth2/v2.0/authorize`;
}

function outlookTokenUrl(env: Env): string {
  return `https://login.microsoftonline.com/${tenantSegment(env)}/oauth2/v2.0/token`;
}

// ── Flag d'activation : credentials env MS_OAUTH_*. Absents → non configuré.
function outlookCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  // Env typed via cast — types.ts ne déclare pas encore MS_OAUTH_* (ajout
  // hors-scope agent A3). Lecture défensive : strings non-vides requises.
  const e = env as unknown as {
    MS_OAUTH_CLIENT_ID?: string;
    MS_OAUTH_CLIENT_SECRET?: string;
  };
  if (!e.MS_OAUTH_CLIENT_ID || !e.MS_OAUTH_CLIENT_SECRET) return null;
  return { clientId: e.MS_OAUTH_CLIENT_ID, clientSecret: e.MS_OAUTH_CLIENT_SECRET };
}

// ── Garde capability (settings.manage — aucun ajout à ALL_CAPABILITIES). ────
function capGuard(auth: OutlookAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

// ── Résolution tenant STRICTE depuis l'auth (jamais body). ──────────────────
function tenantOf(auth: OutlookAuth): { clientId: string | null; agencyId: string | null } {
  return {
    clientId: auth.tenant?.clientId ?? auth.clientId ?? null,
    agencyId: auth.tenant?.agencyId ?? null,
  };
}

// ── redirect_uri canonique Outlook (origin courant + préfixe figé worker.ts).
function redirectUri(origin: string): string {
  return `${origin}/api/outlook/oauth/callback`;
}

// ── Forme persistée dans STATE_STORE (KV). Porte le tenant — JAMAIS body. ───
interface OutlookOauthState {
  client_id: string;
  agency_id: string | null;
  user_id: string | null;
  origin: string;
  ts: number;
}

// ── Échange code → tokens (normalisé Microsoft Graph OAuth2). ───────────────
interface OutlookTokenExchange {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scopes: string;
  account_email: string;
}

async function exchangeCode(
  env: Env,
  code: string,
  creds: { clientId: string; clientSecret: string },
  redirect: string,
): Promise<OutlookTokenExchange | null> {
  const resp = await fetch(outlookTokenUrl(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
      // scope facultatif en token exchange Microsoft (déjà fixé à l'authorize)
      // mais on le renvoie pour rester explicite si l'app exige consent step-up.
      scope: OUTLOOK_SCOPE,
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
  // account_email via Microsoft Graph /me (best-effort — n'échoue pas l'échange).
  let email = '';
  try {
    const ui = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${d.access_token}` },
    });
    if (ui.ok) {
      const u = (await ui.json()) as { mail?: string; userPrincipalName?: string };
      email = u.mail || u.userPrincipalName || '';
    }
  } catch {
    /* /me best-effort */
  }
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token || '',
    expires_in: d.expires_in || 3600,
    scopes: d.scope || OUTLOOK_SCOPE,
    account_email: email,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  HANDLERS — exposés à worker.ts (signatures FIGÉES).
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/outlook/oauth/start (PROTÉGÉ, capability settings.manage) ──────
//    Génère l'URL d'autorisation Microsoft Graph + nonce CSRF en KV (state
//    porte le tenant, JAMAIS body), retourne json({ data: { url } }).
//    Provider non configuré ⇒ json({ error }, 400) — JAMAIS 500.
export async function handleOutlookAuthorize(
  request: Request,
  env: Env,
  auth: OutlookAuth,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const creds = outlookCredentials(env);
  if (!creds) {
    return json({ error: 'Intégration Outlook non configurée' }, 400);
  }

  const { clientId, agencyId } = tenantOf(auth);
  if (!clientId) return json({ error: 'Tenant non résolu' }, 400);

  if (!env.STATE_STORE) {
    return json({ error: 'Stockage state OAuth indisponible' }, 503);
  }

  // Nonce CSRF one-time (KV, TTL 600s) — crypto.randomUUID (16 octets).
  const nonce = crypto.randomUUID();
  const url = new URL(request.url);
  const statePayload: OutlookOauthState = {
    client_id: clientId,
    agency_id: agencyId,
    user_id: auth.userId ?? null,
    origin: url.origin,
    ts: Date.now(),
  };
  await env.STATE_STORE.put(`outlook_oauth_state:${nonce}`, JSON.stringify(statePayload), {
    expirationTtl: 600,
  });

  const redirect = redirectUri(url.origin);

  // Microsoft : response_mode=query → code dans querystring (≠ form_post).
  // offline_access dans le scope → refresh_token garanti.
  const authUrl =
    `${outlookAuthUrl(env)}?client_id=${encodeURIComponent(creds.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=code` +
    `&response_mode=query` +
    `&scope=${encodeURIComponent(OUTLOOK_SCOPE)}` +
    `&prompt=consent` +
    `&state=${encodeURIComponent(nonce)}`;

  return json({ data: { url: authUrl } });
}

// ── GET /api/outlook/oauth/callback (PUBLIC hors-try — retour navigateur) ───
//    Valide state KV one-time (tenant extrait du state, jamais cross-tenant),
//    échange le code, chiffre les tokens (encryptToken), upsert
//    oauth_connections (provider='outlook') borné client_id du state.
//    Redirige TOUJOURS vers /settings/integrations.
export async function handleOutlookCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Retour navigateur : on redirige TOUJOURS vers /settings/integrations
  // (succès ou erreur via ?outlook=error&reason=), jamais de 500 brut.
  const back = (qs: string) =>
    Response.redirect(`${url.origin}/settings/integrations?${qs}`, 302);

  const creds = outlookCredentials(env);
  if (!creds) {
    // Flag INACTIF : no-op (zéro réseau). Retour navigateur propre.
    return back('outlook=error&reason=not_configured');
  }

  try {
    const code = url.searchParams.get('code');
    const nonce = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) return back(`outlook=error&reason=${encodeURIComponent(oauthError)}`);
    if (!code || !nonce) return back('outlook=error&reason=params');

    // State one-time : lecture PUIS delete (anti-replay/CSRF).
    if (!env.STATE_STORE) return back('outlook=error&reason=state');
    const stored = await env.STATE_STORE.get(`outlook_oauth_state:${nonce}`);
    if (stored) await env.STATE_STORE.delete(`outlook_oauth_state:${nonce}`);
    if (!stored) return back('outlook=error&reason=state');

    let st: OutlookOauthState;
    try {
      st = JSON.parse(stored) as OutlookOauthState;
    } catch {
      return back('outlook=error&reason=state');
    }
    if (!st.client_id) return back('outlook=error&reason=state');

    const redirect = redirectUri(url.origin);
    const tok = await exchangeCode(env, code, creds, redirect);
    if (!tok) return back('outlook=error&reason=token');

    // CHIFFREMENT AES-GCM avant stockage (jamais en clair en base).
    const encAccess = await encryptToken(tok.access_token, env);
    const encRefresh = tok.refresh_token ? await encryptToken(tok.refresh_token, env) : '';
    const expiresAt =
      tok.expires_in > 0 ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null;

    // UPSERT oauth_connections borné client_id DU STATE (jamais body). Pas
    // d'ON CONFLICT (aucune contrainte UNIQUE) → DELETE+INSERT idempotent
    // (client_id, provider='outlook'). Calque gbp-oauth.ts l.243-264.
    await env.DB.prepare(
      "DELETE FROM oauth_connections WHERE client_id = ? AND provider = 'outlook'",
    )
      .bind(st.client_id)
      .run();
    const oauthInsert = await env.DB.prepare(
      `INSERT INTO oauth_connections
         (client_id, agency_id, provider, access_token, refresh_token, expires_at,
          scopes, status, account_email, created_at, updated_at)
       VALUES (?, ?, 'outlook', ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
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

    if (!oauthInsert?.id) return back('outlook=error&reason=persist');

    return back('outlook=connected');
  } catch {
    // Best-effort : jamais 500 brut au navigateur.
    return back('outlook=error&reason=unknown');
  }
}
