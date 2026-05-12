# Sprint 11 — App Mobile Capacitor V1 (~15j)

> Objectif : wrapper le frontend React/Vite existant en app native iOS + Android
> via Capacitor 6. Push notifications, click-to-call, biometric auth, camera
> pour mode visite, offline partiel. Pas de refonte UI (déjà responsive Sprint 9).

---

## Phase A — Setup Capacitor (1.5j)

### A.1 — Installation et init (0.5j)

```bash
bun add @capacitor/core @capacitor/cli
bun add @capacitor/ios @capacitor/android
bun add @capacitor/app @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen @capacitor/keyboard
npx cap init "Intralys CRM" "com.intralys.crm" --web-dir=dist
npx cap add ios
npx cap add android
```

#### [NEW] `capacitor.config.ts`
```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.intralys.crm',
  appName: 'Intralys CRM',
  webDir: 'dist',
  server: {
    // En production, l'app charge depuis le serveur Cloudflare
    url: 'https://crm.intralys.com',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#009DDB',
      showSpinner: true,
      spinnerColor: '#FFFFFF',
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#009DDB',
    },
    Keyboard: {
      resize: 'body',
      scrollPadding: false,
    },
  },
};

export default config;
```

### A.2 — Adapter API_BASE pour natif (0.5j)

#### [MODIFY] `src/lib/api.ts`
L'API_BASE actuel est `/api` (relatif). En contexte Capacitor natif, les requêtes
partent de `capacitor://localhost`, pas du domaine Cloudflare.

Solution : détecter la plateforme et préfixer.

```ts
import { Capacitor } from '@capacitor/core';

const API_BASE = Capacitor.isNativePlatform()
  ? 'https://crm.intralys.com/api'
  : '/api';
```

Aussi ajouter une variable `.env` fallback :
```
VITE_API_URL=https://crm.intralys.com
```

### A.3 — Safe area CSS (0.5j)

#### [MODIFY] `src/index.css`
Ajouter les safe-area insets pour l'encoche iPhone et la barre Android :
```css
:root {
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
}
```

#### [MODIFY] `src/components/layout/AppLayout.tsx`
Appliquer `padding-top: var(--safe-area-top)` sur le header.

#### [MODIFY] `src/components/layout/MobileBottomNav.tsx`
Appliquer `padding-bottom: var(--safe-area-bottom)` sur la bottom nav.

#### [MODIFY] `package.json`
Ajouter les scripts :
```json
"cap:sync": "bun run build && npx cap sync",
"cap:android": "npx cap open android",
"cap:ios": "npx cap open ios",
"cap:run:android": "npx cap run android",
"cap:run:ios": "npx cap run ios"
```

---

## Phase B — Plugins natifs (4j)

### B.1 — Push notifications Firebase (1.5j)

```bash
bun add @capacitor/push-notifications
```

#### [NEW] `migration-phase36.sql`
```sql
CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK(platform IN ('ios', 'android', 'web')),
  created_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
```

#### [NEW] `src/worker/push.ts`
- `POST /api/devices` → register token (auth required)
- `DELETE /api/devices/:token` → unregister
- `POST /api/notifications/push` → admin send manual
- Fonction interne `sendPushToUser(userId, title, body, data)` → appelle FCM REST API

#### [MODIFY] `src/worker.ts`
Ajouter routes `/api/devices` et `/api/notifications/push`.

#### [NEW] `src/lib/push.ts`
Client-side : init push, request permissions, register token via API.
```ts
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

export async function initPush() {
  if (!Capacitor.isNativePlatform()) return;
  
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  
  await PushNotifications.register();
  
  PushNotifications.addListener('registration', async (token) => {
    await fetch(`${API_BASE}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ token: token.value, platform: Capacitor.getPlatform() }),
    });
  });
  
  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // Afficher toast in-app si l'app est au foreground
  });
  
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    // Deep link vers la bonne page (lead detail, conversation, etc.)
  });
}
```

#### Wire push triggers dans les handlers existants :
- Nouveau lead créé → push à `lead.assigned_to`
- Message inbound (conversation) → push aux followers
- Task overdue → push à l'assignee
- Workflow notify step → push

### B.2 — Click-to-call (0.5j)

#### [NEW] `src/components/ui/PhoneLink.tsx`
```tsx
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

export function PhoneLink({ phone, children }: { phone: string; children?: React.ReactNode }) {
  const handleClick = async () => {
    if (Capacitor.isNativePlatform()) {
      await CapApp.openUrl({ url: `tel:${phone}` });
    } else {
      window.open(`tel:${phone}`, '_self');
    }
  };
  return <button onClick={handleClick}>{children || phone}</button>;
}
```

#### [MODIFY] `src/pages/LeadDetail.tsx`
Remplacer les `<a href="tel:...">` par `<PhoneLink>`.

### B.3 — Camera + Photos mode visite (1j)

```bash
bun add @capacitor/camera
```

#### [NEW] `src/lib/camera.ts`
Wrapper autour de `@capacitor/camera` pour prendre photo / choisir galerie.

#### [MODIFY] `src/pages/VisitMode.tsx` (mode "Agent en visite")
- Bouton "Prendre photo" → ouvre caméra native
- Upload vers R2 via `POST /api/files` existant
- Galerie photos inline par lead

### B.4 — Biometric auth (0.5j)

```bash
bun add capacitor-native-biometric
```

#### [NEW] `src/lib/biometric.ts`
- Vérifier disponibilité (`isAvailable`)
- Enregistrer credentials (token) dans le keychain natif
- Au login : si activé, FaceID/TouchID au lieu de mot de passe
- Fallback password si biometric échoue

#### [MODIFY] Settings > Security
Toggle "Connexion biométrique" visible uniquement si `Capacitor.isNativePlatform()`.

### B.5 — Local notifications (0.5j)

```bash
bun add @capacitor/local-notifications
```

#### [NEW] `src/lib/local-notifications.ts`
- Schedule notification locale quand task créée avec `reminder_minutes_before`
- Schedule rappel RDV (30 min avant par défaut)

---

## Phase C — Offline mode partiel (3j)

### C.1 — IndexedDB cache layer (1.5j)

```bash
bun add dexie
```

#### [NEW] `src/lib/offline/db.ts`
```ts
import Dexie from 'dexie';

class IntralysOfflineDB extends Dexie {
  leads: Dexie.Table;
  conversations: Dexie.Table;
  tasks: Dexie.Table;
  
  constructor() {
    super('intralys-offline');
    this.version(1).stores({
      leads: 'id, updated_at',
      conversations: 'id, updated_at',
      tasks: 'id, updated_at',
    });
  }
}

export const offlineDb = new IntralysOfflineDB();
```

#### [NEW] `src/lib/offline/sync.ts`
- Au boot app : pull dernières mises à jour depuis API → store dans IndexedDB
- Read-only en offline : les hooks useLeads/useConversations/useTasks
  lisent d'abord le cache, puis rafraîchissent en ligne
- Indicateur "Offline" dans AppLayout header si `!navigator.onLine`

### C.2 — Queue de mutations offline (1.5j)

#### [NEW] `src/lib/offline/queue.ts`
- Pendant offline, les POST/PUT/PATCH sont empilés dans `offline_mutations` table IndexedDB
- Au retour online : replay séquentiel vers API
- Badge UI "X actions en attente de sync" dans la bottom nav
- Résolution conflits : last-write-wins (MVP simple)

---

## Phase D — App store deployment (3j)

### D.1 — Build signed iOS (1.5j)
- Apple Developer account ($99/an — Rochdi paie)
- Provisioning profile + signing certificate Xcode
- Generate IPA
- Upload TestFlight
- Test avec 5 beta testeurs (les mêmes clients beta CRM)

### D.2 — Build signed Android (1j)
- Google Play Console account ($25 one-time — Rochdi paie)
- Generate signed AAB (`npx cap build android`)
- Upload sur Internal Testing track Google Play

### D.3 — Store listings (0.5j)
- **App Store** : 4 screenshots (iPhone 15 + iPad), description FR, keywords, privacy manifest (iOS 17+)
- **Google Play** : feature graphic 1024x500, screenshots, description, data safety form
- Versioning : `1.0.0`

---

## Phase E — Polish + tests (1.5j)

- Test sur 4 devices (iPhone 13, iPhone SE, Samsung S22, Pixel 7)
- Edge cases : rotation écran, deep links, push foreground vs background
- Splash screen : 1.5s puis hide
- Status bar : light content sur fond cyan
- Keyboard : resize body sans glitch

#### [NEW] `docs/MOBILE-RELEASE-PROCESS.md`
Check-list pour chaque release mobile future.

---

## Phase F — Update docs (0.5j)

- `ROADMAP.md` : Sprint 11 → ✅ Commité, total ~154j
- Move `ANTIGRAVITY-SPRINT11-PLAN.md` → `docs/archive/`
- Create `docs/MOBILE-RELEASE-PROCESS.md`

---

## Fichiers touchés — résumé

| Action | Fichier | Phase |
|---|---|---|
| NEW | `capacitor.config.ts` | A.1 |
| MODIFY | `package.json` (deps + scripts) | A.1 |
| MODIFY | `src/lib/api.ts` (API_BASE dynamique) | A.2 |
| MODIFY | `src/index.css` (safe-area) | A.3 |
| MODIFY | `src/components/layout/AppLayout.tsx` | A.3 |
| MODIFY | `src/components/layout/MobileBottomNav.tsx` | A.3 |
| NEW | `migration-phase36.sql` | B.1 |
| NEW | `src/worker/push.ts` | B.1 |
| NEW | `src/lib/push.ts` | B.1 |
| MODIFY | `src/worker.ts` (routes push) | B.1 |
| NEW | `src/components/ui/PhoneLink.tsx` | B.2 |
| MODIFY | `src/pages/LeadDetail.tsx` | B.2 |
| NEW | `src/lib/camera.ts` | B.3 |
| MODIFY | `src/pages/VisitMode.tsx` | B.3 |
| NEW | `src/lib/biometric.ts` | B.4 |
| NEW | `src/lib/local-notifications.ts` | B.5 |
| NEW | `src/lib/offline/db.ts` | C.1 |
| NEW | `src/lib/offline/sync.ts` | C.1 |
| NEW | `src/lib/offline/queue.ts` | C.2 |
| NEW | `docs/MOBILE-RELEASE-PROCESS.md` | E |

---

## Format commits

```
chore(capacitor): init iOS + Android project
feat(api): API_BASE dynamique natif/web
feat(safe-area): CSS insets encoche + bottom nav
feat(push): Firebase FCM + device tokens + triggers
feat(click-to-call): PhoneLink natif tel:
feat(camera): photo capture mode visite
feat(biometric): FaceID/TouchID login
feat(local-notif): task + appointment reminders
feat(offline): IndexedDB cache Dexie + mutation queue
chore(ios): build signed IPA + TestFlight
chore(android): build signed AAB + internal testing
docs(mobile-release): process + store listings
```

---

## Tests de validation finale

- [ ] App s'installe sur iPhone via TestFlight
- [ ] App s'installe sur Android via Internal Testing
- [ ] Push notif reçue quand nouveau lead créé
- [ ] Tap "Appeler" sur lead phone → app téléphone natif
- [ ] Mode visite : prendre photo → upload R2 OK
- [ ] Toggle biometric → re-login avec FaceID
- [ ] Offline 5 min → lire leads cached + créer task → reconnect → sync
- [ ] Splash screen 1.5s puis app charge
- [ ] Status bar cyan, contenu blanc
- [ ] Safe area OK sur iPhone 15 (encoche dynamique)
- [ ] bun run build vert
- [ ] npx vitest run → 110+ tests pass
