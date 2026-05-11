# ANTIGRAVITY-SPRINT-COMBO-PLAN.md — Sprint Design 2 + Sprint 3 Vertical Conversations

> Rédigé le 2026-05-11 par Antigravity après lecture intégrale de :
> - `ANTIGRAVITY-DESIGN-SPRINT.md` §4+§5
> - `ANTIGRAVITY-DEPTH-AUDIT.md` §3-§10
> - `ANTIGRAVITY-PHASE3-CATCHUP.md` §3.3
> - `ANTIGRAVITY-GHL-COMPLETENESS.md` §2 M2
> - `design-mockup.html` (référence pixel)
> - `git log --oneline -15`

---

## A. Validation pré-sprint

- ✅ Sprint Design 1 fini (Dashboard + Leads + LeadDetail refondus, Sidebar + Header)
- ✅ Build vert (`bun run build` → `✓ built in 758ms`)
- ✅ Mockup HTML ouvert et compris (hero blobs, stat cards sparklines, sub-accounts, activity feed Live)
- ✅ Working tree propre (git status clean, dernier commit `00f4117` pushé sur master)

---

## B. Plan détaillé Sprint Design 2 (~6j)

### D2.1 — Pipeline refonte (1j)

> Sources : DEPTH-AUDIT §3 (25+ items) + DESIGN-SPRINT §5.4

**Fichier :** `src/pages/Pipeline.tsx` (221 lignes actuellement)

#### Layout refait
- Header avec **pipeline selector dropdown** (multi-pipelines P1.8)
- **KPIs sticky top** : valeur totale, count, weighted forecast, dormants 7j+
- **Filter chips removables** : owner, source, tag, date range, deal value range

#### Colonnes Kanban refondues
- Column header avec **couleur stage subtle** (`bg-subtle` teinté `--stage-{x}`)
- Column KPI : count + sum value par stage

#### Cards opportunity refaites
- Avatar contact gradient + **nom contact** (link)
- **Adresse + ville** (si renseigné)
- **Owner avatar** mini (coin haut-droit)
- **Days-in-stage** badge (color-coded : vert <7j, orange 7-14j, rouge >14j)
- **Deal value** prominent (right-aligned)
- **Priority indicator** (high/med/low dot)
- Tags chips (max 2 visible + "+N")
- **3-dots menu** : edit, delete, move stage, mark won/lost

#### Vue switcher segmented
- **Kanban** (défaut) / **List** (table) / **Forecast** (revenue prévisionnel)

#### Lost reason modal
- Dropdown raisons : "Prix trop élevé", "Concurrent choisi", "Mauvais timing", "Pas de réponse", "Autre"
- Champ texte libre pour détails
- Analytics : top raisons par mois (reporté dans Reports)

#### Drag&drop amélioré
- Drop indicator clear (ligne cyan + glow)
- Smooth animation 200ms ease-spring
- Ghost card à 0.5 opacity

---

### D2.2 — Inbox refonte (1j)

> Sources : DEPTH-AUDIT §4 (35+ items) + DESIGN-SPRINT §5.5

**Fichier :** `src/pages/Inbox.tsx` → refonte en `src/pages/Conversations.tsx`

#### Layout 3 panneaux
```
┌──────────────────┬────────────────────────┬──────────────────┐
│ Thread list      │ Messages thread        │ Contact info     │
│ 320px fixed      │ flex-1                 │ 320px collapsible│
│                  │                        │                  │
│ [Search]         │ [Message bubbles]      │ [Contact card]   │
│ [Quick filters]  │                        │ [Deals mini]     │
│ [Thread items]   │ [Composer footer]      │ [Tasks mini]     │
└──────────────────┴────────────────────────┴──────────────────┘
```

#### Thread list (panneau gauche)
- Thread item : avatar gradient + contact name + last message preview (1 ligne truncate) + timestamp relative + unread dot blue + channel icon (📧/💬/📱)
- **Quick filters bar** : Mes assignations / Non lus / Mentionnés / Starred (toggle buttons)
- **Filtres avancés** collapse : status (Open/Closed/Snoozed/Spam), assigned, tag, date, sentiment (placeholder AI)
- Search threads
- Badge count unread en haut

#### Messages thread (panneau centre)
- **Message bubbles** : outbound → right, `bg-brand-tint`, border-radius TL/BL/BR. Inbound → left, `bg-subtle`, border-radius TR/BR/BL
- **Internal notes** : fond `--warning-soft` (post-it jaune), icône 📝
- Timestamp + channel icon par message
- Avatar expéditeur dans le bubble

#### Composer footer
- **Tab selector** : Email / SMS / Note (segmented control)
- Textarea auto-resize
- Actions : Template dropdown, Snippet slash `/`, Schedule send, Attachment
- Send button gradient brand
- Character count pour SMS (160/1000)

#### Right panel (contact info, collapsible)
- **Contact summary card** : avatar, name, email, phone, lifecycle stage
- **Last 5 deals** mini-table (stage + value)
- **Tasks** mini-list (due today highlighted)
- **Followers** : avatars row + add button
- **Tags** : chips + add
- Toggle collapse avec chevron

---

### D2.3 — Calendar refonte (1j)

> Sources : DEPTH-AUDIT §5 (25+ items) + DESIGN-SPRINT §5.6

**Fichier :** `src/pages/Calendar.tsx` (325 lignes)

#### View switcher segmented
- **Day** / **Week** (défaut) / **Month** / **Agenda**

#### Vue Month (NEW)
- Grid 7×5 avec jours
- Events truncated (max 3 visible + "+N more")
- Click jour → switch vue Day

#### Vue Day (NEW)
- Timeline horaire 7h-22h (slots 30min)
- Events positionnés selon start/end time
- Width proportionnelle à la durée

#### Améliorations partagées
- **Color-coded events** selon type : `--stage-new` (meeting achat), `--stage-signed` (signature), `--warning` (suivi), `--info` (prospection)
- **Drag-to-reschedule** : drag un event vers un autre créneau
- **Mini calendar nav** sidebar gauche (petit datepicker mensuel)
- **"Aujourd'hui" button** + chevrons prev/next
- **Filter bar** : owner, type, status, calendar

#### Modal RDV enrichi
- Select **calendar** (dropdown si multi-calendars)
- Select **assignee** (dropdown users)
- **Contact autocomplete** (search dans leads)
- **Recurring** toggle : quotidien / hebdomadaire / mensuel
- **Reminders** : checkboxes (email 24h, SMS 1h)
- **Buffer time** : slider 0-30 min avant/après
- **Conference link** : champ URL
- **Send invite** : checkbox + email preview

---

### D2.4 — Workflows builder refonte (1j)

> Sources : DEPTH-AUDIT §6 (60+ items) + DESIGN-SPRINT §5.7
> **NOTE :** Vrai canvas 2D React Flow = P3.7 futur. Sprint Design 2 = layout horizontal cleaner + préparation visuelle.

**Fichiers :** `src/pages/Workflows.tsx` + `WorkflowDetail.tsx` + `WorkflowBuilder.tsx`

#### Liste workflows refonte
- **Folders / categories** : sidebar gauche avec dossiers (Onboarding, Sales, Reactivation, Custom)
- **Search** + **filter trigger type** dropdown
- **Sort** : last edited / most enrollments / alphabetical
- **Duplicate action** : bouton dans chaque row
- Status badge : Active (vert) / Draft (gris) / Paused (orange)

#### Builder layout horizontal (préparation canvas)
- **Steps en cards horizontales** connectées par **lignes courbes SVG** (pas vertical)
- Layout gauche → droite avec scroll horizontal
- Connection lines : `stroke: var(--border-default)`, `stroke-width: 2`, courbes cubiques
- Step cards : 200px width, icon + label + config preview + drag handle
- Step sélectionné : border `--brand-primary` + shadow

#### Toolbox latérale gauche (NEW)
- Palette de steps disponibles groupées : Communication (send_email, send_sms), Logic (wait, condition), Actions (add_tag, change_status, assign, notify, webhook)
- Drag&drop depuis palette vers le flow

#### Properties panel droite (NEW)
- Apparaît quand un step est sélectionné
- Form d'édition spécifique au type de step
- Width 320px, slide-in animation

#### Top bar builder
- Workflow name (inline editable)
- Save button
- Test run button (placeholder)
- Publish toggle (on/off)
- Version history dropdown (placeholder)

---

### D2.5 — Templates refonte (0.5j)

> Sources : DEPTH-AUDIT §7 (20+ items) + DESIGN-SPRINT §5.5

**Fichier :** `src/pages/Templates.tsx` (340 lignes)

#### Onglets séparés
- **Tab Email** / **Tab SMS** (segmented control en haut)

#### Liste templates
- Folders / categories sidebar
- Search + filter
- Duplicate action par template
- Preview hover (popup)

#### Editor Email (split view)
- **Left** : code HTML textarea (avec syntax highlighting basique via monospace font)
- **Right** : live preview split desktop/mobile toggle
- **Variables** auto-suggest : quand l'utilisateur tape `{{`, dropdown avec `lead.name`, `lead.email`, `client.name`, etc.
- **Send test email** button (envoie à l'adresse de l'admin connecté)

#### Editor SMS
- Textarea avec **character count** (160 standard / 1000 MMS)
- Variables `{{}}` auto-suggest identique
- Indicateur segments SMS (1 msg = 160 chars)

---

### D2.6 — Tasks refonte (0.5j)

> Sources : DEPTH-AUDIT §8 (15+ items)

**Fichier :** `src/pages/Tasks.tsx` (294 lignes)

#### Filtres enrichis
- **Filter by assigned_to** : dropdown users
- **Filter by due date** : presets (Overdue / Today / This week / No due)
- **Filter by lead** : autocomplete search
- **Filter by tag** : multi-select

#### Vues enrichies
- Existant : List / Kanban
- NEW : **My Tasks** (filtre auto user connecté)
- NEW : **Overdue** (filtre auto overdue)
- NEW : **Today** (filtre auto due today)

#### Edit task enrichi
- **Subtasks / checklist** : steps cochables dans une task (array de strings + checked boolean)
- **Comments** : mini-feed de commentaires par task
- **Recurring** : toggle (daily/weekly/monthly)
- **Reminders** : dropdown (email 1h avant, 24h avant)

#### Bulk actions
- Bulk reassign (dropdown user)
- Bulk change due date (datepicker)
- Bulk mark done (bouton)

---

### D2.7 — Settings refonte (1j)

> Sources : DEPTH-AUDIT §9 (30+ sous-pages) + DESIGN-SPRINT §5.8

**Fichier :** `src/pages/Settings.tsx` (264 lignes)

#### Sub-navigation gauche 220px
- Utilise le composant `SubNav.tsx` (créé en Sprint Design 1)
- Sections groupées avec labels uppercase :

```
ACCOUNT
├─ Mon profil
├─ Équipe
├─ Sécurité (2FA, sessions)

CONFIGURATION
├─ Custom Fields
├─ Tags
├─ Pipelines
├─ Formulaires

COMMUNICATION
├─ Email (expéditeur, signatures)
├─ SMS / Téléphone
├─ Calendriers

DONNÉES
├─ Notifications
├─ Conformité (CASL, Loi 25)
├─ Import / Export
├─ Audit log

AVANCÉ
├─ Intégrations
├─ Développeur (API)
├─ White-label
├─ Facturation
```

#### Pattern par section
- Carte large `rounded-xl` avec form inputs alignés
- Labels left (200px) + inputs right (flex-1)
- **Save bar sticky bottom** : apparaît si formulaire dirty (isModified), disparaît après save
- Animation slide-up pour save bar

#### Sections prioritaires à implémenter
- **Mon profil** : name, email, avatar placeholder, timezone, signature email
- **Équipe** : table users + invite button (modal)
- **Custom Fields** : liste avec drag&drop reorder (existant P3.4)
- **Tags** : CRUD avec couleurs
- **Pipelines** : CRUD pipelines + stages (C25)
- **Email** : from email config + signature HTML editor
- **Notifications** : toggles par type d'event
- **Conformité** : CASL toggle + Loi 25 settings

---

### D2.8 — Reports refonte (1j)

> Sources : DEPTH-AUDIT §10 (20+ items)

**Fichier :** `src/pages/Reports.tsx` (347 lignes)

#### Onglets élargis
Existant : Funnel / Sources / Performance / Trends
NEW :
- **Sales** : revenue, deals won/lost, avg deal size, pipeline value
- **Agent** : leaderboard, deals/agent, response time
- **Activity** : calls, SMS, emails par période (chart stacked)
- **Workflow** : enrollments, completions, conversion par workflow
- **Email** : sent, opened, clicked, bounced
- **SMS** : sent, delivered, replied, opt-outs

#### Filtres globaux reports
- **Filter by user/agent** dropdown
- **Filter by sub-account** (admin agency)
- **Date range custom** : datepicker from/to + presets (7j, 30j, 90j, YTD)
- **Filter by source** + **by tag**

#### Export + scheduling
- **Export PDF** button (placeholder — lien vers future feature C29)
- **Schedule weekly digest** button (placeholder — C30)
- **Compare two periods** : toggle "vs période précédente" → affiche deltas %

---

## CHECKPOINT — Validation Rochdi avant Sprint 3

> [!IMPORTANT]
> À la fin de Sprint Design 2, **STOP complet**. Push tous les commits design. Attends validation Rochdi.

**Critères de validation :**
1. Les 7 pages refondues (Pipeline, Inbox, Calendar, Workflows, Templates, Tasks, Settings, Reports) ont l'identité Intralys cyan/orange/multi-couleurs
2. Tous les composants UI cohérents avec la maquette `design-mockup.html`
3. Mobile responsive basique sur les 7 pages
4. `bun run build` passe avec 0 erreurs
5. Navigation fluide entre toutes les pages

**Si Rochdi rejette une page → fix d'abord, ne commence PAS Sprint 3.**

---

## C. Plan détaillé Sprint 3 — Vertical Conversations (~14j)

### 3.1 — P4.2 Webchat widget live bidirectionnel (3j)

#### Backend
- Migration phase15 : `webchat_widgets (id, client_id, primary_color, welcome_message, business_hours JSON, offline_form_enabled)`
- Migration phase15 : `webchat_sessions (id, widget_id, lead_id, visitor_id, started_at, ended_at)`
- Cloudflare Durable Objects namespace `WEBCHAT_ROOMS` (1 DO par session active)
- `wrangler.jsonc` : ajouter `durable_objects.bindings = [{name: "WEBCHAT_ROOMS", class_name: "WebchatRoom"}]`

#### Endpoints
- `POST /widget/init` → créer session + retourner session_id
- WebSocket `/widget/ws/:session_id` → bidirectionnel via Durable Object
- `POST /widget/message` (fallback REST si WS indisponible)
- Persistence dans `messages` table avec `channel='webchat'`

#### Widget JS embeddable
- Snippet : `<script src="https://crm.intralys.com/widget/v1.js?client=X"></script>`
- Shadow DOM ou iframe isolé (pas de collision CSS)
- Pré-chat form : capture name + email avant ouverture chat
- UI : bulle flottante bottom-right, couleur `primary_color` du client

#### Côté courtier
- Nouveau message webchat = notification temps réel dans l'inbox (D2.2)
- Badge "Live" sur le thread
- Cleanup automatique DO après 24h sans message (Durable Object alarm API)

---

### 3.2 — P4.9 FB Messenger + IG DM (3j)

#### Meta Graph API OAuth
- Page Settings → Integrations → **"Connecter Facebook/Instagram"** button
- OAuth flow : redirect vers `facebook.com/dialog/oauth` → callback → store tokens
- Migration phase16 : `meta_connections (client_id, page_id, access_token_encrypted, ig_business_id, connected_at)`
- Encrypt `access_token` avec AES-GCM (réutilise pattern crypto `src/worker/crypto.ts`)

#### Webhook entrant
- `POST /api/webhook/meta` avec validation `X-Hub-Signature-256` (HMAC SHA-256)
- Secret `META_APP_SECRET` via `wrangler secret put`
- Mapping FB user PSID → lead par lookup `external_id` ou création auto

#### Outbound
- `POST graph.facebook.com/v18.0/me/messages` avec `page_access_token`
- Stocké comme `channel='facebook'` ou `'instagram'` dans `messages`

#### UI Inbox
- Channel icon Meta (FB bleu / IG gradient) dans thread list
- Composer : tab Messenger disponible si meta_connection active
- Attachments reçus (images) : affichage inline dans les bubbles

---

### 3.3 — Migration M2 conversations historiques GHL (2j)

#### Endpoint migration
- `POST /api/migrate/ghl/conversations` avec body `{pit_token, location_id}`
- Cloudflare Queue job `migrate-conversations` (pas dans fetch handler)

#### Logique
- Paginate `GET /conversations/search?locationId=X&limit=50`
- Pour chaque conversation : `GET /conversations/:id/messages?limit=100`
- Mapping GHL → notre format :
  - `lastMessageType` (TYPE_EMAIL/TYPE_SMS/TYPE_WEBCHAT/TYPE_FACEBOOK) → `channel`
  - `direction` (inbound/outbound) préservé
  - `body`, `subject`, `created_at` préservés
  - `external_id = ghl_message_id`
  - `migrated_from = 'ghl'` flag

#### Idempotence
- `INSERT OR IGNORE` sur `(client_id, external_id)` — pas de doublons si relancé
- Limite 1000 messages max par batch (paginate via cursor GHL)

#### Test E2E
- Importer conversation test Rochdi chez Mathis (1 thread minimum)
- Vérifier qu'elle apparaît dans inbox refondu D2.2 avec tous les messages

---

### 3.4 — Enrichissement Inbox features (DEPTH-AUDIT §4) (4j)

> La refonte design est faite en D2.2. Ici = les FEATURES backend + logique.

#### 3.4.a — Composer "New conversation" (0.5j)
- Tab "+" dans header inbox
- Autocomplete contact (search leads)
- Channel selector (Email/SMS)
- Envoie via endpoints existants + crée thread

#### 3.4.b — Saved replies / Snippets (1j)
- Table `snippets (id, user_id, shortcut, body, created_at)`
- CRUD snippets dans Settings → Communication
- Slash command `/` dans textarea composer → dropdown filtré par shortcut
- Insertion du body dans le textarea

#### 3.4.c — Email signatures par user (0.5j)
- Champ `signature_html` dans `users` table (migration)
- Settings → Mon profil → éditeur signature HTML
- Auto-injection dans tous les emails sortants (`send_email` step + composer)

#### 3.4.d — Schedule send (1j)
- Modal "Envoyer plus tard" : presets (dans 1h, demain 9h, lundi 9h, custom datetime)
- Table `scheduled_messages (id, message_data JSON, send_at, status, created_at)`
- Cron worker check toutes les minutes → envoie si `send_at <= now()`

#### 3.4.e — Bulk actions threads (0.5j)
- Multi-select threads (checkboxes)
- Actions : assign to, archive, mark spam, add tag, mark read/unread

#### 3.4.f — Snooze conversations (0.5j)
- Modal snooze : "Demain 9h" / "Lundi prochain" / "+7j" / Custom
- Champ `snoozed_until` dans conversations
- Thread disparaît de la vue → réapparaît quand `snoozed_until <= now()`

---

### 3.5 — Quick wins infra liés conversations (1j)

#### Q.2 Followers + mentions (0.5j)
- Table `conversation_followers (conversation_id, user_id, created_at)`
- UI add/remove followers dans right panel inbox
- Mention `@user` dans notes internes → notification au mentionné

#### DND audit (0.5j)
- Audit que TOUS les endpoints `send_email`, `send_sms` dans le worker vérifient le DND du lead
- Ajouter le check dans le workflow engine `executeStep()` si manquant

---

### 3.6 — Tests E2E Sprint 3 (1j)

1. ✅ Importer conversation GHL Mathis (Rochdi test) → voir le thread dans inbox + tous les messages historiques
2. ✅ Répondre via composer email → arrive en réel chez Rochdi (Resend)
3. ✅ Snippet `/welcome` s'expand en template dans le composer
4. ✅ Schedule un message pour +1h → vérifier qu'il part bien (cron)
5. ✅ Connecter Meta page test → recevoir un message Messenger → apparaît dans inbox
6. ✅ Embed widget JS sur localhost test → visiteur ouvre chat → message apparaît côté courtier
7. ✅ Snooze une conversation → disparaît jusqu'à l'heure → reapparaît
8. ✅ Toggle DND email sur un lead → le workflow ne lui envoie plus rien
9. ✅ Followers : ajouter un follower → il reçoit une notification quand nouveau message arrive

---

## D. Risques techniques combinés

| # | Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Durable Objects = nouveau** pour Antigravity. Configuration et tests locaux peuvent être complexes | Moyenne | Haut | Commencer par un PoC echo server avant le webchat complet. Tester avec `wrangler dev --persist` |
| R2 | **Meta Graph API** webhook validation HMAC SHA-256 facile à se tromper | Haute | Moyen | Tester avec ngrok local + Meta webhook tester tool. Validation stricte avec replay protection |
| R3 | **Migration conversations** = potentiellement beaucoup de data (1000+ messages par thread chez clients actifs) | Moyenne | Moyen | Limit 1000 messages/batch, paginate via cursor, Cloudflare Queue avec retry |
| R4 | **Sprint Design 2 + Sprint 3 dans le même prompt** = ~20j sans validation intermédiaire = risque dérive | Haute | Haut | **CHECKPOINT OBLIGATOIRE** entre les 2 sprints. Rochdi valide D2 avant tout Sprint 3 |
| R5 | **Scheduled messages cron** : le cron worker doit être suffisamment fréquent (1 min) pour ne pas rater les envois | Basse | Moyen | Réutiliser le cron existant du workflow engine. Ajouter un check `scheduled_messages` dans la boucle |

---

## E. Estimation

| Phase | Effort | Cumul |
|---|---|---|
| **D2.1** Pipeline refonte | 1j | 1j |
| **D2.2** Inbox refonte | 1j | 2j |
| **D2.3** Calendar refonte | 1j | 3j |
| **D2.4** Workflows builder refonte | 1j | 4j |
| **D2.5** Templates refonte | 0.5j | 4.5j |
| **D2.6** Tasks refonte | 0.5j | 5j |
| **D2.7** Settings refonte | 1j | 6j |
| **D2.8** Reports refonte | 1j | 7j |
| **CHECKPOINT validation Rochdi** | 0j | 7j |
| **3.1** Webchat live (Durable Objects) | 3j | 10j |
| **3.2** FB Messenger + IG DM | 3j | 13j |
| **3.3** Migration M2 conversations | 2j | 15j |
| **3.4** Inbox features enrichies | 4j | 19j |
| **3.5** Quick wins Q.2 + DND audit | 1j | 20j |
| **3.6** Tests E2E | 1j | 21j |
| **Total combo** | **~21j** | — |

> [!NOTE]
> Sprint Design 2 s'élève à 7j au lieu de 6j car Reports (D2.8) est plus conséquent que prévu avec les 6 nouveaux onglets. Sprint 3 reste à 14j. Total = ~21j.

---

## F. Format commits

```
# Sprint Design 2
refactor(design): D2.1 pipeline refresh — kanban cards, stage colors, KPIs sticky, lost reason modal
refactor(design): D2.2 inbox refresh — 3 panels, message bubbles, composer tabs, contact panel
refactor(design): D2.3 calendar refresh — month/day views, drag-reschedule, mini-nav, enriched modal
refactor(design): D2.4 workflows refresh — horizontal layout, toolbox palette, properties panel
refactor(design): D2.5 templates refresh — email/SMS tabs, split editor, variables autocomplete
refactor(design): D2.6 tasks refresh — filters enriched, subtasks, bulk actions
refactor(design): D2.7 settings refresh — sub-nav sections, form patterns, save bar sticky
refactor(design): D2.8 reports refresh — 10 tabs, global filters, compare periods

# Sprint 3
feat(webchat): P4.2 widget live bidirectionnel — Durable Objects, snippet JS, pre-chat form
feat(meta-messaging): P4.9 FB Messenger + IG DM — OAuth, webhook, outbound
feat(migrate-conversations): M2 import GHL historique — queue job, idempotent, cursor pagination
feat(inbox): composer + snippets + signatures + schedule send
feat(inbox): bulk actions + snooze + read/unread + star
feat(q2-followers): conversation followers + mentions + notifications
```

---

## G. Trackers à mettre à jour

| Tracker | Ce qu'on met à jour |
|---|---|
| `ANTIGRAVITY-DEPTH-AUDIT.md` §16 | Pages refondues (Pipeline, Inbox, Calendar, etc.) |
| `ANTIGRAVITY-GHL-INVENTORY.md` §7 | P4.2 webchat + P4.9 Meta done |
| `ANTIGRAVITY-GHL-COMPLETENESS.md` §17 | Sprint 3 items done (C2, C3, C6, C7, M2) |
| `ANTIGRAVITY-DESIGN-SPRINT.md` §10 | D2.x phases done |
| `ANTIGRAVITY-PHASE3-CATCHUP.md` §8 | P3.3 (conversations) progressed |

---

## H. Questions bloquantes pour Rochdi

> [!IMPORTANT]
> **3 questions bloquantes AVANT de commencer Sprint 3 :**

1. **Meta Business Manager + page FB connectée disponible ?** — Nécessaire pour 3.2 (FB Messenger + IG DM). Si pas prêt → skip 3.2 pour l'instant.
2. **GHL PIT_TOKEN Mathis encore valide ?** — Nécessaire pour 3.3 (migration M2 conversations). Si expiré → re-générer dans GHL avant de commencer.
3. **Cloudflare Workers plan Free ou Paid ?** — Durable Objects (3.1 webchat) nécessite le plan **Workers Paid** ($5/mois). Si pas activé → impossible de faire le webchat live.

> [!NOTE]
> Sprint Design 2 n'a AUCUNE question bloquante — c'est purement du frontend/design. On peut démarrer immédiatement.

---

_Document généré le 2026-05-11 par Antigravity. Source de vérité pour les 2 prochains sprints. CHECKPOINT obligatoire entre D2 et Sprint 3._
