// ── calls-outbound.ts — Sprint 34 Twilio Voice click-to-call + recording toggle
// + signed URL + delete RGPD (Phase B — corps réels) ──────────────────────────
//
// 4 handlers AUTHED câblés dans src/worker.ts routeProtected APRÈS les routes
// calls existantes (~l.1517). Signatures FIGÉES Phase A — Phase B remplit corps.
//
// Capabilities seq80 RÉUTILISÉES (zéro ajout ALL_CAPABILITIES) :
//   - 'leads.write'    : initiate outbound + toggle recording + get signed URL
//   - 'settings.manage' : delete recording (RGPD)
//
// Bornage tenant STRICT (defense-in-depth IDOR) : auth.clientId / auth.tenant.
//   clientId via resolveClientId pattern telephony.ts:185-195. JAMAIS de
//   client_id depuis le body. JAMAIS d'IDOR cross-tenant — toute SELECT/UPDATE/
//   DELETE sur call_logs.id est bornée `AND client_id = ?` (admin non borné).
//
// FLAG INACTIF Twilio — calls helpers lib/twilio-voice.ts qui gardent mock si
// !TWILIO_*. call_log / voicemail / call_recordings_metadata row créés QUAND
// MÊME (status='mock' / mock=true) — wiring CRM testable sans credentials.
//
// Imports RELATIFS uniquement (./types, ./helpers, ./capabilities, ./lib/twilio-voice).
//
// Contrat figé docs/LOT-TWILIO-VOICE-S34.md §6.5.

import type { Env } from './types';
import { json, audit, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import {
  initiateOutboundCall,
  startCallRecording,
  stopCallRecording,
  getSignedR2Url,
  deleteTwilioRecording,
  deleteR2Recording,
} from './lib/twilio-voice';

// Auth enrichi au choke-point (worker.ts) — calque type passé à routeProtected.
type OutboundAuth = CapAuth & { capabilities?: Set<string> };

// Résolution client_id tenant (calque telephony.ts:185-195 ; admin = null/non
// borné). JAMAIS de client_id depuis body — defense-in-depth IDOR.
async function resolveClientId(env: Env, auth: OutboundAuth): Promise<string | null> {
  if (auth.role === 'admin') return null;
  if (auth.clientId) return auth.clientId;
  try {
    const user = (await env.DB.prepare('SELECT client_id FROM users WHERE id = ?')
      .bind(auth.userId)
      .first()) as { client_id: string } | null;
    return user?.client_id ?? null;
  } catch {
    return null;
  }
}

/**
 * POST /api/calls/outbound — initie un appel sortant click-to-call avec option
 * d'enregistrement (consent bi-party CRTC obligatoire si record=true).
 *
 * Cap : 'leads.write'.
 *
 * Body : { to: string; lead_id?: string; record?: boolean; consent_obtained?: boolean }
 *
 * Flow :
 *   1) capGuard 'leads.write'.
 *   2) Parse + validate to E.164 (^\+[1-9]\d{6,14}$).
 *   3) resolveClientId(env, auth) — clientId résolu SERVEUR, jamais body.
 *   4) Refus 400 si record=true && !consent_obtained (politique CRTC).
 *   5) from_number = sub_accounts.twilio_phone (clientId) OU clients.phone
 *      OU env.TWILIO_PHONE_NUMBER (fallback global).
 *   6) INSERT call_logs (direction='outbound', status='queued',
 *      recording_consent_obtained_at = consent_obtained ? now() : NULL).
 *   7) initiateOutboundCall — FLAG INACTIF mock si pas de credentials. Le
 *      call_log row reste créé QUAND MÊME pour wiring CRM testable.
 *   8) UPDATE call_logs status='initiated'|'mock'|'failed' + twilio_sid.
 *   9) audit + retour { data: { id, status, mock, recording_enabled } }.
 */
export async function handleInitiateOutboundCall(
  request: Request,
  env: Env,
  auth: OutboundAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;

  try {
    // Parse body — best-effort, corps invalide ⇒ 400.
    let body: { to?: string; lead_id?: string; record?: boolean; consent_obtained?: boolean } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Corps invalide' }, 400);
    }

    // Validation E.164 du destinataire (whitelist regex stricte).
    const to = sanitizeInput(body.to, 32);
    if (!to || !to.match(/^\+[1-9]\d{6,14}$/)) {
      return json({ error: 'Numéro invalide' }, 400);
    }

    // Bornage tenant : client_id résolu SERVEUR (defense-in-depth IDOR).
    const clientId = await resolveClientId(env, auth);
    if (!clientId && auth.role !== 'admin') {
      return json({ error: 'Tenant non résolu' }, 400);
    }

    // CRTC bi-party : refus si record=true sans consent obtenu.
    const wantRecord = !!body.record;
    const consentObtained = !!body.consent_obtained;
    if (wantRecord && !consentObtained) {
      return json({ error: 'Consentement enregistrement requis (CRTC bi-party)' }, 400);
    }

    const leadId = sanitizeInput(body.lead_id, 64) || null;

    // From number : sub_accounts.twilio_phone (tenant) → clients.phone → env
    // fallback global. best-effort sur table absente.
    let fromNumber: string | null = null;
    if (clientId) {
      try {
        const sub = (await env.DB.prepare(
          'SELECT twilio_phone FROM sub_accounts WHERE client_id = ? AND twilio_phone IS NOT NULL LIMIT 1',
        )
          .bind(clientId)
          .first()) as { twilio_phone: string | null } | null;
        fromNumber = sub?.twilio_phone || null;
      } catch {
        fromNumber = null;
      }
      if (!fromNumber) {
        try {
          const cli = (await env.DB.prepare('SELECT phone FROM clients WHERE id = ?')
            .bind(clientId)
            .first()) as { phone: string | null } | null;
          fromNumber = cli?.phone || null;
        } catch {
          fromNumber = null;
        }
      }
    }
    if (!fromNumber) fromNumber = env.TWILIO_PHONE_NUMBER || null;

    // INSERT call_logs status='queued' AVANT l'appel Twilio (journalisation +
    // wiring testables sans credentials).
    const callLogId = crypto.randomUUID();
    const consentTs = consentObtained ? new Date().toISOString() : null;
    try {
      await env.DB.prepare(
        `INSERT INTO call_logs
           (id, client_id, lead_id, direction, from_number, to_number, status,
            recording_consent_obtained_at, created_at)
         VALUES (?, ?, ?, 'outbound', ?, ?, 'queued', ?, datetime('now'))`,
      )
        .bind(callLogId, clientId, leadId, fromNumber, to, consentTs)
        .run();
    } catch {
      // Table seq102 absente / panne D1 : best-effort, on continue.
    }

    // URL parse pour validation request (callbacks Twilio = bornage en aval,
    // pas nécessaire ici). On garde la parse pour anti-replay.
    new URL(request.url);

    // initiateOutboundCall — FLAG INACTIF mock si pas de credentials.
    const res = await initiateOutboundCall(env, {
      to,
      from: fromNumber || undefined,
      leadId,
      clientId,
      record: wantRecord,
      consentObtained,
    });

    // Determine status final + Twilio SID.
    let finalStatus = 'mock';
    let twilioSid: string | null = null;
    if (res.mock) {
      finalStatus = 'mock';
    } else if (res.success && res.data?.callSid) {
      finalStatus = 'initiated';
      twilioSid = res.data.callSid;
    } else if (res.success && res.sid) {
      finalStatus = 'initiated';
      twilioSid = res.sid;
    } else {
      finalStatus = 'failed';
    }

    // UPDATE call_logs status + twilio_sid (best-effort).
    try {
      await env.DB.prepare(
        'UPDATE call_logs SET status = ?, twilio_sid = ? WHERE id = ?',
      )
        .bind(finalStatus, twilioSid, callLogId)
        .run();
    } catch {
      // best-effort.
    }

    // Audit (best-effort, jamais throw).
    await audit(env, auth.userId, 'call.outbound.initiated', 'call_log', callLogId, {
      to,
      record: wantRecord,
      mock: !!res.mock,
    });

    return json({
      data: {
        id: callLogId,
        status: finalStatus,
        mock: !!res.mock,
        recording_enabled: wantRecord && consentObtained,
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/**
 * POST /api/calls/:id/record — toggle ON/OFF l'enregistrement d'un appel en
 * cours. Body : { enable: boolean }.
 *
 * Cap : 'leads.write'.
 *
 * Flow (defense-in-depth IDOR : SELECT borné `AND client_id = ?`) :
 *   1) capGuard 'leads.write'.
 *   2) Lookup call_log borné tenant ⇒ 404 si absent/cross-tenant.
 *   3) startCallRecording / stopCallRecording (FLAG INACTIF mock).
 *   4) UPDATE call_logs.recording_sid si start (best-effort).
 *   5) audit + retour { data: { success, recording_sid } }.
 */
export async function handleToggleCallRecording(
  request: Request,
  env: Env,
  auth: OutboundAuth,
  callLogId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;

  try {
    const id = sanitizeInput(callLogId, 64);
    const clientId = await resolveClientId(env, auth);

    // Lookup call_log BORNÉ tenant — defense-in-depth IDOR : on rejette tout
    // call_log dont le client_id ne match pas l'auth.clientId (admin non borné).
    let sql = 'SELECT twilio_sid, client_id, recording_sid FROM call_logs WHERE id = ?';
    const binds: (string | number)[] = [id];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    type ToggleRow = { twilio_sid: string | null; client_id: string | null; recording_sid: string | null };
    let row: ToggleRow | null = null;
    try {
      row = (await env.DB.prepare(sql).bind(...binds).first()) as ToggleRow | null;
    } catch {
      row = null;
    }
    if (!row) return json({ error: 'Appel introuvable' }, 404);

    // Parse body { enable }.
    let body: { enable?: boolean } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }
    const enable = !!body.enable;

    const twilioSid = row.twilio_sid || '';
    if (!twilioSid) {
      // Pas de SID Twilio ⇒ mock pur (appel jamais réellement émis).
      await audit(env, auth.userId, enable ? 'call.recording.started' : 'call.recording.stopped',
        'call_log', id, { mock: true, enable });
      return json({ data: { success: false, recording_sid: null, mock: true } });
    }

    let recordingSid: string | null = null;
    let success = false;
    let mock = false;
    if (enable) {
      const res = await startCallRecording(env, { callSid: twilioSid });
      mock = !!res.mock;
      success = !!res.success;
      recordingSid = res.data?.recordingSid || res.sid || null;
      // UPDATE call_logs.recording_sid si on en a un nouveau (best-effort).
      if (recordingSid) {
        try {
          await env.DB.prepare('UPDATE call_logs SET recording_sid = ? WHERE id = ?')
            .bind(recordingSid, id)
            .run();
        } catch {
          // best-effort.
        }
      }
    } else {
      const existingSid = row.recording_sid || '';
      const res = await stopCallRecording(env, twilioSid, existingSid);
      mock = !!res.mock;
      success = !!res.success;
      recordingSid = existingSid || null;
    }

    await audit(env, auth.userId, enable ? 'call.recording.started' : 'call.recording.stopped',
      'call_log', id, { enable, mock, recording_sid: recordingSid });

    return json({ data: { success, recording_sid: recordingSid, mock } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/**
 * GET /api/calls/:id/recording-url — génère une URL signée R2 temporaire pour
 * streamer l'audio enregistré côté frontend (RecordingPlayer Phase C).
 *
 * Cap : 'leads.write'.
 *
 * Flow (defense-in-depth IDOR : SELECT borné `AND client_id = ?`) :
 *   1) capGuard 'leads.write'.
 *   2) Lookup call_log borné tenant ⇒ 404 si absent.
 *   3) 404 si recording_r2_key NULL (enregistrement pas encore téléchargé).
 *   4) getSignedR2Url TTL 600s (10 min).
 *   5) audit accès (RGPD trail) + retour { data: { url, expires_at } }.
 */
export async function handleGetRecordingSignedUrl(
  env: Env,
  auth: OutboundAuth,
  callLogId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;

  try {
    const id = sanitizeInput(callLogId, 64);
    const clientId = await resolveClientId(env, auth);

    // Lookup BORNÉ tenant — defense-in-depth IDOR.
    let sql = 'SELECT recording_r2_key, client_id FROM call_logs WHERE id = ?';
    const binds: (string | number)[] = [id];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    type SignedUrlRow = { recording_r2_key: string | null; client_id: string | null };
    let row: SignedUrlRow | null = null;
    try {
      row = (await env.DB.prepare(sql).bind(...binds).first()) as SignedUrlRow | null;
    } catch {
      row = null;
    }
    if (!row) return json({ error: 'Appel introuvable' }, 404);
    if (!row.recording_r2_key) return json({ error: 'Enregistrement non disponible' }, 404);

    // URL signée TTL 600s (10 min) — court par défaut (re-fetch si besoin).
    const res = await getSignedR2Url(env, row.recording_r2_key, 600);
    if (!res.success || !res.data) {
      return json({ error: res.error || 'Échec génération URL signée' }, 500);
    }

    // Audit RGPD accès (best-effort).
    await audit(env, auth.userId, 'call.recording.accessed', 'call_log', id, {
      r2_key: row.recording_r2_key,
    });

    return json({
      data: {
        url: res.data.url,
        expires_at: res.data.expiresAt,
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/**
 * DELETE /api/calls/:id/recording — suppression RGPD (right-to-erasure) :
 * cascade delete côté Twilio + R2 + UPDATE call_recordings_metadata.deleted_at
 * + RESET call_logs.recording_* à NULL.
 *
 * Cap : 'settings.manage' (action RGPD réservée admin, plus restrictive que
 * leads.write).
 *
 * Flow (defense-in-depth IDOR : SELECT borné `AND client_id = ?`) :
 *   1) capGuard 'settings.manage'.
 *   2) Lookup call_log borné tenant ⇒ 404 si absent.
 *   3) deleteTwilioRecording (best-effort, log failure mais continue).
 *   4) env.FILES.delete (best-effort).
 *   5) UPDATE call_logs reset recording_*.
 *   6) UPDATE call_recordings_metadata deleted_at + twilio_deleted_at.
 *   7) audit RGPD + retour { data: { success: true } }.
 */
export async function handleDeleteCallRecording(
  env: Env,
  auth: OutboundAuth,
  callLogId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const id = sanitizeInput(callLogId, 64);
    const clientId = await resolveClientId(env, auth);

    // Lookup BORNÉ tenant — defense-in-depth IDOR.
    let sql = 'SELECT recording_sid, recording_r2_key, client_id FROM call_logs WHERE id = ?';
    const binds: (string | number)[] = [id];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    type DeleteRow = { recording_sid: string | null; recording_r2_key: string | null; client_id: string | null };
    let row: DeleteRow | null = null;
    try {
      row = (await env.DB.prepare(sql).bind(...binds).first()) as DeleteRow | null;
    } catch {
      row = null;
    }
    if (!row) return json({ error: 'Appel introuvable' }, 404);

    // Cascade delete Twilio (best-effort — RGPD : on continue même si Twilio
    // KO, l'important est de soft-delete côté Intralys).
    if (row.recording_sid) {
      try {
        await deleteTwilioRecording(env, row.recording_sid);
      } catch {
        // best-effort — on log via audit mais on continue.
      }
    }

    // Cascade delete R2 (best-effort).
    if (row.recording_r2_key) {
      try {
        await deleteR2Recording(env, row.recording_r2_key);
      } catch {
        // best-effort.
      }
      // Filet supplémentaire : delete direct via env.FILES si la lib échoue.
      try {
        await env.FILES?.delete(row.recording_r2_key);
      } catch {
        // best-effort.
      }
    }

    // Reset call_logs (recording effacé côté metier).
    try {
      await env.DB.prepare(
        `UPDATE call_logs
            SET recording_url = NULL,
                recording_sid = NULL,
                recording_r2_key = NULL,
                recording_duration_sec = NULL
          WHERE id = ?`,
      )
        .bind(id)
        .run();
    } catch {
      // best-effort.
    }

    // Soft-delete metadata RGPD (trace de suppression + horodatage Twilio).
    try {
      await env.DB.prepare(
        `UPDATE call_recordings_metadata
            SET deleted_at = datetime('now'),
                twilio_deleted_at = datetime('now')
          WHERE call_log_id = ?`,
      )
        .bind(id)
        .run();
    } catch {
      // best-effort.
    }

    await audit(env, auth.userId, 'call.recording.deleted_rgpd', 'call_log', id, {});

    return json({ data: { success: true } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
