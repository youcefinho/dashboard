# Screen Reader Test Scripts — Sprint 48 M1.4

Date : 2026-05-15
Scope : 10 scénarios pas-à-pas de validation manuelle SR (NVDA / JAWS / VoiceOver).

## Tools

| Tool | Plateforme | Coût | Recommandation |
|---|---|---|---|
| **NVDA** | Windows | Gratuit (donation) | Premier choix Windows |
| **JAWS** | Windows | Payant (~1200$/an) | Référence enterprise |
| **VoiceOver** | macOS / iOS | Gratuit (intégré) | Premier choix Apple |
| **TalkBack** | Android | Gratuit (intégré) | Mobile Android |
| **Narrator** | Windows | Gratuit (intégré) | Fallback Windows |

### Commandes essentielles

**NVDA (Windows)** :
- Démarrer : `Ctrl + Alt + N`
- Toggle speech : `Insert + S`
- Read all : `Insert + Down arrow`
- Next heading : `H`
- Next button : `B`
- Next link : `K`
- Next form field : `F`
- Bypass nav (focus mode) : `Insert + Space`

**VoiceOver (macOS)** :
- Démarrer : `Cmd + F5`
- Read all : `VO + A` (VO = Control + Option)
- Navigate : `VO + Right/Left arrows`
- Click : `VO + Space`
- Rotor : `VO + U`

**VoiceOver (iOS)** :
- Démarrer : Settings → Accessibility → VoiceOver (ou triple-click Side button si raccourci configuré)
- Swipe right/left : next/previous element
- Double-tap : activate
- Two-finger swipe down : read from current position

---

## Scénario 1 : Login → Dashboard → KPI announcements

**Préconditions** : SR actif, /login chargé.

**Steps** :
1. Tab depuis URL bar → arrive sur "Aller au contenu principal" (skip-link)
   - **Expected SR** : "Aller au contenu principal, lien"
2. Tab → champ email
   - **Expected SR** : "Adresse email, champ obligatoire, édition"
3. Taper email
4. Tab → champ password
5. Taper password
6. Tab → "Se connecter" button + Enter
   - **Expected SR** : "Se connecter, bouton"
7. Page Dashboard charge → focus auto sur main-content
   - **Expected SR** : "Tableau de bord, titre niveau 1" (h1 hero)
8. Tab → premier KPI card
   - **Expected SR** : Titre KPI + valeur + delta (ex. "Nouveaux leads, 24, +12 % cette semaine")

**Pass criteria** :
- ✅ Skip-link annoncé en premier Tab
- ✅ h1 page annoncé au load
- ✅ KPI cards annoncent titre + valeur + delta (pas juste le nombre)
- ✅ Aucun "bouton sans nom" / "lien sans destination"

---

## Scénario 2 : Create Lead via CmdPalette → form labels + errors

**Préconditions** : Dashboard chargé, SR actif.

**Steps** :
1. `Cmd+K` (ou `Ctrl+K`) → CmdPalette ouvre
   - **Expected SR** : "Palette de commandes, dialogue, modal. Tapez pour rechercher ou exécuter une commande. Utilisez les flèches haut et bas pour naviguer, Entrée pour valider, Échap pour fermer."
2. Taper "nouveau lead Jean Dupont"
   - **Expected SR** : Comme l'utilisateur tape, l'input combobox annonce les résultats. Avec Arrow Down, on entend `role="option"` items annoncés via `aria-activedescendant`
3. Arrow Down → "Action détectée : Créer le lead Jean Dupont"
   - **Expected SR** : "Créer le lead Jean Dupont, sélectionné, option 1 sur N"
4. Enter → modal CreateLead ouvre
   - **Expected SR** : "Nouveau lead, dialogue"
5. Tab dans le form
   - **Expected SR** : Chaque champ → "Label, champ texte, obligatoire" si requis
6. Submit sans email → erreur affichée
   - **Expected SR** (assertive) : Erreur annoncée immédiatement (live region assertive) "Erreur : Email obligatoire"

**Pass criteria** :
- ✅ CmdPalette dialog + description SR annoncés à l'ouverture
- ✅ Combobox pattern : aria-activedescendant pointe sur option courante
- ✅ Form labels présents partout (htmlFor / aria-labelledby)
- ✅ Erreurs validation annoncées via live region assertive
- ✅ Succès → toast announce polite

---

## Scénario 3 : Pipeline drag-drop (keyboard mode + SR feedback)

**Préconditions** : Pipeline page chargée avec 3+ stages et 5+ leads, SR actif.

**Steps** :
1. Tab navigate jusqu'au premier lead card
   - **Expected SR** : "Lead Jean Dupont, score 78, stage Nouveau"
2. `Space` (active drag keyboard mode Sprint 31)
   - **Expected SR** : "Drag activé : utilisez les flèches pour déplacer Jean Dupont"
3. Arrow Right → déplace vers stage Contacted
   - **Expected SR** : "Déplacé vers stage Contacted, position 1"
4. `Space` confirme
   - **Expected SR** (polite) : "Jean Dupont déplacé vers Contacted"
   - announceSR polite via lib/announce
5. Escape annule le drag
   - **Expected SR** : "Drag annulé"

**Pass criteria** :
- ✅ Keyboard mode reachable via Space
- ✅ Feedback positional ("position N sur M")
- ✅ Confirmation polite via announceSR
- ✅ Escape annule + restaure position

---

## Scénario 4 : Inbox send message + reactions + SR confirmation

**Préconditions** : Inbox chargé avec 1+ conversation, SR actif.

**Steps** :
1. Tab → conversation list (role="listbox")
2. Arrow Down → sélectionne conversation
   - **Expected SR** : "Marie Tremblay, dernier message il y a 2 minutes, 1 non lu"
3. Enter → ouvre thread
   - **Expected SR** : "Conversation avec Marie Tremblay"
4. Tab → composer textarea
   - **Expected SR** : "Tapez votre message, zone de texte"
5. Taper "Bonjour" + Tab vers Send button + Enter
   - **Expected SR** (polite) : "Message envoyé"
6. Hover/Focus sur message → reactions emoji bar reveal
7. Tab vers emoji 👍 + Enter
   - **Expected SR** : "Réaction pouce ajoutée"

**Pass criteria** :
- ✅ Conversation list role="listbox" + options annoncées avec metadata
- ✅ Composer label clair
- ✅ Send confirmation polite (lib/announce)
- ✅ Reactions reachable Tab + Enter (pas hover-only)

---

## Scénario 5 : Calendar create event Wizard 3 steps + step announcements

**Préconditions** : Calendar page chargée, SR actif.

**Steps** :
1. Tab → "+ Nouvel événement" button + Enter
   - **Expected SR** : "Nouvel événement, dialogue"
2. Wizard step 1 chargé
   - **Expected SR** : "Étape 1 sur 3 : Détails, étape actuelle"
3. Tab dans le form, remplir titre + date
4. Tab → "Suivant" + Enter
   - **Expected SR** : "Étape 2 sur 3 : Invités, étape actuelle"
5. Tab dans le combobox invités → tape "Jean"
   - **Expected SR** : Combobox annonce options filtered via aria-activedescendant
6. Enter sélection → ajouté
7. "Suivant" → step 3 récap
   - **Expected SR** : "Étape 3 sur 3 : Confirmation, étape actuelle"
8. "Terminer" + Enter
   - **Expected SR** (polite) : "Événement créé"
9. Modal ferme, focus retour sur trigger
   - **Expected SR** : "Nouvel événement, bouton" (focus restauré)

**Pass criteria** :
- ✅ Wizard steps annoncent "Étape N sur M"
- ✅ aria-current="step" sur chip actif
- ✅ Combobox invités pattern complet
- ✅ Focus restored au trigger après close

---

## Scénario 6 : Notifications panel real-time announcements

**Préconditions** : Dashboard chargé, WebSocket connecté, SR actif.

**Steps** :
1. Bouton notif Bell dans header → focus + Enter
   - **Expected SR** : "Notifications, 3 non lues, bouton" puis "Panneau Notifications, dialogue"
2. Tab dans le filter tablist
   - **Expected SR** : "Toutes, onglet, sélectionné, 1 sur 3" → "Non lues, onglet, 2 sur 3"
3. Arrow Right → "Non lues" actif
4. Tab → liste notifs (role="list")
5. Trigger notification realtime (côté backend)
   - **Expected SR** (polite via useNotificationsWs) : "Nouvelle notification : titre"

**Pass criteria** :
- ✅ Bell button annonce count non-lues dans aria-label
- ✅ Filters tablist navigation arrow keys
- ✅ Realtime announce via announceSR polite
- ✅ Toast inline n'interromp pas (polite)

---

## Scénario 7 : Reports builder drag widget + keyboard mode

**Préconditions** : /reports/builder chargé, SR actif.

**Steps** :
1. Tab vers widget palette (gauche)
   - **Expected SR** : "Widgets disponibles, liste"
2. Arrow Down → "KPI Card"
   - **Expected SR** : "KPI Card, élément glissable"
3. Space → keyboard drag mode
   - **Expected SR** : "Drag activé : flèches pour positionner sur la grille"
4. Arrow Right + Right → déplace dans la zone
   - **Expected SR** : "Position 2, 1 sur grille 4 par 6"
5. Space → confirme
   - **Expected SR** (polite) : "KPI Card ajouté à la position 2, 1"

**Pass criteria** :
- ⚠️ TODO sprint suivant : Reports builder keyboard mode (drag widgets) actuellement HTML5 drag-and-drop only — peu accessible SR.
  → Recommandation : implementer pattern similaire Pipeline Sprint 31.
- ✅ Widget palette reste reachable Tab + annoncée

---

## Scénario 8 : Settings 2FA setup flow + form errors

**Préconditions** : /settings/security chargé, SR actif.

**Steps** :
1. Tab vers "Activer 2FA" button + Enter
   - **Expected SR** : "Configurer l'authentification à deux facteurs, dialogue"
2. Wizard step 1 : QR code
   - **Expected SR** : "Étape 1 sur 3 : Scanner le QR code, étape actuelle"
   - QR code : `<img alt="QR code de configuration TOTP. Code secret : ABC-DEF-GHI.">`
3. Tab vers "Suivant"
4. Step 2 : input 6 chiffres
   - **Expected SR** : "Code de vérification, 6 chiffres, champ texte"
5. Taper code invalide → submit
   - **Expected SR** (assertive) : "Erreur : Code incorrect, vérifie ton authentificateur"
6. Taper code valide → step 3 backup codes
   - **Expected SR** : "Étape 3 sur 3 : Codes de sauvegarde"
7. "Terminer"
   - **Expected SR** (polite) : "Authentification à deux facteurs activée"

**Pass criteria** :
- ✅ QR code a alt-text avec secret texte (fallback)
- ✅ Errors validation announcées assertive
- ✅ Backup codes affichés avec instruction "Notez-les"

---

## Scénario 9 : Pull-to-refresh action announcement (mobile)

**Préconditions** : Page Leads sur mobile (iOS Safari + VoiceOver), 5+ leads.

**Steps** :
1. VoiceOver actif, swipe pour focus header page
2. Pull down geste manuel (ou keyboard `Ctrl+R` desktop)
3. Pull threshold atteint → PullToRefreshIndicator visible
   - **Expected SR** : "Rafraîchissement..." (polite, single annonce)
4. Refresh complete
   - **Expected SR** (polite) : "Liste rafraîchie, 12 leads"

**Pass criteria** :
- ✅ PtR indicator a `role="status"` + aria-live="polite"
- ✅ Annonce "rafraîchissement..." pendant fetch
- ✅ Annonce résultat avec count après fetch

---

## Scénario 10 : Offline → online transition + announcements

**Préconditions** : App chargée, SR actif, DevTools → Network → Offline.

**Steps** :
1. Toggle offline DevTools
2. NetworkStatusBanner apparaît
   - **Expected SR** (assertive) : "Connexion perdue, mode hors ligne activé"
3. Tenter action mutation (ex: créer lead)
   - **Expected SR** (polite) : "Lead créé localement, sera synchronisé au retour en ligne"
4. Toggle offline OFF DevTools
   - **Expected SR** (polite) : "Connexion restaurée, synchronisation..."
5. Sync complete
   - **Expected SR** (polite) : "Synchronisation terminée, 1 modification envoyée"

**Pass criteria** :
- ✅ NetworkStatusBanner : aria-live assertive sur perte, polite sur retour
- ✅ Outbox creations announced polite
- ✅ Sync completion announced

---

## Wiring `announceSR` — checklist features Sprint 44-47

Sprint 48 M1.4 demande : wirer `announceSR` polite/assertive partout dans
features Sprint 44-47. État audit :

| Feature | Sprint | Wiring announceSR | Status |
|---|---|---|---|
| Push notifications received | 44 M1.3 | Via toast inline + useNotificationsWs | ✅ OK |
| Deep link consumed | 44 M1.4 | Via navigate route change (auto via h1) | ✅ OK |
| PWA install prompt accept | 44 M2.1 | Toast confirm | ✅ OK |
| SW update available | 44 M2.4 | Toast persistant | ✅ OK |
| Outbox auto-flush | 44 M2.3 | Via NetworkStatusBanner | ✅ OK |
| ContextualActionsSheet open | 44 M3.2 | Role="menu" Radix auto | ✅ OK |
| Edge swipe back consume | 44 M3.4 | Via SlidePanel close (Modal close announce) | ✅ OK |
| Onboarding wizard step | 45 M1.1 | Wizard pattern aria-current="step" | ✅ OK |
| First lead tour step | 45 M1.3 | Coachmark dialog | ✅ OK |
| Discover app tour 8 steps | 45 M3.4 | Coachmark dialog | ✅ OK |
| EmptyState empty action | 45 M2 | Static h2 + p (lu nav) | ✅ OK |
| Reports builder add widget | 46 M1 | ⚠️ TODO drag keyboard mode | ❌ MANQUE |
| Admin overview load | 46 M2.1 | h1 nav announce | ✅ OK |
| NotificationsPanel realtime | 46 M3 | useNotificationsWs announce polite | ✅ OK |
| Landing CTA submit | 47 M1 | Toast confirm | ✅ OK |
| Legal page anchor scroll | 47 M2 | h2 nav announce | ✅ OK |

### Gap : Reports builder keyboard drag

**Fix recommandé sprint suivant** : Implémenter keyboard drag mode similaire
Pipeline Sprint 31 :
- Space active drag mode sur widget
- Arrow keys déplacent dans grille
- Space confirme + announceSR polite
- Escape annule + restore position

## Conclusion

Les 10 scénarios SR ci-dessus constituent la **suite de validation manuelle
minimale** pour valider l'a11y AAA Intralys. À exécuter avant chaque release
beta puis avant prod release sur les 3 SR principaux (NVDA + JAWS + VoiceOver).

Issue tracker SR : créer ticket dédié pour chaque scénario échec avec :
- Tool/version SR utilisé
- Browser + OS
- Steps to reproduce
- Expected vs Actual SR output
