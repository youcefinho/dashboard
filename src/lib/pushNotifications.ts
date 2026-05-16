// ── Push Notifications — Routing avancé Sprint 44 M1.3 ─────────────
// Surcouche au-dessus de src/lib/push.ts existant (Sprint 11).
// Ajoute :
//   1. Routing typé par data.type (lead_new, message, task_due, etc.)
//   2. Navigation via TanStack Router (pas window.location.href)
//   3. Foreground toast enrichi avec action buttons
//   4. Badge count Capacitor (iOS app icon)
//
// API publique : `setupPushRouting(navigate)` — wired depuis main.tsx ou
// AppLayout. Le module de bas niveau `push.ts` (registration + token POST)
// est conservé intact (Sprint 35 préservé).

import { Capacitor } from '@capacitor/core';
import type {
  PushNotificationSchema,
  ActionPerformed,
} from '@capacitor/push-notifications';

// ── Types de notifications poussées par le backend ──────────────────
//
// Le backend Cloudflare Workers envoie systématiquement un payload FCM/APNs
// avec `data.type` + champs métier (id, leadId, convId, taskId, etc.).
//
// Le data payload est TOUJOURS string-only (contrainte FCM) — on parse
// au runtime.

export type PushType =
  | 'lead_new'         // Nouveau lead créé → /leads/:id
  | 'lead_assigned'    // Lead assigné à l'user → /leads/:id
  | 'lead_hot'         // Lead score élevé → /leads/:id
  | 'message'          // Nouveau message inbox → /conversations + open conv
  | 'task_due'         // Tâche échue → /tasks?focus=:id
  | 'task_assigned'    // Tâche assignée → /tasks?focus=:id
  | 'appointment_soon' // RDV imminent (<30min) → /calendar?focus=:id
  | 'workflow_alert'   // Workflow échec/succès → /workflows/:id
  | 'review_new'       // Nouvel avis Google/FB → /reviews
  | 'system';          // Maintenance / mises à jour → toast only

export interface PushDataPayload {
  type?: PushType;
  leadId?: string;
  convId?: string;
  taskId?: string;
  apptId?: string;
  workflowId?: string;
  reviewId?: string;
  url?: string;        // Fallback : URL absolue à ouvrir directement
  [k: string]: string | undefined;
}

// Type minimal navigate (compat TanStack Router)
type NavigateFn = (opts: { to: string; search?: Record<string, unknown> }) => void | Promise<void>;

// ── Routing core ─────────────────────────────────────────────────────

/**
 * Convertit un payload push en route TanStack.
 * Retourne `null` si type inconnu / données manquantes → fallback toast only.
 */
export function routeFromPushData(data: PushDataPayload): { to: string; search?: Record<string, unknown> } | null {
  if (!data) return null;

  // Fallback URL directe (pour push backend simples)
  if (data.url) {
    try {
      const u = new URL(data.url, 'https://crm.intralys.com');
      return { to: u.pathname + u.search };
    } catch { /* ignore — fallback type-based */ }
  }

  const type = data.type;
  switch (type) {
    case 'lead_new':
    case 'lead_assigned':
    case 'lead_hot':
      if (data.leadId) return { to: `/leads/${data.leadId}` };
      return { to: '/leads' };

    case 'message':
      if (data.convId) return { to: '/conversations', search: { conv: data.convId } };
      return { to: '/conversations' };

    case 'task_due':
    case 'task_assigned':
      if (data.taskId) return { to: '/tasks', search: { focus: data.taskId } };
      return { to: '/tasks' };

    case 'appointment_soon':
      if (data.apptId) return { to: '/calendar', search: { focus: data.apptId } };
      return { to: '/calendar' };

    case 'workflow_alert':
      if (data.workflowId) return { to: `/workflows/${data.workflowId}` };
      return { to: '/workflows' };

    case 'review_new':
      return { to: '/reviews' };

    case 'system':
    default:
      return null;
  }
}

/**
 * Titre user-facing FR québécois pour foreground toast.
 */
function frenchTitleFor(type: PushType | undefined, fallback: string): string {
  switch (type) {
    case 'lead_new':         return 'Nouveau lead';
    case 'lead_assigned':    return 'Lead assigné';
    case 'lead_hot':         return 'Lead chaud';
    case 'message':          return 'Nouveau message';
    case 'task_due':         return 'Tâche échue';
    case 'task_assigned':    return 'Tâche assignée';
    case 'appointment_soon': return 'RDV bientôt';
    case 'workflow_alert':   return 'Workflow';
    case 'review_new':       return 'Nouvel avis';
    default:                 return fallback || 'Notification';
  }
}

// ── Setup global — listeners enrichis ────────────────────────────────

let _wired = false;

/**
 * À appeler UNE FOIS après mount du Router (depuis AppLayout). Ajoute des
 * listeners aux events PushNotifications qui routent via TanStack au lieu
 * de `window.location.href` (préserve l'historique + view transitions).
 *
 * Idempotent : appels multiples sont des no-ops.
 *
 * Sprint 35 `initPushNotifications` reste responsable de :
 *   - request permission
 *   - register (APNs/FCM)
 *   - POST /devices avec le token
 *
 * Cette fonction AJOUTE :
 *   - listener pushNotificationReceived foreground (toast enrichi)
 *   - listener pushNotificationActionPerformed background tap (routing typé)
 */
export async function setupPushRouting(navigate: NavigateFn): Promise<void> {
  if (_wired) return;
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Foreground reception → toast enrichi FR
    await PushNotifications.addListener('pushNotificationReceived', (notif: PushNotificationSchema) => {
      const data = (notif.data ?? {}) as PushDataPayload;
      const route = routeFromPushData(data);
      const fallbackTitle = notif.title || 'Nouvelle notification';
      const title = frenchTitleFor(data.type, fallbackTitle);
      const body = notif.body || '';

      // Toast Sonner avec action si route disponible
      void import('sonner').then(({ toast }) => {
        if (route) {
          toast(title, {
            description: body,
            action: {
              label: 'Ouvrir',
              onClick: () => { void navigate(route); },
            },
          });
        } else {
          toast.info(title, { description: body });
        }
      });
    });

    // Tap notification (background → foreground) → navigation routée
    await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const data = (action.notification.data ?? {}) as PushDataPayload;
      const route = routeFromPushData(data);
      if (route) {
        void navigate(route);
      } else if (data.url) {
        // Fallback ultime — préserve compat Sprint 11
        try { window.location.href = data.url; } catch { /* ignore */ }
      }
    });

    _wired = true;
  } catch (err) {
    // Plugin non installé ou erreur d'init → fail silent
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[pushNotifications] setupPushRouting skipped:', err);
    }
  }
}

/**
 * Reset badge count iOS (à appeler quand l'user ouvre l'app après tap).
 * No-op si plugin absent.
 */
export async function resetPushBadge(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllDeliveredNotifications();
  } catch { /* ignore */ }
}
