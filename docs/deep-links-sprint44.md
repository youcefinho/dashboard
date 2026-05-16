# Deep Links + Universal Links — Sprint 44 M1.4

Permet d'ouvrir l'app Intralys CRM directement sur une route précise via :
- **URL Scheme natif** : `intralys://leads/abc`, `intralys://inbox/conv_x`, etc.
- **Universal Links** : `https://crm.intralys.com/leads/abc` → ouvre l'app si
  installée, sinon ouvre le site dans le navigateur.

## Architecture

```
Boot natif (main.tsx)
   ↓
initCapacitorLifecycle()
   ↓
initDeepLinks()  ← App.appUrlOpen listener + buffer initial getLaunchUrl()
   ↓
[URLs bufferisées en attendant le RouterProvider]
   ↓
AppLayout mount
   ↓
consumeDeepLink(navigate)  ← drain le buffer + s'enregistre comme consumer
   ↓
TanStack Router navigate({ to, search })
```

Le buffer est nécessaire car un cold-start via deep link envoie l'URL AVANT
que le RouterProvider soit mounté.

## URL Schemes supportés

### Native scheme (`intralys://`)

| URL                                | Route TanStack                      |
|------------------------------------|-------------------------------------|
| `intralys://`                      | `/dashboard`                        |
| `intralys://leads/lead_abc`        | `/leads/lead_abc`                   |
| `intralys://leads`                 | `/leads`                            |
| `intralys://pipeline`              | `/pipeline`                         |
| `intralys://inbox/conv_xyz`        | `/conversations?conv=conv_xyz`      |
| `intralys://tasks/task_42`         | `/tasks?focus=task_42`              |
| `intralys://calendar/appt_99`      | `/calendar?focus=appt_99`           |
| `intralys://workflows/wf_1`        | `/workflows/wf_1`                   |
| `intralys://reviews`               | `/reviews`                          |
| `intralys://reports`               | `/reports`                          |
| `intralys://settings`              | `/settings`                         |

### Universal links (https://crm.intralys.com/...)

Identique au native scheme, sauf que c'est le pathname de l'URL absolue qui
est utilisé. Toutes les routes web sont supportées 1:1.

Note : `intralys://inbox/:convId` est une syntaxe raccourcie (le path web est
`/conversations?conv=:id`). Les routes natives mappent vers les routes web
canoniques.

## Configuration iOS

### 1. URL Scheme natif (`intralys://`)

Déjà ajouté dans `ios/App/App/Info.plist` (Sprint 44 M1.4) :
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.intralys.crm.deeplink</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>intralys</string>
    </array>
  </dict>
</array>
```

### 2. Universal Links (Associated Domains)

#### a. Ajouter capability Xcode

Xcode → `App` target → Signing & Capabilities → `+ Capability` →
**Associated Domains**

Apple ajoute (ou crée) `ios/App/App/App.entitlements` :
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.developer.associated-domains</key>
  <array>
    <string>applinks:crm.intralys.com</string>
  </array>
  <!-- Si push aussi activées (M1.3) -->
  <key>aps-environment</key>
  <string>production</string>
</dict>
</plist>
```

#### b. Déposer `apple-app-site-association` sur le serveur

Fichier à placer sur Cloudflare :
`https://crm.intralys.com/.well-known/apple-app-site-association`

Contenu :
```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAMID.com.intralys.crm",
        "paths": [
          "/leads/*",
          "/pipeline",
          "/conversations",
          "/conversations/*",
          "/tasks",
          "/tasks/*",
          "/calendar",
          "/calendar/*",
          "/workflows",
          "/workflows/*",
          "/reviews",
          "/reports",
          "/settings",
          "/settings/*",
          "/dashboard",
          "NOT /api/*",
          "NOT /_static/*"
        ]
      }
    ]
  }
}
```

Remplacer `TEAMID` par le Team ID Apple Developer (visible dans Membership).

**Important** :
- Servir avec `Content-Type: application/json` (PAS `text/plain`).
- Pas de redirection — Apple télécharge directement le fichier statique.
- Pas de mime-type `.json` extension (URL doit être exactement
  `/.well-known/apple-app-site-association`, sans extension).

Sur Cloudflare Workers, ajouter dans `worker.ts` :
```typescript
if (url.pathname === '/.well-known/apple-app-site-association') {
  return new Response(JSON.stringify(AASA_PAYLOAD), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
```

#### c. Test universal links iOS

```bash
# Depuis terminal Mac avec device USB-connected
xcrun simctl openurl booted https://crm.intralys.com/leads/lead_abc

# Validation Apple
swcutil dl -d crm.intralys.com
```

## Configuration Android

### 1. Intent filters

Déjà ajouté dans `android/app/src/main/AndroidManifest.xml` (Sprint 44 M1.4) :

```xml
<!-- Native scheme intralys:// -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="intralys" />
</intent-filter>

<!-- App Links (universal links Android) -->
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" />
  <data android:host="crm.intralys.com" />
</intent-filter>
```

### 2. Déposer `assetlinks.json` sur le serveur

`autoVerify="true"` exige qu'Android puisse vérifier le domaine. Fichier à
placer sur Cloudflare :
`https://crm.intralys.com/.well-known/assetlinks.json`

Contenu :
```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.intralys.crm",
      "sha256_cert_fingerprints": [
        "XX:XX:XX:XX:..."
      ]
    }
  }
]
```

Pour obtenir le SHA-256 du keystore :
```bash
# Debug keystore (dev)
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey \
  -storepass android -keypass android | grep SHA256

# Release keystore (prod) — celui qui signe le AAB déposé sur Play Store
keytool -list -v -keystore /path/to/release.keystore | grep SHA256
```

Tu peux inclure plusieurs SHA-256 dans le tableau (debug + release).
Recommandé : **2 entrées** (debug + release).

Servir avec `Content-Type: application/json` sur Cloudflare Workers (même
pattern que AASA).

### 3. Test App Links Android

```bash
# Test scheme natif
adb shell am start -a android.intent.action.VIEW \
  -d "intralys://leads/lead_abc" com.intralys.crm

# Test universal link (https://) — doit ouvrir l'app, pas le navigateur
adb shell am start -a android.intent.action.VIEW \
  -d "https://crm.intralys.com/leads/lead_abc"

# Vérifier l'auto-verification
adb shell pm get-app-links com.intralys.crm
```

Si auto-verification échoue → l'URL https:// ouvre le navigateur au lieu
de l'app. Vérifier que `assetlinks.json` est bien servi en JSON sans
redirection.

## TODO Cloudflare Workers — déposer les fichiers AASA + assetlinks

Au moment du déploiement Sprint 44 (next prod push) :

1. Récupérer Team ID Apple + SHA-256 Android keystore depuis Rochdi
2. Créer les payloads JSON dans `src/worker.ts` (constants)
3. Wirer le routing pour `/.well-known/apple-app-site-association` et
   `/.well-known/assetlinks.json` → `Content-Type: application/json`
4. Tester avec `xcrun simctl openurl` (iOS) + `adb shell` (Android)

## Préservations critiques

- Sprint 35 `initCapacitorLifecycle` lifecycle intact (back button + appStateChange)
- TanStack Router instance non polluée (navigate passé via closure)
- Buffer pattern → pas de race condition cold-start
- API publique `initCapacitorLifecycle` signature unchanged

## Cas d'usage business

- **Push notification** → `data.url = "intralys://leads/abc"` → tap → app
  ouvre directement le lead
- **Email transactionnel** → CTA "Voir le lead" → `https://crm.intralys.com/leads/abc`
  → si app installée, ouvre l'app ; sinon site web
- **SMS Loi 25 consent confirmation** → lien `https://crm.intralys.com/...`
  même comportement
- **QR code commercial Intralys** → `intralys://demo` ouvre le mode démo dans
  l'app (TODO : ajouter route `/demo-mode` côté natif)
