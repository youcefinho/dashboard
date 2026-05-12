import type { Env } from './types';

export interface WebhookPayload {
  event: string;
  client_id: string;
  timestamp: string;
  data: any;
}

/**
 * Publie un événement vers tous les webhooks abonnés.
 * Si ctx est fourni, utilise ctx.waitUntil() pour ne pas bloquer la réponse HTTP.
 */
export function publishEvent(
  env: Env, clientId: string, eventType: string, resourceData: any,
  ctx?: ExecutionContext
): void {
  const work = _publishEventAsync(env, clientId, eventType, resourceData);
  if (ctx) {
    ctx.waitUntil(work);
  } else {
    // Fallback dev : on lance sans attendre (fire-and-forget)
    work.catch(err => console.error('Erreur publishEvent (no ctx):', err));
  }
}

async function _publishEventAsync(
  env: Env, clientId: string, eventType: string, resourceData: any
): Promise<void> {
  try {
    // 1. Trouver les abonnements actifs pour ce client
    const { results } = await env.DB.prepare(
      "SELECT id, url, events, secret FROM webhook_subscriptions WHERE client_id = ? AND is_active = 1"
    ).bind(clientId).all();

    if (!results || results.length === 0) return;

    // 2. Préparer le payload avec timestamp anti-replay
    const now = new Date().toISOString();
    const payload: WebhookPayload = {
      event: eventType,
      client_id: clientId,
      timestamp: now,
      data: resourceData
    };

    const payloadJson = JSON.stringify(payload);

    // 3. Filtrer et déclencher
    for (const sub of results) {
      const eventsStr = sub.events as string;
      // Vérifier si l'abonnement écoute cet événement ("lead.created,task.created" ou "*")
      if (eventsStr === '*' || eventsStr.includes(eventType)) {
        
        // Log dans webhook_deliveries
        const deliveryId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO webhook_deliveries (id, subscription_id, event_type, payload_json, status) VALUES (?, ?, ?, ?, 'pending')"
        ).bind(deliveryId, sub.id as string, eventType, payloadJson).run();

        const message = {
          deliveryId,
          subscriptionId: sub.id as string,
          url: sub.url as string,
          secret: sub.secret as string,
          payload: payloadJson,
          timestamp: now,
        };

        // 4. Enqueue pour traitement asynchrone (si WEBHOOK_QUEUE existe, sinon HTTP direct en fallback)
        // @ts-ignore – WEBHOOK_QUEUE n'est pas toujours déclaré dans Env
        if (env.WEBHOOK_QUEUE) {
          // @ts-ignore
          await env.WEBHOOK_QUEUE.send(message);
        } else {
          // Fallback dev: on envoie directement sans file d'attente (moins fiable)
          await sendWebhookDirectly(env, message);
        }
      }
    }
  } catch (err) {
    console.error('Erreur publishEvent:', err);
  }
}

// ── HMAC Signature ──────────────────────────────────────────

export async function generateWebhookSignature(payload: any, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadStr));
  const signatureHex = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  return `sha256=${signatureHex}`;
}

export async function verifyWebhookSignature(payload: any, secret: string, signature: string): Promise<boolean> {
  const generated = await generateWebhookSignature(payload, secret);
  return generated === signature;
}

// ── Envoi direct (fallback dev ou queue consumer) ───────────

const WEBHOOK_FETCH_TIMEOUT_MS = 10_000; // 10s

export async function sendWebhookDirectly(env: Env, msg: any): Promise<void> {
  try {
    // HMAC signature
    const signatureHeader = await generateWebhookSignature(msg.payload, msg.secret);

    // AbortController pour timeout 10s (évite qu'un receiver lent bloque la queue)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(msg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Intralys-Signature': signatureHeader,
          'X-Intralys-Timestamp': msg.timestamp || new Date().toISOString(),
        },
        body: msg.payload,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseBody = await res.text();
      const status = res.ok ? 'delivered' : 'failed';

      await env.DB.prepare(
        "UPDATE webhook_deliveries SET status = ?, response_code = ?, response_body = ?, attempt = attempt + 1, delivered_at = datetime('now') WHERE id = ?"
      ).bind(status, res.status, responseBody.substring(0, 500), msg.deliveryId).run();

      if (!res.ok) {
        await env.DB.prepare(
          "UPDATE webhook_subscriptions SET fail_count = fail_count + 1 WHERE id = ?"
        ).bind(msg.subscriptionId).run();
      }
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      const errMsg = fetchErr.name === 'AbortError'
        ? `Timeout après ${WEBHOOK_FETCH_TIMEOUT_MS}ms`
        : fetchErr.message || 'Erreur réseau';
      throw new Error(errMsg);
    }

  } catch (err: any) {
    await env.DB.prepare(
      "UPDATE webhook_deliveries SET status = 'failed', response_body = ?, attempt = attempt + 1, delivered_at = datetime('now') WHERE id = ?"
    ).bind(err.message?.substring(0, 500), msg.deliveryId).run();

    await env.DB.prepare(
      "UPDATE webhook_subscriptions SET fail_count = fail_count + 1 WHERE id = ?"
    ).bind(msg.subscriptionId).run();
  }
}
