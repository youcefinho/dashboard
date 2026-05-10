# ANTIGRAVITY-GHL-INVENTORY.md — Inventaire complet GoHighLevel vs notre clone

> Audit fait le 2026-05-10 par Claude Opus 4.7 via accès direct API GHL (MCP servers `ghl-guimont`, `ghl-intralys`, `ghl-serujan`).
> Comptes inspectés : Mathis Guimont RE/Max Vision (Gatineau, locationId `ytI1qjzrNF56XD7IeTcq`) + Intralys agency pivot (`261NR6UbTIy1d8K0aAJn`) + Company `WtDDP8JPH4jYE9TqZcYt`.
> **Mission :** lister TOUTES les fonctions GHL activées chez Rochdi qu'on n'a pas encore implémentées, pour rattraper avant l'app mobile.

---

## 0. Découverte clé via l'API GHL

**38 modules GHL activés** sur l'agency (vu dans `permissions` du sub-account Mathis) :

| # | Module GHL | Activé chez Mathis | Activé chez Intralys | Dans notre clone |
|---|---|---|---|---|
| 1 | dashboardStatsEnabled | ✅ | ✅ | ✅ Dashboard.tsx |
| 2 | funnelsEnabled | ✅ | ✅ | ⚠️ partial (booking pages seulement, pas de funnel builder) |
| 3 | phoneCallEnabled | ✅ | ✅ | ❌ aucun (Twilio SMS oui, calls non) |
| 4 | formsEnabled | ✅ | ✅ | ✅ form builder en Phase 2 |
| 5 | quizzesEnabled | ✅ | ❌ (retiré chez Intralys) | ❌ aucun |
| 6 | textToPayEnabled | ✅ | ✅ | ❌ aucun |
| 7 | gmbMessagingEnabled | ✅ | ✅ | ❌ aucun (Google My Business chat) |
| 8 | htmlBuilderEnabled | ✅ | ✅ | ❌ aucun (visual HTML builder GHL) |
| 9 | contactsEnabled | ✅ | ✅ | ✅ Leads.tsx |
| 10 | tagsEnabled | ✅ | ✅ | ✅ lead_tags table |
| 11 | botServiceEnabled | ✅ | ✅ | ✅ AI bot Phase 2 |
| 12 | websitesEnabled | ✅ | ✅ | ❌ aucun (website builder GHL) |
| 13 | appointmentsEnabled | ✅ | ✅ | ✅ Calendar.tsx |
| 14 | proposalsEnabled | ✅ | ✅ | ❌ aucun (Documents & Proposals GHL) |
| 15 | qrCodesEnabled | ✅ | ❌ | ❌ aucun |
| 16 | webChatEnabled | ✅ | ✅ | ❌ aucun (live webchat widget) |
| 17 | facebookMessengerEnabled | ✅ | ✅ | ❌ aucun |
| 18 | launchpadEnabled | ✅ | ❌ | ❌ aucun (onboarding wizard GHL) |
| 19 | affiliateManagerEnabled | ✅ | ✅ | ❌ aucun |
| 20 | gmbCallTrackingEnabled | ✅ | ✅ | ❌ aucun |
| 21 | marketingEnabled | ✅ | ✅ | ✅ broadcast Phase 2 |
| 22 | emailBuilderEnabled | ✅ | ✅ | ⚠️ partial (templates HTML brut, pas de drag&drop builder) |
| 23 | attributionsReportingEnabled | ✅ | ✅ | ⚠️ partial (UTM oui, multi-touch attribution non) |
| 24 | triggerLinksEnabled | ✅ | ✅ | ❌ aucun (links trackés qui déclenchent workflows) |
| 25 | membershipEnabled | ✅ | ✅ | ❌ aucun (cours en ligne) |
| 26 | settingsEnabled | ✅ | ✅ | ✅ Settings.tsx |
| 27 | surveysEnabled | ✅ | ✅ | ❌ aucun |
| 28 | opportunitiesEnabled | ✅ | ✅ | ✅ pipelines (mais 0 pipeline configuré chez Mathis !) |
| 29 | reviewsEnabled | ✅ | ✅ | ⚠️ partial (Google Business Profile API en P2, pas de review request workflow) |
| 30 | smsEmailTemplatesEnabled | ✅ | ✅ | ✅ Templates.tsx |
| 31 | facebookAdsReportingEnabled | ✅ | ✅ | ❌ aucun |
| 32 | adManagerEnabled | ✅ | ❌ | ❌ aucun |
| 33 | bloggingEnabled | ✅ | ✅ | ❌ aucun |
| 34 | workflowsEnabled | ✅ | ✅ | ✅ workflow engine |
| 35 | campaignsEnabled | ✅ | ✅ | ❌ aucun (campaigns = legacy GHL, sequences automatisées multi-channel) |
| 36 | conversationsEnabled | ✅ | ✅ | ✅ Inbox.tsx |
| 37 | adwordsReportingEnabled | ✅ | ✅ | ❌ aucun |
| 38 | bulkRequestsEnabled | ✅ | ✅ | ✅ bulk actions Phase 1 |
| 39 | agentReportingEnabled | ✅ | ✅ | ❌ aucun |
| 40 | triggersEnabled | ✅ | ✅ | ⚠️ partial (workflow triggers oui, mais "Triggers" GHL = legacy plus simple) |

**Score actuel : 13/40 modules complets, 6/40 partiels, 21/40 manquants.**

---

## 1. Insights de l'audit Live

### 1.1 — Settings SaaS découverts (clé !)

Dans `Intralys` location :
```json
"saasSettings": {
  "saasMode": "setup_pending",        // ← Rochdi a déjà commencé la config SaaS !
  "customerId": "cus_TIX3crrzEeA6PO",  // ← Stripe customer ID actif
  "twilioRebilling": {
    "markup": 10,                      // ← 10% markup sur Twilio (revente sub-accounts)
    "enabled": false                   // ← pas encore activé
  }
}
```

**Implication pour notre clone P3.9 (SaaS configurator) :**
- Notre table `saas_plans` doit gérer `saasMode` enum : `not_activated | setup_pending | active`
- Twilio rebilling avec markup configurable est natif GHL — à reproduire
- Stripe customer linking au niveau sub-account nécessaire

### 1.2 — Modèle Contact GHL bien plus riche que notre `leads` table

Champs Contact GHL **manquants dans notre clone** :

| Champ GHL | Description | À ajouter ? |
|---|---|---|
| `dnd` + `dndSettings` | Do Not Disturb par canal (email/sms/call/voicemail/gmb/fb) | 🔴 OUI — anti-spam compliance |
| `firstNameRaw` / `lastNameRaw` | Préservation casse originale | 🟡 nice-to-have |
| `additionalEmails: []` | Emails secondaires | 🟠 OUI — fréquent en immo (couples) |
| `followers: []` | Multi-user followers d'un contact | 🟠 OUI — collaboration |
| `dateOfBirth` | Anniversaire pour campagnes | 🟡 nice-to-have |
| `businessId` | Liaison à un objet "business" (B2B) | 🟡 hors scope immo |
| `country`, `timezone` | Per-contact timezone | 🟠 OUI — scheduling correct |
| `profilePhoto` | Photo du contact (URL R2) | 🟡 nice-to-have |
| `attributions: [{}]` | **Multi-touch attribution array** | 🔴 OUI — pour P3.5 |
| `customFields: [{id, value}]` | Format key-value (ID stable) | ⚠️ vérifier qu'on a ça en P3.4 |
| `source` | Type d'origine (`external_form`, `manual`, `import`, `api`, `funnel`, `calendar`...) | 🟠 OUI — déjà partiel |

### 1.3 — Multi-touch attribution natif GHL

Chaque contact a un array `attributions: []` avec **first AND last touch** :
```json
"attributions": [
  { "isFirst": true,  "medium": "External Form", "mediumId": "leadform-acheter", "url": "...", "userAgent": "...", "ip": "...", "utmSessionSource": "Direct traffic" },
  { "isLast":  true,  "medium": "External Form", "mediumId": "leadform-vendre",  "url": "...", "userAgent": "...", "ip": "..." }
]
```

**À ajouter dans notre clone :**
- Table `attributions (id, lead_id, medium, medium_id, url, page_url, ip, user_agent, utm_source, utm_session_source, is_first, is_last, created_at)`
- À chaque session sur un site client, INSERT une ligne
- `is_first` = première session jamais (jamais update)
- `is_last` = dernière session (UPDATE à chaque nouvelle session)

### 1.4 — Conversations GHL — features riches

Champs vus dans `search-conversation` réponse :
- `lastMessageType`: 30+ types (TYPE_CALL, TYPE_SMS, TYPE_EMAIL, TYPE_WEBCHAT, TYPE_FACEBOOK, TYPE_INSTAGRAM, TYPE_WHATSAPP, TYPE_GMB, TYPE_REVIEW, TYPE_SMS_REVIEW_REQUEST, TYPE_LIVE_CHAT, TYPE_VOICEMAIL, TYPE_INTERNAL_COMMENT, TYPE_ACTIVITY_PAYMENT, TYPE_ACTIVITY_OPPORTUNITY, TYPE_ACTIVITY_INVOICE, TYPE_ACTIVITY_APPOINTMENT, TYPE_FACEBOOK_COMMENT, TYPE_INSTAGRAM_COMMENT, TYPE_IVR_CALL, etc.)
- `lastOutboundMessageAction`: `automated` vs `manual` (workflow vs human)
- `unreadCount` : compteur non-lus par conversation
- `followers: []` : multi-user followers
- `mentions: []` : `@mentions` inline
- `isLastMessageInternalComment` : support notes internes inline
- `attributed: true` : flag attribution
- `scoring: []` : **multi-score profiles** (pas juste un score 0-100)

**À ajouter dans notre clone :**
- `messages.message_type` enum étendu (au moins TYPE_WEBCHAT, TYPE_VOICEMAIL, TYPE_REVIEW, TYPE_FACEBOOK_COMMENT, TYPE_INSTAGRAM_COMMENT)
- `conversations.followers: TEXT[]` JSON
- `conversations.unread_count: INTEGER`
- `conversations.is_starred: INTEGER` (status `starred` vu dans l'API)
- Activity events natifs en tant que messages (TYPE_ACTIVITY_*) → unifier l'inbox + la timeline

### 1.5 — Custom fields GHL — beaucoup plus puissants qu'attendu

Vu chez Mathis (5 fields) :
- `dataType`: SINGLE_OPTIONS (avec `picklistOptions: [...]`), TEXT
- D'autres `dataType` GHL existent (vu dans la doc) : NUMBER, DATE, MULTIPLE_OPTIONS, CHECKBOX, FILE_UPLOAD, SIGNATURE, TEXTAREA, RADIO, PHONE, EMAIL, MONETARY
- `parentId`: groupes/folders pour organiser les fields (UI builder)
- `position`: ordre d'affichage
- `placeholder`: texte d'aide
- `documentType`: `field` vs `folder`
- `model`: `contact` ou `opportunity` (GHL a des custom fields sur les **opportunities** aussi !)
- `standard: false` : distinguer les builtin vs custom

**À ajouter dans notre clone P3.4 :**
- Tous les `dataType` ci-dessus, pas juste 5
- Folders/groups (parentId pattern)
- Custom fields sur **opportunities** (deals) aussi, pas juste contacts
- `position` pour drag&drop reorder

### 1.6 — Permissions par module (RBAC fin)

GHL a des permissions GRANULAIRES par module (les 40 flags du tableau §0). Notre RBAC binaire admin/broker est **trop pauvre**.

**À ajouter :**
- Table `role_permissions (role_id, module, can_view, can_edit, can_delete)`
- Possibilité de désactiver des modules par sub-account (white-label : "ce client n'a pas l'option Documents")

---

## 2. Phase 4 — Plan de rattrapage GHL (priorisé par votes commerciaux)

> Phase 3 actuelle = on était sur le code-level missing. Phase 4 = **on rattrape les 21 modules GHL manquants**, dans l'ordre où ça génère du revenu.

### 🔴 P4.1 — Voice/Calls Twilio + Voicemail drops (~5j)
**Module GHL :** `phoneCallEnabled` + `gmbCallTrackingEnabled`
**Pourquoi :** courtier sans téléphone = absurde. GHL fait l'IVR + recording + voicemail drop. Sans ça, le courtier garde son cell perso = perd les appels.

- Numéro Twilio par sub-account (déjà 10DLC en P1)
- Endpoint `/api/voice/twiml` (TwiML XML routing)
- Recording auto + transcription Whisper
- Voicemail drops : enregistrer un message, déposer en bulk sur N numéros sans sonnerie
- Call logs dans `messages` table avec `channel='call'`
- Click-to-call dans LeadDetail
- IVR menu builder ("Pour vente, tapez 1...")

### 🔴 P4.2 — Webchat widget bidirectionnel live (~3j)
**Module GHL :** `webChatEnabled`
**Pourquoi :** le snippet `<script>` GHL est déposé sur 80% des sites courtiers. Sans ça, on perd les leads "chat now".

- Snippet JS embeddable (`https://crm.intralys.com/widget/v1.js`)
- WebSocket via Cloudflare Durable Objects
- Pré-chat form : capture name+email
- Persistence dans `messages` table avec `channel='webchat'`
- Notification push au courtier en temps réel
- Mode online/offline auto selon hours

### 🔴 P4.3 — Documents & Proposals + e-signature (~5j) [déjà en P3.2]
**Module GHL :** `proposalsEnabled`
**Voir P3.2 du catchup précédent.** Killer feature pour mandat de courtage.

### 🔴 P4.4 — Multi-touch attribution + UTM tracking complet (~3j)
**Module GHL :** `attributionsReportingEnabled` + `facebookAdsReportingEnabled` + `adwordsReportingEnabled`

- Table `attributions` (cf. §1.3)
- Capture `attribution` à chaque session sur sites clients (cookie `ghl_session_id`)
- First-touch + last-touch + multi-touch reports
- Lien Facebook Ads / Google Ads via OAuth
- Auto-import dépenses ad par campaign
- Calcul ROI par campagne (revenue / cost)

### 🟠 P4.5 — Trigger Links (links trackés workflow-aware) (~2j)
**Module GHL :** `triggerLinksEnabled`
**Pourquoi :** GHL fait des links trackés `https://l.intralys.com/abc123` qui :
- Redirigent vers une URL
- Loggent le clic
- Déclenchent un workflow ("si lead clique le lien guide → tag 'intéressé guide'")

- Table `trigger_links (id, name, target_url, client_id, click_count, created_at)`
- Endpoint `GET /l/:slug` qui log le clic + redirige
- Workflow trigger `link_clicked` avec `trigger_config.link_id`
- UI dans Templates : "Insérer un trigger link"

### 🟠 P4.6 — Reviews & Reputation Management complet (~3j)
**Module GHL :** `reviewsEnabled`

- Table `review_requests (lead_id, channel, sent_at, status)`
- Workflow auto post-deal `lead.status = signed` → request review
- Email/SMS template : "Comment s'est passée votre expérience ? [⭐⭐⭐⭐⭐ → Google] [< 5 étoiles → form interne pour feedback]"
- Dashboard reviews : aggregateRating moyen, nombre par étoile
- Réponse auto-générée AI à chaque review (suggestion)
- Sync Google Business Profile reviews (déjà en P2 partial)
- Sync Facebook reviews

### 🟠 P4.7 — Email builder drag&drop visuel (~5j)
**Module GHL :** `emailBuilderEnabled`
**Pourquoi :** on a HTML brut, GHL a un builder visuel type Mailchimp/Stripo. Sans ça, le courtier ne peut pas créer de campagne sans dev.

- Lib : MJML (markup → HTML responsive auto) ou Unlayer (premium mais excellent)
- UI builder block-based : header, image, text, button, columns, divider, social, footer
- Preview desktop/mobile
- Save → `email_templates.body_html` (les blocks compilés en HTML email-safe)

### 🟠 P4.8 — Surveys + Quiz builder (~3j)
**Module GHL :** `surveysEnabled` + `quizzesEnabled`
**Pourquoi :** quiz "Quel type de propriété pour vous ?" = lead magnet n°1 chez courtiers QC.

- Réutilise notre form builder (P2 done) + ajout :
- Logic branching (si réponse Q1 = X → aller Q3, sinon Q2)
- Score calculation (chaque réponse a un poids)
- Result page personnalisée selon score
- Export résultats CSV

### 🟠 P4.9 — Facebook Messenger + Instagram DM (~3j) [P3.3.b]
**Module GHL :** `facebookMessengerEnabled`
**Voir P3.3.b du catchup précédent.**

### 🟡 P4.10 — Affiliate Manager (~3j)
**Module GHL :** `affiliateManagerEnabled`
**Pourquoi :** courtier peut recruter des "rabatteurs" qui touchent 5% sur les commissions générées.

- Table `affiliates (id, client_id, name, email, link_slug, commission_pct, total_earned)`
- Public link `/r/:slug` qui set un cookie 30j
- Si lead converti via cookie → tracking automatique
- Dashboard affiliate : leads référés, conversions, commission due
- Auto-payout via Stripe Connect

### 🟡 P4.11 — Memberships / Cours en ligne (~7j) ⚠️ gros morceau
**Module GHL :** `membershipEnabled`
**Pourquoi :** revente d'une formation "Devenir courtier" = revenu récurrent indépendant des leads.

- Site membres avec login séparé (table `members` distincte des `users`)
- Cours = catégories + modules + leçons (vidéo MP4 sur R2 + texte)
- Progression tracking
- Drip release (lesson 2 dispo 7j après lesson 1)
- Quiz à la fin de chaque module avec score min
- Certificate generation (PDF) à la fin du cours
- Stripe pour vente d'accès cours

**Skip si pas demandé par les premiers clients.**

### 🟡 P4.12 — Website builder + Funnels visual (~10j) ⚠️ très gros
**Module GHL :** `websitesEnabled` + `funnelsEnabled` + `htmlBuilderEnabled`
**Pourquoi :** GHL héberge le site du courtier + ses funnels. Sans ça, courtier garde Wix/WordPress en parallèle.

**Stratégie pragmatique :** ne PAS recoder un Webflow killer. Plutôt :
- Templates pré-faits par niche (5-10 templates de site courtier QC)
- Editor markdown / blocks light (pas full WYSIWYG)
- Hosting via Cloudflare Pages avec custom domain
- Lien deep avec forms + booking pages déjà existants

### 🟡 P4.13 — Blog CMS (~3j)
**Module GHL :** `bloggingEnabled`
**Pourquoi :** SEO local pour courtiers QC. GHL a un CMS blog basique.

- Table `blog_posts (id, client_id, slug, title, body_html, author, status, published_at, seo_meta JSON)`
- CRUD UI dans `/blog/admin`
- Public route `/{client_slug}/blog/{post_slug}` SSR avec Schema.org Article
- RSS feed `/blog/rss.xml`
- Categories + tags

### 🟡 P4.14 — Social Media Posting (~4j)
**Module GHL :** non listé dans permissions mais existe (`social-media-posting` MCP team)
**Pourquoi :** scheduler unifié FB+IG+LinkedIn+Twitter+TikTok = gros gain de temps.

- OAuth Facebook + Instagram (Meta Graph API) — déjà partiel pour Messenger
- LinkedIn API (App OAuth)
- Table `social_posts (id, client_id, content, media_urls, scheduled_for, status, accounts JSON)`
- Calendar UI pour planifier
- AI caption generator (Claude Haiku) avec ton client

### 🟡 P4.15 — QR Codes builder (~1j)
**Module GHL :** `qrCodesEnabled`
**Pourquoi :** courtier veut un QR sur sa pancarte "scanne pour visite virtuelle".

- Table `qr_codes (id, client_id, target_url, scan_count, created_at)`
- Génération PNG via API tierce (api.qrserver.com — gratuit) ou lib `qrcode-svg`
- Endpoint `/qr/:id` qui log le scan + redirige

### 🟡 P4.16 — Campaigns (legacy GHL = sequences multi-channel) (~2j)
**Module GHL :** `campaignsEnabled`
**Pourquoi :** GHL distingue Workflows (modernes, conditionnels) vs Campaigns (legacy, séquences linéaires multi-canal). Plus simple pour courtiers non-techniques.

- Wrapper UI sur notre workflow engine existant
- Template : "Drip campaign 7 emails sur 14 jours" sans toucher au workflow builder complexe
- Analytics : open rate, click rate, conversion par étape

### 🟢 P4.17 — Agent Reporting + Performance (~2j)
**Module GHL :** `agentReportingEnabled`
**Pourquoi :** vue "leaderboard agents" : qui ferme le plus de deals ce mois.

- Endpoint `GET /api/reports/agents?from=&to=`
- Métriques par user : leads assignés, leads contactés, deals signés, revenue total
- Graphiques Recharts dans `/reports` (nouvel onglet "Équipe")
- Comparatif mois actuel vs précédent

### 🟢 P4.18 — Text-to-Pay (paiement par SMS) (~2j)
**Module GHL :** `textToPayEnabled`
**Pourquoi :** courtier facture une commission → envoie SMS "Payez ici : [link Stripe]".

- Réutilise Stripe Invoices (P3.8)
- Endpoint `POST /api/invoices/:id/text-pay` qui send SMS avec lien checkout
- Statut payment update via webhook Stripe

### 🟢 P4.19 — Launchpad (onboarding wizard) (~2j)
**Module GHL :** `launchpadEnabled`
**Pourquoi :** quand un nouveau sub-account se crée, GHL guide pas-à-pas (connect calendar, connect Twilio, import contacts...). Gain de rétention énorme.

- Modal multi-step première connexion : 8 étapes (logo, palette, calendar, Twilio, FB page, Google Reviews, premier contact, premier workflow)
- Progress saved en DB (`users.onboarding_step`)
- Skip option par étape
- Redirect direct vers la step en cours au login

### 🟢 P4.20 — IVR / Call routing (~3j)
**Module GHL :** dépend de `phoneCallEnabled` (P4.1)
**Pourquoi :** "Pour acheter, tapez 1. Pour vendre, tapez 2."

- TwiML XML builder visuel
- Table `ivr_menus (id, client_id, twilio_number, tree JSON)`
- Routing vers user assigné selon choix
- Voicemail si pas de réponse

---

## 3. Phase 4 récap

| # | P4.x | Module GHL | Effort | Vote commercial | À mettre en démo ASAP ? |
|---|---|---|---|---|---|
| 1 | P4.1 | Voice/Calls + voicemail | 5j | 🔴 critique | OUI |
| 2 | P4.2 | Webchat widget live | 3j | 🔴 critique | OUI |
| 3 | P4.3 | Documents + e-sign | 5j | 🔴 critique | OUI (déjà en P3.2) |
| 4 | P4.4 | Multi-touch attribution | 3j | 🔴 critique | OUI (déjà en P3.5) |
| 5 | P4.5 | Trigger Links | 2j | 🟠 high | non |
| 6 | P4.6 | Reviews & Reputation | 3j | 🟠 high | OUI |
| 7 | P4.7 | Email builder drag&drop | 5j | 🟠 high | non (HTML suffit pour démo) |
| 8 | P4.8 | Surveys + Quiz | 3j | 🟠 high | non |
| 9 | P4.9 | FB Messenger + IG DM | 3j | 🟠 high | OUI (déjà en P3.3.b) |
| 10 | P4.10 | Affiliate Manager | 3j | 🟡 medium | non |
| 11 | P4.11 | Memberships/Cours | 7j | 🟡 medium | non |
| 12 | P4.12 | Website builder | 10j | 🟡 medium | non |
| 13 | P4.13 | Blog CMS | 3j | 🟡 medium | non |
| 14 | P4.14 | Social Media Posting | 4j | 🟡 medium | OUI |
| 15 | P4.15 | QR Codes | 1j | 🟢 low | non |
| 16 | P4.16 | Campaigns wrapper | 2j | 🟢 low | non |
| 17 | P4.17 | Agent Reporting | 2j | 🟢 low | non |
| 18 | P4.18 | Text-to-Pay | 2j | 🟢 low | non |
| 19 | P4.19 | Launchpad onboarding | 2j | 🟢 low | non |
| 20 | P4.20 | IVR call routing | 3j | 🟢 low | non |

**Total Phase 4 :** ~71j de dev solo (~14 semaines à temps plein, ~3-4 mois à 75%).

---

## 4. Quick wins infra (à faire avant Phase 4)

### Q.1 — DND (Do Not Disturb) par canal — 1j
Champ `dnd: bool` + `dndSettings: { email, sms, call, voicemail, gmb, fb }` sur leads.
Tous les `send_*` filtrent automatiquement. Compliance + UX énorme.

### Q.2 — Followers + mentions sur conversations — 1j
Multi-user collaboration sur les threads. `messages.mentions: TEXT[]` + notification push aux mentionnés.

### Q.3 — Activity events comme messages unifiés — 1j
Au lieu d'un `activity_log` séparé, INSERT dans `messages` avec `channel='internal_activity'` et `message_type='TYPE_ACTIVITY_*'`. Inbox devient timeline complète.

### Q.4 — Multi-score profiles — 1j
GHL a `scoring: []` (multi-profiles). Notre `score: int` est trop simple. Table `lead_scores (lead_id, profile_id, score)` + UI pour définir des profils ("score chaud", "score acheteur sérieux", "score qualifié AMF").

### Q.5 — `additionalEmails`, `dateOfBirth`, `country`, `timezone` sur leads — 0.5j
Migration simple, gros gain UX.

### Q.6 — RBAC granulaire par module (40 modules toggle) — 2j
Permissions par sub-account au niveau module + par user au niveau action.

**Total quick wins :** ~6.5j — à faire en pré-Phase 4.

---

## 5. Décision stratégique recommandée

### Option A — MVP Phase 4 (4 features critiques, 16j)
- P4.1 Voice/Calls (5j)
- P4.2 Webchat live (3j)
- P4.3 Documents + e-sign (5j) [déjà P3.2]
- P4.6 Reviews (3j)
- + Quick wins Q.1 + Q.5 (1.5j)

→ Tu signes 5 nouveaux clients courtiers QC en 1 mois sur la base de ces features.

### Option B — Full Phase 4 (71j)
Tout le tableau §3.
→ Vraie parité GHL, mais 3-4 mois de dev = mobile retardé.

### Option C — Hybride (recommandé)
- Sprint 1 (16j) : MVP Phase 4 → vente
- Sprint 2 (15j) : Mobile Capacitor V1 → couverture mobile basique
- Sprint 3 (en parallèle vente) : autres P4 selon demandes clients

---

## 6. Ce que je n'ai PAS pu vérifier (faute de scope PIT)

L'audit MCP a montré ces 401/403 (PIT pas autorisé) — donc à confirmer avec Rochdi côté UI :

- ❌ Opportunities chez Intralys (401) — probablement pas configuré
- ❌ Custom fields chez Intralys (401) — idem
- ❌ Payments (403) chez Mathis — vérifier si Stripe est connecté chez Mathis ou seulement Intralys
- ❌ Workflows existants (pas testé) — combien Rochdi en a déjà créés en GHL ?
- ❌ Triggers GHL (legacy) — utilisés ?
- ❌ Affiliate manager — activé chez quelqu'un ?
- ❌ SaaS configuration — `setup_pending` chez Intralys, où en est Rochdi ?

**Action Rochdi :** se connecter au GHL UI et exporter la liste des workflows + triggers + automations actifs sur Mathis (pour voir le pattern exact à reproduire).

---

## 7. Status tracker Phase 4

| ID | Tâche | Status | Commit |
|---|---|---|---|
| Q.1 | DND par canal | ⬜ todo | — |
| Q.2 | Followers + mentions | ⬜ todo | — |
| Q.3 | Activity events unifiés | ⬜ todo | — |
| Q.4 | Multi-score profiles | ⬜ todo | — |
| Q.5 | Champs contact étendus | ⬜ todo | — |
| Q.6 | RBAC granulaire 40 modules | ⬜ todo | — |
| P4.1 | Voice/Calls + voicemail | ⬜ todo | — |
| P4.2 | Webchat widget live | ⬜ todo | — |
| P4.3 | Documents + e-sign | ⬜ todo (cf P3.2) | — |
| P4.4 | Multi-touch attribution | ⬜ todo (cf P3.5) | — |
| P4.5 | Trigger Links | ⬜ todo | — |
| P4.6 | Reviews & Reputation | ⬜ todo | — |
| P4.7 | Email builder drag&drop | ⬜ todo | — |
| P4.8 | Surveys + Quiz | ⬜ todo | — |
| P4.9 | FB Messenger + IG DM | ⬜ todo (cf P3.3.b) | — |
| P4.10 | Affiliate Manager | ⬜ todo | — |
| P4.11 | Memberships/Cours | ⬜ todo | — |
| P4.12 | Website builder | ⬜ todo | — |
| P4.13 | Blog CMS | ⬜ todo | — |
| P4.14 | Social Media Posting | ⬜ todo | — |
| P4.15 | QR Codes | ⬜ todo | — |
| P4.16 | Campaigns wrapper | ⬜ todo | — |
| P4.17 | Agent Reporting | ⬜ todo | — |
| P4.18 | Text-to-Pay | ⬜ todo | — |
| P4.19 | Launchpad onboarding | ⬜ todo | — |
| P4.20 | IVR call routing | ⬜ todo | — |

---

## 8. Questions bloquantes pour Rochdi

1. **Tu vas dans quelle direction commerciale ?** Option A (MVP 16j) / B (Full 71j) / C (Hybride avec mobile) ?
2. **Twilio Voice** est-il commandé ? (10DLC est fait pour SMS, mais Voice c'est un autre dossier).
3. **Tu veux héberger le site des courtiers** (P4.12) ou tu préfères qu'ils gardent leur site existant ?
4. **Affiliate Manager** — est-ce que les courtiers QC ont vraiment des rabatteurs ? (skip si non).
5. **Memberships** — vendre des formations courtiers est-il un business model que tu veux pousser ? (lourd à développer si pas demandé).
6. **Stripe Connect** est-il configuré sur ton compte Intralys ? (le `customerId: cus_TIX3crrzEeA6PO` indique oui, mais Connect est différent).

---

## 9. Données brutes audit GHL (référence)

### Sub-accounts inspectés
- **Mathis Guimont RE/Max Vision** — `ytI1qjzrNF56XD7IeTcq` (auth via tracking ID `uE8otTz2VFBFG6lqzsmK`)
  - Address: 225 Bd de la Gappe, Gatineau QC J8T 7L6
  - Site: mathisguimont.com
  - Created: 2026-05-01
  - 11 contacts (9 leads + 2 tests)
  - 0 pipelines configurés (à créer !)
  - 0 social accounts connectés
  - 0 blogs
  - 0 email templates créés
  - 1 conversation (Rochdi test newsletter)
  - 5 custom fields contact (Budget, Message, Délai, Adresse, Type propriété)
  - Forms actifs : `leadform-acheter`, `leadform-vendre`, `leadform-newsletter`, `leadform-guide`
- **Intralys (agency pivot)** — `261NR6UbTIy1d8K0aAJn`
  - `isAgencySubAccount: true`
  - `saasMode: setup_pending`
  - Stripe customer linked: `cus_TIX3crrzEeA6PO`
  - PIT n'a pas le scope opportunities/custom-fields → audit limité
- **Serujan** — locationId non découvert (sandbox bloqué exploration claude.json)
  - PIT location-scoped séparé — non auditable depuis ce contexte

### Company
- **WtDDP8JPH4jYE9TqZcYt** (Intralys agency) — brandId `8lWVAKunUZ8ZsQTqjErG`
- 38 modules GHL activés (cf §0)

---

_Document généré le 2026-05-10 par Claude Opus 4.7 via inspection live API GHL (MCP servers `ghl-guimont`, `ghl-intralys`, `ghl-serujan`). Source de vérité pour la planification Phase 4._
