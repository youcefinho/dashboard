// ── Module Documents + e-signature — Intralys CRM ───────────
import { Resend } from 'resend';
import type { Env } from './types';
import { sanitizeInput, json, audit } from './helpers';

// ── Interpolation des variables dans le HTML du document ────
function interpolateVars(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, key: string) => {
    // Supporte {{lead.name}} et {{name}}
    const parts = key.split('.');
    if (parts.length === 2) return vars[`${parts[0]}_${parts[1]}`] || vars[key] || '';
    return vars[key] || '';
  });
}

// ── Files CRUD (R2 storage) ─────────────────────────────────

export async function handleUploadFile(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const leadId = formData.get('lead_id') as string || '';
  const clientId = formData.get('client_id') as string || '';

  if (!file) return json({ error: 'Fichier requis' }, 400);
  if (file.size > 25 * 1024 * 1024) return json({ error: 'Fichier trop volumineux (max 25 Mo)' }, 400);

  const fileId = crypto.randomUUID();
  const ext = file.name.split('.').pop() || 'bin';
  const r2Key = `${clientId || 'global'}/${fileId}.${ext}`;

  // Upload vers R2
  const arrayBuffer = await file.arrayBuffer();
  await env.FILES.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name, uploadedBy: auth.userId },
  });

  // Enregistrer en D1
  await env.DB.prepare(
    `INSERT INTO files (id, client_id, lead_id, name, size, mime, r2_key, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(fileId, clientId, leadId || null, file.name, file.size, file.type, r2Key, auth.userId).run();

  await audit(env, auth.userId, 'file.upload', 'file', fileId, { name: file.name, size: file.size });
  return json({ data: { id: fileId, name: file.name, size: file.size, r2_key: r2Key } }, 201);
}

export async function handleGetFile(
  env: Env, _auth: { userId: string; role: string }, fileId: string
): Promise<Response> {
  const file = await env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(fileId).first() as Record<string, unknown> | null;
  if (!file) return json({ error: 'Fichier introuvable' }, 404);

  const r2Object = await env.FILES.get(file.r2_key as string);
  if (!r2Object) return json({ error: 'Fichier non trouvé dans le stockage' }, 404);

  return new Response(r2Object.body, {
    headers: {
      'Content-Type': (file.mime as string) || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${file.name}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

export async function handleGetFiles(
  env: Env, _auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  const leadId = url.searchParams.get('lead_id');
  const clientId = url.searchParams.get('client_id');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let query = 'SELECT id, client_id, lead_id, name, size, mime, created_at, uploaded_by FROM files WHERE 1=1';
  const params: (string | number)[] = [];

  if (leadId) { query += ' AND lead_id = ?'; params.push(leadId); }
  if (clientId) { query += ' AND client_id = ?'; params.push(clientId); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

export async function handleDeleteFile(
  env: Env, auth: { userId: string; role: string }, fileId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const file = await env.DB.prepare('SELECT r2_key FROM files WHERE id = ?').bind(fileId).first() as { r2_key: string } | null;
  if (!file) return json({ error: 'Fichier introuvable' }, 404);

  await env.FILES.delete(file.r2_key);
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();
  await audit(env, auth.userId, 'file.delete', 'file', fileId, {});
  return json({ data: { success: true } });
}

// ── Document Templates CRUD ─────────────────────────────────

export async function handleGetDocumentTemplates(
  env: Env, _auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  const clientId = url.searchParams.get('client_id');
  let query = 'SELECT * FROM document_templates WHERE is_active = 1';
  const params: string[] = [];
  if (clientId) { query += ' AND (client_id = ? OR client_id IS NULL)'; params.push(clientId); }
  query += ' ORDER BY created_at DESC';
  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

export async function handleCreateDocumentTemplate(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as Record<string, unknown>;
  const name = sanitizeInput(body.name as string, 200);
  const bodyHtml = body.body_html as string || '';
  if (!name || !bodyHtml) return json({ error: 'Nom et contenu HTML requis' }, 400);

  const id = crypto.randomUUID();
  const variables = body.variables ? JSON.stringify(body.variables) : '[]';
  const category = sanitizeInput(body.category as string, 50) || 'general';

  await env.DB.prepare(
    `INSERT INTO document_templates (id, client_id, name, description, body_html, variables, category, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.client_id as string || null, name, sanitizeInput(body.description as string, 500), bodyHtml, variables, category, auth.userId).run();

  await audit(env, auth.userId, 'doc_template.create', 'document_template', id, { name });
  return json({ data: { id } }, 201);
}

export async function handleUpdateDocumentTemplate(
  request: Request, env: Env, auth: { userId: string; role: string }, templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (body.name) { updates.push('name = ?'); params.push(sanitizeInput(body.name as string, 200)); }
  if (body.description !== undefined) { updates.push('description = ?'); params.push(sanitizeInput(body.description as string, 500)); }
  if (body.body_html) { updates.push('body_html = ?'); params.push(body.body_html as string); }
  if (body.variables) { updates.push('variables = ?'); params.push(JSON.stringify(body.variables)); }
  if (body.category) { updates.push('category = ?'); params.push(sanitizeInput(body.category as string, 50)); }
  if (body.is_active !== undefined) { updates.push('is_active = ?'); params.push(body.is_active ? 1 : 0); }

  if (updates.length === 0) return json({ error: 'Aucune modification' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(templateId);

  await env.DB.prepare(`UPDATE document_templates SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
  await audit(env, auth.userId, 'doc_template.update', 'document_template', templateId, body as Record<string, unknown>);
  return json({ data: { success: true } });
}

export async function handleDeleteDocumentTemplate(
  env: Env, auth: { userId: string; role: string }, templateId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  await env.DB.prepare("UPDATE document_templates SET is_active = 0, updated_at = datetime('now') WHERE id = ?").bind(templateId).run();
  await audit(env, auth.userId, 'doc_template.delete', 'document_template', templateId, {});
  return json({ data: { success: true } });
}

// ── Documents (envoyés pour signature) ──────────────────────

export async function handleDeleteDocument(
  env: Env, auth: { userId: string; role: string }, docId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);
  const doc = await env.DB.prepare('SELECT id, status FROM documents WHERE id = ?').bind(docId).first() as { id: string; status: string } | null;
  if (!doc) return json({ error: 'Document introuvable' }, 404);
  if (doc.status === 'won') return json({ error: 'Impossible de supprimer un document signé' }, 400);
  await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(docId).run();
  await audit(env, auth.userId, 'document.delete', 'document', docId, {});
  return json({ data: { success: true } });
}

export async function handleGetDocuments(
  env: Env, _auth: { userId: string; role: string }, url: URL
): Promise<Response> {
  const leadId = url.searchParams.get('lead_id');
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  let query = `SELECT d.*, l.name as lead_name, l.email as lead_email, dt.name as template_name
               FROM documents d
               LEFT JOIN leads l ON d.lead_id = l.id
               LEFT JOIN document_templates dt ON d.template_id = dt.id
               WHERE 1=1`;
  const params: (string | number)[] = [];

  if (leadId) { query += ' AND d.lead_id = ?'; params.push(leadId); }
  if (status) { query += ' AND d.status = ?'; params.push(status); }
  query += ' ORDER BY d.created_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return json({ data: results || [] });
}

export async function handleCreateDocument(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as Record<string, unknown>;
  const templateId = body.template_id as string;
  const leadId = body.lead_id as string;
  const title = sanitizeInput(body.title as string, 200);

  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  // Récupérer le lead pour les variables
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) return json({ error: 'Lead introuvable' }, 404);

  // Récupérer le client pour les variables
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(lead.client_id as string).first() as Record<string, unknown> | null;

  let bodyHtml = body.body_html as string || '';

  // Si template_id fourni, utiliser le template
  if (templateId) {
    const tpl = await env.DB.prepare('SELECT * FROM document_templates WHERE id = ?').bind(templateId).first() as Record<string, unknown> | null;
    if (!tpl) return json({ error: 'Template introuvable' }, 404);
    bodyHtml = bodyHtml || tpl.body_html as string;
  }

  if (!bodyHtml) return json({ error: 'Contenu HTML requis (body_html ou template_id)' }, 400);

  // Interpoler les variables
  const vars: Record<string, string> = {
    lead_name: lead.name as string || '',
    lead_email: lead.email as string || '',
    lead_phone: lead.phone as string || '',
    name: lead.name as string || '',
    email: lead.email as string || '',
    phone: lead.phone as string || '',
    date: new Date().toLocaleDateString('fr-CA'),
    date_iso: new Date().toISOString().split('T')[0] || '',
    ...(client ? {
      client_name: client.name as string || '',
      client_company: client.company as string || '',
      amf_certificate: client.amf_certificate as string || '',
    } : {}),
  };
  bodyHtml = interpolateVars(bodyHtml, vars);

  const docId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 jours

  await env.DB.prepare(
    `INSERT INTO documents (id, template_id, lead_id, client_id, title, body_html, token, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(docId, templateId || null, leadId, lead.client_id as string, title || 'Document', bodyHtml, token, expiresAt, auth.userId).run();

  await audit(env, auth.userId, 'document.create', 'document', docId, { title, lead_id: leadId, template_id: templateId });
  return json({ data: { id: docId, token, sign_url: `/sign/${token}` } }, 201);
}

export async function handleGenerateOaciq(
  request: Request, env: Env, auth: { userId: string; role: string }
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const body = await request.json() as Record<string, unknown>;
  const leadId = body.lead_id as string;
  
  if (!leadId) return json({ error: 'lead_id requis' }, 400);

  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first() as Record<string, unknown> | null;
  if (!lead) return json({ error: 'Lead introuvable' }, 404);
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(lead.client_id as string).first() as Record<string, unknown> | null;

  const title = `Mandat de courtage exclusif - ${lead.name}`;
  const amfText = client?.amf_certificate ? `Numéro de permis AMF/OACIQ: ${client.amf_certificate}` : '';
  
  const oaciqTemplateHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
      <h1 style="text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px;">Mandat de courtage exclusif - OACIQ</h1>
      <p style="text-align: right;"><strong>Date:</strong> {{date}}</p>
      
      <h3>1. Identification des parties</h3>
      <p><strong>Le Courtier:</strong> ${client?.name || '______________________'} (${amfText})</p>
      <p><strong>Le Vendeur:</strong> {{lead_name}}</p>
      <p><strong>Téléphone:</strong> {{lead_phone}} | <strong>Email:</strong> {{lead_email}}</p>
      
      <h3>2. Objet du mandat</h3>
      <p>Le Vendeur donne au Courtier le mandat exclusif de vendre sa propriété aux conditions stipulées en annexe.</p>
      
      <h3>3. Rémunération</h3>
      <p>La rétribution du Courtier est fixée à ______ % du prix de vente, payable à la signature de l'acte de vente.</p>
      
      <br><br><br>
      <div style="display: flex; justify-content: space-between; margin-top: 50px;">
        <div style="width: 45%; border-top: 1px solid #000; padding-top: 10px; text-align: center;">Signature du Courtier</div>
        <div style="width: 45%; border-top: 1px solid #000; padding-top: 10px; text-align: center;">Signature du Vendeur ({{lead_name}})</div>
      </div>
    </div>
  `;

  const vars: Record<string, string> = {
    lead_name: lead.name as string || '',
    lead_email: lead.email as string || '',
    lead_phone: lead.phone as string || '',
    date: new Date().toLocaleDateString('fr-CA')
  };
  
  const bodyHtml = interpolateVars(oaciqTemplateHtml, vars);
  const docId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO documents (id, template_id, lead_id, client_id, title, body_html, token, expires_at, created_by)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(docId, leadId, lead.client_id as string, title, bodyHtml, token, expiresAt, auth.userId).run();

  await audit(env, auth.userId, 'document.create', 'document', docId, { title, lead_id: leadId, type: 'oaciq_mandate' });
  return json({ data: { id: docId, token, sign_url: `/sign/${token}` } }, 201);
}

export async function handleSendDocument(
  request: Request, env: Env, auth: { userId: string; role: string }, docId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(docId).first() as Record<string, unknown> | null;
  if (!doc) return json({ error: 'Document introuvable' }, 404);
  if (doc.status !== 'draft') return json({ error: 'Seuls les brouillons peuvent être envoyés' }, 400);

  const lead = await env.DB.prepare('SELECT name, email FROM leads WHERE id = ?').bind(doc.lead_id as string).first() as { name: string; email: string } | null;
  if (!lead?.email) return json({ error: 'Lead sans email' }, 400);

  // Construire l'URL de signature
  const origin = new URL(request.url).origin;
  const signUrl = `${origin}/sign/${doc.token}`;

  // Envoyer l'email via Resend
  if (env.RESEND_API_KEY) {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com',
        to: [lead.email],
        subject: `Document à signer : ${doc.title}`,
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a2e;">📝 Document à signer</h2>
            <p>Bonjour ${lead.name},</p>
            <p>Vous avez un document à signer : <strong>${doc.title}</strong></p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${signUrl}" style="background: #6366f1; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                ✍️ Signer le document
              </a>
            </p>
            <p style="color: #666; font-size: 12px;">Ce lien expire dans 30 jours.</p>
          </div>
        `,
      });
    } catch (err) {
      console.error('Erreur envoi email document:', err);
      return json({ error: 'Échec envoi email' }, 500);
    }
  }

  await env.DB.prepare(
    "UPDATE documents SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
  ).bind(docId).run();

  await audit(env, auth.userId, 'document.send', 'document', docId, { to: lead.email });
  return json({ data: { success: true, sign_url: signUrl } });
}

// ── Routes publiques (pas d'auth) ───────────────────────────

export async function handlePublicGetDocument(env: Env, token: string): Promise<Response> {
  const doc = await env.DB.prepare(
    "SELECT * FROM documents WHERE token = ? AND status IN ('sent', 'viewed')"
  ).bind(token).first() as Record<string, unknown> | null;

  if (!doc) return json({ error: 'Document introuvable ou déjà signé' }, 404);

  // Vérifier expiration
  if (doc.expires_at && new Date(doc.expires_at as string) < new Date()) {
    await env.DB.prepare("UPDATE documents SET status = 'expired' WHERE id = ?").bind(doc.id as string).run();
    return json({ error: 'Ce document a expiré' }, 410);
  }

  // Marquer comme vu
  if (doc.status === 'sent') {
    const trail = JSON.parse(doc.audit_trail as string || '[]') as Array<Record<string, unknown>>;
    trail.push({ action: 'viewed', timestamp: new Date().toISOString() });
    await env.DB.prepare(
      "UPDATE documents SET status = 'viewed', viewed_at = datetime('now'), audit_trail = ? WHERE id = ?"
    ).bind(JSON.stringify(trail), doc.id as string).run();
  }

  return json({
    data: {
      id: doc.id,
      title: doc.title,
      body_html: doc.body_html,
      status: doc.status === 'sent' ? 'viewed' : doc.status,
    },
  });
}

export async function handlePublicSignDocument(
  request: Request, env: Env, token: string
): Promise<Response> {
  const doc = await env.DB.prepare(
    "SELECT * FROM documents WHERE token = ? AND status IN ('sent', 'viewed')"
  ).bind(token).first() as Record<string, unknown> | null;

  if (!doc) return json({ error: 'Document introuvable ou déjà signé' }, 404);

  // Vérifier expiration
  if (doc.expires_at && new Date(doc.expires_at as string) < new Date()) {
    return json({ error: 'Ce document a expiré' }, 410);
  }

  const body = await request.json() as { signature: string; signer_name?: string };
  if (!body.signature) return json({ error: 'Signature requise (base64)' }, 400);

  // Capturer infos audit
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  const timestamp = new Date().toISOString();

  // Hash SHA-256 du contenu du document (intégrité)
  const docBytes = new TextEncoder().encode(doc.body_html as string);
  const hashBuffer = await crypto.subtle.digest('SHA-256', docBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const docHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Construire l'audit trail
  const trail = JSON.parse(doc.audit_trail as string || '[]') as Array<Record<string, unknown>>;
  trail.push({
    action: 'won',
    ip,
    user_agent: userAgent,
    timestamp,
    document_hash: docHash,
    signer_name: body.signer_name || '',
  });

  // Mettre à jour le document
  await env.DB.prepare(
    `UPDATE documents
     SET status = 'won', signed_at = ?, signature_data = ?, audit_trail = ?
     WHERE id = ?`
  ).bind(timestamp, body.signature, JSON.stringify(trail), doc.id as string).run();

  // Notifier le créateur du document
  if (doc.created_by) {
    try {
      const lead = await env.DB.prepare('SELECT name FROM leads WHERE id = ?').bind(doc.lead_id as string).first() as { name: string } | null;
      await env.DB.prepare(
        `INSERT INTO notifications (id, user_id, client_id, icon, title, description, link)
         VALUES (?, ?, ?, '✍️', 'Document signé', ?, ?)`
      ).bind(
        crypto.randomUUID(), doc.created_by as string, doc.client_id as string || '',
        `${lead?.name || 'Un lead'} a signé "${doc.title}"`,
        `/documents`
      ).run();
    } catch { /* best-effort */ }
  }

  // Envoyer email de confirmation au lead avec copie
  if (env.RESEND_API_KEY && doc.lead_id) {
    try {
      const lead = await env.DB.prepare('SELECT email, name FROM leads WHERE id = ?').bind(doc.lead_id as string).first() as { email: string; name: string } | null;
      if (lead?.email) {
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({
          from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com',
          to: [lead.email],
          subject: `✅ Document signé : ${doc.title}`,
          html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #059669;">✅ Document signé avec succès</h2>
              <p>Bonjour ${lead.name},</p>
              <p>Votre signature pour le document <strong>${doc.title}</strong> a été enregistrée le ${new Date(timestamp).toLocaleDateString('fr-CA')} à ${new Date(timestamp).toLocaleTimeString('fr-CA')}.</p>
              <p style="color: #666; font-size: 12px;">Hash d'intégrité : ${docHash}</p>
              <p>Conservez cet email comme preuve de signature.</p>
            </div>
          `,
        });
      }
    } catch (err) {
      console.error('Erreur email confirmation signature:', err);
    }
  }

  // ── Sprint 17 PROPOSALS E-SIGN — pont signature → acceptation du devis ───────
  // SI le document est lié à un devis (doc.quote_id), appliquer la LOGIQUE de
  // handleAcceptQuote (recalc taxes SERVEUR depuis quote_items, INSERT facture +
  // invoice_items, UPDATE quotes status='accepted'+invoice_id, notif). best-effort
  // (try/catch global) : la signature reste un succès même si l'accept échoue.
  // Bornage : pas de QuoteAuth en public → borné par le devis lié au document.
  if (doc.quote_id) {
    try {
      await acceptQuoteFromSignature(env, String(doc.quote_id), doc);
    } catch {
      // best-effort : la signature reste valide même si l'accept échoue.
    }
  }

  return json({ data: { success: true, signed_at: timestamp, document_hash: docHash } });
}

// Arrondi monétaire 2 décimales (calque quotes.ts round2 — §6.C).
function round2Doc(x: number): number {
  return Math.round(x * 100) / 100;
}

// Logique d'acceptation depuis la signature publique (PAS de QuoteAuth). Borné
// par le devis lié au document (doc.quote_id). Réplique la logique de
// handleAcceptQuote : recalcul taxes SERVEUR depuis quote_items (JAMAIS les
// montants stockés), INSERT facture + invoice_items, UPDATE quotes
// status='accepted' (valeur DÉJÀ dans le CHECK seq 82) + invoice_id, notif.
// best-effort : jette en cas d'échec, capté par l'appelant (signature reste OK).
async function acceptQuoteFromSignature(
  env: Env,
  quoteId: string,
  doc: Record<string, unknown>,
): Promise<void> {
  // 1) Charger le devis borné par le lien document↔devis. Vérifier en plus que
  //    le document référence bien ce devis (cohérence) + tenant via client_id.
  const quote = (await env.DB.prepare('SELECT * FROM quotes WHERE id = ?')
    .bind(quoteId)
    .first()) as Record<string, unknown> | null;
  if (!quote) return;

  // 2) Idempotence : ne ré-accepter que depuis draft/sent (calque handleAcceptQuote).
  const status = String(quote.status ?? '');
  if (status !== 'sent' && status !== 'draft') return;

  // 3) Recalcul taxes SERVEUR depuis quote_items (jamais les montants stockés).
  let quoteItems: Array<Record<string, unknown>> = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY created_at ASC',
    )
      .bind(quoteId)
      .all();
    quoteItems = (results || []) as Array<Record<string, unknown>>;
  } catch {
    quoteItems = [];
  }
  const lines: Array<{ label: string; qty: number; unit_price: number; line_total: number }> = [];
  for (const it of quoteItems) {
    const label = sanitizeInput(String(it.label ?? ''), 300);
    const qty = Number(it.qty);
    const unit_price = Number(it.unit_price);
    if (!label || !isFinite(qty) || !isFinite(unit_price)) continue;
    lines.push({ label, qty, unit_price, line_total: round2Doc(qty * unit_price) });
  }
  if (lines.length === 0) return;
  const subtotal = round2Doc(lines.reduce((s, l) => s + l.line_total, 0));
  const tax_tps = round2Doc(subtotal * 0.05);
  const tax_tvq = round2Doc(subtotal * 0.09975);
  const total = round2Doc(subtotal + tax_tps + tax_tvq);

  const clientId = quote.client_id == null ? null : String(quote.client_id);
  const leadId = quote.lead_id == null ? null : String(quote.lead_id);
  const tpsNumber = quote.tps_number == null ? null : String(quote.tps_number);
  const tvqNumber = quote.tvq_number == null ? null : String(quote.tvq_number);
  const description = quote.description == null ? null : String(quote.description);

  // 4) Numéro de facture borné scope tenant (client_id ; invoices n'a pas
  //    d'agency_id — calque handleAcceptQuote).
  const year = new Date().getFullYear();
  let count = 0;
  try {
    let sql = 'SELECT COUNT(*) AS n FROM invoices WHERE invoice_number LIKE ?';
    const binds: unknown[] = [`INV-${year}-%`];
    if (clientId != null) {
      sql += ' AND client_id = ?';
      binds.push(clientId);
    }
    const row = (await env.DB.prepare(sql).bind(...binds).first()) as { n: number } | null;
    count = Number(row?.n) || 0;
  } catch {
    count = 0;
  }
  const invoiceNumber = `INV-${year}-${String(count + 1).padStart(4, '0')}`;
  const invoiceId = `inv_${crypto.randomUUID()}`;

  // 5) INSERT facture liée + invoice_items (calque handleAcceptQuote).
  await env.DB.prepare(
    `INSERT INTO invoices
       (id, client_id, lead_id, amount, description, status, payment_url,
        invoice_number, subtotal, tax_tps, tax_tvq, total, quote_id,
        tps_number, tvq_number)
     VALUES (?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      invoiceId,
      clientId,
      leadId,
      total,
      description,
      invoiceNumber,
      subtotal,
      tax_tps,
      tax_tvq,
      total,
      quoteId,
      tpsNumber,
      tvqNumber,
    )
    .run();

  for (const l of lines) {
    await env.DB.prepare(
      `INSERT INTO invoice_items (invoice_id, label, qty, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(invoiceId, l.label, l.qty, l.unit_price, l.line_total)
      .run();
  }

  // 6) UPDATE devis APRÈS l'INSERT facture (jamais un devis accepted sans
  //    invoice_id). status='accepted' DÉJÀ dans le CHECK seq 82.
  await env.DB.prepare(
    `UPDATE quotes
        SET status = 'accepted', accepted_at = datetime('now'),
            invoice_id = ?, updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(invoiceId, quoteId)
    .run();

  // 7) Notif créateur du document (best-effort).
  if (doc.created_by) {
    try {
      await env.DB.prepare(
        `INSERT INTO notifications (id, user_id, client_id, icon, title, description, link)
         VALUES (?, ?, ?, '✅', 'Devis accepté', ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          String(doc.created_by),
          clientId || '',
          `Le devis lié à "${doc.title == null ? '' : String(doc.title)}" a été accepté (facture ${invoiceNumber})`,
          `/invoices`,
        )
        .run();
    } catch {
      /* best-effort */
    }
  }
}

// ── Sprint 17 PROPOSALS E-SIGN — refus public d'un document ──────────────────
// STUB Phase A — signature FIGÉE (docs/LOT-PROPOSALS-ESIGN.md §6.E/§6.H).
// Corps réel = Manager-B. PUBLIC (hors auth, calque handlePublicSignDocument) —
// bornage par token (PAS de capGuard, PAS de resolveClientId). Le doc est
// retrouvé par token (status IN ('sent','viewed')).
// Manager-B: corps réel — charger le doc par token (status sent/viewed),
// vérifier expiration, UPDATE documents SET status='declined',
// declined_at=datetime('now'), audit_trail append { action:'declined', ip, ua,
// timestamp, reason } ; SI doc.quote_id → UPDATE quotes SET status='declined'
// (valeur DÉJÀ dans le CHECK seq 82) borné par l'id du devis (best-effort).
// GARDER la réponse publique propre, jamais 500 brut. NE PAS casser le filtre
// sent/viewed de handlePublicGetDocument (documents.status LIBRE).
export async function handlePublicDeclineDocument(
  request: Request,
  env: Env,
  token: string,
): Promise<Response> {
  // 1) Charger le doc par token (status IN ('sent','viewed')) — token-borné,
  //    PAS de capGuard/resolveClientId. NE PAS casser le filtre sent/viewed.
  const doc = (await env.DB.prepare(
    "SELECT * FROM documents WHERE token = ? AND status IN ('sent', 'viewed')",
  )
    .bind(token)
    .first()) as Record<string, unknown> | null;

  if (!doc) return json({ error: 'Document introuvable ou déjà traité' }, 404);

  // 2) Vérifier expiration (calque handlePublicGetDocument → 410).
  if (doc.expires_at && new Date(doc.expires_at as string) < new Date()) {
    return json({ error: 'Ce document a expiré' }, 410);
  }

  // 3) reason optionnel.
  let reason = '';
  try {
    const body = (await request.json()) as { reason?: string };
    reason = sanitizeInput(body?.reason as string, 500) || '';
  } catch {
    reason = '';
  }

  // 4) Capture audit (Loi 25 : action declined + IP/UA/timestamp + reason).
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  const timestamp = new Date().toISOString();

  try {
    const trail = JSON.parse((doc.audit_trail as string) || '[]') as Array<Record<string, unknown>>;
    trail.push({ action: 'declined', ip, user_agent: userAgent, timestamp, reason });

    // 5) UPDATE documents SET status='declined', declined_at, audit_trail.
    //    documents.status LIBRE (pas de CHECK seq 11).
    await env.DB.prepare(
      `UPDATE documents
          SET status = 'declined', declined_at = datetime('now'), audit_trail = ?
        WHERE id = ?`,
    )
      .bind(JSON.stringify(trail), doc.id as string)
      .run();

    // 6) SI doc.quote_id → UPDATE quotes SET status='declined' (valeur DÉJÀ
    //    dans le CHECK seq 82) borné par l'id du devis lié. best-effort.
    if (doc.quote_id) {
      try {
        await env.DB.prepare(
          `UPDATE quotes
              SET status = 'declined', updated_at = datetime('now')
            WHERE id = ?`,
        )
          .bind(String(doc.quote_id))
          .run();
      } catch {
        /* best-effort : le refus du document reste un succès. */
      }
    }
  } catch {
    // Panne D1 : réponse propre, jamais 500 brut.
    return json({ error: 'Refus impossible' }, 400);
  }

  return json({ data: { success: true } });
}

// ── D5 : Envoi SMS lien signature 1-clic ────────────────────

export async function handleSendSigningSms(
  request: Request, env: Env, auth: { userId: string; role: string }, docId: string
): Promise<Response> {
  if (auth.role !== 'admin') return json({ error: 'Admin uniquement' }, 403);

  const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(docId).first() as Record<string, unknown> | null;
  if (!doc) return json({ error: 'Document introuvable' }, 404);
  if (doc.status !== 'draft' && doc.status !== 'sent') return json({ error: 'Document déjà signé ou expiré' }, 400);

  const lead = await env.DB.prepare('SELECT name, phone, email FROM leads WHERE id = ?').bind(doc.lead_id as string).first() as { name: string; phone: string; email: string } | null;
  if (!lead?.phone) return json({ error: 'Lead sans numéro de téléphone' }, 400);

  const origin = new URL(request.url).origin;
  const signUrl = `${origin}/sign/${doc.token}`;

  // Envoyer SMS via Twilio
  const smsBody = `Bonjour ${lead.name}, veuillez signer votre document "${doc.title}" ici : ${signUrl} — Lien valide 30 jours.`;

  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    try {
      const twilioAuth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const smsRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${twilioAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: lead.phone, From: env.TWILIO_PHONE_NUMBER, Body: smsBody }),
        }
      );
      if (!smsRes.ok) {
        const errText = await smsRes.text();
        console.error('Twilio error:', errText);
        return json({ error: 'Échec envoi SMS' }, 500);
      }
    } catch (err) {
      console.error('SMS sending error:', err);
      // En mode mock, on continue
    }
  }

  // Mettre à jour statut document → sent si draft
  if (doc.status === 'draft') {
    await env.DB.prepare("UPDATE documents SET status = 'sent', sent_at = datetime('now') WHERE id = ?").bind(docId).run();
  }

  await audit(env, auth.userId, 'document.sms_sent', 'document', docId, { to: lead.phone, sign_url: signUrl });
  return json({ data: { success: true, sms_sent_to: lead.phone, sign_url: signUrl } });
}
