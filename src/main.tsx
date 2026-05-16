import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { Capacitor } from '@capacitor/core';

// ── Init Capacitor plugins au boot (natif uniquement) ───────
// Sprint 44 M1.2 — Status bar adaptatif prefers-color-scheme
//                  + Splash fadeOutDuration 300ms (paradigm Stripe SUBTLE)
//                  + data-capacitor flag pour CSS conditionnels (safe-area)
async function initCapacitor() {
  if (!Capacitor.isNativePlatform()) return;

  // Sprint 44 M1.2 — flag CSS pour les rules `html[data-capacitor="true"]`
  // (safe-area top header sticky + splash hand-off bg color)
  try {
    document.documentElement.dataset.capacitor = 'true';
    document.documentElement.dataset.appBooting = 'true';
    // Cleared après le splash hide → flag temporaire boot only
    setTimeout(() => {
      delete document.documentElement.dataset.appBooting;
    }, 1800);
  } catch { /* ignore */ }

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');

    // Helper : applique style + background selon le scheme courant.
    // `Light` style = contenu LIGHT (icônes blanches) sur background sombre.
    // `Dark`  style = contenu DARK  (icônes sombres) sur background clair.
    // Notre app par défaut : background light → contenu DARK.
    // Sauf si user a forcé dark → background Stripe-deep → contenu LIGHT.
    const applyStatusBar = async (dark: boolean) => {
      try {
        await StatusBar.setStyle({ style: dark ? Style.Light : Style.Dark });
        await StatusBar.setBackgroundColor({
          color: dark ? '#0a2540' : '#FFFFFF',
        });
      } catch { /* non critique */ }
    };

    // Détection initiale + listener changements (toggle dark mode iOS/Android)
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    const initialDark = !!mql?.matches;
    await applyStatusBar(initialDark);

    if (mql && typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', (e) => {
        void applyStatusBar(e.matches);
      });
    } else if (mql && typeof mql.addListener === 'function') {
      // Fallback iOS < 14
      mql.addListener((e) => { void applyStatusBar(e.matches); });
    }
  } catch { /* non critique */ }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    // Cacher le splash après le render React (fade 300ms doux)
    setTimeout(() => {
      void SplashScreen.hide({ fadeOutDuration: 300 });
    }, 1500);
  } catch { /* non critique */ }
}

void initCapacitor();

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// ── Sprint 35 vague 35-2A — Capacitor native polish élargi ──────────────────
// App resume/pause + back button Android stub. On garde un import dynamique
// pour éviter de pénaliser le bundle web (zero-cost en browser via tree-shake).
async function initCapacitorLifecycle() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { App: CapApp } = await import('@capacitor/app');

    // App resume → log + ré-hydrate auth (utile après long background)
    CapApp.addListener('appStateChange', (state) => {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.info('[Capacitor] appStateChange', state);
      }
      // Hook futur : si state.isActive && lastActiveAgo > 5min → refresh /me
    });

    // Back button Android : si on est à la racine, on minimise plutôt que quit
    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        void CapApp.minimizeApp();
      }
    });
  } catch {
    /* @capacitor/app non installé en dev/web — ignore */
  }

  // ── Sprint 44 M1.4 — Deep links init (App.appUrlOpen + getLaunchUrl) ────
  // Wire le listener + buffer les URLs jusqu'à ce que AppLayout mount
  // `consumeDeepLink(navigate)`. Cold start via deep link supporté.
  try {
    const { initDeepLinks } = await import('./lib/deepLinks');
    await initDeepLinks();
  } catch {
    /* fail silent — pas critique */
  }
}

void initCapacitorLifecycle();

// ── Sprint 35 vague 35-1C — Web Vitals tracker (LCP/CLS/INP/TTFB/FCP) ────────
// Sprint 43 M1.4 — bascule sur initWebVitalsWithAlerts qui ajoute :
//   1. Log dev systématique (`[WebVital] LCP=1240ms (good)`)
//   2. Alerting console.warn si seuils dépassés sur LCP/CLS/INP
//      (LCP > 2.5s, CLS > 0.1, INP > 200ms)
//   3. Report backend automatique en prod via sendBeacon (sampleRate
//      configurable — défaut 100% pour beta, à baisser post-launch).
// SSR-safe via gates `typeof window` internes au module.
import { initWebVitalsWithAlerts } from './lib/webVitals';
initWebVitalsWithAlerts({
  // sampleRate: 10, // ← post-beta : sampler 10% du trafic prod pour limiter cost
});
