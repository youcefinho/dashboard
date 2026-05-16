// ── Sprint E8 M2.2 — Connecteur WooCommerce (REST + webhook signé) ───────────
//
// WooCommerce REST API (consumer key/secret via bindings WOO_*) + vérification
// webhook signé : Woo signe le corps en HMAC SHA-256 **BASE64** dans le header
// `X-WC-Webhook-Signature` avec le secret du webhook (WOO_WEBHOOK_SECRET).
// Même pattern constant-time que Shopify/Meta (crypto.subtle.verify) — JAMAIS
// le mock billing.ts.
//
// Woo n'a pas d'OAuth standard : le « connect » fournit l'URL d'install des
// clés API REST (l'admin colle consumer key/secret, stockés par RÉFÉRENCE via
// config_ref — JAMAIS en clair en DB). Le flux produits/commandes est délégué
// au moteur M2.3 (ecommerce-channel-sync).

import type { Env } from './types';
import { json } from './helpers';
import {
  loadChannel,
  loadChannelByIdOnly,
  ingestProductEvent,
  ingestOrderEvent,
  logSync,
  type ChannelRow,
} from './ecommerce-channel-sync';

type Auth = { userId: string; role: string };

// ── Vérification webhook Woo (X-WC-Webhook-Signature, HMAC SHA-256 base64) ───
// Woo : signature = base64( HMAC_SHA256( rawBody, secret ) ). Vérif
// constant-time via crypto.subtle.verify (même garde que verifyMetaSignature,
// variante base64 comme Shopify). secret absent → null (caller refuse).
export async function verifyWooWebhook(
  env: Env,
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean | null> {
  const secret = env.WOO_WEBHOOK_SECRET;
  if (!secret) return null; // pas de secret configuré → vérif impossible
  if (!signatureHeader) return false;

  let sigBytes: Uint8Array;
  try {
    const bin = atob(signatureHeader.trim());
    sigBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) sigBytes[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, sigBytes as unknown as ArrayBuffer, enc.encode(rawBody));
}

// ── « Connect » Woo (pas d'OAuth standard) ───────────────────────────────────

/**
 * POST /api/ecommerce/channels/:id/connect (Woo) → { redirect_url }.
 * Woo n'a pas d'Authorization Code OAuth : on renvoie l'URL de la page
 * d'autorisation des clés API REST WooCommerce (l'admin valide côté WP).
 * shop_domain DOIT pointer la base WordPress (ex 'boutique.example.com').
 */
export async function wooConnect(
  _env: Env,
  channel: ChannelRow,
  origin: string,
): Promise<Response> {
  const shop = (channel.shop_domain || '').trim().replace(/^https?:\/\//, '');
  if (!shop) {
    return json(
      {
        error: 'Domaine boutique manquant',
        message: "Renseigne shop_domain (base WordPress, ex 'boutique.example.com') sur le canal.",
      },
      400,
    );
  }
  const appName = encodeURIComponent('Intralys Omnicanal');
  const callback = encodeURIComponent(
    `${origin}/api/ecommerce/channels/${channel.id}/callback`,
  );
  // Endpoint standard WooCommerce d'octroi de clés API REST.
  const url =
    `https://${shop}/wc-auth/v1/authorize` +
    `?app_name=${appName}` +
    `&scope=read_write` +
    `&user_id=${encodeURIComponent(channel.id)}` +
    `&return_url=${callback}` +
    `&callback_url=${callback}`;

  return json({ data: { redirect_url: url } });
}

/**
 * GET/POST /api/ecommerce/channels/:id/callback (Woo). WooCommerce POST les
 * clés API (consumer_key/secret) en JSON sur le callback_url. On stocke une
 * RÉFÉRENCE via config_ref + les clés dans le KV (JAMAIS en clair en DB).
 */
export async function wooCallback(
  env: Env,
  channel: ChannelRow,
  request: Request,
  url: URL,
): Promise<Response> {
  // Woo envoie les clés via POST JSON ; fallback query (return_url) sinon.
  let consumerKey = '';
  let consumerSecret = '';
  try {
    if (request.method === 'POST') {
      const body = (await request.json()) as {
        consumer_key?: string;
        consumer_secret?: string;
      };
      consumerKey = String(body.consumer_key || '');
      consumerSecret = String(body.consumer_secret || '');
    }
  } catch { /* corps absent / non-JSON → fallback query */ }
  if (!consumerKey) consumerKey = url.searchParams.get('consumer_key') || '';
  if (!consumerSecret) {
    consumerSecret = url.searchParams.get('consumer_secret') || '';
  }

  if (!consumerKey || !consumerSecret) {
    return json(
      { error: 'Clés API Woo manquantes', message: 'consumer_key/secret absents du callback.' },
      400,
    );
  }

  // ⚠️ SÉCURITÉ : clés stockées par RÉFÉRENCE (KV), JAMAIS en clair en DB.
  // TODO secret store : remplacer KV par un secret store dédié si dispo.
  const configRef = `woo:${channel.id}`;
  if (env.STATE_STORE) {
    try {
      await env.STATE_STORE.put(
        `woo_creds:${channel.id}`,
        JSON.stringify({ ck: consumerKey, cs: consumerSecret }),
      );
    } catch { /* best-effort */ }
  }
  await env.DB.prepare(
    `UPDATE sales_channels
        SET config_ref = ?, active = 1, updated_at = datetime('now')
      WHERE id = ? AND client_id = ?`,
  ).bind(configRef, channel.id, channel.client_id).run();

  await logSync(env, channel, 'in', 'product', 'ok', null, {
    event: 'woo_keys_stored',
  });
  return json({ data: { connected: true, channel_id: channel.id } });
}

// ── Webhook public Woo ───────────────────────────────────────────────────────

/**
 * POST /api/webhook/woo/:channelId (PUBLIC — auth = SIGNATURE).
 * Vérifie X-WC-Webhook-Signature (HMAC SHA-256 base64), route le topic
 * (X-WC-Webhook-Topic : order.created, product.created/updated) vers le
 * moteur M2.3. Idempotence assurée par le moteur.
 */
export async function handleWooWebhook(
  request: Request,
  env: Env,
  channelId: string,
): Promise<Response> {
  const channel = await loadChannelByIdOnly(env, channelId);
  if (!channel || channel.type !== 'woo' || !channel.active) {
    return json({ error: 'Canal introuvable ou inactif' }, 404);
  }

  const rawBody = await request.text();
  const sig = request.headers.get('X-WC-Webhook-Signature');
  const verified = await verifyWooWebhook(env, rawBody, sig);
  if (verified === null) {
    return json({ error: 'Webhook Woo non configuré (secret absent)' }, 503);
  }
  if (verified === false) {
    return json({ error: 'Signature invalide' }, 401);
  }

  const topic = (request.headers.get('X-WC-Webhook-Topic') || '').toLowerCase();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: 'Payload JSON invalide' }, 400);
  }

  if (topic === 'order.created' || topic === 'order.updated') {
    await ingestOrderEvent(env, channel, payload);
  } else if (topic === 'product.created' || topic === 'product.updated') {
    await ingestProductEvent(env, channel, payload);
  } else {
    await logSync(env, channel, 'in', 'product', 'ok', null, {
      ignored_topic: topic,
    });
  }
  return json({ ok: true }, 200);
}

// ── Sync produit sortant (push stock) — callback HTTP REST Woo ───────────────

/**
 * Construit le callback de push stock vers Woo (PUT /wp-json/wc/v3/products).
 * Auth Basic consumer_key/secret (lus via la RÉFÉRENCE KV). Le moteur M2.3
 * (syncProductOut) gère anti-echo + quantité ; ici uniquement l'appel HTTP.
 */
export async function wooPushFn(
  env: Env,
  channel: ChannelRow,
): Promise<(externalId: string, qty: number) => Promise<boolean>> {
  let ck = '';
  let cs = '';
  if (env.STATE_STORE) {
    try {
      const raw = await env.STATE_STORE.get(`woo_creds:${channel.id}`);
      if (raw) {
        const c = JSON.parse(raw) as { ck?: string; cs?: string };
        ck = c.ck || '';
        cs = c.cs || '';
      }
    } catch { /* best-effort */ }
  }
  const shop = (channel.shop_domain || '').replace(/^https?:\/\//, '');
  return async (externalId: string, qty: number): Promise<boolean> => {
    if (!ck || !cs || !shop) return false; // pas d'infra secret → no-op
    try {
      const auth = btoa(`${ck}:${cs}`);
      const res = await fetch(
        `https://${shop}/wp-json/wc/v3/products/${encodeURIComponent(externalId)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({ stock_quantity: Math.max(0, qty) }),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  };
}

// Resolver multi-tenant strict (routes authentifiées connect/callback/sync).
export async function wooResolveChannel(
  env: Env,
  clientId: string,
  channelId: string,
): Promise<ChannelRow | null> {
  return loadChannel(env, clientId, channelId);
}

export type { Auth };
