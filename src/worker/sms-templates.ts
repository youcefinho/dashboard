// ── sms-templates.ts — LOT SMS/WHATSAPP seq 104 (Manager-A, Phase A) ────────
//
// CRUD des modèles de SMS réutilisables (table sms_templates seq 104). MODULE
// NEUF. Calque EXACT du modèle telephony.ts (CRUD + bornage tenant + flag).
//
// Conventions (docs/LOT-SMS-WHATSAPP.md §6) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur. JAMAIS
//     de champ `code` (apiFetch / ApiResponse GELÉS).
//   - Garde capability : requireCapability(auth.capabilities, 'settings.manage')
//     (réutilisée seq 80 — AUCUN ajout à ALL_CAPABILITIES).
//   - Bornage tenant : resolveClientId (calque telephony.ts:185 / conversations.ts:27)
//     — admin non borné (null) ; sinon users.client_id. client_id JAMAIS body.
//   - best-effort : table seq 104 absente → réponse propre ({data:[]}/500 propre),
//     JAMAIS de throw non maîtrisé.
//
// Imports RELATIFS uniquement — PAS d'alias @/ (tsconfig.worker.json).
//
// ⚠ OWNERSHIP (§6.H) : ce fichier est EXCLUSIF à Manager-B en Phase B (corps déjà
//   fonctionnels ici — Manager-B peut enrichir, signatures FIGÉES). Manager-C
//   NE LE TOUCHE PAS.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';

// Auth enrichi au choke-point worker.ts (calque telephony.ts:69).
type SmsTemplateAuth = CapAuth & { capabilities?: Set<string> };

// Résout le client_id du tenant courant (calque telephony.ts:185). admin =
// non borné (null) ; sinon users.client_id.
async function resolveClientId(env: Env, auth: SmsTemplateAuth): Promise<string | null> {
  if (auth.role === 'admin') return null;
  if (auth.clientId) return auth.clientId;
  const user = (await env.DB.prepare('SELECT client_id FROM users WHERE id = ?')
    .bind(auth.userId)
    .first()) as { client_id: string } | null;
  return user?.client_id ?? null;
}

// ── GET /api/sms-templates — liste bornée tenant ────────────────────────────
export async function handleListSmsTemplates(
  env: Env,
  auth: SmsTemplateAuth,
  _url: URL,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    let sql = 'SELECT * FROM sms_templates WHERE 1=1';
    const binds: (string | number)[] = [];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    sql += ' ORDER BY created_at DESC';
    const res = await env.DB.prepare(sql).bind(...binds).all();
    return json({ data: res.results ?? [] });
  } catch {
    // Table seq 104 absente : best-effort.
    return json({ data: [] });
  }
}

// ── POST /api/sms-templates — création (client_id posé serveur) ─────────────
export async function handleCreateSmsTemplate(
  request: Request,
  env: Env,
  auth: SmsTemplateAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  let body: { name?: string; body?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps invalide' }, 400);
  }

  const name = sanitizeInput(body.name, 120);
  const smsBody = sanitizeInput(body.body, 1600);
  if (!name || !smsBody) return json({ error: 'Nom et corps requis' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO sms_templates (id, client_id, name, body) VALUES (?, ?, ?, ?)',
    )
      .bind(id, clientId, name, smsBody)
      .run();
    return json({ data: { id, success: true } });
  } catch {
    return json({ error: 'Échec création modèle SMS' }, 500);
  }
}

// ── PUT /api/sms-templates/:id — mise à jour bornée tenant ──────────────────
export async function handleUpdateSmsTemplate(
  request: Request,
  env: Env,
  auth: SmsTemplateAuth,
  templateId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  let body: { name?: string; body?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Corps invalide' }, 400);
  }

  const name = sanitizeInput(body.name, 120);
  const smsBody = sanitizeInput(body.body, 1600);
  if (!name || !smsBody) return json({ error: 'Nom et corps requis' }, 400);

  try {
    const clientId = await resolveClientId(env, auth);
    let sql = 'UPDATE sms_templates SET name = ?, body = ? WHERE id = ?';
    const binds: (string | number)[] = [name, smsBody, sanitizeInput(templateId, 64)];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    await env.DB.prepare(sql).bind(...binds).run();
    return json({ data: { id: templateId, success: true } });
  } catch {
    return json({ error: 'Échec mise à jour modèle SMS' }, 500);
  }
}

// ── DELETE /api/sms-templates/:id — suppression bornée tenant ───────────────
export async function handleDeleteSmsTemplate(
  env: Env,
  auth: SmsTemplateAuth,
  templateId: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    let sql = 'DELETE FROM sms_templates WHERE id = ?';
    const binds: (string | number)[] = [sanitizeInput(templateId, 64)];
    if (clientId) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    await env.DB.prepare(sql).bind(...binds).run();
    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Échec suppression modèle SMS' }, 500);
  }
}
