// ── Web Vitals tracker maison ───────────────────────────────
// Sprint 35 vague 35-1C — pas de dep externe (web-vitals npm pèse ~7KB gzip).
// On utilise PerformanceObserver natif pour récupérer :
//   - LCP (Largest Contentful Paint) — cible <2.5s
//   - CLS (Cumulative Layout Shift) — cible <0.1
//   - INP (Interaction to Next Paint) — cible <200ms
//   - TTFB (Time To First Byte) — cible <800ms
//   - FCP (First Contentful Paint) — cible <1.8s
//
// SSR-safe : tout est gated derrière `typeof window !== 'undefined'`.
// Dev : log console.info('[WebVital]', metric).
// Prod : stub prêt pour POST `/api/telemetry/web-vitals` (à câbler côté worker).

export type WebVitalName = 'LCP' | 'CLS' | 'INP' | 'TTFB' | 'FCP';

export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

export interface WebVitalMetric {
  /** Nom de la métrique Core Web Vitals */
  name: WebVitalName;
  /** Valeur numérique (ms pour LCP/INP/TTFB/FCP, score pour CLS) */
  value: number;
  /** Rating selon les seuils Google (good / needs-improvement / poor) */
  rating: WebVitalRating;
  /** Delta depuis la dernière mesure (utile pour CLS qui s'accumule) */
  delta: number;
  /** ID unique par session pour dédupliquer côté backend */
  id: string;
  /** URL au moment de la mesure */
  navigationType: string;
}

type MetricCallback = (metric: WebVitalMetric) => void;

// ── Seuils officiels Google (web.dev/vitals) ────────────────
const THRESHOLDS: Record<WebVitalName, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
  TTFB: { good: 800, poor: 1800 },
  FCP: { good: 1800, poor: 3000 },
};

function getRating(name: WebVitalName, value: number): WebVitalRating {
  const t = THRESHOLDS[name];
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Initialisation ──────────────────────────────────────────

/**
 * Initialise le tracking Web Vitals. À appeler une seule fois au boot.
 *
 * @param onMetric Callback appelé pour chaque métrique mesurée.
 *                 En dev : `console.info('[WebVital]', m)`.
 *                 En prod : `fetch('/api/telemetry/web-vitals', { method: 'POST', body: JSON.stringify(m) })`.
 *
 * @example
 *   initWebVitals((m) => console.info('[WebVital]', m));
 */
export function initWebVitals(onMetric: MetricCallback): void {
  // SSR / non-browser : no-op
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return;
  }

  // État interne pour CLS (cumulatif) et INP (worst-case sur la session)
  let clsValue = 0;
  let clsEntries: PerformanceEntry[] = [];
  const navigationType = window.location.pathname;

  const emit = (name: WebVitalName, value: number, delta: number) => {
    try {
      onMetric({
        name,
        value,
        rating: getRating(name, value),
        delta,
        id: generateId(),
        navigationType,
      });
    } catch {
      // Callback user-land ne doit jamais casser le tracker
    }
  };

  // ── LCP : Largest Contentful Paint ────────────────────────
  // On garde la dernière entrée (la "largest" change jusqu'au first input).
  try {
    let lcpValue = 0;
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        const v = (last as PerformanceEntry & { renderTime?: number; loadTime?: number }).renderTime
          ?? (last as PerformanceEntry & { loadTime?: number }).loadTime
          ?? last.startTime;
        const delta = v - lcpValue;
        lcpValue = v;
        emit('LCP', v, delta);
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });

    // Stop reporting LCP au first interaction (spec officielle)
    const stopLcp = () => {
      lcpObserver.disconnect();
      removeEventListener('keydown', stopLcp, true);
      removeEventListener('click', stopLcp, true);
    };
    addEventListener('keydown', stopLcp, { capture: true, once: true });
    addEventListener('click', stopLcp, { capture: true, once: true });
  } catch { /* PerformanceObserver type unsupported */ }

  // ── CLS : Cumulative Layout Shift ─────────────────────────
  // Spec : on accumule jusqu'au tab hide.
  try {
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // hadRecentInput = layout shift dû à une interaction user → on ignore
        const e = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!e.hadRecentInput && typeof e.value === 'number') {
          const delta = e.value;
          clsValue += delta;
          clsEntries.push(entry);
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });

    const reportCls = () => {
      if (clsEntries.length === 0) return;
      emit('CLS', clsValue, clsValue);
    };
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reportCls();
    });
    addEventListener('pagehide', reportCls);
  } catch { /* unsupported */ }

  // ── INP : Interaction to Next Paint ───────────────────────
  // On approxime via event timing API : on garde la pire latence d'event > 40ms.
  try {
    let worstInp = 0;
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { interactionId?: number; duration: number };
        if (e.interactionId && e.duration > worstInp) {
          const delta = e.duration - worstInp;
          worstInp = e.duration;
          emit('INP', worstInp, delta);
        }
      }
    });
    inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit & { durationThreshold?: number });
  } catch { /* unsupported */ }

  // ── TTFB + FCP (via Navigation + Paint Timing) ────────────
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      const ttfb = Math.max(0, nav.responseStart - nav.startTime);
      emit('TTFB', ttfb, ttfb);
    }
  } catch { /* unsupported */ }

  try {
    const paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          emit('FCP', entry.startTime, entry.startTime);
          paintObserver.disconnect();
        }
      }
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  } catch { /* unsupported */ }
}

// ── Helper : pousse vers backend (prod) ─────────────────────
// Stub à câbler quand l'endpoint `/api/telemetry/web-vitals` sera live.
// Sendbeacon est préféré car il survit au tab close.
export function reportToBackend(metric: WebVitalMetric, endpoint = '/api/telemetry/web-vitals'): void {
  if (typeof navigator === 'undefined') return;
  const body = JSON.stringify(metric);
  try {
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
    } else {
      void fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
    }
  } catch {
    // best-effort, jamais throw
  }
}

// ── Sprint 43 M1.4 — Alerting console dev + helper consolidé ─
// Wrapper "tout-en-un" qu'on peut câbler depuis main.tsx en remplacement
// du callback custom. Combine 3 comportements :
//   1. En dev : `console.info('[WebVital]', m)` pour visualisation continue.
//   2. Si seuils Google dépassés (rating === 'poor' OU 'needs-improvement'
//      sur LCP/CLS/INP) → `console.warn(...)` pour alerting immédiat.
//   3. En prod : `reportToBackend(m)` si endpoint env exists.
//
// Stub TODO côté worker : route POST `/api/telemetry/web-vitals` qui
// persiste {name, value, rating, url, ts} en D1 (table `web_vitals`,
// migration à créer avant la beta). Sample 10% en prod pour éviter
// noise + cost si trafic > 1k DAU.
//
// API backward-compatible : ce helper ne casse pas l'existant
// (main.tsx peut continuer d'utiliser sa callback inline).
export function initWebVitalsWithAlerts(opts?: {
  /** Si true, force le report backend même en dev (debug). Défaut false. */
  alwaysReportBackend?: boolean;
  /** Endpoint custom (défaut /api/telemetry/web-vitals). */
  endpoint?: string;
  /** Pourcentage de sampling en prod (0-100). Défaut 100 (à baisser post-beta). */
  sampleRate?: number;
}): void {
  const sampleRate = Math.max(0, Math.min(100, opts?.sampleRate ?? 100));
  // Détection environnement : on combine Vite (`import.meta.env.PROD`) +
  // fallback hostname-based pour tests jsdom où Vite env n'est pas injecté.
  const viteEnv = (import.meta as unknown as { env?: { PROD?: boolean; DEV?: boolean } }).env;
  const isViteProd = viteEnv?.PROD === true;
  const isViteDev = viteEnv?.DEV === true;
  const hostname = typeof window !== 'undefined' ? window.location?.hostname ?? '' : '';
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.');
  const reportBackend = opts?.alwaysReportBackend === true || isViteProd || (!isViteDev && !isLocalHost);

  initWebVitals((m) => {
    // 1. Log dev systématique
    if (isViteDev || isLocalHost) {
      // eslint-disable-next-line no-console
      console.info('[WebVital]', `${m.name}=${formatValue(m)}`, `(${m.rating})`);
    }

    // 2. Alerting console.warn si seuils dépassés (dev ou prod).
    //    On filtre sur LCP/CLS/INP qui sont les 3 Core Web Vitals officiels.
    //    TTFB/FCP : info-only, pas d'alert (corrélés réseau, hors contrôle code).
    if ((m.name === 'LCP' || m.name === 'CLS' || m.name === 'INP') && m.rating !== 'good') {
      // eslint-disable-next-line no-console
      console.warn(
        `[WebVitals] ${m.name} ${m.rating === 'poor' ? 'POOR' : 'slow'}: ${formatValue(m)}`,
        `(seuil good: ${formatThreshold(m.name, 'good')}, poor: ${formatThreshold(m.name, 'poor')})`,
      );
    }

    // 3. Report backend en prod (avec sampling).
    //    TODO worker : créer route POST /api/telemetry/web-vitals + table D1
    //    avant beta launch. Sample 100% pour l'instant (sampleRate=100).
    if (reportBackend && Math.random() * 100 < sampleRate) {
      reportToBackend(m, opts?.endpoint);
    }
  });
}

// Helpers internes formatting
function formatValue(m: WebVitalMetric): string {
  if (m.name === 'CLS') return m.value.toFixed(3);
  return `${Math.round(m.value)}ms`;
}
function formatThreshold(name: WebVitalName, kind: 'good' | 'poor'): string {
  const t = THRESHOLDS[name][kind];
  if (name === 'CLS') return t.toFixed(2);
  return `${t}ms`;
}
