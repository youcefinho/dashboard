import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.intralys.crm',
  appName: 'Intralys CRM',
  webDir: 'dist',
  // ── Sprint 35 vague 35-2A — Native polish ────────────────────────────────
  // iosScheme/androidScheme forcés en `https` pour cohérence cookies / Same-Site
  // avec le backend Cloudflare (sinon scheme natif `capacitor://` casse SSO).
  ios: {
    scheme: 'https',
  },
  server: {
    // En production, l'app charge depuis le serveur Cloudflare
    url: 'https://crm.intralys.com',
    cleartext: false,
    iosScheme: 'https',
    androidScheme: 'https',
  },
  plugins: {
    // ── Sprint 44 M1.1 — Splash screens cyan/orange brand ──────────────────
    // Fond cyan #009DDB en light, Stripe-deep #0a2540 en dark.
    // showSpinner désactivé pour boot plus net (Stripe paradigm SUBTLE).
    // fadeOutDuration géré côté JS via SplashScreen.hide({fadeOutDuration:300}).
    // Assets requis : voir docs/splash-assets-sprint44.md
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#009DDB',
      // Dark mode bg géré via assets natifs (drawable-night-* Android +
      // Asset Catalog dark variant iOS) — pas de prop `backgroundColorDark`
      // dans le plugin Capacitor 8. Voir docs/splash-assets-sprint44.md.
      showSpinner: false,
      androidSpinnerStyle: 'small',
      iosSpinnerStyle: 'small',
      spinnerColor: '#FFFFFF',
      launchShowDuration: 1500,
      launchFadeOutDuration: 300,
      // Sprint 35-2A — fit Android sans bordures
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: false,
      useDialog: false,
    },
    StatusBar: {
      // Sprint 44 M1.2 — Style adaptatif géré via initCapacitorLifecycle()
      // qui écoute prefers-color-scheme et bascule LIGHT/DARK content.
      // Backgrounds : cyan #009DDB (light) → Stripe-deep #0a2540 (dark).
      style: 'LIGHT',
      backgroundColor: '#009DDB',
      // Sprint 35-2A — pas d'overlay webview : le contenu commence sous la
      // status bar (combiné avec env(safe-area-inset-top) côté CSS pour iOS).
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'body',
      scrollPadding: false,
    },
    // ── Sprint 44 M1.3 — Push notifications config ─────────────────────────
    // Setup wiré côté JS via src/lib/push.ts (déjà existant).
    // FCM Android (google-services.json) + APNs iOS (entitlements) : voir
    // docs/push-notifications-sprint44.md
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // ── Sprint 44 M1.4 — Deep links ────────────────────────────────────────
    // App.appUrlOpen listener wiré dans src/main.tsx initCapacitorLifecycle.
    // Schemes natifs `intralys://` configurés via :
    //   - iOS : Info.plist CFBundleURLTypes
    //   - Android : AndroidManifest.xml intent-filter scheme="intralys"
    // Universal links https://crm.intralys.com configurés via :
    //   - iOS : App.entitlements applinks:crm.intralys.com + AASA file
    //   - Android : intent-filter autoVerify="true" + assetlinks.json
    // Voir docs/deep-links-sprint44.md.
  },
};

export default config;
