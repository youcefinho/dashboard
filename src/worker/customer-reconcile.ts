// ── Réconciliation customer ↔ lead — Sprint E1 M3.2 (2026-05-16) ─────────────
//
// Lien faible bidirectionnel entre un client boutique (customers) et un lead
// CRM (leads) du même tenant. Réutilise la stratégie de dédoublonnage unifiée
// de Sprint 51 (src/worker/lead-dedup.ts) — on NE duplique PAS la logique
// email/phone : on appelle resolveDedup en mode 'email_phone'.
//
// La colonne customers.lead_id existe déjà (migration M1, FK leads ON DELETE
// SET NULL) — aucune migration ici.
//
// Best-effort : la réconciliation enrichit, elle n'est jamais bloquante. Les
// appelants (cf. handleCreateCustomer) doivent l'envelopper en try/catch.

import type { Env } from './types';
import { resolveDedup } from './lead-dedup';

interface CustomerLike {
  id: string;
  email: string;
  phone: string | null;
}

/**
 * Cherche un lead existant du même client correspondant au customer (email
 * puis phone, via la logique S51) et, si match, renseigne customers.lead_id.
 *
 * Retourne l'id du lead lié (ou null si aucun match / déjà lié).
 * N'écrase jamais un lead_id déjà présent (lien stable).
 */
export async function reconcileCustomerWithLead(
  env: Env,
  clientId: string,
  customer: CustomerLike,
): Promise<string | null> {
  if (!customer.email && !customer.phone) return null;

  // Si déjà lié, on ne touche à rien (lien stable, idempotent).
  const existing = (await env.DB.prepare(
    'SELECT lead_id FROM customers WHERE id = ? AND client_id = ?',
  ).bind(customer.id, clientId).first()) as { lead_id: string | null } | null;
  if (existing?.lead_id) return existing.lead_id;

  // Réutilise la stratégie de dédoublonnage S51 (email OU phone, scope client).
  // 'create' = aucun lead correspondant → rien à réconcilier.
  const decision = await resolveDedup(env, 'email_phone', {
    clientId,
    email: customer.email || '',
    phone: customer.phone || '',
  });

  if (decision.action === 'create' || !decision.existingId) return null;

  await env.DB.prepare(
    "UPDATE customers SET lead_id = ?, updated_at = datetime('now') WHERE id = ? AND client_id = ?",
  ).bind(decision.existingId, customer.id, clientId).run();

  return decision.existingId;
}

/**
 * Helper bidirectionnel : le customer boutique lié à un lead (ou null).
 * Utilisé par LeadDetail pour afficher l'encart « Compte boutique lié ».
 */
export async function getLinkedCustomerForLead(
  env: Env,
  leadId: string,
): Promise<{ id: string; email: string; first_name: string; last_name: string } | null> {
  const row = (await env.DB.prepare(
    `SELECT id, email, first_name, last_name
       FROM customers WHERE lead_id = ? LIMIT 1`,
  ).bind(leadId).first()) as
    | { id: string; email: string; first_name: string; last_name: string }
    | null;
  return row || null;
}

/**
 * Helper bidirectionnel : le lead CRM lié à un customer (ou null).
 * Utilisé par la fiche client boutique (Customer 360) pour le lien « Lien CRM ».
 */
export async function getLinkedLeadForCustomer(
  env: Env,
  customerId: string,
): Promise<{ id: string; name: string; email: string } | null> {
  const cust = (await env.DB.prepare(
    'SELECT lead_id FROM customers WHERE id = ?',
  ).bind(customerId).first()) as { lead_id: string | null } | null;
  if (!cust?.lead_id) return null;

  const lead = (await env.DB.prepare(
    'SELECT id, name, email FROM leads WHERE id = ? AND deleted_at IS NULL',
  ).bind(cust.lead_id).first()) as { id: string; name: string; email: string } | null;
  return lead || null;
}
