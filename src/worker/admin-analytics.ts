// ── Sprint 46 M2 — Admin analytics endpoints ────────────────
// Stubs production-ready : protégés par auth.role === 'admin' || 'owner',
// retournent payloads mockés cohérents. À brancher sur D1 plus tard.
//
// Endpoints :
//   GET /api/admin/overview?period=7d|30d|90d|1y
//   GET /api/admin/activity-heatmap?period=7d|30d|90d
//   GET /api/admin/features-usage

import type { Env } from './types';
import { json } from './helpers';
// Import relatif (cohérent avec le reste de src/worker/* qui n'utilise pas
// l'alias @ — wrangler/esbuild compile le worker sans le paths-mapping TS).
import { toIsoSql } from '../lib/dbTime';
// Renforcement P4 (2026-05-26) — helpers PURS pour metrics SaaS + churn/growth.
// Additif strict — les handlers actuels gardent leur logique inline ; ces
// helpers sont réutilisables par tout endpoint futur /api/admin/metric DSL.
import {
  validateMetricRequest as _validateMetricRequest,
  aggregateByPeriod as _aggregateByPeriod,
  formatChurnRate as _formatChurnRate,
  formatGrowthRate as _formatGrowthRate,
  VALID_METRICS as _VALID_METRICS,
  VALID_PERIOD_KEYS,
} from './lib/admin-analytics-engine';
void _validateMetricRequest;
void _aggregateByPeriod;
void _formatChurnRate;
void _formatGrowthRate;
void _VALID_METRICS;
// Renforcement V2 — Set de périodes valides câblé depuis engine.
const ENGINE_VALID_PERIODS = new Set<string>(VALID_PERIOD_KEYS);

const ADMIN_ROLES = new Set(['admin', 'owner']);

function requireAdmin(auth: { userId: string; role: string }): Response | null {
  if (!ADMIN_ROLES.has(auth.role)) {
    return json({ error: 'Accès réservé aux administrateurs.' }, 403);
  }
  return null;
}

// ── /api/admin/overview ─────────────────────────────────────

export async function handleAdminOverview(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  const denied = requireAdmin(auth);
  if (denied) return denied;

  const url = new URL(request.url);
  const period = (url.searchParams.get('period') || '30d').toLowerCase();
  const safePeriod = ENGINE_VALID_PERIODS.has(period) ? period : '30d';

  // ── Counts réels (best-effort) ──
  // Total users
  let totalUsers = 0;
  let leadsThisMonth = 0;
  // [LOT RÉEL §6.C.3] conversionRate : RÉEL si des leads existent ce mois,
  // sinon `null` (honnête — JAMAIS le 0.22 inventé d'avant).
  let conversionRate: number | null = null;
  try {
    const usersRow = await env.DB.prepare('SELECT COUNT(*) as c FROM users').first<{ c: number }>();
    totalUsers = usersRow?.c ?? 0;
  } catch { /* table inexistante → 0 */ }
  try {
    // [S2] CÂBLAGE DÉFENSIF (risque cross-format RÉEL prouvé) :
    // `leads.created_at` est TEXT `datetime('now')` → `'YYYY-MM-DD HH:MM:SS'`
    // (schema.sql : `created_at TEXT DEFAULT (datetime('now'))`), PAS un entier
    // epoch. L'ancien code bindait `Math.floor(startMonth)` (entier epoch-s)
    // contre une colonne TEXTE via `>=`, et `COALESCE(created_at, 0)` mélangeait
    // TEXT et INTEGER 0 → comparaison SQLite silencieusement FAUSSE (affinité
    // incohérente texte↔entier). Ce cas N'était PAS dans la map S1 (S1 couvrait
    // les usages `unixepoch` internes ; cette comparaison leads.created_at
    // texte-vs-bind-entier est un risque distinct découvert en S2).
    // Fix : normaliser la borne au format texte SQL canonique du projet via
    // toIsoSql() et comparer texte-vs-texte (lexicographique, correct car
    // 'YYYY-MM-DD HH:MM:SS' est lexicographiquement ordonné). Logique métier
    // INCHANGÉE : on compte toujours les leads créés depuis le 1er du mois.
    const startMonthEpoch = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000;
    const startMonthSql = toIsoSql(Math.floor(startMonthEpoch)) ?? '1970-01-01 00:00:00';
    const leadsRow = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM leads WHERE created_at >= ?'
    ).bind(startMonthSql).first<{ c: number }>();
    leadsThisMonth = leadsRow?.c ?? 0;
    const wonRow = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM leads WHERE status = 'won' AND created_at >= ?`
    ).bind(startMonthSql).first<{ c: number }>();
    const wonCount = wonRow?.c ?? 0;
    if (leadsThisMonth > 0) conversionRate = wonCount / leadsThisMonth;
  } catch { /* fallback mock */ }

  // ── activeMonthly RÉEL (§6.C.3) ──
  // COUNT(DISTINCT user_id) FROM feature_events sur le mois courant.
  // `feature_events.event_time` est INTEGER epoch-secondes (migration
  // sprint46-m2 DEFAULT (unixepoch())) — cf docs/TIMESTAMP-CONSISTENCY-MAP :
  // on compare entier-vs-entier, PAS de câblage dbTime. Table absente ou
  // erreur ⇒ `null` (honnête, JAMAIS un proxy `*0.68` inventé).
  let activeMonthly: number | null = null;
  try {
    const startMonthEpochSec = Math.floor(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000,
    );
    const activeRow = await env.DB.prepare(
      'SELECT COUNT(DISTINCT user_id) as c FROM feature_events WHERE event_time >= ?'
    ).bind(startMonthEpochSec).first<{ c: number }>();
    activeMonthly = activeRow?.c ?? null;
  } catch { /* table absente → null honnête */ }

  // ── Série leadsConversions RÉELLE (§6.C.3) ──
  // GROUP BY date(created_at) sur `leads` — created_at est TEXT
  // `'YYYY-MM-DD HH:MM:SS'` (cf [S2] plus haut). Borne = début de fenêtre
  // selon la période demandée. Aucun Math.random.
  const daysBack = safePeriod === '1y' ? 365 : safePeriod === '90d' ? 90 : safePeriod === '30d' ? 30 : 7;
  const sinceSql = toIsoSql(Math.floor(Date.now() / 1000) - daysBack * 86400) ?? '1970-01-01 00:00:00';
  const leadsConversions: { label: string; leads: number; conversions: number }[] = [];
  try {
    const seriesRows = await env.DB.prepare(
      `SELECT date(created_at) AS d,
              COUNT(*) AS leads,
              SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS conversions
         FROM leads
        WHERE created_at >= ?
        GROUP BY date(created_at)
        ORDER BY d ASC`
    ).bind(sinceSql).all<{ d: string; leads: number; conversions: number }>();
    for (const r of (seriesRows.results || [])) {
      leadsConversions.push({
        label: r.d,
        leads: Number(r.leads) || 0,
        conversions: Number(r.conversions) || 0,
      });
    }
  } catch { /* table absente → série vide (front affiche no_data_yet) */ }

  return json({
    data: {
      // Réels (déjà branchés D1) — préservés.
      totalUsers,
      leadsThisMonth,
      conversionRate,            // number réel | null si aucun lead ce mois
      // Réel via feature_events | null si table absente (JAMAIS un proxy).
      activeMonthly,
      // Aucune source de facturation réelle ⇒ null. JAMAIS un nombre en dur,
      // JAMAIS de lien Stripe (stratégique hors-scope LOT RÉEL).
      mrr: null,
      // Deltas non calculables réellement (pas d'historique période-1) ⇒ null.
      // Front n'affiche pas de % inventé.
      deltaTotalUsers: null,
      deltaActiveMonthly: null,
      deltaLeads: null,
      deltaConversion: null,
      deltaMrr: null,
      // Série historique RÉELLE (GROUP BY date). usersGrowth retiré : aucune
      // source réelle d'« active » historique (était 100% Math.random).
      leadsConversions,
    },
  });
}

// ── /api/admin/activity-heatmap ─────────────────────────────

export async function handleAdminActivityHeatmap(
  request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  const denied = requireAdmin(auth);
  if (denied) return denied;

  // [LOT RÉEL-bis] Heatmap RÉELLE depuis feature_events — JAMAIS de fallback
  // synthetic/Math.random (ancien :191-208 supprimé). Grille 7×24 toujours
  // initialisée à 0 (forme de réponse préservée pour le front). Table absente
  // / vide ⇒ grille de zéros honnête (le front affiche « pas encore de
  // données » quand tout est à 0), JAMAIS un jitter inventé.
  const url = new URL(request.url);
  const period = (url.searchParams.get('period') || '7d').toLowerCase();
  const daysBack = period === '30d' ? 30 : period === '90d' ? 90 : 7;
  const since = Math.floor(Date.now() / 1000) - daysBack * 86400;
  // Grille honnête par défaut : 7 jours (Lun=0..Dim=6) × 24h, tout à 0.
  const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  try {
    // [S2] conforme : unixepoch entier-vs-entier cohérent, pas de câblage dbTime
    // (cf docs/TIMESTAMP-CONSISTENCY-MAP). `feature_events.event_time` est INTEGER
    // epoch-secondes (migration-sprint46-m2 DEFAULT (unixepoch())). `since` ci-dessus
    // est aussi un entier epoch-secondes → la comparaison `event_time >= ?`
    // et les modificateurs strftime(..., 'unixepoch') sont homogènes. Aucune
    // comparaison cross-format texte↔entier ici : ne RIEN modifier (S1 verdict).
    // strftime : %w (0=Sun..6=Sat), %H (00-23). On normalise %w pour Lun=0.
    const rows = await env.DB.prepare(
      `SELECT
         ((CAST(strftime('%w', event_time, 'unixepoch') AS INTEGER) + 6) % 7) AS dow,
         CAST(strftime('%H', event_time, 'unixepoch') AS INTEGER) AS hour,
         COUNT(*) AS c
       FROM feature_events
       WHERE event_time >= ?
       GROUP BY dow, hour`
    ).bind(since).all<{ dow: number; hour: number; c: number }>();

    for (const row of (rows.results || [])) {
      if (row.dow >= 0 && row.dow < 7 && row.hour >= 0 && row.hour < 24) {
        grid[row.dow]![row.hour] = Number(row.c) || 0;
      }
    }
  } catch {
    /* table feature_events absente / erreur ⇒ grille de zéros honnête
       (déjà initialisée). PAS de Math.random, PAS de pattern fabriqué. */
  }

  return json({ data: { heatmap: grid } });
}

// ── /api/admin/features-usage ───────────────────────────────

export async function handleAdminFeaturesUsage(
  _request: Request,
  env: Env,
  auth: { userId: string; role: string }
): Promise<Response> {
  const denied = requireAdmin(auth);
  if (denied) return denied;

  type FeatureRow = {
    id: string;
    label: string;
    adoptionRate: number;
    sessions: number;
    uniqueUsers: number;
    // [LOT RÉEL-bis] null honnête si la feature n'a JAMAIS été utilisée
    // (auparavant une date fabriquée via Math.random).
    lastUsedAt: string | null;
    trend30d: number[];
  };
  type RoleRow = {
    feature_id: string;
    feature_label: string;
    admin: number;
    member: number;
    viewer: number;
  };

  const featureSeeds: { id: string; label: string }[] = [
    { id: 'cmd_palette', label: 'Command Palette (Cmd+K)' },
    { id: 'pipeline_drag', label: 'Drag pipeline cards' },
    { id: 'bulk_select', label: 'Bulk select leads' },
    { id: 'ai_drafts', label: 'AI draft replies' },
    { id: 'reactions_emoji', label: 'Réactions emoji' },
    { id: 'quick_replies', label: 'Quick replies chips' },
    { id: 'smart_lists', label: 'Smart Lists sauvegardées' },
    { id: 'ai_summarize', label: 'AI résumé conversation' },
    { id: 'pdf_export', label: 'Export PDF' },
    { id: 'pull_to_refresh', label: 'Pull-to-refresh mobile' },
  ];

  // [LOT RÉEL-bis] Dénominateur d'adoption RÉEL = nombre d'utilisateurs.
  // Si la table users est absente / vide ⇒ on ne peut PAS calculer un taux
  // honnête : adoptionRate = 0 (JAMAIS un dénominateur inventé `200`/`Math.max(50,…)`).
  let totalUsersForRate = 0;
  try {
    const r = await env.DB.prepare('SELECT COUNT(*) as c FROM users').first<{ c: number }>();
    totalUsersForRate = r?.c ?? 0;
  } catch { /* table absente ⇒ 0, adoptionRate restera 0 (honnête) */ }

  // 30 derniers jours, borne epoch-secondes (cohérent feature_events.event_time
  // INTEGER unixepoch — cf docs/TIMESTAMP-CONSISTENCY-MAP, pas de câblage dbTime).
  const trendSince = Math.floor(Date.now() / 1000) - 30 * 86400;

  const features: FeatureRow[] = [];
  // Counts 100% RÉELS par feature_id depuis feature_events. Aucune métrique
  // fabriquée : pas de source ⇒ 0 / null honnête (jamais Math.random/jitter).
  for (let i = 0; i < featureSeeds.length; i++) {
    const seed = featureSeeds[i]!;
    let sessions = 0;
    let uniqueUsers = 0;
    let lastUsedAt: string | null = null;
    try {
      const r = await env.DB.prepare(
        `SELECT COUNT(*) as sessions, COUNT(DISTINCT user_id) as unique_users, MAX(event_time) as last_ts
         FROM feature_events WHERE feature_id = ?`
      ).bind(seed.id).first<{ sessions: number; unique_users: number; last_ts: number | null }>();
      if (r) {
        sessions = Number(r.sessions) || 0;
        uniqueUsers = Number(r.unique_users) || 0;
        // [S2] conforme : `last_ts` = MAX(event_time) entier epoch-secondes
        // (même colonne INTEGER unixepoch que ci-dessus). `*1000` ramène en ms
        // pour `new Date(...)` JS — conversion correcte s→ms, pas une comparaison
        // cross-format. Pas de câblage dbTime requis (cf TIMESTAMP-CONSISTENCY-MAP).
        // r.last_ts null (aucun event) ⇒ lastUsedAt reste null (honnête).
        if (r.last_ts != null) lastUsedAt = new Date(Number(r.last_ts) * 1000).toISOString();
      }
    } catch { /* table absente ⇒ 0 / null honnête (déjà initialisé) */ }

    // Tendance 30j RÉELLE : COUNT par jour depuis feature_events. 30 buckets
    // alignés (index 0 = il y a 29 j … index 29 = aujourd'hui). Jours sans
    // event ⇒ 0 (JAMAIS le sin()/Math.random d'avant).
    const trend: number[] = Array.from({ length: 30 }, () => 0);
    try {
      const trendRows = await env.DB.prepare(
        `SELECT CAST(strftime('%j', event_time, 'unixepoch') AS INTEGER) AS doy,
                date(event_time, 'unixepoch') AS d,
                COUNT(*) AS c
           FROM feature_events
          WHERE feature_id = ? AND event_time >= ?
          GROUP BY d
          ORDER BY d ASC`
      ).bind(seed.id, trendSince).all<{ doy: number; d: string; c: number }>();
      const todayStartSec = Math.floor(Date.now() / 1000);
      for (const tr of (trendRows.results || [])) {
        // Décalage en jours entre la date du bucket et aujourd'hui (UTC).
        const bucketSec = Math.floor(new Date(`${tr.d}T00:00:00Z`).getTime() / 1000);
        const daysAgo = Math.floor((todayStartSec - bucketSec) / 86400);
        const idx = 29 - daysAgo;
        if (idx >= 0 && idx < 30) trend[idx] = Number(tr.c) || 0;
      }
    } catch { /* table absente ⇒ trend reste 30×0 honnête */ }

    // adoptionRate RÉEL = uniqueUsers / totalUsers (0 si pas de base users).
    const adoptionRate = totalUsersForRate > 0
      ? Math.min(1, uniqueUsers / totalUsersForRate)
      : 0;

    features.push({
      id: seed.id,
      label: seed.label,
      adoptionRate,
      sessions,
      uniqueUsers,
      lastUsedAt,
      trend30d: trend,
    });
  }

  // Adoption per role (sub-section) RÉELLE — top 6 features. Pour chaque
  // feature : COUNT(DISTINCT user_id) par rôle / total users de ce rôle.
  // Aucun proxy `+0.15 / -0.25` inventé : pas de source ⇒ 0 honnête.
  // `feature_events.role` est rempli à l'événement ; on rapporte au nombre
  // d'utilisateurs de ce rôle (users.role). Rôles absents ⇒ 0.
  const roleDenoms: Record<'admin' | 'member' | 'viewer', number> = { admin: 0, member: 0, viewer: 0 };
  try {
    const rd = await env.DB.prepare(
      `SELECT role, COUNT(*) AS c FROM users GROUP BY role`
    ).all<{ role: string; c: number }>();
    for (const row of (rd.results || [])) {
      const key = String(row.role || '').toLowerCase();
      if (key === 'admin' || key === 'owner') roleDenoms.admin += Number(row.c) || 0;
      else if (key === 'viewer') roleDenoms.viewer += Number(row.c) || 0;
      else roleDenoms.member += Number(row.c) || 0; // member + tout autre rôle
    }
  } catch { /* table users absente ⇒ denoms 0, ratios 0 honnêtes */ }

  const byRole: RoleRow[] = [];
  for (const f of features.slice(0, 6)) {
    let adminU = 0;
    let memberU = 0;
    let viewerU = 0;
    try {
      const rr = await env.DB.prepare(
        `SELECT role, COUNT(DISTINCT user_id) AS u
           FROM feature_events
          WHERE feature_id = ?
          GROUP BY role`
      ).bind(f.id).all<{ role: string; u: number }>();
      for (const row of (rr.results || [])) {
        const key = String(row.role || '').toLowerCase();
        if (key === 'admin' || key === 'owner') adminU += Number(row.u) || 0;
        else if (key === 'viewer') viewerU += Number(row.u) || 0;
        else memberU += Number(row.u) || 0;
      }
    } catch { /* table absente ⇒ 0 honnête */ }
    byRole.push({
      feature_id: f.id,
      feature_label: f.label,
      admin: roleDenoms.admin > 0 ? Math.min(1, adminU / roleDenoms.admin) : 0,
      member: roleDenoms.member > 0 ? Math.min(1, memberU / roleDenoms.member) : 0,
      viewer: roleDenoms.viewer > 0 ? Math.min(1, viewerU / roleDenoms.viewer) : 0,
    });
  }

  return json({ data: { features, by_role: byRole } });
}
