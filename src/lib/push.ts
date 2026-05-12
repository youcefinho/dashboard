// ── Push Notifications — Client-side init ───────────────────
// Sprint 11 — Capacitor V1

import { Capacitor } from '@capacitor/core';
import type { PushNotificationSchema, ActionPerformed, Token } from '@capacitor/push-notifications';

// ── Initialisation des push notifications ───────────────────

export async function initPushNotifications(apiBase: string, token: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Demander la permission
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return;

    // S'enregistrer auprès d'APNs / FCM
    await PushNotifications.register();

    // Envoyer le token au backend
    PushNotifications.addListener('registration', async (regToken: Token) => {
      try {
        await fetch(`${apiBase}/devices`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            token: regToken.value,
            platform: Capacitor.getPlatform(),
          }),
        });
      } catch (err) {
        console.error('Erreur enregistrement push token:', err);
      }
    });

    // Push reçue en foreground → toast
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      import('sonner').then(({ toast }) => {
        toast.info(notification.title || 'Nouvelle notification', {
          description: notification.body,
        });
      });
    });

    // Tap sur une push → navigation
    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const data = action.notification.data as Record<string, string> | undefined;
      if (data?.url) {
        window.location.href = data.url;
      }
    });
  } catch (err) {
    console.error('Erreur init push notifications:', err);
  }
}

// ── Désenregistrer le token (logout) ────────────────────────

export async function unregisterPush(apiBase: string, authToken: string, pushToken: string): Promise<void> {
  try {
    await fetch(`${apiBase}/devices/${encodeURIComponent(pushToken)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` },
    });
  } catch (err) {
    console.error('Erreur désenregistrement push:', err);
  }
}
