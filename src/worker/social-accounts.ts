// ── social-accounts.ts — LOT SOCIAL PLANNER (Sprint 9) — NEUF (owned Manager-B)
//
// ⚠ État : corps réels Phase B (Manager-B). Signatures FIGÉES (worker.ts les
//   câble déjà). Imports worker RELATIFS.
//
// Connexions sociales OAuth tenant-bornées (calque EXACT oauth.ts). FLAG INACTIF
// IMPÉRATIF : socialProviderCredentials(env, provider) → null si les credentials
// OAuth social sont absents ⇒ connect renvoie json({ error }, 400) PROPRE (jamais
// 500, calque oauth.ts:handleOauthAuthorize l.233-236) ; le callback (route
// publique câblée plus tard) reste no-op. Tokens CHIFFRÉS AES-GCM via
// encryptToken/decryptToken réutilisés (PAS de duplication crypto). Capability
// EXISTANTE 'settings.manage' (calque oauth.ts — AUCUN ajout à ALL_CAPABILITIES).

import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import type { SocialProvider } from '../lib/types';

export type SocialAccountAuth = CapAuth & { capabilities?: Set<string> };

// Réseaux sociaux supportés (whitelist — valeurs APPLICATIVES, PAS de CHECK).
export const SOCIAL_PROVIDERS: SocialProvider[] = [
  'facebook', 'instagram', 'linkedin', 'google_business',
];

// Garde capability (réutilise 'settings.manage' — calque oauth.ts:capGuard).
function capGuard(auth: SocialAccountAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'settings.manage');
}

function tenantClientId(auth: SocialAccountAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

function isSocialProvider(v: unknown): v is SocialProvider {
  return typeof v === 'string' && (SOCIAL_PROVIDERS as string[]).includes(v);
}

/**
 * socialProviderCredentials — FLAG par provider (calque oauth.ts:
 * providerCredentials l.74). Absent ⇒ null ⇒ provider NON configuré (connect
 * 400 propre, callback no-op, publishToNetwork mock). Mappe les env vars réelles
 * par réseau (FACEBOOK_APP_ID/SECRET, INSTAGRAM_*, LINKEDIN_CLIENT_ID/SECRET,
 * GOOGLE_BUSINESS_*). TOUS absents ce sprint ⇒ tout renvoie null ⇒ E4/E6
 * INACTIFS. Lecture indexée tolérante (Env GELÉ — pas de clé typée pour ces vars).
 */
export function socialProviderCredentials(
  env: Env,
  provider: SocialProvider,
): { clientId: string; clientSecret: string } | null {
  const e = env as unknown as Record<string, string | undefined>;
  let id: string | undefined;
  let secret: string | undefined;
  switch (provider) {
    case 'facebook':
      id = e.FACEBOOK_APP_ID; secret = e.FACEBOOK_APP_SECRET; break;
    case 'instagram':
      // Instagram Graph passe par l'app Facebook (mêmes credentials Meta).
      id = e.INSTAGRAM_APP_ID || e.FACEBOOK_APP_ID;
      secret = e.INSTAGRAM_APP_SECRET || e.FACEBOOK_APP_SECRET; break;
    case 'linkedin':
      id = e.LINKEDIN_CLIENT_ID; secret = e.LINKEDIN_CLIENT_SECRET; break;
    case 'google_business':
      id = e.GOOGLE_BUSINESS_CLIENT_ID || e.GOOGLE_OAUTH_CLIENT_ID;
      secret = e.GOOGLE_BUSINESS_CLIENT_SECRET || e.GOOGLE_OAUTH_CLIENT_SECRET; break;
    default:
      return null;
  }
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret };
}

// ── GET /api/social/accounts (PROTÉGÉ) — liste tenant-bornée SANS tokens ────
//    SELECT … FROM social_accounts WHERE client_id = tenant (PROJECTION SANS
//    access_token/refresh_token — calque oauth.ts:handleListOauthConnections).
export async function handleListSocialAccounts(
  _request: Request, env: Env, auth: SocialAccountAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  const clientId = tenantClientId(auth);
  if (!clientId) return json({ data: [] });

  try {
    // PROJECTION SANS TOKENS — access_token/refresh_token JAMAIS renvoyés.
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, agency_id, provider, account_name,
              account_external_id, status, scopes, expires_at, created_at, updated_at
         FROM social_accounts
        WHERE client_id = ?
        ORDER BY created_at DESC`,
    ).bind(clientId).all();
    return json({ data: results || [] });
  } catch (err) {
    console.error('handleListSocialAccounts: select failed', err);
    return json({ error: 'Échec lecture des connexions' }, 500);
  }
}

// ── POST /api/social/accounts/connect (PROTÉGÉ) — démarre OAuth (flag inactif) ─
//    provider whitelisté ; socialProviderCredentials==null ⇒ json({ error }, 400)
//    PROPRE (flag INACTIF, calque oauth.ts l.233, JAMAIS 500). Sinon : nonce CSRF
//    en STATE_STORE (state porte le tenant, JAMAIS body), renvoie
//    json({ data: { url } }) (URL d'autorisation du provider).
export async function handleConnectSocialAccount(
  request: Request, env: Env, auth: SocialAccountAuth,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  const clientId = tenantClientId(auth);
  if (!clientId) return json({ error: 'Tenant non résolu' }, 400);

  let body: { provider?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps de requête invalide' }, 400);
  }
  const provider = body.provider;
  if (!isSocialProvider(provider)) {
    return json({ error: 'Réseau social non supporté' }, 400);
  }

  // FLAG INACTIF : credentials du provider absents → 400 PROPRE (calque oauth.ts
  // l.233-236, JAMAIS 500). socialProviderCredentials renvoie null ce sprint.
  const creds = socialProviderCredentials(env, provider);
  if (!creds) {
    return json({ error: `${provider} non configuré — OAuth non crédité` }, 400);
  }

  // ── Chemin ACTIF (jour où le provider est crédité) : nonce CSRF en KV (state
  //    porte le tenant, JAMAIS le body), construit l'URL d'autorisation. Calque
  //    oauth.ts:handleOauthAuthorize. Les tokens seront chiffrés via encryptToken
  //    au callback (route publique câblée plus tard).
  if (!env.STATE_STORE) {
    return json({ error: 'Stockage state OAuth indisponible' }, 503);
  }
  const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const statePayload = {
    client_id: clientId,
    agency_id: auth.tenant?.agencyId ?? null,
    provider,
  };
  await env.STATE_STORE.put(`social_oauth_state:${nonce}`, JSON.stringify(statePayload), {
    expirationTtl: 600,
  });

  const redirect = `${new URL(request.url).origin}/api/social/accounts/${provider}/callback`;
  const authUrl =
    `https://www.facebook.com/v19.0/dialog/oauth?client_id=${encodeURIComponent(creds.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=code&state=${encodeURIComponent(nonce)}`;
  return json({ data: { url: authUrl } });
}

// ── DELETE /api/social/accounts/:id (PROTÉGÉ) — re-borne tenant ─────────────
//    Charge la connexion, re-vérifie client_id (404 sinon), DELETE WHERE id=? AND
//    client_id=? (calque handleDeleteOauthConnection).
export async function handleDeleteSocialAccount(
  _request: Request, env: Env, auth: SocialAccountAuth, id: string,
): Promise<Response> {
  const g = capGuard(auth); if (g) return g;
  const clientId = tenantClientId(auth);
  if (!clientId) return json({ error: 'Connexion introuvable' }, 404);

  // RE-BORNAGE STRICT : impossible de supprimer la connexion d'un autre tenant.
  const row = (await env.DB.prepare(
    'SELECT id, client_id FROM social_accounts WHERE id = ?',
  ).bind(id).first()) as { id: string; client_id: string | null } | null;
  if (!row || row.client_id !== clientId) {
    return json({ error: 'Connexion introuvable' }, 404);
  }

  try {
    await env.DB.prepare('DELETE FROM social_accounts WHERE id = ? AND client_id = ?')
      .bind(id, clientId).run();
  } catch (err) {
    console.error('handleDeleteSocialAccount: delete failed', err);
    return json({ error: 'Échec suppression de la connexion' }, 500);
  }
  return json({ data: { deleted: true } });
}
