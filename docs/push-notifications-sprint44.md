# Push Notifications — Sprint 44 M1.3

Setup FCM (Android) + APNs (iOS) pour les push notifications natives via
`@capacitor/push-notifications`. Le plugin est déjà installé (Sprint 11).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Cloudflare Workers backend                                          │
│   POST /devices  ← stocke {token, platform, userId}                 │
│   POST /push/send ← envoie via FCM Admin SDK + APNs HTTP/2          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
         ┌────────────────┐              ┌────────────────┐
         │ FCM (Android)  │              │ APNs (iOS)     │
         └────────────────┘              └────────────────┘
                  │                               │
                  ▼                               ▼
         ┌────────────────────────────────────────────────┐
         │ Device → @capacitor/push-notifications         │
         │   - pushNotificationReceived (foreground)      │
         │   - pushNotificationActionPerformed (bg tap)   │
         └────────────────────────────────────────────────┘
                                  │
                                  ▼
         ┌────────────────────────────────────────────────┐
         │ src/lib/push.ts          → register + POST     │
         │ src/lib/pushNotifications.ts                   │
         │   - setupPushRouting (TanStack routing typé)   │
         │   - resetPushBadge (iOS badge clear)           │
         └────────────────────────────────────────────────┘
```

## Payload format attendu (backend → device)

```json
{
  "notification": {
    "title": "Nouveau lead",
    "body": "Marie Tremblay vient de remplir le formulaire."
  },
  "data": {
    "type": "lead_new",
    "leadId": "lead_abc123"
  }
}
```

### Types supportés (`data.type`)

Voir `src/lib/pushNotifications.ts` → `PushType`.

| `data.type`        | Champs métier requis | Route TanStack                       |
|--------------------|----------------------|--------------------------------------|
| `lead_new`         | `leadId`             | `/leads/:id`                         |
| `lead_assigned`    | `leadId`             | `/leads/:id`                         |
| `lead_hot`         | `leadId`             | `/leads/:id`                         |
| `message`          | `convId`             | `/conversations?conv=:id`            |
| `task_due`         | `taskId`             | `/tasks?focus=:id`                   |
| `task_assigned`    | `taskId`             | `/tasks?focus=:id`                   |
| `appointment_soon` | `apptId`             | `/calendar?focus=:id`                |
| `workflow_alert`   | `workflowId`         | `/workflows/:id`                     |
| `review_new`       | (aucun)              | `/reviews`                           |
| `system`           | (aucun)              | (toast only, pas de navigation)      |

Fallback : si `data.url` est présent (URL absolue ou relative), il est utilisé
en priorité avant le routing typé. Permet aux push backend simples de spécifier
directement la cible.

## Setup Android — FCM

### 1. Créer un projet Firebase

1. https://console.firebase.google.com/ → Add project → `intralys-crm`
2. Add Android app :
   - Package name : `com.intralys.crm` (= `appId` Capacitor)
   - Nickname : `Intralys CRM Android`
3. Télécharger `google-services.json`
4. Placer dans : `android/app/google-services.json`

### 2. Configurer Gradle

`android/build.gradle` (project-level) — ajouter dans `dependencies` du
`buildscript` :
```gradle
classpath 'com.google.gms:google-services:4.4.2'
```

`android/app/build.gradle` (app-level) — ajouter en haut :
```gradle
apply plugin: 'com.google.gms.google-services'
```

### 3. Permissions Manifest

Le plugin Capacitor injecte automatiquement les permissions FCM nécessaires
(`com.google.android.c2dm.permission.RECEIVE` + service). Aucune action manuelle.

### 4. Notification icon Android

Créer `android/app/src/main/res/drawable/ic_stat_notify.png` (24×24 monochrome
white + transparency). Sinon Android utilise `@mipmap/ic_launcher` (couleur,
non recommandé).

## Setup iOS — APNs

### 1. Activer Push capability

Xcode → `App` target → Signing & Capabilities → `+ Capability` →
**Push Notifications**

Apple ajoute automatiquement le fichier d'entitlements suivant :
`ios/App/App/App.entitlements` :
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>aps-environment</key>
  <string>production</string>
</dict>
</plist>
```

(Dev : `development`. Le build pour TestFlight passe à `production`.)

### 2. Background Modes

Xcode → `App` target → Signing & Capabilities → `+ Capability` →
**Background Modes** → cocher :
- `Remote notifications`

### 3. APNs Auth Key (côté serveur)

Apple Developer Console → Keys → Create Key :
- Nom : `Intralys Push APNs Key`
- Cocher `Apple Push Notifications service (APNs)`
- Télécharger le `.p8` (UNE SEULE FOIS — non re-téléchargeable)

Variables backend Cloudflare Workers à configurer :
- `APNS_KEY_ID` : visible dans Apple Developer Console
- `APNS_TEAM_ID` : visible dans Membership
- `APNS_KEY_P8` : contenu du `.p8` (multiline → base64 ou secret CF)
- `APNS_BUNDLE_ID` : `com.intralys.crm`
- `APNS_ENV` : `production` ou `development`

### 4. Info.plist iOS

Aucune modification requise (Capacitor gère via plugin Push).

## Foreground behavior

Sur iOS, par défaut, une push reçue **foreground** ne déclenche PAS la
notification système (banner). Capacitor remonte l'event `pushNotificationReceived`
au JS — qu'on transforme en toast Sonner avec action "Ouvrir".

Sur Android, idem (système silencieux en foreground), géré côté Sonner.

Configuration `presentationOptions: ['badge', 'sound', 'alert']` dans
`capacitor.config.ts` → la **prochaine fois** que l'app est en background,
la notif s'affiche en banner natif normalement.

## Reset badge iOS

L'app icon iOS affiche un badge count (rouge) par push délivrée.
`resetPushBadge()` est appelé au mount de `AppLayout` → l'user voit la notif
dans l'app → badge se vide automatiquement.

## Sécurité

- Le token push (FCM/APNs) est associé à un user authenticated côté backend.
- Au logout, appeler `unregisterPush()` (déjà dans `src/lib/push.ts`) pour
  retirer le token de la DB → évite que d'anciens tokens reçoivent les push
  d'un autre user sur le même device (cas iPad partagé, etc.).
- Loi 25 (QC) : les push notifications relèvent du consentement explicite.
  Le flow demande la permission via `PushNotifications.requestPermissions()`
  (déjà géré dans `initPushNotifications`).

## Test E2E

### Test local (sans backend prod)

```bash
# iOS Simulator (Push Notifications fonctionne depuis Xcode 14.5+)
xcrun simctl push booted com.intralys.crm push-payload.json

# Android Emulator (Firebase Test Send)
# Firebase Console → Cloud Messaging → New Notification → Send test message
# Coller le token FCM affiché dans logs Capacitor (registration listener)
```

### Payload de test (`push-payload.json` iOS Simulator)

```json
{
  "Simulator Target Bundle": "com.intralys.crm",
  "aps": {
    "alert": {
      "title": "Nouveau lead",
      "body": "Marie Tremblay vient de remplir le formulaire."
    },
    "sound": "default",
    "badge": 1
  },
  "type": "lead_new",
  "leadId": "lead_abc123"
}
```

## Préservations critiques

- Sprint 11 `src/lib/push.ts` (registration + token POST `/devices`) intact
- Sprint 35 `initCapacitorLifecycle` lifecycle préservé (separate function)
- `pushNotificationReceived` listener AJOUTÉ (pas remplacé) — idempotent
- Compat fallback `data.url` → `window.location.href` conservée
