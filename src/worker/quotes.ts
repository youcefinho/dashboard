// ── quotes.ts — LOT FACTURATION-RÉELLE — Phase B Manager-B (corps réels) ────
//
// Signatures FIGÉES Phase A (docs/LOT-INVOICE.md §6.D). Ce fichier appartient
// en exclusivité à Manager-B (§6.H). worker.ts / api.ts / migration seq 82 /
// 4 catalogues i18n / docs = GELÉS Phase A — non touchés ici.
//
// Contrat de retour GELÉ (apiFetch, §6.A) : succès = json({ data }) ;
//   erreur = json({ error: '<msg>' }, status). JAMAIS de champ `code`.
//
// Calcul taxes SERVEUR uniquement (§6.C, VERBATIM) :
//   line_total = round(qty * unit_price, 2)
//   subtotal   = round(Σ line_total, 2)
//   tax_tps    = round(subtotal * 0.05, 2)        // TPS 5 %
//   tax_tvq    = round(subtotal * 0.09975, 2)     // TVQ 9,975 %
//   total      = round(subtotal + tax_tps + tax_tvq, 2)
//   round(x,2) = Math.round(x * 100) / 100
//
// Numérotation §6.C : <PREFIX><YYYY>-<NNNN>, NNNN = 1 + COUNT(*) du même
//   scope tenant pour l'année courante, dans la même séquence logique que
//   l'INSERT (D1 sérialise les writes par worker ; pas d'index UNIQUE —
//   D1 ALTER-safe ; le n° est un libellé d'affichage, l'identité = id).
//
// Bornage tenant = calque EXACT team.ts handleGetUsers / clients-admin.ts
//   assertClientInTenant : legacy (!tenant || agencyId==null) ⇒ endpoint
//   NEUF byte-équivalent à l'absence historique de garde (pas de scope
//   élargi) ; mode agence ⇒ WHERE agency_id = ? (+ client_id ∈
//   accessibleClientIds). try/catch best-effort : table seq 82 absente ⇒
//   { data: [] } / 404 propre, JAMAIS de throw/500.
//
// Garde capability = capGuard(auth, 'invoices.write') mode-agence-only
//   (calque billing.ts:11-19 ; un devis est une pièce pré-comptable du même
//   domaine — §6.D). Posée sur les mutations create/update/accept ; lectures
//   list/get = pas de garde bloquante (bornage tenant suffit).

import { Resend } from 'resend';
import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { requireCapability, type Capability } from './capabilities';

// auth = CapAuth enrichi choke-point (worker.ts:605-607) :
//   { userId, role, clientId?, tenant?: TenantContext, capabilities?: Set }
type QuoteAuth = {
  userId: string;
  role: string;
  clientId?: string;
  tenant?: { agencyId?: string | null; accessibleClientIds?: string[] };
  capabilities?: Set<string>;
};

// ── Garde capability CONDITIONNELLE (mode-agence-only) ──────────────────────
// Calque byte-identique de billing.ts:11-19 (LOT B-bis). Legacy/mono-tenant/
// api-key/tests ⇒ condition FALSE ⇒ skip ⇒ comportement BYTE-IDENTIQUE.
function capGuard(
  auth: { tenant?: { agencyId?: string | null }; capabilities?: Set<string> },
  cap: Capability,
): Response | undefined {
  if (auth?.tenant?.agencyId != null && auth.capabilities) {
    return requireCapability(auth.capabilities, cap);
  }
  return undefined;
}

// Vrai si l'appel est legacy/mono-tenant (calque team.ts:isLegacy / §6.A).
function isLegacy(auth?: QuoteAuth): boolean {
  return !auth?.tenant || auth.tenant.agencyId == null;
}

// Arrondi monétaire 2 décimales (§6.C).
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// Ligne entrante normalisée.
type Line = { label: string; qty: number; unit_price: number; line_total: number };

// Normalise + calcule les lignes et les taxes SERVEUR (§6.C VERBATIM).
// Retourne null si aucune ligne valide.
function computeTotals(
  rawItems: unknown,
): { lines: Line[]; subtotal: number; tax_tps: number; tax_tvq: number; total: number } | null {
  if (!Array.isArray(rawItems)) return null;
  const lines: Line[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const label = sanitizeInput(String(o.label ?? ''), 300);
    const qty = Number(o.qty);
    const unit_price = Number(o.unit_price);
    if (!label || !isFinite(qty) || !isFinite(unit_price)) continue;
    const line_total = round2(qty * unit_price);
    lines.push({ label, qty, unit_price, line_total });
  }
  if (lines.length === 0) return null;
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const tax_tps = round2(subtotal * 0.05);
  const tax_tvq = round2(subtotal * 0.09975);
  const total = round2(subtotal + tax_tps + tax_tvq);
  return { lines, subtotal, tax_tps, tax_tvq, total };
}

// Génère <PREFIX><YYYY>-<NNNN> borné scope tenant pour l'année courante (§6.C).
// scopeCol/scopeVal = clé d'isolation (agency_id si mode agence, sinon
// client_id legacy). Même séquence logique que l'INSERT (appelé juste avant).
async function nextNumber(
  env: Env,
  table: 'invoices' | 'quotes',
  numberCol: 'invoice_number' | 'quote_number',
  prefix: string,
  scopeCol: 'agency_id' | 'client_id' | null,
  scopeVal: string | null,
): Promise<string> {
  const year = new Date().getFullYear();
  const like = `${prefix}${year}-%`;
  let count = 0;
  try {
    let sql = `SELECT COUNT(*) AS n FROM ${table} WHERE ${numberCol} LIKE ?`;
    const binds: unknown[] = [like];
    if (scopeCol && scopeVal != null) {
      sql += ` AND ${scopeCol} = ?`;
      binds.push(scopeVal);
    }
    const row = (await env.DB.prepare(sql).bind(...binds).first()) as { n: number } | null;
    count = Number(row?.n) || 0;
  } catch {
    // Colonne/table absente : on retombe sur le départ de série, propre.
    count = 0;
  }
  const nnnn = String(count + 1).padStart(4, '0');
  return `${prefix}${year}-${nnnn}`;
}

// ── POST /api/quotes — créer un devis (lignes + taxes SERVEUR §6.C) ─────────
export async function handleCreateQuote(
  request: Request,
  env: Env,
  auth: QuoteAuth,
): Promise<Response> {
  const cg = capGuard(auth, 'invoices.write');
  if (cg) return cg;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const totals = computeTotals(body.items);
  if (!totals) {
    return json({ error: 'Au moins une ligne est requise' }, 400);
  }

  const clientId = sanitizeInput(body.client_id as string, 100) || auth.clientId || null;
  const leadId = sanitizeInput(body.lead_id as string, 100) || null;
  const description = sanitizeInput(body.description as string, 500) || null;
  const validUntil = sanitizeInput(body.valid_until as string, 40) || null;
  const tpsNumber = sanitizeInput(body.tps_number as string, 60) || null;
  const tvqNumber = sanitizeInput(body.tvq_number as string, 60) || null;

  // Scope tenant : agency_id si mode agence (§6.C/§6.D), sinon client_id legacy.
  const agencyId = !isLegacy(auth) ? (auth.tenant!.agencyId as string) : null;

  try {
    const quoteNumber = await nextNumber(
      env,
      'quotes',
      'quote_number',
      'QUO-',
      agencyId != null ? 'agency_id' : 'client_id',
      agencyId != null ? agencyId : clientId,
    );

    const quoteId = `quo_${crypto.randomUUID()}`;

    await env.DB.prepare(
      `INSERT INTO quotes
         (id, client_id, lead_id, agency_id, quote_number, subtotal, tax_tps,
          tax_tvq, total, status, valid_until, tps_number, tvq_number,
          description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    )
      .bind(
        quoteId,
        clientId,
        leadId,
        agencyId,
        quoteNumber,
        totals.subtotal,
        totals.tax_tps,
        totals.tax_tvq,
        totals.total,
        validUntil,
        tpsNumber,
        tvqNumber,
        description,
      )
      .run();

    for (const l of totals.lines) {
      await env.DB.prepare(
        `INSERT INTO quote_items (quote_id, label, qty, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(quoteId, l.label, l.qty, l.unit_price, l.line_total)
        .run();
    }

    return json({ data: { id: quoteId, quote_number: quoteNumber } }, 201);
  } catch {
    // Table seq 82 absente / panne D1 : réponse propre, jamais de 500/throw.
    return json({ error: 'Impossible de créer le devis' }, 400);
  }
}

// ── GET /api/quotes — liste bornée tenant (pattern handleGetUsers §6.D) ─────
export async function handleListQuotes(
  _request: Request,
  env: Env,
  auth: QuoteAuth,
): Promise<Response> {
  // Legacy/mono-tenant : endpoint NEUF ⇒ byte-équivalent à l'absence
  // historique de garde (scope complet, pas de WHERE tenant supplémentaire).
  if (isLegacy(auth)) {
    try {
      const { results } = await env.DB.prepare(
        'SELECT * FROM quotes ORDER BY created_at DESC LIMIT 50',
      ).all();
      return json({ data: results || [] });
    } catch {
      return json({ data: [] });
    }
  }

  // Mode agence : isolation DURE. agency_id du tenant OU pièce rattachée à un
  // sous-compte accessible (client_id ∈ accessibleClientIds).
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const placeholders = accessible.map(() => '?').join(',');
  try {
    const sql = placeholders
      ? `SELECT * FROM quotes WHERE agency_id = ? OR client_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 50`
      : 'SELECT * FROM quotes WHERE agency_id = ? ORDER BY created_at DESC LIMIT 50';
    const { results } = await env.DB.prepare(sql)
      .bind(agencyId, ...accessible)
      .all();
    return json({ data: results || [] });
  } catch {
    return json({ data: [] });
  }
}

// Charge un devis borné tenant. Renvoie la row, ou null si introuvable/hors
// périmètre (calque assertClientInTenant : on confirme l'appartenance avant
// d'exposer quoi que ce soit).
async function loadQuoteScoped(
  env: Env,
  quoteId: string,
  auth: QuoteAuth,
): Promise<Record<string, unknown> | null> {
  let row: Record<string, unknown> | null = null;
  try {
    row = (await env.DB.prepare('SELECT * FROM quotes WHERE id = ?')
      .bind(quoteId)
      .first()) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  if (!row) return null;
  if (isLegacy(auth)) return row;

  // Mode agence : la pièce doit appartenir au périmètre.
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowAgency = row.agency_id == null ? null : String(row.agency_id);
  const rowClient = row.client_id == null ? null : String(row.client_id);
  const inTenant =
    (rowAgency != null && rowAgency === agencyId) ||
    (rowClient != null && accessible.includes(rowClient));
  return inTenant ? row : null;
}

// ── GET /api/quotes/:id — un devis + ses lignes (jointure applicative) ──────
export async function handleGetQuote(
  _request: Request,
  env: Env,
  auth: QuoteAuth,
  quoteId: string,
): Promise<Response> {
  const row = await loadQuoteScoped(env, quoteId, auth);
  if (!row) return json({ error: 'Devis introuvable' }, 404);

  let items: unknown[] = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY created_at ASC',
    )
      .bind(quoteId)
      .all();
    items = results || [];
  } catch {
    items = [];
  }
  return json({ data: { ...row, items } });
}

// ── PATCH /api/quotes/:id — statut et/ou contenu (recalc taxes serveur) ─────
export async function handleUpdateQuote(
  request: Request,
  env: Env,
  auth: QuoteAuth,
  quoteId: string,
): Promise<Response> {
  const cg = capGuard(auth, 'invoices.write');
  if (cg) return cg;

  const row = await loadQuoteScoped(env, quoteId, auth);
  if (!row) return json({ error: 'Devis introuvable' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = sanitizeInput(body.status as string, 20);
    if (!['draft', 'sent', 'accepted', 'declined', 'expired'].includes(status)) {
      return json({ error: 'Statut invalide' }, 400);
    }
    sets.push('status = ?');
    binds.push(status);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    sets.push('description = ?');
    binds.push(sanitizeInput(body.description as string, 500) || null);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'valid_until')) {
    sets.push('valid_until = ?');
    binds.push(sanitizeInput(body.valid_until as string, 40) || null);
  }

  // Items modifiés ⇒ recalcul taxes SERVEUR + remplacement des lignes (§6.C).
  let newLines: Line[] | null = null;
  if (Object.prototype.hasOwnProperty.call(body, 'items')) {
    const totals = computeTotals(body.items);
    if (!totals) {
      return json({ error: 'Au moins une ligne est requise' }, 400);
    }
    newLines = totals.lines;
    sets.push('subtotal = ?', 'tax_tps = ?', 'tax_tvq = ?', 'total = ?');
    binds.push(totals.subtotal, totals.tax_tps, totals.tax_tvq, totals.total);
  }

  if (sets.length === 0) {
    return json({ error: 'Aucun champ modifiable' }, 400);
  }

  sets.push("updated_at = datetime('now')");
  binds.push(quoteId);

  try {
    await env.DB.prepare(`UPDATE quotes SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();

    if (newLines) {
      // Remplacement intégral des lignes (jointure applicative, pas de FK).
      await env.DB.prepare('DELETE FROM quote_items WHERE quote_id = ?')
        .bind(quoteId)
        .run();
      for (const l of newLines) {
        await env.DB.prepare(
          `INSERT INTO quote_items (quote_id, label, qty, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(quoteId, l.label, l.qty, l.unit_price, l.line_total)
          .run();
      }
    }

    return json({ data: { success: true } });
  } catch {
    return json({ error: 'Devis introuvable' }, 404);
  }
}

// ── POST /api/quotes/:id/accept — devis accepté ⇒ facture liée (§6.F) ───────
export async function handleAcceptQuote(
  request: Request,
  env: Env,
  auth: QuoteAuth,
  quoteId: string,
): Promise<Response> {
  const cg = capGuard(auth, 'invoices.write');
  if (cg) return cg;

  // 1) Charger le devis borné tenant (§6.D).
  const quote = await loadQuoteScoped(env, quoteId, auth);
  if (!quote) return json({ error: 'Devis introuvable' }, 404);

  // 2) Refuser si déjà accepté/refusé/expiré (seuls draft/sent acceptables).
  const status = String(quote.status ?? '');
  if (status !== 'sent' && status !== 'draft') {
    return json({ error: 'Devis non acceptable (déjà traité)' }, 409);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const markLeadWon = body.mark_lead_won === true;

  // Lignes du devis → recalcul taxes SERVEUR (§6.F : ne PAS faire confiance
  // aux montants stockés du devis ; recalcul depuis les lignes).
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
  const totals = computeTotals(
    quoteItems.map((it) => ({ label: it.label, qty: it.qty, unit_price: it.unit_price })),
  );
  if (!totals) {
    return json({ error: 'Devis sans ligne — facture impossible' }, 400);
  }

  const clientId = quote.client_id == null ? null : String(quote.client_id);
  const leadId = quote.lead_id == null ? null : String(quote.lead_id);
  const agencyId = quote.agency_id == null ? null : String(quote.agency_id);
  const tpsNumber = quote.tps_number == null ? null : String(quote.tps_number);
  const tvqNumber = quote.tvq_number == null ? null : String(quote.tvq_number);
  const description = quote.description == null ? null : String(quote.description);

  try {
    // 3) INSERT facture liée. payment_url = NULL (§6.E, jamais d'URL Stripe).
    const invoiceNumber = await nextNumber(
      env,
      'invoices',
      'invoice_number',
      'INV-',
      agencyId != null ? 'agency_id' : 'client_id',
      agencyId != null ? agencyId : clientId,
    );
    const invoiceId = `inv_${crypto.randomUUID()}`;

    // NB : `invoices` n'a PAS de colonne agency_id (migration_p3_8.sql) ;
    // le bornage facture reste client_id-based (legacy, comme
    // handleGetInvoices/handleUpdateInvoiceStatus). Le scope de numérotation
    // utilise agency_id quand dispo via le COUNT borné, sans l'écrire ici.
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
        totals.total,
        description,
        invoiceNumber,
        totals.subtotal,
        totals.tax_tps,
        totals.tax_tvq,
        totals.total,
        quoteId,
        tpsNumber,
        tvqNumber,
      )
      .run();

    for (const l of totals.lines) {
      await env.DB.prepare(
        `INSERT INTO invoice_items (invoice_id, label, qty, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(invoiceId, l.label, l.qty, l.unit_price, l.line_total)
        .run();
    }

    // 4) UPDATE devis APRÈS l'INSERT facture (ordre §6.F : jamais un devis
    //    `accepted` sans invoice_id).
    await env.DB.prepare(
      `UPDATE quotes
          SET status = 'accepted', accepted_at = datetime('now'),
              invoice_id = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(invoiceId, quoteId)
      .run();

    // 5) Option lead → won (SEULE étape best-effort tolérée — §6.F : le
    //    succès facture prime ; pas de lead / colonne absente ⇒ on n'échoue
    //    PAS l'acceptation).
    if (markLeadWon && leadId) {
      try {
        await env.DB.prepare("UPDATE leads SET status = 'won' WHERE id = ?")
          .bind(leadId)
          .run();
      } catch {
        // best-effort : ignoré, l'acceptation reste un succès.
      }
    }

    // 6) Réponse.
    return json({ data: { invoice_id: invoiceId } });
  } catch {
    // Échec AVANT l'UPDATE devis (table seq 82 absente / panne D1) : le devis
    // n'a pas été muté ⇒ pas d'état incohérent.
    return json({ error: 'Acceptation du devis impossible' }, 400);
  }
}

// ── Sprint 17 PROPOSALS E-SIGN — POST /api/quotes/:id/send-for-signature ─────
// STUB Phase A — signature FIGÉE (docs/LOT-PROPOSALS-ESIGN.md §6.E/§6.H).
// Corps réel = Manager-B. Garde capGuard 'invoices.write' (mode-agence-only,
// calque create/update/accept). RÉUTILISE loadQuoteScoped (bornage tenant),
// quote_items/taxes, et la logique de documents.ts handleCreateDocument
// (token + expires + audit_trail) pour créer un document lié (quote_id), puis
// UPDATE quotes SET document_id=?, status='sent'. Renvoie { document_id,
// sign_url }. Réutilise handleSendDocument/handleSendSigningSms pour l'envoi.
export async function handleSendQuoteForSignature(
  request: Request,
  env: Env,
  auth: QuoteAuth,
  quoteId: string,
): Promise<Response> {
  const cg = capGuard(auth, 'invoices.write');
  if (cg) return cg;

  // 1) Charger le devis borné tenant (loadQuoteScoped) → 404 si introuvable.
  const quote = await loadQuoteScoped(env, quoteId, auth);
  if (!quote) return json({ error: 'Devis introuvable' }, 404);

  // 2) Charger les lignes du devis (jointure applicative par quote_id).
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

  // 3) Recalcul taxes SERVEUR (computeTotals) — JAMAIS les montants stockés.
  const totals = computeTotals(
    quoteItems.map((it) => ({ label: it.label, qty: it.qty, unit_price: it.unit_price })),
  );
  if (!totals) {
    return json({ error: 'Devis sans ligne — signature impossible' }, 400);
  }

  // 4) Rendu body_html = pricing table statique inline (calque visuel
  //    pdfExport kind:'quote'). NE PAS importer pdfExport côté worker.
  const bodyHtml = renderQuotePricingHtml(quote, totals);

  // 5) Créer le document lié via la logique de handleCreateDocument :
  //    token = crypto.randomUUID(), expires_at +30j, INSERT documents avec
  //    quote_id=quoteId, lead_id du devis si présent sinon NULL (NULLABLE).
  const docId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const leadId = quote.lead_id == null ? null : String(quote.lead_id);
  const clientId = quote.client_id == null ? null : String(quote.client_id);
  const title = `Devis ${quote.quote_number == null ? '' : String(quote.quote_number)}`.trim();

  try {
    await env.DB.prepare(
      `INSERT INTO documents (id, template_id, lead_id, client_id, title, body_html, token, expires_at, quote_id, created_by, status)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'sent')`,
    )
      .bind(
        docId,
        leadId,
        clientId,
        title || 'Devis',
        bodyHtml,
        token,
        expiresAt,
        quoteId,
        auth.userId,
      )
      .run();

    // 6) UPDATE quotes SET document_id=?, status='sent' ('sent' DANS le CHECK).
    await env.DB.prepare(
      `UPDATE quotes
          SET document_id = ?, status = 'sent', updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(docId, quoteId)
      .run();
  } catch {
    // Table seq 11/seq 117 absente / panne D1 : réponse propre, jamais 500 brut.
    return json({ error: "Impossible d'envoyer le devis pour signature" }, 400);
  }

  // 7) Option : expédier le lien par email (best-effort, calque handleSendDocument).
  //    On envoie au lead lié si email dispo. Échec d'envoi ⇒ on n'échoue PAS
  //    (le document est créé et signable via sign_url).
  if (env.RESEND_API_KEY && leadId) {
    try {
      const lead = (await env.DB.prepare('SELECT name, email FROM leads WHERE id = ?')
        .bind(leadId)
        .first()) as { name: string; email: string } | null;
      if (lead?.email) {
        const origin = new URL(request.url).origin;
        const signUrl = `${origin}/sign/${token}`;
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({
          from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com',
          to: [lead.email],
          subject: `Devis à signer : ${title || 'Devis'}`,
          html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #1a1a2e;">Devis à signer</h2>
              <p>Bonjour ${lead.name || ''},</p>
              <p>Veuillez consulter et signer votre devis : <strong>${title || 'Devis'}</strong></p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${signUrl}" style="background: #6366f1; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                  Consulter et signer
                </a>
              </p>
              <p style="color: #666; font-size: 12px;">Ce lien expire dans 30 jours.</p>
            </div>
          `,
        });
      }
    } catch {
      // best-effort : l'envoi email ne conditionne pas le succès.
    }
  }

  // 8) Réponse FIGÉE §6.A : { document_id, sign_url }.
  return json({ data: { document_id: docId, sign_url: `/sign/${token}` } });
}

// Échappement HTML minimal pour le rendu serveur de la pricing table.
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Formatte un montant en devise (calque visuel pdfExport kind:'quote').
function money(n: number): string {
  return `${round2(n).toFixed(2)} $`;
}

// Rend la pricing table statique inline du devis (1 <tr> par ligne label/qty/
// unit_price/line_total + sous-total + TPS + TVQ + total). Calque visuel
// pdfExport kind:'quote' — HTML inline, AUCUN import pdfExport côté worker.
function renderQuotePricingHtml(
  quote: Record<string, unknown>,
  totals: { lines: Line[]; subtotal: number; tax_tps: number; tax_tvq: number; total: number },
): string {
  const number = quote.quote_number == null ? '' : esc(quote.quote_number);
  const description = quote.description == null ? '' : esc(quote.description);
  const rows = totals.lines
    .map(
      (l) =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee;">${esc(l.label)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${esc(l.qty)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${money(l.unit_price)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${money(l.line_total)}</td>
        </tr>`,
    )
    .join('');
  return `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color:#1a1a2e;">
      <h1 style="border-bottom: 2px solid #333; padding-bottom: 10px;">Devis ${number}</h1>
      ${description ? `<p>${description}</p>` : ''}
      <table style="width:100%; border-collapse:collapse; margin-top:20px;">
        <thead>
          <tr style="background:#f5f5f7;">
            <th style="padding:8px;text-align:left;">Description</th>
            <th style="padding:8px;text-align:right;">Qté</th>
            <th style="padding:8px;text-align:right;">Prix unitaire</th>
            <th style="padding:8px;text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:8px;text-align:right;">Sous-total</td>
            <td style="padding:8px;text-align:right;">${money(totals.subtotal)}</td>
          </tr>
          <tr>
            <td colspan="3" style="padding:8px;text-align:right;">TPS (5 %)</td>
            <td style="padding:8px;text-align:right;">${money(totals.tax_tps)}</td>
          </tr>
          <tr>
            <td colspan="3" style="padding:8px;text-align:right;">TVQ (9,975 %)</td>
            <td style="padding:8px;text-align:right;">${money(totals.tax_tvq)}</td>
          </tr>
          <tr style="font-weight:bold;border-top:2px solid #333;">
            <td colspan="3" style="padding:8px;text-align:right;">Total</td>
            <td style="padding:8px;text-align:right;">${money(totals.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}
