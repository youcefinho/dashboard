import type { Env } from './types';
import { sendWebhookDirectly } from './webhooks-dispatch';

// ── Barèmes d'exponential backoff (en secondes) ────────────
// Tentative 1 → 60s, 2 → 300s, 3 → 1800s, 4 → 7200s, 5 → 43200s
const BACKOFF_DELAYS_S = [60, 300, 1800, 7200, 43200];
const MAX_ATTEMPTS = 5;
const DISABLE_THRESHOLD = 100; // Désactiver le webhook après 100 échecs cumulés

export async function processWebhookDelivery(batch: MessageBatch<any>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const msg = message.body;
    try {
      await sendWebhookDirectly(env, msg);
      
      // Vérifier si la livraison a bien été marquée 'delivered'
      const delivery = await env.DB.prepare(
        "SELECT status FROM webhook_deliveries WHERE id = ?"
      ).bind(msg.deliveryId).first() as { status: string } | null;
      
      if (delivery?.status === 'delivered') {
        message.ack();
      } else {
        // Livraison échouée, déterminer si on retry
        const attempt = await getAttemptCount(env, msg.deliveryId);
        
        if (attempt >= MAX_ATTEMPTS) {
          // Dead-letter : on abandonne
          await env.DB.prepare(
            "UPDATE webhook_deliveries SET status = 'dead_letter' WHERE id = ?"
          ).bind(msg.deliveryId).run();
          message.ack(); // On retire de la queue
        } else {
          // Retry avec backoff exponentiel
          const delaySeconds = BACKOFF_DELAYS_S[Math.min(attempt, BACKOFF_DELAYS_S.length - 1)] ?? 43200;
          message.retry({ delaySeconds });
        }

        // Vérifier si le webhook doit être désactivé
        await checkAndDisableWebhook(env, msg.subscriptionId);
      }
    } catch (err) {
      console.error('Erreur processWebhookDelivery:', err);
      
      const attempt = await getAttemptCount(env, msg.deliveryId);
      if (attempt >= MAX_ATTEMPTS) {
        await env.DB.prepare(
          "UPDATE webhook_deliveries SET status = 'dead_letter' WHERE id = ?"
        ).bind(msg.deliveryId).run();
        message.ack();
      } else {
        const delaySeconds = BACKOFF_DELAYS_S[Math.min(attempt, BACKOFF_DELAYS_S.length - 1)] ?? 43200;
        message.retry({ delaySeconds });
      }

      await checkAndDisableWebhook(env, msg.subscriptionId);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────

async function getAttemptCount(env: Env, deliveryId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT attempt FROM webhook_deliveries WHERE id = ?"
  ).bind(deliveryId).first() as { attempt: number } | null;
  return row?.attempt ?? 0;
}

async function checkAndDisableWebhook(env: Env, subscriptionId: string): Promise<void> {
  try {
    const sub = await env.DB.prepare(
      "SELECT fail_count FROM webhook_subscriptions WHERE id = ?"
    ).bind(subscriptionId).first() as { fail_count: number } | null;
    
    if (sub && sub.fail_count >= DISABLE_THRESHOLD) {
      await env.DB.prepare(
        "UPDATE webhook_subscriptions SET is_active = 0 WHERE id = ?"
      ).bind(subscriptionId).run();
      console.warn(`Webhook ${subscriptionId} désactivé après ${sub.fail_count} échecs`);
    }
  } catch (err) {
    console.error('Erreur checkAndDisableWebhook:', err);
  }
}
