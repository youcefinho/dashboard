// ── whatsapp.ts — LOT SMS/WHATSAPP seq 104 (Manager-A, Phase A) ─────────────
//
// Squelette WhatsApp Business (Meta Cloud API) — FLAG INACTIF par défaut.
// MODULE NEUF. Comporte :
//   (a) handleWhatsAppWebhook — GET = handshake verify token Meta
//       (hub.challenge) ; POST = inbound stub (accusé 200, parsing complet =
//       Manager-B si besoin).
//   (b) handleGetWhatsAppConnection / handleSaveWhatsAppConnection — CRUD config
//       whatsapp_connections (capability 'settings.manage', bornage tenant).
//   (c) sendWhatsAppTemplate — envoi sortant FLAG INACTIF (calque sendSms /
//       placeCall) : sans WHATSAPP_ACCESS_TOKEN → { success:false } SANS fetch.
//
// Conventions (docs/LOT-SMS-WHATSAPP.md §6) :
//   - json({ data }) succès / json({ error }, status) erreur. JAMAIS de `code`.
//   - Webhook GET/POST = PUBLIC (appelé par Meta, pré-auth dans worker.ts).
//   - CRUD = capability 'settings.manage' (réutilisée seq 80, aucun ajout).
//   - best-effort : table seq 104 absente → réponse propre, jamais 500/throw.
//
// Imports RELATIFS uniquement — PAS d'alias @/ (tsconfig.worker.json).
//
// ⚠ OWNERSHIP (§6.H) : ce fichier est EXCLUSIF à Manager-B en Phase B (corps
//   fonctionnels mock ici — Manager-B enrichit si besoin, signatures FIGÉES).
//   Manager-C NE LE TOUCHE PAS.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';

type WhatsAppAuth = CapAuth & { capabilities?: Set<string> };

// Résout le client_id du tenant courant (calque telephony.ts:185).
async function resolveClientId(env: Env, auth: WhatsAppAuth): Promise<string | null> {
  if (auth.role === 'admin') return null;
  if (auth.clientId) return auth.clientId;
  const user = (await env.DB.prepare('SELECT client_id FROM users WHERE id = ?')
    .bind(auth.userId)
    .first()) as { client_id: string } | null;
  return user?.client_id ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOK PUBLIC (Meta — pré-auth dans worker.ts)
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/webhook/whatsapp — handshake verify token Meta ─────────────────
//    ── POST /api/webhook/whatsapp — inbound stub ─────────────────────────────
// GET : Meta envoie ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
//   Si hub.verify_token === env.WHATSAPP_VERIFY_TOKEN → renvoie hub.challenge
//   en text/plain (200). Sinon 403 (jamais 500). FLAG INACTIF : sans
//   WHATSAPP_VERIFY_TOKEN configuré → 403 (le webhook n'est jamais validé tant
//   que le squelette n'est pas branché).
// POST : inbound stub — accusé 200 (Manager-B peut compléter le parsing
//   messages/statuses et le wiring Inbox si besoin, signature INCHANGÉE).
export async function handleWhatsAppWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    // Token absent/incorrect — refus propre (jamais 500).
    return new Response('Forbidden', { status: 403 });
  }

  // POST inbound : accusé 200 best-effort. Manager-B (si besoin) : parse
  // entry[].changes[].value.messages / .statuses → wiring Inbox (channel
  // 'whatsapp', messages.delivery_status), calque handleInboundSms.
  try {
    await request.json();
  } catch {
    // corps absent/illisible : accusé inerte.
  }
  return new Response('', { status: 200 });
}

// ════════════════════════════════════════════════════════════════════════════
// CRUD CONFIG PROTÉGÉ (capability 'settings.manage')
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/integrations/whatsapp — connexion du tenant (1 par tenant) ─────
export async function handleGetWhatsAppConnection(
  env: Env,
  auth: WhatsAppAuth,
  _url: URL,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    let sql = 'SELECT id, client_id, phone_number_id, status, created_at FROM whatsapp_connections WHERE 1=1';
    const binds: (string | number)[] = [];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    sql += ' ORDER BY created_at DESC LIMIT 1';
    // NB : access_token volontairement NON exposé au front (secret). status
    // 'inactive'|'active' suffit à piloter la carte « non configuré » côté UI.
    const row = await env.DB.prepare(sql).bind(...binds).first();
    return json({ data: row ?? null });
  } catch {
    return json({ data: null });
  }
}

// ── POST /api/integrations/whatsapp — enregistre/maj la config (upsert simple)
//    status calculé serveur : 'active' si phone_number_id + access_token
//    fournis, sinon 'inactive' (squelette flag-inactif — aucun appel réseau).
export async function handleSaveWhatsAppConnection(
  request: Request,
  env: Env,
  auth: WhatsAppAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  let body: { phone_number_id?: string; access_token?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps invalide' }, 400);
  }

  const phoneNumberId = sanitizeInput(body.phone_number_id, 64);
  const accessToken = sanitizeInput(body.access_token, 512);
  const status = phoneNumberId && accessToken ? 'active' : 'inactive';

  try {
    const clientId = await resolveClientId(env, auth);
    // Upsert applicatif : un enregistrement par tenant. On cherche l'existant
    // borné tenant, sinon INSERT.
    let findSql = 'SELECT id FROM whatsapp_connections WHERE 1=1';
    const findBinds: (string | number)[] = [];
    if (clientId) {
      findSql += ' AND client_id = ?';
      findBinds.push(clientId);
    }
    findSql += ' ORDER BY created_at DESC LIMIT 1';
    const existing = (await env.DB.prepare(findSql).bind(...findBinds).first()) as { id: string } | null;

    if (existing) {
      await env.DB.prepare(
        'UPDATE whatsapp_connections SET phone_number_id = ?, access_token = ?, status = ? WHERE id = ?',
      )
        .bind(phoneNumberId, accessToken, status, existing.id)
        .run();
      return json({ data: { id: existing.id, status, success: true } });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO whatsapp_connections (id, client_id, phone_number_id, access_token, status) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, clientId, phoneNumberId, accessToken, status)
      .run();
    return json({ data: { id, status, success: true } });
  } catch {
    return json({ error: 'Échec enregistrement WhatsApp' }, 500);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ENVOI SORTANT — FLAG INACTIF (calque helpers.sendSms / telephony.placeCall)
// ════════════════════════════════════════════════════════════════════════════

/**
 * sendWhatsAppTemplate — envoi d'un message template WhatsApp via Meta Cloud
 * API. FLAG INACTIF (calque EXACT sendSms:93-95 / placeCall:85-88) : si
 * `!env.WHATSAPP_ACCESS_TOKEN` → { success:false, error:'WhatsApp non configuré' }
 * SANS appel réseau. Avec token + phone_number_id → POST graph.facebook.com.
 *
 * @param env environnement (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)
 * @param to numéro destinataire (format E.164)
 * @param templateName nom du template approuvé Meta
 * @param languageCode locale du template (défaut 'fr')
 */
export async function sendWhatsAppTemplate(
  env: Env,
  to: string,
  templateName: string,
  languageCode = 'fr',
): Promise<{ success: boolean; id?: string; mock?: boolean; error?: string }> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    // FLAG INACTIF — aucun appel réseau. Squelette testable sans credentials.
    return { success: false, mock: true, error: 'WhatsApp non configuré' };
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: languageCode } },
      }),
    });

    const data = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok) {
      return { success: false, error: data.error?.message || `WhatsApp ${res.status}` };
    }
    return { success: true, id: data.messages?.[0]?.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
