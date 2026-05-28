// ── telephony.ts — LOT TELEPHONY-F (Sprint F) ──────────────────────────────
//
// Téléphonie 2-way (fondations). MODULE NEUF — voice.ts (voicemail entrant
// prod) est INTOUCHÉ. Ce module ajoute :
//   (a) call_logs structurés (entrants + sortants)        [socle codable]
//   (b) IVR : CRUD ivr_menus + génération TwiML publique  [codable]
//   (c) click-to-call sortant (placeCall gardé flag)       [logique codée]
//   (d) power dialer                                        → v2 (HORS scope)
//
// ⚠ APPELS TWILIO RÉELS — FLAG INACTIF (calque EXACT helpers.ts:sendSms:93-95).
//   `placeCall` est précédé du garde credentials : si les secrets Twilio ne sont
//   PAS configurés → early-return { success:false, mock:true } SANS appel réseau.
//   Le call_log est créé QUAND MÊME par le handler appelant (status 'mock' /
//   'queued') ⇒ journalisation + wiring CRM testables sans credentials.
//
// État : IMPLÉMENTÉ. Schéma + helpers placeCall/logCall (gardés flag) + CRUD
//   ivr_menus + agrégateurs/TwiML/wiring CRM complets (handleGetCallLogs,
//   handlePlaceCall, handleVoiceIvrTwiml, handleCallStatusCallback) écrits.
//   Signatures FIGÉES (worker.ts les câble). Contrat docs/LOT-TELEPHONY-F.md §6.
//
// Conventions (docs/LOT-TELEPHONY-F.md §6.D/§6.I) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur. JAMAIS
//     de champ `code` (apiFetch / ApiResponse GELÉS).
//   - Garde capability : requireCapability(auth.capabilities, 'leads.write') pour
//     click-to-call ; 'settings.manage' pour la config IVR. Réutilise des
//     capabilities EXISTANTES — AUCUN ajout à ALL_CAPABILITIES.
//   - Bornage tenant : calque conversations.ts:27 (auth.role !== 'admin' →
//     WHERE client_id = <users.client_id>). client_id résolu serveur.
//   - best-effort : table/colonne absente → réponse propre (404 / {data:[]}),
//     JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { findOrCreateConversation } from './conversations';
// Renforcement V2 — helpers PUR engine (validation statut/direction appel).
import { isMissedCallStatus } from './lib/telephony-engine';

// ── Types (exportés pour réutilisation backend ; le front a ses propres types
//    dans src/lib/api.ts — CallLog / IvrMenu) ─────────────────────────────────
export interface CallLogRow {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  direction: 'inbound' | 'outbound' | string;
  from_number: string | null;
  to_number: string | null;
  status: string;
  duration_sec: number;
  recording_url: string | null;
  transcription: string | null;
  twilio_sid: string | null;
  created_at: string | null;
}

export interface IvrMenuRow {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  name: string | null;
  config_json: string | null;
  is_active: number;
  created_at: string | null;
}

// Auth enrichi au choke-point (worker.ts:944) — calque le type passé à
// routeProtected (userId/role/clientId/tenant/capabilities).
type TelephonyAuth = CapAuth & { capabilities?: Set<string> };

// ── Helpers FLAG (corps réels — calque sendSms) ─────────────────────────────

/**
 * placeCall — déclenche un appel sortant Twilio (Calls.json, TwiML inline).
 * FLAG INACTIF : garde credentials EXACT calque helpers.ts:sendSms:93-95. Sans
 * secrets Twilio → { success:false, mock:true } SANS appel réseau. Le call_log
 * est posé par l'appelant (status 'mock'/'queued') indépendamment de ce retour.
 */
export async function placeCall(
  env: Env,
  to: string,
  from: string,
  twiml: string,
): Promise<{ success: boolean; sid?: string; mock?: boolean; error?: string }> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    // Flag inactif — aucun appel réel. Le call_log mock reste créé en amont.
    return { success: false, mock: true, error: 'Twilio non configuré' };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls.json`;
    const authStr = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const params = new URLSearchParams({
      To: to,
      From: from || env.TWILIO_PHONE_NUMBER,
      Twiml: twiml,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authStr}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = (await res.json()) as { sid?: string; message?: string; code?: number };
    if (!res.ok) {
      return { success: false, error: data.message || `Twilio ${res.status}` };
    }
    return { success: true, sid: data.sid };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * logCall — INSERT structuré dans call_logs (best-effort, jamais throw). Helper
 * partagé par handlePlaceCall (Phase A pose le mock) et le wiring CRM (Phase B
 * complète conversation_id + INSERT messages + activity). lead_id /
 * conversation_id NULLABLES.
 */
export async function logCall(
  env: Env,
  data: {
    clientId?: string | null;
    agencyId?: string | null;
    leadId?: string | null;
    conversationId?: string | null;
    direction: 'inbound' | 'outbound' | string;
    fromNumber?: string | null;
    toNumber?: string | null;
    status: string;
    durationSec?: number;
    recordingUrl?: string | null;
    transcription?: string | null;
    twilioSid?: string | null;
  },
): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO call_logs
         (id, client_id, agency_id, lead_id, conversation_id, direction,
          from_number, to_number, status, duration_sec, recording_url,
          transcription, twilio_sid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        data.clientId ?? null,
        data.agencyId ?? null,
        data.leadId ?? null,
        data.conversationId ?? null,
        data.direction,
        data.fromNumber ?? null,
        data.toNumber ?? null,
        data.status,
        data.durationSec ?? 0,
        data.recordingUrl ?? null,
        data.transcription ?? null,
        data.twilioSid ?? null,
      )
      .run();
    return id;
  } catch {
    // Table seq 102 absente / panne D1 : best-effort, on ne casse rien.
    return null;
  }
}

// Échappement XML pour les valeurs injectées dans le TwiML (anti-injection).
export function escapeXml(input: string): string {
  return (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Résout le client_id du tenant courant (calque conversations.ts:28). admin =
// non borné (null) ; sinon users.client_id.
async function resolveClientId(
  env: Env,
  auth: TelephonyAuth,
): Promise<string | null> {
  if (auth.role === 'admin') return null;
  if (auth.clientId) return auth.clientId;
  const user = (await env.DB.prepare('SELECT client_id FROM users WHERE id = ?')
    .bind(auth.userId)
    .first()) as { client_id: string } | null;
  return user?.client_id ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS PROTÉGÉS
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/calls — liste des call_logs bornée tenant ──────────────────────
// Phase B (Manager-B) : corps d'agrégation complet — JOIN leads (nom) +
// filtres ?lead_id= / ?direction= + bornage tenant (resolveClientId, jamais
// depuis le body/query). best-effort : table seq 102 absente → { data: [] }.
export async function handleGetCallLogs(
  env: Env,
  auth: TelephonyAuth,
  url: URL,
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    const leadId = url.searchParams.get('lead_id');
    const direction = url.searchParams.get('direction');
    const disposition = url.searchParams.get('disposition');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

    // JOIN leads optionnel pour le nom affichable (timeline fiche lead / liste).
    let sql = `SELECT cl.*, l.name AS lead_name
                 FROM call_logs cl
                 LEFT JOIN leads l ON cl.lead_id = l.id
                WHERE 1=1`;
    const binds: (string | number)[] = [];
    // Bornage tenant strict : client_id résolu serveur (calque conversations.ts:27).
    if (clientId) {
      sql += ' AND cl.client_id = ?';
      binds.push(clientId);
    }
    if (leadId) {
      sql += ' AND cl.lead_id = ?';
      binds.push(sanitizeInput(leadId, 64));
    }
    if (direction) {
      sql += ' AND cl.direction = ?';
      binds.push(sanitizeInput(direction, 16));
    }
    // Filtre disposition seq 116 (cl.* expose déjà disposition/notes). Additif —
    // ne casse ni le bornage tenant ni les filtres lead_id/direction existants.
    if (disposition) {
      sql += ' AND cl.disposition = ?';
      binds.push(sanitizeInput(disposition, 32));
    }
    sql += ' ORDER BY cl.created_at DESC LIMIT ?';
    binds.push(limit);

    const res = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: res.results ?? [] });
  } catch {
    // Table seq 102 absente : best-effort.
    return json({ data: [] });
  }
}

// ── POST /api/calls — click-to-call sortant ─────────────────────────────────
// requireCapability('leads.write'). Phase B (Manager-B) : corps complet —
//   résolution du lead borné tenant (to_number = leads.phone) + from_number
//   (sub_accounts.twilio_phone OU clients.phone du tenant) + génération TwiML
//   <Dial> + appel placeCall (FLAG INACTIF : sans credentials → mock, AUCUN
//   appel réel) + wiring CRM (findOrCreateConversation + activity call_logged).
//   Le call_log est posé QUAND MÊME (status 'queued'→'mock'/'ringing'). Bornage
//   tenant strict : client_id résolu serveur (jamais depuis le body).
export async function handlePlaceCall(
  request: Request,
  env: Env,
  auth: TelephonyAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;

  let body: { lead_id?: string } = {};
  try {
    body = (await request.json()) as { lead_id?: string };
  } catch {
    body = {};
  }
  const leadId = sanitizeInput(body.lead_id, 64) || null;
  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  // Bornage tenant : client_id résolu serveur (calque conversations.ts:27).
  const clientId = await resolveClientId(env, auth);

  // Résolution du lead BORNÉE tenant — to_number = leads.phone (jamais body).
  let lead: { id: string; phone: string | null; client_id: string } | null = null;
  try {
    let lsql = 'SELECT id, phone, client_id FROM leads WHERE id = ?';
    const lbinds: (string | number)[] = [leadId];
    if (clientId) {
      lsql += ' AND client_id = ?';
      lbinds.push(clientId);
    }
    lead = (await env.DB.prepare(lsql).bind(...lbinds).first()) as { id: string; phone: string | null; client_id: string } | null;
  } catch {
    lead = null;
  }
  if (!lead) return json({ error: 'Lead introuvable' }, 404);

  const toNumber = (lead.phone || '').trim() || null;
  const tenantClientId = lead.client_id; // tenant propriétaire effectif du lead.

  // from_number = numéro Twilio du tenant : sub_accounts.twilio_phone, sinon
  // clients.phone. best-effort (colonnes/tables absentes → null).
  let fromNumber: string | null = null;
  try {
    const sub = (await env.DB.prepare(
      'SELECT twilio_phone FROM sub_accounts WHERE client_id = ? AND twilio_phone IS NOT NULL LIMIT 1',
    )
      .bind(tenantClientId)
      .first()) as { twilio_phone: string | null } | null;
    fromNumber = sub?.twilio_phone || null;
    if (!fromNumber) {
      const cli = (await env.DB.prepare('SELECT phone FROM clients WHERE id = ?')
        .bind(tenantClientId)
        .first()) as { phone: string | null } | null;
      fromNumber = cli?.phone || null;
    }
  } catch {
    fromNumber = null;
  }

  // call_log posé QUAND MÊME (status 'queued') AVANT l'appel — journalisation +
  // wiring testables sans credentials.
  const callLogId = await logCall(env, {
    clientId: tenantClientId,
    leadId: lead.id,
    direction: 'outbound',
    fromNumber,
    toNumber,
    status: 'queued',
  });

  // TwiML <Dial> connectant l'agent ↔ le lead. escapeXml anti-injection sur le
  // numéro (valeur dynamique injectée dans le XML).
  const twiml = toNumber
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${escapeXml(toNumber)}</Dial></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="fr-CA">Numéro indisponible.</Say><Hangup /></Response>`;

  // placeCall — FLAG INACTIF (helpers.ts:sendSms calque). Sans credentials →
  // { success:false, mock:true } SANS appel réseau ; le call_log reste 'mock'.
  let mock = true;
  let twilioSid: string | null = null;
  let status = 'mock';
  if (toNumber && fromNumber) {
    const placed = await placeCall(env, toNumber, fromNumber, twiml);
    if (placed.mock) {
      mock = true;
      status = 'mock';
    } else if (placed.success) {
      mock = false;
      status = 'ringing';
      twilioSid = placed.sid ?? null;
    } else {
      mock = false;
      status = 'failed';
    }
  } else {
    // Numéro source/destination manquant → on ne tente aucun appel.
    status = 'failed';
  }

  // MAJ du call_log avec le statut final + twilio_sid (best-effort).
  if (callLogId) {
    try {
      await env.DB.prepare('UPDATE call_logs SET status = ?, twilio_sid = ? WHERE id = ?')
        .bind(status, twilioSid, callLogId)
        .run();
    } catch {
      // best-effort.
    }
  }

  // Wiring CRM : conversation 'voice' (calque voice.ts:97) + activity
  // call_logged (best-effort, jamais throw — ne bloque pas la réponse).
  let conversationId: string | null = null;
  try {
    conversationId = await findOrCreateConversation(env, lead.id, tenantClientId, 'voice');
    if (callLogId && conversationId) {
      await env.DB.prepare('UPDATE call_logs SET conversation_id = ? WHERE id = ?')
        .bind(conversationId, callLogId)
        .run();
    }
  } catch {
    conversationId = null;
  }
  try {
    await env.DB.prepare(
      'INSERT INTO activity_log (lead_id, client_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(
        lead.id,
        tenantClientId,
        auth.userId,
        'call_logged',
        JSON.stringify({ direction: 'outbound', status, mock, call_log_id: callLogId }),
      )
      .run();
  } catch {
    // activity_log best-effort.
  }

  return json({ data: { id: callLogId, conversation_id: conversationId, status, mock } });
}

// ── /api/ivr-menus — CRUD config IVR (RÉEL Phase A) ─────────────────────────
// requireCapability('settings.manage'). Bornage tenant strict.

export async function handleGetIvrMenus(
  env: Env,
  auth: TelephonyAuth,
  _url: URL,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    let sql = 'SELECT * FROM ivr_menus WHERE 1=1';
    const binds: (string | number)[] = [];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    sql += ' ORDER BY created_at DESC';
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: res.results ?? [] });
  } catch {
    return json({ data: [] });
  }
}

export async function handleSaveIvrMenu(
  request: Request,
  env: Env,
  auth: TelephonyAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  let body: { id?: string; name?: string; config?: unknown; config_json?: string; is_active?: number | boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps invalide' }, 400);
  }

  const name = sanitizeInput(body.name, 120);
  // config peut arriver objet (sérialisé ici) ou déjà string.
  let configJson: string;
  if (typeof body.config_json === 'string') {
    configJson = body.config_json.slice(0, 20000);
  } else if (body.config !== undefined) {
    try {
      configJson = JSON.stringify(body.config).slice(0, 20000);
    } catch {
      configJson = '{}';
    }
  } else {
    configJson = '{}';
  }
  const isActive = body.is_active === false || body.is_active === 0 ? 0 : 1;

  const clientId = await resolveClientId(env, auth);

  try {
    if (body.id) {
      // UPDATE borné tenant (admin non borné).
      let sql = 'UPDATE ivr_menus SET name = ?, config_json = ?, is_active = ? WHERE id = ?';
      const binds: (string | number)[] = [name, configJson, isActive, sanitizeInput(body.id, 64)];
      if (clientId) {
        sql += ' AND client_id = ?';
        binds.push(clientId);
      }
      await env.DB.prepare(sql).bind(...binds).run();
      return json({ data: { id: body.id, success: true } });
    }

    // INSERT — client_id posé serveur (jamais body).
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO ivr_menus (id, client_id, name, config_json, is_active)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, clientId, name, configJson, isActive)
      .run();
    return json({ data: { id, success: true } });
  } catch {
    return json({ error: 'Échec enregistrement IVR' }, 500);
  }
}

export async function handleDeleteIvrMenu(
  env: Env,
  auth: TelephonyAuth,
  menuId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    let sql = 'DELETE FROM ivr_menus WHERE id = ?';
    const binds: (string | number)[] = [sanitizeInput(menuId, 64)];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    await env.DB.prepare(sql).bind(...binds).run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Échec suppression IVR' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS PUBLICS (webhooks Twilio — AVANT auth dans worker.ts)
// ════════════════════════════════════════════════════════════════════════════

// ── GET/POST /api/voice/ivr/:menuId — TwiML d'un menu IVR ───────────────────
// PUBLIC (appelé par Twilio). Phase B (Manager-B) : génération complète depuis
//   config_json {greeting, options:[{digit, action 'dial'|'voicemail', target}]}.
//   Premier appel (aucun Digits) → <Gather numDigits=1><Say>greeting</Say>.
//   Réponse à un digit (Twilio re-POST Digits) → routing :
//     - 'dial'      → <Dial>target (escapeXml).
//     - 'voicemail' → <Record action="/api/voice/webhook/record"> (réutilise le
//                     flux voice.ts existant : transcription Whisper + message).
//   escapeXml sur TOUTES les valeurs injectées (anti-injection). best-effort :
//   menu absent / config illisible → <Say> fallback sûr. Réponse text/xml.
export async function handleVoiceIvrTwiml(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/api\/voice\/ivr\/([^/]+)$/);
  const routeMenuId = m ? m[1]! : '';

  // Digit composé par l'appelant (Twilio le renvoie en form-urlencoded sur le
  // POST de suivi du <Gather>). To = numéro Twilio appelé (résolution tenant si
  // l'URL ne porte pas de menuId).
  let digits = '';
  let toNumber = '';
  try {
    const fd = await request.formData();
    digits = String(fd.get('Digits') ?? '').trim();
    toNumber = String(fd.get('To') ?? '').trim();
  } catch {
    // GET ou corps absent : pas de digit (premier passage).
  }

  // Résolution du menu : :menuId explicite, sinon To → tenant → menu actif.
  let menu: IvrMenuRow | null = null;
  try {
    if (routeMenuId) {
      menu = (await env.DB.prepare('SELECT * FROM ivr_menus WHERE id = ? AND is_active = 1')
        .bind(routeMenuId)
        .first()) as IvrMenuRow | null;
    } else if (toNumber) {
      menu = (await env.DB.prepare(
        `SELECT iv.* FROM ivr_menus iv
           WHERE iv.is_active = 1
             AND iv.client_id IN (
               SELECT id FROM clients WHERE phone = ?
               UNION
               SELECT client_id FROM sub_accounts WHERE twilio_phone = ?
             )
           ORDER BY iv.created_at DESC LIMIT 1`,
      )
        .bind(toNumber, toNumber)
        .first()) as IvrMenuRow | null;
    }
  } catch {
    menu = null;
  }

  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
  const fallback = `${xmlHeader}\n<Response>\n  <Say language="fr-CA">Bonjour. Ce service est momentanément indisponible.</Say>\n  <Hangup />\n</Response>`;

  if (!menu) {
    return new Response(fallback, { headers: { 'Content-Type': 'text/xml' } });
  }

  // Parse config_json best-effort.
  let config: {
    greeting?: string;
    options?: Array<{ digit?: string; action?: string; target?: string }>;
  } = {};
  try {
    config = menu.config_json ? (JSON.parse(menu.config_json) as typeof config) : {};
  } catch {
    config = {};
  }
  const greeting = config.greeting || (menu.name ? `Bonjour, vous avez joint ${menu.name}.` : 'Bonjour.');
  const options = Array.isArray(config.options) ? config.options : [];

  // Réponse à un digit : router vers l'option correspondante.
  if (digits) {
    const opt = options.find((o) => String(o?.digit ?? '').trim() === digits);
    if (opt) {
      if (opt.action === 'voicemail') {
        // Réutilise le flux voicemail voice.ts (action = même webhook record).
        const xml = `${xmlHeader}\n<Response>\n  <Say language="fr-CA">Veuillez laisser un message après le bip.</Say>\n  <Record action="/api/voice/webhook/record" method="POST" maxLength="120" playBeep="true" />\n  <Say language="fr-CA">Merci, au revoir.</Say>\n</Response>`;
        return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
      }
      if (opt.action === 'dial' && opt.target) {
        const xml = `${xmlHeader}\n<Response>\n  <Dial>${escapeXml(String(opt.target))}</Dial>\n</Response>`;
        return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
      }
    }
    // Digit non reconnu → on rejoue le menu (ré-appelle ce même endpoint).
    const reprompt = `${xmlHeader}\n<Response>\n  <Say language="fr-CA">Choix invalide.</Say>\n  <Redirect method="POST">${escapeXml(url.pathname)}</Redirect>\n</Response>`;
    return new Response(reprompt, { headers: { 'Content-Type': 'text/xml' } });
  }

  // Premier passage : présenter le menu via <Gather>. Le Gather re-POST sur le
  // même endpoint avec Digits.
  const xml = `${xmlHeader}\n<Response>\n  <Gather numDigits="1" method="POST" action="${escapeXml(url.pathname)}">\n    <Say language="fr-CA">${escapeXml(greeting)}</Say>\n  </Gather>\n  <Say language="fr-CA">Aucune sélection. Au revoir.</Say>\n  <Hangup />\n</Response>`;
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } });
}

// ── POST /api/voice/status-callback — MAJ call_logs depuis Twilio ───────────
// PUBLIC (webhook Twilio — pas d'auth applicative ; le bornage se fait par le
//   twilio_sid, qui ne corrèle qu'à un call_log déjà créé côté tenant). Twilio
//   envoie CallSid / CallStatus / CallDuration (+ RecordingUrl éventuel).
//   UPDATE call_logs SET status, duration_sec WHERE twilio_sid = CallSid. Si
//   RecordingUrl présent → stocke recording_url + transcription (réutilise le
//   pattern Whisper voice.ts si OPENAI_API_KEY, sinon skip). best-effort,
//   réponse 200 toujours (jamais de 500 vers Twilio).
export async function handleCallStatusCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  let callSid = '';
  let callStatus = '';
  let callDuration = '';
  let recordingUrl = '';
  try {
    const fd = await request.formData();
    callSid = String(fd.get('CallSid') ?? '').trim();
    callStatus = String(fd.get('CallStatus') ?? '').trim();
    callDuration = String(fd.get('CallDuration') ?? '').trim();
    recordingUrl = String(fd.get('RecordingUrl') ?? '').trim();
  } catch {
    return new Response('OK', { status: 200 });
  }

  // Sans CallSid on ne peut rien corréler — accusé inerte (best-effort).
  if (!callSid) return new Response('OK', { status: 200 });

  const durationSec = Number.parseInt(callDuration, 10);

  try {
    // MAJ status/duration bornée par twilio_sid (corrèle au call_log du tenant).
    await env.DB.prepare(
      'UPDATE call_logs SET status = ?, duration_sec = ? WHERE twilio_sid = ?',
    )
      .bind(callStatus || 'completed', Number.isFinite(durationSec) ? durationSec : 0, callSid)
      .run();
  } catch {
    // Table absente / panne D1 : best-effort.
  }

  // ── Appel manqué → tâche (Manager-B, best-effort, jamais throw) ────────────
  // Si l'appel n'a pas abouti (no-answer/failed/busy), on crée une tâche de
  // rappel rattachée au lead/tenant du call_log. Webhook PUBLIC : aucun user_id
  // (created_by null). N'altère JAMAIS la réponse 200.
  if (isMissedCallStatus(callStatus)) {
    try {
      // Retrouve le tenant + le lead via le call_log déjà créé (handlePlaceCall).
      const cl = (await env.DB.prepare(
        'SELECT client_id, lead_id, to_number FROM call_logs WHERE twilio_sid = ?',
      )
        .bind(callSid)
        .first()) as { client_id: string | null; lead_id: string | null; to_number: string | null } | null;

      if (cl) {
        // Anti-doublon best-effort : ne pas recréer la tâche si une tâche de
        // rappel 'todo' existe déjà pour ce call (twilio_sid stocké dans
        // description). Si la requête échoue (colonne/table absente) → on tente
        // quand même l'INSERT (best-effort global).
        let alreadyExists = false;
        try {
          const dup = (await env.DB.prepare(
            "SELECT id FROM tasks WHERE status = 'todo' AND description = ? LIMIT 1",
          )
            .bind(`call_missed:${callSid}`)
            .first()) as { id: string } | null;
          alreadyExists = !!dup;
        } catch {
          alreadyExists = false;
        }

        if (!alreadyExists) {
          let taskInserted = false;
          try {
            // title NOT NULL fourni ; priority/status ∈ whitelist CHECK
            // ('high' / 'todo') ; created_by null (webhook public sans auth).
            await env.DB.prepare(
              `INSERT INTO tasks (id, title, description, priority, status, lead_id, client_id, created_by)
               VALUES (?, ?, ?, 'high', 'todo', ?, ?, NULL)`,
            )
              .bind(
                crypto.randomUUID(),
                'Rappeler — appel manqué',
                `call_missed:${callSid}`,
                cl.lead_id ?? null,
                cl.client_id ?? null,
              )
              .run();
            taskInserted = true;
          } catch {
            // Table/colonne tasks absente → fallback activity_log ci-dessous.
            taskInserted = false;
          }

          if (!taskInserted) {
            // Fallback best-effort : trace dans activity_log (calque handlePlaceCall).
            // Webhook public → user_id null.
            try {
              await env.DB.prepare(
                'INSERT INTO activity_log (lead_id, client_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)',
              )
                .bind(
                  cl.lead_id ?? null,
                  cl.client_id ?? null,
                  null,
                  'call_missed',
                  JSON.stringify({ twilio_sid: callSid, status: callStatus, to_number: cl.to_number ?? null }),
                )
                .run();
            } catch {
              // best-effort total : on n'altère jamais la réponse 200.
            }
          }
        }
      }
    } catch {
      // best-effort total — jamais throw, réponse 200 préservée.
    }
  }

  // Enregistrement éventuel : recording_url + transcription Whisper (calque
  // voice.ts:64-94). Aucune clé OpenAI → on stocke juste l'URL.
  if (recordingUrl) {
    let transcription: string | null = null;
    if (env.OPENAI_API_KEY) {
      try {
        const audioRes = await fetch(recordingUrl);
        const audioBlob = await audioRes.blob();
        const whisperForm = new FormData();
        whisperForm.append('file', audioBlob, 'recording.wav');
        whisperForm.append('model', 'whisper-1');
        whisperForm.append('language', 'fr');
        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
          body: whisperForm,
        });
        if (whisperRes.ok) {
          const data = (await whisperRes.json()) as { text?: string };
          if (data.text) transcription = data.text;
        }
      } catch {
        transcription = null;
      }
    }
    try {
      await env.DB.prepare(
        'UPDATE call_logs SET recording_url = ?, transcription = ? WHERE twilio_sid = ?',
      )
        .bind(recordingUrl, transcription, callSid)
        .run();
    } catch {
      // best-effort.
    }
  }

  return new Response('OK', { status: 200 });
}

// ════════════════════════════════════════════════════════════════════════════
// SPRINT 16 (seq 116) — disposition post-appel + notes (STUB Phase A) ─────────
// ════════════════════════════════════════════════════════════════════════════

// ── POST /api/calls/:id/disposition — qualifier un appel (disposition + notes) ─
// requireCapability('leads.write'). Signature FIGÉE Phase A (worker.ts la câble).
// Phase A pose UNIQUEMENT ce stub. Corps réel = Manager-B (Phase B) :
//   - resolveClientId(env, auth) (client_id serveur, JAMAIS body).
//   - parse body { disposition?, notes? } ; disposition VALIDÉE HANDLER
//     (whitelist JS : interested|callback|voicemail|wrong_number|not_interested…),
//     notes via sanitizeInput. JAMAIS de SQL libre.
//   - UPDATE call_logs SET disposition = ?, notes = ? WHERE id = ?
//     AND client_id = ? (borné tenant ; admin non borné, calque resolveClientId).
//   - best-effort : colonne seq 116 absente / row absente → réponse propre,
//     JAMAIS de 500 brut. Réponse json({ data: { success: true } }).
export async function handleSetCallDisposition(
  request: Request,
  env: Env,
  auth: TelephonyAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'leads.write');
  if (g) return g;

  // Manager-B (Phase B) — corps réel. Signature + capGuard FIGÉS Phase A.
  // Parse body { disposition?, notes? }.
  let body: { disposition?: string; notes?: string } = {};
  try {
    body = (await request.json()) as { disposition?: string; notes?: string };
  } catch {
    body = {};
  }

  // disposition VALIDÉE HANDLER (whitelist JS — JAMAIS de CHECK SQL). Hors
  // whitelist ⇒ 400. Calque les clés i18n telephony.disposition.* figées Phase A.
  const DISPOSITION_WHITELIST = new Set([
    'interested',
    'callback',
    'voicemail',
    'wrong_number',
    'not_interested',
  ]);
  let disposition: string | null = null;
  if (body.disposition !== undefined && body.disposition !== null && body.disposition !== '') {
    const candidate = sanitizeInput(body.disposition, 32);
    if (!DISPOSITION_WHITELIST.has(candidate)) {
      return json({ error: 'Disposition invalide' }, 400);
    }
    disposition = candidate;
  }

  // notes : texte libre nettoyé (sanitizeInput).
  const notes = body.notes !== undefined && body.notes !== null && body.notes !== ''
    ? sanitizeInput(body.notes, 2000)
    : null;

  // Bornage tenant : client_id résolu serveur (calque resolveClientId), JAMAIS
  // depuis le body. admin non borné (clientId null).
  const clientId = await resolveClientId(env, auth);
  const callLogId = sanitizeInput(id, 64);

  try {
    let sql = 'UPDATE call_logs SET disposition = ?, notes = ? WHERE id = ?';
    const binds: (string | number | null)[] = [disposition, notes, callLogId];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    const res = await env.DB.prepare(sql).bind(...binds).run();
    // D1 expose meta.changes : 0 = row absente / hors tenant → 404.
    const changes = (res as { meta?: { changes?: number } })?.meta?.changes;
    if (typeof changes === 'number' && changes === 0) {
      return json({ error: 'Appel introuvable' }, 404);
    }
    return json({ data: { success: true } });
  } catch {
    // best-effort : colonne seq 116 absente / panne D1 → réponse propre, jamais 500 brut.
    return json({ error: 'Appel introuvable' }, 404);
  }
}
