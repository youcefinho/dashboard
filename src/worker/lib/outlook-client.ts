// ── lib/outlook-client.ts — Sprint 33 (Agent A1) ────────────────────────────
//
// Helpers REST Microsoft Graph (Outlook Calendar) côté Worker, calqués sur
// le pattern lib/gbp-client.ts (Sprint 32 A1) + lib/gcal-client.ts (Sprint 33
// A1) : refresh OAuth lazy via login.microsoftonline.com, tokens chiffrés
// AES-GCM en base, bornage tenant STRICT depuis auth.clientId (JAMAIS lu du
// body), wrapper fetch commun avec timeout 10s + retry exp 429/5xx, erreurs
// typées CalendarApiError (jamais 500 nu).
//
// Provider fixe ici = 'outlook' (table oauth_connections.provider).
// Refresh OAuth via https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
// avec :
//   - env.MS_OAUTH_TENANT (par défaut 'common' — multi-tenant Microsoft)
//   - env.MS_OAUTH_CLIENT_ID / env.MS_OAUTH_CLIENT_SECRET (app Microsoft
//     dédiée Sprint 33 ; absents → refresh impossible, fallback gracieux)
//
// Découpe des responsabilités (calque gcal-client.ts) :
//   - getOutlookAccessToken(env, auth) : lecture D1 + refresh lazy + UPDATE
//     chiffré. Renvoie un token frais (ou null en gracieux). Borne le tenant.
//   - outlookListCalendars / outlookListEvents / outlookGetEvent /
//     outlookCreateEvent / outlookPatchEvent / outlookDeleteEvent /
//     outlookCreateSubscription / outlookDeleteSubscription :
//     opèrent sur un token DÉJÀ frais (signature `(token, ...)`). Pas de
//     refresh lazy en interne : sur 401 l'appelant relance
//     getOutlookAccessToken puis re-tente UNE fois (politique 401 → refresh
//     + retry 1× décrite par le brief Sprint 33, implémentée côté handler).
//
// Conventions communes à TOUS les appels REST (cf. brief Sprint 33 A1) :
//   - Authorization: `Bearer ${token}` + Accept: application/json
//     (+ Content-Type: application/json si body présent)
//   - Timeout 10s via AbortController + clearTimeout finally (zéro timer fuyant)
//   - Retry exp 429/5xx (max 3) — délais 500/1000/2000 ms
//   - Throw CalendarApiError { code, statusCode, raw } sur erreur HTTP/JSON
//
// NB Microsoft Graph :
//   - Pagination via @odata.nextLink (URL absolue prête à refetch — pas un
//     pageToken à recoller manuellement). On expose `nextLink` brut.
//   - ETag pour PATCH : Graph renvoie un @odata.etag par event ; on attend
//     une valeur DÉJÀ encadrée par guillemets (W/"abc...") au format ETag.
//   - Subscriptions : ressource type pour calendar/events =
//     "me/calendars/{calId}/events" — clientState arbitraire renvoyé dans
//     chaque webhook (validation d'origine côté handler webhook).

import type { Env } from '../types';
// decryptToken/encryptToken sont exportés par migration-ghl-oauth.ts (source
// réelle, cf. oauth.ts:40).
import { decryptToken, encryptToken } from '../migration-ghl-oauth';
// checkRateLimit importé pour usage handler-level (rate-limit côté wrapper
// de haut niveau, pas dans ces helpers token-only — cf. gcal-client.ts).
import { checkRateLimit } from './rate-limit';
// CalendarApiError partagée avec gcal-client.ts pour interop côté handlers.
import { CalendarApiError } from './gcal-client';

// Ré-export pour les consommateurs qui n'importent que outlook-client.
export { CalendarApiError };

// ── Types publics ──────────────────────────────────────────────────────────

// Auth minimal attendu : clientId requis (bornage tenant). On accepte les
// formes utilisées dans le repo (auth direct ou tenant-context enrichi).
//
// ⚠ Le mot "tenant" est ici l'INTRALYS tenant (client_id Intralys interne) —
// PAS le tenant Microsoft (qui s'appelle msTenant côté env, distinct).
export interface OutlookAuth {
  clientId?: string;
  tenant?: { clientId?: string | null };
}

// Helper rate-limit exporté pour les handlers haut-niveau (clef conventionnée
// brief : `cal:${clientId}:outlook`, fenêtre 60/min). Best-effort fail-open
// (cf. checkRateLimit) — jamais bloquant si table absente.
export async function outlookCheckRateLimit(env: Env, clientId: string): Promise<void> {
  const rl = await checkRateLimit(env, `cal:${clientId}:outlook`, 60, 60);
  if (!rl.allowed) {
    throw new CalendarApiError('Outlook (Graph) rate limit dépassé', {
      code: 'rate_limited',
      statusCode: 429,
      raw: { retry_after_seconds: rl.retry_after_seconds, bucket_key: rl.bucket_key },
    });
  }
}

// ── Constantes internes (endpoints + tuning) ───────────────────────────────

const ENDPOINTS = {
  // Microsoft Graph v1.0 — endpoint canonique pour calendars + events +
  // subscriptions. /me/* pour le compte token-porteur.
  graphV1: 'https://graph.microsoft.com/v1.0',
  // OAuth refresh — endpoint Microsoft Identity Platform v2.0. {tenant}
  // remplacé à l'exécution par env.MS_OAUTH_TENANT (défaut 'common').
  oauthTokenTemplate: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
} as const;

const PROVIDER = 'outlook' as const;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [500, 1000, 2000]; // exponential backoff (max 3)

// ── Helpers internes ───────────────────────────────────────────────────────

// Résolution tenant STRICTE depuis l'auth.
function resolveClientId(auth: OutlookAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// Sleep utilitaire pour le backoff.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Credentials app OAuth Microsoft : MS_OAUTH_CLIENT_ID/SECRET + MS_OAUTH_TENANT
// (défaut 'common'). Si AUCUN couple complet (id+secret) → null (refresh
// impossible). Les vars MS_* ne sont pas encore typées dans Env (hors-scope
// Agent A1) → cast contrôlé.
function outlookOauthCredentials(env: Env): {
  clientId: string;
  clientSecret: string;
  tenant: string;
} | null {
  const e = env as unknown as Record<string, string | undefined>;
  const id = e.MS_OAUTH_CLIENT_ID;
  const secret = e.MS_OAUTH_CLIENT_SECRET;
  const tenant = e.MS_OAUTH_TENANT || 'common';
  if (id && secret) return { clientId: id, clientSecret: secret, tenant };
  return null;
}

// fetch borné timeout 10s via AbortController — clearTimeout TOUJOURS appelé.
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

// Wrapper REST commun token-only : Authorization Bearer + Accept (+ Content-
// Type si body), timeout 10s, retry exp 429/5xx (max 3), parse JSON, throw
// CalendarApiError. Pas de rate-limit ni refresh ici (cf. en-tête).
async function outlookFetch<T = unknown>(
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

      // Succès : 204 No Content (DELETE/subscription delete) ou body vide →
      // {} ; sinon JSON typé. Graph renvoie 201 sur create avec body, 200
      // sur GET/PATCH, 204 sur DELETE.
      if (res.ok) {
        if (res.status === 204) return {} as T;
        const text = await res.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new CalendarApiError('Réponse Outlook (Graph) non-JSON', {
            code: 'invalid_response',
            statusCode: res.status,
            raw: text,
          });
        }
      }

      // Retryable : 429 ou 5xx. 401 propagé tel quel (handler haut-niveau
      // gère refresh + retry 1×). 412 (precondition If-Match) → propagé tel
      // quel : signal métier au handler pour re-GET + merge.
      const isRetryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (isRetryable && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
        continue;
      }

      // Non-retryable ou retries épuisés → throw CalendarApiError.
      // Graph renvoie un objet error structuré : { error: { code, message } }.
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
      const errObj = (rawBody as { error?: { code?: string; message?: string } })?.error;
      throw new CalendarApiError(errObj?.message || `Outlook (Graph) API error ${res.status}`, {
        code: errObj?.code || `http_${res.status}`,
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
      throw new CalendarApiError('Outlook (Graph) fetch network/timeout error', {
        code: 'network_error',
        statusCode: lastResponse?.status ?? 0,
        raw: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new CalendarApiError('Outlook (Graph) fetch failed (unknown)', {
    code: 'unknown',
    statusCode: lastResponse?.status ?? 0,
    raw: lastError instanceof Error ? lastError.message : String(lastError),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  TOKEN — getOutlookAccessToken (refresh lazy)
// ════════════════════════════════════════════════════════════════════════════

// Lit oauth_connections borné tenant (client_id + provider='outlook'),
// déchiffre access_token, refresh lazy si expires_at <= now + 60s via
// refresh_token (POST login.microsoftonline.com/{tenant}/oauth2/v2.0/token).
// UPDATE chiffré en base si refresh OK. Renvoie null si pas de connexion /
// pas de creds tenant résolvable ; best-effort sinon (jamais throw).
//
// Microsoft renvoie SOUVENT un nouveau refresh_token sur refresh (rotation
// activable côté app) → on l'updatera si présent (contrairement à Google qui
// le renvoie rarement). On stocke aussi le scope retourné s'il diffère.
export async function getOutlookAccessToken(
  env: Env,
  auth: OutlookAuth,
): Promise<string | null> {
  const creds = outlookOauthCredentials(env);
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

    const tokenUrl = ENDPOINTS.oauthTokenTemplate.replace('{tenant}', creds.tenant);
    const resp = await fetchWithTimeout(
      tokenUrl,
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
    const d = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!d.access_token) return accessToken;

    // Re-chiffrement + UPDATE borné tenant. Si Microsoft renvoie un nouveau
    // refresh_token (rotation) → on le persiste chiffré ; sinon on conserve
    // l'existant en base.
    const encAccess = await encryptToken(d.access_token, env);
    const newExpiresAt = new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString();
    if (d.refresh_token) {
      const encRefresh = await encryptToken(d.refresh_token, env);
      await env.DB.prepare(
        `UPDATE oauth_connections
            SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
        .bind(encAccess, encRefresh, newExpiresAt, conn.id, clientId)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE oauth_connections
            SET access_token = ?, expires_at = ?, updated_at = datetime('now')
          WHERE id = ? AND client_id = ?`,
      )
        .bind(encAccess, newExpiresAt, conn.id, clientId)
        .run();
    }

    return d.access_token;
  } catch {
    // Best-effort : jamais throw pour la lecture token.
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CALENDARS — GET /me/calendars
// ════════════════════════════════════════════════════════════════════════════

// Liste les calendriers du user token-porteur. Renvoie `value` brut Graph
// (pas de normalisation : handler haut-niveau choisit le subset).
export async function outlookListCalendars(token: string): Promise<any[]> {
  const url = `${ENDPOINTS.graphV1}/me/calendars`;
  const data = await outlookFetch<{ value?: any[] }>(token, url);
  return data.value ?? [];
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENTS LIST — GET /me/calendars/{calId}/events?$filter=...&$top=50
// ════════════════════════════════════════════════════════════════════════════

// params :
//   - timeMin / timeMax : ISO 8601 — convertis en $filter OData
//     (start/dateTime ge ... and end/dateTime le ...).
//     Graph attend du DateTime sans Z dans le filter, mais accepte Z aussi.
//   - top                : taille de page (défaut 50 — calque brief).
//   - nextLink           : si présent, on REUSE l'URL absolue Graph telle
//                          quelle (override total — Graph encode déjà tous
//                          les params dans @odata.nextLink).
//
// calId : encodeURIComponent obligatoire (peut contenir des caractères
// réservés selon l'origine du compte).
export async function outlookListEvents(
  token: string,
  calendarId: string,
  params: {
    timeMin?: string;
    timeMax?: string;
    top?: number;
    nextLink?: string;
  } = {},
): Promise<{ value: any[]; nextLink?: string }> {
  let url: string;
  if (params.nextLink) {
    // @odata.nextLink est une URL absolue complète — on l'utilise telle quelle.
    url = params.nextLink;
  } else {
    const qp = new URLSearchParams();
    qp.set('$top', String(params.top ?? 50));
    const filters: string[] = [];
    if (params.timeMin) filters.push(`start/dateTime ge '${params.timeMin}'`);
    if (params.timeMax) filters.push(`end/dateTime le '${params.timeMax}'`);
    if (filters.length > 0) qp.set('$filter', filters.join(' and '));
    url =
      `${ENDPOINTS.graphV1}/me/calendars/${encodeURIComponent(calendarId)}/events?${qp.toString()}`;
  }
  const data = await outlookFetch<{ value?: any[]; '@odata.nextLink'?: string }>(token, url);
  return {
    value: data.value ?? [],
    nextLink: data['@odata.nextLink'],
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT GET — GET /me/calendars/{calId}/events/{eventId}
// ════════════════════════════════════════════════════════════════════════════

export async function outlookGetEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<any> {
  const url =
    `${ENDPOINTS.graphV1}/me/calendars/${encodeURIComponent(calendarId)}` +
    `/events/${encodeURIComponent(eventId)}`;
  return await outlookFetch<any>(token, url);
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT CREATE — POST /me/calendars/{calId}/events
// ════════════════════════════════════════════════════════════════════════════

export async function outlookCreateEvent(
  token: string,
  calendarId: string,
  payload: Record<string, unknown>,
): Promise<any> {
  const url = `${ENDPOINTS.graphV1}/me/calendars/${encodeURIComponent(calendarId)}/events`;
  return await outlookFetch<any>(token, url, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT PATCH — PATCH /me/calendars/{calId}/events/{eventId}
// ════════════════════════════════════════════════════════════════════════════

// If-Match: <etag> → concurrence optimiste (Graph rejette 412 si l'event a
// changé côté serveur entre le GET et le PATCH). etag attendu sous la forme
// exacte renvoyée par Graph dans @odata.etag : `W/"abc..."` (weak ETag).
export async function outlookPatchEvent(
  token: string,
  calendarId: string,
  eventId: string,
  payload: Record<string, unknown>,
  etag: string,
): Promise<any> {
  const url =
    `${ENDPOINTS.graphV1}/me/calendars/${encodeURIComponent(calendarId)}` +
    `/events/${encodeURIComponent(eventId)}`;
  return await outlookFetch<any>(token, url, {
    method: 'PATCH',
    headers: { 'If-Match': etag },
    body: JSON.stringify(payload),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT DELETE — DELETE /me/calendars/{calId}/events/{eventId}
// ════════════════════════════════════════════════════════════════════════════

export async function outlookDeleteEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const url =
    `${ENDPOINTS.graphV1}/me/calendars/${encodeURIComponent(calendarId)}` +
    `/events/${encodeURIComponent(eventId)}`;
  await outlookFetch<void>(token, url, { method: 'DELETE' });
}

// ════════════════════════════════════════════════════════════════════════════
//  SUBSCRIPTION CREATE — POST /subscriptions
// ════════════════════════════════════════════════════════════════════════════

// Crée une subscription Graph (équivalent watch Google). Graph appellera
// notificationUrl (HTTPS public Worker) à chaque changement sur les events
// du calendrier ciblé, jusqu'à expiresAt.
//
//   - calendarId       : id du calendrier Graph (resource = me/calendars/{id}/events)
//   - notificationUrl  : URL HTTPS publique du Worker (webhook). Graph
//                        envoie d'abord une requête validationToken — le
//                        handler webhook doit échoir 200 + text/plain avec
//                        ce token (sinon Graph n'active pas la subscription).
//   - clientState      : valeur arbitraire renvoyée dans chaque webhook —
//                        sert à valider l'origine côté handler.
//   - expiresAt        : ISO 8601 — limite max ~3 jours pour calendar events
//                        (cf. Graph docs : 4230 min). Au-delà → 400.
//
// changeType figé "created,updated,deleted" : couvre tous les sync cases.
// Si besoin d'un subset (ex. "created" seul pour un audit log), exposer un
// param plus tard.
export async function outlookCreateSubscription(
  token: string,
  calendarId: string,
  notificationUrl: string,
  clientState: string,
  expiresAt: string,
): Promise<any> {
  const url = `${ENDPOINTS.graphV1}/subscriptions`;
  return await outlookFetch<any>(token, url, {
    method: 'POST',
    body: JSON.stringify({
      changeType: 'created,updated,deleted',
      notificationUrl,
      resource: `me/calendars/${calendarId}/events`,
      expirationDateTime: expiresAt,
      clientState,
    }),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  SUBSCRIPTION DELETE — DELETE /subscriptions/{subscriptionId}
// ════════════════════════════════════════════════════════════════════════════

// Désactive une subscription Graph (revoque les notifications futures).
// subscriptionId est renvoyé par outlookCreateSubscription dans la réponse
// (à persister côté Worker).
export async function outlookDeleteSubscription(
  token: string,
  subscriptionId: string,
): Promise<void> {
  const url = `${ENDPOINTS.graphV1}/subscriptions/${encodeURIComponent(subscriptionId)}`;
  await outlookFetch<void>(token, url, { method: 'DELETE' });
}
