import type { Env } from './types';
import { sendWebhookDirectly } from './webhooks-dispatch';

export async function processWebhookDelivery(batch: MessageBatch<any>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await sendWebhookDirectly(env, message.body);
      message.ack();
    } catch (err) {
      console.error('Erreur processWebhookDelivery:', err);
      // Let it retry
      message.retry();
    }
  }
}
