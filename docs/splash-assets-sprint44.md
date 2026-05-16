# Splash Assets — Sprint 44 M1.1

Documentation des assets natifs requis pour les splash screens iOS / Android.
Brand Intralys cyan (#009DDB) en light mode + Stripe-deep (#0a2540) en dark mode.

## Configuration Capacitor

Voir `capacitor.config.ts` plugin `SplashScreen` :

- `backgroundColor: '#009DDB'` (light)
- Dark mode bg : géré via **assets natifs** (`drawable-night-*` Android +
  Asset Catalog dark variant iOS). Capacitor 8 ne supporte PAS
  `backgroundColorDark` au niveau du plugin config — voir sections iOS/Android
  ci-dessous.
- `showSpinner: false` (paradigm Stripe SUBTLE — pas de spinner natif)
- `launchShowDuration: 1500` (max — caché plus tôt par `SplashScreen.hide()` JS)
- `launchFadeOutDuration: 300` (fade out doux)
- `androidScaleType: 'CENTER_CROP'` (fit sans bordures)
- `splashFullScreen: true`

## Assets iOS

Dossier : `ios/App/App/Assets.xcassets/Splash.imageset/`

Fichiers existants (Sprint 35) :
- `splash-2732x2732.png` (1x — base)
- `splash-2732x2732-1.png` (2x)
- `splash-2732x2732-2.png` (3x)
- `Contents.json` (manifest Apple Asset Catalog)

### À régénérer pour Sprint 44

Asset master `splash-master.png` 2732×2732 PNG :
- Centre : logo Intralys mark cyan/orange sur fond `#009DDB`
- Variante dark : logo blanc sur fond `#0a2540` (Stripe-deep)
- Logo position : centré, taille 30% du canvas (819×819 dans 2732×2732)
- Format : PNG-24 avec transparence (pour `CENTER_CROP`)

### Variantes dark mode iOS

iOS 13+ supporte les Asset Catalogs avec variantes Appearance. Ajouter à `Contents.json` :

```json
{
  "images": [
    {
      "appearances": [
        { "appearance": "luminosity", "value": "light" }
      ],
      "filename": "splash-2732x2732.png",
      "idiom": "universal",
      "scale": "1x"
    },
    {
      "appearances": [
        { "appearance": "luminosity", "value": "dark" }
      ],
      "filename": "splash-2732x2732-dark.png",
      "idiom": "universal",
      "scale": "1x"
    }
  ]
}
```

### Storyboard LaunchScreen

`ios/App/App/Base.lproj/LaunchScreen.storyboard` charge `Splash` imageset.
Backround color via Interface Builder → System Background (auto-adaptatif).
Capacitor injecte aussi `backgroundColor` plugin pour cohérence.

## Assets Android

Dossier : `android/app/src/main/res/`

Dossiers densités (existants) :
- `drawable-port-mdpi/splash.png` (320×480 portrait)
- `drawable-port-hdpi/splash.png` (480×800)
- `drawable-port-xhdpi/splash.png` (720×1280)
- `drawable-port-xxhdpi/splash.png` (1080×1920)
- `drawable-port-xxxhdpi/splash.png` (1440×2560)
- `drawable-land-*` (versions landscape correspondantes)
- `drawable/splash.png` (fallback générique)

### À ajouter pour Sprint 44 — Dark mode

Créer dossiers `drawable-night-*` (Android 10+ qualifier dark mode) :
- `drawable-night-port-mdpi/splash.png`
- `drawable-night-port-hdpi/splash.png`
- `drawable-night-port-xhdpi/splash.png`
- `drawable-night-port-xxhdpi/splash.png`
- `drawable-night-port-xxxhdpi/splash.png`
- + versions landscape `drawable-night-land-*`

Asset master `splash-master-dark.png` :
- Fond `#0a2540` Stripe-deep
- Logo blanc centré

### colors.xml Android

`android/app/src/main/res/values/colors.xml` :
```xml
<color name="splash_background">#009DDB</color>
```

`android/app/src/main/res/values-night/colors.xml` (à créer si absent) :
```xml
<color name="splash_background">#0a2540</color>
```

## Cheatsheet régénération assets

Outil recommandé : `@capacitor/assets` (officiel)

```bash
# Setup
bun add -D @capacitor/assets

# Préparer dossier source à la racine
mkdir -p resources
# resources/splash.png      → 2732×2732 light (PNG-24)
# resources/splash-dark.png → 2732×2732 dark (PNG-24)
# resources/icon.png        → 1024×1024 icon (mêmes spécifications)

# Générer tous les assets natifs iOS+Android
bunx @capacitor/assets generate \
  --iconBackgroundColor '#009DDB' \
  --iconBackgroundColorDark '#0a2540' \
  --splashBackgroundColor '#009DDB' \
  --splashBackgroundColorDark '#0a2540'

# Sync vers projet natif
bun run cap:sync
```

## Validation pré-store

- [ ] Splash light affiche sur device clair (test iPhone + Pixel)
- [ ] Splash dark affiche sur device sombre (Settings → Display → Dark)
- [ ] Pas de FOUC visible entre splash → app boot (fade 300ms doux)
- [ ] `CENTER_CROP` fit Android sans bordures noires sur tablettes
- [ ] iOS LaunchScreen.storyboard charge bien le bon imageset
- [ ] Pas de spinner visible (paradigm SUBTLE Sprint 38)

## Préservations critiques

- Sprint 35 `androidScaleType: 'CENTER_CROP'` conservé
- Sprint 35 `overlaysWebView: false` (status bar) conservé
- Aucun glow/orb dramatic (paradigm Stripe SUBTLE post-RESET Sprint 38)
- Brand cyan #009DDB UNIQUEMENT splash/icon/CTAs commerciaux

## Notes

- Variante dark Android nécessite minSdkVersion 29 (Android 10) pour qualifier `-night`
  Sur Android 9 et moins → fallback automatique vers `drawable-port-*` light.
- iOS dark mode nécessite iOS 13+ (déjà target par défaut Capacitor 8).
- `launchAutoHide: false` important : on contrôle le hide depuis JS (`SplashScreen.hide()`
  dans `main.tsx`) pour synchroniser avec le boot React (pas avant le first paint).
