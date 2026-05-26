// ── booking-reminders.ts — LOT BOOKING REMINDERS / NO-SHOW (Sprint « Booking
//   pro completion ») ───────────────────────────────────────────────────────
//
// Fichier NEUF et ISOLÉ. Ferme 2 des 3 gaps du sprint :
//   GAP #1 — rappels automatiques AVANT RDV via cron dédié
//            (processBookingReminders, câblé dans worker.ts:scheduled()).
//   GAP #3 — no-show tracking côté `bookings` (markBookingNoShow, câblé sur
//            POST /api/bookings/:id/no-show, capability 'workflows.manage').
// (GAP #2 — liens self-service cancel/reschedule dans l'email de confirmation —
//  est implémenté par Manager-B DANS booking-public.ts:sendBookingConfirmation.
//  Ce fichier N'Y touche PAS.)
//
// ⚠ CORPS RÉELS PHASE B — Manager-B SOLO sur ce fichier. Les signatures
//   (ordre/typage des params, forme de la valeur de retour) NE CHANGENT PAS :
//   worker.ts (GELÉ Phase A) câble déjà ces fonctions. Contrat §6 verbatim
//   dans docs/LOT-BOOKING-REMINDERS.md (Phase B/C ne lisent QUE ce document +
//   le CODE).
//
// Conventions imposées (calque booking-public.ts / appointments.ts) :
//   - Imports RELATIFS uniquement (`./types`, `./helpers`, `./workflows`,
//     `./capabilities`) — PAS d'alias `@/` (tsconfig.worker.json ne les résout
//     pas).
//   - Statut bookings : énumération seq 7 INTOUCHABLE
//     ('confirmed','cancelled','completed','no_show') — JAMAIS 'pending'.
//     'no_show' EXISTE DÉJÀ dans le CHECK seq 7 (aucun ALTER de CHECK requis).
//   - best-effort : table/colonne absente (seq 84/103) ⇒ pas de throw non
//     maîtrisé ; le cron NE casse JAMAIS (waitUntil + try/catch).
//   - Idempotence rappel : `bookings.reminder_sent_at` (seq 84) — un booking
//     déjà rappelé n'est plus sélectionné.
//   - Capability : RÉUTILISE 'workflows.manage' (seq 80). AUCUN ajout à
//     ALL_CAPABILITIES.

import { Resend } from 'resend';
import type { Env } from './types';
import { json, sendSms } from './helpers';
import { requireCapability, type CapAuth } from './capabilities';
import { autoEnrollForTrigger } from './workflows';

// Auth enrichi au choke-point (worker.ts) — calque BookingAuth de
// booking-public.ts (userId/role/clientId/tenant/capabilities).
export type BookingReminderAuth = CapAuth & { capabilities?: Set<string> };

// ════════════════════════════════════════════════════════════════════════════
// GAP #1 — Rappels automatiques avant RDV (cron dédié)
// ════════════════════════════════════════════════════════════════════════════

/**
 * processBookingReminders — STUB PHASE A → corps réel Phase B Manager-B.
 *
 * Appelé en best-effort depuis worker.ts:scheduled() (calque EXACT du pattern
 * broadcasts / scheduled-reports). Itère sur les bookings à rappeler et envoie
 * email/SMS selon le type de RDV.
 *
 * CONTRAT FIGÉ (§6) du corps réel Phase B :
 *   - SELECT bookings WHERE status='confirmed' AND reminder_sent_at IS NULL,
 *     borné LIMIT 50, fenêtre temporelle raisonnable (start_time futur proche).
 *   - Jointure APPLICATIVE booking_event_types (event_type_id) pour récupérer
 *     reminder_offset_min (>0 = rappel actif) + reminder_channel
 *     ('email'|'sms'|'both'|NULL).
 *   - Si now >= start_time - reminder_offset_min*60_000 → envoi email/SMS via
 *     les MÊMES chemins que booking-public.ts:sendBookingConfirmation (Resend
 *     env.RESEND_API_KEY / helpers.ts:sendSms), puis
 *     UPDATE bookings SET reminder_sent_at = datetime('now') (idempotence).
 *   - best-effort intégral : un échec d'envoi isolé NE bloque PAS la boucle ;
 *     table/colonne absente ⇒ retour silencieux.
 */
export async function processBookingReminders(env: Env): Promise<void> {
  // STUB PHASE A — structure bornée qui COMPILE et ne casse jamais le cron.
  // Manager-B écrit le corps réel ci-dessous (SELECT + jointure applicative +
  // envoi + UPDATE reminder_sent_at). On NE jette JAMAIS : le cron est
  // best-effort (waitUntil + .catch côté worker.ts).
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, booking_page_id, event_type_id, client_id, guest_name,
              guest_email, guest_phone, start_time, reminder_sent_at, status
         FROM bookings
        WHERE status = 'confirmed' AND reminder_sent_at IS NULL
        ORDER BY start_time ASC
        LIMIT 50`,
    ).all();

    const nowMs = Date.now();

    for (const row of (results || []) as Array<Record<string, unknown>>) {
      // Manager-B: corps réel — chaque booking est traité dans un try/catch
      // ISOLÉ : un échec (envoi, lookup type, UPDATE) NE bloque PAS la boucle.
      try {
        const bookingId = row.id as string;
        const eventTypeId = (row.event_type_id as string | null) ?? null;
        const startTime = (row.start_time as string | null) ?? null;
        if (!bookingId || !startTime) continue;

        const startMs = Date.parse(startTime);
        if (Number.isNaN(startMs)) continue;
        // RDV déjà passé : aucun rappel à envoyer (mais on idempotente pour
        // ne pas re-sélectionner indéfiniment — voir UPDATE plus bas).
        const isPast = startMs <= nowMs;

        // 1) Jointure APPLICATIVE booking_event_types (par event_type_id) →
        //    reminder_offset_min (>0 = actif) + reminder_channel
        //    ('email'|'sms'|'both'|NULL). Pas de FK (calque booking-public.ts).
        let offsetMin = 0;
        let channel: string | null = null;
        if (eventTypeId) {
          try {
            const et = (await env.DB.prepare(
              'SELECT reminder_offset_min, reminder_channel FROM booking_event_types WHERE id = ?',
            )
              .bind(eventTypeId)
              .first()) as
              | { reminder_offset_min: unknown; reminder_channel: unknown }
              | null;
            if (et) {
              offsetMin = Number(et.reminder_offset_min) || 0;
              channel =
                typeof et.reminder_channel === 'string' && et.reminder_channel
                  ? (et.reminder_channel as string)
                  : null;
            }
          } catch {
            // Colonnes seq 103 / table seq 84 absentes : skip ce booking.
            continue;
          }
        }

        // Skip si rappel inactif (offset <= 0 ou canal NULL/inconnu).
        if (offsetMin <= 0 || !channel) continue;
        const wantEmail = channel === 'email' || channel === 'both';
        const wantSms = channel === 'sms' || channel === 'both';
        if (!wantEmail && !wantSms) continue;

        // 2) Fenêtre : now >= start_time - offset_min*60000. On NE rappelle pas
        //    un RDV déjà passé (mais on idempotente pour le retirer du SELECT).
        const dueAtMs = startMs - offsetMin * 60000;
        if (!isPast && nowMs >= dueAtMs) {
          const guestName = (row.guest_name as string | null) || 'client';
          const guestEmail = (row.guest_email as string | null) || '';
          const guestPhone = (row.guest_phone as string | null) || '';
          const when = new Date(startMs).toLocaleString('fr-CA');
          const reminderMsg = `Rappel : votre rendez-vous est prévu pour le ${when}.`;

          // Envoi email — MÊME chemin que sendBookingConfirmation (Resend
          // env.RESEND_API_KEY). Echec isolé non bloquant.
          if (wantEmail && env.RESEND_API_KEY && guestEmail) {
            try {
              const resend = new Resend(env.RESEND_API_KEY);
              await resend.emails.send({
                from: 'Intralys CRM <noreply@intralys.com>',
                to: [guestEmail],
                subject: 'Rappel de votre rendez-vous',
                html: `<p>Bonjour ${guestName},</p><p>${reminderMsg}</p><p>Date : ${when}</p>`,
              });
            } catch {
              /* envoi non critique */
            }
          }

          // Envoi SMS — MÊME chemin que sendBookingConfirmation (helpers.sendSms).
          if (wantSms && guestPhone) {
            try {
              await sendSms(env, guestPhone, `${reminderMsg} (${when})`);
            } catch {
              /* envoi non critique */
            }
          }
        }

        // 3) Idempotence : UPDATE reminder_sent_at (seq 84). On marque DÈS que
        //    le booking est éligible (rappel envoyé OU déjà passé) afin qu'il
        //    ne soit plus re-sélectionné (SELECT borné LIMIT 50, déterministe).
        if (isPast || nowMs >= dueAtMs) {
          try {
            await env.DB.prepare(
              "UPDATE bookings SET reminder_sent_at = datetime('now') WHERE id = ?",
            )
              .bind(bookingId)
              .run();
          } catch {
            /* colonne seq 84 absente : best-effort */
          }
        }
      } catch {
        // Echec isolé sur ce booking : on continue la boucle (best-effort).
        continue;
      }
    }
  } catch {
    // Table/colonne seq 84/103 absente, ou panne D1 : best-effort, le cron
    // continue (les autres jobs scheduled() ne sont pas affectés).
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GAP #3 — No-show tracking côté bookings (endpoint protégé)
// ════════════════════════════════════════════════════════════════════════════

/**
 * markBookingNoShow — corps minimal FONCTIONNEL (Phase A). Manager-B PEUT
 * enrichir (logs/notifications) mais NE CHANGE PAS la signature ni la forme de
 * retour (worker.ts GELÉ câble déjà cette fonction sur
 * POST /api/bookings/:id/no-show).
 *
 * Marque un booking 'no_show' (énumération seq 7 — 'no_show' DÉJÀ présent dans
 * le CHECK, AUCUN ALTER). Renseigne no_show_at (seq 103). Borné au tenant
 * (calque rowInTenant booking-public.ts). Déclenche le trigger workflow
 * 'appointment_no_show' si le booking est lié à un lead (calque
 * appointments.ts:177).
 *
 * Retour FIGÉ : { ok: boolean } (true si l'UPDATE a abouti).
 */
export async function markBookingNoShow(
  env: Env,
  bookingId: string,
  auth: BookingReminderAuth,
): Promise<{ ok: boolean }> {
  if (!bookingId) return { ok: false };

  // Garde capability (réutilise 'workflows.manage' seq 80 — calque
  // booking-public.ts:capGuard). Le retour Response est géré côté worker.ts ;
  // ici on borne défensivement (defense-in-depth) : capability refusée ⇒ ok:false.
  const denied = requireCapability(auth.capabilities, 'workflows.manage');
  if (denied) return { ok: false };

  // Charge la row pour bornage tenant (calque rowInTenant booking-public.ts).
  type BookingRow = { id: string; lead_id: string | null; client_id: string | null; agency_id: string | null; status: string };
  let row: BookingRow | null = null;
  try {
    row = (await env.DB.prepare(
      'SELECT id, lead_id, client_id, agency_id, status FROM bookings WHERE id = ?',
    )
      .bind(bookingId)
      .first()) as BookingRow | null;
  } catch {
    return { ok: false };
  }
  if (!row) return { ok: false };
  if (!rowInTenant(row, auth)) return { ok: false };

  // UPDATE borné au tenant : status='no_show' (seq 7) + no_show_at (seq 103).
  // Repli rétro-compat si la colonne no_show_at (seq 103) n'est pas encore
  // appliquée (best-effort — pas de 500).
  try {
    await env.DB.prepare(
      "UPDATE bookings SET status = 'no_show', no_show_at = datetime('now') WHERE id = ?",
    )
      .bind(bookingId)
      .run();
  } catch {
    try {
      await env.DB.prepare(
        "UPDATE bookings SET status = 'no_show' WHERE id = ?",
      )
        .bind(bookingId)
        .run();
    } catch {
      return { ok: false };
    }
  }

  // Trigger workflow 'appointment_no_show' (déjà câblé — calque
  // appointments.ts:177 ; workflows.ts string-match libre). best-effort.
  if (row.lead_id) {
    try {
      await autoEnrollForTrigger(env, 'appointment_no_show', row.lead_id);
    } catch {
      /* best-effort */
    }
  }

  return { ok: true };
}

// ── Bornage tenant (calque booking-public.ts:rowInTenant) ───────────────────
// Legacy/mono-tenant (!tenant || agencyId == null) → true (rétro-compat). Mode
// agence → client_id ∈ accessibleClientIds OU agency_id == tenant.agencyId.
function rowInTenant(
  row: { client_id?: unknown; agency_id?: unknown },
  auth: BookingReminderAuth,
): boolean {
  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return true;
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;
  return (
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId)
  );
}

/**
 * handleMarkNoShow — wrapper Response pour la route protégée
 * POST /api/bookings/:id/no-show (worker.ts GELÉ l'appelle). Réponses
 * `{data}` / `{error}` UNIQUEMENT (§6.A — jamais de champ `code`).
 *
 * Succès : json({ data: { success: true } }). Échec : json({ error }, status).
 */
export async function handleMarkNoShow(
  env: Env,
  auth: BookingReminderAuth,
  bookingId: string,
): Promise<Response> {
  const denied = requireCapability(auth.capabilities, 'workflows.manage');
  if (denied) return denied;
  if (!bookingId) return json({ error: 'id requis' }, 400);

  const res = await markBookingNoShow(env, bookingId, auth);
  if (!res.ok) return json({ error: 'Introuvable' }, 404);
  return json({ data: { success: true } });
}
