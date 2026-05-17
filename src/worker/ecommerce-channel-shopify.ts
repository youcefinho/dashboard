// ── Sprint E8 M2.2 — Connecteur Shopify (OAuth + webhook signé) ──────────────
//
// OAuth Shopify (Authorization Code) + vérification webhook HMAC SHA-256
// **BASE64** (header X-Shopify-Hmac-Sha256). Le pattern de vérification est
// ADAPTÉ de `verifyMetaSignature` (meta-leadgen.ts l.12) — VRAIE signature
// constant-time via crypto.subtle.verify — variante base64 au lieu de hex.
// JAMAIS le mock billing.ts.
//
// Secrets via bindings (SHOPIFY_CLIENT_ID / _SECRET / _WEBHOOK_SECRET) —
// JAMAIS de token clair en DB : sales_channels.config_ref pointe une RÉF
// (placeholder si pas d'infra secret store ⇒ // TODO secret store). Le flux
// produits/commandes est délégué au moteur M2.3 (ecommerce-channel-sync).

import type { Env } from './types';
import { json } from './helpers';
import { createSecretStore } from './lib/secret-store';
import {
  loadChannel,
  loadChannelByIdOnly,
  ingestProductEvent,
  ingestOrderEvent,
  logSync,
  type ChannelRow,
} from './ecommerce-channel-sync';

type Auth = { userId: string; role: string };

const SHOPIFY_SCOPES = 'read_products,write_products,read_orders,write_orders';
const SHOPIFY_API_VERSION = '2024-10';

// ── Vérification webhook HMAC SHA-256 BASE64 (X-Shopify-Hmac-Sha256) ─────────
// Adapté de verifyMetaSignature : importKey HMAC SHA-256 + crypto.subtle.verify
// (constant-time, safe timing attacks). Différence : Shopify encode la
// signature attendue en BASE64 (Meta = hex). secret absent → null (caller
// décide ; ici on refuse pour ne PAS ingérer un webhook non vérifié).
export async function verifyShopifyWebhook(
  env: Env,
  rawBody: string,
  hmacHeader: string | null,
): Promise<boolean | null> {
  const secret = env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return null; // pas de secret configuré → vérif impossible
  if (!hmacHeader) return false;

  // base64 → Uint8Array (signature attendue)
  let sigBytes: Uint8Array;
  try {
    const bin = atob(hmacHeader.trim());
    sigBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) sigBytes[i] = bin.charCodeAt(i);
  } catch {
    return false; // header non-base64 → signature invalide
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  // crypto.subtle.verify est constant-time → safe contre timing attacks.
  return crypto.subtle.verify('HMAC', key, sigBytes as unknown as ArrayBuffer, enc.encode(rawBody));
}

// ── OAuth : démarrage (connect) ──────────────────────────────────────────────

/**
 * POST /api/ecommerce/channels/:id/connect (Shopify) → { redirect_url }.
 * Construit l'URL d'autorisation Shopify (client_id binding, scopes
 * products+orders, state CSRF). shop_domain DOIT être renseigné sur le canal.
 */
export async function shopifyConnect(
  env: Env,
  channel: ChannelRow,
  origin: string,
): Promise<Response> {
  if (!env.SHOPIFY_CLIENT_ID) {
    return json(
      { error: 'Shopify non configuré', message: 'SHOPIFY_CLIENT_ID absent côté serveur.' },
      503,
    );
  }
  const shop = (channel.shop_domain || '').trim();
  if (!shop || !/^[a-z0-9-]+\.myshopify\.com$/i.test(shop)) {
    return json(
      {
        error: 'Domaine boutique invalide',
        message: "Renseigne shop_domain (ex 'ma-boutique.myshopify.com') sur le canal avant de connecter.",
      },
      400,
    );
  }

  // state CSRF : channelId encodé (lookup au callback) + nonce.
  const nonce = crypto.randomUUID();
  const state = `${channel.id}.${nonce}`;
  // Persiste le nonce attendu côté KV si dispo (TTL court), sinon best-effort.
  if (env.STATE_STORE) {
    try {
      await env.STATE_STORE.put(`shopify_oauth:${channel.id}`, nonce, {
        expirationTtl: 600,
      });
    } catch { /* best-effort */ }
  }

  const redirectUri = `${origin}/api/ecommerce/channels/${channel.id}/callback`;
  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(env.SHOPIFY_CLIENT_ID)}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return json({ data: { redirect_url: url } });
}

// ── OAuth : callback ─────────────────────────────────────────────────────────

/**
 * GET /api/ecommerce/channels/:id/callback (Shopify). Échange code→token,
 * stocke une RÉFÉRENCE via config_ref (JAMAIS le token clair en DB). Si pas
 * d'infra secret store, on stocke un placeholder ref + // TODO secret store.
 */
export async function shopifyCallback(
  env: Env,
  channel: ChannelRow,
  url: URL,
): Promise<Response> {
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const shop = url.searchParams.get('shop') || channel.shop_domain || '';

  if (!code || !state) {
    return json({ error: 'Callback invalide', message: 'code/state manquant.' }, 400);
  }
  // Vérif CSRF : state = "<channelId>.<nonce>".
  const [stChannel, stNonce] = state.split('.');
  if (stChannel !== channel.id || !stNonce) {
    return json({ error: 'State CSRF invalide' }, 403);
  }
  if (env.STATE_STORE) {
    try {
      const expected = await env.STATE_STORE.get(`shopify_oauth:${channel.id}`);
      if (expected && expected !== stNonce) {
        return json({ error: 'State CSRF invalide' }, 403);
      }
      await env.STATE_STORE.delete(`shopify_oauth:${channel.id}`);
    } catch { /* best-effort : KV indispo ne bloque pas le flow */ }
  }

  if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
    return json({ error: 'Shopify non configuré côté serveur' }, 503);
  }

  // Échange code → access_token.
  let accessToken = '';
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.SHOPIFY_CLIENT_ID,
        client_secret: env.SHOPIFY_CLIENT_SECRET,
        code,
      }),
    });
    const data = (await tokenRes.json()) as { access_token?: string };
    accessToken = data.access_token || '';
  } catch {
    accessToken = '';
  }
  if (!accessToken) {
    return json({ error: 'Échange OAuth échoué', message: 'Token Shopify non obtenu.' }, 502);
  }

  // ⚠️ SÉCURITÉ S7 : token chiffré AES-GCM en D1 via le secret store typé
  // (UNIQUE(channel_id,kind), multi-tenant : client_id = channel.client_id
  // résolu depuis le canal chargé, jamais en dur). Remplace l'ancien
  // STATE_STORE.put('shopify_token:'+id, accessToken) EN CLAIR.
  const configRef = `shopify:${channel.id}`;
  await createSecretStore(env).putIntegrationToken(
    env,
    channel.client_id,
    channel.id,
    'shopify_token',
    accessToken,
  );
  // Persiste UNIQUEMENT la RÉFÉRENCE + domaine, jamais le token.
  await env.DB.prepare(
    `UPDATE sales_channels
        SET config_ref = ?, shop_domain = ?, active = 1,
            updated_at = datetime('now')
      WHERE id = ? AND client_id = ?`,
  ).bind(configRef, shop || channel.shop_domain, channel.id, channel.client_id).run();

  await logSync(env, channel, 'in', 'product', 'ok', null, {
    event: 'oauth_connected',
  });
  return json({ data: { connected: true, channel_id: channel.id } });
}

// ── Webhook public Shopify ───────────────────────────────────────────────────

/**
 * POST /api/webhook/shopify/:channelId (PUBLIC — auth = SIGNATURE).
 * Vérifie HMAC SHA-256 base64, route le topic (orders/create,
 * products/create|update) vers le moteur M2.3. Idempotence assurée par le
 * moteur (channel_product_map / orders.external_id). Réponse 200 toujours
 * rapide après accusé (Shopify retry sinon).
 */
export async function handleShopifyWebhook(
  request: Request,
  env: Env,
  channelId: string,
): Promise<Response> {
  const channel = await loadChannelByIdOnly(env, channelId);
  if (!channel || channel.type !== 'shopify' || !channel.active) {
    return json({ error: 'Canal introuvable ou inactif' }, 404);
  }

  const rawBody = await request.text();
  const hmac = request.headers.get('X-Shopify-Hmac-Sha256');
  const verified = await verifyShopifyWebhook(env, rawBody, hmac);
  if (verified === null) {
    // Secret non configuré : on REFUSE (ne jamais ingérer non vérifié).
    return json({ error: 'Webhook Shopify non configuré (secret absent)' }, 503);
  }
  if (verified === false) {
    return json({ error: 'Signature invalide' }, 401);
  }

  const topic = (request.headers.get('X-Shopify-Topic') || '').toLowerCase();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: 'Payload JSON invalide' }, 400);
  }

  if (topic === 'orders/create') {
    await ingestOrderEvent(env, channel, payload);
  } else if (topic === 'products/create' || topic === 'products/update') {
    await ingestProductEvent(env, channel, payload);
  } else {
    // Topic non géré : accusé 200 pour stopper les retries Shopify.
    await logSync(env, channel, 'in', 'product', 'ok', null, {
      ignored_topic: topic,
    });
  }
  return json({ ok: true }, 200);
}

// ── Sync produit sortant (push stock) — callback HTTP réel ───────────────────

/**
 * Construit le callback de push stock vers Shopify (REST inventory_levels).
 * Le moteur M2.3 (syncProductOut) gère l'anti-echo + la quantité ; ici on
 * effectue uniquement l'appel HTTP avec le token (déchiffré via secret store).
 */
export async function shopifyPushFn(
  env: Env,
  channel: ChannelRow,
): Promise<(externalId: string, qty: number) => Promise<boolean>> {
  // S7 : lecture du token déchiffré via le secret store (multi-tenant strict :
  // client_id ET channel_id résolus depuis le canal chargé). null si absent /
  // révoqué / mauvais tenant ⇒ no-op silencieux préservé (parité KV-absent).
  const token =
    (await createSecretStore(env).getIntegrationToken(
      env,
      channel.client_id,
      channel.id,
      'shopify_token',
    )) || '';
  const shop = channel.shop_domain || '';
  return async (externalId: string, qty: number): Promise<boolean> => {
    if (!token || !shop) return false; // pas d'infra secret → no-op silencieux
    try {
      const res = await fetch(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': token,
          },
          body: JSON.stringify({
            inventory_item_id: externalId,
            available: Math.max(0, qty),
          }),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  };
}

// Resolver multi-tenant strict pour les routes authentifiées (connect/callback
// /sync) : le canal doit appartenir au tenant courant.
export async function shopifyResolveChannel(
  env: Env,
  clientId: string,
  channelId: string,
): Promise<ChannelRow | null> {
  return loadChannel(env, clientId, channelId);
}

export type { Auth };
