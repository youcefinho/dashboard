// ── ecommerce-channel-rotation.ts — Sprint S7 M1 (Manager B) ─────────────────
//
// Rotation / révocation des secrets d'intégration e-commerce (Shopify token,
// Woo creds). Fonctions PURES et réutilisables : Manager C les importe dans
// worker.ts pour câbler les routes admin (toi/Manager B ne touches PAS
// worker.ts). Logique de stockage déléguée au secret store typé figé (§6) ;
// nettoyage best-effort des anciennes clés KV claires (parité legacy).
//
// Garde-fou multi-tenant STRICT : channelId DOIT appartenir à clientId, validé
// via loadChannel (SELECT WHERE id=? AND client_id=?) AVANT toute opération.
//
// ⚠️ Anti-fuite Loi 25 : aucun token/secret/ciphertext n'est jamais loggé ni
// placé dans `details` d'audit() — uniquement des métadonnées non sensibles
// ({ kind }).
//
// Note OAuth : les tokens Shopify (offline access token) et les clés API Woo
// (consumer key/secret) n'ont PAS de mécanisme de refresh standard. « Roter »
// = révoquer l'actuel + exiger une re-connexion OAuth/clés par l'admin. On NE
// fabrique JAMAIS de faux token : rotateChannelSecret se contente de révoquer
// et de signaler que la re-connexion est requise (reconnect_required).

import type { Env } from './types';
import { audit } from './helpers';
import { createSecretStore } from './lib/secret-store';
import { loadChannel } from './ecommerce-channel-sync';

export interface ChannelSecretOpResult {
  ok: boolean;
  error?: string;
  /** rotateChannelSecret : true ⇒ l'admin doit relancer connect (OAuth/clés). */
  reconnect_required?: boolean;
}

/** Préfixes legacy KV clair (avant S7) — nettoyés best-effort à la révocation. */
function legacyKvKey(kind: string, channelId: string): string | null {
  if (kind === 'shopify_token') return `shopify_token:${channelId}`;
  if (kind === 'woo_creds') return `woo_creds:${channelId}`;
  return null;
}

/** Supprime best-effort l'ancienne clé KV claire (no-op si STATE_STORE absent). */
async function purgeLegacyKv(
  env: Env,
  kind: string,
  channelId: string,
): Promise<void> {
  const key = legacyKvKey(kind, channelId);
  if (!key || !env.STATE_STORE) return;
  try {
    await env.STATE_STORE.delete(key);
  } catch {
    /* best-effort : un KV indispo ne bloque jamais la révocation D1 */
  }
}

/**
 * Révoque le secret d'intégration d'un canal (soft-revoke idempotent côté
 * secret store) + purge best-effort de l'ancienne clé KV claire legacy +
 * audit `channel.revoke` (métadonnées non sensibles uniquement).
 *
 * Multi-tenant : channelId validé appartenir à clientId via loadChannel.
 * `userId` optionnel (route admin) ⇒ fallback 'system' si non fourni.
 */
export async function revokeChannelSecret(
  env: Env,
  clientId: string,
  channelId: string,
  kind: string,
  userId?: string,
): Promise<ChannelSecretOpResult> {
  // Garde-fou multi-tenant : le canal doit appartenir au tenant.
  const channel = await loadChannel(env, clientId, channelId);
  if (!channel) {
    return { ok: false, error: 'Canal introuvable pour ce tenant' };
  }

  await createSecretStore(env).revokeIntegrationToken(
    env,
    clientId,
    channelId,
    kind,
  );
  // Nettoyage legacy KV clair (les anciens secrets pré-S7 doivent disparaître).
  await purgeLegacyKv(env, kind, channelId);

  // Anti-fuite : QUE des métadonnées non sensibles dans `details`.
  await audit(
    env,
    userId || 'system',
    'channel.revoke',
    'sales_channel',
    channelId,
    { kind },
  );

  return { ok: true };
}

/**
 * « Rotation » d'un secret d'intégration. Shopify offline token / clés Woo
 * n'ont pas de refresh standard : roter = révoquer l'actuel et exiger une
 * re-connexion (OAuth Shopify / re-génération clés Woo) par l'admin. On NE
 * fabrique PAS de faux token. Retourne { ok:true, reconnect_required:true }
 * après revoke + audit `channel.rotate`.
 *
 * Multi-tenant : channelId validé appartenir à clientId via loadChannel.
 */
export async function rotateChannelSecret(
  env: Env,
  clientId: string,
  channelId: string,
  kind: string,
  userId?: string,
): Promise<ChannelSecretOpResult> {
  // Garde-fou multi-tenant : le canal doit appartenir au tenant.
  const channel = await loadChannel(env, clientId, channelId);
  if (!channel) {
    return { ok: false, error: 'Canal introuvable pour ce tenant' };
  }

  // Révocation de l'actuel (idempotent) + purge legacy KV clair.
  await createSecretStore(env).revokeIntegrationToken(
    env,
    clientId,
    channelId,
    kind,
  );
  await purgeLegacyKv(env, kind, channelId);

  // Anti-fuite : QUE des métadonnées non sensibles dans `details`.
  await audit(
    env,
    userId || 'system',
    'channel.rotate',
    'sales_channel',
    channelId,
    { kind, reconnect_required: true },
  );

  // Pas de refresh standard ⇒ la re-connexion OAuth/clés est requise.
  return { ok: true, reconnect_required: true };
}
