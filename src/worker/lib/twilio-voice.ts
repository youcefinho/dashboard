// ── twilio-voice.ts — Sprint 34 Twilio Voice library (bodies réels) ────────
//
// LIBRARY pure (aucun handler de route, aucun call à env.DB côté write hors
// idiome best-effort). Signatures FIGÉES par le contrat §6.3 (LOT-TWILIO-VOICE-S34.md).
// Corps implémentés : outbound + recording (start/stop/download/signed/delete)
// + transcription Whisper + TwiML générateurs purs.
//
// Imports RELATIFS uniquement (./types, ./helpers via parent dossier). PAS
// d'alias @/ (tsconfig.worker.json — réservé frontend).
//
// FLAG INACTIF Twilio — calque EXACT helpers.ts:sendSms:93-95 + telephony.ts:
// placeCall:85-88. Toute fonction qui appelle l'API Twilio réelle commence par
// le garde credentials :
//   if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER)
//     return { success: false, mock: true };
// → AUCUN appel réseau. Le call_log / voicemail / recording row reste créé
//   par l'appelant indépendamment de ce retour.
//
// Conventions partagées (docs/LOT-TWILIO-VOICE-S34.md §6) :
//   - Retour : TwilioVoiceResult { success: boolean; sid?: string; mock?: boolean;
//     error?: string; data?: T } — JAMAIS de champ `code` (apiFetch GELÉ).
//   - Échappement XML : escapeXml() partagé (calque telephony.ts:174-181).
//   - R2 binding : env.FILES (déjà existant LOT FILES seq 11). Clé canonique :
//     voice/{client_id}/{call_log_id}/{recording_sid}.mp3.
//   - Whisper : env.OPENAI_API_KEY (déjà existant voice.ts:65). Absent ⇒
//     transcription_status='skipped' (pas d'erreur fatale).
//   - Signed URL : HMAC-SHA256 query-signed via TOKEN_KEY (aucun helper R2
//     pré-existant — pattern dédié posé ici, réutilisable Sprint 34+).
//
// Contrat figé docs/LOT-TWILIO-VOICE-S34.md §6.3.

import type { Env } from '../types';

// ════════════════════════════════════════════════════════════════════════════
// TYPES (exportés, calque CallLogRow / Voicemail src/lib/api.ts)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Résultat standard d'une opération Twilio Voice. Calque
 * { success, sid?, mock?, error? } de telephony.ts:placeCall. `data?` ajouté
 * pour les opérations qui retournent du payload (ex: signed URL, transcript).
 */
export interface TwilioVoiceResult<T = unknown> {
  success: boolean;
  sid?: string;
  mock?: boolean;
  error?: string;
  data?: T;
}

/** Payload pour initier un appel sortant click-to-call. */
export interface OutboundCallPayload {
  to: string;                       // numéro destinataire E.164
  from?: string;                    // numéro source (défault env.TWILIO_PHONE_NUMBER)
  leadId?: string | null;           // FK applicative leads.id (CRM wiring)
  clientId?: string | null;         // tenant (bornage)
  agencyId?: string | null;         // agence (multi-tenant SaaS)
  record?: boolean;                 // start recording dès Dial (record='record-from-answer')
  consentObtained?: boolean;        // pré-validation consent bi-party (sinon record=false forcé)
  twimlOverride?: string;           // TwiML custom (default = <Dial>to</Dial>)
  statusCallbackUrl?: string;       // URL TwiML inline (Url param Twilio)
  statusCallback?: string;          // URL callback statut (StatusCallback param)
  recordingStatusCallback?: string; // URL callback recording status
  transcriptionCallback?: string;   // URL callback transcription Twilio
}

/** Payload TwiML pour démarrer un enregistrement mid-call. */
export interface RecordingStartPayload {
  callSid: string;                  // CallSid Twilio de l'appel en cours
  recordingChannels?: 'mono' | 'dual';
  transcribe?: boolean;             // demande transcription Twilio (vs Whisper post)
  statusCallback?: string;          // override URL callback (default /api/twilio/twiml/recording-status)
}

/** Métadonnée d'enregistrement enrichie post-callback. */
export interface RecordingMetadata {
  recordingSid: string;
  recordingUrl: string;
  durationSec: number;
  channels: number;
  source: string;                   // 'DialVerb'|'StartCallRecordingAPI'|'RecordVerb'|...
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS PURS (partagés cross-module)
// ════════════════════════════════════════════════════════════════════════════

/**
 * escapeXml — anti-injection TwiML. Calque exact telephony.ts:174-181 (helper
 * dupliqué localement pour découpler ce module library de telephony.ts handler).
 */
export function escapeXml(input: string): string {
  return (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * isTwilioConfigured — garde credentials commun (DRY). Tout helper réseau
 * Twilio doit l'appeler avant de toucher fetch().
 */
export function isTwilioConfigured(env: Env): boolean {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
}

/**
 * buildRecordingR2Key — forge la clé R2 canonique pour un enregistrement.
 * Format : voice/{client_id}/{call_log_id}/{recording_sid}.mp3.
 *
 * Path-traversal safe : les 3 args sont validés contre une regex stricte
 * ([a-zA-Z0-9_-]+). UUID/SID respectent ce format (Twilio REc + 32 hex,
 * crypto.randomUUID v4). Toute valeur invalide → throw (caller defensive).
 */
export function buildRecordingR2Key(clientId: string, callLogId: string, recordingSid: string): string {
  const safe = /^[a-zA-Z0-9_-]+$/;
  if (!safe.test(clientId)) throw new Error('buildRecordingR2Key: clientId invalide');
  if (!safe.test(callLogId)) throw new Error('buildRecordingR2Key: callLogId invalide');
  if (!safe.test(recordingSid)) throw new Error('buildRecordingR2Key: recordingSid invalide');
  return `voice/${clientId}/${callLogId}/${recordingSid}.mp3`;
}

// ── Helpers internes (non exportés) ────────────────────────────────────────

/** Encode un ArrayBuffer en base64url (URL-safe, sans padding). */
function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** HMAC-SHA256 signature → base64url. Clef = env.TOKEN_KEY (string UTF-8). */
async function hmacSha256Base64Url(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key).buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message).buffer as ArrayBuffer);
  return bufferToBase64Url(sig);
}

// ════════════════════════════════════════════════════════════════════════════
// API TWILIO — appels réseau (corps réels)
// ════════════════════════════════════════════════════════════════════════════

/**
 * initiateOutboundCall — POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Calls.json
 *
 * FLAG INACTIF : sans credentials → { success:false, mock:true } SANS appel
 * réseau. Avec credentials : déclenche l'appel sortant via Url (TwiML inline
 * fourni par statusCallbackUrl) OU TwiML par défaut <Hangup/>. record =
 * 'record-from-answer-dual' si payload.record && consentObtained.
 */
export async function initiateOutboundCall(
  env: Env,
  payload: OutboundCallPayload,
): Promise<TwilioVoiceResult<{ callSid: string; status: string }>> {
  if (!isTwilioConfigured(env)) {
    return { success: false, mock: true };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`;
    const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const from = (payload.from || env.TWILIO_PHONE_NUMBER || '').trim();
    const to = (payload.to || '').trim();
    if (!to) return { success: false, error: 'to requis' };
    if (!from) return { success: false, error: 'from requis' };

    const params = new URLSearchParams();
    params.append('To', to);
    params.append('From', from);

    // Url Twilio (TwiML hosted) : priorité statusCallbackUrl, sinon twimlOverride
    // via Twiml inline. Si rien fourni → Twiml par défaut <Dial>to</Dial>.
    if (payload.statusCallbackUrl) {
      params.append('Url', payload.statusCallbackUrl);
    } else if (payload.twimlOverride) {
      params.append('Twiml', payload.twimlOverride);
    } else {
      params.append('Twiml', generateOutboundDialTwiml(payload));
    }

    if (payload.statusCallback) {
      params.append('StatusCallback', payload.statusCallback);
      // Events standards Twilio (sortants).
      params.append('StatusCallbackEvent', 'initiated');
      params.append('StatusCallbackEvent', 'ringing');
      params.append('StatusCallbackEvent', 'answered');
      params.append('StatusCallbackEvent', 'completed');
      params.append('StatusCallbackMethod', 'POST');
    }

    // Recording gated par consent bi-party CRTC (handler valide consentObtained
    // AVANT d'appeler ; on re-vérifie ici defensively).
    const recordingEnabled = !!(payload.record && payload.consentObtained);
    if (recordingEnabled) {
      params.append('Record', 'true');
      params.append('RecordingChannels', 'dual');
      params.append('RecordingTrack', 'both');
      if (payload.recordingStatusCallback) {
        params.append('RecordingStatusCallback', payload.recordingStatusCallback);
        params.append('RecordingStatusCallbackEvent', 'in-progress');
        params.append('RecordingStatusCallbackEvent', 'completed');
        params.append('RecordingStatusCallbackEvent', 'absent');
        params.append('RecordingStatusCallbackMethod', 'POST');
      }
      if (payload.transcriptionCallback) {
        params.append('Transcribe', 'true');
        params.append('TranscribeCallback', payload.transcriptionCallback);
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authStr}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = (await res.json()) as { sid?: string; status?: string; message?: string };
    if (!res.ok || !data.sid) {
      return { success: false, error: data.message || `Twilio ${res.status}` };
    }
    return {
      success: true,
      sid: data.sid,
      data: { callSid: data.sid, status: data.status || 'queued' },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * startCallRecording — POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Calls/{CallSid}/Recordings.json
 *
 * Démarre l'enregistrement d'un appel EN COURS (toggle ON mid-call). FLAG
 * INACTIF mock si pas de credentials.
 */
export async function startCallRecording(
  env: Env,
  payload: RecordingStartPayload,
): Promise<TwilioVoiceResult<{ recordingSid: string }>> {
  if (!isTwilioConfigured(env)) {
    return { success: false, mock: true };
  }

  try {
    const callSid = (payload.callSid || '').trim();
    if (!callSid) return { success: false, error: 'callSid requis' };

    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${encodeURIComponent(callSid)}/Recordings.json`;
    const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

    const params = new URLSearchParams();
    params.append('RecordingChannels', payload.recordingChannels || 'dual');
    params.append('RecordingTrack', 'both');
    if (payload.statusCallback) {
      params.append('RecordingStatusCallback', payload.statusCallback);
      params.append('RecordingStatusCallbackEvent', 'in-progress');
      params.append('RecordingStatusCallbackEvent', 'completed');
      params.append('RecordingStatusCallbackEvent', 'absent');
      params.append('RecordingStatusCallbackMethod', 'POST');
    }
    if (payload.transcribe) {
      params.append('Transcribe', 'true');
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authStr}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok || !data.sid) {
      return { success: false, error: data.message || `Twilio ${res.status}` };
    }
    return { success: true, sid: data.sid, data: { recordingSid: data.sid } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * stopCallRecording — POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Calls/{CallSid}/Recordings/{RecordingSid}.json
 *
 * Stop l'enregistrement en cours (toggle OFF). Body : Status=stopped.
 */
export async function stopCallRecording(
  env: Env,
  callSid: string,
  recordingSid: string,
): Promise<TwilioVoiceResult<void>> {
  if (!isTwilioConfigured(env)) {
    return { success: false, mock: true };
  }

  try {
    const cs = (callSid || '').trim();
    const rs = (recordingSid || '').trim();
    if (!cs || !rs) return { success: false, error: 'callSid + recordingSid requis' };

    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${encodeURIComponent(cs)}/Recordings/${encodeURIComponent(rs)}.json`;
    const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

    const params = new URLSearchParams();
    params.append('Status', 'stopped');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authStr}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      let msg = `Twilio ${res.status}`;
      try {
        const data = (await res.json()) as { message?: string };
        if (data.message) msg = data.message;
      } catch { /* corps non JSON */ }
      return { success: false, error: msg };
    }
    return { success: true, sid: rs };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * downloadRecordingToR2 — GET recordingUrl (Twilio auth basic) + PUT env.FILES
 * (R2 binding existant seq 11). Permet de découpler Intralys de la retention
 * Twilio (par défaut 30 jours côté Twilio) + URL signée Intralys pour le
 * frontend (CapacitorAudio). FLAG INACTIF mock si pas de credentials.
 */
export async function downloadRecordingToR2(
  env: Env,
  recordingUrl: string,
  r2Key: string,
): Promise<TwilioVoiceResult<{ r2Key: string; sizeBytes: number }>> {
  if (!isTwilioConfigured(env)) {
    return { success: false, mock: true };
  }
  if (!env.FILES) {
    return { success: false, error: 'R2 binding FILES non configuré' };
  }
  const url = (recordingUrl || '').trim();
  const key = (r2Key || '').trim();
  if (!url) return { success: false, error: 'recordingUrl requis' };
  if (!key) return { success: false, error: 'r2Key requis' };

  try {
    const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    // Twilio recordings : on demande explicitement le format mp3 (calque clé R2
    // canonique .mp3). Si l'URL contient déjà une extension, on respecte.
    const fetchUrl = /\.(mp3|wav)(\?|$)/i.test(url) ? url : `${url}.mp3`;
    const res = await fetch(fetchUrl, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${authStr}` },
    });
    if (!res.ok) {
      return { success: false, error: `Twilio recording fetch ${res.status}` };
    }
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get('Content-Type') || 'audio/mpeg';
    await env.FILES.put(key, buf, {
      httpMetadata: { contentType },
    });
    return { success: true, data: { r2Key: key, sizeBytes: buf.byteLength } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * getSignedR2Url — génère une URL signée temporaire pour streamer l'audio
 * depuis R2 vers le frontend (VoicemailInbox / RecordingPlayer Phase C).
 *
 * Pattern : HMAC-SHA256(TOKEN_KEY, "{r2Key}:{exp}") base64url, exposé en query
 * `?sig=...&exp=...` sur `${env.PUBLIC_ORIGIN}/r2-stream/{r2Key}`. Le route
 * worker `/r2-stream/:key*` (à câbler côté worker.ts par le caller) vérifie
 * sig + exp avant de streamer env.FILES.get(key). TTL par défaut 3600s (1h).
 *
 * AUCUN helper signed-url R2 pré-existant dans le projet — pattern dédié posé
 * ici, réutilisable pour autres assets sécurisés Sprint 34+.
 */
export async function getSignedR2Url(
  env: Env,
  r2Key: string,
  ttlSec?: number,
): Promise<TwilioVoiceResult<{ url: string; expiresAt: string }>> {
  if (!env.FILES) {
    return { success: false, error: 'R2 binding FILES non configuré' };
  }
  if (!env.TOKEN_KEY) {
    return { success: false, error: 'TOKEN_KEY non configurée (signature URL impossible)' };
  }
  const key = (r2Key || '').trim();
  if (!key) return { success: false, error: 'r2Key requis' };

  try {
    const ttl = Math.max(60, Math.min(ttlSec ?? 3600, 86400)); // 60s..24h
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = await hmacSha256Base64Url(env.TOKEN_KEY, `${key}:${exp}`);
    // PUBLIC_ORIGIN n'est PAS dans Env (types.ts ne le déclare pas) — on tente
    // une lecture lax via cast indexé. Si absent → URL relative (frontend
    // résout sur l'origin courante).
    const origin = ((env as unknown as Record<string, string | undefined>)['PUBLIC_ORIGIN'] || '').replace(/\/+$/g, '');
    // r2Key contient des `/` : on les préserve (path-style), pas d'encodage.
    const url = `${origin}/r2-stream/${key}?sig=${encodeURIComponent(sig)}&exp=${exp}`;
    return {
      success: true,
      data: { url, expiresAt: new Date(exp * 1000).toISOString() },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * deleteTwilioRecording — DELETE https://api.twilio.com/2010-04-01/Accounts/{Sid}/Recordings/{RecordingSid}.json
 *
 * Suppression côté Twilio (cascade delete RGPD/right-to-erasure). FLAG INACTIF
 * mock si pas de credentials.
 */
export async function deleteTwilioRecording(
  env: Env,
  recordingSid: string,
): Promise<TwilioVoiceResult<void>> {
  if (!isTwilioConfigured(env)) {
    return { success: false, mock: true };
  }

  try {
    const rs = (recordingSid || '').trim();
    if (!rs) return { success: false, error: 'recordingSid requis' };

    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${encodeURIComponent(rs)}.json`;
    const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${authStr}` },
    });
    // Twilio renvoie 204 No Content sur succès. 404 = déjà supprimé (idempotent).
    if (res.status === 204 || res.status === 404) {
      return { success: true, sid: rs };
    }
    let msg = `Twilio ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) msg = data.message;
    } catch { /* corps non JSON */ }
    return { success: false, error: msg };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * deleteR2Recording — DELETE env.FILES r2Key (mirror cascade delete RGPD côté
 * Intralys storage).
 */
export async function deleteR2Recording(
  env: Env,
  r2Key: string,
): Promise<TwilioVoiceResult<void>> {
  if (!env.FILES) {
    return { success: false, error: 'R2 binding FILES non configuré' };
  }
  const key = (r2Key || '').trim();
  if (!key) return { success: false, error: 'r2Key requis' };

  try {
    await env.FILES.delete(key);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * transcribeRecording — fetch audio (R2 d'abord, sinon URL Twilio auth basic)
 * + POST OpenAI Whisper (calque voice.ts:64-94). Si !env.OPENAI_API_KEY →
 * { success:false, error:'OPENAI_API_KEY non configurée' } SANS erreur fatale
 * (transcription_status='skipped' côté caller).
 */
export async function transcribeRecording(
  env: Env,
  audioUrlOrR2Key: string,
  lang?: string,
): Promise<TwilioVoiceResult<{ text: string; lang?: string }>> {
  if (!env.OPENAI_API_KEY) {
    return { success: false, error: 'OPENAI_API_KEY non configurée' };
  }
  const ref = (audioUrlOrR2Key || '').trim();
  if (!ref) return { success: false, error: 'audioUrlOrR2Key requis' };

  try {
    // Source audio : R2 si la ref commence par `voice/` (clé canonique), sinon
    // URL Twilio (auth basic requis pour les recordings privés).
    let audioBlob: Blob;
    if (ref.startsWith('voice/') && env.FILES) {
      const obj = await env.FILES.get(ref);
      if (!obj) return { success: false, error: 'R2 audio absent' };
      const buf = await obj.arrayBuffer();
      audioBlob = new Blob([buf], { type: obj.httpMetadata?.contentType || 'audio/mpeg' });
    } else {
      const headers: Record<string, string> = {};
      if (/^https?:\/\/api\.twilio\.com/i.test(ref) && isTwilioConfigured(env)) {
        headers['Authorization'] = `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
      }
      const audioRes = await fetch(ref, { headers });
      if (!audioRes.ok) {
        return { success: false, error: `Audio fetch ${audioRes.status}` };
      }
      audioBlob = await audioRes.blob();
    }

    const whisperForm = new FormData();
    whisperForm.append('file', audioBlob, 'recording.wav');
    whisperForm.append('model', 'whisper-1');
    // Whisper attend ISO 639-1 (2 lettres). On normalise BCP-47 'fr-CA' → 'fr'.
    const normalized = (lang || 'fr').split('-')[0]!.toLowerCase().slice(0, 2);
    if (normalized) whisperForm.append('language', normalized);

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
      body: whisperForm,
    });

    if (!whisperRes.ok) {
      return { success: false, error: `Whisper ${whisperRes.status}` };
    }
    const data = (await whisperRes.json()) as { text?: string; language?: string };
    if (!data.text) {
      return { success: false, error: 'Whisper: texte absent' };
    }
    return {
      success: true,
      data: { text: data.text, lang: data.language || normalized },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TWIML GÉNÉRATEURS (purs, pas d'I/O — utilisables sans credentials)
// ════════════════════════════════════════════════════════════════════════════

/**
 * generateOutboundDialTwiml — TwiML <Dial> pour appel sortant. Si record &&
 * consentObtained → ajoute record='record-from-answer-dual' + recordingStatusCallback.
 * escapeXml anti-injection sur le numéro destinataire.
 */
export function generateOutboundDialTwiml(payload: OutboundCallPayload): string {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
  const to = (payload.to || '').trim();
  if (!to) {
    return `${xmlHeader}<Response><Say language="fr-CA">Numéro indisponible.</Say><Hangup/></Response>`;
  }
  const recordingEnabled = !!(payload.record && payload.consentObtained);
  const recordAttr = recordingEnabled ? ' record="record-from-answer-dual"' : '';
  const recordingCb = recordingEnabled && payload.recordingStatusCallback
    ? ` recordingStatusCallback="${escapeXml(payload.recordingStatusCallback)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="in-progress completed absent"`
    : '';
  return `${xmlHeader}<Response><Dial${recordAttr}${recordingCb}>${escapeXml(to)}</Dial></Response>`;
}

/**
 * generateVoicemailTwiml — TwiML <Say> consentement + <Record> 120s max +
 * transcribe callback. Calque pattern voice.ts:23-28 + ajoute consent
 * disclaimer CRTC (loi C-29 + art. 184 Code criminel).
 */
export function generateVoicemailTwiml(
  greeting: string,
  consentNotice: string,
  recordingStatusCallback?: string,
): string {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
  const safeGreeting = escapeXml(greeting || 'Bonjour, veuillez laisser un message après le bip.');
  const safeConsent = escapeXml(consentNotice || 'Cet appel sera enregistré. Restez en ligne pour l\'accepter ou raccrochez.');
  const cb = recordingStatusCallback
    ? ` recordingStatusCallback="${escapeXml(recordingStatusCallback)}" recordingStatusCallbackMethod="POST"`
    : '';
  return `${xmlHeader}<Response><Say language="fr-CA">${safeGreeting}</Say><Say language="fr-CA">${safeConsent}</Say><Record action="/api/twilio/twiml/recording-status" method="POST" maxLength="120" playBeep="true"${cb}/><Say language="fr-CA">Merci, au revoir.</Say><Hangup/></Response>`;
}
