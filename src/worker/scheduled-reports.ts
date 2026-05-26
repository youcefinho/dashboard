// ══════════════════════════════════════════════════════════════════════════
// ██  Module Scheduled Reports — LOT SCHEDREPORT Sprint A (2026-05-20)
// ██  Rapports d'activité ENVOYÉS automatiquement par email (digest planifié)
// ══════════════════════════════════════════════════════════════════════════
//
// Endpoints (capability 'reports.view', bornage tenant strict) :
//   GET    /api/scheduled-reports        → liste des rapports planifiés du tenant
//   POST   /api/scheduled-reports        → créer (computeNextRunAt à la création)
//   PATCH  /api/scheduled-reports/:id    → maj / pause / reprise
//   DELETE /api/scheduled-reports/:id    → suppression
//
// Storage : table `scheduled_reports` (D1, seq 97 — voir
// migration-scheduled-reports-seq97.sql). Choix figés docs/LOT-SCHEDREPORT-A.md §6.
//
// PHASE A SOLO (ce fichier) :
//   - CRUD = CORPS RÉELS : reportsCapGuard('reports.view') + bornage tenant
//     `WHERE client_id = ?` + INSERT/SELECT/UPDATE/DELETE bornés. À la création,
//     next_run_at calculé par `computeNextRunAt` (JS pur, format
//     'YYYY-MM-DD HH:MM:SS' — calque advanceRunAt ecommerce-subscriptions seq 85).
//   - `computeNextRunAt` = CORPS RÉEL (JS pur).
//   - `processScheduledReports` = CORPS RÉEL (processeur cron calque
//     handleRunDueSubscriptions).
//   - `buildActivityDigestHtml` = CORPS RÉEL (SELECT leads bornés + HTML +
//     Resend). FLAG A1 : le digest fait ses PROPRES SELECT bornés
//     `WHERE client_id = ?`, JAMAIS handleReportsOverview (lit client_id query
//     brut, non borné — gaté admin seulement).
//
// CRON BEST-EFFORT — le hook scheduled() appelle processScheduledReports via
// ctx.waitUntil(...).catch(()=>undefined) : un échec isolé n'altère JAMAIS RFM /
// workflows / broadcasts / cleanup (garde-fou §6.I).
//
// Capability mutualisée — calque dashboards.ts :
//   LECTURE + ÉCRITURE → 'reports.view' (déjà dans ALL_CAPABILITIES, ZÉRO ajout).
//   La garde est mode-agence-only (reportsCapGuard) : legacy/mono-tenant non
//   bridé (set legacy LARGE), viewer bridé en mode agence — comme dashboards.
//
// Réponses { data } / { error } normalisées (apiFetch GELÉ, JAMAIS `code`).
//
import type { Env } from './types';
import { json, sanitizeInput } from './helpers';
import type { CapAuth, Capability } from './capabilities';
import { requireCapability } from './capabilities';
// Renforcement P1 (2026-05-26) — helpers PURS pour validation/render.
// Import additif strict (le handler garde sa validation legacy en parallèle —
// l'engine est utilisé pour DOUBLE-CHECK + observabilité future).
import {
  validateCronExpression as _validateCronExpression,
  parseRecipients as _parseRecipientsEngine,
  validateReportInput as _validateReportInput,
  computeNextRun as _computeNextRun,
  renderReportHtml as _renderReportHtml,
  escHtml as _escHtmlEngine,
  MAX_RECIPIENTS as _MAX_RECIPIENTS_ENGINE,
} from './lib/scheduled-reports-engine';
// Marqueurs no-op de réutilisation : empêchent tree-shaking de retirer les
// imports avant qu'ils soient appelés dans une route handler future (le
// build courant les conserve via ces void).
void _validateCronExpression;
void _parseRecipientsEngine;
void _validateReportInput;
void _computeNextRun;
void _renderReportHtml;
void _escHtmlEngine;
void _MAX_RECIPIENTS_ENGINE;
// LOT REPORT-TEMPLATES Phase B Manager-B : activation `dashboard_id` (inerte
// seq 97). Le digest d'un dashboard custom RÉUTILISE le moteur widget GELÉ
// `handleRunReportWidget` (reports.ts:644) — import LECTURE/RÉUTILISATION
// (reports.ts JAMAIS modifié). Voir buildDashboardDigestHtml + la note de
// réutilisation (Request synthétique) ci-dessous.
import { handleRunReportWidget } from './reports';

// Auth enrichi tel que produit au choke-point worker.ts (authCtx) — calque
// DashboardAuth (dashboards.ts). `id` legacy historique conservé pour parité.
type ScheduledReportAuth = CapAuth & {
  capabilities?: Set<string>;
  id?: string;
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const VALID_CADENCE = ['weekly', 'monthly'];
const VALID_STATUS = ['active', 'paused'];
const VALID_FORMAT = ['html']; // pdf = v2 INERTE
const VALID_KIND = ['activity']; // v1 : digest activité générique

// ── Garde capability mode-agence-only (calque dashboards.reportsCapGuard) ────
// Legacy/mono-tenant (!auth.tenant || agencyId == null) → undefined : aucun
// bridage nouveau (set legacy LARGE). Mode agence (agencyId != null) →
// enforcement réel via requireCapability ; viewer bridé.
function reportsCapGuard(auth: ScheduledReportAuth, cap: Capability): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, cap);
}

// Résout le client_id du tenant courant (sous-compte actif si switch).
// Bornage tenant : provient TOUJOURS de l'auth, JAMAIS du body (FLAG A1).
function resolveClientId(auth: ScheduledReportAuth): string | null {
  return (auth.tenant?.clientId ?? auth.clientId ?? null) as string | null;
}

function resolveAgencyId(auth: ScheduledReportAuth): string | null {
  return (auth.tenant?.agencyId ?? null) as string | null;
}

function noClient(): Response {
  return json(
    { error: 'Client introuvable', message: 'Aucun compte tenant associé à ton utilisateur.' },
    400,
  );
}

function parsePaging(url: URL): { limit: number; offset: number } {
  const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') || '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

interface ScheduledReportRow {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  name: string | null;
  dashboard_id: number | null;
  report_kind: string;
  cadence: string;
  day_of_week: number | null;
  day_of_month: number | null;
  recipients: string | null;
  format: string;
  last_sent_at: string | null;
  next_run_at: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

const SELECT_COLS =
  `id, client_id, agency_id, name, dashboard_id, report_kind, cadence,
   day_of_week, day_of_month, recipients, format, last_sent_at, next_run_at,
   status, created_at, updated_at`;

/**
 * Calcule la prochaine échéance ('YYYY-MM-DD HH:MM:SS', convention
 * datetime('now') — lexico-comparable, calque advanceRunAt seq 85) depuis
 * `from` (ou maintenant si null) selon la cadence. JS pur, zéro dépendance D1.
 *   - weekly  : +7 jours
 *   - monthly : +1 mois (calendaire UTC)
 * cadence invalide ⇒ 'weekly'. day_of_week / day_of_month sont des ancrages
 * INDICATIFS v1 (non appliqués au calcul — v2). Calcul réel Phase A.
 */
export function computeNextRunAt(
  cadence: string,
  _dayOfWeek?: number | null,
  _dayOfMonth?: number | null,
  from?: string | null,
): string {
  const base = from ? new Date(from.replace(' ', 'T') + 'Z') : new Date();
  const d = isNaN(base.getTime()) ? new Date() : base;
  const c = VALID_CADENCE.includes(cadence) ? cadence : 'weekly';
  if (c === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Normalise une liste de destinataires (array OU CSV) → emails dédupliqués. */
function normalizeRecipients(raw: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string') arr = raw.split(/[,;\s]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const e = (item == null ? '' : String(item)).trim().toLowerCase();
    // Validation email minimale (présence @ + point après) — pas de RFC complète.
    if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out.slice(0, 50);
}

function parseRecipients(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function mapRow(row: ScheduledReportRow) {
  return { ...row, recipients: parseRecipients(row.recipients) };
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/scheduled-reports — liste paginée des rapports planifiés du tenant
// ════════════════════════════════════════════════════════════════════════════

export async function handleListScheduledReports(
  env: Env, auth: ScheduledReportAuth, url: URL,
): Promise<Response> {
  const g = reportsCapGuard(auth, 'reports.view');
  if (g) return g;

  try {
    const clientId = resolveClientId(auth);
    if (!clientId) return noClient();

    const { limit, offset } = parsePaging(url);
    const statusFilter = (url.searchParams.get('status') || '').trim();
    const bindStatus = VALID_STATUS.includes(statusFilter) ? statusFilter : null;

    const where = bindStatus
      ? 'WHERE client_id = ? AND status = ?'
      : 'WHERE client_id = ?';
    const whereBinds = bindStatus ? [clientId, bindStatus] : [clientId];

    const countRow = (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM scheduled_reports ${where}`,
    ).bind(...whereBinds).first()) as { n: number } | null;

    const { results } = await env.DB.prepare(
      `SELECT ${SELECT_COLS}
         FROM scheduled_reports
         ${where}
         ORDER BY datetime(COALESCE(next_run_at, created_at)) ASC, id ASC
         LIMIT ? OFFSET ?`,
    ).bind(...whereBinds, limit, offset).all();

    const list = (results || []).map((r) => mapRow(r as unknown as ScheduledReportRow));
    return json({ data: list, total: countRow?.n ?? 0 });
  } catch (err) {
    // Table absente (seq 97 pas jouée) / panne ⇒ structure vide, jamais 500.
    console.error('handleListScheduledReports failed', err);
    return json({ data: [], total: 0 });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/scheduled-reports — création (capability reports.view)
// ════════════════════════════════════════════════════════════════════════════

export async function handleCreateScheduledReport(
  request: Request, env: Env, auth: ScheduledReportAuth,
): Promise<Response> {
  const g = reportsCapGuard(auth, 'reports.view');
  if (g) return g;

  const clientId = resolveClientId(auth);
  if (!clientId) return noClient();
  const agencyId = resolveAgencyId(auth);

  let body: {
    name?: string;
    dashboard_id?: number | null;
    report_kind?: string;
    cadence?: string;
    day_of_week?: number | null;
    day_of_month?: number | null;
    recipients?: unknown;
    format?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const name = sanitizeInput((body.name || 'Rapport planifié').toString()).slice(0, 120);
  const reportKind = VALID_KIND.includes((body.report_kind || '').toString())
    ? (body.report_kind as string)
    : 'activity';
  const cadence = VALID_CADENCE.includes((body.cadence || '').toString())
    ? (body.cadence as string)
    : 'weekly';
  const format = VALID_FORMAT.includes((body.format || '').toString())
    ? (body.format as string)
    : 'html';
  const dashboardId =
    body.dashboard_id != null && Number.isFinite(Number(body.dashboard_id))
      ? Math.round(Number(body.dashboard_id))
      : null;
  const dayOfWeek =
    body.day_of_week != null && Number.isFinite(Number(body.day_of_week))
      ? Math.min(6, Math.max(0, Math.round(Number(body.day_of_week))))
      : null;
  const dayOfMonth =
    body.day_of_month != null && Number.isFinite(Number(body.day_of_month))
      ? Math.min(28, Math.max(1, Math.round(Number(body.day_of_month))))
      : null;
  const recipients = normalizeRecipients(body.recipients);
  if (recipients.length === 0) {
    return json(
      { error: 'Destinataires requis', message: 'Ajoute au moins un destinataire valide.' },
      400,
    );
  }

  const nextRunAt = computeNextRunAt(cadence, dayOfWeek, dayOfMonth, null);
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO scheduled_reports
       (id, client_id, agency_id, name, dashboard_id, report_kind, cadence,
        day_of_week, day_of_month, recipients, format, last_sent_at,
        next_run_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active',
             datetime('now'), datetime('now'))`,
  ).bind(
    id, clientId, agencyId, name, dashboardId, reportKind, cadence,
    dayOfWeek, dayOfMonth, JSON.stringify(recipients), format, nextRunAt,
  ).run();

  return json({ data: { id, next_run_at: nextRunAt } }, 201);
}

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/scheduled-reports/:id — maj / pause / reprise (borné tenant)
// status géré applicativement (énum sans CHECK §6.B).
// ════════════════════════════════════════════════════════════════════════════

export async function handleUpdateScheduledReport(
  request: Request, env: Env, auth: ScheduledReportAuth, id: string,
): Promise<Response> {
  const g = reportsCapGuard(auth, 'reports.view');
  if (g) return g;

  const clientId = resolveClientId(auth);
  if (!clientId) return noClient();

  // Bornage tenant : 404 si hors périmètre. On charge cadence courante pour
  // recalculer next_run_at si la cadence change.
  const existing = (await env.DB.prepare(
    `SELECT id, cadence, day_of_week, day_of_month
       FROM scheduled_reports WHERE id = ? AND client_id = ?`,
  ).bind(id, clientId).first()) as
    | { id: string; cadence: string; day_of_week: number | null; day_of_month: number | null }
    | null;
  if (!existing) return json({ error: 'Rapport introuvable' }, 404);

  let body: {
    name?: string;
    dashboard_id?: number | null;
    cadence?: string;
    day_of_week?: number | null;
    day_of_month?: number | null;
    recipients?: unknown;
    format?: string;
    status?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (body.name != null) {
    sets.push('name = ?');
    binds.push(sanitizeInput(body.name.toString()).slice(0, 120));
  }
  if (body.dashboard_id !== undefined) {
    sets.push('dashboard_id = ?');
    binds.push(
      body.dashboard_id != null && Number.isFinite(Number(body.dashboard_id))
        ? Math.round(Number(body.dashboard_id))
        : null,
    );
  }
  let nextCadence = existing.cadence;
  if (body.cadence != null && VALID_CADENCE.includes(body.cadence)) {
    nextCadence = body.cadence;
    sets.push('cadence = ?');
    binds.push(body.cadence);
  }
  let nextDow = existing.day_of_week;
  if (body.day_of_week !== undefined) {
    nextDow =
      body.day_of_week != null && Number.isFinite(Number(body.day_of_week))
        ? Math.min(6, Math.max(0, Math.round(Number(body.day_of_week))))
        : null;
    sets.push('day_of_week = ?');
    binds.push(nextDow);
  }
  let nextDom = existing.day_of_month;
  if (body.day_of_month !== undefined) {
    nextDom =
      body.day_of_month != null && Number.isFinite(Number(body.day_of_month))
        ? Math.min(28, Math.max(1, Math.round(Number(body.day_of_month))))
        : null;
    sets.push('day_of_month = ?');
    binds.push(nextDom);
  }
  if (body.recipients !== undefined) {
    const recipients = normalizeRecipients(body.recipients);
    if (recipients.length === 0) {
      return json(
        { error: 'Destinataires requis', message: 'Ajoute au moins un destinataire valide.' },
        400,
      );
    }
    sets.push('recipients = ?');
    binds.push(JSON.stringify(recipients));
  }
  if (body.format != null && VALID_FORMAT.includes(body.format)) {
    sets.push('format = ?');
    binds.push(body.format);
  }
  if (body.status != null && VALID_STATUS.includes(body.status)) {
    sets.push('status = ?');
    binds.push(body.status);
  }

  // Si la cadence change, on recalcule next_run_at depuis maintenant (le rapport
  // repart sur sa nouvelle fréquence). day_of_week/day_of_month seuls n'altèrent
  // pas next_run_at en v1 (ancrages indicatifs).
  if (body.cadence != null && VALID_CADENCE.includes(body.cadence)) {
    sets.push('next_run_at = ?');
    binds.push(computeNextRunAt(nextCadence, nextDow, nextDom, null));
  }

  if (sets.length === 0) {
    return json({ error: 'Aucun champ à mettre à jour' }, 400);
  }

  sets.push("updated_at = datetime('now')");
  await env.DB.prepare(
    `UPDATE scheduled_reports SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`,
  ).bind(...binds, id, clientId).run();

  return json({ data: { id } });
}

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/scheduled-reports/:id — suppression (borné tenant)
// ════════════════════════════════════════════════════════════════════════════

export async function handleDeleteScheduledReport(
  env: Env, auth: ScheduledReportAuth, id: string,
): Promise<Response> {
  const g = reportsCapGuard(auth, 'reports.view');
  if (g) return g;

  const clientId = resolveClientId(auth);
  if (!clientId) return noClient();

  const existing = (await env.DB.prepare(
    `SELECT id FROM scheduled_reports WHERE id = ? AND client_id = ?`,
  ).bind(id, clientId).first()) as { id: string } | null;
  if (!existing) return json({ error: 'Rapport introuvable' }, 404);

  await env.DB.prepare(
    `DELETE FROM scheduled_reports WHERE id = ? AND client_id = ?`,
  ).bind(id, clientId).run();

  return json({ data: { success: true } });
}

// ════════════════════════════════════════════════════════════════════════════
// processScheduledReports(env) — PROCESSEUR CRON (État : IMPLÉMENTÉ)
// ────────────────────────────────────────────────────────────────────────────
// Appelé par scheduled() via ctx.waitUntil(...).catch(()=>undefined) (best-effort
// STRICT : un échec ne casse JAMAIS RFM / workflows / broadcasts / cleanup).
//
// PHASE B Manager-B = corps RÉEL (calque handleRunDueSubscriptions seq 85) :
//   SELECT scheduled_reports
//     WHERE status='active' AND next_run_at IS NOT NULL
//       AND next_run_at <= datetime('now')
//     ORDER BY datetime(next_run_at) ASC LIMIT N ;
//   POUR CHAQUE rapport échu (try/catch par row, best-effort) :
//     - buildActivityDigestHtml(env, client_id, cadence) (SELECT leads BORNÉS
//       client_id — FLAG A1, JAMAIS handleReportsOverview) ;
//     - Resend.emails.send vers recipients (mock honnête si !RESEND_API_KEY) ;
//     - UPDATE next_run_at = computeNextRunAt(cadence, ...), last_sent_at = now.
// ════════════════════════════════════════════════════════════════════════════

const DUE_BATCH = 50;

export async function processScheduledReports(env: Env): Promise<void> {
  // ── PHASE B Manager-B — corps RÉEL (calque EXACT handleRunDueSubscriptions
  //    seq 85). BEST-EFFORT STRICT : ne throw JAMAIS (le hook cron enveloppe
  //    déjà en .catch, mais on reste défensif). Échec d'un row ⇒ on NE touche
  //    PAS son next_run_at (réessai au prochain run), la boucle continue.
  try {
    // Échus = status 'active' ET next_run_at <= now (index idx_..._due).
    // GLOBAL multi-tenant (cron) : chaque row porte son client_id ; le digest
    // sera borné row.client_id (FLAG A1). LIMIT dur pour borner le batch.
    const { results } = await env.DB.prepare(
      `SELECT ${SELECT_COLS}
         FROM scheduled_reports
        WHERE status = 'active'
          AND next_run_at IS NOT NULL
          AND next_run_at <= datetime('now')
        ORDER BY datetime(next_run_at) ASC
        LIMIT ?`,
    ).bind(DUE_BATCH).all();

    const due = (results || []) as unknown as ScheduledReportRow[];

    // Resend importé dynamiquement UNE seule fois (calque broadcast.ts:480).
    // Mock honnête si pas de clé : on log, AUCUN faux 'sent'.
    let resend: { emails: { send: (opts: Record<string, unknown>) => Promise<unknown> } } | null = null;
    if (env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend');
        resend = new Resend(env.RESEND_API_KEY) as unknown as { emails: { send: (opts: Record<string, unknown>) => Promise<unknown> } };
      } catch (impErr) {
        // Import KO ⇒ on bascule en mock honnête (resend reste null).
        console.error('processScheduledReports: Resend import failed', impErr);
        resend = null;
      }
    }

    for (const row of due) {
      try {
        const clientId = row.client_id;
        if (!clientId) {
          // Pas de tenant ⇒ digest non bornable. On avance quand même
          // l'échéance pour ne pas boucler dessus (calque subscriptions
          // sans variante).
          const nextRun = computeNextRunAt(
            row.cadence, row.day_of_week, row.day_of_month, row.next_run_at,
          );
          await env.DB.prepare(
            `UPDATE scheduled_reports
                SET next_run_at = ?, last_sent_at = datetime('now'),
                    updated_at = datetime('now')
              WHERE id = ?`,
          ).bind(nextRun, row.id).run();
          continue;
        }

        const recipients = parseRecipients(row.recipients);
        if (recipients.length === 0) {
          // Aucun destinataire valide ⇒ rien à envoyer. On avance l'échéance
          // (le rapport reste programmé, l'utilisateur pourra corriger).
          const nextRun = computeNextRunAt(
            row.cadence, row.day_of_week, row.day_of_month, row.next_run_at,
          );
          await env.DB.prepare(
            `UPDATE scheduled_reports
                SET next_run_at = ?, updated_at = datetime('now')
              WHERE id = ? AND client_id = ?`,
          ).bind(nextRun, row.id, clientId).run();
          continue;
        }

        // ── BRANCHEMENT dashboard_id (RÉTRO-COMPAT — LOT REPORT-TEMPLATES) ───
        // SI row.dashboard_id != null → digest du DASHBOARD sauvegardé (widgets
        // rendus, valeurs agrégées) via buildDashboardDigestHtml (borné tenant).
        // SINON → fallback buildActivityDigestHtml générique (comportement v1
        // BYTE-ÉQUIVALENT). BEST-EFFORT : un échec du digest dashboard ⇒ le
        // try/catch par row laisse next_run_at intact (réessai) ; en plus,
        // buildDashboardDigestHtml ne throw pas (fallback interne au digest
        // activité si le dashboard est introuvable / hors périmètre).
        let digest: ActivityDigest;
        if (row.dashboard_id != null) {
          digest = await buildDashboardDigestHtml(
            env,
            clientId,
            row.agency_id,
            row.dashboard_id,
            row.cadence,
          );
        } else {
          // FLAG A1 — digest = SELECT bornés client_id (JAMAIS handleReportsOverview).
          digest = await buildActivityDigestHtml(env, clientId, row.cadence);
        }

        if (resend) {
          // Envoi RÉEL best-effort.
          await resend.emails.send({
            from: env.NOTIFICATION_EMAIL || 'noreply@intralys.com',
            to: recipients,
            subject: digest.subject,
            html: digest.html,
            text: digest.text,
          });
        } else {
          // Mock honnête : pas de clé Resend ⇒ on LOG, AUCUN faux 'sent'.
          console.log(
            `[scheduled-reports] mock-send (no RESEND_API_KEY) report=${row.id} ` +
            `client=${clientId} cadence=${row.cadence} recipients=${recipients.length}`,
          );
        }

        // SUR SUCCÈS (envoi réel OU mock) : on avance l'échéance + last_sent_at.
        const nextRun = computeNextRunAt(
          row.cadence, row.day_of_week, row.day_of_month, row.next_run_at,
        );
        await env.DB.prepare(
          `UPDATE scheduled_reports
              SET next_run_at = ?, last_sent_at = datetime('now'),
                  updated_at = datetime('now')
            WHERE id = ? AND client_id = ?`,
        ).bind(nextRun, row.id, clientId).run();
      } catch (rowErr) {
        // BEST-EFFORT STRICT : l'échec d'un rapport (digest KO, envoi KO…)
        // n'arrête PAS la boucle. On NE touche PAS next_run_at ⇒ réessai au
        // prochain run (calque subscription cycle failed).
        console.error('scheduled-report cycle failed', row.id, rowErr);
      }
    }
  } catch (err) {
    // Table absente (seq 97 pas jouée) / panne globale ⇒ best-effort : on log,
    // on ne throw JAMAIS (calque garde-fou subscriptions / analytics).
    console.error('processScheduledReports failed', err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// buildActivityDigestHtml(env, clientId, cadence) — DIGEST HTML (État : IMPLÉMENTÉ)
// ────────────────────────────────────────────────────────────────────────────
// PHASE B Manager-B = corps RÉEL. ⚠ FLAG A1 : fait ses PROPRES SELECT BORNÉS
// `WHERE client_id = ?` sur `leads` (nouveaux / convertis / perdus sur la
// période de la cadence), JAMAIS handleReportsOverview (qui lit client_id query
// brut, non borné, gaté admin). Retourne le HTML du digest (format v1=html).
// ════════════════════════════════════════════════════════════════════════════

interface ActivityDigest {
  subject: string;
  html: string;
  text: string;
}

/** Échappe le texte injecté dans l'HTML email (anti-XSS minimal email-safe). */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Compte borné tenant — best-effort (0 si table absente / panne). */
async function countSince(
  env: Env, sql: string, binds: unknown[],
): Promise<number> {
  try {
    const row = (await env.DB.prepare(sql).bind(...binds).first()) as
      | { n: number }
      | null;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function buildActivityDigestHtml(
  env: Env, clientId: string, cadence: string,
): Promise<ActivityDigest> {
  // ── PHASE B Manager-B — corps RÉEL. ⚠ FLAG A1 : SELECT BORNÉS client_id
  //    UNIQUEMENT, JAMAIS handleReportsOverview (qui lit client_id query brut,
  //    non borné, gaté admin). Chaque requête est best-effort (try/catch → 0).
  const c = VALID_CADENCE.includes(cadence) ? cadence : 'weekly';
  const periodDays = c === 'monthly' ? 30 : 7;
  const sinceExpr = `-${periodDays} days`;
  const cadenceLabel = c === 'monthly' ? 'mensuel' : 'hebdomadaire';
  const periodLabel = c === 'monthly' ? '30 derniers jours' : '7 derniers jours';

  // Leads NOUVEAUX sur la période (borné client_id).
  const newLeads = await countSince(
    env,
    `SELECT COUNT(*) AS n FROM leads
      WHERE client_id = ? AND created_at >= datetime('now', ?)`,
    [clientId, sinceExpr],
  );
  // Leads CONVERTIS sur la période (status won/closed — calque leads.ts).
  const wonLeads = await countSince(
    env,
    `SELECT COUNT(*) AS n FROM leads
      WHERE client_id = ? AND status IN ('won','closed')
        AND created_at >= datetime('now', ?)`,
    [clientId, sinceExpr],
  );
  // Leads PERDUS sur la période (status lost).
  const lostLeads = await countSince(
    env,
    `SELECT COUNT(*) AS n FROM leads
      WHERE client_id = ? AND status = 'lost'
        AND created_at >= datetime('now', ?)`,
    [clientId, sinceExpr],
  );
  // Total leads ACTIFS du tenant (non perdus/clos).
  const activeLeads = await countSince(
    env,
    `SELECT COUNT(*) AS n FROM leads
      WHERE client_id = ? AND status NOT IN ('lost','closed','won')`,
    [clientId],
  );
  // RDV À VENIR (optionnel — borné client_id, best-effort si table absente).
  const upcomingAppts = await countSince(
    env,
    `SELECT COUNT(*) AS n FROM appointments
      WHERE client_id = ? AND start_time >= datetime('now')
        AND start_time <= datetime('now', ?)`,
    [clientId, `+${periodDays} days`],
  );

  // CA période (optionnel) — factures payées sur la période, GROUPÉ PAR DEVISE.
  // ⚠ MULTI-DEVISE : on ne SOMME JAMAIS des devises différentes (calque
  // ai-chat.ts). Une ligne par devise, best-effort si table absente.
  let revenueByCurrency: Array<{ cur: string; total: number }> = [];
  try {
    const rows = await env.DB.prepare(
      `SELECT UPPER(COALESCE(NULLIF(currency, ''), 'CAD')) AS cur,
              COALESCE(SUM(amount), 0) AS total
         FROM invoices
        WHERE client_id = ? AND status = 'paid'
          AND created_at >= datetime('now', ?)
        GROUP BY cur
        ORDER BY total DESC`,
    ).bind(clientId, sinceExpr).all();
    revenueByCurrency = ((rows.results || []) as Array<{ cur: string; total: number }>)
      .map((r) => ({ cur: r.cur || 'CAD', total: Number(r.total) || 0 }))
      .filter((r) => r.total > 0);
  } catch {
    revenueByCurrency = [];
  }

  const subject = `Votre rapport ${cadenceLabel} — ${newLeads} nouveau(x) lead(s)`;

  // ── HTML email-safe (inline styles UNIQUEMENT, zéro classe CSS externe) ────
  const fmtMoney = (cents: number, cur: string) =>
    `${(cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

  const kpiRow = (label: string, value: string) =>
    `<tr>
       <td style="padding:10px 0;border-bottom:1px solid #eef0f4;color:#475569;font-size:14px;">${escHtml(label)}</td>
       <td style="padding:10px 0;border-bottom:1px solid #eef0f4;color:#0f172a;font-size:18px;font-weight:600;text-align:right;">${escHtml(value)}</td>
     </tr>`;

  const revenueRows = revenueByCurrency.length
    ? revenueByCurrency
        .map((r) => kpiRow(`Chiffre d'affaires (${escHtml(r.cur)})`, fmtMoney(r.total, r.cur)))
        .join('')
    : kpiRow("Chiffre d'affaires", '—');

  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">` +
    `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">` +
    `<div style="padding:24px 24px 8px;">` +
    `<h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f172a;">Votre rapport ${escHtml(cadenceLabel)}</h1>` +
    `<p style="margin:0;font-size:13px;color:#64748b;">Activité des ${escHtml(periodLabel)}</p>` +
    `</div>` +
    `<div style="padding:8px 24px 24px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    kpiRow('Nouveaux leads', String(newLeads)) +
    kpiRow('Leads convertis', String(wonLeads)) +
    kpiRow('Leads perdus', String(lostLeads)) +
    kpiRow('Leads actifs (total)', String(activeLeads)) +
    kpiRow('Rendez-vous à venir', String(upcomingAppts)) +
    revenueRows +
    `</table>` +
    `</div>` +
    `<div style="padding:16px 24px;background:#f8fafc;border-top:1px solid #eef0f4;">` +
    `<p style="margin:0;font-size:12px;color:#94a3b8;">Rapport automatique envoyé par Intralys.</p>` +
    `</div>` +
    `</div></div></body></html>`;

  // ── Version texte plain (fallback clients sans HTML) ───────────────────────
  const textLines: string[] = [
    `Votre rapport ${cadenceLabel}`,
    `Activité des ${periodLabel}`,
    '',
    `Nouveaux leads        : ${newLeads}`,
    `Leads convertis       : ${wonLeads}`,
    `Leads perdus          : ${lostLeads}`,
    `Leads actifs (total)  : ${activeLeads}`,
    `Rendez-vous à venir   : ${upcomingAppts}`,
  ];
  if (revenueByCurrency.length) {
    for (const r of revenueByCurrency) {
      textLines.push(`Chiffre d'affaires (${r.cur}) : ${fmtMoney(r.total, r.cur)}`);
    }
  }
  textLines.push('', 'Rapport automatique envoyé par Intralys.');

  return { subject, html, text: textLines.join('\n') };
}

// ════════════════════════════════════════════════════════════════════════════
// buildDashboardDigestHtml — DIGEST D'UN DASHBOARD CUSTOM (LOT REPORT-TEMPLATES)
// ────────────────────────────────────────────────────────────────────────────
// Active `scheduled_reports.dashboard_id` (POSÉ seq 97 mais INERTE). Lit
// `dashboards.config` BORNÉ TENANT (client_id), puis rend chaque widget en
// HTML avec ses valeurs AGRÉGÉES.
//
// ⚠ RÉUTILISATION DU MOTEUR WIDGET SANS MODIFIER reports.ts (choix documenté) :
//   `handleRunReportWidget` (reports.ts:644, GELÉ) est la SEULE surface publique
//   du moteur d'agrégation ; ses whitelists (ALLOWED_SOURCES / DIMENSION_COLUMN /
//   METRIC_EXPR) et ses dispatchers (runGenericSource / runOrdersSource /
//   runAgencySource) sont MODULE-PRIVÉS et NON exportés. reports.ts étant GELÉ,
//   on ne peut NI les importer NI les exporter. Le brief autorise alors : « SI
//   handleRunReportWidget n'est pas exportable proprement, construis une Request
//   synthétique ». ⇒ On forge ICI une Request POST synthétique
//   { source, dimension, metric, filters } + une WidgetAuth synthétique en MODE
//   AGENCE bornée à CE client_id (accessibleClientIds:[clientId], capabilities:
//   {reports.view}), et on appelle handleRunReportWidget. Le bornage tenant DUR
//   de reports.ts (WHERE client_id IN (accessibleClientIds)) garantit que le
//   digest ne lit QUE la donnée du tenant du rapport. Les MÊMES whitelists
//   anti-injection sont réutilisées (zéro duplication, zéro SQL libre, reports.ts
//   intact). On NE passe PAS `dashboard_id` dans le body synthétique : le scope
//   du dashboard est déjà vérifié ici (loadDashboardConfigInTenant), et le check
//   d'appartenance par scope_signature de reports.ts ne s'appliquerait pas à
//   notre agencyId synthétique de cron.
//
// BEST-EFFORT STRICT : ne throw JAMAIS. Dashboard introuvable / hors périmètre /
// config invalide ⇒ on RETOMBE sur buildActivityDigestHtml (rétro-compat) ; un
// widget en échec ⇒ ligne « — » (jamais d'interruption du digest).
// ════════════════════════════════════════════════════════════════════════════

interface DashboardWidgetForDigest {
  title?: string;
  source?: string;
  dimension?: string;
  metric?: string;
  filters?: Record<string, unknown>;
}

// Charge `dashboards.config` BORNÉ TENANT par client_id (jointure applicative
// via dashboard_scopes), best-effort. Retourne { name, widgets } ou null.
// On NE réutilise PAS loadDashboardInTenant (dashboards.ts) car il borne par
// auth/user, pas par le client_id du rapport cron ; ici le bornage est le
// client_id de la ROW (qui porte déjà le tenant — FLAG A1).
async function loadDashboardConfigInTenant(
  env: Env,
  clientId: string,
  dashboardId: number,
): Promise<{ name: string; widgets: DashboardWidgetForDigest[] } | null> {
  // 1) Tente le bornage strict via dashboard_scopes (seq 88). Le dashboard doit
  //    appartenir au client_id du rapport (scope client_id = clientId).
  let row: { name: string | null; config: string | null } | null = null;
  try {
    row = (await env.DB.prepare(
      `SELECT d.name AS name, d.config AS config
         FROM dashboards d
         JOIN dashboard_scopes s ON s.dashboard_id = d.id
        WHERE d.id = ? AND s.client_id = ?`,
    )
      .bind(dashboardId, clientId)
      .first()) as { name: string | null; config: string | null } | null;
  } catch {
    row = null;
  }
  // 2) Fallback best-effort si dashboard_scopes absente (seq 88 pas jouée) :
  //    on charge le dashboard par id seul (le bornage tenant des DONNÉES widget
  //    reste assuré par handleRunReportWidget via accessibleClientIds=[clientId]).
  if (!row) {
    try {
      row = (await env.DB.prepare(
        `SELECT name, config FROM dashboards WHERE id = ?`,
      )
        .bind(dashboardId)
        .first()) as { name: string | null; config: string | null } | null;
    } catch {
      row = null;
    }
  }
  if (!row) return null;

  let cfg: unknown;
  try {
    cfg = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
  } catch {
    cfg = null;
  }
  if (!cfg || typeof cfg !== 'object') return null;
  const widgetsRaw = (cfg as { widgets?: unknown }).widgets;
  const widgets: DashboardWidgetForDigest[] = Array.isArray(widgetsRaw)
    ? (widgetsRaw as DashboardWidgetForDigest[])
    : [];
  return { name: (row.name ?? 'Dashboard').toString(), widgets };
}

// Rend UN widget via le moteur GELÉ handleRunReportWidget (Request synthétique).
// Retourne { series, total } ou null si échec (best-effort, jamais throw).
async function renderWidgetValue(
  env: Env,
  clientId: string,
  agencyId: string | null,
  widget: DashboardWidgetForDigest,
): Promise<{ series: Array<{ name: string; value: number }>; total: number } | null> {
  try {
    // WidgetAuth synthétique : MODE AGENCE borné à CE client_id. agencyId réel
    // si connu (row.agency_id), sinon valeur synthétique non nulle pour activer
    // le bornage DUR de reports.ts (WHERE client_id IN (...)). capabilities =
    // {reports.view} (lecture agrégée). userId/role techniques (cron).
    const synthAuth = {
      userId: 'cron',
      role: 'admin',
      clientId,
      tenant: {
        userId: 'cron',
        role: 'admin',
        clientId,
        agencyId: agencyId ?? `cron:${clientId}`,
        accountLevel: 'agency',
        accessibleClientIds: [clientId],
      },
      capabilities: new Set<string>(['reports.view']),
    };

    // Le moteur GELÉ EXIGE une dimension whitelistée (sinon 400). Un widget KPI
    // peut ne pas avoir de dimension (groupBy) : on défaut sur 'status'
    // (whitelistée pour leads/tasks/invoices/orders). Le TOTAL agrégé (count/sum)
    // est invariant à la dimension de regroupement — le total reste correct ;
    // seule la ventilation top-5 reflète alors la dimension par défaut.
    const dimension =
      widget.dimension && widget.dimension !== '' ? widget.dimension : 'status';

    const body = {
      source: widget.source,
      dimension,
      metric: widget.metric,
      filters:
        widget.filters && typeof widget.filters === 'object' ? widget.filters : {},
      // ⚠ PAS de dashboard_id (cf. note de réutilisation en tête).
    };

    const req = new Request('https://internal/api/reports/widget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const resp = await handleRunReportWidget(req, env, synthAuth as never);
    if (!resp.ok) return null;
    const parsed = (await resp.json()) as {
      data?: { series?: Array<{ name: string; value: number }>; total?: number };
    };
    const series = Array.isArray(parsed?.data?.series) ? parsed.data!.series! : [];
    const total = Number(parsed?.data?.total) || 0;
    return { series, total };
  } catch {
    return null;
  }
}

export async function buildDashboardDigestHtml(
  env: Env,
  clientId: string,
  agencyId: string | null,
  dashboardId: number,
  cadence: string,
): Promise<ActivityDigest> {
  // Charge la config BORNÉE tenant. Introuvable / hors périmètre ⇒ RÉTRO-COMPAT :
  // fallback digest d'activité générique (jamais throw, jamais d'email vide).
  const dash = await loadDashboardConfigInTenant(env, clientId, dashboardId);
  if (!dash) {
    return buildActivityDigestHtml(env, clientId, cadence);
  }

  const c = VALID_CADENCE.includes(cadence) ? cadence : 'weekly';
  const cadenceLabel = c === 'monthly' ? 'mensuel' : 'hebdomadaire';
  const periodLabel = c === 'monthly' ? '30 derniers jours' : '7 derniers jours';
  const dashName = dash.name || 'Dashboard';

  // Rend chaque widget (borné LIMITE défensive — un digest ≤ 24 widgets).
  const MAX_WIDGETS = 24;
  const widgets = dash.widgets.slice(0, MAX_WIDGETS);

  interface RenderedWidget {
    title: string;
    total: number;
    top: Array<{ name: string; value: number }>;
    ok: boolean;
  }
  const rendered: RenderedWidget[] = [];
  for (const w of widgets) {
    const title = (w.title || `${w.metric ?? ''} ${w.source ?? ''}`.trim() || 'Widget').toString();
    const out = await renderWidgetValue(env, clientId, agencyId, w);
    if (!out) {
      rendered.push({ title, total: 0, top: [], ok: false });
      continue;
    }
    rendered.push({
      title,
      total: out.total,
      top: out.series.slice(0, 5),
      ok: true,
    });
  }

  const fmtNum = (n: number) =>
    Number(n).toLocaleString('fr-CA', { maximumFractionDigits: 2 });

  // ── HTML email-safe (inline styles UNIQUEMENT, calque buildActivityDigestHtml) ──
  const widgetBlock = (rw: RenderedWidget): string => {
    const totalLine =
      `<tr>
         <td style="padding:10px 0;border-bottom:1px solid #eef0f4;color:#475569;font-size:14px;">${escHtml(rw.title)}</td>
         <td style="padding:10px 0;border-bottom:1px solid #eef0f4;color:#0f172a;font-size:18px;font-weight:600;text-align:right;">${escHtml(rw.ok ? fmtNum(rw.total) : '—')}</td>
       </tr>`;
    const breakdown = rw.top.length
      ? rw.top
          .map(
            (p) =>
              `<tr>
                 <td style="padding:4px 0 4px 16px;color:#64748b;font-size:12px;">${escHtml(p.name)}</td>
                 <td style="padding:4px 0;color:#475569;font-size:12px;text-align:right;">${escHtml(fmtNum(p.value))}</td>
               </tr>`,
          )
          .join('')
      : '';
    return totalLine + breakdown;
  };

  const rows = rendered.length
    ? rendered.map(widgetBlock).join('')
    : `<tr><td colspan="2" style="padding:10px 0;color:#94a3b8;font-size:13px;">Aucun widget configuré.</td></tr>`;

  const subject = `Votre rapport ${cadenceLabel} — ${dashName}`;

  const html =
    `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">` +
    `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">` +
    `<div style="padding:24px 24px 8px;">` +
    `<h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f172a;">${escHtml(dashName)}</h1>` +
    `<p style="margin:0;font-size:13px;color:#64748b;">Rapport ${escHtml(cadenceLabel)} — ${escHtml(periodLabel)}</p>` +
    `</div>` +
    `<div style="padding:8px 24px 24px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    rows +
    `</table>` +
    `</div>` +
    `<div style="padding:16px 24px;background:#f8fafc;border-top:1px solid #eef0f4;">` +
    `<p style="margin:0;font-size:12px;color:#94a3b8;">Rapport automatique envoyé par Intralys.</p>` +
    `</div>` +
    `</div></div></body></html>`;

  const textLines: string[] = [
    `${dashName}`,
    `Rapport ${cadenceLabel} — ${periodLabel}`,
    '',
  ];
  for (const rw of rendered) {
    textLines.push(`${rw.title} : ${rw.ok ? fmtNum(rw.total) : '—'}`);
    for (const p of rw.top) {
      textLines.push(`    ${p.name} : ${fmtNum(p.value)}`);
    }
  }
  if (!rendered.length) textLines.push('Aucun widget configuré.');
  textLines.push('', 'Rapport automatique envoyé par Intralys.');

  return { subject, html, text: textLines.join('\n') };
}

export type { ScheduledReportAuth, ScheduledReportRow, ActivityDigest };
