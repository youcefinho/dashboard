// ── voicemails.ts — Sprint 34 Twilio Voice voicemails CRUD (Phase B — agent A4) ──
//
// 4 handlers AUTHED câblés dans src/worker.ts routeProtected. Signatures FIGÉES
// Phase A — corps Phase B remplis ci-dessous.
//
// Capabilities seq80 RÉUTILISÉES (zéro ajout ALL_CAPABILITIES) :
//   - 'leads.write' : list / get / markListened (lecture+update non-destructif)
//   - 'settings.manage' : delete (RGPD soft-delete + cascade, plus restrictif)
//
// Bornage tenant STRICT : auth.clientId / auth.tenant.clientId via resolveClientId
// (calque telephony.ts:185-195). JAMAIS de client_id depuis le body. JAMAIS d'IDOR
// cross-tenant — TOUTES les SQL ont AND client_id = ? (admin non borné).
//
// Imports RELATIFS uniquement.

import type { Env } from './types';
import { json, audit, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { deleteTwilioRecording } from './lib/twilio-voice';

// ── Auth enrichi (calque telephony.ts:69) ────────────────────────────────────
type VoicemailAuth = CapAuth & { capabilities?: Set<string> };

// ── resolveClientId — calque EXACT telephony.ts:185-195 ─────────────────────
// admin → null (non borné). tenant API / user → clientId résolu serveur
// (auth.tenant.clientId ou auth.clientId, sinon lookup users.client_id).
async function resolveClientId(env: Env, auth: VoicemailAuth): Promise<string | null> {
  if (auth.role === 'admin') return null;
  // Tenant API (auth.role === 'api') : clientId déjà résolu au chokepoint.
  if (auth.tenant?.clientId) return auth.tenant.clientId;
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

// Colonnes voicemails (seq129) — projection EXPLICITE, jamais SELECT *.
const VOICEMAIL_COLS =
  'id, client_id, call_log_id, lead_id, conversation_id, ' +
  'from_number, to_number, recording_url, recording_sid, recording_r2_key, ' +
  'duration_sec, transcription, transcription_status, transcription_lang, ' +
  'listened_at, listened_by, deleted_at, created_at';

// ════════════════════════════════════════════════════════════════════════════
// GET /api/voicemails — liste filtrable bornée tenant
// ════════════════════════════════════════════════════════════════════════════
/**
 * Cap : 'leads.write'.
 * Query : ?unread=true (listened_at IS NULL) &lead_id=xxx &limit=50 (max 200).
 */
export async function handleListVoicemails(
  env: Env,
  auth: VoicemailAuth,
  url: URL,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    const unread = url.searchParams.get('unread') === 'true';
    const leadId = url.searchParams.get('lead_id');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 200);

    let sql = `SELECT ${VOICEMAIL_COLS} FROM voicemails WHERE deleted_at IS NULL`;
    const binds: (string | number)[] = [];

    // Bornage tenant strict (admin non borné, calque telephony.ts:224-227).
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    if (unread) {
      sql += ' AND listened_at IS NULL';
    }
    if (leadId) {
      sql += ' AND lead_id = ?';
      binds.push(sanitizeInput(leadId, 64));
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    binds.push(limit);

    const res = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: res.results ?? [] });
  } catch {
    // Table seq129 absente : best-effort calque telephony.ts:247-249.
    return json({ data: [] });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/voicemails/:id — détail borné tenant
// ════════════════════════════════════════════════════════════════════════════
/**
 * Cap : 'leads.write'.
 * 404 si row absente / cross-tenant / soft-deleted.
 */
export async function handleGetVoicemail(
  env: Env,
  auth: VoicemailAuth,
  voicemailId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;

  const vmId = sanitizeInput(voicemailId, 64);
  if (!vmId) return json({ error: 'id requis' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    let sql = `SELECT ${VOICEMAIL_COLS} FROM voicemails WHERE id = ? AND deleted_at IS NULL`;
    const binds: (string | number)[] = [vmId];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    const row = await env.DB.prepare(sql).bind(...binds).first();
    if (!row) return json({ error: 'voicemail_not_found' }, 404);
    return json({ data: row });
  } catch {
    // Table seq129 absente : 404 propre (pas de leak schema).
    return json({ error: 'voicemail_not_found' }, 404);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/voicemails/:id/listen — mark listened (idempotent)
// ════════════════════════════════════════════════════════════════════════════
/**
 * Cap : 'leads.write'.
 * UPDATE borné tenant + idempotent (COALESCE garde le 1er auditeur).
 */
export async function handleMarkVoicemailListened(
  env: Env,
  auth: VoicemailAuth,
  voicemailId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;

  const vmId = sanitizeInput(voicemailId, 64);
  if (!vmId) return json({ error: 'id requis' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    let sql =
      "UPDATE voicemails SET listened_at = COALESCE(listened_at, datetime('now')), " +
      'listened_by = COALESCE(listened_by, ?) WHERE id = ? AND deleted_at IS NULL';
    const binds: (string | number)[] = [auth.userId, vmId];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    const res = await env.DB.prepare(sql).bind(...binds).run();
    const changes = (res.meta?.changes ?? 0) as number;
    if (changes === 0) return json({ error: 'voicemail_not_found' }, 404);

    // Audit best-effort (ne bloque jamais l'action).
    await audit(env, auth.userId, 'voicemail.listened', 'voicemail', vmId, {
      client_id: clientId || null,
    });

    return json({ data: { success: true } });
  } catch {
    return json({ error: 'voicemail_not_found' }, 404);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/voicemails/:id — RGPD soft-delete + cascade Twilio + R2
// ════════════════════════════════════════════════════════════════════════════
/**
 * Cap : 'settings.manage' (RGPD = admin/owner).
 * Cascade : deleteTwilioRecording (best-effort) + env.FILES.delete (best-effort)
 * + UPDATE voicemails (soft-delete + scrub URL/SID/key) + audit.
 */
export async function handleDeleteVoicemail(
  env: Env,
  auth: VoicemailAuth,
  voicemailId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  const vmId = sanitizeInput(voicemailId, 64);
  if (!vmId) return json({ error: 'id requis' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);

    // 1) Lookup borné tenant (404 si absent OU cross-tenant).
    let sql =
      'SELECT id, recording_sid, recording_r2_key FROM voicemails WHERE id = ?';
    const binds: (string | number)[] = [vmId];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    const row = (await env.DB.prepare(sql).bind(...binds).first()) as {
      id: string;
      recording_sid: string | null;
      recording_r2_key: string | null;
    } | null;
    if (!row) return json({ error: 'voicemail_not_found' }, 404);

    // 2) Cascade Twilio (best-effort — FLAG INACTIF retourne mock sans réseau).
    if (row.recording_sid) {
      try {
        await deleteTwilioRecording(env, row.recording_sid);
      } catch { /* best-effort RGPD */ }
    }

    // 3) Cascade R2 (best-effort — env.FILES déjà bound seq11).
    if (row.recording_r2_key && env.FILES) {
      try {
        await env.FILES.delete(row.recording_r2_key);
      } catch { /* best-effort RGPD */ }
    }

    // 4) Soft-delete + scrub URL/SID/key (right-to-erasure).
    let upd =
      "UPDATE voicemails SET deleted_at = datetime('now'), recording_url = NULL, " +
      'recording_sid = NULL, recording_r2_key = NULL WHERE id = ?';
    const ubinds: (string | number)[] = [vmId];
    if (clientId) {
      upd += ' AND client_id = ?';
      ubinds.push(clientId);
    }
    await env.DB.prepare(upd).bind(...ubinds).run();

    // 5) Audit RGPD (best-effort).
    await audit(env, auth.userId, 'voicemail.deleted_rgpd', 'voicemail', vmId, {
      client_id: clientId || null,
      had_recording_sid: !!row.recording_sid,
      had_r2_key: !!row.recording_r2_key,
    });

    return json({ data: { success: true } });
  } catch {
    return json({ error: 'voicemail_not_found' }, 404);
  }
}
