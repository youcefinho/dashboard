// ── push-notification-engine.test.ts — Sprint 98 (seq193) ───────────────────
// Tests pour les notifications push enrichies (Rich Push).
// 15 cas : payloads FCM/APNS, actions, tokens, quiet hours, badge.

import { describe, it, expect } from 'vitest';
import {
  buildFcmPayload,
  buildApnsPayload,
  buildPushActions,
  validatePushToken,
  shouldSendPush,
  buildBadgeCount,
  PUSH_CATEGORIES,
  PUSH_PLATFORMS,
  type PushNotification,
  type UserPushPreferences,
} from '../lib/push-notification-engine';

const baseNotification: PushNotification = {
  title: 'Nouveau lead',
  body: 'Jean Tremblay vient de soumettre un formulaire',
  category: 'new_lead',
};

// ──────────────────────────────────────────────────────────────────────────
// buildFcmPayload — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S98 — buildFcmPayload', () => {
  it('1. Payload FCM structuré correctement', () => {
    const payload = buildFcmPayload(baseNotification, 'test-token-123');
    expect(payload.message.token).toBe('test-token-123');
    expect(payload.message.notification.title).toBe('Nouveau lead');
    expect(payload.message.notification.body).toContain('Jean Tremblay');
    expect(payload.message.android.priority).toBe('high');
    expect(payload.message.android.notification.channel_id).toBe('intralys_new_lead');
  });

  it('2. Image URL incluse dans le payload', () => {
    const notif: PushNotification = {
      ...baseNotification,
      imageUrl: 'https://cdn.intralys.com/photo.jpg',
    };
    const payload = buildFcmPayload(notif, 'tok');
    expect(payload.message.notification.image).toBe('https://cdn.intralys.com/photo.jpg');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildApnsPayload — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S98 — buildApnsPayload', () => {
  it('3. Payload APNS structuré correctement', () => {
    const payload = buildApnsPayload(baseNotification);
    expect(payload.aps.alert.title).toBe('Nouveau lead');
    expect(payload.aps['mutable-content']).toBe(1);
    expect(payload.aps.category).toBe('INTRALYS_NEW_LEAD');
    expect(payload.aps['thread-id']).toBe('new_lead');
  });

  it('4. Badge et image inclus dans le payload APNS', () => {
    const notif: PushNotification = {
      ...baseNotification,
      badge: 5,
      imageUrl: 'https://cdn.intralys.com/avatar.jpg',
    };
    const payload = buildApnsPayload(notif);
    expect(payload.aps.badge).toBe(5);
    expect(payload.media_url).toBe('https://cdn.intralys.com/avatar.jpg');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildPushActions — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S98 — buildPushActions', () => {
  it('5. new_lead → 2 actions (Appeler, Assigner)', () => {
    const actions = buildPushActions('new_lead');
    expect(actions.length).toBe(2);
    expect(actions[0]!.id).toBe('call');
    expect(actions[1]!.id).toBe('assign');
  });

  it('6. Chaque catégorie a au moins 1 action', () => {
    for (const cat of PUSH_CATEGORIES) {
      const actions = buildPushActions(cat);
      expect(actions.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// validatePushToken — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S98 — validatePushToken', () => {
  it('7. Token APNS valide (64 hex chars)', () => {
    const token = 'a'.repeat(64);
    expect(validatePushToken(token, 'apns')).toBe(true);
  });

  it('8. Token APNS invalide (trop court)', () => {
    expect(validatePushToken('abc', 'apns')).toBe(false);
    expect(validatePushToken('', 'apns')).toBe(false);
  });

  it('9. Token FCM valide (100-300 chars)', () => {
    const token = 'dJx7_Bk' + 'A'.repeat(100) + ':APA91b' + 'C'.repeat(80);
    expect(validatePushToken(token, 'fcm')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// shouldSendPush — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S98 — shouldSendPush', () => {
  it('10. Notifications désactivées → false', () => {
    const prefs: UserPushPreferences = { enabled: false };
    expect(shouldSendPush(prefs, 'new_lead')).toBe(false);
  });

  it('11. Catégorie mutée → false', () => {
    const prefs: UserPushPreferences = { enabled: true, muted_categories: ['task_due'] };
    expect(shouldSendPush(prefs, 'task_due')).toBe(false);
    expect(shouldSendPush(prefs, 'new_lead')).toBe(true);
  });

  it('12. Quiet hours overnight (22:00→07:00) → bloqué à 23:30, autorisé à 12:00', () => {
    const prefs: UserPushPreferences = {
      enabled: true,
      quiet_start: '22:00',
      quiet_end: '07:00',
    };
    expect(shouldSendPush(prefs, 'new_lead', '23:30')).toBe(false);
    expect(shouldSendPush(prefs, 'new_lead', '03:00')).toBe(false);
    expect(shouldSendPush(prefs, 'new_lead', '12:00')).toBe(true);
    expect(shouldSendPush(prefs, 'new_lead', '08:00')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// buildBadgeCount — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S98 — buildBadgeCount', () => {
  it('13. Somme des unread counts', () => {
    const count = buildBadgeCount({ messages: 3, tasks: 2, leads: 1, notifications: 4 });
    expect(count).toBe(10);
  });

  it('14. Cap à 99 maximum', () => {
    const count = buildBadgeCount({ messages: 50, tasks: 30, leads: 20, notifications: 10 });
    expect(count).toBe(99);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Config structurelle
// ──────────────────────────────────────────────────────────────────────────

describe('S98 — config exports', () => {
  it('15. PUSH_CATEGORIES contient 8 catégories', () => {
    expect(PUSH_CATEGORIES.length).toBe(8);
    expect(PUSH_CATEGORIES).toContain('new_lead');
    expect(PUSH_CATEGORIES).toContain('new_message');
    expect(PUSH_CATEGORIES).toContain('deal_won');
  });

  it('16. PUSH_PLATFORMS = [fcm, apns]', () => {
    expect(PUSH_PLATFORMS).toEqual(['fcm', 'apns']);
  });
});
