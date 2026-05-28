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
import { json, sanitizeInput, createNotification } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { findOrCreateConversation } from './conversations';

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

  // POST inbound : parse entry[].changes[].value.messages / .statuses
  try {
    const payload = (await request.json()) as any;
    if (payload?.object === 'whatsapp_business_account') {
      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          const metadata = value.metadata || {};
          const phoneNumberId = metadata.phone_number_id;

          if (!phoneNumberId) continue;

          // 1. Résoudre le client_id à partir de phoneNumberId
          const connection = (await env.DB.prepare(
            "SELECT client_id FROM whatsapp_connections WHERE phone_number_id = ? AND status = 'active' LIMIT 1"
          )
            .bind(phoneNumberId)
            .first()) as { client_id: string } | null;

          if (!connection) continue;
          const clientId = connection.client_id;

          // 2. Traiter les messages entrants
          if (value.messages) {
            for (const msg of value.messages) {
              const from = msg.from || '';
              const messageId = msg.id || '';
              let bodyText = '';

              if (msg.type === 'text' && msg.text) {
                bodyText = msg.text.body || '';
              } else if (msg.type === 'image') {
                bodyText = '[Image WhatsApp]';
              } else if (msg.type === 'audio') {
                bodyText = '[Audio WhatsApp]';
              } else if (msg.type === 'video') {
                bodyText = '[Vidéo WhatsApp]';
              } else if (msg.type === 'document') {
                bodyText = '[Document WhatsApp]';
              } else {
                bodyText = `[Message WhatsApp (${msg.type})]`;
              }

              if (!from || !bodyText) continue;

              // Chercher le lead par son numéro de téléphone
              const cleanPhone = from.replace(/\D/g, '').slice(-10);
              let lead = (await env.DB.prepare(
                "SELECT id, name, preferred_language FROM leads WHERE REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '+', '') LIKE ? AND client_id = ?"
              )
                .bind(`%${cleanPhone}`, clientId)
                .first()) as { id: string; name: string; preferred_language?: string | null } | null;

              if (!lead) {
                // Créer un lead de manière dynamique si non trouvé
                const contact = (value.contacts || []).find((c: any) => c.wa_id === from);
                const profileName = contact?.profile?.name || `Contact WhatsApp ${from}`;
                const newLeadId = crypto.randomUUID();
                
                await env.DB.prepare(
                  "INSERT INTO leads (id, client_id, name, phone, status, created_at) VALUES (?, ?, ?, ?, 'new', datetime('now'))"
                )
                  .bind(newLeadId, clientId, profileName, `+${from}`)
                  .run();

                lead = { id: newLeadId, name: profileName, preferred_language: 'fr' };
              }

              // Trouver ou créer la conversation
              const convId = await findOrCreateConversation(env, lead.id, clientId, 'whatsapp');
              const sanitizedBody = sanitizeInput(bodyText, 1600);

              // Sauvegarder le message inbound
              const msgUUID = crypto.randomUUID();
              await env.DB.prepare(
                `INSERT INTO messages (id, lead_id, client_id, conversation_id, direction, channel, body, status, sent_by, external_id)
                 VALUES (?, ?, ?, ?, 'inbound', 'whatsapp', ?, 'delivered', ?, ?)`
              )
                .bind(msgUUID, lead.id, clientId, convId, sanitizedBody, from, messageId)
                .run();

              // Mettre à jour la conversation
              await env.DB.prepare(
                `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?, unread_count = unread_count + 1, updated_at = datetime('now') WHERE id = ?`
              )
                .bind(sanitizedBody.substring(0, 120), convId)
                .run();

              // Webhook event message.received
              try {
                const { publishEvent } = await import('./webhooks-dispatch');
                publishEvent(env, clientId, 'message.received', { lead_id: lead.id, channel: 'whatsapp', body: sanitizedBody });
              } catch (e) {
                console.error('Webhook error:', e);
              }

              // Stop on reply (Workflows)
              const activeEnrollments = await env.DB.prepare(
                `SELECT we.id, w.trigger_config FROM workflow_enrollments we
                 JOIN workflows w ON we.workflow_id = w.id
                 WHERE we.lead_id = ? AND we.status = 'active'`
              )
                .bind(lead.id)
                .all();
              if (activeEnrollments.results) {
                for (const enr of activeEnrollments.results as any[]) {
                  let config: any = {};
                  try { config = JSON.parse(enr.trigger_config || '{}'); } catch {}
                  if (config.stop_on_reply) {
                    await env.DB.prepare("UPDATE workflow_enrollments SET status = 'cancelled' WHERE id = ?").bind(enr.id).run();
                  }
                }
              }

              // Notifier les admins du tenant
              const { results: admins } = await env.DB.prepare(
                "SELECT id FROM users WHERE role = 'admin' AND is_active = 1"
              ).all();
              for (const admin of (admins || []) as Array<{ id: string }>) {
                await createNotification(env, admin.id, '💬 WhatsApp reçu', `${lead.name}: "${bodyText.substring(0, 80)}"`, '💬', `/conversations`, clientId);
              }
            }
          }

          // 3. Traiter les statuts de livraison
          if (value.statuses) {
            for (const status of value.statuses) {
              const msgId = status.id || '';
              const statusName = status.status || ''; // sent, delivered, read, failed
              if (msgId && statusName) {
                await env.DB.prepare(
                  'UPDATE messages SET delivery_status = ? WHERE external_id = ?'
                )
                  .bind(statusName, msgId)
                  .run();
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('WhatsApp webhook processing error:', e);
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
