// ══════════════════════════════════════════════════════════════
// ██  useWidgetData — LOT D Reports Hardening (Phase B Manager-C)
// ██  Hook frontal qui appelle `runReportWidget` (api.ts FIGÉ Phase A)
// ██  Gère loading / error / empty / data via i18n (`reports.widget.*`).
// ══════════════════════════════════════════════════════════════
//
// Pourquoi ce fichier : `_dashboardCharts.tsx` (Sprint 46 M1.1) rend
// actuellement des données MOCK déterministes via `sampleSeries(seed)`.
// LOT D Phase B Manager-C remplace ce mock par le hook ci-dessous, qui
// appelle la route NEUVE `POST /api/reports/widget` (dispatcher unique
// borné tenant — corps réel Phase B Manager-B). Phase A SOLO a posé :
//   - helper `runReportWidget(payload): Promise<ApiResponse<WidgetRunResult>>`
//   - types `WidgetRunResult { series; total; delta? }` /
//     `RunReportWidgetPayload { source; dimension; metric; filters?;
//      dashboard_id? }`
//   - 12 clés i18n `reports.*` parité ×4 (96/96/96/96).
//
// Discrimination capability côté front = string-match sur `error`
// (jamais `code` — `ApiResponse` GELÉ depuis LOT B Team).
//
// Fallback dev offline : si `import.meta.env.DEV` ET error, on retourne
// un dataset déterministe pour permettre le travail UI sans backend.

import { useState, useEffect, useRef } from 'react';
import { runReportWidget, type WidgetRunResult } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { WidgetConfig } from '@/components/reports/DashboardBuilder';

export interface UseWidgetDataState {
  data: WidgetRunResult | null;
  loading: boolean;
  error: string | null;
  /** `true` si la réponse a renvoyé `series: []` (distinct d'une vraie erreur). */
  empty: boolean;
}

/**
 * Fallback dev déterministe (calque sampleSeries du _dashboardCharts.tsx
 * Sprint 46 M1.1) — utilisé UNIQUEMENT en `import.meta.env.DEV` sur
 * erreur réseau, pour permettre le dev UI offline. Production : on
 * propage l'erreur via i18n `reports.widget.error_data`.
 */
function devFallback(widget: WidgetConfig): WidgetRunResult {
  const seed = widget.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const buckets = widget.dimension === 'month' ? 12 : 6;
  const labelsByDim: Record<string, string[]> = {
    source: ['Google', 'Facebook', 'Direct', 'Référence', 'Email', 'SMS'],
    status: ['Nouveau', 'Contacté', 'Qualifié', 'Gagné', 'Perdu', 'Fermé'],
    type:   ['Entrant', 'Client', 'Prospect', 'Lead chaud', 'VIP', 'Autre'],
    owner:  ['Rochdi', 'Alice', 'Bruno', 'Camille', 'Dimitri', 'Élise'],
    client: ['Acme', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'],
    date:   ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
    week:   ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
    month:  ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'],
  };
  const labels = labelsByDim[widget.dimension || 'source'] || labelsByDim.source!;
  const series = Array.from({ length: buckets }, (_, i) => ({
    name: labels[i % labels.length]!,
    value: Math.max(2, Math.round(((seed * (i + 3)) % 87) + 5)),
  }));
  const total = series.reduce((s, p) => s + p.value, 0);
  return { series, total };
}

export function useWidgetData(widget: WidgetConfig): UseWidgetDataState {
  const [state, setState] = useState<UseWidgetDataState>({
    data: null,
    loading: true,
    error: null,
    empty: false,
  });

  // Stabilise la clé filters par stringify (le shape filters est plat,
  // pas de fonction/Date — stringify safe pour deps)
  const filtersKey = JSON.stringify(widget.filters || {});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    setState({ data: null, loading: true, error: null, empty: false });

    runReportWidget({
      source: widget.source,
      dimension: widget.dimension || 'source',
      metric: widget.metric,
      filters: widget.filters as Record<string, unknown>,
      // dashboard_id passé si exposé par le widget (Sprint 46 ne le
      // propage pas encore — laissé optionnel pour Manager-B).
    })
      .then((res) => {
        if (cancelled || !mountedRef.current) return;
        if (res.data) {
          const series = res.data.series || [];
          setState({
            data: res.data,
            loading: false,
            error: null,
            empty: series.length === 0,
          });
        } else {
          // res.error présent — fallback dev si activé
          const msg = res.error || t('reports.widget.error_data');
          if (import.meta.env.DEV) {
            setState({
              data: devFallback(widget),
              loading: false,
              error: null,
              empty: false,
            });
          } else {
            setState({ data: null, loading: false, error: msg, empty: false });
          }
        }
      })
      .catch((e: unknown) => {
        if (cancelled || !mountedRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (import.meta.env.DEV) {
          setState({
            data: devFallback(widget),
            loading: false,
            error: null,
            empty: false,
          });
        } else {
          setState({ data: null, loading: false, error: msg || t('reports.widget.error_data'), empty: false });
        }
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.source, widget.dimension, widget.metric, filtersKey]);

  return state;
}
