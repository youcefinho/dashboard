// ── dashboard-engine.ts ────────────────────────────────────────────────────
// Helpers PURS pour `dashboard.ts` / `dashboards.ts` (P3) :
//   - VALID_WIDGET_TYPES whitelist
//   - validateWidgetConfig (type + position + size)
//   - validateDashboardLayout (no overlap, grid 12 cols)
//   - computePeriod (today/7d/30d/90d/custom → {start, end})
//   - validateWidgetPosition (bounds 0..11 col, 0..n rows)
//
// Bornage tenant : helpers PURS. Le bornage `WHERE client_id = ?` reste dans
// les handlers via `loadDashboardInTenant` (dashboards.ts).

/** Codes d'erreur normalisés. */
export const DASHBOARD_ERROR_CODES = Object.freeze({
  WIDGET_TYPE_INVALID: 'WIDGET_TYPE_INVALID',
  WIDGET_POSITION_INVALID: 'WIDGET_POSITION_INVALID',
  WIDGET_SIZE_INVALID: 'WIDGET_SIZE_INVALID',
  WIDGET_OVERLAP: 'WIDGET_OVERLAP',
  WIDGET_OUT_OF_GRID: 'WIDGET_OUT_OF_GRID',
  WIDGET_ID_MISSING: 'WIDGET_ID_MISSING',
  LAYOUT_TOO_MANY_WIDGETS: 'LAYOUT_TOO_MANY_WIDGETS',
  PERIOD_INVALID: 'PERIOD_INVALID',
  PERIOD_CUSTOM_MISSING: 'PERIOD_CUSTOM_MISSING',
  PERIOD_CUSTOM_INVERTED: 'PERIOD_CUSTOM_INVERTED',
} as const);

export type DashboardErrorCode =
  (typeof DASHBOARD_ERROR_CODES)[keyof typeof DASHBOARD_ERROR_CODES];

/** Types de widget whitelistés (frozen). */
export const VALID_WIDGET_TYPES = Object.freeze([
  'kpi',
  'chart',
  'table',
  'funnel',
  'heatmap',
] as const);

/** Sélecteurs de période whitelistés. */
export const VALID_PERIOD_SELECTORS = Object.freeze([
  'today',
  '7d',
  '30d',
  '90d',
  'custom',
] as const);

/** Grille standard : 12 colonnes (Bootstrap-like). */
export const GRID_COLUMNS = 12;

/** Borne raisonnable de widgets par dashboard (calque scheduled-reports MAX_WIDGETS=24). */
export const MAX_WIDGETS_PER_DASHBOARD = 24;

/** Borne raisonnable de hauteur (anti-DOS UI). */
export const MAX_WIDGET_HEIGHT = 24;

/** Result type uniforme. */
export interface DashboardValidation {
  ok: boolean;
  error?: string;
  code?: DashboardErrorCode;
  field?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// validateWidgetPosition — bounds + ranges + intégrité numérique.
// Convention grille 12 cols : x ∈ [0..11], w ∈ [1..12], x+w ≤ 12.
// ────────────────────────────────────────────────────────────────────────────

export function validateWidgetPosition(
  x: unknown,
  y: unknown,
  w: unknown,
  h: unknown,
): DashboardValidation {
  for (const [name, val, lo, hi] of [
    ['x', x, 0, GRID_COLUMNS - 1],
    ['y', y, 0, 999], // y borné largement (scroll vertical possible)
    ['w', w, 1, GRID_COLUMNS],
    ['h', h, 1, MAX_WIDGET_HEIGHT],
  ] as const) {
    const n = Number(val);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return {
        ok: false,
        error: `Position invalide : ${name}=${val} doit être un entier`,
        code: DASHBOARD_ERROR_CODES.WIDGET_POSITION_INVALID,
        field: String(name),
      };
    }
    if (n < lo || n > hi) {
      return {
        ok: false,
        error: `Position invalide : ${name}=${n} hors borne [${lo}..${hi}]`,
        code: DASHBOARD_ERROR_CODES.WIDGET_POSITION_INVALID,
        field: String(name),
      };
    }
  }
  // x + w ≤ GRID_COLUMNS (le widget ne sort pas à droite).
  const xn = Number(x);
  const wn = Number(w);
  if (xn + wn > GRID_COLUMNS) {
    return {
      ok: false,
      error: `Widget sort de la grille : x+w=${xn + wn} > ${GRID_COLUMNS}`,
      code: DASHBOARD_ERROR_CODES.WIDGET_OUT_OF_GRID,
      field: 'x+w',
    };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// validateWidgetConfig — type, id, position, size.
// ────────────────────────────────────────────────────────────────────────────

export interface WidgetConfig {
  id?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  title?: unknown;
  source?: unknown;
  metric?: unknown;
  dimension?: unknown;
  [key: string]: unknown;
}

export function validateWidgetConfig(widget: unknown): DashboardValidation {
  if (!widget || typeof widget !== 'object') {
    return {
      ok: false,
      error: 'Widget doit être un objet',
      code: DASHBOARD_ERROR_CODES.WIDGET_TYPE_INVALID,
    };
  }
  const w = widget as WidgetConfig;
  if (
    typeof w.type !== 'string' ||
    !VALID_WIDGET_TYPES.includes(w.type as never)
  ) {
    return {
      ok: false,
      error: `Type widget invalide (attendu: ${VALID_WIDGET_TYPES.join('|')})`,
      code: DASHBOARD_ERROR_CODES.WIDGET_TYPE_INVALID,
      field: 'type',
    };
  }
  // Position obligatoire (x, y, w, h).
  const posCheck = validateWidgetPosition(w.x, w.y, w.w, w.h);
  if (!posCheck.ok) return posCheck;
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// validateDashboardLayout — pas de chevauchement, pas hors grille, count max.
// ────────────────────────────────────────────────────────────────────────────

export function validateDashboardLayout(widgets: unknown): DashboardValidation {
  if (!Array.isArray(widgets)) {
    return {
      ok: false,
      error: 'Layout doit être un tableau de widgets',
      code: DASHBOARD_ERROR_CODES.WIDGET_TYPE_INVALID,
    };
  }
  if (widgets.length > MAX_WIDGETS_PER_DASHBOARD) {
    return {
      ok: false,
      error: `Trop de widgets (${widgets.length} > ${MAX_WIDGETS_PER_DASHBOARD})`,
      code: DASHBOARD_ERROR_CODES.LAYOUT_TOO_MANY_WIDGETS,
    };
  }
  // Validation individuelle.
  for (let i = 0; i < widgets.length; i++) {
    const check = validateWidgetConfig(widgets[i]);
    if (!check.ok) {
      return {
        ok: false,
        error: `Widget #${i}: ${check.error}`,
        code: check.code,
        field: `widgets[${i}].${check.field || ''}`,
      };
    }
  }
  // Détection overlap (O(n²) — n ≤ 24 = 576 max, négligeable).
  for (let i = 0; i < widgets.length; i++) {
    const a = widgets[i] as WidgetConfig;
    const ax = Number(a.x),
      ay = Number(a.y),
      aw = Number(a.w),
      ah = Number(a.h);
    for (let j = i + 1; j < widgets.length; j++) {
      const b = widgets[j] as WidgetConfig;
      const bx = Number(b.x),
        by = Number(b.y),
        bw = Number(b.w),
        bh = Number(b.h);
      if (rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh)) {
        return {
          ok: false,
          error: `Widgets #${i} et #${j} se chevauchent`,
          code: DASHBOARD_ERROR_CODES.WIDGET_OVERLAP,
          field: `widgets[${i}],widgets[${j}]`,
        };
      }
    }
  }
  return { ok: true };
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  // Deux rectangles SE TOUCHENT (sans chevauchement) si une arête est commune.
  // Overlap STRICT : intersection d'aire > 0.
  if (ax + aw <= bx) return false; // a est strict à gauche de b
  if (bx + bw <= ax) return false; // b est strict à gauche de a
  if (ay + ah <= by) return false; // a est strict au-dessus de b
  if (by + bh <= ay) return false; // b est strict au-dessus de a
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// computePeriod — selector → { start: Date, end: Date }.
// Périodes glissantes en UTC. 'today' = aujourd'hui 00:00:00 → 23:59:59 UTC.
// 'custom' requiert { start, end } valides.
// ────────────────────────────────────────────────────────────────────────────

export type PeriodSelector = (typeof VALID_PERIOD_SELECTORS)[number];

export interface ComputedPeriod {
  ok: boolean;
  start?: Date;
  end?: Date;
  error?: string;
  code?: DashboardErrorCode;
}

export function computePeriod(
  selector: PeriodSelector | string,
  custom?: { start: unknown; end: unknown },
): ComputedPeriod {
  if (!VALID_PERIOD_SELECTORS.includes(selector as PeriodSelector)) {
    return {
      ok: false,
      error: `Période invalide (attendu: ${VALID_PERIOD_SELECTORS.join('|')})`,
      code: DASHBOARD_ERROR_CODES.PERIOD_INVALID,
    };
  }
  const now = new Date();
  if (selector === 'custom') {
    if (!custom || custom.start == null || custom.end == null) {
      return {
        ok: false,
        error: "Période 'custom' requiert { start, end }",
        code: DASHBOARD_ERROR_CODES.PERIOD_CUSTOM_MISSING,
      };
    }
    const startMs = parseAnyDateMs(custom.start);
    const endMs = parseAnyDateMs(custom.end);
    if (startMs == null || endMs == null) {
      return {
        ok: false,
        error: 'Dates start/end invalides',
        code: DASHBOARD_ERROR_CODES.PERIOD_CUSTOM_MISSING,
      };
    }
    if (startMs > endMs) {
      return {
        ok: false,
        error: 'Période custom inversée (start > end)',
        code: DASHBOARD_ERROR_CODES.PERIOD_CUSTOM_INVERTED,
      };
    }
    return { ok: true, start: new Date(startMs), end: new Date(endMs) };
  }
  if (selector === 'today') {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
    );
    return { ok: true, start, end };
  }
  const days = selector === '7d' ? 7 : selector === '30d' ? 30 : 90;
  const end = new Date(now.getTime());
  const start = new Date(now.getTime() - days * 86_400_000);
  return { ok: true, start, end };
}

function parseAnyDateMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
