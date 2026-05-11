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

  return json({ data: { success: true, signed_at: timestamp, document_hash: docHash } });
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
