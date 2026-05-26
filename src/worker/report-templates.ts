// ══════════════════════════════════════════════════════════════════════════
// ██  Module Report Templates — SPRINT 15 « Reports builder — templates +
// ██  planif dashboard custom »  (Phase A SOLO posa les stubs — corps réels
// ██  Phase B Manager-B)
// ══════════════════════════════════════════════════════════════════════════
//
// GAP comblé : le Reports builder existe DÉJÀ à ~85% (DashboardBuilder.tsx
// drag-drop 8 visus + handleRunReportWidget moteur whitelist anti-injection
// reports.ts:644 + table `dashboards` seq 51 + dashboards.ts CRUD/share +
// scheduled-reports.ts cron + pdfExport). MANQUE : un CATALOGUE de modèles
// clonables. Ce module AJOUTE la lecture du catalogue (table `report_templates`
// seq 115) + l'APPLICATION d'un modèle (clone → nouveau `dashboards`).
//
// RÉUTILISE (NE RÉÉCRIT RIEN) :
//   - dashboards.ts handleCreateDashboard : la LOGIQUE de création/INSERT d'un
//     `dashboards` (+ ensureDashboardScope) est RÉUTILISÉE pour matérialiser le
//     clone (Phase B). Borné tenant.
//   - reports.ts whitelists ALLOWED_SOURCES / ALLOWED_DIMENSIONS / ALLOWED_METRICS
//     (handleRunReportWidget GELÉ, lecture seule) : la config JSON du template est
//     VALIDÉE widget par widget AVANT clone — JAMAIS de SQL libre, JAMAIS un
//     widget hors whitelist persisté dans dashboards.config.
//   - DashboardBuilderValue ({ cols, widgets[] }) : schéma de `config`.
//
// ⚠ BORNAGE TENANT — client_id / agency_id proviennent TOUJOURS de l'auth
//   (`resolveClientId`), JAMAIS du body / de l'URL. Lecture : templates SYSTÈME
//   (is_system=1, client_id NULL) UNION templates du tenant bornés. Clone :
//   nouveau dashboard borné au tenant courant.
//
// Capability mutualisée (calque dashboards.ts:387 — PAS de reports.manage qui
// n'existe pas) : LECTURE → 'reports.view' ; ÉCRITURE/CLONE → 'workflows.manage'.
// ZÉRO ajout à ALL_CAPABILITIES.
//
// Réponses { data } / { error } normalisées (apiFetch GELÉ, JAMAIS `code`).
//
// ⚠ ÉCART CODE > §6 (documenté §6.H / pièges §6.I.5) : reports.ts est GELÉ et
//   N'EXPORTE PAS ses whitelists (ALLOWED_SOURCES/ALLOWED_DIMENSIONS/
//   ALLOWED_METRICS sont module-privées). Le brief demande de « réutiliser les
//   whitelists sans les dupliquer » MAIS interdit de modifier reports.ts pour les
//   exporter. Contradiction §6 ↔ code réel ⇒ on suit le CODE RÉEL : on définit
//   ici des constantes de validation MIROIR alignées BYTE-pour-BYTE sur les Sets
//   de reports.ts (mêmes valeurs canoniques DashboardBuilder). C'est une
//   validation HANDLER (anti-injection : on REJETTE tout widget hors whitelist
//   AVANT le clone) — jamais du SQL libre. Si reports.ts exportait ses Sets, on
//   les importerait directement (1 ligne) ; le mirroring est l'unique voie sans
//   toucher au fichier gelé.
//
import type { Env } from './types';
import { json } from './helpers';
import type { CapAuth, Capability } from './capabilities';
import { requireCapability } from './capabilities';
import { handleCreateDashboard } from './dashboards';

// Auth enrichi tel que produit au choke-point worker.ts (authCtx) — calque
// DashboardAuth (dashboards.ts). `id` legacy historique conservé.
type ReportTemplateAuth = CapAuth & {
  capabilities?: Set<string>;
  id?: string;
};

// Garde capability mode-agence-only (calque dashboards.ts:reportsCapGuard) :
// legacy/mono-tenant non bridé, viewer bridé en mode agence.
function templatesCapGuard(
  auth: ReportTemplateAuth,
  cap: Capability,
): Response | undefined {
  if (!auth?.tenant || auth.tenant.agencyId == null) return undefined;
  if (!auth.capabilities) return undefined;
  return requireCapability(auth.capabilities, cap);
}

// Résout le client_id du tenant courant. Bornage tenant : provient TOUJOURS de
// l'auth, JAMAIS du body / de l'URL.
function resolveClientId(auth: ReportTemplateAuth): string | null {
  return (auth.tenant?.clientId ?? auth.clientId ?? null) as string | null;
}

// ── Whitelists MIROIR de reports.ts (GELÉ, non exporté — cf. ÉCART en tête) ──
// Valeurs alignées EXACTEMENT sur reports.ts:254/268/271 (ALLOWED_SOURCES /
// ALLOWED_METRICS / ALLOWED_DIMENSIONS). Servent UNIQUEMENT à VALIDER la config
// d'un template AVANT clone (rejet 400 hors whitelist). Aucune requête SQL n'est
// construite ici — on délègue le rendu live à handleRunReportWidget (route
// gelée). Anti-injection : un widget hors whitelist n'est JAMAIS persisté.
const WL_SOURCES = new Set([
  'leads',
  'tasks',
  'conversations',
  'events',
  'invoices',
  'orders',
  'agency',
]);
const WL_METRICS = new Set(['count', 'sum', 'avg', 'median', 'min', 'max']);
const WL_DIMENSIONS = new Set([
  'source',
  'status',
  'type',
  'owner',
  'client',
  'date',
  'week',
  'month',
]);

// Parse JSON best-effort (calque dashboards.ts:safeParseJson).
function safeParseJson(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

interface ReportTemplateDbRow {
  id: string;
  client_id: string | null;
  agency_id: string | null;
  name: string | null;
  description: string | null;
  category: string | null;
  config: string | null;
  is_system: number | null;
}

// Sérialise une ligne DB → ReportTemplate (types.ts §6.B). config parsé
// best-effort (objet si JSON valide, sinon valeur brute / null).
function mapTemplate(row: ReportTemplateDbRow) {
  return {
    id: String(row.id),
    name: row.name ?? '',
    description: row.description ?? null,
    category: row.category ?? null,
    config: safeParseJson(row.config),
    is_system: Number(row.is_system) === 1 ? 1 : 0,
  };
}

// ── Validation config clone — { cols, widgets[] } widget par widget ──────────
// Réutilise les whitelists MIROIR (alignées reports.ts). Retourne la config
// normalisée si valide, ou null si structure / widget hors whitelist. JAMAIS de
// SQL : validation HANDLER pure (anti-injection avant INSERT).
interface ValidatedWidget {
  source: string;
  dimension?: string;
  metric: string;
  [k: string]: unknown;
}
interface ValidatedConfig {
  cols: number;
  widgets: ValidatedWidget[];
}

function validateTemplateConfig(raw: unknown): ValidatedConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  // cols : entier (DashboardBuilder => toujours 12), borné défensivement.
  const colsNum = Number(obj.cols);
  const cols = Number.isFinite(colsNum) && colsNum > 0 ? Math.round(colsNum) : 12;
  // widgets : tableau (peut être vide — dashboard vide clonable).
  if (!Array.isArray(obj.widgets)) return null;
  const widgets: ValidatedWidget[] = [];
  for (const w of obj.widgets) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
    const wr = w as Record<string, unknown>;
    const source = typeof wr.source === 'string' ? wr.source : '';
    const metric = typeof wr.metric === 'string' ? wr.metric : '';
    // dimension OPTIONNELLE (kpi sans groupBy) : si présente, doit être valide.
    const hasDim = wr.dimension != null && wr.dimension !== '';
    const dimension = hasDim ? String(wr.dimension) : undefined;

    if (!WL_SOURCES.has(source)) return null;
    if (!WL_METRICS.has(metric)) return null;
    if (hasDim && !WL_DIMENSIONS.has(dimension as string)) return null;

    // On conserve le widget TEL QUEL (byte-compatible DashboardBuilderValue),
    // seules source/dimension/metric sont contraintes par la whitelist.
    widgets.push({ ...(wr as object), source, metric, ...(hasDim ? { dimension } : {}) } as ValidatedWidget);
  }
  return { cols, widgets };
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/report-templates — catalogue (système + tenant). cap reports.view.
// ════════════════════════════════════════════════════════════════════════════
export async function handleGetReportTemplates(
  env: Env,
  auth: ReportTemplateAuth,
): Promise<Response> {
  const g = templatesCapGuard(auth, 'reports.view');
  if (g) return g;

  const clientId = resolveClientId(auth);

  try {
    // Templates SYSTÈME (is_system=1 AND client_id IS NULL) UNION templates du
    // tenant bornés (WHERE client_id = ?). Bornage depuis l'AUTH, JAMAIS body.
    // Si pas de clientId (legacy sans tenant) : seulement les templates système.
    let rows: ReportTemplateDbRow[] = [];
    if (clientId) {
      const { results } = await env.DB.prepare(
        `SELECT id, client_id, agency_id, name, description, category, config, is_system
           FROM report_templates
          WHERE (is_system = 1 AND client_id IS NULL)
             OR client_id = ?
          ORDER BY is_system DESC, datetime(COALESCE(updated_at, created_at)) DESC, id ASC`,
      )
        .bind(clientId)
        .all();
      rows = (results || []) as unknown as ReportTemplateDbRow[];
    } else {
      const { results } = await env.DB.prepare(
        `SELECT id, client_id, agency_id, name, description, category, config, is_system
           FROM report_templates
          WHERE is_system = 1 AND client_id IS NULL
          ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id ASC`,
      ).all();
      rows = (results || []) as unknown as ReportTemplateDbRow[];
    }

    const data = rows.map(mapTemplate);
    return json({ data });
  } catch (err) {
    // Table absente (seq 115 pas jouée) / panne ⇒ liste vide, JAMAIS 500.
    console.error('handleGetReportTemplates failed', err);
    return json({ data: [] });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/report-templates/:id/apply — clone un modèle → nouveau dashboard.
// cap workflows.manage. Retour { dashboard_id }.
// ════════════════════════════════════════════════════════════════════════════
export async function handleApplyReportTemplate(
  env: Env,
  auth: ReportTemplateAuth,
  id: string,
): Promise<Response> {
  const g = templatesCapGuard(auth, 'workflows.manage');
  if (g) return g;

  const clientId = resolveClientId(auth);

  // (1) Charger le template par `id` BORNÉ (système OU tenant courant). 404 si
  //     absent / hors périmètre (zéro leak cross-tenant). Bornage depuis l'AUTH.
  let row: ReportTemplateDbRow | null = null;
  try {
    if (clientId) {
      row = (await env.DB.prepare(
        `SELECT id, client_id, agency_id, name, description, category, config, is_system
           FROM report_templates
          WHERE id = ?
            AND ((is_system = 1 AND client_id IS NULL) OR client_id = ?)`,
      )
        .bind(id, clientId)
        .first()) as ReportTemplateDbRow | null;
    } else {
      // Legacy sans tenant : seuls les templates système sont applicables.
      row = (await env.DB.prepare(
        `SELECT id, client_id, agency_id, name, description, category, config, is_system
           FROM report_templates
          WHERE id = ? AND is_system = 1 AND client_id IS NULL`,
      )
        .bind(id)
        .first()) as ReportTemplateDbRow | null;
    }
  } catch (err) {
    // Table absente (seq 115 pas jouée) / panne : pas de leak, 404.
    console.error('handleApplyReportTemplate load failed', err);
    return json({ error: 'Modèle introuvable' }, 404);
  }
  if (!row) return json({ error: 'Modèle introuvable' }, 404);

  // (2) VALIDER la config JSON ({cols,widgets[]}) widget par widget via les
  //     whitelists (MIROIR reports.ts). Rejet 400 si structure invalide ou
  //     widget hors whitelist — JAMAIS de SQL libre, JAMAIS un widget hors
  //     whitelist persisté dans dashboards.config.
  const parsed = safeParseJson(row.config);
  const validated = validateTemplateConfig(parsed);
  if (!validated) {
    return json({ error: 'Configuration de modèle invalide' }, 400);
  }

  // (3) CLONER via la LOGIQUE de handleCreateDashboard (dashboards.ts) — INSERT
  //     dans dashboards.config borné tenant + ensureDashboardScope. On RÉUTILISE
  //     le handler EXISTANT (GELÉ, lecture/import) en lui forgeant une Request
  //     synthétique { name, config: <config VALIDÉE> }. Le bornage tenant +
  //     le scope sont gérés DANS handleCreateDashboard (depuis le MÊME auth).
  const cloneName = (row.name ?? 'Nouveau dashboard').toString().slice(0, 120);
  const syntheticReq = new Request('https://internal/api/dashboards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: cloneName, config: validated }),
  });

  let createResp: Response;
  try {
    // DashboardAuth & ReportTemplateAuth ont la MÊME forme structurelle
    // (CapAuth + capabilities? + id?) — TS structural typing accepte le passage.
    createResp = await handleCreateDashboard(syntheticReq, env, auth as never);
  } catch (err) {
    console.error('handleApplyReportTemplate clone failed', err);
    return json({ error: 'Échec de la création du dashboard' }, 500);
  }

  // handleCreateDashboard renvoie json({ data: { id, ... } }, 201) ou un 403
  // (capGuard) ; on relaie l'erreur telle quelle si non-2xx (zéro masquage).
  if (!createResp.ok) {
    return createResp;
  }

  let created: { data?: { id?: number | string | null } } = {};
  try {
    created = (await createResp.clone().json()) as typeof created;
  } catch {
    created = {};
  }
  const newId = created?.data?.id;
  if (newId == null) {
    return json({ error: 'Échec de la création du dashboard' }, 500);
  }

  // (4) Retour { dashboard_id } — id INTEGER du nouveau dashboard sérialisé en
  //     String (écart CODE > §6 : dashboards.id INTEGER autoincrement, helper
  //     front applyReportTemplate attend { dashboard_id: string }).
  return json({ data: { dashboard_id: String(newId) } }, 201);
}
