// ── oauth.ts — LOT G4 OAuth natives (squelette transverse) ──────────────────
//
// Connexions OAuth natives par tenant : Google Calendar + Slack (v1).
// Gmail send-as / Microsoft 365 = v2 (hors scope ici).
//
// ⚠ État : IMPLÉMENTÉ — SIGNATURES FIGÉES, corps réels présents.
//   worker.ts (câblé Phase A) appelle déjà ces handlers. Les signatures
//   (ordre/typage des params, forme de la Response) NE CHANGENT PAS.
//   Le flow réel (échange code, encrypt réutilisé, refresh lazy, flag par
//   provider) est en place. Contrat §6 verbatim dans docs/LOT-OAUTH-G4.md.
//
// Conventions imposées (docs/LOT-OAUTH-G4.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code` (apiFetch / ApiResponse GELÉS — §6.D).
//   - Flag PAR PROVIDER via credentials env : GOOGLE_OAUTH_CLIENT_ID/SECRET
//     (Google), SLACK_CLIENT_ID/SECRET (Slack). Absents ⇒ authorize renvoie
//     { error } 400 'non configuré' (PAS 500, calque _v2-backlog/gcal.ts:28) ;
//     callback no-op. Activation = secrets posés via `wrangler secret put`.
//   - Tokens CHIFFRÉS AES-GCM via encryptToken/decryptToken réutilisés de
//     migration-ghl-oauth.ts (env.TOKEN_KEY ; fallback clair documenté si
//     absent — limite assumée, calque GHL).
//   - State CSRF via env.STATE_STORE (KV, TTL 600s, one-time) — calque GHL.
//   - Capability 'settings.manage' (déjà dans ALL_CAPABILITIES — AUCUN ajout).
//   - Bornage tenant STRICT : oauth_connections.client_id depuis auth/state
//     JAMAIS body ; DELETE re-borne ; state KV porte le tenant jamais
//     cross-tenant.
//   - Refresh LAZY v1 (getOauthAccessToken refresh si expiré, calque
//     getGcalAccessToken). Google Cal = connexion + LECTURE events v1 ;
//     écriture / sync 2-way = v2.
//
// ⚠ _v2-backlog/gcal.ts reste DÉBRANCHÉ : on calque sa LOGIQUE de flow/scopes/
//   refresh Google mais on NE l'importe PAS (il stocke les tokens en clair dans
//   users.permissions, non borné tenant — incompatible §6).

import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
// Réutilisation du chiffrement AES-GCM EXISTANT (PAS de duplication crypto).
import { encryptToken, decryptToken } from './migration-ghl-oauth';

// Auth enrichi au choke-point (worker.ts) — calque le type passé à
// routeProtected (userId/role/clientId/tenant/capabilities).
export type OauthAuth = CapAuth & { capabilities?: Set<string> };

// Providers OAuth natifs supportés v1. (Whitelist régex côté worker.ts.)
export type OauthProvider = 'google' | 'slack';

// ── Configuration par provider (scopes + endpoints). Le flag d'activation
//    réel = présence des credentials env (résolus dans providerCredentials).
//    Phase B branche l'échange code/token sur ces endpoints. ─────────────────
const PROVIDER_CONFIG: Record<OauthProvider, {
  authUrl: string;
  tokenUrl: string;
  scopes: string;
}> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // Calque _v2-backlog/gcal.ts:29 — connexion + lecture events v1.
    scopes:
      'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email',
  },
  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: 'chat:write,channels:read',
  },
};

// ── Flag par provider : credentials env. Absent ⇒ provider non configuré
//    (authorize 400 propre, jamais 500 ; callback no-op). Calque
//    _v2-backlog/gcal.ts:28 + le pattern E4/E8 (secret optionnel = no-op). ────
export function providerCredentials(
  env: Env,
  provider: OauthProvider,
): { clientId: string; clientSecret: string } | null {
  if (provider === 'google') {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
    return { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET };
  }
  if (provider === 'slack') {
    if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) return null;
    return { clientId: env.SLACK_CLIENT_ID, clientSecret: env.SLACK_CLIENT_SECRET };
  }
  return null;
}

// ── Garde capability (réutilise 'settings.manage' — AUCUN ajout à
//    ALL_CAPABILITIES). En legacy/mono-tenant le set est LARGE ⇒ pas de
//    régression ; bridage viewer actif seulement en mode agence. ─────────────
function capGuard(auth: OauthAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

// ── Résolution tenant STRICTE depuis l'auth (JAMAIS le body). client_id =
//    tenant propriétaire de la connexion. agency_id NULLABLE (legacy → null).
//    Calque tenant-context (auth.tenant.clientId / agencyId). ────────────────
function tenantOf(auth: OauthAuth): { clientId: string | null; agencyId: string | null } {
  return {
    clientId: auth.tenant?.clientId ?? auth.clientId ?? null,
    agencyId: auth.tenant?.agencyId ?? null,
  };
}

// ── redirect_uri canonique du provider (origin courant + préfixe figé
//    worker.ts). Doit MATCHER l'autorisation et l'échange (sinon refus
//    provider). ──────────────────────────────────────────────────────────────
function redirectUri(origin: string, provider: OauthProvider): string {
  return `${origin}/api/oauth/${provider}/callback`;
}

// ── Forme persistée dans STATE_STORE (KV). Porte le tenant — JAMAIS le body. ─
interface OauthState {
  client_id: string;
  agency_id: string | null;
  provider: OauthProvider;
  origin: string;
}

// ── Échange code → tokens (forme normalisée commune Google/Slack). ──────────
interface TokenExchange {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scopes: string;
  account_email: string;
}

// ── Échange du code d'autorisation contre les tokens, normalisé par provider.
//    Best-effort : renvoie null si l'échange échoue (callback redirige ?error).
async function exchangeCode(
  provider: OauthProvider,
  code: string,
  creds: { clientId: string; clientSecret: string },
  redirect: string,
): Promise<TokenExchange | null> {
  const cfg = PROVIDER_CONFIG[provider];
  if (provider === 'slack') {
    const resp = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code,
        redirect_uri: redirect,
      }),
    });
    if (!resp.ok) return null;
    const d = (await resp.json()) as {
      ok?: boolean;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      authed_user?: { access_token?: string };
      team?: { name?: string };
    };
    const token = d.access_token || d.authed_user?.access_token;
    if (!d.ok || !token) return null;
    return {
      access_token: token,
      refresh_token: d.refresh_token || '',
      expires_in: d.expires_in || 0, // Slack bot tokens : pas d'expiration v1.
      scopes: d.scope || cfg.scopes,
      account_email: d.team?.name || '',
    };
  }

  // Google (et défaut OAuth2 standard).
  const resp = await fetch(cfg.tokenUrl, {
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
    scopes: d.scope || cfg.scopes,
    account_email: email,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  HANDLERS — État : IMPLÉMENTÉ (signatures FIGÉES, corps réels présents).
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/oauth/:provider/authorize (PROTÉGÉ, capability settings.manage) ─
//    Phase B : génère l'URL d'autorisation + nonce CSRF en KV (state porte le
//    tenant : client_id depuis auth, JAMAIS body), redirige 302. Provider non
//    configuré (credentials absents) ⇒ json({ error }, 400) — JAMAIS 500.
export async function handleOauthAuthorize(
  _request: Request,
  env: Env,
  auth: OauthAuth,
  provider: OauthProvider,
  url: URL,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const creds = providerCredentials(env, provider);
  if (!creds) {
    // Flag INACTIF : credentials du provider absents → 400 propre (pas 500).
    return json({ error: `Intégration ${provider} non configurée` }, 400);
  }

  // Tenant STRICT depuis l'auth (JAMAIS le body). Sans tenant résolu → 400.
  const { clientId, agencyId } = tenantOf(auth);
  if (!clientId) return json({ error: 'Tenant non résolu' }, 400);

  // Nonce CSRF one-time (KV, TTL 600s) — le state porte le tenant, jamais
  // cross-tenant. Deux randomUUID concaténés pour l'entropie (calque GHL).
  const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const statePayload: OauthState = {
    client_id: clientId,
    agency_id: agencyId,
    provider,
    origin: url.origin,
  };
  if (!env.STATE_STORE) {
    // KV requis pour la sécurité CSRF — pas de fallback in-memory en prod.
    return json({ error: 'Stockage state OAuth indisponible' }, 503);
  }
  await env.STATE_STORE.put(`oauth_state:${nonce}`, JSON.stringify(statePayload), {
    expirationTtl: 600,
  });

  const cfg = PROVIDER_CONFIG[provider];
  const redirect = redirectUri(url.origin, provider);

  let authUrl: string;
  if (provider === 'slack') {
    authUrl =
      `${cfg.authUrl}?client_id=${encodeURIComponent(creds.clientId)}` +
      `&scope=${encodeURIComponent(cfg.scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&state=${encodeURIComponent(nonce)}`;
  } else {
    // Google : access_type=offline + prompt=consent pour obtenir un refresh_token.
    authUrl =
      `${cfg.authUrl}?client_id=${encodeURIComponent(creds.clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(cfg.scopes)}` +
      `&access_type=offline&prompt=consent` +
      `&state=${encodeURIComponent(nonce)}`;
  }

  // GET navigation : redirection navigateur directe vers le provider (calque
  // handleGhlOauthStart). worker.ts retourne cette Response telle quelle.
  return Response.redirect(authUrl, 302);
}

// ── GET /api/oauth/:provider/callback (PUBLIC hors-try — retour navigateur) ──
//    Phase B : valide state KV one-time (tenant extrait du state, jamais
//    cross-tenant), échange le code, chiffre les tokens (encryptToken), upsert
//    oauth_connections borné client_id (du state), redirige vers /integrations.
//    Provider non configuré ⇒ no-op (redirect erreur propre).
export async function handleOauthCallback(
  _request: Request,
  env: Env,
  provider: OauthProvider,
  url: URL,
): Promise<Response> {
  // Retour navigateur : on redirige TOUJOURS vers /integrations (succès ou
  // erreur via ?error=), jamais de 500 brut. Helper local.
  const back = (qs: string) => Response.redirect(`${url.origin}/integrations?${qs}`, 302);

  const creds = providerCredentials(env, provider);
  if (!creds) {
    // Flag INACTIF : no-op (zéro réseau). Retour NAVIGATEUR propre vers
    // /integrations?error=not_configured (contrat front Manager-C), pas un
    // JSON 400 brut — le callback est une navigation navigateur.
    return back('error=not_configured');
  }

  try {
    const code = url.searchParams.get('code');
    const nonce = url.searchParams.get('state');
    if (!code || !nonce) return back(`error=${provider}_params`);

    // State one-time : lecture PUIS delete (anti-replay/CSRF).
    if (!env.STATE_STORE) return back(`error=${provider}_state`);
    const stored = await env.STATE_STORE.get(`oauth_state:${nonce}`);
    if (stored) await env.STATE_STORE.delete(`oauth_state:${nonce}`);
    if (!stored) return back(`error=${provider}_state`);

    let st: OauthState;
    try {
      st = JSON.parse(stored) as OauthState;
    } catch {
      return back(`error=${provider}_state`);
    }
    // Le provider du state doit matcher le provider de l'URL (anti-mix).
    if (st.provider !== provider || !st.client_id) return back(`error=${provider}_state`);

    const redirect = redirectUri(url.origin, provider);
    const tok = await exchangeCode(provider, code, creds, redirect);
    if (!tok) return back(`error=${provider}_token`);

    // CHIFFREMENT AES-GCM avant stockage (jamais en clair en base).
    const encAccess = await encryptToken(tok.access_token, env);
    const encRefresh = tok.refresh_token ? await encryptToken(tok.refresh_token, env) : '';
    const expiresAt =
      tok.expires_in > 0 ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null;

    // UPSERT borné client_id DU STATE (jamais body). Pas d'ON CONFLICT (aucune
    // contrainte UNIQUE sur la table additive seq 95) → DELETE+INSERT manuel
    // borné (client_id, provider) pour idempotence.
    await env.DB.prepare('DELETE FROM oauth_connections WHERE client_id = ? AND provider = ?')
      .bind(st.client_id, provider)
      .run();
    await env.DB.prepare(
      `INSERT INTO oauth_connections
         (client_id, agency_id, provider, access_token, refresh_token, expires_at,
          scopes, status, account_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        st.client_id,
        st.agency_id,
        provider,
        encAccess,
        encRefresh,
        expiresAt,
        tok.scopes,
        tok.account_email,
      )
      .run();

    return back(`connected=${provider}`);
  } catch {
    // Best-effort : jamais 500 brut au navigateur.
    return back(`error=${provider}`);
  }
}

// ── GET /api/oauth/connections (PROTÉGÉ) — liste tenant-bornée ──────────────
//    Phase B : SELECT oauth_connections WHERE client_id ∈ tenant
//    (accessibleClientIds en mode agence, sinon auth.clientId). JAMAIS de
//    token en clair renvoyé (id, provider, status, account_email, dates).
export async function handleListOauthConnections(
  _request: Request,
  env: Env,
  auth: OauthAuth,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const { clientId } = tenantOf(auth);
  if (!clientId) return json({ data: [] });

  // PROJECTION SANS TOKENS — access_token/refresh_token JAMAIS renvoyés.
  const { results } = await env.DB.prepare(
    `SELECT id, provider, status, account_email, expires_at, created_at
       FROM oauth_connections
      WHERE client_id = ?
      ORDER BY created_at DESC`,
  )
    .bind(clientId)
    .all();

  return json({ data: results || [] });
}

// ── DELETE /api/oauth/connections/:id (PROTÉGÉ) — re-borne tenant ───────────
//    Phase B : DELETE WHERE id = ? AND client_id ∈ tenant (re-bornage strict :
//    impossible de supprimer la connexion d'un autre tenant). 404 si hors
//    tenant.
export async function handleDeleteOauthConnection(
  _request: Request,
  env: Env,
  auth: OauthAuth,
  id: string,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const { clientId } = tenantOf(auth);
  if (!clientId) return json({ error: 'Connexion introuvable' }, 404);

  // RE-BORNAGE STRICT : on charge la connexion et on re-vérifie qu'elle
  // appartient au tenant courant (impossible de supprimer cross-tenant).
  const row = (await env.DB.prepare(
    'SELECT id, client_id FROM oauth_connections WHERE id = ?',
  )
    .bind(id)
    .first()) as { id: string; client_id: string } | null;

  if (!row || row.client_id !== clientId) {
    return json({ error: 'Connexion introuvable' }, 404);
  }

  await env.DB.prepare('DELETE FROM oauth_connections WHERE id = ? AND client_id = ?')
    .bind(id, clientId)
    .run();

  return json({ data: { deleted: true } });
}

// ── GET /api/oauth/gcal/events (PROTÉGÉ) — lecture events Google Calendar v1 ─
//    Phase B : getOauthAccessToken(env, auth, 'google') (refresh lazy) → GET
//    calendar/v3 events (calque _v2-backlog/gcal.ts:50-61, LECTURE seule).
//    Pas connecté ⇒ 401 ; provider non configuré ⇒ 400.
export async function handleOauthGcalEvents(
  _request: Request,
  env: Env,
  auth: OauthAuth,
  url: URL,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  // Provider non configuré OU pas de connexion → liste vide (best-effort,
  // jamais d'erreur dure : l'UI affiche simplement aucun évènement).
  const token = await getOauthAccessToken(env, auth, 'google');
  if (!token) return json({ data: { events: [] } });

  try {
    const timeMin = url.searchParams.get('time_min') || new Date().toISOString();
    const timeMax =
      url.searchParams.get('time_max') ||
      new Date(Date.now() + 30 * 86400000).toISOString();
    const maxResults = url.searchParams.get('max_results') || '50';
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
        `?timeMin=${encodeURIComponent(timeMin)}` +
        `&timeMax=${encodeURIComponent(timeMax)}` +
        `&maxResults=${encodeURIComponent(maxResults)}` +
        `&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return json({ data: { events: [] } });
    const data = (await res.json()) as { items?: Array<Record<string, unknown>>; error?: unknown };
    if (data.error) return json({ data: { events: [] } });
    // Normalisation légère (LECTURE seule v1).
    const events = (data.items || []).map((e) => ({
      id: e.id,
      summary: e.summary || '(Sans titre)',
      start: e.start,
      end: e.end,
      location: e.location ?? null,
      htmlLink: e.htmlLink ?? null,
    }));
    return json({ data: { events } });
  } catch {
    return json({ data: { events: [] } });
  }
}

// ── Getter token avec refresh LAZY (helper interne, signature FIGÉE) ─────────
//    Phase B : SELECT oauth_connections borné tenant pour (auth.clientId,
//    provider) ; decryptToken(access) ; si expires_at <= now → refresh via
//    tokenUrl + refresh_token (decryptToken) → UPDATE chiffré ; renvoie le
//    token clair en mémoire (JAMAIS persisté en clair). Calque
//    getGcalAccessToken (_v2-backlog/gcal.ts:5-25) MAIS borné tenant + chiffré.
//    Renvoie null si non connecté / provider non configuré / refresh échoué.
export async function getOauthAccessToken(
  env: Env,
  auth: OauthAuth,
  provider: OauthProvider,
): Promise<string | null> {
  const creds = providerCredentials(env, provider);
  if (!creds) return null;

  const { clientId } = tenantOf(auth);
  if (!clientId) return null;

  try {
    // Lookup BORNÉ tenant (client_id + provider).
    const conn = (await env.DB.prepare(
      `SELECT id, access_token, refresh_token, expires_at
         FROM oauth_connections
        WHERE client_id = ? AND provider = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(clientId, provider)
      .first()) as
      | { id: string; access_token: string; refresh_token: string; expires_at: string | null }
      | null;

    if (!conn || !conn.access_token) return null;

    const accessToken = await decryptToken(conn.access_token, env);

    // Token encore valide → on le renvoie (clair en mémoire, jamais persisté).
    const notExpired =
      !conn.expires_at || new Date(conn.expires_at).getTime() > Date.now() + 60_000;
    if (notExpired) return accessToken;

    // Expiré : refresh LAZY si refresh_token présent (sinon on retombe sur
    // l'access courant — best-effort).
    if (!conn.refresh_token) return accessToken;
    const refreshToken = await decryptToken(conn.refresh_token, env);
    if (!refreshToken) return accessToken;

    const cfg = PROVIDER_CONFIG[provider];
    const resp = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!resp.ok) return accessToken; // refresh KO → on rend l'ancien (best-effort).
    const d = (await resp.json()) as { access_token?: string; expires_in?: number };
    if (!d.access_token) return accessToken;

    // Re-chiffrement + UPDATE borné tenant (refresh_token souvent non renvoyé
    // par Google → on conserve l'existant chiffré).
    const encAccess = await encryptToken(d.access_token, env);
    const newExpiresAt = new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE oauth_connections
          SET access_token = ?, expires_at = ?, updated_at = datetime('now')
        WHERE id = ? AND client_id = ?`,
    )
      .bind(encAccess, newExpiresAt, conn.id, clientId)
      .run();

    return d.access_token;
  } catch {
    return null;
  }
}
