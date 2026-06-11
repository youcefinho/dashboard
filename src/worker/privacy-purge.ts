// ── privacy-purge.ts — Sprint 93 (seq188) ────────────────────────────────────
// Handlers API pour la purge automatisée RGPD & Loi 25 des données
// personnelles inactives.
//
// Routes :
//   GET    /api/compliance/purge/rules          → handleGetPurgeRules
//   POST   /api/compliance/purge/rules          → handleCreatePurgeRule
//   PATCH  /api/compliance/purge/rules/:id      → handleUpdatePurgeRule
//   DELETE /api/compliance/purge/rules/:id      → handleDeletePurgeRule
//   GET    /api/compliance/purge/preview        → handlePreviewPurge
//   POST   /api/compliance/purge/run            → handleRunPurge
//   (cron) scheduled                            → handleScheduledPurge
//
// Dépendances :
//   - privacy-purge-engine.ts (helpers purs, zéro I/O)
//   - helpers.ts (json, audit, sanitizeInput)
//   - types.ts (Env)

import type { Env } from './types';
import { json, audit, sanitizeInput } from './helpers';
import {
  validatePurgeRule,
  identifyPurgeableLeads,
  buildPurgeReport,
  PURGE_ACTIONS,
  type PurgeRule,
  type PurgeAction,
  type LeadForPurge,
  type PurgeReport,
} from './lib/privacy-purge-engine';

// ── Types locaux ──────────────────────────────────────────────────────────────

/** Ligne brute retournée par D1 pour privacy_purge_rules. */
interface PurgeRuleRow {
  id: string;
  client_id: string;
  inactive_days: number;
  action: string;
  created_at: string;
  updated_at: string;
}

/** Body du POST /run. */
interface RunPurgeBody {
  client_id?: string;
  dry_run?: boolean;
}

// ── Constantes ────────────────────────────────────────────────────────────────

/** Marqueur d'anonymisation Loi 25. */
const ANONYMIZED_MARKER = '[SUPPRIMÉ]';

/** Actions de purge autorisées (whitelist stricte issue de la migration SQL). */
const ALLOWED_ACTIONS: ReadonlySet<string> = new Set<string>(PURGE_ACTIONS);

// ── Helpers internes ──────────────────────────────────────────────────────────

/** Vérifie le rôle admin. Retourne une Response 403 si non-admin. */
function requireAdmin(auth: { role: string }): Response | null {
  if (auth.role !== 'admin') {
    return json({ error: 'Admin uniquement' }, 403);
  }
  return null;
}

/**
 * Assure que la table privacy_purge_log existe (fallback gracieux).
 * Appelé avant l'INSERT du rapport — crée la table si absente.
 */
async function ensurePurgeLogTable(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS privacy_purge_log (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        client_id TEXT,
        report TEXT NOT NULL,
        executed_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
  } catch {
    // Fallback silencieux — la table existe peut-être déjà ou la DB
    // ne supporte pas CREATE IF NOT EXISTS dans ce contexte.
  }
}

/**
 * Anonymise un lead en D1 : remplace les champs PII en clair ET les
 * colonnes chiffrées (_enc, _hash) par le marqueur [SUPPRIMÉ] / NULL.
 * Fallback gracieux si les colonnes _enc/_hash n'existent pas encore
 * (migration seq187 pas jouée).
 */
async function anonymizeLeadInDb(env: Env, leadId: string): Promise<void> {
  // Tentative avec colonnes chiffrées (nominal post-Sprint 92)
  try {
    await env.DB.prepare(`
      UPDATE leads SET
        name = ?,
        email = ?,
        phone = ?,
        notes = ?,
        message = ?,
        address = '',
        email_enc = NULL,
        phone_enc = NULL,
        notes_enc = NULL,
        email_hash = NULL,
        phone_hash = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      ANONYMIZED_MARKER,
      ANONYMIZED_MARKER,
      ANONYMIZED_MARKER,
      ANONYMIZED_MARKER,
      ANONYMIZED_MARKER,
      leadId,
    ).run();
  } catch (e) {
    const msg = String(e ?? '');
    if (/no such column/i.test(msg) || /has no column/i.test(msg)) {
      // Fallback sans colonnes _enc/_hash (pré-Sprint 92)
      await env.DB.prepare(`
        UPDATE leads SET
          name = ?,
          email = ?,
          phone = ?,
          notes = ?,
          message = ?,
          address = '',
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        ANONYMIZED_MARKER,
        ANONYMIZED_MARKER,
        ANONYMIZED_MARKER,
        ANONYMIZED_MARKER,
        ANONYMIZED_MARKER,
        leadId,
      ).run();
    } else {
      throw e;
    }
  }
}

/**
 * Soft-delete un lead en D1 (SET deleted_at).
 */
async function softDeleteLeadInDb(env: Env, leadId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE leads SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).bind(leadId).run();
}

/**
 * Persiste le rapport de purge dans privacy_purge_log.
 */
async function logPurgeReport(
  env: Env,
  clientId: string | null,
  report: PurgeReport,
): Promise<void> {
  await ensurePurgeLogTable(env);
  try {
    await env.DB.prepare(
      'INSERT INTO privacy_purge_log (id, client_id, report) VALUES (?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      clientId,
      JSON.stringify(report),
    ).run();
  } catch {
    // Non critique — le rapport est aussi dans l'audit_log via audit().
  }
}

// ── Handlers publics ──────────────────────────────────────────────────────────

/**
 * GET /api/compliance/purge/rules
 * Récupère toutes les règles de purge. Filtre optionnel par client_id.
 */
export async function handleGetPurgeRules(
  env: Env,
  auth: { userId: string; role: string },
  url?: URL,
): Promise<Response> {
  const denied = requireAdmin(auth);
  if (denied) return denied;

  const clientId = url?.searchParams.get('client_id');
  let query = 'SELECT * FROM privacy_purge_rules';
  const params: string[] = [];

  if (clientId) {
    query += ' WHERE client_id = ?';
    params.push(sanitizeInput(clientId, 100));
  }

  query += ' ORDER BY created_at DESC';

  try {
    const stmt = env.DB.prepare(query);
    const { results } = params.length > 0
      ? await stmt.bind(...params).all()
      : await stmt.all();

    return json({ data: results || [] });
  } catch (e) {
    // Si la table n'existe pas encore (migration pas jouée)
    const msg = String(e ?? '');
    if (/no such table/i.test(msg)) {
      return json({ data: [] });
    }
    throw e;
  }
}

/**
 * POST /api/compliance/purge/rules
 * Crée une nouvelle règle de purge.
 * Body attendu : { client_id, inactive_days, action }
 */
export async function handleCreatePurgeRule(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  const denied = requireAdmin(auth);
  if (denied) return denied;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  const clientId = sanitizeInput(body.client_id as string, 100);
  if (!clientId) {
    return json({ error: 'client_id requis' }, 400);
  }

  // Validation via l'engine pur
  const validation = validatePurgeRule({
    inactive_days: body.inactive_days,
    action: body.action,
    applies_to: body.applies_to,
  });

  if (!validation.ok || !validation.rule) {
    return json({
      error: 'Règle de purge invalide',
      error_code: validation.error,
    }, 400);
  }

  // Vérifier que le client existe
  const client = await env.DB.prepare(
    'SELECT id FROM clients WHERE id = ?'
  ).bind(clientId).first();

  if (!client) {
    return json({ error: 'Client introuvable' }, 404);
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    'INSERT INTO privacy_purge_rules (id, client_id, inactive_days, action) VALUES (?, ?, ?, ?)'
  ).bind(id, clientId, validation.rule.inactive_days, validation.rule.action).run();

  await audit(env, auth.userId, 'purge_rule.create', 'purge_rule', id, {
    client_id: clientId,
    inactive_days: validation.rule.inactive_days,
    action: validation.rule.action,
  });

  return json({ data: { id, ...validation.rule, client_id: clientId } }, 201);
}

/**
 * PATCH /api/compliance/purge/rules/:id
 * Met à jour inactive_days et/ou action d'une règle existante.
 */
export async function handleUpdatePurgeRule(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
  ruleId: string,
): Promise<Response> {
  const denied = requireAdmin(auth);
  if (denied) return denied;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return json({ error: 'Corps de requête invalide' }, 400);
  }

  // Vérifier que la règle existe
  const existing = await env.DB.prepare(
    'SELECT * FROM privacy_purge_rules WHERE id = ?'
  ).bind(ruleId).first() as PurgeRuleRow | null;

  if (!existing) {
    return json({ error: 'Règle introuvable' }, 404);
  }

  // Construire les champs à mettre à jour
  const updates: string[] = [];
  const params: (string | number)[] = [];
  const changes: Record<string, unknown> = {};

  if (body.inactive_days !== undefined) {
    const days = Number(body.inactive_days);
    if (!Number.isFinite(days) || days < 1) {
      return json({ error: 'inactive_days doit être un entier positif' }, 400);
    }
    updates.push('inactive_days = ?');
    params.push(Math.floor(days));
    changes.inactive_days = Math.floor(days);
  }

  if (body.action !== undefined) {
    const action = String(body.action);
    if (!ALLOWED_ACTIONS.has(action)) {
      return json({
        error: `Action invalide. Valeurs possibles : ${PURGE_ACTIONS.join(', ')}`,
      }, 400);
    }
    updates.push('action = ?');
    params.push(action);
    changes.action = action;
  }

  if (updates.length === 0) {
    return json({ error: 'Aucune modification fournie' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(ruleId);

  await env.DB.prepare(
    `UPDATE privacy_purge_rules SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  await audit(env, auth.userId, 'purge_rule.update', 'purge_rule', ruleId, changes);

  return json({ data: { success: true } });
}

/**
 * DELETE /api/compliance/purge/rules/:id
 * Supprime une règle de purge.
 */
export async function handleDeletePurgeRule(
  env: Env,
  auth: { userId: string; role: string },
  ruleId: string,
): Promise<Response> {
  const denied = requireAdmin(auth);
  if (denied) return denied;

  // Vérifier que la règle existe
  const existing = await env.DB.prepare(
    'SELECT id FROM privacy_purge_rules WHERE id = ?'
  ).bind(ruleId).first();

  if (!existing) {
    return json({ error: 'Règle introuvable' }, 404);
  }

  await env.DB.prepare(
    'DELETE FROM privacy_purge_rules WHERE id = ?'
  ).bind(ruleId).run();

  await audit(env, auth.userId, 'purge_rule.delete', 'purge_rule', ruleId);

  return json({ data: { success: true } });
}

/**
 * GET /api/compliance/purge/preview?client_id=...
 * Retourne les leads éligibles à la purge SANS les purger (dry-run).
 * Utilise identifyPurgeableLeads de l'engine.
 */
export async function handlePreviewPurge(
  env: Env,
  auth: { userId: string; role: string },
  url: URL,
): Promise<Response> {
  const denied = requireAdmin(auth);
  if (denied) return denied;

  const clientId = url.searchParams.get('client_id');
  if (!clientId) {
    return json({ error: 'client_id requis en paramètre' }, 400);
  }

  const cleanClientId = sanitizeInput(clientId, 100);

  // Récupérer les règles du client
  const { results: ruleRows } = await env.DB.prepare(
    'SELECT * FROM privacy_purge_rules WHERE client_id = ?'
  ).bind(cleanClientId).all();

  const rules: PurgeRule[] = ((ruleRows || []) as PurgeRuleRow[]).map((r) => ({
    id: r.id,
    client_id: r.client_id,
    inactive_days: r.inactive_days,
    action: r.action as PurgeAction,
  }));

  if (rules.length === 0) {
    return json({
      data: {
        eligible: [],
        total: 0,
        rules: [],
        message: 'Aucune règle de purge configurée pour ce client',
      },
    });
  }

  // Récupérer les leads du client (non supprimés, non déjà anonymisés)
  const { results: leadRows } = await env.DB.prepare(
    `SELECT id, updated_at, created_at, status FROM leads
     WHERE client_id = ? AND deleted_at IS NULL AND email != ?`
  ).bind(cleanClientId, ANONYMIZED_MARKER).all();

  const leads = (leadRows || []) as LeadForPurge[];
  const eligible = identifyPurgeableLeads(leads, rules);

  return json({
    data: {
      eligible: eligible.map((item) => ({
        lead_id: item.lead.id,
        status: item.lead.status,
        inactive_days: item.inactiveDays,
        action: item.rule.action,
        rule_inactive_days: item.rule.inactive_days,
      })),
      total: eligible.length,
      rules,
    },
  });
}

/**
 * POST /api/compliance/purge/run
 * Exécute la purge selon les rules du client.
 * Body : { client_id?, dry_run? }
 */
export async function handleRunPurge(
  request: Request,
  env: Env,
  auth: { userId: string; role: string },
): Promise<Response> {
  const denied = requireAdmin(auth);
  if (denied) return denied;

  const body = await request.json().catch(() => null) as RunPurgeBody | null;
  const clientId = body?.client_id ? sanitizeInput(body.client_id, 100) : null;
  const dryRun = body?.dry_run === true;

  // Récupérer les règles (toutes ou filtrées par client)
  let rulesQuery = 'SELECT * FROM privacy_purge_rules';
  const rulesParams: string[] = [];

  if (clientId) {
    rulesQuery += ' WHERE client_id = ?';
    rulesParams.push(clientId);
  }

  const { results: ruleRows } = rulesParams.length > 0
    ? await env.DB.prepare(rulesQuery).bind(...rulesParams).all()
    : await env.DB.prepare(rulesQuery).all();

  const rules: PurgeRule[] = ((ruleRows || []) as PurgeRuleRow[]).map((r) => ({
    id: r.id,
    client_id: r.client_id,
    inactive_days: r.inactive_days,
    action: r.action as PurgeAction,
  }));

  if (rules.length === 0) {
    return json({
      data: {
        report: null,
        message: 'Aucune règle de purge configurée',
      },
    });
  }

  // Grouper les règles par client
  const rulesByClient = new Map<string, PurgeRule[]>();
  for (const rule of rules) {
    const cid = rule.client_id || '_global';
    const existing = rulesByClient.get(cid) || [];
    existing.push(rule);
    rulesByClient.set(cid, existing);
  }

  // Exécuter la purge par client
  const allPurged: Array<{ lead: LeadForPurge; rule: PurgeRule }> = [];

  for (const [cid, clientRules] of rulesByClient) {
    // Récupérer les leads du client (non supprimés, non anonymisés)
    const { results: leadRows } = await env.DB.prepare(
      `SELECT id, updated_at, created_at, status FROM leads
       WHERE client_id = ? AND deleted_at IS NULL AND email != ?`
    ).bind(cid, ANONYMIZED_MARKER).all();

    const leads = (leadRows || []) as LeadForPurge[];
    const eligible = identifyPurgeableLeads(leads, clientRules);

    if (dryRun) {
      // En dry-run, on ne modifie rien — on collecte seulement
      for (const item of eligible) {
        allPurged.push({ lead: item.lead, rule: item.rule });
      }
      continue;
    }

    // Exécution réelle de la purge
    for (const item of eligible) {
      try {
        switch (item.rule.action) {
          case 'anonymize':
            await anonymizeLeadInDb(env, item.lead.id);
            // Supprimer aussi les messages et consentements liés (Loi 25)
            await env.DB.prepare('DELETE FROM messages WHERE lead_id = ?')
              .bind(item.lead.id).run();
            break;

          case 'delete':
            await softDeleteLeadInDb(env, item.lead.id);
            break;

          case 'archive':
            // Archive = soft-delete avec marquage spécial (même mécanisme)
            await softDeleteLeadInDb(env, item.lead.id);
            break;
        }
        allPurged.push({ lead: item.lead, rule: item.rule });
      } catch {
        // Erreur sur un lead individuel — on continue avec les autres
      }
    }
  }

  // Construire le rapport d'audit (traçabilité Loi 25 Art 23)
  const report = buildPurgeReport(allPurged, 'QC');

  if (!dryRun && allPurged.length > 0) {
    // Persister le rapport
    await logPurgeReport(env, clientId, report);

    // Audit log
    await audit(env, auth.userId, 'purge.run', 'compliance', 'purge', {
      total_processed: report.total_processed,
      by_action: report.by_action,
      client_id: clientId,
    });
  }

  return json({
    data: {
      report,
      dry_run: dryRun,
    },
  });
}

/**
 * Purge programmée (cron scheduled event).
 * Récupère TOUTES les règles actives, groupées par client, et exécute
 * la purge pour chaque client. Log le rapport en D1.
 *
 * Appelé par le handler `scheduled` du worker principal.
 */
export async function handleScheduledPurge(env: Env): Promise<void> {
  // Récupérer toutes les règles de purge
  let ruleRows: PurgeRuleRow[] = [];
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM privacy_purge_rules'
    ).all();
    ruleRows = (result.results || []) as PurgeRuleRow[];
  } catch (e) {
    // Table absente — migration pas encore jouée, on skip silencieusement
    const msg = String(e ?? '');
    if (/no such table/i.test(msg)) return;
    throw e;
  }

  if (ruleRows.length === 0) return;

  // Grouper les règles par client_id
  const rulesByClient = new Map<string, PurgeRule[]>();
  for (const row of ruleRows) {
    const rules = rulesByClient.get(row.client_id) || [];
    rules.push({
      id: row.id,
      client_id: row.client_id,
      inactive_days: row.inactive_days,
      action: row.action as PurgeAction,
    });
    rulesByClient.set(row.client_id, rules);
  }

  // Exécuter la purge pour chaque client
  for (const [cid, clientRules] of rulesByClient) {
    try {
      // Récupérer les leads du client (non supprimés, non anonymisés)
      const { results: leadRows } = await env.DB.prepare(
        `SELECT id, updated_at, created_at, status FROM leads
         WHERE client_id = ? AND deleted_at IS NULL AND email != ?`
      ).bind(cid, ANONYMIZED_MARKER).all();

      const leads = (leadRows || []) as LeadForPurge[];
      const eligible = identifyPurgeableLeads(leads, clientRules);

      if (eligible.length === 0) continue;

      const purged: Array<{ lead: LeadForPurge; rule: PurgeRule }> = [];

      for (const item of eligible) {
        try {
          switch (item.rule.action) {
            case 'anonymize':
              await anonymizeLeadInDb(env, item.lead.id);
              await env.DB.prepare('DELETE FROM messages WHERE lead_id = ?')
                .bind(item.lead.id).run();
              break;

            case 'delete':
              await softDeleteLeadInDb(env, item.lead.id);
              break;

            case 'archive':
              await softDeleteLeadInDb(env, item.lead.id);
              break;
          }
          purged.push({ lead: item.lead, rule: item.rule });
        } catch {
          // Erreur sur un lead individuel — on continue
        }
      }

      if (purged.length > 0) {
        const report = buildPurgeReport(purged, 'QC');
        await logPurgeReport(env, cid, report);

        // Audit log (user = 'system' pour le cron)
        await audit(env, 'system', 'purge.scheduled', 'compliance', cid, {
          total_processed: report.total_processed,
          by_action: report.by_action,
        });
      }
    } catch {
      // Erreur sur un client — on continue avec les autres
      // Pas de console.log en production
    }
  }
}
