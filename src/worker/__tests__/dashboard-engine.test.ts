// ── dashboard-engine.test.ts — Renforcement P3 (2026-05-26) ─────────────────
// Tests unitaires des helpers purs dashboard-engine.ts. 20+ edge cases.

import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_ERROR_CODES,
  VALID_WIDGET_TYPES,
  VALID_PERIOD_SELECTORS,
  GRID_COLUMNS,
  MAX_WIDGETS_PER_DASHBOARD,
  validateWidgetConfig,
  validateDashboardLayout,
  computePeriod,
  validateWidgetPosition,
} from '../lib/dashboard-engine';

describe('DASHBOARD constants', () => {
  it('frozen', () => {
    expect(Object.isFrozen(DASHBOARD_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(VALID_WIDGET_TYPES)).toBe(true);
    expect(Object.isFrozen(VALID_PERIOD_SELECTORS)).toBe(true);
  });

  it('GRID_COLUMNS = 12', () => {
    expect(GRID_COLUMNS).toBe(12);
  });

  it('VALID_WIDGET_TYPES contient kpi/chart/table/funnel/heatmap', () => {
    expect(VALID_WIDGET_TYPES).toContain('kpi');
    expect(VALID_WIDGET_TYPES).toContain('chart');
    expect(VALID_WIDGET_TYPES).toContain('table');
    expect(VALID_WIDGET_TYPES).toContain('funnel');
    expect(VALID_WIDGET_TYPES).toContain('heatmap');
  });
});

describe('validateWidgetPosition', () => {
  it('accepte position dans la grille', () => {
    expect(validateWidgetPosition(0, 0, 6, 4).ok).toBe(true);
    expect(validateWidgetPosition(6, 0, 6, 4).ok).toBe(true);
  });

  it('rejette x négatif', () => {
    expect(validateWidgetPosition(-1, 0, 6, 4).ok).toBe(false);
  });

  it('rejette x ≥ 12', () => {
    expect(validateWidgetPosition(12, 0, 1, 1).ok).toBe(false);
  });

  it('rejette w = 0', () => {
    expect(validateWidgetPosition(0, 0, 0, 4).ok).toBe(false);
  });

  it('rejette x + w > 12 (sortie grille)', () => {
    const r = validateWidgetPosition(8, 0, 6, 4);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(DASHBOARD_ERROR_CODES.WIDGET_OUT_OF_GRID);
  });

  it('rejette valeurs non-entières', () => {
    expect(validateWidgetPosition(1.5, 0, 6, 4).ok).toBe(false);
    expect(validateWidgetPosition(0, 0, 6.7, 4).ok).toBe(false);
  });

  it('rejette valeurs non-numériques', () => {
    expect(validateWidgetPosition('a' as never, 0, 6, 4).ok).toBe(false);
  });

  it('rejette h > MAX', () => {
    expect(validateWidgetPosition(0, 0, 6, 999).ok).toBe(false);
  });
});

describe('validateWidgetConfig', () => {
  it('accepte widget complet valide', () => {
    expect(
      validateWidgetConfig({
        id: 'w1',
        type: 'kpi',
        x: 0,
        y: 0,
        w: 4,
        h: 2,
        title: 'My KPI',
      }).ok,
    ).toBe(true);
  });

  it('rejette type invalide', () => {
    const r = validateWidgetConfig({ type: 'gauge', x: 0, y: 0, w: 4, h: 2 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(DASHBOARD_ERROR_CODES.WIDGET_TYPE_INVALID);
  });

  it('rejette widget non-objet', () => {
    expect(validateWidgetConfig(null).ok).toBe(false);
    expect(validateWidgetConfig('w').ok).toBe(false);
  });

  it('rejette position manquante', () => {
    expect(validateWidgetConfig({ type: 'kpi' }).ok).toBe(false);
  });
});

describe('validateDashboardLayout', () => {
  it('accepte layout vide', () => {
    expect(validateDashboardLayout([]).ok).toBe(true);
  });

  it('accepte layout sans overlap', () => {
    const layout = [
      { type: 'kpi', x: 0, y: 0, w: 6, h: 2 },
      { type: 'chart', x: 6, y: 0, w: 6, h: 2 },
      { type: 'table', x: 0, y: 2, w: 12, h: 4 },
    ];
    expect(validateDashboardLayout(layout).ok).toBe(true);
  });

  it('détecte overlap horizontal', () => {
    const layout = [
      { type: 'kpi', x: 0, y: 0, w: 8, h: 2 },
      { type: 'chart', x: 4, y: 0, w: 8, h: 2 },
    ];
    const r = validateDashboardLayout(layout);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(DASHBOARD_ERROR_CODES.WIDGET_OVERLAP);
  });

  it('détecte overlap vertical', () => {
    const layout = [
      { type: 'kpi', x: 0, y: 0, w: 6, h: 4 },
      { type: 'chart', x: 0, y: 2, w: 6, h: 4 },
    ];
    expect(validateDashboardLayout(layout).ok).toBe(false);
  });

  it('widgets adjacents (sans overlap) OK', () => {
    const layout = [
      { type: 'kpi', x: 0, y: 0, w: 6, h: 2 },
      { type: 'kpi', x: 6, y: 0, w: 6, h: 2 }, // adjacent à droite
    ];
    expect(validateDashboardLayout(layout).ok).toBe(true);
  });

  it('rejette > MAX_WIDGETS_PER_DASHBOARD', () => {
    const many = Array.from({ length: MAX_WIDGETS_PER_DASHBOARD + 1 }, (_, i) => ({
      type: 'kpi' as const,
      x: 0,
      y: i,
      w: 1,
      h: 1,
    }));
    const r = validateDashboardLayout(many);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(DASHBOARD_ERROR_CODES.LAYOUT_TOO_MANY_WIDGETS);
  });

  it('rejette non-array', () => {
    expect(validateDashboardLayout({} as never).ok).toBe(false);
  });

  it('propage l\'erreur widget individuelle', () => {
    const layout = [{ type: 'invalid', x: 0, y: 0, w: 1, h: 1 }];
    expect(validateDashboardLayout(layout).ok).toBe(false);
  });
});

describe('computePeriod', () => {
  it('today retourne start/end même jour UTC', () => {
    const r = computePeriod('today');
    expect(r.ok).toBe(true);
    expect(r.start!.getUTCHours()).toBe(0);
    expect(r.end!.getUTCHours()).toBe(23);
    expect(r.start!.getUTCDate()).toBe(r.end!.getUTCDate());
  });

  it('7d retourne 7 jours en arrière', () => {
    const r = computePeriod('7d');
    expect(r.ok).toBe(true);
    const days = (r.end!.getTime() - r.start!.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 0);
  });

  it('30d / 90d corrects', () => {
    const r30 = computePeriod('30d');
    const r90 = computePeriod('90d');
    expect(r30.ok).toBe(true);
    expect(r90.ok).toBe(true);
    expect(r90.start!.getTime()).toBeLessThan(r30.start!.getTime());
  });

  it('custom valide', () => {
    const r = computePeriod('custom', {
      start: '2026-01-01',
      end: '2026-02-01',
    });
    expect(r.ok).toBe(true);
  });

  it('custom sans start/end ⇒ erreur', () => {
    const r = computePeriod('custom');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(DASHBOARD_ERROR_CODES.PERIOD_CUSTOM_MISSING);
  });

  it('custom inversé ⇒ erreur', () => {
    const r = computePeriod('custom', {
      start: '2026-02-01',
      end: '2026-01-01',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(DASHBOARD_ERROR_CODES.PERIOD_CUSTOM_INVERTED);
  });

  it('selector invalide ⇒ erreur', () => {
    const r = computePeriod('1y');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(DASHBOARD_ERROR_CODES.PERIOD_INVALID);
  });
});
