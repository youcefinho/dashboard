import type { Env } from './types';

export interface WebhookPayload {
  event: string;
  client_id: string;
  timestamp: string;
  data: any;
}

export async function publishEvent(env: Env, clientId: string, eventType: string, resourceData: any): Promise<void> {
  try {
    // 1. Trouver les abonnements actifs pour ce client
    const { results } = await env.DB.prepare(
      "SELECT id, url, events, secret FROM webhook_subscriptions WHERE client_id = ? AND is_active = 1"
    ).bind(clientId).all();

    if (!results || results.length === 0) return;

    // 2. Préparer le payload
    const payload: WebhookPayload = {
      event: eventType,
      client_id: clientId,
      timestamp: new Date().toISOString(),
      data: resourceData
    };

    const payloadJson = JSON.stringify(payload);

    // 3. Filtrer et déclencher
    for (const sub of results) {
      const eventsStr = sub.events as string;
      // On vérifie si l'abonnement écoute cet événement (ex: "lead.created,task.created" ou "*")
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
          payload: payloadJson
        };

        // 4. Enqueue pour traitement asynchrone (si WEBHOOK_QUEUE existe, sinon HTTP direct en fallback)
        // @ts-ignore
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

export async function sendWebhookDirectly(env: Env, msg: any) {
  try {
    // HMAC signature
    const signatureHeader = await generateWebhookSignature(msg.payload, msg.secret);

    // Update status to 'retrying' equivalent since it's the first attempt
    const res = await fetch(msg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Intralys-Signature': signatureHeader
      },
      body: msg.payload
    });

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

  } catch (err: any) {
    await env.DB.prepare(
      "UPDATE webhook_deliveries SET status = 'failed', response_body = ?, attempt = attempt + 1, delivered_at = datetime('now') WHERE id = ?"
    ).bind(err.message?.substring(0, 500), msg.deliveryId).run();

    await env.DB.prepare(
      "UPDATE webhook_subscriptions SET fail_count = fail_count + 1 WHERE id = ?"
    ).bind(msg.subscriptionId).run();
  }
}
