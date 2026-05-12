# 📱 Process de release mobile — Intralys CRM

> Ce document décrit le processus pour chaque release mobile iOS/Android.
> Suivre TOUTES les étapes dans l'ordre. Aucune étape n'est optionnelle.

---

## Pré-requis

| Plateforme | Compte | Coût |
|---|---|---|
| iOS | Apple Developer Program | 99 $/an |
| Android | Google Play Console | 25 $ one-time |
| Push | Firebase Console (FCM) | Gratuit |

### Comptes et clés nécessaires

- **FCM_SERVER_KEY** → Firebase Console > Project Settings > Cloud Messaging
- **Apple Push Certificate** (`.p8`) → Apple Developer > Keys
- **Android Keystore** → généré localement (`keytool`)

---

## Check-list release

### 1. Pré-build

- [ ] `bun run build` → 0 erreurs
- [ ] `npx vitest run` → 108+ tests passent
- [ ] `bunx cap sync` → iOS + Android synchronisés
- [ ] Version bump dans `package.json` + `capacitor.config.ts`
- [ ] Vérifier que `VITE_API_URL` pointe vers prod dans `.env`

### 2. Android

```bash
# Ouvrir dans Android Studio
bunx cap open android

# Dans Android Studio :
# 1. Build > Generate Signed Bundle / APK
# 2. Sélectionner le keystore (créé au premier release)
# 3. Build AAB pour Google Play ou APK pour test direct
# 4. Upload sur Google Play Console > Internal Testing
```

- [ ] Keystore sauvegardé en lieu sûr (jamais dans git !)
- [ ] Version code incrémenté dans `android/app/build.gradle`
- [ ] Screenshots mis à jour si changements UI majeurs
- [ ] Data safety form à jour

### 3. iOS (requiert Mac + Xcode)

```bash
# Ouvrir dans Xcode
bunx cap open ios

# Dans Xcode :
# 1. Sélectionner le scheme "App" > destination "Any iOS Device"
# 2. Product > Archive
# 3. Distribute App > App Store Connect > TestFlight
# 4. Attendre la validation (~30 min)
```

- [ ] Provisioning profile valide et à jour
- [ ] Push notification entitlement activé
- [ ] Privacy manifest à jour (iOS 17+)
- [ ] Screenshots iPhone 15 + iPad mis à jour
- [ ] App Review Guidelines vérifiées

### 4. Post-release

- [ ] Tester l'app installée depuis TestFlight / Internal Testing
- [ ] Vérifier push notification end-to-end
- [ ] Vérifier login + biometric auth
- [ ] Vérifier mode offline (couper le wifi 30 sec, naviguer)
- [ ] Vérifier click-to-call
- [ ] Vérifier mode visite + photo

### 5. Promotion

- [ ] Internal Testing → Closed Beta (Android)
- [ ] TestFlight → External Testing (iOS)
- [ ] Informer les beta testeurs par email
- [ ] Collecter feedback pendant 48h minimum
- [ ] Si OK → promouvoir en production

---

## Store listings

### Google Play Store

| Champ | Valeur |
|---|---|
| **Titre** | Intralys CRM |
| **Description courte** | CRM tout-en-un pour PMEs francophones |
| **Catégorie** | Business > Productivity |
| **Feature graphic** | 1024x500px, branding Intralys |
| **Screenshots** | 4 minimum (téléphone) |
| **Langue** | Français (Canada) |
| **Politique de confidentialité** | https://crm.intralys.com/legal/privacy |

### Apple App Store

| Champ | Valeur |
|---|---|
| **Nom** | Intralys CRM |
| **Sous-titre** | Votre CRM, partout avec vous |
| **Catégorie** | Business |
| **Prix** | Gratuit (modèle SaaS) |
| **Screenshots** | 4 min (iPhone 15 + iPad) |
| **Langue** | Français (Canada) |
| **Politique de confidentialité** | https://crm.intralys.com/legal/privacy |
| **Privacy Nutrition Labels** | À remplir honnêtement (contacts, analytics) |

---

## Versioning

Format : `MAJOR.MINOR.PATCH`

- `1.0.0` → Premier release
- `1.1.0` → Nouvelle feature
- `1.0.1` → Bug fix
- `2.0.0` → Refonte majeure

### Où changer la version

1. `package.json` → `"version": "x.y.z"`
2. Android : `android/app/build.gradle` → `versionName` + `versionCode`
3. iOS : Xcode > Target > General > Version + Build

---

## Rollback

Si un bug critique est découvert en production :

1. **Google Play** : dépromouvoir vers Internal Testing
2. **Apple** : arrêter la distribution via App Store Connect
3. **Fix** : corriger, rebuilder, re-soumettre
4. **Communiquer** : email aux beta testeurs

---

_Document créé le 2026-05-12. Mis à jour à chaque release._
