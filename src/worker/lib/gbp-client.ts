// ── lib/gbp-client.ts — Sprint 32 (Agent A1) ────────────────────────────────
//
// Helpers REST Google Business Profile (GBP) côté Worker, calqués sur le
// pattern oauth.ts:getOauthAccessToken (refresh lazy, tokens chiffrés
// AES-GCM en base, bornage tenant STRICT depuis auth.clientId — JAMAIS body).
//
// Provider fixe ici = 'google_business' (table oauth_connections.provider).
// Refresh OAuth via https://oauth2.googleapis.com/token (mêmes credentials
// app que oauth.ts → GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).
//
// Conventions communes à TOUS les appels REST :
//   - Authorization: `Bearer ${accessToken}`
//   - Timeout 10s via AbortController (pas de timer fuyant)
//   - Retry exponentiel (max 3 tentatives) sur 429 / 5xx — délais 500/1000/2000ms
//   - Rate-limit best-effort via checkRateLimit (clef `gbp:{clientId}`, 60/min)
//   - Erreurs API → throw GbpApiError { code, statusCode, raw } (jamais 500 nu)
//
// NB : la table oauth_connections n'a pas de contrainte UNIQUE sur (client_id,
// provider) → on lit LIMIT 1 ORDER BY created_at DESC (calque getOauthAccessToken).
// L'écriture (upsert) de la connexion 'google_business' est hors-scope de ce
// fichier (faite côté handler OAuth dédié Sprint 32).

import type { Env } from '../types';
// decryptToken est exporté par migration-ghl-oauth.ts (source réelle).
// oauth.ts l'importe lui-même de là (cf. oauth.ts:40) — on calque cet import
// direct plutôt qu'un re-export inexistant.
import { decryptToken, encryptToken } from '../migration-ghl-oauth';
import { checkRateLimit } from './rate-limit';

// ── Types publics ──────────────────────────────────────────────────────────

// Auth minimal attendu : clientId requis (bornage tenant). On accepte les
// formes utilisées dans le repo (auth direct ou tenant-context enrichi).
export interface GbpAuth {
  clientId?: string;
  tenant?: { clientId?: string | null };
}

export interface GbpAccount {
  name: string;            // ex. "accounts/123456789"
  accountName?: string;
  type?: string;           // PERSONAL / LOCATION_GROUP / ORGANIZATION ...
  role?: string;
  verificationState?: string;
  vettedState?: string;
  raw?: Record<string, unknown>;
}

export interface GbpLocation {
  name: string;            // ex. "locations/987654321"
  title?: string;
  primaryPhone?: string;
  storeCode?: string;
  categories?: {
    primaryCategory?: { name?: string; displayName?: string };
    additionalCategories?: Array<{ name?: string; displayName?: string }>;
  };
  raw?: Record<string, unknown>;
}

export interface GbpReview {
  name: string;            // ex. "accounts/{a}/locations/{l}/reviews/{r}"
  reviewId?: string;
  reviewer?: { profilePhotoUrl?: string; displayName?: string; isAnonymous?: boolean };
  starRating?: 'STAR_RATING_UNSPECIFIED' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
  raw?: Record<string, unknown>;
}

// Erreur métier API GBP — distingue les erreurs réseau (throw natif fetch)
// des erreurs HTTP/applicatives (statusCode + body brut conservé pour audit).
export class GbpApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly raw: unknown;
  constructor(message: string, opts: { code: string; statusCode: number; raw: unknown }) {
    super(message);
    this.name = 'GbpApiError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.raw = opts.raw;
  }
}

// ── Constantes internes (endpoints + tuning) ───────────────────────────────

// GBP est éclaté sur PLUSIEURS sous-APIs Google (Account Management v1,
// My Business v4 legacy, Business Profile Performance v1). On documente
// la racine de chaque API à l'usage.
const ENDPOINTS = {
  // Account Management v1 — comptes + locations metadata
  accountManagement: 'https://mybusinessaccountmanagement.googleapis.com/v1',
  // Business Information v1 — locations détaillées (readMask)
  businessInfo: 'https://mybusinessbusinessinformation.googleapis.com/v1',
  // My Business v4 — reviews + localPosts (API legacy mais toujours active)
  myBusinessV4: 'https://mybusiness.googleapis.com/v4',
  // Business Profile Performance v1 — insights / fetchMultiDailyMetricsTimeSeries
  performance: 'https://businessprofileperformance.googleapis.com/v1',
  // OAuth refresh — endpoint Google standard (réutilisé tel quel)
  oauthToken: 'https://oauth2.googleapis.com/token',
} as const;

const PROVIDER = 'google_business' as const;
const RATE_LIMIT_MAX = 60;          // 60 requêtes / minute / tenant
const RATE_LIMIT_WINDOW_SEC = 60;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [500, 1000, 2000]; // exponential backoff (max 3)

// ── Helpers internes ───────────────────────────────────────────────────────

// Résolution tenant STRICTE depuis l'auth (calque tenantOf de oauth.ts).
// Renvoie null si le tenant n'est pas résoluble — l'appelant doit gérer.
function resolveClientId(auth: GbpAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// Sleep utilitaire pour le backoff (Promise wrapper sur setTimeout).
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Credentials app OAuth Google (réutilise les mêmes secrets que oauth.ts —
// GOOGLE_OAUTH_CLIENT_ID/SECRET). Absents → refresh impossible, null.
function googleOauthCredentials(env: Env): { clientId: string; clientSecret: string } | null {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
}

// fetch borné timeout 10s via AbortController — clearTimeout TOUJOURS appelé
// (zéro timer fuyant). Calque le pattern de lib/fetch-timeout.ts mais inline
// ici pour rester self-contained (l'helper externe accepte les mêmes options).
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

// Wrapper REST commun : ajoute Authorization Bearer, rate-limit, timeout,
// retry exponentiel 429/5xx, parse JSON, throw GbpApiError sur erreur API.
// Renvoie le body parsé (typé par l'appelant via le generic T).
async function gbpFetch<T = unknown>(
  env: Env,
  clientIdForRateLimit: string | null,
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  // Rate-limit best-effort (fail-open si table absente — cf. checkRateLimit).
  // On ne bloque PAS si le clientId est null (cas usage interne avec service
  // account) — la clef devient alors 'gbp:_global' pour visibilité audit.
  const bucketKey = `gbp:${clientIdForRateLimit ?? '_global'}`;
  const rl = await checkRateLimit(env, bucketKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC);
  if (!rl.allowed) {
    throw new GbpApiError('GBP rate limit dépassé', {
      code: 'rate_limited',
      statusCode: 429,
      raw: { retry_after_seconds: rl.retry_after_seconds, bucket_key: rl.bucket_key },
    });
  }

  // Merge headers : Authorization + Accept JSON + headers user-fournis.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };

  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  // Retry loop : tente jusqu'à MAX_RETRIES (3) en cas de 429 / 5xx ou panne
  // réseau transitoire. Sur 4xx≠429 → throw immédiat (pas de retry sur erreur
  // client définitive : 400 / 401 / 403 / 404 → échec final).
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { ...init, headers }, FETCH_TIMEOUT_MS);
      lastResponse = res;

      // Succès : parse body (vide → {}, JSON → typé T).
      if (res.ok) {
        const text = await res.text();
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new GbpApiError('Réponse GBP non-JSON', {
            code: 'invalid_response',
            statusCode: res.status,
            raw: text,
          });
        }
      }

      // Erreur retryable : 429 (rate limit côté Google) ou 5xx.
      const isRetryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (isRetryable && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
        continue;
      }

      // Erreur non-retryable ou retries épuisés → throw GbpApiError.
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
      throw new GbpApiError(errObj?.message || `GBP API error ${res.status}`, {
        code: errObj?.status || `http_${res.status}`,
        statusCode: res.status,
        raw: rawBody,
      });
    } catch (err) {
      lastError = err;
      // Si c'est déjà une GbpApiError → on propage (pas de retry sur erreur métier).
      if (err instanceof GbpApiError) throw err;
      // Erreur réseau / AbortError (timeout) → retry si on a encore des tentatives.
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 2000);
        continue;
      }
      // Retries épuisés sur erreur réseau → wrap en GbpApiError network.
      throw new GbpApiError('GBP fetch network/timeout error', {
        code: 'network_error',
        statusCode: lastResponse?.status ?? 0,
        raw: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Sécurité : si la boucle se termine sans return/throw (ne devrait pas
  // arriver), on lève une erreur explicite plutôt que de retourner undefined.
  throw new GbpApiError('GBP fetch failed (unknown)', {
    code: 'unknown',
    statusCode: lastResponse?.status ?? 0,
    raw: lastError instanceof Error ? lastError.message : String(lastError),
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  TOKEN — getGbpAccessToken (refresh lazy, calque getOauthAccessToken)
// ════════════════════════════════════════════════════════════════════════════

// Lit oauth_connections borné tenant (client_id + provider='google_business'),
// déchiffre access_token, refresh lazy si expires_at <= now + 60s via
// refresh_token (POST oauth2.googleapis.com/token). UPDATE chiffré en base
// si refresh réussi. Renvoie null si pas de connexion / creds app absents /
// refresh KO (best-effort, jamais throw : l'appelant tombe en gracieux).
export async function getGbpAccessToken(
  env: Env,
  auth: GbpAuth,
): Promise<string | null> {
  const creds = googleOauthCredentials(env);
  // Si app OAuth Google pas configurée → refresh impossible. On essaie quand
  // même le token existant (qui peut encore être valide). Sinon null.

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
    // renvoyer l'access courant (l'API renverra 401, l'appelant gérera).
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

    // Re-chiffrement + UPDATE borné tenant (refresh_token rarement renvoyé
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
    // Best-effort : jamais throw pour la lecture token (l'appelant tombe en
    // gracieux côté UI : pas de connexion → état vide, pas d'erreur dure).
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  ACCOUNTS — GET /v1/accounts
// ════════════════════════════════════════════════════════════════════════════

// Liste les comptes GBP accessibles avec le token. Pagination ignorée v1
// (réponse Google généralement < 50 comptes par user — le besoin de
// pageToken est rare ici, on prend la 1ère page).
export async function gbpListAccounts(
  env: Env,
  accessToken: string,
): Promise<GbpAccount[]> {
  const url = `${ENDPOINTS.accountManagement}/accounts`;
  const data = await gbpFetch<{ accounts?: GbpAccount[] }>(env, null, accessToken, url);
  // Normalisation : chaque entrée garde son raw pour audit + champs typés.
  return (data.accounts ?? []).map((a) => ({
    name: a.name,
    accountName: a.accountName,
    type: a.type,
    role: a.role,
    verificationState: a.verificationState,
    vettedState: a.vettedState,
    raw: a as unknown as Record<string, unknown>,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
//  LOCATIONS — GET /v1/accounts/{accountId}/locations
// ════════════════════════════════════════════════════════════════════════════

// readMask figé : name, title, primaryPhone, categories, storeCode (subset
// minimal pour la liste UI ; le détail complet d'une location passe par
// l'API Business Information v1 dédiée hors-scope ici).
//
// accountId : peut être passé soit en forme courte ("123456789") soit en
// forme longue ("accounts/123456789"). On normalise pour accepter les deux.
export async function gbpListLocations(
  env: Env,
  accessToken: string,
  accountId: string,
  pageToken?: string,
): Promise<{ locations: GbpLocation[]; nextPageToken?: string }> {
  const accountPath = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
  const params = new URLSearchParams({
    readMask: 'name,title,phoneNumbers.primaryPhone,categories,storeCode',
  });
  if (pageToken) params.set('pageToken', pageToken);
  // NB : Business Information v1 est l'endpoint canonique pour locations +
  // readMask. mybusinessaccountmanagement ne supporte plus locations depuis
  // la dépréciation 2022. On utilise donc ENDPOINTS.businessInfo ici.
  const url = `${ENDPOINTS.businessInfo}/${accountPath}/locations?${params.toString()}`;
  const data = await gbpFetch<{
    locations?: Array<
      GbpLocation & { phoneNumbers?: { primaryPhone?: string } }
    >;
    nextPageToken?: string;
  }>(env, null, accessToken, url);
  const locations: GbpLocation[] = (data.locations ?? []).map((l) => ({
    name: l.name,
    title: l.title,
    // Google renvoie primaryPhone dans phoneNumbers.primaryPhone — on flatten
    // pour matcher la signature publique GbpLocation.primaryPhone.
    primaryPhone: l.phoneNumbers?.primaryPhone ?? l.primaryPhone,
    storeCode: l.storeCode,
    categories: l.categories,
    raw: l as unknown as Record<string, unknown>,
  }));
  return { locations, nextPageToken: data.nextPageToken };
}

// ════════════════════════════════════════════════════════════════════════════
//  REVIEWS — GET /v4/accounts/{a}/locations/{l}/reviews
// ════════════════════════════════════════════════════════════════════════════

// Liste paginée des reviews d'une location. averageRating + totalReviewCount
// sont renvoyés par Google au niveau racine de la réponse (pas par review).
export async function gbpListReviews(
  env: Env,
  accessToken: string,
  accountId: string,
  locationId: string,
  pageToken?: string,
): Promise<{
  reviews: GbpReview[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}> {
  const accountPath = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`;
  const locationPath = locationId.startsWith('locations/') ? locationId : `locations/${locationId}`;
  const params = new URLSearchParams();
  if (pageToken) params.set('pageToken', pageToken);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const url = `${ENDPOINTS.myBusinessV4}/${accountPath}/${locationPath}/reviews${qs}`;
  const data = await gbpFetch<{
    reviews?: GbpReview[];
    averageRating?: number;
    totalReviewCount?: number;
    nextPageToken?: string;
  }>(env, null, accessToken, url);
  return {
    reviews: (data.reviews ?? []).map((r) => ({
      ...r,
      raw: r as unknown as Record<string, unknown>,
    })),
    averageRating: data.averageRating,
    totalReviewCount: data.totalReviewCount,
    nextPageToken: data.nextPageToken,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  REPLY REVIEW — PUT /v4/{reviewName}/reply
// ════════════════════════════════════════════════════════════════════════════

// reviewName attendu sous forme complète : "accounts/{a}/locations/{l}/reviews/{r}"
// (le name renvoyé par gbpListReviews). On le valide minimalement (présence
// "/reviews/" dans le path) — Google rejette de toute façon les noms mal formés.
// Renvoie { success: false, error } plutôt que throw pour les usages UI où
// l'on affiche un toast (calque le contrat des handlers haut-niveau du repo).
export async function gbpReplyReview(
  env: Env,
  accessToken: string,
  reviewName: string,
  comment: string,
): Promise<{ success: boolean; error?: string }> {
  if (!reviewName || !reviewName.includes('/reviews/')) {
    return { success: false, error: 'reviewName invalide (attendu .../reviews/{id})' };
  }
  if (!comment || !comment.trim()) {
    return { success: false, error: 'comment requis' };
  }
  const url = `${ENDPOINTS.myBusinessV4}/${reviewName}/reply`;
  try {
    await gbpFetch(env, null, accessToken, url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    return { success: true };
  } catch (err) {
    if (err instanceof GbpApiError) {
      return { success: false, error: `${err.code}: ${err.message}` };
    }
    return { success: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  LOCAL POSTS — POST /v4/{locationName}/localPosts
// ════════════════════════════════════════════════════════════════════════════

// payload :
//   - summary       : texte du post (1500 chars max côté Google)
//   - topicType?    : 'STANDARD' | 'EVENT' | 'OFFER' | 'ALERT' (défaut STANDARD)
//   - callToAction? : { actionType, url? } — bouton CTA optionnel
//   - media?        : tableau de { mediaFormat, sourceUrl } pour images
//
// locationName attendu sous forme : "accounts/{a}/locations/{l}".
// Renvoie le name complet du localPost créé pour usage UI (lien direct).
export async function gbpCreateLocalPost(
  env: Env,
  accessToken: string,
  locationName: string,
  payload: {
    summary: string;
    topicType?: 'STANDARD' | 'EVENT' | 'OFFER' | 'ALERT';
    callToAction?: { actionType: string; url?: string };
    media?: Array<{ mediaFormat: 'PHOTO' | 'VIDEO'; sourceUrl: string }>;
  },
): Promise<{ success: boolean; localPostName?: string; error?: string }> {
  if (!locationName || !locationName.includes('locations/')) {
    return { success: false, error: 'locationName invalide (attendu accounts/{a}/locations/{l})' };
  }
  if (!payload.summary || !payload.summary.trim()) {
    return { success: false, error: 'summary requis' };
  }
  const body: Record<string, unknown> = {
    summary: payload.summary,
    languageCode: 'fr', // sites Intralys = FR par défaut (cohérence cross-repo)
    topicType: payload.topicType ?? 'STANDARD',
  };
  if (payload.callToAction) body.callToAction = payload.callToAction;
  if (payload.media && payload.media.length > 0) body.media = payload.media;

  const url = `${ENDPOINTS.myBusinessV4}/${locationName}/localPosts`;
  try {
    const data = await gbpFetch<{ name?: string }>(env, null, accessToken, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { success: true, localPostName: data.name };
  } catch (err) {
    if (err instanceof GbpApiError) {
      return { success: false, error: `${err.code}: ${err.message}` };
    }
    return { success: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  INSIGHTS — POST /v1/{locationName}:fetchMultiDailyMetricsTimeSeries
// ════════════════════════════════════════════════════════════════════════════

// Performance metrics quotidiennes pour une location.
// metrics : ex. ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'CALL_CLICKS', 'WEBSITE_CLICKS']
//   Liste complète : https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries
// startTime / endTime : ISO 8601 (Date) — décomposés ici en daily_range.start_date / end_date
//   tel qu'attendu par l'API (year/month/day séparés).
//
// locationName attendu : "locations/{l}" (sans préfixe accounts/ — l'API
// Performance v1 ne le requiert pas, contrairement à v4).
export async function gbpGetInsights(
  env: Env,
  accessToken: string,
  locationName: string,
  metrics: string[],
  startTime: string,
  endTime: string,
): Promise<unknown> {
  if (!locationName || !locationName.includes('locations/')) {
    throw new GbpApiError('locationName invalide (attendu locations/{id})', {
      code: 'invalid_argument',
      statusCode: 400,
      raw: { locationName },
    });
  }
  if (!metrics || metrics.length === 0) {
    throw new GbpApiError('metrics requis (au moins une métrique)', {
      code: 'invalid_argument',
      statusCode: 400,
      raw: { metrics },
    });
  }
  // L'API v1 attend les métriques en query params répétés + daily_range structuré
  // dans le body OU encodé en query. La forme la plus stable = tout en query
  // params (POST avec body vide accepté, calque samples Google officiels).
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new GbpApiError('startTime/endTime invalides (ISO 8601 attendu)', {
      code: 'invalid_argument',
      statusCode: 400,
      raw: { startTime, endTime },
    });
  }
  const params = new URLSearchParams();
  for (const m of metrics) params.append('dailyMetrics', m);
  params.set('dailyRange.start_date.year', String(start.getUTCFullYear()));
  params.set('dailyRange.start_date.month', String(start.getUTCMonth() + 1));
  params.set('dailyRange.start_date.day', String(start.getUTCDate()));
  params.set('dailyRange.end_date.year', String(end.getUTCFullYear()));
  params.set('dailyRange.end_date.month', String(end.getUTCMonth() + 1));
  params.set('dailyRange.end_date.day', String(end.getUTCDate()));

  const url =
    `${ENDPOINTS.performance}/${locationName}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`;
  return await gbpFetch<unknown>(env, null, accessToken, url, { method: 'POST' });
}
