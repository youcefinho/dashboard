// ── portal.ts — LOT PORTAL-E (Sprint E) ─────────────────────────────────────
//
// Agrégateurs du PORTAIL CLIENT (factures / devis / RDV / documents / tickets
// du lead courant) + création de ticket + configuration PRO (portal_sites /
// portal_users). Auth portail = portal-auth.ts (table portal_sessions, 100%
// SÉPARÉE). Auth PRO = injectée au choke-point worker.ts (CapAuth +
// capabilities). Fichier NEUF et ISOLÉ.
//
// ⚠ CORPS RÉELS PHASE B — Manager-B SOLO sur ce fichier. Les signatures
//   (ordre/typage des params, forme de la Response) NE CHANGENT PAS :
//   worker.ts (GELÉ Phase A) câble déjà ces handlers ; src/lib/api.ts (GELÉ
//   Phase A) appelle les endpoints. Contrat §6 verbatim dans
//   docs/LOT-PORTAL-E.md.
//
// ⚠ ISOLATION DOUBLE (§6.C — Phase B) : CHAQUE agrégateur borne son SELECT
//   `WHERE lead_id = portal.leadId AND client_id = portal.clientId` — les DEUX
//   issus de la session (PortalContext), JAMAIS du body/query. Isolation
//   cross-lead ET cross-tenant. La création de ticket INSÈRE lead_id/client_id
//   DEPUIS la session, source = 'portal', timestamps unixepoch() (cohérence
//   support_tickets seq 89).
//
// ⚠ AUCUN PAIEMENT (E4) — handlePortalInvoices = LECTURE SEULE. Aucun champ
//   payment_url, aucun flux de règlement n'est exposé. handlePortalDocuments
//   expose le statut de signature (flux token existant), JAMAIS la mécanique.
//
// Conventions (docs/LOT-PORTAL-E.md §6.C/§6.I) :
//   - Réponses : json({ data }) succès / json({ error }, status) erreur.
//     JAMAIS de champ `code`.
//   - Config PRO : garde capability billing.view RÉUTILISÉE (déjà dans
//     ALL_CAPABILITIES — AUCUN ajout). Calque memberships.ts:membershipCapGuard
//     (workflows.manage) / booking-public.ts:capGuard.
//   - best-effort : table seq 101 absente → réponse propre (404 / {data:[]}),
//     JAMAIS de 500/throw non maîtrisé.

import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import { requireCapability, type CapAuth } from './capabilities';
import { hashPassword } from './crypto';
import type { PortalContext } from './portal-auth';

// Auth PRO enrichi au choke-point (worker.ts) — calque EXACT
// memberships.ts:MembershipAuth (CapAuth + capabilities injectées).
export type PortalAuth = CapAuth & { capabilities?: Set<string> };

// Garde capability config PRO (calque EXACT memberships.ts:membershipCapGuard).
// RÉUTILISE 'billing.view' (déjà dans ALL_CAPABILITIES — AUCUN ajout). En
// legacy/mono-tenant le set est LARGE ⇒ pas de régression ; bridage actif en
// mode agence.
export function portalCapGuard(auth: PortalAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'billing.view');
}

// ── Helpers config PRO (bornage tenant — calque EXACT memberships.ts) ─────────

// Bornage tenant sur une row porteuse de client_id/agency_id (calque EXACT
// memberships.ts:rowInTenant / booking-public.ts:rowInTenant).
//   - Legacy/mono-tenant (!tenant || agencyId == null) → true : endpoints
//     NEUFS, rétro-compat byte-équivalente à l'absence historique de borne.
//   - Mode agence (agencyId != null) → client_id ∈ accessibleClientIds OU
//     agency_id == auth.tenant.agencyId, sinon false.
function rowInTenant(
  row: { client_id?: unknown; agency_id?: unknown },
  auth: PortalAuth,
): boolean {
  const isLegacy = !auth.tenant || auth.tenant.agencyId == null;
  if (isLegacy) return true;
  const agencyId = auth.tenant!.agencyId as string;
  const accessible = auth.tenant!.accessibleClientIds || [];
  const rowClient = (row.client_id as string | null) ?? null;
  const rowAgency = (row.agency_id as string | null) ?? null;
  return (
    (rowClient != null && accessible.includes(rowClient)) ||
    (rowAgency != null && rowAgency === agencyId)
  );
}

// client_id / agency_id POSÉS depuis le tenant à la création (calque EXACT
// memberships.ts:tenantIds). Legacy → auth.clientId ; agence → tenant.
function tenantIds(auth: PortalAuth): {
  clientId: string | null;
  agencyId: string | null;
} {
  return {
    clientId: auth.tenant?.clientId ?? auth.clientId ?? null,
    agencyId: auth.tenant?.agencyId ?? null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PORTAIL CLIENT (auth portail — portal-auth.ts, table portal_sessions)
// ════════════════════════════════════════════════════════════════════════════
// État : IMPLÉMENTÉ — corps réels présents. Chaque agrégateur borne son
// SELECT WHERE lead_id = portal.leadId AND client_id = portal.clientId (les DEUX
// de la session — ISOLATION DOUBLE). Signatures FIGÉES.

// GET /api/portal/:slug/invoices — factures du lead courant. LECTURE SEULE
// (E4 jamais : la SELECT ne lit AUCUN champ de paiement — payment_url /
// stripe_invoice_id sont EXCLUS de la projection). Borné lead_id + client_id
// (§6.C, ISOLATION DOUBLE : les DEUX valeurs viennent de la session portail,
// JAMAIS du body/query). total = total ?? amount (fallback legacy seq 18).
export async function handlePortalInvoices(
  _request: Request,
  env: Env,
  _slug: string,
  portal: PortalContext,
): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, invoice_number, status, total, amount, currency,
              subtotal, tax_tps, tax_tvq, due_date, description, created_at
         FROM invoices
        WHERE lead_id = ? AND client_id = ?
        ORDER BY created_at DESC
        LIMIT 200`,
    )
      .bind(portal.leadId, portal.clientId)
      .all();
    // Projection LECTURE SEULE alignée sur api.ts:PortalInvoice. AUCUN
    // payment_url / stripe_invoice_id (E4 jamais).
    const data = (results || []).map((r) => {
      const row = r as Record<string, unknown>;
      const total = (row.total as number | null) ?? (row.amount as number | null) ?? null;
      return {
        id: row.id,
        number: (row.invoice_number as string | null) ?? null,
        status: (row.status as string | null) ?? null,
        total,
        currency: (row.currency as string | null) ?? null,
        subtotal: (row.subtotal as number | null) ?? null,
        tax_tps: (row.tax_tps as number | null) ?? null,
        tax_tvq: (row.tax_tvq as number | null) ?? null,
        issued_at: (row.created_at as string | null) ?? null,
        due_at: (row.due_date as string | null) ?? null,
        description: (row.description as string | null) ?? null,
      };
    });
    return json({ data });
  } catch {
    // Table/colonne absente : best-effort → liste vide, JAMAIS de 500.
    return json({ data: [] });
  }
}

// GET /api/portal/:slug/quotes — devis du lead courant. Borné lead_id +
// client_id (§6.C, ISOLATION DOUBLE, valeurs de session). LECTURE SEULE.
export async function handlePortalQuotes(
  _request: Request,
  env: Env,
  _slug: string,
  portal: PortalContext,
): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, quote_number, status, total, subtotal, tax_tps, tax_tvq,
              valid_until, description, created_at
         FROM quotes
        WHERE lead_id = ? AND client_id = ?
        ORDER BY created_at DESC
        LIMIT 200`,
    )
      .bind(portal.leadId, portal.clientId)
      .all();
    const data = (results || []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row.id,
        number: (row.quote_number as string | null) ?? null,
        status: (row.status as string | null) ?? null,
        total: (row.total as number | null) ?? null,
        subtotal: (row.subtotal as number | null) ?? null,
        tax_tps: (row.tax_tps as number | null) ?? null,
        tax_tvq: (row.tax_tvq as number | null) ?? null,
        valid_until: (row.valid_until as string | null) ?? null,
        description: (row.description as string | null) ?? null,
        created_at: (row.created_at as string | null) ?? null,
      };
    });
    return json({ data });
  } catch {
    return json({ data: [] });
  }
}

// GET /api/portal/:slug/appointments — rendez-vous du lead courant (à venir +
// passés). Borné lead_id + client_id (§6.C, ISOLATION DOUBLE, valeurs session).
export async function handlePortalAppointments(
  _request: Request,
  env: Env,
  _slug: string,
  portal: PortalContext,
): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, status, start_time, end_time, location, type
         FROM appointments
        WHERE lead_id = ? AND client_id = ?
        ORDER BY start_time DESC
        LIMIT 200`,
    )
      .bind(portal.leadId, portal.clientId)
      .all();
    const data = (results || []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: row.id,
        title: (row.title as string | null) ?? null,
        status: (row.status as string | null) ?? null,
        start_at: (row.start_time as string | null) ?? null,
        end_at: (row.end_time as string | null) ?? null,
        location: (row.location as string | null) ?? null,
        type: (row.type as string | null) ?? null,
      };
    });
    return json({ data });
  } catch {
    return json({ data: [] });
  }
}

// GET /api/portal/:slug/documents — documents du lead courant + statut de
// signature. On expose titre / statut / signed_at + le `token` du flux de
// signature EXISTANT (lien public /sign/:token déjà servi par
// handlePublicGetDocument/handlePublicSignDocument — la mécanique de signature
// n'est PAS dupliquée, on ne fait qu'EXPOSER le lien). JAMAIS body_html /
// signature_data / audit_trail. Borné lead_id + client_id (§6.C, ISOLATION
// DOUBLE, valeurs session).
export async function handlePortalDocuments(
  _request: Request,
  env: Env,
  _slug: string,
  portal: PortalContext,
): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, status, token, signed_at, sent_at, expires_at, created_at
         FROM documents
        WHERE lead_id = ? AND client_id = ?
        ORDER BY created_at DESC
        LIMIT 200`,
    )
      .bind(portal.leadId, portal.clientId)
      .all();
    const data = (results || []).map((r) => {
      const row = r as Record<string, unknown>;
      const status = (row.status as string | null) ?? null;
      const token = (row.token as string | null) ?? null;
      return {
        id: row.id,
        name: (row.title as string | null) ?? null,
        status,
        signed_at: (row.signed_at as string | null) ?? null,
        sent_at: (row.sent_at as string | null) ?? null,
        expires_at: (row.expires_at as string | null) ?? null,
        created_at: (row.created_at as string | null) ?? null,
        // Lien du flux de signature EXISTANT — uniquement tant que le document
        // est signable (sent/viewed). JAMAIS le contenu / la signature.
        sign_url:
          token && (status === 'sent' || status === 'viewed')
            ? `/sign/${token}`
            : null,
      };
    });
    return json({ data });
  } catch {
    return json({ data: [] });
  }
}

// GET /api/portal/:slug/tickets — tickets de support du lead courant + leurs
// messages PUBLICS (jamais les notes internes is_internal=1). Borné lead_id +
// client_id (§6.C, ISOLATION DOUBLE, valeurs session). Timestamps unixepoch
// (cohérence support_tickets seq 89).
export async function handlePortalTickets(
  _request: Request,
  env: Env,
  _slug: string,
  portal: PortalContext,
): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, subject, status, priority, last_message_at, created_at
         FROM support_tickets
        WHERE lead_id = ? AND client_id = ?
        ORDER BY last_message_at DESC
        LIMIT 200`,
    )
      .bind(portal.leadId, portal.clientId)
      .all();

    const data = [];
    for (const r of results || []) {
      const row = r as Record<string, unknown>;
      // Fil de messages PUBLICS uniquement (jamais is_internal=1). best-effort.
      let messages: unknown[] = [];
      try {
        const msgs = await env.DB.prepare(
          `SELECT id, direction, author_name, body, created_at
             FROM ticket_messages
            WHERE ticket_id = ? AND is_internal = 0
            ORDER BY created_at ASC`,
        )
          .bind(row.id as string)
          .all();
        messages = msgs.results || [];
      } catch {
        messages = [];
      }
      data.push({
        id: row.id,
        subject: (row.subject as string | null) ?? null,
        status: (row.status as string | null) ?? null,
        priority: (row.priority as string | null) ?? null,
        last_message_at: (row.last_message_at as number | null) ?? null,
        created_at: (row.created_at as number | null) ?? null,
        messages,
      });
    }
    return json({ data });
  } catch {
    return json({ data: [] });
  }
}

// POST /api/portal/:slug/tickets — création d'un ticket par le client.
// INSERT support_tickets borné lead_id/client_id DEPUIS la session (JAMAIS
// body/query — ISOLATION DOUBLE), source = 'portal', status 'ouvert',
// timestamps unixepoch() (cohérence support_tickets seq 89, calque
// tickets.ts:handlePublicSubmitTicket). best-effort : table absente →
// réponse propre, JAMAIS de 500. Signature FIGÉE.
export async function handlePortalCreateTicket(
  request: Request,
  env: Env,
  _slug: string,
  portal: PortalContext,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) as Record<string, unknown>) || {};
  } catch {
    body = {};
  }

  const subject = sanitizeInput((body.subject as string) || 'Demande', 200);
  const bodyText = sanitizeInput((body.body as string) || '', 5000);
  if (!bodyText) return json({ error: 'Message requis' }, 400);

  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000); // unixepoch (seq 89).

  try {
    // lead_id + client_id POSÉS DEPUIS LA SESSION (portal), jamais du body.
    // agency_id laissé NULL (le ticket est rattaché au tenant via client_id ;
    // calque tickets.ts:handlePublicSubmitTicket qui pose agency_id NULL).
    await env.DB.prepare(
      `INSERT INTO support_tickets
         (id, client_id, agency_id, lead_id, subject, body,
          status, priority, sla_level, sla_due_at, assigned_to, source,
          last_message_at, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'ouvert', 'normal', 'none', NULL, NULL, 'portal', ?, ?, ?)`,
    )
      .bind(
        id,
        portal.clientId,
        portal.leadId,
        subject,
        bodyText,
        createdAt,
        createdAt,
        createdAt,
      )
      .run();

    // 1er message du fil : direction 'inbound' (ouverture par le client).
    // best-effort : un échec ici n'invalide pas la création du ticket.
    try {
      await env.DB.prepare(
        `INSERT INTO ticket_messages
           (id, ticket_id, client_id, direction, author_id, author_name, body, is_internal, created_at)
         VALUES (?, ?, ?, 'inbound', NULL, NULL, ?, 0, ?)`,
      )
        .bind(crypto.randomUUID(), id, portal.clientId, bodyText, createdAt)
        .run();
    } catch {
      /* best-effort : message d'ouverture non bloquant */
    }

    return json({ data: { id } }, 201);
  } catch {
    // Table seq 89 absente / panne D1 : best-effort → réponse propre, pas de 500.
    return json({ error: 'Création impossible' }, 503);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIG PRO — portal-sites / portal-users (PROTÉGÉ 'billing.view')
// ════════════════════════════════════════════════════════════════════════════
// État : IMPLÉMENTÉ — corps réels présents. Garde capability billing.view
// (RÉUTILISÉE — AUCUN ajout à ALL_CAPABILITIES) + bornage tenant. Signatures
// FIGÉES (worker.ts les câble déjà).

// GET|POST /api/portal-sites — liste / création d'un portail (slug → tenant).
// Calque EXACT memberships.ts:handleMembershipSites. Garde billing.view +
// bornage tenant. Unicité du slug APPLICATIVE (zéro contrainte SQL — la table
// seq 101 n'a pas d'index UNIQUE). Corps réel Phase B Manager-B.
export async function handlePortalSites(
  request: Request,
  env: Env,
  auth: PortalAuth,
  _url: URL,
): Promise<Response> {
  const g = portalCapGuard(auth);
  if (g) return g;
  try {
    if (request.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = ((await request.json()) as Record<string, unknown>) || {};
      } catch {
        body = {};
      }
      const { clientId, agencyId } = tenantIds(auth);
      const id = crypto.randomUUID();
      const slug = String(body.slug || '').trim().slice(0, 120);
      const name = body.name ? String(body.name).slice(0, 200) : null;
      const isActive = body.is_active === false ? 0 : 1;
      if (!slug) return json({ error: 'slug requis' }, 400);

      // Unicité du slug APPLICATIVE (pas d'index UNIQUE seq 101) — le slug
      // résout le tenant côté login (resolvePortalSiteTenant), il doit donc
      // être globalement unique. best-effort : doublon → 409 propre.
      try {
        const dup = (await env.DB.prepare(
          'SELECT id FROM portal_sites WHERE slug = ? LIMIT 1',
        )
          .bind(slug)
          .first()) as { id: string } | null;
        if (dup) return json({ error: 'Ce slug est déjà utilisé' }, 409);
      } catch {
        /* table absente : laisse l'INSERT décider (best-effort) */
      }

      await env.DB.prepare(
        `INSERT INTO portal_sites (id, client_id, agency_id, slug, name, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, clientId, agencyId, slug, name, isActive)
        .run();
      return json({ data: { id } }, 201);
    }

    const { results } = await env.DB.prepare(
      'SELECT id, client_id, agency_id, slug, name, is_active, created_at FROM portal_sites ORDER BY created_at DESC',
    ).all();
    const rows = (results || []).filter((r) =>
      rowInTenant(r as Record<string, unknown>, auth),
    );
    return json({ data: rows });
  } catch {
    // best-effort : table seq 101 absente → liste vide (GET) ; pour POST le
    // catch racine renvoie aussi vide, mais l'INSERT échoue proprement avant.
    return json({ data: [] });
  }
}

// GET|POST /api/portal-users — liste / invitation d'un client (provisioning
// §6.A/Q5 : l'admin choisit un lead → crée portal_users + lien set-password).
// Garde billing.view + bornage tenant. ISOLATION : client_id/agency_id POSÉS
// DEPUIS LE TENANT (jamais du body) ; le lead_id du body est VALIDÉ comme
// appartenant au tenant avant insertion. password_hash JAMAIS exposé en
// lecture. Pas d'auto-création. Corps réel Phase B Manager-B.
export async function handlePortalUsers(
  request: Request,
  env: Env,
  auth: PortalAuth,
  _url: URL,
): Promise<Response> {
  const g = portalCapGuard(auth);
  if (g) return g;
  try {
    if (request.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = ((await request.json()) as Record<string, unknown>) || {};
      } catch {
        body = {};
      }

      const { clientId, agencyId } = tenantIds(auth);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
      const name = body.name ? String(body.name).slice(0, 200) : null;
      const leadId = body.lead_id ? String(body.lead_id).slice(0, 80) : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!email) return json({ error: 'email requis' }, 400);
      if (!leadId) return json({ error: 'lead_id requis' }, 400);

      // Le lead choisi DOIT appartenir au tenant (bornage : on relit la row
      // lead et on applique rowInTenant). Empêche d'agréger sur un lead d'un
      // autre tenant. best-effort : lead introuvable / hors tenant → 404.
      const lead = (await env.DB.prepare(
        'SELECT id, client_id FROM leads WHERE id = ? LIMIT 1',
      )
        .bind(leadId)
        .first()) as { id: string; client_id: string | null } | null;
      if (!lead || !rowInTenant({ client_id: lead.client_id }, auth)) {
        return json({ error: 'Lead introuvable' }, 404);
      }

      // Anti-doublon applicatif (tenant, email) — index idx_portal_users_email.
      const dup = (await env.DB.prepare(
        'SELECT id FROM portal_users WHERE client_id = ? AND email = ? LIMIT 1',
      )
        .bind(clientId, email)
        .first()) as { id: string } | null;
      if (dup) return json({ error: 'Cet email a déjà un accès portail' }, 409);

      const id = crypto.randomUUID();
      // password_hash NOT NULL (seq 101) : si l'admin fournit un mot de passe
      // on le hash (pbkdf2 crypto.ts RÉUTILISÉ) ; sinon on pose un placeholder
      // NON vérifiable ('!') → le client DOIT passer par set-password (qui
      // exige startsWith('pbkdf2$') au login). status 'pending' tant que pas
      // activé.
      const hasPassword = password.length >= 6;
      const passwordHash = hasPassword ? await hashPassword(password) : '!';
      const status = hasPassword ? 'active' : 'pending';

      await env.DB.prepare(
        `INSERT INTO portal_users
           (id, client_id, agency_id, email, password_hash, name, lead_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, clientId, agencyId, email, passwordHash, name, leadId, status)
        .run();

      // Lien set-password (le slug du portail est résolu par l'admin côté UI
      // via portal_sites du tenant — on retourne le chemin générique
      // /portal/:slug/ que l'UI assemble ; le flux set-password vit déjà dans
      // portal-auth.ts:handlePortalSetPassword). status renvoyé pour l'UI.
      return json(
        { data: { id, status, set_password_path: '/set-password' } },
        201,
      );
    }

    // GET : liste bornée tenant, password_hash JAMAIS projeté.
    const { results } = await env.DB.prepare(
      `SELECT id, client_id, agency_id, email, name, lead_id, status, created_at
         FROM portal_users ORDER BY created_at DESC`,
    ).all();
    const rows = (results || []).filter((r) =>
      rowInTenant(r as Record<string, unknown>, auth),
    );
    return json({ data: rows });
  } catch {
    return json({ data: [] });
  }
}
