// ── push-notification-engine.ts — Sprint 98 (seq193) ────────────────────────
// Notifications push mobiles enrichies (Rich Push) pour FCM & APNS.
//
// Couvre :
//   - Construction de payloads FCM v1 et APNS structurés
//   - Catégories de notifications avec actions rapides
//   - Validation de tokens push (FCM/APNS)
//   - Respect des préférences utilisateur (quiet hours, DND)
//   - Calcul du badge count
//
// ZÉRO I/O. Helpers purs — le caller fait l'appel HTTP vers FCM/APNS.

// ── Catégories de notifications ───────────────────────────────────────────

export const PUSH_CATEGORIES = Object.freeze([
  'new_lead',
  'new_message',
  'task_due',
  'appointment_reminder',
  'deal_won',
  'deal_lost',
  'team_mention',
  'system_alert',
] as const);

export type PushCategory = (typeof PUSH_CATEGORIES)[number];

// ── Plateformes ───────────────────────────────────────────────────────────

export const PUSH_PLATFORMS = Object.freeze(['fcm', 'apns'] as const);
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

// ── Codes d'erreur ────────────────────────────────────────────────────────

export const PUSH_ERROR_CODES = Object.freeze({
  TOKEN_INVALID: 'PUSH_TOKEN_INVALID',
  CATEGORY_INVALID: 'PUSH_CATEGORY_INVALID',
  PAYLOAD_TOO_LARGE: 'PUSH_PAYLOAD_TOO_LARGE',
  QUIET_HOURS: 'PUSH_QUIET_HOURS',
} as const);

export type PushErrorCode = (typeof PUSH_ERROR_CODES)[keyof typeof PUSH_ERROR_CODES];

// ── Interfaces ────────────────────────────────────────────────────────────

export interface PushNotification {
  title: string;
  body: string;
  category: PushCategory;
  /** URL de l'image à afficher (rich push). */
  imageUrl?: string;
  /** Données custom envoyées dans le payload silencieux. */
  data?: Record<string, string>;
  /** Son personnalisé (nom du fichier sans extension). */
  sound?: string;
  /** Badge count (si null → ne pas modifier le badge actuel). */
  badge?: number;
}

export interface PushAction {
  id: string;
  title: string;
  /** Si true, l'action ouvre l'app. Si false, action silencieuse. */
  foreground: boolean;
  /** Si true, l'action est destructive (rouge sur iOS). */
  destructive?: boolean;
}

// ── Actions rapides par catégorie ─────────────────────────────────────────

const CATEGORY_ACTIONS: Record<PushCategory, PushAction[]> = {
  new_lead: [
    { id: 'call', title: 'Appeler', foreground: true },
    { id: 'assign', title: 'Assigner', foreground: false },
  ],
  new_message: [
    { id: 'reply', title: 'Répondre', foreground: true },
    { id: 'mark_read', title: 'Lu', foreground: false },
  ],
  task_due: [
    { id: 'complete', title: 'Terminée', foreground: false },
    { id: 'snooze', title: 'Reporter', foreground: false },
  ],
  appointment_reminder: [
    { id: 'confirm', title: 'Confirmer', foreground: false },
    { id: 'reschedule', title: 'Reporter', foreground: true },
  ],
  deal_won: [
    { id: 'view', title: 'Voir', foreground: true },
  ],
  deal_lost: [
    { id: 'view', title: 'Voir', foreground: true },
    { id: 'reopen', title: 'Réouvrir', foreground: false },
  ],
  team_mention: [
    { id: 'reply', title: 'Répondre', foreground: true },
  ],
  system_alert: [
    { id: 'view', title: 'Détails', foreground: true },
    { id: 'dismiss', title: 'Ignorer', foreground: false },
  ],
};

/** Retourne les actions rapides disponibles pour une catégorie. */
export function buildPushActions(category: PushCategory): PushAction[] {
  return CATEGORY_ACTIONS[category] ?? [];
}

// ── Payload FCM v1 ────────────────────────────────────────────────────────

export interface FcmPayload {
  message: {
    token: string;
    notification: {
      title: string;
      body: string;
      image?: string;
    };
    data?: Record<string, string>;
    android: {
      priority: 'high' | 'normal';
      notification: {
        channel_id: string;
        sound: string;
        click_action: string;
      };
    };
    webpush?: {
      notification: {
        icon: string;
        actions: Array<{ action: string; title: string }>;
      };
    };
  };
}

/** Construit un payload FCM v1 structuré pour une notification enrichie. */
export function buildFcmPayload(
  notification: PushNotification,
  token: string,
): FcmPayload {
  const actions = buildPushActions(notification.category);
  return {
    message: {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
        ...(notification.imageUrl ? { image: notification.imageUrl } : {}),
      },
      ...(notification.data ? { data: notification.data } : {}),
      android: {
        priority: 'high',
        notification: {
          channel_id: `intralys_${notification.category}`,
          sound: notification.sound ?? 'default',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      webpush: {
        notification: {
          icon: '/icons/icon-192.png',
          actions: actions.map((a) => ({ action: a.id, title: a.title })),
        },
      },
    },
  };
}

// ── Payload APNS ──────────────────────────────────────────────────────────

export interface ApnsPayload {
  aps: {
    alert: {
      title: string;
      body: string;
    };
    badge?: number;
    sound: string;
    'mutable-content': 1;
    category: string;
    'thread-id': string;
  };
  /** Données custom pour le Notification Service Extension. */
  media_url?: string;
  data?: Record<string, string>;
}

/** Construit un payload APNS structuré pour une notification enrichie iOS. */
export function buildApnsPayload(
  notification: PushNotification,
): ApnsPayload {
  return {
    aps: {
      alert: {
        title: notification.title,
        body: notification.body,
      },
      ...(notification.badge !== undefined ? { badge: notification.badge } : {}),
      sound: notification.sound ?? 'default',
      'mutable-content': 1,
      category: `INTRALYS_${notification.category.toUpperCase()}`,
      'thread-id': notification.category,
    },
    ...(notification.imageUrl ? { media_url: notification.imageUrl } : {}),
    ...(notification.data ? { data: notification.data } : {}),
  };
}

// ── Validation de token ───────────────────────────────────────────────────

/** Valide le format d'un token push selon la plateforme.
 *  FCM : 100-300 chars alphanumériques avec : et _
 *  APNS : 64 chars hexadécimaux */
export function validatePushToken(
  token: string,
  platform: PushPlatform,
): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;

  if (platform === 'apns') {
    return /^[0-9a-fA-F]{64}$/.test(token);
  }

  if (platform === 'fcm') {
    return token.length >= 100 && token.length <= 300 && /^[A-Za-z0-9_:.-]+$/.test(token);
  }

  return false;
}

// ── Quiet hours / DND ─────────────────────────────────────────────────────

export interface UserPushPreferences {
  /** Notifications activées globalement. */
  enabled: boolean;
  /** Catégories désactivées. */
  muted_categories?: PushCategory[];
  /** Quiet hours (format HH:MM). */
  quiet_start?: string; // ex: '22:00'
  quiet_end?: string;   // ex: '07:00'
}

/** Vérifie si une notification doit être envoyée selon les préférences.
 *  Respecte : enabled, muted_categories, quiet hours. */
export function shouldSendPush(
  prefs: UserPushPreferences,
  category: PushCategory,
  currentHourMinute?: string, // 'HH:MM' — injectable pour tests
): boolean {
  if (!prefs.enabled) return false;
  if (prefs.muted_categories?.includes(category)) return false;

  // Quiet hours
  if (prefs.quiet_start && prefs.quiet_end && currentHourMinute) {
    const current = timeToMinutes(currentHourMinute);
    const start = timeToMinutes(prefs.quiet_start);
    const end = timeToMinutes(prefs.quiet_end);

    if (current === -1 || start === -1 || end === -1) return true; // Format invalide → envoyer

    if (start <= end) {
      // Plage simple : ex. 08:00 → 17:00
      if (current >= start && current < end) return false;
    } else {
      // Plage overnight : ex. 22:00 → 07:00
      if (current >= start || current < end) return false;
    }
  }

  return true;
}

function timeToMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  if (parts.length !== 2) return -1;
  const h = parseInt(parts[0]!, 10);
  const m = parseInt(parts[1]!, 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

// ── Badge count ───────────────────────────────────────────────────────────

export interface UnreadCounts {
  messages: number;
  tasks: number;
  leads: number;
  notifications: number;
}

/** Calcule le badge total pour l'icône de l'app mobile. */
export function buildBadgeCount(counts: UnreadCounts): number {
  const total =
    (counts.messages ?? 0) +
    (counts.tasks ?? 0) +
    (counts.leads ?? 0) +
    (counts.notifications ?? 0);
  // Cap à 99+ (iOS affiche un nombre, pas l'infini)
  return Math.min(total, 99);
}
