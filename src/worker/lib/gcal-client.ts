// ── lib/gcal-client.ts — Sprint 33 (Agent A1) ───────────────────────────────
//
// Helpers REST Google Calendar v3 côté Worker, calqués sur le pattern
// lib/gbp-client.ts (Sprint 32 A1) : refresh OAuth lazy via oauth2.googleapis.com,
// tokens chiffrés AES-GCM en base, bornage tenant STRICT depuis auth.clientId
// (JAMAIS lu du body), wrapper fetch commun avec timeout 10s + retry exp
// 429/5xx, erreurs typées CalendarApiError (jamais 500 nu).
//
// Provider fixe ici = 'google_calendar' (table oauth_connections.provider).
// Refresh OAuth via https://oauth2.googleapis.com/token avec :
//   - en priorité env.GCAL_SYNC_OAUTH_CLIENT_ID / GCAL_SYNC_OAUTH_CLIENT_SECRET
//     (secrets dédiés Sprint 33 — séparés de l'app OAuth login Google standard)
//   - fallback env.GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (app
//     OAuth Google partagée — calque gbp-client.ts qui ne lit que GOOGLE_*)
//
// Découpe des responsabilités (calque gbp-client.ts) :
//   - getGcalAccessToken(env, auth) : lecture D1 + refresh lazy + UPDATE chiffré.
//     Renvoie un token frais (ou null si pas de connexion / refresh KO sans
//     fallback utilisable). Borne le tenant via auth.clientId.
//   - gcalListCalendars / gcalListEvents / gcalGetEvent / gcalCreate /
//     gcalPatch / gcalDelete / gcalWatchEvents / gcalStopChannel :
//     opèrent sur un token DÉJÀ frais (signature `(token, ...)`). Pas de
//     refresh lazy en interne : sur 401 l'appelant relance getGcalAccessToken
//     puis re-tente UNE fois (politique 401 → refresh + retry 1× décrite par
//     le brief Sprint 33, implémentée côté handler haut-niveau).
//
// Conventions communes à TOUS les appels REST (cf. brief Sprint 33 A1) :
//   - Authorization: `Bearer ${token}` + Accept: application/json
//     (+ Content-Type: application/json si body présent)
//   - Timeout 10s via AbortController + clearTimeout finally (zéro timer fuyant)
//   - Retry exp 429/5xx (max 3) — délais 500/1000/2000 ms
//   - Throw CalendarApiError { code, statusCode, raw } sur erreur HTTP/JSON
//
// NB : la table oauth_connections n'a pas de contrainte UNIQUE sur (client_id,
// provider) → on lit LIMIT 1 ORDER BY created_at DESC (calque getGbpAccessToken).

import type { Env } from '../types';
// decryptToken/encryptToken sont exportés par migration-ghl-oauth.ts (source
// réelle). oauth.ts les importe lui-même de là (cf. oauth.ts:40) — on calque
// cet import direct plutôt qu'un re-export inexistant.
import { decryptToken, encryptToken } from '../migration-ghl-oauth';
// checkRateLimit importé pour usage handler-level (rate-limit côté wrapper de
// haut niveau, pas dans ces helpers token-only — cf. note ci-dessus).
import { checkRateLimit } from './rate-limit';

// ── Types publics ──────────────────────────────────────────────────────────

// Auth minimal attendu : clientId requis (bornage tenant). On accepte les
// formes utilisées dans le repo (auth direct ou tenant-context enrichi).
export interface GcalAuth {
  clientId?: string;
  tenant?: { clientId?: string | null };
}

// Erreur métier API Calendar — distingue les erreurs réseau (throw natif
// fetch) des erreurs HTTP/applicatives (statusCode + body brut conservé pour
// audit). Nom partagé avec outlook-client.ts (interopérable côté handlers).
export class CalendarApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly raw: unknown;
  constructor(message: string, opts: { code: string; statusCode: number; raw: unknown }) {
    super(message);
    this.name = 'CalendarApiError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.raw = opts.raw;
  }
}

// Helper rate-limit exporté pour les handlers haut-niveau (clef conventionnée
// brief : `cal:${clientId}:google_calendar`, fenêtre 60/min). Best-effort
// fail-open (cf. checkRateLimit) — jamais bloquant si table absente.
export async function gcalCheckRateLimit(env: Env, clientId: string): Promise<void> {
  const rl = await checkRateLimit(env, `cal:${clientId}:google_calendar`, 60, 60);
  if (!rl.allowed) {
    throw new CalendarApiError('Google Calendar rate limit dépassé', {
      code: 'rate_limited',
      statusCode: 429,
      raw: { retry_after_seconds: rl.retry_after_seconds, bucket_key: rl.bucket_key },
    });
  }
}

// ── Constantes internes (endpoints + tuning) ───────────────────────────────

const ENDPOINTS = {
  // Calendar v3 — endpoint canonique pour calendars + events + watch.
  calendarV3: 'https://www.googleapis.com/calendar/v3',
  // OAuth refresh — endpoint Google standard (réutilisé tel quel).
  oauthToken: 'https://oauth2.googleapis.com/token',
} as const;

const PROVIDER = 'google_calendar' as const;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [500, 1000, 2000]; // exponential backoff (max 3)

// ── Helpers internes ───────────────────────────────────────────────────────

// Résolution tenant STRICTE depuis l'auth (calque tenantOf de oauth.ts /
// resolveClientId de gbp-client.ts). Renvoie null si non résoluble — l'appelant
// doit gérer en gracieux.
function resolveClientId(auth: GcalAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// Sleep utilitaire pour le backoff.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Credentials app OAuth Google Calendar : priorité GCAL_SYNC_*, fallback
// GOOGLE_OAUTH_* (cf. en-tête). Si AUCUN couple complet → null (refresh
// impossible, l'appelant tombera en gracieux).
function gcalOauthCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  // Les vars GCAL_SYNC_* ne sont pas encore typées dans Env (types.ts:87-88
  // ne déclare que GOOGLE_OAUTH_*). On lit via un cast contrôlé pour permettre
  // le câblage Sprint 33 sans modifier types.ts (hors-scope Agent A1).
  const e = env as unknown as Record<string, string | undefined>;
  const gcalId = e.GCAL_SYNC_OAUTH_CLIENT_ID;
  const gcalSecret = e.GCAL_SYNC_OAUTH_CLIENT_SECRET;
  if (gcalId && gcalSecret) {
    return { clientId: gcalId, clientSecret: gcalSecret };
  }
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    };
  }
  return null;
}

// fetch borné timeout 10s via AbortController — clearTimeout TOUJOURS appelé
// (zéro timer fuyant). Calque gbp-client.ts:fetchWithTimeout.
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Wrapper REST commun token-only : ajoute Authorization Bearer + Accept (+
// Content-Type si body), timeout 10s, retry exp 429/5xx (max 3), parse JSON,
// throw CalendarApiError sur erreur HTTP/JSON. Renvoie le body parsé typé.
// Pas de rate-limit ni refresh ici : ces décisions appartiennent à l'appelant
// (qui a env + auth — cf. gcalCheckRateLimit / getGcalAccessToken exportés).
async function gcalFetch<T = unknown>(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const hasBody = init.body != null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { ...init, headers }, FETCH_TIMEOUT_MS);
      lastResponse = res;

      // Succès : 204 No Content (DELETE) ou body vide → {} ; sinon JSON typé.
      if (res.ok) {
        if (res.status === 204) return {} as T;
        const text = await res.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new CalendarApiError('Réponse Google Calendar non-JSON', {
            code: 'invalid_response',
            statusCode: res.status,
            raw: text,
          });
        }
      }

      // Retryable : 429 ou 5xx. 401 propagé tel quel (handler haut-niveau
      // gère le refresh + retry 1× — cf. en-tête de fichier).
      const isRetryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (isRetryable && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
        continue;
      }

      // Non-retryable ou retries épuisés → throw CalendarApiError.
      let rawBody: unknown = null;
      try {
        rawBody = await res.json();
      } catch {
        try {
          rawBody = await res.text();
        } catch {
          rawBody = null;
        }
      }
      const errObj = (rawBody as { error?: { status?: string; message?: string } })?.error;
      throw new CalendarApiError(errObj?.message || `Google Calendar API error ${res.status}`, {
        code: errObj?.status || `http_${res.status}`,
        statusCode: res.status,
        raw: rawBody,
      });
    } catch (err) {
      lastError = err;
      if (err instanceof CalendarApiError) throw err;
      // Erreur réseau / AbortError (timeout) → retry si possible.
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
        continue;
      }
      throw new CalendarApiError('Google Calendar fetch network/timeout error', {
        code: 'network_error',
        statusCode: lastResponse?.status ?? 0,
        raw: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new CalendarApiError('Google Calendar fetch failed (unknown)', {
    code: 'unknown',
    statusCode: lastResponse?.status ?? 0,
    raw: lastError instanceof Error ? lastError.message : String(lastError),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  TOKEN — getGcalAccessToken (refresh lazy, calque getGbpAccessToken)
// ════════════════════════════════════════════════════════════════════════════

// Lit oauth_connections borné tenant (client_id + provider='google_calendar'),
// déchiffre access_token, refresh lazy si expires_at <= now + 60s via
// refresh_token (POST oauth2.googleapis.com/token avec les creds GCAL_SYNC_*
// puis GOOGLE_OAUTH_* en fallback). UPDATE chiffré en base si refresh OK.
// Renvoie null si pas de connexion / pas de creds tenant résolvable ;
// best-effort sinon (jamais throw : l'appelant tombe en gracieux côté UI).
export async function getGcalAccessToken(
  env: Env,
  auth: GcalAuth,
): Promise<string | null> {
  const creds = gcalOauthCredentials(env);
  const clientId = resolveClientId(auth);
  if (!clientId) return null;

  try {
    const conn = (await env.DB.prepare(
      `SELECT id, access_token, refresh_token, expires_at
         FROM oauth_connections
        WHERE client_id = ? AND provider = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(clientId, PROVIDER)
      .first()) as
      | { id: string; access_token: string; refresh_token: string; expires_at: string | null }
      | null;

    if (!conn || !conn.access_token) return null;

    const accessToken = await decryptToken(conn.access_token, env);

    // Token encore valide (>60s avant expiry) → renvoyé tel quel.
    const notExpired =
      !conn.expires_at || new Date(conn.expires_at).getTime() > Date.now() + 60_000;
    if (notExpired) return accessToken;

    // Expiré : si pas de creds app OU pas de refresh_token → best-effort
    // renvoyer l'access courant (l'API renverra 401, le handler gérera).
    if (!creds || !conn.refresh_token) return accessToken;

    const refreshToken = await decryptToken(conn.refresh_token, env);
    if (!refreshToken) return accessToken;

    const resp = await fetchWithTimeout(
      ENDPOINTS.oauthToken,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      },
      FETCH_TIMEOUT_MS,
    );
    if (!resp.ok) return accessToken; // refresh KO → best-effort ancien token
    const d = (await resp.json()) as { access_token?: string; expires_in?: number };
    if (!d.access_token) return accessToken;

    // Re-chiffrement + UPDATE borné tenant (Google ne renvoie quasi jamais un
    // nouveau refresh_token sur refresh → on conserve l'existant chiffré).
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
    // Best-effort : jamais throw pour la lecture token (l'appelant tombe en
    // gracieux côté UI : pas de connexion → état vide, pas d'erreur dure).
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CALENDARS — GET /users/me/calendarList
// ════════════════════════════════════════════════════════════════════════════

// Liste les calendriers visibles par l'utilisateur token-porteur. Renvoie
// `items` brut Google (pas de normalisation : les handlers haut-niveau
// décident du subset à exposer côté UI).
export async function gcalListCalendars(token: string): Promise<any[]> {
  const url = `${ENDPOINTS.calendarV3}/users/me/calendarList`;
  const data = await gcalFetch<{ items?: any[] }>(token, url);
  return data.items ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENTS LIST — GET /calendars/{calendarId}/events?singleEvents=true
// ════════════════════════════════════════════════════════════════════════════

// singleEvents=true → expansion des récurrences (instances individuelles
// renvoyées), nécessaire pour un sync side-by-side avec Outlook qui n'a pas
// la même notion native de "master + exceptions".
//
// calendarId : peut contenir des caractères réservés (ex. email contenant @ +
// suffixe @group.calendar.google.com) → encodeURIComponent obligatoire.
export async function gcalListEvents(
  token: string,
  calendarId: string,
  params: { timeMin?: string; timeMax?: string; pageToken?: string } = {},
): Promise<{ items: any[]; nextPageToken?: string }> {
  const qp = new URLSearchParams({ singleEvents: 'true' });
  if (params.timeMin) qp.set('timeMin', params.timeMin);
  if (params.timeMax) qp.set('timeMax', params.timeMax);
  if (params.pageToken) qp.set('pageToken', params.pageToken);
  const url =
    `${ENDPOINTS.calendarV3}/calendars/${encodeURIComponent(calendarId)}/events?${qp.toString()}`;
  const data = await gcalFetch<{ items?: any[]; nextPageToken?: string }>(token, url);
  return { items: data.items ?? [], nextPageToken: data.nextPageToken };
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT GET — GET /calendars/{calendarId}/events/{eventId}
// ════════════════════════════════════════════════════════════════════════════

export async function gcalGetEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<any> {
  const url =
    `${ENDPOINTS.calendarV3}/calendars/${encodeURIComponent(calendarId)}` +
    `/events/${encodeURIComponent(eventId)}`;
  return await gcalFetch<any>(token, url);
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT CREATE — POST /calendars/{calendarId}/events
// ════════════════════════════════════════════════════════════════════════════

export async function gcalCreateEvent(
  token: string,
  calendarId: string,
  payload: Record<string, unknown>,
): Promise<any> {
  const url = `${ENDPOINTS.calendarV3}/calendars/${encodeURIComponent(calendarId)}/events`;
  return await gcalFetch<any>(token, url, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT PATCH — PATCH /calendars/{calendarId}/events/{eventId}
// ════════════════════════════════════════════════════════════════════════════

// If-Match: <etag> → concurrence optimiste (Google rejette 412 si l'event a
// changé côté serveur entre le GET et le PATCH — au handler de re-GET puis
// merger). etag attendu sous la forme exacte renvoyée par Google (souvent
// quoté : `"abc123def"`).
export async function gcalPatchEvent(
  token: string,
  calendarId: string,
  eventId: string,
  payload: Record<string, unknown>,
  etag: string,
): Promise<any> {
  const url =
    `${ENDPOINTS.calendarV3}/calendars/${encodeURIComponent(calendarId)}` +
    `/events/${encodeURIComponent(eventId)}`;
  return await gcalFetch<any>(token, url, {
    method: 'PATCH',
    headers: { 'If-Match': etag },
    body: JSON.stringify(payload),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT DELETE — DELETE /calendars/{calendarId}/events/{eventId}
// ════════════════════════════════════════════════════════════════════════════

export async function gcalDeleteEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const url =
    `${ENDPOINTS.calendarV3}/calendars/${encodeURIComponent(calendarId)}` +
    `/events/${encodeURIComponent(eventId)}`;
  await gcalFetch<void>(token, url, { method: 'DELETE' });
}

// ════════════════════════════════════════════════════════════════════════════
//  WATCH — POST /calendars/{calendarId}/events/watch
// ════════════════════════════════════════════════════════════════════════════

// Crée un channel push notifications. Google appellera `address` (HTTPS
// public) à chaque changement sur le calendrier jusqu'à expiration.
//   - channelId   : UUID v4 généré côté Worker
//   - address     : URL HTTPS publique du Worker (webhook)
//   - tokenSecret : valeur arbitraire renvoyée dans X-Goog-Channel-Token →
//                   sert à valider l'origine des callbacks côté webhook
//
// La réponse contient `resourceId` à stocker (requis pour stopChannel).
export async function gcalWatchEvents(
  token: string,
  calendarId: string,
  channelId: string,
  address: string,
  tokenSecret: string,
): Promise<any> {
  const url = `${ENDPOINTS.calendarV3}/calendars/${encodeURIComponent(calendarId)}/events/watch`;
  return await gcalFetch<any>(token, url, {
    method: 'POST',
    body: JSON.stringify({
      id: channelId,
      type: 'web_hook',
      address,
      token: tokenSecret,
    }),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  STOP CHANNEL — POST /channels/stop
// ════════════════════════════════════════════════════════════════════════════

// Arrête un channel push (revoque les notifications futures). resourceId est
// renvoyé par gcalWatchEvents dans la réponse (à persister côté Worker).
export async function gcalStopChannel(
  token: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  const url = `${ENDPOINTS.calendarV3}/channels/stop`;
  await gcalFetch<void>(token, url, {
    method: 'POST',
    body: JSON.stringify({ id: channelId, resourceId }),
  });
}
