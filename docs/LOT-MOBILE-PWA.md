# LOT 3 — Sprint 27 : Mobile / PWA

> Doc contrat §6 figé. Migration : seq124 — `migration-mobile-harden-seq124.sql`.

## Objectif
Sprint 27 = polish ciblé sur un socle DÉJÀ très mature (Sprint 11 Capacitor V1 + Sprint 23 wave 14 PWA + Sprint 35-2A + Sprint 44 M1/M2 push/offline).

5 axes ciblés :
1. Safe-area iOS patches (Toast, SlidePanel footer, QuickAddFab, Modal mobile, Sidebar landscape)
2. Extraction i18n des strings hardcodées (NetworkStatusBanner, SwUpdatePrompt, InstallPrompt, MobileBottomNav)
3. Enrichissement device_tokens seq124 (last_seen_at, app_version, enabled, device_label)
4. Alias `useOnlineStatus` (sucre sur useNetworkStatus existant)
5. Doc consolidée (cette doc) + checklist activation post-Sprint 30

## État actuel (audit Chaman 2026-05-22)

### Capacitor (mature)
- 12 plugins installés (@capacitor/{core,android,ios,cli,app,camera,haptics,keyboard,local-notifications,push-notifications,splash-screen,status-bar}) + capacitor-native-biometric
- `capacitor.config.ts` finalisé Sprint 44 — SplashScreen, StatusBar, Keyboard resize='body', PushNotifications presentationOptions, Deep links
- `src/main.tsx:initCapacitor()` + `initCapacitorLifecycle()` couvrent appStateChange, backButton Android, deep links

### PWA (mature)
- `public/manifest.webmanifest` : name, theme_color #009DDB, lang fr-CA, 5 icons, 3 shortcuts (Leads/Pipeline/Conversations)
- `public/sw.js` v3 : network-first HTML/JS/CSS/JSON, cache-first assets immuables, SKIP_WAITING handler
- `useSwUpdate.ts` détection update + applyUpdate
- `InstallPrompt.tsx` + `SwUpdatePrompt.tsx` UI

### Offline (très avancé)
- Dexie v2 : tables leads, conversations, tasks, mutations, cached_meta, outbox
- Delta sync via updated_after + fallback full refresh
- `enqueueMutation()`, `replayMutations()` avec 409/5xx/4xx, autoReplay sur 'online' event
- `useNetworkStatus` SSR-safe + `NetworkStatusBanner` global

### Push (Sprint 11 + 44 M1.3)
- `initPushNotifications()` permission + register + POST /devices + listeners
- `setupPushRouting(navigate)` routing typé 10 types (lead_new, message, task_due, etc.) + toast Sonner FR + badge reset iOS
- Backend `mobile.ts:handleRegisterDevice/handleUnregisterDevice` (PAS de capability — tied au userId)
- ⚠ `worker/push.ts:sendPushToUser()` utilise FCM Legacy HTTP API (deprecated juin 2024). **Migration FCM v1 HTTP + OAuth = backlog Sprint 30 RC**.

### Safe-area (PARTIEL — gaps à combler Sprint 27)
- Vars CSS `--safe-area-{top,bottom,left,right}` + 4 classes utilitaires `.cap-safe-area-*` + `header.cap-aware`
- MobileBottomNav, BottomSheet, main padding-bottom : OK
- **GAPS** : Toast bottom (écrasé home indicator), SlidePanel footer sticky, QuickAddFab (collision MobileBottomNav iPhone X+), Modal mobile, Sidebar drawer landscape

### i18n (gaps)
- 4 catalogues alignés ~5404-5409 lignes
- Strings hardcodées détectées dans NetworkStatusBanner (lignes 75-76), SwUpdatePrompt (24-28), InstallPrompt (31-80), MobileBottomNav (13-14)
- ~15-18 clés à ajouter × 4 catalogues = ~60-72 entrées

## Hors-scope (renvoyé)
- Activation push réelle (APNs keys + FCM HTTP v1 OAuth migration) → Sprint 30 RC
- Refonte Pipeline kanban mobile horizontal → backlog
- App Store / Play Store submission → Sprint 30 RC
- vite-plugin-pwa migration → backlog (SW vanilla parfaitement adapté)
- IndexedDB sync queue complète CRUD → backlog (outbox messages suffit critique)
- Capacitor 9 upgrade → backlog (Capacitor 8 stable)
- App Clips / Instant App → backlog
- Biometric login UI refonte → Sprint 11 livré

## §6 Contrats figés

### 6.1 Migration SQL `migration-mobile-harden-seq124.sql`

```sql
-- ── Sprint 27 — Mobile / PWA harden — seq124 (2026-05-22) ───────────────────
-- 100% ADDITIF : ALTER TABLE ADD COLUMN nullables sans DEFAULT non-constant.
-- AUCUN ALTER de CHECK. AUCUNE capability ajoutée (ALL_CAPABILITIES seq80 figées).
-- Sources de vérité :
--   - device_tokens : migration_p3_10.sql:7-13 (seq20) + migration-phase36.sql (seq44 redondance)
-- Objectif : préparer cleanup tokens stale (cron futur) + user-toggle push notifications
-- par device sans casser le schema existant.
-- depends_on : migration_p3_10.sql (seq20), migration-perf-indexes-seq123.sql (seq123)

ALTER TABLE device_tokens ADD COLUMN last_seen_at TEXT;
ALTER TABLE device_tokens ADD COLUMN app_version TEXT;
ALTER TABLE device_tokens ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE device_tokens ADD COLUMN device_label TEXT;

CREATE INDEX IF NOT EXISTS idx_device_tokens_enabled ON device_tokens(user_id, enabled);
```

**Manifest entry** (`docs/migrations-manifest.json`) :

```json
{
  "seq": 124,
  "file": "migration-mobile-harden-seq124.sql",
  "depends_on": ["migration_p3_10.sql", "migration-perf-indexes-seq123.sql"],
  "objects": ["alter:device_tokens", "index:device_tokens"],
  "risk": "low"
}
```

### 6.2 Types — `src/lib/types.ts` append

```ts
// ── Sprint 27 — Mobile / PWA : DeviceToken étendu (seq124) ────────────────
export interface DeviceToken {
  id: string;
  user_id: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  last_seen_at: string | null;
  app_version: string | null;
  enabled: 0 | 1;
  device_label: string | null;
  created_at: string;
}
```

### 6.3 `src/hooks/useNetworkStatus.ts` extension

Ajout d'un alias public en bas du fichier, **sans toucher** l'implémentation existante :

```ts
/**
 * Alias public de `useNetworkStatus` pour sémantique "online/offline" claire.
 * Comportement byte-identique : retourne `{ isOnline: boolean; lastChange: Date }`.
 * `lastChange` est initialisé à la date du mount (jamais null).
 */
export const useOnlineStatus = useNetworkStatus;
```

> Note implémentation : le contrat de retour de `useNetworkStatus` est
> `{ isOnline: boolean; lastChange: Date }` (lastChange JAMAIS null — initialisé
> `new Date()` au mount). Le §6 doc original mentionnait `Date | null` ; la JSDoc
> appliquée reflète la signature RÉELLE pour éviter toute confusion consommateur.

### 6.4 Doc — `docs/LOT-MOBILE-PWA.md` (ce fichier)
Inventaire socle existant + §6 verbatim + checklist post-Sprint 30.

### 6.5 Safe-area patches (Manager-C)
- `Toast.tsx` : padding-bottom `calc(env(safe-area-inset-bottom) + 16px)` sur les toasts ancrés bas.
- `SlidePanel.tsx` : footer sticky → `padding-bottom: env(safe-area-inset-bottom)`.
- `QuickAddFab.tsx` : `bottom: calc(env(safe-area-inset-bottom) + var(--mobile-bottom-nav-height) + 16px)` pour éviter collision MobileBottomNav iPhone X+.
- `Modal.tsx` : sur mobile, padding-bottom safe-area sur le footer d'actions.
- `Sidebar.tsx` : drawer landscape → `padding-left: env(safe-area-inset-left)`.

### 6.6 i18n extraction (Manager-C)
~15-18 clés à ajouter × 4 catalogues (fr-CA, fr-FR, en, es) = ~60-72 entrées.
Cibles : `NetworkStatusBanner` (offline/back online), `SwUpdatePrompt` (update available / refresh CTA), `InstallPrompt` (install CTA + bénéfices), `MobileBottomNav` (labels onglets).

### 6.7 Backend `mobile.ts` (Manager-B)
- `handleRegisterDevice` : accepter optionnels `app_version` + `device_label` ; bumper `last_seen_at = now()`.
- `handleUnregisterDevice` : inchangé (DELETE WHERE token + user_id).
- Nouveau `handleUpdateDevicePreference(device_id, enabled)` : toggle 0/1 sur la colonne `enabled` (scopé user_id auth).
- Cron cleanup futur : `DELETE FROM device_tokens WHERE last_seen_at < now()-30j AND enabled=1` (post-Sprint 30, hors scope Sprint 27).

## Garde-fous
- `public/sw.js` INTERDIT Sprint 27 (v3 stable, bump v4 casse cache users existants)
- `capacitor.config.ts` INTERDIT (config plateforme critique)
- Safe-area patches : `env()` retourne 0px par défaut → zéro impact desktop
- `device_tokens` colonnes ajoutées nullable ou DEFAULT 1 → backward compatible
- `ALL_CAPABILITIES` seq80 INTOUCHABLE
- FCM Legacy deprecated documenté ici, migration HTTP v1 + OAuth = prérequis activation push (Sprint 30)

## Checklist activation post-Sprint 30 (release candidate)
- [ ] FCM HTTP v1 OAuth migration (`worker/push.ts:sendPushToUser` refactor)
- [ ] APNs keys provisioning + iOS push entitlements
- [ ] Cron cleanup `device_tokens WHERE last_seen_at < now()-30j AND enabled=1` (seq124 colonnes prêtes)
- [ ] User-toggle push notifications par device dans `SettingsNotifications` (UI à créer)
- [ ] Test push end-to-end iOS device + Android device
- [ ] App Store metadata + screenshots (Sprint 30 RC)
- [ ] Play Store metadata + screenshots
