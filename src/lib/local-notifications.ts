// ── Local Notifications — Rappels tâches & RDV ─────────────
// Sprint 11 — Capacitor V1

import { Capacitor } from '@capacitor/core';

interface ScheduleNotification {
  id: number;
  title: string;
  body: string;
  scheduleAt: Date;
  data?: Record<string, string>;
}

// ── Planifier une notification locale ───────────────────────

export async function scheduleLocalNotification(notif: ScheduleNotification): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    // Demander la permission si pas encore fait
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;

    await LocalNotifications.schedule({
      notifications: [{
        id: notif.id,
        title: notif.title,
        body: notif.body,
        schedule: { at: notif.scheduleAt },
        extra: notif.data,
        smallIcon: 'ic_notification',
        largeIcon: 'ic_launcher',
      }],
    });
  } catch (err) {
    console.error('Erreur schedule local notification:', err);
  }
}

// ── Planifier un rappel pour un RDV ─────────────────────────

export async function scheduleAppointmentReminder(
  appointmentId: string,
  title: string,
  startTime: Date,
  minutesBefore: number = 30
): Promise<void> {
  const reminderTime = new Date(startTime.getTime() - minutesBefore * 60 * 1000);

  // Ne pas planifier si la date est déjà passée
  if (reminderTime <= new Date()) return;

  await scheduleLocalNotification({
    id: hashStringToInt(appointmentId),
    title: `Rappel : ${title}`,
    body: `Votre rendez-vous commence dans ${minutesBefore} minutes`,
    scheduleAt: reminderTime,
    data: { type: 'appointment', id: appointmentId },
  });
}

// ── Planifier un rappel pour une tâche ──────────────────────

export async function scheduleTaskReminder(
  taskId: string,
  title: string,
  dueDate: Date,
  minutesBefore: number = 60
): Promise<void> {
  const reminderTime = new Date(dueDate.getTime() - minutesBefore * 60 * 1000);

  if (reminderTime <= new Date()) return;

  await scheduleLocalNotification({
    id: hashStringToInt(taskId),
    title: `Tâche à faire : ${title}`,
    body: `Échéance dans ${minutesBefore >= 60 ? `${Math.floor(minutesBefore / 60)}h` : `${minutesBefore} min`}`,
    scheduleAt: reminderTime,
    data: { type: 'task', id: taskId },
  });
}

// ── Annuler une notification planifiée ───────────────────────

export async function cancelLocalNotification(entityId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({
      notifications: [{ id: hashStringToInt(entityId) }],
    });
  } catch (err) {
    console.error('Erreur cancel local notification:', err);
  }
}

// ── Helper : convertir un UUID en int pour l'ID de notif ────

function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convertir en 32-bit integer
  }
  return Math.abs(hash);
}
