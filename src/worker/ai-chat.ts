// ── Module AI Workspace conversationnel — Intralys CRM (LOT G8, Assistant IA
//   global panel slide-over cmd+/ — 2026-05-20) ──────────────────────────────
//
// Assistant IA conversationnel produit : threads + messages persistés
// (ai_chat_threads / ai_chat_messages seq 91, PRÉFIXE ai_chat_* — DISTINCT de
// ai_conversations / ai_messages seq 7, qui est un bot lead-répondeur
// INTOUCHABLE). v1 READ-ONLY / DRAFT-ONLY strict.
//
// ✅ PHASE B Manager-B — CORPS RÉELS. Signatures FIGÉES Phase A préservées. Le
//   helper LLM multi-tour est LOCAL à CE fichier (src/worker/ai.ts READ-ONLY,
//   NON modifié). Tools tool-calling Anthropic READ-ONLY/DRAFT-ONLY exécutés
//   worker-side, bornés `WHERE client_id = ?` depuis l'AUTH uniquement.
//
// ── ARCHITECTURE ───────────────────────────────────────────────────────────
//   - LLM : Claude Haiku 4.5 via Anthropic, helper LOCAL `callLLMChat` (fetch
//     MULTI-TOUR + tools). Calque le pattern fetch de ai.ts:29-42 (x-api-key /
//     anthropic-version 2023-06-01 / model 'claude-haiku-4-5') + fallback
//     mock RÉPLIQUÉ localement (isAiMockMode : USE_MOCKS==='true' || pas de clé).
//   - Option B+ : prompt-stuffing (résumé tenant DÉTERMINISTE calculé en SQL
//     borné, SANS LLM) dans le system prompt + tools READ-ONLY exécutés
//     worker-side. Le LLM ne touche JAMAIS D1.
//   - Boucle tool-calling worker-side, MAX 3 tours d'outils.
//
// ── 🚨 FLAG SÉCURITÉ #1 — RAG CROSS-TENANT (RESPECTÉ) ───────────────────────
//   CHAQUE tool exécuté worker-side reçoit `client_id` depuis `auth`
//   (scopeClientId), JAMAIS du body ni de l'output LLM. Le LLM ne voit aucun
//   identifiant tenant : les schémas de tools n'exposent AUCUN champ client_id.
//   Tous les tools v1 sont paramétrés + whitelistés + bornés `WHERE
//   client_id = ?`. AUCUN SQL libre ni nom de table dynamique. handleAiSummarize
//   Leads legacy (qui lit SANS client_id) N'EST PAS réutilisé : chaque tool
//   AJOUTE `AND client_id = ?` (ou skip si pas de tenant — legacy strict).
//
// ── 🚨 FLAG SÉCURITÉ #2 — EXÉCUTION ACTIONS (RESPECTÉ) ──────────────────────
//   v1 READ-ONLY / DRAFT-ONLY STRICT. AUCUN tool mutant métier (pas INSERT/
//   UPDATE/DELETE applicatif via tool, pas d'envoi email/SMS). Les SEULS
//   INSERT/UPDATE sont sur ai_chat_threads / ai_chat_messages (la conversation
//   elle-même) + thread.updated_at/title. « Crée un workflow » → draft_workflow
//   renvoie un JSON draft → l'UI propose « Créer » → confirmation HUMAINE.

import type { Env } from './types';
import { json } from './helpers';
import { fetchWithTimeout } from './lib/fetch-timeout';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
// SPRINT 11 — handlers MÉTIER EXISTANTS réutilisés pour l'EXÉCUTION des actions
// confirmées (NON modifiés ; imports relatifs worker). §6.C.
import { handleCreateTask } from './tasks';
import { handlePatchLead, handleAddTag } from './leads';

// Auth enrichi au choke-point (worker.ts) — calque SegmentAuth/FunnelAuth :
// userId/role/clientId/tenant + capabilities injecté.
export type AiChatAuth = CapAuth & { capabilities?: Set<string> };

// ── Garde capability (calque segments.ts / funnels.ts / LOT B-bis) ──────────
// Réutilise 'ai.use' (déjà dans ALL_CAPABILITIES, ZÉRO ajout). En legacy/
// mono-tenant le set est LARGE ⇒ pas de régression ; bridage viewer actif
// seulement en mode agence (agencyId != null, porté par resolveCapabilities).
function capGuard(auth: AiChatAuth): Response | undefined {
  return requireCapability(auth.capabilities, 'ai.use');
}

// Récupère le client_id de bornage depuis l'AUTH UNIQUEMENT (jamais body/LLM —
// FLAG sécurité #1). Optionnel (legacy/mono-tenant ⇒ NULL ⇒ pas de filtre).
// Exporté pour réutilisation par les tools READ-ONLY.
export function scopeClientId(auth: AiChatAuth): string | null {
  return auth.tenant?.clientId ?? auth.clientId ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPER LLM MULTI-TOUR LOCAL — calque ai.ts:29-42 mais messages[] + tools[]
// (ai.ts callLLM = mono-tour, NON modifié). Mock fallback répliqué localement.
// ════════════════════════════════════════════════════════════════════════════

const AI_CHAT_MODEL = 'claude-haiku-4-5';
const AI_CHAT_MAX_TOKENS = 1500;

// Réplique EXACTE de la condition isAiMockMode(ai.ts:15-17) — pas d'import
// pour ne pas coupler au fichier READ-ONLY ; même source de vérité (env).
function isAiChatMockMode(env: Env): boolean {
  return env.USE_MOCKS === 'true' || !env.ANTHROPIC_API_KEY;
}

type LlmRole = 'user' | 'assistant';

// Bloc de contenu Anthropic (texte OU tool_use OU tool_result), format API.
type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface LlmMessage {
  role: LlmRole;
  content: string | LlmContentBlock[];
}

interface ToolSchema {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

interface LlmTurnResult {
  stopReason: string;
  text: string;
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  tokensUsed: number;
}

/**
 * Un tour d'appel Anthropic Messages (multi-tour + tools). Calque le fetch de
 * ai.ts:29-42. En mock → réponse déterministe plausible (pas de tool_use, pas
 * de crash offline). NE THROW JAMAIS : en cas d'erreur réseau renvoie un tour
 * texte vide stopReason 'error' (l'appelant dégrade proprement).
 */
async function callLLMChatTurn(
  env: Env,
  systemPrompt: string,
  messages: LlmMessage[],
  tools: ToolSchema[],
): Promise<LlmTurnResult> {
  if (isAiChatMockMode(env)) {
    await new Promise((r) => setTimeout(r, 400));
    return {
      stopReason: 'end_turn',
      text: mockAssistantReply(messages),
      toolUses: [],
      tokensUsed: 0,
    };
  }

  try {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AI_CHAT_MODEL,
        max_tokens: AI_CHAT_MAX_TOKENS,
        system: systemPrompt,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as {
      stop_reason?: string;
      content?: Array<Record<string, unknown>>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const blocks = data.content || [];
    let text = '';
    const toolUses: LlmTurnResult['toolUses'] = [];
    for (const b of blocks) {
      if (b.type === 'text' && typeof b.text === 'string') text += b.text;
      else if (b.type === 'tool_use') {
        toolUses.push({
          id: String(b.id || ''),
          name: String(b.name || ''),
          input: (b.input as Record<string, unknown>) || {},
        });
      }
    }
    const tokensUsed =
      (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

    return { stopReason: data.stop_reason || 'end_turn', text, toolUses, tokensUsed };
  } catch (err) {
    console.error('AI chat LLM error:', err);
    // Dégradation propre : pas de crash, message texte de repli.
    return {
      stopReason: 'error',
      text:
        "Désolé, je ne peux pas répondre pour le moment (le service IA est momentanément indisponible). Réessaie dans un instant.",
      toolUses: [],
      tokensUsed: 0,
    };
  }
}

// Réponse mock déterministe (offline / pas de clé API). Tient compte du dernier
// message user pour rester plausible, mais ne fait AUCUN tool-calling.
function mockAssistantReply(messages: LlmMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const txt =
    typeof lastUser?.content === 'string'
      ? lastUser.content
      : (lastUser?.content || [])
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join(' ');
  const q = (txt || '').toLowerCase();
  if (/revenu|chiffre|ca\b|ventes|facture/.test(q)) {
    return "Voici un aperçu (mode démo) : ton chiffre d'affaires du mois est stable. Active une clé Anthropic pour des chiffres calculés en direct sur tes données.";
  }
  if (/lead|prospect|client/.test(q)) {
    return "En mode démo, je résume : tu as quelques leads chauds à relancer cette semaine. Connecte la clé IA pour une analyse réelle bornée à ton compte.";
  }
  if (/rendez|rdv|agenda|calendrier|appel/.test(q)) {
    return "Mode démo : aucun rendez-vous réel chargé. Avec la clé IA active, je liste tes prochains RDV directement depuis ton agenda.";
  }
  if (/email|courriel|relance|message|brouillon/.test(q)) {
    return "Voici un brouillon (démo) :\n\nBonjour,\n\nJe reviens vers vous suite à notre échange. Seriez-vous disponible cette semaine pour un court appel?\n\nCordialement";
  }
  return "Je suis ton assistant Intralys (mode démo, sans clé IA). Je peux résumer tes leads, ton chiffre d'affaires, tes rendez-vous et rédiger des brouillons. Configure ANTHROPIC_API_KEY pour des réponses calculées sur tes données réelles.";
}

// ════════════════════════════════════════════════════════════════════════════
// TOOLS READ-ONLY / DRAFT-ONLY BORNÉS TENANT (FLAG #1 + #2)
// Chaque tool reçoit (env, auth, args). client_id vient TOUJOURS de scopeClientId
// (auth), JAMAIS de args. Aucun SQL libre, aucun nom de table dynamique.
// ════════════════════════════════════════════════════════════════════════════

// Helper de bornage : ajoute `AND <col> = ?` si tenant connu, sinon skip
// (legacy/mono-tenant strict — calque handleGetInvoices : filtre seulement si
// auth.clientId présent). Le client_id n'est JAMAIS lu depuis le LLM.
function tenantClause(col: string, clientId: string | null): { sql: string; bind: string[] } {
  return clientId ? { sql: ` AND ${col} = ?`, bind: [clientId] } : { sql: '', bind: [] };
}

// ── Schémas exposés au LLM (AUCUN champ client_id — FLAG #1) ─────────────────
const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'query_leads',
    description:
      "Liste des leads du compte filtrés (statut, source, score minimum, tag). Retourne nom, statut, source, score, valeur estimée. Lecture seule.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'won', 'closed', 'lost'], description: 'Filtre par statut.' },
        source: { type: 'string', description: 'Filtre par source (meta, google, website, referral, manual, direct).' },
        score_min: { type: 'integer', description: 'Score minimum (0-100), ex 70 pour leads chauds.' },
        tag: { type: 'string', description: 'Filtre par tag exact.' },
        limit: { type: 'integer', description: 'Nombre max de leads (défaut 25, max 50).' },
      },
    },
  },
  {
    name: 'get_revenue',
    description:
      "Chiffre d'affaires du compte (factures payées + commandes payées) ventilé par devise sur une période. Lecture seule. Ne somme JAMAIS des devises différentes.",
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['month', 'quarter', 'year', 'all'], description: 'Période (défaut month).' },
      },
    },
  },
  {
    name: 'get_lead_stats',
    description: "Répartition du nombre de leads par statut pour le compte. Lecture seule.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_calendar',
    description: "Prochains rendez-vous/appointments à venir du compte. Lecture seule.",
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: "Nombre de jours à venir (défaut 14, max 60)." },
      },
    },
  },
  {
    name: 'draft_email',
    description:
      "Rédige un BROUILLON d'email (n'envoie RIEN) pour un lead optionnel selon une intention. Retourne le texte. Confirmation humaine requise pour tout envoi.",
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'ID du lead concerné (optionnel).' },
        intent: { type: 'string', description: "Intention : relance, bienvenue, proposition, suivi, etc." },
      },
      required: ['intent'],
    },
  },
  {
    name: 'explain_lead_score',
    description: "Explique le score d'un lead en décomposant les signaux (source, valeur, récence, statut). Lecture seule.",
    input_schema: {
      type: 'object',
      properties: { lead_id: { type: 'string', description: 'ID du lead.' } },
      required: ['lead_id'],
    },
  },
  {
    name: 'summarize',
    description: "Résume un texte fourni par l'utilisateur (pas d'accès aux données). Retourne le résumé.",
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Texte à résumer.' } },
      required: ['text'],
    },
  },
  {
    name: 'draft_workflow',
    description:
      "Génère un BROUILLON de workflow d'automatisation (JSON) selon un objectif. Ne crée RIEN — l'utilisateur confirme la création ensuite. DRAFT only.",
    input_schema: {
      type: 'object',
      properties: { goal: { type: 'string', description: "Objectif du workflow (ex : relancer les nouveaux leads)." } },
      required: ['goal'],
    },
  },
  // ── SPRINT 11 — 3 tools ACTION en mode « PROPOSE » (FLAG #2) ────────────────
  // Ces tools N'EXÉCUTENT RIEN : ils retournent une PROPOSITION { tool, args,
  // label } que l'UI affiche pour confirmation HUMAINE. AUCUN champ tenant
  // exposé au LLM (FLAG #1) : client_id est forcé à scopeClientId(auth) à
  // l'exécution (handleConfirmAiAction), JAMAIS pris des args du LLM.
  {
    name: 'create_task',
    description:
      "PROPOSE la création d'une tâche (rappel, suivi, action). N'exécute RIEN — l'utilisateur devra confirmer. Précise un titre clair. lead_id optionnel pour rattacher la tâche à un lead du compte.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre de la tâche (requis).' },
        description: { type: 'string', description: 'Détail optionnel.' },
        due_date: { type: 'string', description: "Échéance ISO (YYYY-MM-DD) optionnelle." },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Priorité (défaut medium).' },
        lead_id: { type: 'string', description: 'ID du lead à rattacher (optionnel).' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_lead_status',
    description:
      "PROPOSE le changement de statut d'un lead du compte. N'exécute RIEN — confirmation humaine requise. Statuts valides : new, contacted, qualified, won, closed, lost.",
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'ID du lead.' },
        status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'won', 'closed', 'lost'], description: 'Nouveau statut.' },
      },
      required: ['lead_id', 'status'],
    },
  },
  {
    name: 'add_lead_tag',
    description:
      "PROPOSE l'ajout d'une étiquette (tag) à un lead du compte. N'exécute RIEN — confirmation humaine requise.",
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'ID du lead.' },
        tag: { type: 'string', description: "Étiquette à ajouter (ex : « prioritaire »)." },
      },
      required: ['lead_id', 'tag'],
    },
  },
];

// ── SPRINT 11 — tools action whitelistés + construction de PROPOSITION ───────
// Le tool action n'exécute AUCUNE mutation dans runChatLoop : il retourne une
// PROPOSITION sérialisable. L'exécution réelle ne se fait QUE via
// handleConfirmAiAction (confirmation humaine — FLAG #2).
const ACTION_TOOLS = ['create_task', 'update_lead_status', 'add_lead_tag'] as const;
type ActionTool = (typeof ACTION_TOOLS)[number];

function isActionTool(name: string): name is ActionTool {
  return (ACTION_TOOLS as readonly string[]).includes(name);
}

// Phrase de confirmation FR DÉTERMINISTE (label affiché dans la carte d'action).
// N'expose AUCUN client_id. Calque le ton québécois du chat G8.
function buildActionLabel(tool: ActionTool, args: Record<string, unknown>): string {
  switch (tool) {
    case 'create_task': {
      const title = typeof args.title === 'string' ? args.title : 'sans titre';
      return `Créer la tâche « ${title} » ?`;
    }
    case 'update_lead_status': {
      const status = typeof args.status === 'string' ? args.status : '';
      return `Changer le statut du lead vers « ${status} » ?`;
    }
    case 'add_lead_tag': {
      const tag = typeof args.tag === 'string' ? args.tag : '';
      return `Ajouter l'étiquette « ${tag} » au lead ?`;
    }
  }
}

// Une proposition d'action sûre (calque AiProposedAction de types.ts, GELÉ).
interface ProposedActionInternal {
  id: string;
  tool: ActionTool;
  args: Record<string, unknown>;
  label: string;
}

// Construit une proposition depuis un tool_use action. id stable = base de la
// revalidation de l'action_id à la confirmation (tracé dans tool_calls JSON).
function buildProposedAction(tool: ActionTool, args: Record<string, unknown>): ProposedActionInternal {
  return { id: crypto.randomUUID(), tool, args, label: buildActionLabel(tool, args) };
}

// ── query_leads : requête PARAMÉTRÉE whitelistée, bornée client_id (auth) ────
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'closed', 'lost'];

async function toolQueryLeads(env: Env, auth: AiChatAuth, args: Record<string, unknown>): Promise<unknown> {
  const clientId = scopeClientId(auth);
  const tc = tenantClause('client_id', clientId);
  const params: unknown[] = [];
  let sql = 'SELECT id, name, status, source, score, deal_value FROM leads WHERE 1=1' + tc.sql;
  params.push(...tc.bind);

  const status = typeof args.status === 'string' ? args.status : '';
  if (status && LEAD_STATUSES.includes(status)) {
    sql += ' AND status = ?';
    params.push(status);
  }
  const source = typeof args.source === 'string' ? args.source.slice(0, 40) : '';
  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }
  const scoreMin = Number(args.score_min);
  if (Number.isFinite(scoreMin)) {
    sql += ' AND score >= ?';
    params.push(Math.max(0, Math.min(100, Math.round(scoreMin))));
  }
  const tag = typeof args.tag === 'string' ? args.tag.slice(0, 60) : '';
  if (tag) {
    // tag via jointure bornée : lead_tags d'un lead du tenant courant.
    sql += ' AND id IN (SELECT lead_id FROM lead_tags WHERE tag = ?)';
    params.push(tag);
  }
  const limit = Math.max(1, Math.min(50, Number(args.limit) || 25));
  sql += ' ORDER BY score DESC, updated_at DESC LIMIT ?';
  params.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...params).all();
  const leads = (results || []) as Array<Record<string, unknown>>;
  return {
    count: leads.length,
    leads: leads.map((l) => ({
      name: l.name,
      status: l.status,
      source: l.source,
      score: l.score,
      deal_value: l.deal_value,
    })),
  };
}

// ── get_revenue : SUM factures payées + commandes payées, PAR DEVISE ─────────
// (multi-devise : jamais sommer des devises différentes — calque ecommerce-
// analytics). Borné client_id (auth). Legacy sans tenant ⇒ pas de filtre.
function periodSince(period: string): string {
  const p = period === 'quarter' ? '-3 months' : period === 'year' ? '-12 months' : period === 'all' ? '-100 years' : '-1 month';
  return p; // utilisé via datetime('now', ?)
}

async function toolGetRevenue(env: Env, auth: AiChatAuth, args: Record<string, unknown>): Promise<unknown> {
  const clientId = scopeClientId(auth);
  const period = typeof args.period === 'string' ? args.period : 'month';
  const sinceExpr = periodSince(period);
  const byCurrency = new Map<string, { invoices: number; orders: number }>();

  // Factures payées (invoices.amount REAL, devise CAD par défaut, status 'paid').
  {
    const tc = tenantClause('client_id', clientId);
    const rows = await env.DB.prepare(
      `SELECT UPPER(COALESCE(NULLIF(currency, ''), 'CAD')) AS cur, COALESCE(SUM(amount), 0) AS total
         FROM invoices
        WHERE status = 'paid' AND created_at >= datetime('now', ?)${tc.sql}
        GROUP BY cur`,
    ).bind(sinceExpr, ...tc.bind).all();
    for (const r of (rows.results || []) as Array<{ cur: string; total: number }>) {
      const cur = r.cur || 'CAD';
      const e = byCurrency.get(cur) || { invoices: 0, orders: 0 };
      e.invoices += Number(r.total) || 0;
      byCurrency.set(cur, e);
    }
  }

  // Commandes payées (orders.total_cents, devise propre). Best-effort : la table
  // orders peut ne pas exister sur un compte CRM-only ⇒ try/catch silencieux.
  try {
    const tc = tenantClause('client_id', clientId);
    const rows = await env.DB.prepare(
      `SELECT UPPER(COALESCE(NULLIF(currency, ''), 'CAD')) AS cur, COALESCE(SUM(total_cents), 0) AS total_cents
         FROM orders
        WHERE status IN ('paid', 'fulfilled', 'completed') AND COALESCE(placed_at, created_at) >= datetime('now', ?)${tc.sql}
        GROUP BY cur`,
    ).bind(sinceExpr, ...tc.bind).all();
    for (const r of (rows.results || []) as Array<{ cur: string; total_cents: number }>) {
      const cur = r.cur || 'CAD';
      const e = byCurrency.get(cur) || { invoices: 0, orders: 0 };
      e.orders += (Number(r.total_cents) || 0) / 100;
      byCurrency.set(cur, e);
    }
  } catch {
    /* table orders absente (compte sans e-commerce) — best-effort */
  }

  const breakdown = [...byCurrency.entries()].map(([currency, v]) => ({
    currency,
    invoices_total: Math.round(v.invoices * 100) / 100,
    orders_total: Math.round(v.orders * 100) / 100,
    total: Math.round((v.invoices + v.orders) * 100) / 100,
  }));
  return { period, by_currency: breakdown, note: 'Montants ventilés par devise (jamais additionnés entre devises).' };
}

async function toolGetLeadStats(env: Env, auth: AiChatAuth): Promise<unknown> {
  const clientId = scopeClientId(auth);
  const tc = tenantClause('client_id', clientId);
  const rows = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM leads WHERE 1=1${tc.sql} GROUP BY status`,
  ).bind(...tc.bind).all();
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of (rows.results || []) as Array<{ status: string; n: number }>) {
    const s = r.status || 'inconnu';
    byStatus[s] = Number(r.n) || 0;
    total += byStatus[s];
  }
  return { total, by_status: byStatus };
}

async function toolGetCalendar(env: Env, auth: AiChatAuth, args: Record<string, unknown>): Promise<unknown> {
  const clientId = scopeClientId(auth);
  const days = Math.max(1, Math.min(60, Number(args.days) || 14));
  const tc = tenantClause('client_id', clientId);
  const rows = await env.DB.prepare(
    `SELECT title, start_time, end_time, status
       FROM appointments
      WHERE start_time >= datetime('now') AND start_time <= datetime('now', ?)${tc.sql}
      ORDER BY start_time ASC LIMIT 50`,
  ).bind(`+${days} days`, ...tc.bind).all();
  const appts = (rows.results || []) as Array<Record<string, unknown>>;
  return {
    days_ahead: days,
    count: appts.length,
    appointments: appts.map((a) => ({ title: a.title, start_time: a.start_time, end_time: a.end_time, status: a.status })),
  };
}

// ── draft_email : RÉPLIQUE la logique brand_voice/lead de handleAiGenerate
//   (ai.ts) mais BORNÉE client_id (le legacy lit lead SANS client_id — FLAG #1).
//   DRAFT only, n'envoie RIEN.
async function toolDraftEmail(env: Env, auth: AiChatAuth, args: Record<string, unknown>): Promise<unknown> {
  const clientId = scopeClientId(auth);
  const intent = typeof args.intent === 'string' ? args.intent.slice(0, 200) : 'relance';
  const leadId = typeof args.lead_id === 'string' ? args.lead_id : '';

  let brandVoice = 'Professionnel, rassurant et québécois naturel.';
  let leadContext = '';
  if (leadId) {
    const tc = tenantClause('client_id', clientId);
    const lead = await env.DB.prepare(
      `SELECT name, email, status, source, message, client_id FROM leads WHERE id = ?${tc.sql}`,
    ).bind(leadId, ...tc.bind).first() as Record<string, unknown> | null;
    if (lead) {
      leadContext = `Lead: ${JSON.stringify({ name: lead.name, status: lead.status, source: lead.source })}.`;
      // brand_voice bornée au client du lead (lui-même borné tenant ci-dessus).
      if (lead.client_id) {
        const c = await env.DB.prepare('SELECT brand_voice FROM clients WHERE id = ?')
          .bind(lead.client_id).first() as { brand_voice?: string } | null;
        if (c?.brand_voice) brandVoice = c.brand_voice;
      }
    }
  } else if (clientId) {
    const c = await env.DB.prepare('SELECT brand_voice FROM clients WHERE id = ?')
      .bind(clientId).first() as { brand_voice?: string } | null;
    if (c?.brand_voice) brandVoice = c.brand_voice;
  }

  const sys = `Tu es un assistant IA pour une PME au Québec. Ton du client : ${brandVoice}. \
Utilise un français québécois naturel, chaleureux et professionnel. Génère UNIQUEMENT le corps \
d'un email selon l'intention demandée, max 150 mots, sans préambule ni guillemets.`;
  const userPrompt = `Intention : ${intent}. ${leadContext}`;
  const result = await callLLMChatTurn(env, sys, [{ role: 'user', content: userPrompt }], []);
  return { draft: result.text.trim(), intent, note: 'Brouillon — aucun envoi effectué. Confirmation humaine requise.' };
}

// ── explain_lead_score : recalcul/explication bornée client_id ───────────────
async function toolExplainLeadScore(env: Env, auth: AiChatAuth, args: Record<string, unknown>): Promise<unknown> {
  const clientId = scopeClientId(auth);
  const leadId = typeof args.lead_id === 'string' ? args.lead_id : '';
  if (!leadId) return { error: 'lead_id requis' };
  const tc = tenantClause('client_id', clientId);
  const lead = await env.DB.prepare(
    `SELECT name, status, source, score, deal_value, updated_at FROM leads WHERE id = ?${tc.sql}`,
  ).bind(leadId, ...tc.bind).first() as Record<string, unknown> | null;
  if (!lead) return { error: 'Lead introuvable dans ton compte.' };

  const signals: Array<{ signal: string; detail: string }> = [];
  const score = Number(lead.score) || 0;
  signals.push({ signal: 'score', detail: `Score actuel ${score}/100.` });
  const src = String(lead.source || '').toLowerCase();
  if (src) signals.push({ signal: 'source', detail: `Source « ${src} » — qualité variable selon le canal.` });
  const val = Number(lead.deal_value) || 0;
  if (val > 0) signals.push({ signal: 'valeur', detail: `Valeur estimée ${val.toLocaleString('fr-CA')} $.` });
  signals.push({ signal: 'statut', detail: `Statut « ${lead.status}».` });
  const days = Math.floor((Date.now() - new Date(String(lead.updated_at)).getTime()) / 86400000);
  if (Number.isFinite(days)) signals.push({ signal: 'récence', detail: `${days} jour(s) depuis la dernière activité.` });

  return { name: lead.name, score, signals };
}

async function toolSummarize(args: Record<string, unknown>): Promise<unknown> {
  // Pas d'accès D1 — le LLM résumera ; on renvoie juste le texte (passthrough).
  const text = typeof args.text === 'string' ? args.text.slice(0, 6000) : '';
  if (!text) return { error: 'Aucun texte fourni.' };
  return { text };
}

// ── draft_workflow : RÉPLIQUE la logique JSON de handleAiSuggestWorkflow
//   (workflows VALID_TYPES) mais via le LLM local, DRAFT only — ne crée RIEN.
const WORKFLOW_VALID_TYPES = ['wait', 'email', 'sms', 'task', 'condition', 'tag', 'notification'];

async function toolDraftWorkflow(env: Env, _auth: AiChatAuth, args: Record<string, unknown>): Promise<unknown> {
  const goal = typeof args.goal === 'string' ? args.goal.slice(0, 400) : '';
  if (!goal) return { error: 'goal requis' };
  const sys = `Tu es un expert en automatisation marketing pour PMEs québécoises. \
Génère un objet JSON workflow Intralys : { "name", "description", "trigger_type": \
"lead_created|form_submitted|tag_added|manual", "steps": [{ "id", "type" (${WORKFLOW_VALID_TYPES.join('|')}), "config" }] }. \
Max 6 étapes. Réponds UNIQUEMENT avec le JSON valide, sans markdown.`;
  const result = await callLLMChatTurn(env, sys, [{ role: 'user', content: goal }], []);
  let draft: Record<string, unknown> | null = null;
  try {
    const m = result.text.match(/\{[\s\S]*\}/);
    if (m) {
      const wf = JSON.parse(m[0]) as { steps?: Array<{ type: string }> };
      if (Array.isArray(wf.steps)) wf.steps = wf.steps.filter((s) => WORKFLOW_VALID_TYPES.includes(s.type));
      draft = wf as Record<string, unknown>;
    }
  } catch {
    /* fallback ci-dessous */
  }
  if (!draft) {
    draft = {
      name: 'Bienvenue nouveau lead',
      description: 'Séquence de bienvenue automatique',
      trigger_type: 'lead_created',
      steps: [
        { id: 'step-1', type: 'wait', config: { delay_hours: 1 } },
        { id: 'step-2', type: 'email', config: { subject: 'Bienvenue!', body: 'Bonjour {{lead.name}}, merci de nous avoir contactés.' } },
      ],
    };
  }
  return { workflow_draft: draft, note: 'Brouillon — rien créé. Confirmation humaine requise pour POST /api/workflows.' };
}

// ── Dispatcher de tools (worker-side). client_id TOUJOURS depuis auth. ───────
async function executeTool(
  env: Env,
  auth: AiChatAuth,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      case 'query_leads': return await toolQueryLeads(env, auth, input);
      case 'get_revenue': return await toolGetRevenue(env, auth, input);
      case 'get_lead_stats': return await toolGetLeadStats(env, auth);
      case 'get_calendar': return await toolGetCalendar(env, auth, input);
      case 'draft_email': return await toolDraftEmail(env, auth, input);
      case 'explain_lead_score': return await toolExplainLeadScore(env, auth, input);
      case 'summarize': return await toolSummarize(input);
      case 'draft_workflow': return await toolDraftWorkflow(env, auth, input);
      default: return { error: `Outil inconnu : ${name}` };
    }
  } catch (err) {
    console.error(`AI chat tool error (${name}):`, err);
    return { error: 'Outil indisponible momentanément.' };
  }
}

// ── Boucle tool-calling worker-side, MAX 3 tours d'outils ────────────────────
interface ChatLoopResult {
  text: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  tokensUsed: number;
  // SPRINT 11 — propositions d'actions sûres émises par le LLM ce tour. AUCUNE
  // mutation exécutée ici (FLAG #2) ; l'exécution passe par handleConfirmAiAction.
  proposedActions: ProposedActionInternal[];
}

async function runChatLoop(
  env: Env,
  auth: AiChatAuth,
  systemPrompt: string,
  history: LlmMessage[],
): Promise<ChatLoopResult> {
  const messages: LlmMessage[] = [...history];
  const toolCalls: ChatLoopResult['toolCalls'] = [];
  const proposedActions: ProposedActionInternal[] = [];
  let tokensUsed = 0;
  let finalText = '';

  const MAX_TOOL_TURNS = 3;
  for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
    const result = await callLLMChatTurn(env, systemPrompt, messages, TOOL_SCHEMAS);
    tokensUsed += result.tokensUsed;
    finalText = result.text;

    if (result.stopReason !== 'tool_use' || result.toolUses.length === 0 || turn === MAX_TOOL_TURNS) {
      break;
    }

    // Rejoue le tour assistant (tool_use) puis renvoie les résultats d'outils.
    const assistantBlocks: LlmContentBlock[] = [];
    if (result.text) assistantBlocks.push({ type: 'text', text: result.text });
    for (const tu of result.toolUses) {
      assistantBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    const toolResults: LlmContentBlock[] = [];
    for (const tu of result.toolUses) {
      toolCalls.push({ name: tu.name, input: tu.input });
      if (isActionTool(tu.name)) {
        // FLAG #2 : un tool ACTION n'exécute RIEN ici. On construit une
        // PROPOSITION (confirmation humaine requise via handleConfirmAiAction) et
        // on renvoie au LLM un tool_result l'informant que l'action est PROPOSÉE,
        // pas exécutée — il ne doit jamais affirmer qu'elle est faite.
        const proposal = buildProposedAction(tu.name, tu.input || {});
        proposedActions.push(proposal);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({
            proposed: true,
            action_id: proposal.id,
            label: proposal.label,
            note: "Action PROPOSÉE — non exécutée. L'utilisateur doit confirmer dans l'interface. Ne dis jamais que c'est fait.",
          }),
        });
        continue;
      }
      const out = await executeTool(env, auth, tu.name, tu.input);
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { text: finalText, toolCalls, tokensUsed, proposedActions };
}

// ════════════════════════════════════════════════════════════════════════════
// RÉSUMÉ TENANT DÉTERMINISTE (SQL borné, SANS LLM) — injecté au system prompt.
// Chaque sous-requête bornée client_id (auth). Best-effort : toute panne D1 est
// avalée (ne bloque jamais la conversation). FLAG #1 : tenant = auth only.
// ════════════════════════════════════════════════════════════════════════════
async function buildTenantSummary(env: Env, auth: AiChatAuth): Promise<string> {
  const clientId = scopeClientId(auth);
  const tc = tenantClause('client_id', clientId);
  const parts: string[] = [];

  try {
    const rows = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM leads WHERE 1=1${tc.sql} GROUP BY status`,
    ).bind(...tc.bind).all();
    const counts = (rows.results || []) as Array<{ status: string; n: number }>;
    if (counts.length > 0) {
      const total = counts.reduce((s, r) => s + (Number(r.n) || 0), 0);
      const detail = counts.map((r) => `${r.n} ${r.status}`).join(', ');
      parts.push(`Leads : ${total} au total (${detail}).`);
    }
  } catch { /* best-effort */ }

  try {
    const tcInv = tenantClause('client_id', clientId);
    const rev = await env.DB.prepare(
      `SELECT UPPER(COALESCE(NULLIF(currency, ''), 'CAD')) AS cur, COALESCE(SUM(amount), 0) AS total
         FROM invoices
        WHERE status = 'paid' AND created_at >= datetime('now', '-1 month')${tcInv.sql}
        GROUP BY cur`,
    ).bind(...tcInv.bind).all();
    const byCur = (rev.results || []) as Array<{ cur: string; total: number }>;
    if (byCur.length > 0) {
      const detail = byCur.map((r) => `${(Number(r.total) || 0).toLocaleString('fr-CA')} ${r.cur}`).join(' · ');
      parts.push(`Factures payées (30 derniers jours) : ${detail}.`);
    }
  } catch { /* best-effort */ }

  try {
    const tcAppt = tenantClause('client_id', clientId);
    const appt = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM appointments
        WHERE start_time >= datetime('now') AND start_time <= datetime('now', '+14 days')${tcAppt.sql}`,
    ).bind(...tcAppt.bind).first() as { n: number } | null;
    if (appt && Number(appt.n) > 0) parts.push(`Rendez-vous à venir (14 jours) : ${appt.n}.`);
  } catch { /* best-effort */ }

  if (parts.length === 0) return 'Aucune donnée résumée disponible pour le moment.';
  return parts.join(' ');
}

// SPRINT 11 — pageContextLine / alertsLine sont DÉTERMINISTES, déjà re-bornés
// tenant (FLAG #1) avant d'arriver ici. Optionnels (chaîne vide = rien injecté).
function buildSystemPrompt(tenantSummary: string, pageContextLine = '', alertsLine = ''): string {
  return `Tu es l'assistant IA d'Intralys, un CRM pour PME francophones du Québec. \
Tu réponds en français québécois naturel, chaleureux et professionnel (pas parisien). \
Tu aides l'utilisateur à comprendre son pipeline, ses leads, son chiffre d'affaires et son agenda, \
et tu rédiges des brouillons (emails, workflows) à sa demande. \
\
RÈGLES STRICTES : \
- Tu n'exécutes JAMAIS de mutation directement. Pour répondre à une question sur les données, \
UTILISE les outils de lecture (query_leads, get_revenue, get_lead_stats, get_calendar, explain_lead_score). \
N'invente jamais de chiffres. \
- Pour rédiger un email ou un workflow, utilise draft_email / draft_workflow : ce sont des BROUILLONS. \
- Pour une ACTION sûre (créer une tâche, changer le statut d'un lead, ajouter une étiquette), utilise \
create_task / update_lead_status / add_lead_tag : ces outils PROPOSENT seulement l'action. \
L'utilisateur DOIT confirmer dans l'interface avant exécution — ne dis JAMAIS qu'une action est faite \
tant qu'elle n'est pas confirmée. \
- Réponses concises, orientées action. \
\
Contexte du compte (résumé déterministe à jour) : ${tenantSummary}${pageContextLine}${alertsLine}`;
}

// ── SPRINT 11 — Ligne « Page courante » (page_context RE-VALIDÉ + RE-BORNÉ) ──
// Le front envoie { route?, entity_type?, entity_id? }. Worker-side : si une
// entité est ciblée, on NE l'injecte QUE si elle appartient à scopeClientId(auth)
// (FLAG #1) — sinon on l'ignore silencieusement. Le LLM ne reçoit JAMAIS de
// client_id. Best-effort : toute panne D1 dégrade en ligne route seule.
async function buildPageContextLine(
  env: Env,
  auth: AiChatAuth,
  pageContext: { route?: string; entity_type?: string; entity_id?: string } | null,
): Promise<string> {
  if (!pageContext) return '';
  const route = typeof pageContext.route === 'string' ? pageContext.route.slice(0, 120) : '';
  const entityType = typeof pageContext.entity_type === 'string' ? pageContext.entity_type.slice(0, 40) : '';
  const entityId = typeof pageContext.entity_id === 'string' ? pageContext.entity_id.slice(0, 100) : '';
  const clientId = scopeClientId(auth);

  let entityDesc = '';
  if (entityType && entityId) {
    try {
      if (entityType === 'lead') {
        const tc = tenantClause('client_id', clientId);
        const lead = await env.DB.prepare(
          `SELECT name, status FROM leads WHERE id = ?${tc.sql}`,
        ).bind(entityId, ...tc.bind).first() as { name?: string; status?: string } | null;
        // RE-BORNÉ : entité absente du tenant courant ⇒ ignorée silencieusement.
        if (lead) entityDesc = ` Il consulte le lead « ${lead.name || 'sans nom'} » (statut ${lead.status || 'inconnu'}).`;
      } else if (entityType === 'task') {
        const tc = tenantClause('client_id', clientId);
        const task = await env.DB.prepare(
          `SELECT title FROM tasks WHERE id = ?${tc.sql}`,
        ).bind(entityId, ...tc.bind).first() as { title?: string } | null;
        if (task) entityDesc = ` Il consulte la tâche « ${task.title || 'sans titre'} ».`;
      }
      // Autres entity_type : route seule (pas de fuite, pas de SQL dynamique).
    } catch { /* best-effort */ }
  }

  if (!route && !entityDesc) return '';
  const routePart = route ? ` Page courante de l'utilisateur : ${route}.` : '';
  return ` ${routePart}${entityDesc}`.replace(/\s+/g, ' ').replace(/^\s/, ' ');
}

// ── SPRINT 11 — Alertes proactives surfacées en LECTURE SEULE (§6.G) ─────────
// SELECT borné client_id, status != 'dismissed' (calque handleListProactiveAlerts
// de proactive-ai.ts qui reste INTOUCHÉ). NE MUTE RIEN. Best-effort try/catch.
async function buildProactiveAlertsLine(env: Env, auth: AiChatAuth): Promise<string> {
  const clientId = scopeClientId(auth);
  if (!clientId) return ''; // legacy/mono-tenant sans tenant : rien à surfacer.
  try {
    const { results } = await env.DB.prepare(
      `SELECT kind, title FROM proactive_alerts
        WHERE client_id = ? AND status != 'dismissed'
        ORDER BY datetime(created_at) DESC, id ASC
        LIMIT 5`,
    ).bind(clientId).all();
    const alerts = (results || []) as Array<{ kind?: string; title?: string }>;
    if (alerts.length === 0) return '';
    const detail = alerts.map((a) => `« ${a.title || a.kind || 'alerte'} »`).join(', ');
    return ` Alertes proactives en cours (${alerts.length}) : ${detail}. Mentionne-les si pertinent.`;
  } catch {
    return ''; // best-effort : ne bloque jamais la conversation.
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS — corps réels Phase B Manager-B. ApiResponse `{ data }` / `{ error }`
// (jamais de champ `code`). Ownership user_id = auth.userId. Bornage tenant auth.
// ════════════════════════════════════════════════════════════════════════════

const RATE_LIMIT_MSGS_PER_MIN = 15;

// GET /api/ai/chat/threads — liste des threads du user courant.
export async function handleListAiThreads(
  _request: Request,
  env: Env,
  auth: AiChatAuth,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;

  const clientId = scopeClientId(auth);
  // Threads du user : ceux de son tenant courant OU sans tenant (legacy NULL).
  const rows = await env.DB.prepare(
    `SELECT id, title, created_at, updated_at
       FROM ai_chat_threads
      WHERE user_id = ? AND (client_id = ? OR client_id IS NULL)
      ORDER BY updated_at DESC LIMIT 100`,
  ).bind(auth.userId, clientId).all();
  return json({ data: rows.results || [] });
}

// POST /api/ai/chat/threads — crée un thread (client_id = scopeClientId(auth)).
export async function handleCreateAiThread(
  request: Request,
  env: Env,
  auth: AiChatAuth,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;

  let title = 'Nouvelle conversation';
  try {
    const body = (await request.json()) as { title?: string };
    if (typeof body?.title === 'string' && body.title.trim()) title = body.title.trim().slice(0, 120);
  } catch { /* corps optionnel */ }

  const clientId = scopeClientId(auth);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO ai_chat_threads (id, client_id, user_id, title) VALUES (?, ?, ?, ?)`,
  ).bind(id, clientId, auth.userId, title).run();

  const thread = await env.DB.prepare(
    `SELECT id, title, created_at, updated_at FROM ai_chat_threads WHERE id = ?`,
  ).bind(id).first();
  return json({ data: thread }, 201);
}

// GET /api/ai/chat/threads/:id — thread + messages (ownership user_id).
export async function handleGetAiThread(
  _request: Request,
  env: Env,
  auth: AiChatAuth,
  id: string,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;

  const thread = await env.DB.prepare(
    `SELECT id, title, created_at, updated_at FROM ai_chat_threads WHERE id = ? AND user_id = ?`,
  ).bind(id, auth.userId).first();
  if (!thread) return json({ error: 'Conversation introuvable' }, 404);

  const msgs = await env.DB.prepare(
    `SELECT id, role, content, tool_calls, created_at
       FROM ai_chat_messages WHERE thread_id = ? ORDER BY created_at ASC`,
  ).bind(id).all();
  return json({ data: { thread, messages: msgs.results || [] } });
}

// DELETE /api/ai/chat/threads/:id — supprime thread + messages (cascade applicatif).
export async function handleDeleteAiThread(
  _request: Request,
  env: Env,
  auth: AiChatAuth,
  id: string,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;

  const thread = await env.DB.prepare(
    `SELECT id FROM ai_chat_threads WHERE id = ? AND user_id = ?`,
  ).bind(id, auth.userId).first();
  if (!thread) return json({ error: 'Conversation introuvable' }, 404);

  // Cascade applicatif (zéro FK D1) : messages d'abord, puis le thread.
  await env.DB.prepare(`DELETE FROM ai_chat_messages WHERE thread_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM ai_chat_threads WHERE id = ?`).bind(id).run();
  return json({ data: { success: true } });
}

// POST /api/ai/chat/threads/:id/message — CŒUR.
export async function handleSendAiMessage(
  request: Request,
  env: Env,
  auth: AiChatAuth,
  id: string,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;

  // 1) Rate-limit : COUNT messages user < 60s.
  try {
    const rl = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ai_chat_messages
        WHERE user_id = ? AND role = 'user' AND created_at > datetime('now', '-60 seconds')`,
    ).bind(auth.userId).first() as { n: number } | null;
    if (rl && Number(rl.n) >= RATE_LIMIT_MSGS_PER_MIN) {
      return json({ error: 'Trop de messages — attends une minute avant de réessayer.' }, 429);
    }
  } catch { /* best-effort : ne pas bloquer si COUNT échoue */ }

  // 2) Ownership thread.
  const thread = await env.DB.prepare(
    `SELECT id, title FROM ai_chat_threads WHERE id = ? AND user_id = ?`,
  ).bind(id, auth.userId).first() as { id: string; title: string } | null;
  if (!thread) return json({ error: 'Conversation introuvable' }, 404);

  // Corps : content du message user (+ page_context optionnel, SPRINT 11).
  let content = '';
  let pageContext: { route?: string; entity_type?: string; entity_id?: string } | null = null;
  try {
    const body = (await request.json()) as {
      content?: string;
      page_context?: { route?: string; entity_type?: string; entity_id?: string };
    };
    content = (body?.content || '').trim();
    // page_context additif/optionnel — re-validé + re-borné worker-side plus bas.
    if (body?.page_context && typeof body.page_context === 'object') pageContext = body.page_context;
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }
  if (!content) return json({ error: 'Message vide' }, 400);
  content = content.slice(0, 8000);

  const clientId = scopeClientId(auth);

  // 3) INSERT message user.
  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (id, thread_id, client_id, user_id, role, content)
     VALUES (?, ?, ?, ?, 'user', ?)`,
  ).bind(crypto.randomUUID(), id, clientId, auth.userId, content).run();

  // 4) Historique (cap 20 derniers, ordre chrono).
  const histRows = await env.DB.prepare(
    `SELECT role, content FROM ai_chat_messages
      WHERE thread_id = ? ORDER BY created_at DESC LIMIT 20`,
  ).bind(id).all();
  const history: LlmMessage[] = ((histRows.results || []) as Array<{ role: string; content: string }>)
    .reverse()
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  // 5) System prompt = instructions + résumé tenant déterministe (SQL borné)
  //    + page_context re-borné tenant + alertes proactives (LECTURE SEULE).
  const tenantSummary = await buildTenantSummary(env, auth);
  const pageContextLine = await buildPageContextLine(env, auth, pageContext);
  const alertsLine = await buildProactiveAlertsLine(env, auth);
  const systemPrompt = buildSystemPrompt(tenantSummary, pageContextLine, alertsLine);

  // 6) Boucle tool-calling worker-side (max 3 tours).
  const loop = await runChatLoop(env, auth, systemPrompt, history);
  const assistantText = loop.text.trim() || "Je n'ai pas pu produire de réponse. Reformule ta demande.";

  // 7) INSERT message assistant (tool_calls JSON pour transparence Loi 25).
  //    SPRINT 11 : on enrobe l'audit des tool_calls AVEC les proposed_actions
  //    du tour. C'est l'UNIQUE source de revalidation de l'action_id à la
  //    confirmation (ZÉRO nouvelle table — réutilise tool_calls JSON, §1/§6.I).
  //    Forme rétro-compatible : si aucune action, on garde l'array brut v1.
  const assistantId = crypto.randomUUID();
  const hasProposals = loop.proposedActions.length > 0;
  const toolCallsJson = hasProposals
    ? JSON.stringify({ calls: loop.toolCalls, proposed_actions: loop.proposedActions })
    : loop.toolCalls.length > 0
      ? JSON.stringify(loop.toolCalls)
      : null;
  await env.DB.prepare(
    `INSERT INTO ai_chat_messages (id, thread_id, client_id, user_id, role, content, tool_calls, tokens_used)
     VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?)`,
  ).bind(assistantId, id, clientId, auth.userId, assistantText, toolCallsJson, loop.tokensUsed).run();

  // 8) UPDATE thread.updated_at + title auto si défaut.
  const isDefaultTitle = !thread.title || thread.title === 'Nouvelle conversation';
  if (isDefaultTitle) {
    const firstSentence = content.split(/[.\n!?]/)[0]?.trim().slice(0, 80) || 'Conversation';
    await env.DB.prepare(
      `UPDATE ai_chat_threads SET title = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(firstSentence, id).run();
  } else {
    await env.DB.prepare(
      `UPDATE ai_chat_threads SET updated_at = datetime('now') WHERE id = ?`,
    ).bind(id).run();
  }

  // 9) Retourne le message assistant complet (+ proposed_actions additif, §6.B).
  const assistantMsg = await env.DB.prepare(
    `SELECT id, role, content, tool_calls, created_at FROM ai_chat_messages WHERE id = ?`,
  ).bind(assistantId).first() as Record<string, unknown> | null;
  const message = assistantMsg
    ? { ...assistantMsg, ...(hasProposals ? { proposed_actions: loop.proposedActions } : {}) }
    : assistantMsg;
  return json({ data: { message } });
}

// ── SPRINT 11 — Reconstruction des proposed_actions d'un thread (revalidation) ─
// Lit les tool_calls JSON des messages assistant du thread (bornage thread →
// tenant fait par l'appelant) et reconstruit la liste des propositions émises,
// pour valider l'action_id à la confirmation. Tolère la forme v1 (array brut,
// sans proposed_actions) ET la forme SPRINT 11 ({ calls, proposed_actions }).
function extractProposedActions(toolCallsJson: string | null): ProposedActionInternal[] {
  if (!toolCallsJson) return [];
  try {
    const parsed = JSON.parse(toolCallsJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const pa = (parsed as { proposed_actions?: unknown }).proposed_actions;
      if (Array.isArray(pa)) {
        return (pa as ProposedActionInternal[]).filter(
          (p) => p && typeof p.id === 'string' && isActionTool(String(p.tool)),
        );
      }
    }
  } catch { /* forme v1 / corrompue : aucune proposition */ }
  return [];
}

// ════════════════════════════════════════════════════════════════════════════
// SPRINT 11 — Copilot v2 « actions sûres + contexte page » (100% ADDITIF)
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ ZONE TOUCHÉE PAR PHASE A (Manager-A) = UNIQUEMENT ce stub ci-dessous +
//    1 ligne d'export dans worker.ts + 1 route. Manager-A NE TOUCHE PAS au reste
//    de ai-chat.ts. La signature, le nom et le capGuard de ce handler sont
//    FIGÉS Phase A — Manager-B (propriétaire exclusif de ai-chat.ts en Phase B)
//    remplit le CORPS RÉEL et ajoute les 3 tools action en mode « propose »,
//    SANS changer cette signature.
//
// POST /api/ai/chat/threads/:id/action — confirmation HUMAINE d'une action sûre
// proposée par l'assistant. Calque la signature/capGuard de handleSendAiMessage.
//
// FLAG SÉCURITÉ (Manager-B IMPÉRATIF dans le corps réel) :
//   1. capGuard('ai.use') en tête (déjà câblé ici, signature préservée).
//   2. Ownership thread `user_id = auth.userId` (404 sinon) — calque les autres
//      handlers du fichier.
//   3. Lire `action_id` du body, le VALIDER contre les `proposed_actions`
//      effectivement émises pour CE thread (ne JAMAIS exécuter une action que le
//      LLM n'a pas proposée dans ce thread — l'audit réutilise `tool_calls` JSON
//      des ai_chat_messages, ZÉRO nouvelle table).
//   4. RE-BORNER le tenant via `scopeClientId(auth)` UNIQUEMENT — JAMAIS depuis
//      le body ni l'output LLM. L'entité ciblée (lead_id / task) est RE-VALIDÉE
//      appartenir au tenant courant avant toute mutation.
//   5. Exécuter via un handler MÉTIER EXISTANT (create_task → tasks.ts,
//      update_lead_status / add_lead_tag → leads.ts) — JAMAIS un nouveau chemin
//      mutant, JAMAIS d'exécution directe dans la boucle LLM. Actions limitées
//      aux 3 opérations SÛRES/réversibles whitelistées (create_task /
//      update_lead_status / add_lead_tag). PAS d'envoi email/SMS, PAS de DELETE.
//
// Retour : `json({ data: { executed: boolean; result?: string } })` (jamais
// `code`). Le stub Phase A renvoie `executed:false` (aucune mutation).
export async function handleConfirmAiAction(
  request: Request,
  env: Env,
  auth: AiChatAuth,
  threadId: string,
): Promise<Response> {
  const denied = capGuard(auth);
  if (denied) return denied;

  // 2) Ownership thread : user_id = auth.userId (404 sinon) — calque les autres
  //    handlers. Borne aussi le thread au tenant courant (FLAG #1).
  const thread = await env.DB.prepare(
    `SELECT id FROM ai_chat_threads WHERE id = ? AND user_id = ?`,
  ).bind(threadId, auth.userId).first() as { id: string } | null;
  if (!thread) return json({ error: 'Conversation introuvable' }, 404);

  // 3) action_id du body.
  let actionId = '';
  try {
    const body = (await request.json()) as { action_id?: string };
    actionId = typeof body?.action_id === 'string' ? body.action_id : '';
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }
  if (!actionId) return json({ error: 'action_id requis' }, 400);

  // 3b) VALIDER l'action_id contre les propositions RÉELLEMENT émises pour CE
  //     thread (reconstruites depuis tool_calls JSON des messages assistant —
  //     ZÉRO nouvelle table). On ne JAMAIS exécuter une action non proposée.
  const msgRows = await env.DB.prepare(
    `SELECT tool_calls FROM ai_chat_messages WHERE thread_id = ? AND role = 'assistant'`,
  ).bind(threadId).all();
  let proposal: ProposedActionInternal | null = null;
  for (const row of (msgRows.results || []) as Array<{ tool_calls: string | null }>) {
    const found = extractProposedActions(row.tool_calls).find((p) => p.id === actionId);
    if (found) { proposal = found; break; }
  }
  if (!proposal) return json({ error: 'Action introuvable ou expirée' }, 404);

  // 4) RE-BORNER le tenant via scopeClientId(auth) UNIQUEMENT (jamais le LLM/body).
  const clientId = scopeClientId(auth);
  const args = proposal.args || {};

  try {
    switch (proposal.tool) {
      // ── create_task : handler tasks.ts réutilisé. client_id FORCÉ à
      //    scopeClientId(auth) (piège §6.C : le handler utilise body.client_id
      //    tel quel → on l'écrase). lead_id re-validé tenant avant rattachement.
      case 'create_task': {
        const title = typeof args.title === 'string' ? args.title : '';
        if (!title) return json({ data: { executed: false, result: 'Titre manquant.' } });
        let leadId: string | null = typeof args.lead_id === 'string' ? args.lead_id : null;
        if (leadId) {
          const tc = tenantClause('client_id', clientId);
          const lead = await env.DB.prepare(
            `SELECT id FROM leads WHERE id = ?${tc.sql}`,
          ).bind(leadId, ...tc.bind).first();
          if (!lead) leadId = null; // lead hors tenant → on ignore le rattachement.
        }
        const synthBody = {
          title,
          description: typeof args.description === 'string' ? args.description : undefined,
          due_date: typeof args.due_date === 'string' ? args.due_date : undefined,
          priority: typeof args.priority === 'string' ? args.priority : undefined,
          lead_id: leadId,
          client_id: clientId, // FORCÉ tenant (FLAG #1) — jamais depuis le LLM/args.
        };
        const synthReq = new Request('https://internal/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(synthBody),
        });
        // handleCreateTask n'exige PAS de rôle particulier → appel direct.
        const res = await handleCreateTask(synthReq, env, { userId: auth.userId, role: auth.role });
        const out = await res.json().catch(() => null) as { data?: { id?: string }; error?: string } | null;
        if (res.status >= 200 && res.status < 300 && out?.data?.id) {
          return json({ data: { executed: true, result: `Tâche « ${title} » créée.` } });
        }
        return json({ data: { executed: false, result: out?.error || 'Création de la tâche refusée.' } });
      }

      // ── update_lead_status : RE-VALIDE l'ownership tenant du lead AVANT toute
      //    mutation (handlePatchLead ne filtre PAS client_id en interne — piège
      //    §6.C). Stratégie : si rôle admin/api → handler handlePatchLead réutilisé ;
      //    sinon (rôle incompatible) → UPDATE SQL minimal borné tenant calquant
      //    le handler (status whitelist + activity_log), car l'action est déjà
      //    confirmée humainement et gardée par capGuard('ai.use').
      case 'update_lead_status': {
        const leadId = typeof args.lead_id === 'string' ? args.lead_id : '';
        const status = typeof args.status === 'string' ? args.status : '';
        if (!leadId || !LEAD_STATUSES.includes(status)) {
          return json({ data: { executed: false, result: 'Lead ou statut invalide.' } });
        }
        const tc = tenantClause('client_id', clientId);
        const lead = await env.DB.prepare(
          `SELECT id FROM leads WHERE id = ?${tc.sql}`,
        ).bind(leadId, ...tc.bind).first();
        if (!lead) return json({ data: { executed: false, result: 'Lead introuvable dans ton compte.' } });

        if (auth.role === 'admin' || auth.role === 'api') {
          const synthReq = new Request(`https://internal/api/leads/${leadId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          });
          const res = await handlePatchLead(synthReq, env, auth, leadId);
          const out = await res.json().catch(() => null) as { data?: unknown; error?: string } | null;
          if (res.status >= 200 && res.status < 300 && out?.data) {
            return json({ data: { executed: true, result: `Statut du lead changé vers « ${status} ».` } });
          }
          return json({ data: { executed: false, result: out?.error || 'Changement de statut refusé.' } });
        }
        // Rôle incompatible avec handlePatchLead → UPDATE minimal borné tenant
        // (calque exact : UPDATE status + activity_log status_change).
        await env.DB.prepare(
          `UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?${tc.sql}`,
        ).bind(status, leadId, ...tc.bind).run();
        try {
          await env.DB.prepare(
            "INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, 'status_change', ?)",
          ).bind(leadId, auth.userId, JSON.stringify({ to: status })).run();
        } catch { /* non-critique */ }
        return json({ data: { executed: true, result: `Statut du lead changé vers « ${status} ».` } });
      }

      // ── add_lead_tag : RE-VALIDE l'ownership tenant du lead. Si rôle admin →
      //    handleAddTag réutilisé + NORMALISATION {success:true} → {data:{executed}}
      //    (piège §6.C : ce handler ne renvoie PAS {data}). Sinon UPDATE/INSERT
      //    minimal borné tenant calquant le handler (lead_tags + activity_log).
      case 'add_lead_tag': {
        const leadId = typeof args.lead_id === 'string' ? args.lead_id : '';
        const tag = typeof args.tag === 'string' ? args.tag.trim() : '';
        if (!leadId || !tag) return json({ data: { executed: false, result: 'Lead ou étiquette invalide.' } });
        const tc = tenantClause('client_id', clientId);
        const lead = await env.DB.prepare(
          `SELECT id FROM leads WHERE id = ?${tc.sql}`,
        ).bind(leadId, ...tc.bind).first();
        if (!lead) return json({ data: { executed: false, result: 'Lead introuvable dans ton compte.' } });

        if (auth.role === 'admin') {
          const synthReq = new Request(`https://internal/api/leads/${leadId}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag }),
          });
          const res = await handleAddTag(synthReq, env, { userId: auth.userId, role: auth.role }, leadId);
          const out = await res.json().catch(() => null) as { success?: boolean; error?: string } | null;
          // NORMALISATION : handleAddTag renvoie {success:true} → {data:{executed,result}}.
          if (res.status >= 200 && res.status < 300 && out?.success) {
            return json({ data: { executed: true, result: `Étiquette « ${tag} » ajoutée.` } });
          }
          return json({ data: { executed: false, result: out?.error || "Ajout d'étiquette refusé." } });
        }
        // Rôle incompatible avec handleAddTag → INSERT minimal borné (le lead est
        // déjà re-validé tenant ci-dessus), calque exact (lead_tags + activity_log).
        try {
          await env.DB.prepare(
            'INSERT INTO lead_tags (lead_id, tag) VALUES (?, ?)',
          ).bind(leadId, tag.toLowerCase()).run();
        } catch { /* UNIQUE : tag déjà présent — non bloquant (calque handleAddTag) */ }
        try {
          await env.DB.prepare(
            "INSERT INTO activity_log (lead_id, user_id, action, details) VALUES (?, ?, 'tag_added', ?)",
          ).bind(leadId, auth.userId, JSON.stringify({ tag })).run();
        } catch { /* non-critique */ }
        return json({ data: { executed: true, result: `Étiquette « ${tag} » ajoutée.` } });
      }

      default:
        return json({ data: { executed: false, result: 'Action non supportée.' } });
    }
  } catch (err) {
    console.error('handleConfirmAiAction failed:', err);
    return json({ error: "L'action n'a pas pu être exécutée." }, 500);
  }
}
