// ── email-builder.ts — Sprint 60 Constructeur de Courriels Drag-and-Drop ──
//
// CRUD pour la gestion de designs de courriels drag-and-drop (email_designs).
// Isolation complète multi-tenant basée sur le clientId de l'utilisateur.
// Pas de FOREIGN KEY D1 physiques (jointures applicatives).

import type { Env } from './types';
import { json, sanitizeInput, audit } from './helpers';

/**
 * Résout le client_id associé à l'utilisateur courant.
 */
async function resolveClientId(
  env: Env, 
  auth: { userId: string; role: string; clientId?: string }
): Promise<string | null> {
  if (auth.clientId) return auth.clientId;
  const user = (await env.DB.prepare('SELECT client_id FROM users WHERE id = ?')
    .bind(auth.userId)
    .first()) as { client_id: string } | null;
  return user?.client_id ?? null;
}

/**
 * Récupère la liste des designs de courriels pour le tenant courant.
 */
export async function handleGetEmailDesigns(
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client ID requis' }, 400);
    }

    const { results } = await env.DB.prepare(
      "SELECT id, name, subject, updated_at FROM email_designs WHERE client_id = ? ORDER BY updated_at DESC"
    )
      .bind(clientId)
      .all();

    return json({ data: results || [] });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/**
 * Récupère un design de courriel spécifique par son ID (avec contrôle d'accès).
 */
export async function handleGetEmailDesign(
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  designId: string
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client ID requis' }, 400);
    }

    const design = await env.DB.prepare(
      "SELECT * FROM email_designs WHERE id = ? AND client_id = ? LIMIT 1"
    )
      .bind(designId, clientId)
      .first();

    if (!design) {
      return json({ error: 'Design introuvable' }, 404);
    }

    return json({ data: design });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/**
 * Crée un nouveau design de courriel drag-and-drop.
 */
export async function handleCreateEmailDesign(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string }
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client ID requis' }, 400);
    }

    const body = (await request.json()) as {
      name?: string;
      subject?: string;
      html_content?: string;
      design_json?: string | Record<string, any>;
    };

    const name = sanitizeInput(body.name || '', 100).trim();
    const subject = sanitizeInput(body.subject || '', 200).trim();
    const htmlContent = body.html_content || '';
    
    let designJsonStr = '{}';
    if (body.design_json) {
      designJsonStr = typeof body.design_json === 'string' 
        ? body.design_json 
        : JSON.stringify(body.design_json);
    }

    if (!name) {
      return json({ error: 'Le nom du gabarit est requis' }, 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO email_designs (id, client_id, name, subject, html_content, design_json) 
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(id, clientId, name, subject, htmlContent, designJsonStr)
      .run();

    await audit(env, auth.userId, 'email_design.create', 'email_designs', id);

    return json({ data: { id, name, success: true } }, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/**
 * Met à jour un design de courriel drag-and-drop existant.
 */
export async function handleUpdateEmailDesign(
  request: Request,
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  designId: string
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client ID requis' }, 400);
    }

    // Vérifier l'existence et l'isolation
    const existing = await env.DB.prepare(
      "SELECT id FROM email_designs WHERE id = ? AND client_id = ? LIMIT 1"
    )
      .bind(designId, clientId)
      .first();

    if (!existing) {
      return json({ error: 'Design introuvable' }, 404);
    }

    const body = (await request.json()) as {
      name?: string;
      subject?: string;
      html_content?: string;
      design_json?: string | Record<string, any>;
    };

    const updates: string[] = [];
    const params: any[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(sanitizeInput(body.name || '', 100).trim());
    }
    if (body.subject !== undefined) {
      updates.push('subject = ?');
      params.push(sanitizeInput(body.subject || '', 200).trim());
    }
    if (body.html_content !== undefined) {
      updates.push('html_content = ?');
      params.push(body.html_content);
    }
    if (body.design_json !== undefined) {
      updates.push('design_json = ?');
      const designJsonStr = typeof body.design_json === 'string' 
        ? body.design_json 
        : JSON.stringify(body.design_json);
      params.push(designJsonStr);
    }

    if (updates.length === 0) {
      return json({ error: 'Aucun champ à modifier' }, 400);
    }

    updates.push("updated_at = datetime('now')");
    params.push(designId);
    params.push(clientId);

    await env.DB.prepare(
      `UPDATE email_designs SET ${updates.join(', ')} WHERE id = ? AND client_id = ?`
    )
      .bind(...params)
      .run();

    await audit(env, auth.userId, 'email_design.update', 'email_designs', designId);

    return json({ data: { success: true } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/**
 * Supprime un design de courriel drag-and-drop.
 */
export async function handleDeleteEmailDesign(
  env: Env,
  auth: { userId: string; role: string; clientId?: string },
  designId: string
): Promise<Response> {
  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client ID requis' }, 400);
    }

    const existing = await env.DB.prepare(
      "SELECT id FROM email_designs WHERE id = ? AND client_id = ? LIMIT 1"
    )
      .bind(designId, clientId)
      .first();

    if (!existing) {
      return json({ error: 'Design introuvable' }, 404);
    }

    await env.DB.prepare(
      "DELETE FROM email_designs WHERE id = ? AND client_id = ?"
    )
      .bind(designId, clientId)
      .run();

    await audit(env, auth.userId, 'email_design.delete', 'email_designs', designId);

    return json({ data: { success: true } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
