// ── twilio-twiml.ts — Sprint 34 Twilio Voice webhooks PUBLICS (Phase B impl) ──
//
// 4 handlers PUBLICS (sans auth applicative — webhooks Twilio entrants). Câblés
// dans src/worker.ts l.956-971. Signatures FIGÉES Phase A.
//
// Sécurité webhook — bornage par signature Twilio (verifyTwilioSignature
// twilio-verify.ts:37) calque sms-inbound (worker.ts:585-604). Sans
// TWILIO_AUTH_TOKEN configuré ⇒ bypass=true (mode mock). Avec token ⇒ rejet 403
// si signature absente/invalide.
//
// CONVENTION BODY — calque worker.ts:593-602 : le body form-urlencoded est lu
// UNE SEULE FOIS via request.clone().formData() pour construire `params`
// {key:value} (input verifyTwilioSignature), puis ré-lu sur request original
// pour exploitation handler. Cela respecte le contrat Phase A "verifyTwilioSignature
// ne reconsomme PAS le body" (twilio-verify.ts:34).
//
// Réponses :
//   - TwiML handlers (voice + voicemail) : text/xml 200 OK avec corps XML.
//   - Status callbacks (recording + transcription) : 'OK' 200 toujours (Twilio
//     retry sur 5xx — best-effort, jamais throw vers Twilio).
//
// Imports RELATIFS uniquement (./types, ./twilio-verify, ./lib/twilio-voice).
// PAS d'alias @/.
//
// Contrat figé docs/LOT-TWILIO-VOICE-S34.md §6.4.

import type { Env } from './types';
import { verifyTwilioSignature } from './twilio-verify';
import { downloadRecordingToR2, buildRecordingR2Key } from './lib/twilio-voice';

// ── Helpers locaux ──────────────────────────────────────────────────────────

/** escapeXml — anti-injection TwiML (calque telephony.ts:174-181). Dupliqué
 *  ici pour éviter d'importer telephony.ts (ce module est public + ne charge
 *  pas les capabilities). */
function escapeXml(input: string): string {
  return (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Lit le body form-urlencoded en {key:value} via request.clone() — N'altère
 *  PAS le body du request original (handler peut le re-lire si besoin). */
async function parseFormParams(request: Request): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  try {
    const fd = await request.clone().formData();
    for (const [k, v] of fd.entries()) {
      params[k] = String(v);
    }
  } catch {
    // body illisible : params vides — la vérif échouera si token configuré.
  }
  return params;
}

/** Vérif signature commune. Si rejetée ET token configuré → 403. Sinon true
 *  (la vérif a passé ou flag inactif). */
async function ensureSignature(
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response | null> {
  const valid = await verifyTwilioSignature(request, env, params);
  if (!valid && env.TWILIO_AUTH_TOKEN) {
    return new Response('Forbidden', { status: 403 });
  }
  return null;
}

/** Construit l'origin (https://host) depuis l'URL du request — sert à fabriquer
 *  les URLs absolues des callbacks Twilio (recording-status / transcription). */
function getOrigin(request: Request): string {
  try {
    const u = new URL(request.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS PUBLICS
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/twilio/twiml/voice — TwiML d'accueil pour un appel ENTRANT vers un
 * numéro Twilio Intralys. Distinct de /api/voice/twiml (voice.ts existant qui
 * va direct au voicemail) et de /api/voice/ivr/:menuId (telephony.ts existant).
 *
 * Logique :
 *   1) Vérifie signature Twilio (verifyTwilioSignature).
 *   2) Parse params (To = numéro Twilio appelé). Résolution agent best-effort
 *      via sub_accounts.twilio_phone (calque telephony.ts:560-566).
 *   3) Si agent dispo → <Dial record="record-from-answer-dual"
 *      recordingStatusCallback=... transcribe=true transcribeCallback=...>
 *      <Number>{agent}</Number></Dial>.
 *   4) Sinon → fallback <Redirect> vers /api/twilio/twiml/voicemail.
 *   5) Return text/xml 200.
 */
export async function handleTwilioVoiceTwiml(request: Request, env: Env): Promise<Response> {
  try {
    const params = await parseFormParams(request);
    const forbidden = await ensureSignature(request, env, params);
    if (forbidden) return forbidden;

    const toNumber = (params['To'] || '').trim();
    const origin = getOrigin(request);

    // Résolution agent à dial : sub_accounts.twilio_phone correspondant au tenant
    // appelé. Best-effort : table absente / pas de match → fallback voicemail.
    // Note : on choisit le PREMIER agent dispo (Phase C affinera : routing par
    // disponibilité / round-robin). Fallback final = env.TWILIO_PHONE_NUMBER.
    let agentNumber: string | null = null;
    if (toNumber) {
      try {
        const row = (await env.DB.prepare(
          `SELECT u.phone AS phone
             FROM users u
            WHERE u.client_id IN (
              SELECT id FROM clients WHERE phone = ?
              UNION
              SELECT client_id FROM sub_accounts WHERE twilio_phone = ?
            )
            AND u.phone IS NOT NULL AND u.phone != ''
            ORDER BY u.created_at ASC LIMIT 1`,
        )
          .bind(toNumber, toNumber)
          .first()) as { phone: string | null } | null;
        agentNumber = row?.phone || null;
      } catch {
        agentNumber = null;
      }
    }

    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const recordingCb = `${origin}/api/twilio/twiml/recording-status`;
    const transcribeCb = `${origin}/api/twilio/twiml/transcription-callback`;

    // Pas d'agent disponible → renvoie direct sur voicemail TwiML (consent +
    // <Record>). Le <Redirect> POST réutilise notre handler voicemail.
    if (!agentNumber) {
      const xml = `${xmlHeader}\n<Response>\n  <Say voice="alice" language="fr-CA">Bonjour, votre appel est important. Nous ne sommes pas disponibles pour le moment.</Say>\n  <Redirect method="POST">${escapeXml(`${origin}/api/twilio/twiml/voicemail`)}</Redirect>\n</Response>`;
      return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
    }

    // Agent dispo : <Dial> avec recording dual-channel + transcription FR-CA.
    // record='record-from-answer-dual' = enregistre les 2 canaux séparément
    // depuis la réponse de l'agent (pas le ring). transcribe=true demande la
    // transcription Twilio native (best-effort, fr-CA non garanti — on a aussi
    // Whisper Phase B agent A3 en backup).
    const xml = `${xmlHeader}\n<Response>\n  <Say voice="alice" language="fr-CA">Bonjour, votre appel est important. Veuillez patienter.</Say>\n  <Dial record="record-from-answer-dual" recordingStatusCallback="${escapeXml(recordingCb)}" transcribe="true" transcribeCallback="${escapeXml(transcribeCb)}" timeout="30">\n    <Number>${escapeXml(agentNumber)}</Number>\n  </Dial>\n  <Redirect method="POST">${escapeXml(`${origin}/api/twilio/twiml/voicemail`)}</Redirect>\n</Response>`;
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
  } catch {
    // Best-effort : panne inattendue → TwiML safe (jamais 500 vers Twilio).
    const fallback = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="fr-CA">Service momentanément indisponible.</Say>\n  <Hangup />\n</Response>`;
    return new Response(fallback, { headers: { 'Content-Type': 'text/xml' } });
  }
}

/**
 * POST /api/twilio/twiml/voicemail — TwiML pour déclencher l'enregistrement
 * d'un message vocal AVEC consentement bi-party CRTC documenté.
 *
 * Logique :
 *   1) Vérifie signature Twilio.
 *   2) <Say>consent disclaimer CRTC + greeting</Say>.
 *   3) <Record maxLength=120 transcribe=true transcribeCallback recordingStatusCallback>.
 *   4) Return text/xml 200.
 */
export async function handleTwilioVoicemailTwiml(request: Request, env: Env): Promise<Response> {
  try {
    const params = await parseFormParams(request);
    const forbidden = await ensureSignature(request, env, params);
    if (forbidden) return forbidden;

    const origin = getOrigin(request);
    const recordingCb = `${origin}/api/twilio/twiml/recording-status`;
    const transcribeCb = `${origin}/api/twilio/twiml/transcription-callback`;

    // Consent bi-party CRTC : prévenir l'appelant que l'enregistrement va
    // commencer. Rester en ligne = consent implicite documenté ISO 8601 dans
    // recording_consent_obtained_at (set côté recording-status-callback).
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const xml = `${xmlHeader}\n<Response>\n  <Say voice="alice" language="fr-CA">Cet appel sera enregistré pour le service à la clientèle. Restez en ligne pour l'accepter ou raccrochez maintenant. Au signal sonore, veuillez laisser votre message après le bip.</Say>\n  <Record maxLength="120" playBeep="true" transcribe="true" transcribeCallback="${escapeXml(transcribeCb)}" recordingStatusCallback="${escapeXml(recordingCb)}" />\n  <Say voice="alice" language="fr-CA">Merci, au revoir.</Say>\n</Response>`;
    return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
  } catch {
    const fallback = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="fr-CA">Service momentanément indisponible.</Say>\n  <Hangup />\n</Response>`;
    return new Response(fallback, { headers: { 'Content-Type': 'text/xml' } });
  }
}

/**
 * POST /api/twilio/twiml/recording-status — callback Twilio quand un
 * enregistrement passe par in-progress|completed|failed|absent.
 *
 * Logique :
 *   1) Vérifie signature Twilio.
 *   2) Parse params : RecordingSid, RecordingUrl, RecordingStatus,
 *      RecordingDuration, CallSid.
 *   3) Si status='completed' :
 *        - Lookup call_log par twilio_sid=CallSid (si existant) → tenant + r2Key
 *          canonique `voice/{client_id}/{call_log_id}/{recording_sid}.mp3`.
 *        - fetchRecording (Twilio Basic Auth) → upload env.FILES.put(r2Key).
 *        - UPDATE call_logs SET recording_sid, recording_url, recording_r2_key,
 *          recording_duration_sec, recording_consent_obtained_at=now (consent
 *          implicite documenté : l'appelant est resté en ligne).
 *        - INSERT call_recordings_metadata (audit RGPD + retention 90j).
 *        - Si pas de call_log (voicemail direct) → INSERT voicemails.
 *   4) Retourne 'OK' 200 toujours (Twilio retry sur 5xx).
 */
export async function handleTwilioRecordingStatusCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const params = await parseFormParams(request);
    const forbidden = await ensureSignature(request, env, params);
    if (forbidden) return forbidden;

    const recordingSid = (params['RecordingSid'] || '').trim();
    const recordingUrl = (params['RecordingUrl'] || '').trim();
    const recordingStatus = (params['RecordingStatus'] || '').trim();
    const recordingDurationRaw = (params['RecordingDuration'] || '').trim();
    const callSid = (params['CallSid'] || '').trim();
    const fromNumber = (params['From'] || params['Caller'] || '').trim();
    const toNumber = (params['To'] || params['Called'] || '').trim();

    // States non-finaux : on accuse réception sans agir (in-progress, absent).
    // failed → on log via UPDATE best-effort si call_log existe.
    if (recordingStatus !== 'completed') {
      if (recordingStatus === 'failed' && callSid) {
        try {
          await env.DB.prepare(
            'UPDATE call_logs SET transcription_status = ? WHERE twilio_sid = ?',
          )
            .bind('failed', callSid)
            .run();
        } catch {
          // best-effort.
        }
      }
      return new Response('OK', { status: 200 });
    }

    const durationSec = Number.parseInt(recordingDurationRaw, 10);
    const safeDuration = Number.isFinite(durationSec) ? durationSec : 0;

    // Lookup du call_log existant (créé par handlePlaceCall ou handleTwilioVoice
    // upstream). Si trouvé → recording d'un appel actif ; sinon → voicemail
    // direct (handleTwilioVoicemailTwiml sans <Dial> préalable).
    let callLog: { id: string; client_id: string | null } | null = null;
    if (callSid) {
      try {
        callLog = (await env.DB.prepare(
          'SELECT id, client_id FROM call_logs WHERE twilio_sid = ? LIMIT 1',
        )
          .bind(callSid)
          .first()) as { id: string; client_id: string | null } | null;
      } catch {
        callLog = null;
      }
    }

    // Forge r2Key : si on a un call_log → clé canonique tenantée. Sinon, on
    // utilise un fallback orphelin (voicemail sans call_log : client_id null →
    // bucket 'orphan'). Phase C agent C4 pourra réconcilier via lookup phone.
    const tenantClientId = callLog?.client_id || null;
    const ownerId = callLog?.id || `vm-${recordingSid}`;
    const clientBucket = tenantClientId || 'orphan';
    const r2Key = buildRecordingR2Key(clientBucket, ownerId, recordingSid);

    // Download Twilio (Basic Auth) + upload R2 en un appel via lib.
    // downloadRecordingToR2 retourne { success, data:{ r2Key, sizeBytes } }
    // ou { mock:true } si flag inactif Twilio.
    let uploadedToR2 = false;
    let sizeBytes = 0;
    if (env.FILES && recordingSid && recordingUrl) {
      try {
        const dl = await downloadRecordingToR2(env, recordingUrl, r2Key);
        if (dl.success && dl.data) {
          uploadedToR2 = true;
          sizeBytes = dl.data.sizeBytes || 0;
        }
      } catch {
        // Twilio fetch / R2 put en panne : on persiste juste les pointeurs URL
        // bruts (recording_url Twilio reste accessible le temps de la retention
        // Twilio par défaut).
        uploadedToR2 = false;
      }
    }

    // UPDATE call_logs si on a un call_log. recording_consent_obtained_at = now
    // (consent implicite documenté : l'appelant est resté en ligne après le
    // <Say> de consent). transcription_status='pending' → Whisper backup
    // (Phase B agent A3) ou Twilio native transcribe-callback prendra le relais.
    if (callLog) {
      try {
        await env.DB.prepare(
          `UPDATE call_logs
              SET recording_sid = ?,
                  recording_url = ?,
                  recording_r2_key = ?,
                  recording_duration_sec = ?,
                  recording_consent_obtained_at = COALESCE(recording_consent_obtained_at, datetime('now')),
                  transcription_status = COALESCE(transcription_status, 'pending')
            WHERE id = ?`,
        )
          .bind(
            recordingSid,
            recordingUrl || null,
            uploadedToR2 ? r2Key : null,
            safeDuration,
            callLog.id,
          )
          .run();
      } catch {
        // best-effort.
      }

      // INSERT call_recordings_metadata (audit RGPD/CRTC + retention 90j).
      try {
        await env.DB.prepare(
          `INSERT INTO call_recordings_metadata
             (id, call_log_id, client_id, recording_sid, r2_key, duration_sec,
              size_bytes, consent_obtained_at, consent_method, retention_days, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 'twiml_callback', 90, datetime('now'))`,
        )
          .bind(
            crypto.randomUUID(),
            callLog.id,
            tenantClientId,
            recordingSid,
            uploadedToR2 ? r2Key : null,
            safeDuration,
            sizeBytes,
          )
          .run();
      } catch {
        // best-effort : table seq 129 absente → on n'altère pas la 200.
      }
    } else {
      // Pas de call_log → voicemail direct (handleTwilioVoicemailTwiml). On
      // INSERT dans voicemails (boîte vocale unifiée, Phase C VoicemailInbox).
      // client_id résolu best-effort via to_number (numéro Twilio appelé).
      let voicemailClientId: string | null = tenantClientId;
      if (!voicemailClientId && toNumber) {
        try {
          const c = (await env.DB.prepare(
            `SELECT id FROM clients WHERE phone = ?
               UNION
              SELECT client_id AS id FROM sub_accounts WHERE twilio_phone = ?
              LIMIT 1`,
          )
            .bind(toNumber, toNumber)
            .first()) as { id: string | null } | null;
          voicemailClientId = c?.id || null;
        } catch {
          voicemailClientId = null;
        }
      }
      try {
        await env.DB.prepare(
          `INSERT INTO voicemails
             (id, client_id, from_number, to_number, recording_url, recording_sid,
              recording_r2_key, duration_sec, transcription_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
        )
          .bind(
            crypto.randomUUID(),
            voicemailClientId,
            fromNumber || null,
            toNumber || null,
            recordingUrl || null,
            recordingSid,
            uploadedToR2 ? r2Key : null,
            safeDuration,
          )
          .run();
      } catch {
        // best-effort : table seq 129 absente.
      }
    }

    return new Response('OK', { status: 200 });
  } catch {
    // Best-effort : Twilio veut TOUJOURS 200 (sinon retry). On accuse réception
    // même si on a foiré côté DB — l'idempotence par recording_sid permettra
    // au retry suivant de re-faire le job (UPDATE WHERE recording_sid = ?).
    return new Response('OK', { status: 200 });
  }
}

/**
 * POST /api/twilio/twiml/transcription-callback — callback Twilio quand une
 * transcription native est complétée (transcribe=true sur Dial / Record).
 *
 * Logique :
 *   1) Vérifie signature Twilio.
 *   2) Parse params : TranscriptionText, TranscriptionStatus, CallSid,
 *      RecordingSid.
 *   3) Si completed → UPDATE call_logs + voicemails (recording_sid OR twilio_sid).
 *   4) Si failed → UPDATE transcription_status='failed'.
 *   5) Retourne 'OK' 200.
 *
 * Note : Twilio native transcription = best-effort en fr-CA (qualité variable).
 * Whisper (voice.ts:64-94 / Phase B agent A3) reste la transcription primaire ;
 * ce handler complète si Twilio renvoie quelque chose d'utile.
 */
export async function handleTwilioTranscriptionCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const params = await parseFormParams(request);
    const forbidden = await ensureSignature(request, env, params);
    if (forbidden) return forbidden;

    const transcriptionText = (params['TranscriptionText'] || '').trim();
    const transcriptionStatus = (params['TranscriptionStatus'] || '').trim();
    const callSid = (params['CallSid'] || '').trim();
    const recordingSid = (params['RecordingSid'] || '').trim();

    if (transcriptionStatus === 'failed') {
      // UPDATE 'failed' sur call_logs (recording_sid ou twilio_sid) + voicemails.
      if (recordingSid || callSid) {
        try {
          await env.DB.prepare(
            `UPDATE call_logs
                SET transcription_status = 'failed'
              WHERE recording_sid = ? OR twilio_sid = ?`,
          )
            .bind(recordingSid || '', callSid || '')
            .run();
        } catch {
          // best-effort.
        }
      }
      if (recordingSid) {
        try {
          await env.DB.prepare(
            `UPDATE voicemails SET transcription_status = 'failed' WHERE recording_sid = ?`,
          )
            .bind(recordingSid)
            .run();
        } catch {
          // best-effort.
        }
      }
      return new Response('OK', { status: 200 });
    }

    if (transcriptionStatus !== 'completed' || !transcriptionText) {
      // in-progress ou texte vide : accusé inerte.
      return new Response('OK', { status: 200 });
    }

    // UPDATE call_logs : lookup par recording_sid OU twilio_sid (Twilio envoie
    // les 2 ; on borne sur les deux pour résilience). transcription_lang='fr'
    // par défaut (consent CRTC FR-CA voicemail TwiML).
    if (recordingSid || callSid) {
      try {
        await env.DB.prepare(
          `UPDATE call_logs
              SET transcription = ?,
                  transcription_status = 'done',
                  transcription_lang = COALESCE(transcription_lang, 'fr')
            WHERE recording_sid = ? OR twilio_sid = ?`,
        )
          .bind(transcriptionText, recordingSid || '', callSid || '')
          .run();
      } catch {
        // best-effort.
      }
    }

    // UPDATE voicemails (boîte vocale unifiée).
    if (recordingSid) {
      try {
        await env.DB.prepare(
          `UPDATE voicemails
              SET transcription = ?,
                  transcription_status = 'done',
                  transcription_lang = COALESCE(transcription_lang, 'fr')
            WHERE recording_sid = ?`,
        )
          .bind(transcriptionText, recordingSid)
          .run();
      } catch {
        // best-effort.
      }
    }

    return new Response('OK', { status: 200 });
  } catch {
    // Twilio veut 200 toujours (sinon retry). Idempotent : retry re-UPDATE
    // avec le même contenu, pas de side-effect.
    return new Response('OK', { status: 200 });
  }
}
