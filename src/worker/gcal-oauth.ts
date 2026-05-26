// ── gcal-oauth.ts — Sprint 33 Google Calendar OAuth dédié (WRITE flow) ───────
//
// Flow OAuth Google Calendar ISOLÉ du LOT G4 OAuth natives (oauth.ts gère
// provider 'google' pour Calendar read-only v1). Distinct ici : scope WRITE
// (calendar) + endpoint /api/gcal/oauth/callback + redirect frontend dédié
// /settings/integrations?gcal_sync=connected. Provider persisté =
// 'google_calendar' (≠ 'google' du G4 — DEUX lignes oauth_connections distinctes
// possibles par tenant, sans collision).
//
//   - Scope : https://www.googleapis.com/auth/calendar
//             + https://www.googleapis.com/auth/userinfo.email
//   - Redirect : /api/gcal/oauth/callback (whitelist callback indépendante)
//   - Stockage tokens : oauth_connections.provider = 'google_calendar'
//
// Conventions CALQUÉES sur gbp-oauth.ts (Sprint 32 A2) byte-identique :
//   - State CSRF via env.STATE_STORE KV (TTL 600s, one-time, anti-replay).
//   - Tokens CHIFFRÉS AES-GCM via encryptToken (migration-ghl-oauth.ts) —
//     env.TOKEN_KEY (fallback clair documenté).
//   - Capability 'settings.manage' au start (capGuard).
//   - Bornage tenant STRICT : client_id depuis auth (start) puis depuis state
//     (callback) — JAMAIS le body.
//   - Provider non configuré (GCAL_SYNC_OAUTH_* et GOOGLE_OAUTH_* absents) :
//     - authorize → json({ error }, 400)
//     - callback → redirect /settings/integrations?gcal_sync=error&reason=not_configured
//   - Redirect frontend : /settings/integrations?gcal_sync=connected
//                       | /settings/integrations?gcal_sync=error&reason=...
//
// Fallback credentials : GCAL_SYNC_OAUTH_CLIENT_ID/SECRET prioritaires
// (app Google dédiée Sprint 33), sinon GOOGLE_OAUTH_CLIENT_ID/SECRET (G4
// existant — réutilisable si l'opérateur n'a pas créé d'app séparée).

import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { encryptToken } from './migration-ghl-oauth';

// Auth enrichi au choke-point (worker.ts), même type que gbp-oauth.ts:GbpAuth.
export type GcalAuth = CapAuth & { capabilities?: Set<string> };

// ── Config OAuth Google Calendar (constants figées). ────────────────────────
const GCAL_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GCAL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GCAL_SCOPE =
  'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email';

// ── Flag d'activation : credentials env GCAL_SYNC_OAUTH_* prioritaires,
//    fallback GOOGLE_OAUTH_* (G4). Absents des DEUX → provider non configuré.
function gcalCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  // Env typed via cast — types.ts ne déclare pas encore GCAL_SYNC_OAUTH_*
  // (ajout hors-scope agent A3). Lecture défensive : strings non-vides requises.
  const e = env as unknown as {
    GCAL_SYNC_OAUTH_CLIENT_ID?: string;
    GCAL_SYNC_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
  };
  const clientId = e.GCAL_SYNC_OAUTH_CLIENT_ID || e.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = e.GCAL_SYNC_OAUTH_CLIENT_SECRET || e.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// ── Garde capability (settings.manage — aucun ajout à ALL_CAPABILITIES). ────
function capGuard(auth: GcalAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

// ── Résolution tenant STRICTE depuis l'auth (jamais body). ──────────────────
function tenantOf(auth: GcalAuth): { clientId: string | null; agencyId: string | null } {
  return {
    clientId: auth.tenant?.clientId ?? auth.clientId ?? null,
    agencyId: auth.tenant?.agencyId ?? null,
  };
}

// ── redirect_uri canonique GCal (origin courant + préfixe figé worker.ts). ──
function redirectUri(origin: string): string {
  return `${origin}/api/gcal/oauth/callback`;
}

// ── Forme persistée dans STATE_STORE (KV). Porte le tenant — JAMAIS body. ───
interface GcalOauthState {
  client_id: string;
  agency_id: string | null;
  user_id: string | null;
  origin: string;
  ts: number;
}

// ── Échange code → tokens (normalisé Google OAuth2 standard). ───────────────
interface GcalTokenExchange {
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
): Promise<GcalTokenExchange | null> {
  const resp = await fetch(GCAL_TOKEN_URL, {
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
    scopes: d.scope || GCAL_SCOPE,
    account_email: email,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  HANDLERS — exposés à worker.ts (signatures FIGÉES).
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/gcal/oauth/start (PROTÉGÉ, capability settings.manage) ─────────
//    Génère l'URL d'autorisation Google Calendar + nonce CSRF en KV (state
//    porte le tenant, JAMAIS body), retourne json({ data: { url } }) pour
//    permettre au frontend de naviguer (window.location.href = url).
//    Provider non configuré ⇒ json({ error }, 400) — JAMAIS 500.
export async function handleGcalAuthorize(
  request: Request,
  env: Env,
  auth: GcalAuth,
): Promise<Response> {
  const g = capGuard(auth);
  if (g) return g;

  const creds = gcalCredentials(env);
  if (!creds) {
    return json({ error: 'Intégration Google Calendar non configurée' }, 400);
  }

  const { clientId, agencyId } = tenantOf(auth);
  if (!clientId) return json({ error: 'Tenant non résolu' }, 400);

  if (!env.STATE_STORE) {
    return json({ error: 'Stockage state OAuth indisponible' }, 503);
  }

  // Nonce CSRF one-time (KV, TTL 600s) — crypto.randomUUID (16 octets).
  const nonce = crypto.randomUUID();
  const url = new URL(request.url);
  const statePayload: GcalOauthState = {
    client_id: clientId,
    agency_id: agencyId,
    user_id: auth.userId ?? null,
    origin: url.origin,
    ts: Date.now(),
  };
  await env.STATE_STORE.put(`gcal_oauth_state:${nonce}`, JSON.stringify(statePayload), {
    expirationTtl: 600,
  });

  const redirect = redirectUri(url.origin);

  // Google : access_type=offline + prompt=consent → refresh_token garanti.
  const authUrl =
    `${GCAL_AUTH_URL}?client_id=${encodeURIComponent(creds.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(GCAL_SCOPE)}` +
    `&access_type=offline&prompt=consent` +
    `&state=${encodeURIComponent(nonce)}`;

  return json({ data: { url: authUrl } });
}

// ── GET /api/gcal/oauth/callback (PUBLIC hors-try — retour navigateur) ──────
//    Valide state KV one-time (tenant extrait du state, jamais cross-tenant),
//    échange le code, chiffre les tokens (encryptToken), upsert
//    oauth_connections (provider='google_calendar') borné client_id du state.
//    Redirige TOUJOURS vers /settings/integrations.
export async function handleGcalCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Retour navigateur : on redirige TOUJOURS vers /settings/integrations
  // (succès ou erreur via ?gcal_sync=error&reason=), jamais de 500 brut.
  const back = (qs: string) =>
    Response.redirect(`${url.origin}/settings/integrations?${qs}`, 302);

  const creds = gcalCredentials(env);
  if (!creds) {
    // Flag INACTIF : no-op (zéro réseau). Retour navigateur propre.
    return back('gcal_sync=error&reason=not_configured');
  }

  try {
    const code = url.searchParams.get('code');
    const nonce = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) return back(`gcal_sync=error&reason=${encodeURIComponent(oauthError)}`);
    if (!code || !nonce) return back('gcal_sync=error&reason=params');

    // State one-time : lecture PUIS delete (anti-replay/CSRF).
    if (!env.STATE_STORE) return back('gcal_sync=error&reason=state');
    const stored = await env.STATE_STORE.get(`gcal_oauth_state:${nonce}`);
    if (stored) await env.STATE_STORE.delete(`gcal_oauth_state:${nonce}`);
    if (!stored) return back('gcal_sync=error&reason=state');

    let st: GcalOauthState;
    try {
      st = JSON.parse(stored) as GcalOauthState;
    } catch {
      return back('gcal_sync=error&reason=state');
    }
    if (!st.client_id) return back('gcal_sync=error&reason=state');

    const redirect = redirectUri(url.origin);
    const tok = await exchangeCode(code, creds, redirect);
    if (!tok) return back('gcal_sync=error&reason=token');

    // CHIFFREMENT AES-GCM avant stockage (jamais en clair en base).
    const encAccess = await encryptToken(tok.access_token, env);
    const encRefresh = tok.refresh_token ? await encryptToken(tok.refresh_token, env) : '';
    const expiresAt =
      tok.expires_in > 0 ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null;

    // UPSERT oauth_connections borné client_id DU STATE (jamais body). Pas
    // d'ON CONFLICT (aucune contrainte UNIQUE) → DELETE+INSERT idempotent
    // (client_id, provider='google_calendar'). Calque gbp-oauth.ts l.243-264.
    // NB : provider 'google_calendar' ≠ 'google' (G4 oauth.ts) : aucun risque
    // de collision avec la connexion Calendar v1 read-only existante.
    await env.DB.prepare(
      "DELETE FROM oauth_connections WHERE client_id = ? AND provider = 'google_calendar'",
    )
      .bind(st.client_id)
      .run();
    const oauthInsert = await env.DB.prepare(
      `INSERT INTO oauth_connections
         (client_id, agency_id, provider, access_token, refresh_token, expires_at,
          scopes, status, account_email, created_at, updated_at)
       VALUES (?, ?, 'google_calendar', ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))
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

    if (!oauthInsert?.id) return back('gcal_sync=error&reason=persist');

    return back('gcal_sync=connected');
  } catch {
    // Best-effort : jamais 500 brut au navigateur.
    return back('gcal_sync=error&reason=unknown');
  }
}
