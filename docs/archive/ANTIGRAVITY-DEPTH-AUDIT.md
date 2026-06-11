# ANTIGRAVITY-DEPTH-AUDIT.md — Audit profondeur section par section

> Audit fait le 2026-05-10 par Claude Opus 4.7.
> **Constat Rochdi :** "On a les grandes lignes mais on n'a pas enrichi comme il faut chaque section ni chaque paramètre."
> **Mission :** pour CHAQUE page existante du clone, lister tous les champs/filtres/actions/widgets/options GHL manquants. Pas des nouvelles features — juste **enrichir l'existant** à la profondeur GHL.

**Distinction importante** :
- `ANTIGRAVITY-GHL-COMPLETENESS.md` = features GHL **manquantes** (nouvelles pages, nouveaux modules)
- `ANTIGRAVITY-DEPTH-AUDIT.md` = **enrichissement des pages existantes** (pas de nouvelle page, juste ajouter ce qui manque dedans)

**Légende :**
- 🔴 critique manquant (le user voit que c'est vide vs GHL)
- 🟠 important manquant
- 🟡 nice-to-have
- ✅ déjà présent

---

## 1. Page Dashboard — `src/pages/Dashboard.tsx`

### État actuel : 377 lignes
- ✅ 4 stat cards (Total leads, Nouveaux 7j, En attente, Conversion)
- ✅ 4 widgets secondaires (Pipeline value, Hot leads, Tâches retard, Période)
- ✅ Sélecteur période 7d/30d/90d
- ✅ Graph leads par jour (AreaChart)
- ✅ Graph répartition statuts (BarChart)
- ✅ Liste 8 derniers leads
- ✅ Liste RDV à venir
- ✅ Leads par client (avec progress bars)

### Ce que GHL Dashboard a en plus :

#### Stat cards manquantes
- 🔴 **Revenue this month** vs mois précédent + delta %
- 🔴 **MRR / ARR** (si SaaS activé)
- 🔴 **Win rate** (deals signed / total opps closed)
- 🔴 **Avg deal size**
- 🟠 **Avg sales cycle** (jours entre lead.created et signed)
- 🟠 **Pipeline velocity** (deals/jour qui avancent dans pipeline)
- 🟠 **Customer acquisition cost (CAC)** par source
- 🟠 **Source ROI** (revenue / spend par source)
- 🟠 **Tasks completed today** vs created today
- 🟠 **Calls/SMS/Emails this week** par canal
- 🟠 **New conversations** + **Unread conversations**
- 🟡 **Last login activity** des users de l'agence
- 🟡 **Top performing workflow** (le + d'enrollments cette semaine)

#### Période — actuellement le sélecteur ne filtre que 1 widget
- 🔴 **Faire que TOUS les graphs et stats respectent la période sélectionnée**
- 🟠 Ajouter période **Custom date range** (pas juste 7/30/90)
- 🟠 Comparaison **vs période précédente** (delta % sur chaque KPI)
- 🟡 Période **YTD / MTD / WTD / Today**

#### Widgets manquants
- 🔴 **Activity feed temps réel** (qui a fait quoi dans l'agence : "John a contacté lead X", "Marie a conclu deal Y", "Sophie a créé contact Z")
- 🟠 **Goal tracking widget** : "Objectif mois : 10 deals — actuel 7/10 (70%)"
- 🟠 **Funnel chart visuel** (entonnoir conversion par stage)
- 🟠 **Heat map** des contacts par jour/heure (quand les leads arrivent)
- 🟠 **Top performing source** chart
- 🟠 **Opportunités à risque** (deals en stade depuis > 14j sans activité)
- 🟠 **Tasks dues this week** mini-list
- 🟠 **Birthdays this week** (si dateOfBirth ajouté en Q.5)
- 🟡 **Weather widget** Quebec (gimmick GHL)
- 🟡 **News feed** (RSS immobilier QC)

#### Customization (BIG manque)
- 🔴 **Drag & drop des widgets** (user choisit quoi afficher où)
- 🔴 **Save dashboard layout per user** (table `dashboard_layouts`)
- 🟠 **Multiple dashboard tabs** ("Mon dashboard", "Dashboard équipe", "Dashboard SaaS")
- 🟠 **Widgets à activer/désactiver** dans Settings
- 🟠 **Add custom KPI** (formule SQL custom)

#### Filters dashboard-wide
- 🔴 **Filter by user/agent** (voir les KPIs juste pour Marie)
- 🔴 **Filter by sub-account** (admin agency)
- 🟠 **Filter by source**
- 🟠 **Filter by tag**

#### Export
- 🔴 **Export PDF dashboard** (pour présenter au client)
- 🟠 **Schedule weekly email digest** du dashboard à l'agence

**Effort enrichissement Dashboard : ~5 jours**

---

## 2. Page Leads / Contacts — `src/pages/Leads.tsx` (450 lignes) + `LeadDetail.tsx` (478 lignes)

### État actuel Leads.tsx (liste)
- ✅ Table leads avec colonnes : Nom, Email, Tél, Statut, Type, Source, Client, Date
- ✅ Filtres : status, source, client_id, search
- ✅ Sort : newest, oldest, name
- ✅ Bulk actions (P1.7) : change_status, add_tag, assign, delete
- ✅ Export CSV
- ✅ Pagination cursor (P1.5)

### Ce que GHL Contacts list a en plus :

#### Vue / colonnes
- 🔴 **Customizable columns** : user choisit quelles colonnes voir + ordre + width
- 🔴 **Saved column views** : "Vue Acheteurs", "Vue Vendeurs", "Vue Hot leads"
- 🟠 **Card view** alternative (pas que table)
- 🟠 **Map view** (leads sur carte Quebec — différenciateur D10)
- 🟡 **Calendar view** (leads par date created)

#### Filtres avancés
- 🔴 **Filtre custom field** ("Budget > 500k", "Type propriété = Condo")
- 🔴 **Filtre tags** multi-select avec AND/OR
- 🔴 **Filtre date range custom** (pas juste created_at)
- 🟠 **Filtre score range** (slider 0-100)
- 🟠 **Filtre assigned_to**
- 🟠 **Filtre has/has not** : has email, has phone, has tasks, has appointments
- 🟠 **Filtre last activity > N jours** (leads dormants)
- 🟠 **Filtre attribution source** (UTM detail)
- 🟠 **Filtre engagement** (opened email, clicked link, replied SMS)
- 🟠 **Filtre DND** (do not disturb par canal)
- 🟠 **Filtre missing data** (no email, no phone, no source)

#### Saved searches / Smart Lists
- 🔴 **Save filter combo as Smart List** (cf. P3.4)
- 🔴 **Smart List partagée vs personnelle**
- 🟠 **Auto-update count** sur Smart List dans sidebar

#### Recherche
- 🟠 **Recherche fuzzy** (typos OK)
- 🟠 **Recherche dans custom fields** (pas juste name/email/phone)
- 🟠 **Recherche dans notes**
- 🟠 **Recherche dans messages history**

#### Bulk actions (au-delà de P1.7 actuel)
- 🟠 **Bulk export selected** (juste les sélectionnés)
- 🟠 **Bulk send email** (broadcast aux sélectionnés)
- 🟠 **Bulk send SMS**
- 🟠 **Bulk add to workflow**
- 🟠 **Bulk add to opportunity / pipeline**
- 🟠 **Bulk update custom field**
- 🟠 **Bulk merge duplicates** (cf. C10)

#### Inline edit dans la table
- 🔴 **Edit status inline** (dropdown direct dans la cellule)
- 🟠 **Edit tags inline**
- 🟠 **Edit assigned_to inline**

#### Add contact manually
- 🔴 **Bouton "+ Add Contact" en haut** (cf. C11) avec modal full form

### État actuel LeadDetail.tsx (478 lignes)
- ✅ Status changeable (dropdown)
- ✅ Notes editable
- ✅ Deal value editable
- ✅ Tags add/remove
- ✅ Tabs : Details, Conversations, Activity
- ✅ Appointments liés
- ✅ Tasks liés
- ✅ Inline edit fields (partial)

### Ce que GHL Contact Detail a en plus :

#### Header contact card
- 🔴 **Avatar / profile photo** (URL ou initials avec colored bg)
- 🟠 **Quick actions row** : 📞 Call, 💬 SMS, 📧 Email, 📅 Book, 📝 Note (boutons en haut)
- 🟠 **Lead score badge** visible avec couleur
- 🟠 **Last activity timestamp** ("Last contacted 3 days ago")
- 🟠 **Owner with avatar**
- 🟠 **Source badge** prominent
- 🟠 **Star/favorite contact** (admin)
- 🟠 **Lifecycle stage badge** (lead/MQL/SQL/customer/champion)

#### Champs manquants dans le panneau Details
- 🔴 **DND par canal** : 4 toggles (Email, SMS, Call, Voicemail) — cf. Q.1
- 🔴 **Additional emails** (array, add/remove) — cf. Q.5
- 🔴 **Additional phones** (array)
- 🔴 **Date of birth** (avec age calculé) — cf. Q.5
- 🔴 **Country / Timezone** — cf. Q.5
- 🟠 **Address autocomplete** (Mapbox/Google Places)
- 🟠 **Social profiles** (FB, IG, LinkedIn URLs)
- 🟠 **Spouse / contact relationships** (lien vers autre contact)
- 🟠 **Children / family info** (custom fields fixes immo)
- 🟠 **Lifecycle stage** (Lead → MQL → SQL → Opportunity → Customer)
- 🟠 **Lead source detail** (UTM full breakdown : source/medium/campaign/term/content)
- 🟠 **Referral source** (qui a référé ce lead — autre contact)
- 🟠 **Followers list** (multi-user) — cf. Q.2
- 🟠 **Custom fields rendus avec leur dataType** (date picker pour date, dropdown pour SINGLE_OPTIONS, etc.) — cf. P3.4

#### Tabs supplémentaires (au-delà de Details/Conv/Activity)
- 🔴 **Opportunities tab** : tous les deals liés à ce contact
- 🟠 **Tasks tab** : tasks dédiées au contact (vs liste mélangée)
- 🟠 **Appointments tab** dédié
- 🟠 **Files tab** : documents uploadés (besoin R2)
- 🟠 **Forms submissions tab** : tous les forms remplis
- 🟠 **Payments tab** : transactions Stripe (post P3.8)
- 🟠 **Workflows tab** : enrollments actifs et passés
- 🟠 **Smart Lists** : à quelles Smart Lists ce contact appartient
- 🟠 **Score history tab** : évolution du score dans le temps
- 🟠 **Attributions tab** : multi-touch attribution complète

#### Activity timeline
- 🟠 **Filter par type** (calls only, emails only, status changes only)
- 🟠 **Group by day** avec headers
- 🟠 **Edit/delete past activity** (admin)
- 🟠 **Add manual activity** (logged a call, sent a letter, etc.)

#### Notes
- 🟠 **Multiple notes** (pas une zone unique : array de notes datées)
- 🟠 **Mention users** dans notes (@john)
- 🟠 **Pin important note**
- 🟠 **Note attachments** (cf. C14 + R2)
- 🟠 **Note categories** (call note, meeting note, follow-up)

#### Quick actions footer/sidebar
- 🟠 **Quick "Send to workflow"** button
- 🟠 **Quick "Create task"** button
- 🟠 **Quick "Schedule appointment"** button
- 🟠 **Quick "Add to opportunity"** button
- 🟠 **"Mark as duplicate"** action
- 🟠 **"Merge with..."** action
- 🟠 **"Block/unblock"** contact

#### Édition contact
- 🟠 **Edit modal complet** (pas juste inline) avec tous les fields
- 🟠 **Bulk delete from detail** (delete contact + all related data)
- 🟠 **Export single contact** (vCard / PDF profile)

**Effort enrichissement Leads + LeadDetail : ~7 jours**

---

## 3. Page Pipeline — `src/pages/Pipeline.tsx` (221 lignes)

### État actuel
- ✅ Vue Kanban avec drag&drop entre colonnes
- ✅ 4 KPIs en haut (Opportunités, Valeur totale, Prévision pondérée, Dormants)
- ✅ Score visuel par carte avec couleur
- ✅ Détection leads dormants > 7j
- ✅ Tags affichés sur cartes

### Ce que GHL Opportunities Pipeline a en plus :

#### Sélection pipeline
- 🔴 **Multi-pipelines selector** (P1.8 a la table mais pas l'UI selector)
- 🔴 **Pipeline customization UI** (créer/renommer/réordonner stages) — cf. C25
- 🟠 **Stage probability customizable** par pipeline
- 🟠 **Stage color customizable**
- 🟠 **WIP limit** par stage (max N opps en parallèle)

#### Filters pipeline
- 🔴 **Filter by owner**
- 🔴 **Filter by source**
- 🔴 **Filter by tag**
- 🔴 **Filter by date range** (created/updated)
- 🟠 **Filter by deal value range** (slider min/max)
- 🟠 **Filter by custom field opportunity** (cf. C26)
- 🟠 **Filter by lost reason** (si stage='lost')

#### Vues alternatives
- 🔴 **Vue List/Table** (alternative au kanban)
- 🟠 **Vue Forecast** (revenue prévisionnel par mois)
- 🟠 **Vue Funnel chart** (entonnoir conversion)
- 🟡 **Vue Calendar** (deals avec close_date)

#### Carte opportunity (enrichir)
- 🔴 **Photo de propriété** (fiche immo) avec carousel si multiple
- 🔴 **Address + ville**
- 🔴 **Contact name** linkée
- 🟠 **Owner avatar**
- 🟠 **Days in current stage** badge
- 🟠 **Last activity** (date dernier event)
- 🟠 **Next task due** (icon + date)
- 🟠 **Priority indicator** (high/med/low)
- 🟠 **Custom fields opportunity** rendus
- 🟠 **Quick actions** (3 dots menu : edit, delete, move, duplicate)

#### Bulk actions pipeline
- 🟠 **Multi-select cards** (shift+click)
- 🟠 **Bulk move stage**
- 🟠 **Bulk assign owner**
- 🟠 **Bulk close as won/lost**

#### Lost reason
- 🔴 **Modal "Mark as lost"** avec dropdown reason : "Price too high", "Chose competitor", "Bad timing", "No response", etc.
- 🟠 **Lost reason analytics** (top reasons par mois)

#### Forecast
- 🟠 **Pipeline value by month** (close date prediction)
- 🟠 **Goal vs actual** (objectif mensuel)

#### Settings pipeline
- 🟠 **Notifications par stage** (envoyer email à owner quand opp entre dans 'meeting')
- 🟠 **Workflow auto-trigger par stage** (ex: stage='signed' → workflow review request)
- 🟠 **Stage SLA** (max N jours dans ce stage avant alerte)

**Effort enrichissement Pipeline : ~4 jours**

---

## 4. Page Conversations / Inbox — `src/pages/Inbox.tsx` (277 lignes)

### État actuel
- ✅ Vue 2 panneaux (liste threads + détail)
- ✅ Recherche
- ✅ Filtre par channel
- ✅ Compteur unread + threads
- ✅ Thread groupé par lead

### Ce que GHL Conversations a en plus :

#### Filters thread list
- 🔴 **Filter by status** (Open / Closed / Snoozed / Spam)
- 🔴 **Filter by assigned to**
- 🔴 **Filter by unread only** toggle
- 🔴 **Filter by starred**
- 🔴 **Filter by mentions me**
- 🟠 **Filter by tag conversation** (cf. C6)
- 🟠 **Filter by date range**
- 🟠 **Filter by has attachment**
- 🟠 **Filter by sentiment** (AI : positive/negative/neutral)
- 🟠 **Quick filter buttons** : "Mes assignations", "Non répondus", "Mentions"

#### Actions sur threads
- 🔴 **Mark read/unread**
- 🔴 **Star / unstar**
- 🔴 **Snooze** (revient demain 9h, lundi prochain, +7j) — cf. C7
- 🔴 **Assign to user** (avec round-robin auto possible)
- 🟠 **Archive / unarchive**
- 🟠 **Mark as spam** + train AI
- 🟠 **Add tag conversation**
- 🟠 **Move to folder**
- 🟠 **Bulk actions** sur multiple threads

#### Composer message (énorme manque)
- 🔴 **Tab "New conversation"** (composer un nouveau message à un nouveau contact)
- 🔴 **Channel selector** (Email/SMS/WhatsApp/Webchat)
- 🔴 **Use template** dropdown (insère template variables)
- 🔴 **Saved replies / snippets** (slash command `/`) — cf. C2
- 🔴 **Variables interpolation** (`{{lead.name}}` auto-rendered preview)
- 🟠 **Schedule send** (envoyer dans 1h, demain 9h)
- 🟠 **Add attachment** (besoin R2)
- 🟠 **AI suggested reply** (Claude Haiku contextuel)
- 🟠 **AI improve writing**
- 🟠 **Rich text editor** (bold, italic, link, list)
- 🟠 **Email signature auto** — cf. C3
- 🟠 **CC / BCC**
- 🟠 **Send as different user** (admin)
- 🟠 **Internal note vs message** toggle

#### Thread detail enrichi
- 🟠 **Contact summary card** sticky en haut
- 🟠 **Last 5 deals** mini-table
- 🟠 **Tasks liées** mini-list
- 🟠 **Followers list** + add/remove (cf. Q.2)
- 🟠 **Mentions inline** avec avatar
- 🟠 **Reactions emoji** sur messages (👍 ❤️ 😂)
- 🟠 **Edit/delete sent messages** (avec audit trail)
- 🟠 **Forward message** to another contact
- 🟠 **Quote reply** (cite le message original)
- 🟠 **Read receipts** (pour SMS/email avec pixel tracking)
- 🟠 **Typing indicator** (pour webchat live)

#### Settings inbox
- 🟠 **Notification sound** on new message
- 🟠 **Desktop push notifications**
- 🟠 **Out of office auto-reply**
- 🟠 **Welcome message webchat**
- 🟠 **Business hours** (auto-réponse hors heures)

**Effort enrichissement Inbox : ~6 jours**

---

## 5. Page Calendar — `src/pages/Calendar.tsx` (325 lignes)

### État actuel
- ✅ Vue Week + List
- ✅ Add appointment modal
- ✅ Status change (scheduled/confirmed/cancelled/completed/no_show)
- ✅ Stats (today count, upcoming, confirmed)

### Ce que GHL Calendar a en plus :

#### Vues
- 🔴 **Vue Day** (timeline horaire)
- 🔴 **Vue Month** (grid mensuel)
- 🟠 **Vue Year** (grid annuel)
- 🟠 **Vue Resource** (1 colonne par user/calendar)
- 🟠 **Vue Map** (RDV sur carte avec adresse)
- 🟠 **Vue Agenda** (next 7/30 days)

#### Filters calendar
- 🔴 **Filter by user/owner**
- 🔴 **Filter by appointment type**
- 🔴 **Filter by status**
- 🔴 **Filter by calendar** (si plusieurs calendars)
- 🟠 **Filter by location**
- 🟠 **Filter by lead source**

#### Drag & drop
- 🔴 **Drag to reschedule** (déplacer un RDV à une autre heure/jour)
- 🟠 **Resize to change duration**
- 🟠 **Multi-select drag**

#### Add appointment (enrichir le modal)
- 🔴 **Select calendar** (dropdown si plusieurs calendars)
- 🔴 **Select assignee** (dropdown des users)
- 🔴 **Select contact** (autocomplete)
- 🟠 **Recurring appointment** (daily/weekly/monthly)
- 🟠 **Reminder settings** (email 24h avant, SMS 1h avant)
- 🟠 **Buffer time** before/after (no booking 15 min avant/après)
- 🟠 **Conference link** (auto Zoom/Meet)
- 🟠 **Send invite to attendees**
- 🟠 **Book on behalf of** (admin pour un agent)

#### Sync calendars
- 🔴 **Google Calendar 2-way sync** (cf. C17, P2 a fait 1-way)
- 🟠 **Outlook Calendar sync** (Microsoft Graph)
- 🟠 **iCal feed export** (cf. T6)
- 🟠 **CalDAV server** (pour Apple Calendar)

#### Multi-calendars
- 🟠 **Multiple calendars per user**
- 🟠 **Calendar color customization**
- 🟠 **Show/hide calendars** (toggle)
- 🟠 **Shared calendars** (équipe)

#### Availability rules
- 🔴 **Working hours par user** (Lun-Ven 9-17h)
- 🟠 **Holidays QC** (auto-import jours fériés Quebec)
- 🟠 **Date overrides** (vacances spécifiques)
- 🟠 **Min notice** (no booking < 24h avance)

#### Detail RDV (modal click)
- 🔴 **Edit en place** (pas juste status change)
- 🟠 **Conference link clickable**
- 🟠 **Lead full info link**
- 🟠 **Attendees list** (multi-contacts)
- 🟠 **Notes attachées au RDV**
- 🟠 **Files attachés** (besoin R2)
- 🟠 **Send reminder now** button
- 🟠 **Reschedule with email auto** button
- 🟠 **Cancel with reason**

**Effort enrichissement Calendar : ~5 jours**

---

## 6. Page Workflows — `src/pages/Workflows.tsx` + `WorkflowDetail.tsx` + `WorkflowBuilder.tsx`

### État actuel
- ✅ Liste workflows avec stats (steps, enrollments, executions)
- ✅ Toggle actif/inactif
- ✅ Builder vertical : trigger + steps ordonnés
- ✅ 10 step types : send_email, send_sms, wait, condition, add_tag, remove_tag, change_status, assign, notify, webhook
- ✅ Engine cron (P0.4)

### Ce que GHL Workflows a en plus :

#### Liste workflows
- 🔴 **Folders / Categories** (cf. C21)
- 🔴 **Search workflows**
- 🔴 **Filter by trigger type**
- 🔴 **Filter by status** (Active/Draft/Paused)
- 🟠 **Sort by last edited / most enrollments**
- 🟠 **Duplicate workflow** action
- 🟠 **Workflow templates library** (10 templates pré-faits par niche)

#### Builder visuel (énorme manque)
- 🔴 **Canvas 2D drag & drop** (zoom/pan/mini-map) — cf. P3.7
- 🔴 **Conditional branches if/else** visuelles (deux paths qui se rejoignent ou pas)
- 🔴 **Goal step** : auto-exit workflow si lead atteint goal
- 🟠 **Comments / notes** sur le canvas (post-it)
- 🟠 **Color-code steps** par type
- 🟠 **Group steps** in containers
- 🟠 **Mini-map navigation**

#### Triggers manquants (5 actuels seulement)
- 🔴 **email_opened** (lead ouvre un email tracké)
- 🔴 **link_clicked** (trigger link cliqué) — cf. P4.5
- 🔴 **form_submitted** (form spécifique soumis) — déjà typé mais pas configuré
- 🔴 **appointment_booked** (RDV créé)
- 🔴 **appointment_cancelled / no_show**
- 🔴 **payment_received** (post Stripe)
- 🔴 **opportunity_status_changed**
- 🔴 **note_added**
- 🔴 **task_completed**
- 🔴 **review_received** (5⭐ ou < 5⭐)
- 🟠 **birthday_today** (anniversaire contact)
- 🟠 **anniversary_signup** (1 an depuis création)
- 🟠 **inactivity_threshold** (no activity > N jours)
- 🟠 **score_changed** (en plus de score_threshold)
- 🟠 **custom_field_changed**
- 🟠 **manual** (déclencher manuellement depuis contact)
- 🟠 **call_received / call_missed**

#### Actions / Steps manquants (10 actuels)
- 🔴 **send_voicemail_drop** (post P4.1 voice)
- 🔴 **send_review_request** (auto)
- 🔴 **create_task** (créer une task pour user)
- 🔴 **create_appointment** (créer RDV auto)
- 🔴 **create_opportunity** (ajouter au pipeline)
- 🔴 **update_opportunity** (changer stage opp)
- 🟠 **update_custom_field**
- 🟠 **add_to_smart_list**
- 🟠 **remove_from_smart_list**
- 🟠 **send_internal_email** (à user, pas au lead)
- 🟠 **send_slack_notification** (cf. T10)
- 🟠 **send_to_facebook_audience** (custom audience for retargeting)
- 🟠 **send_to_google_ads_audience**
- 🟠 **trigger_another_workflow**
- 🟠 **end_other_workflow** (arrêter un workflow concurrent)
- 🟠 **AI action** (call Claude/GPT avec prompt + use response)
- 🟠 **HTTP request out** (déjà partiel via webhook step)
- 🟠 **Math operation** (incrémenter score, calculer commission)
- 🟠 **DateTime calc** (set custom field = now + 30 days)

#### Wait conditions
- 🔴 **Wait for event** (wait until email opened, wait until appointment confirmed)
- 🔴 **Wait until specific date** (custom field date)
- 🔴 **Wait until time of day** (envoyer demain 9h dans la timezone du lead)
- 🟠 **Wait until day of week** (lundi prochain)
- 🟠 **Wait business hours only** (skip weekends)

#### Condition / Branching
- 🔴 **Multi-condition** (IF tag=hot AND score>70)
- 🔴 **Multiple branches** (switch case sur source)
- 🟠 **Compare custom fields** entre eux
- 🟠 **Date conditions** (if dateOfBirth between X and Y)
- 🟠 **Math conditions** (deal_value > 500000)

#### Configuration workflow
- 🟠 **Re-enrollment rules** : un lead peut-il être enrollé 2x ?
- 🟠 **Stop on weekends** (pause workflow le samedi/dimanche)
- 🟠 **Stop on conversation reply** (si lead répond, stop relances)
- 🟠 **Stop on tag** (si tag "désinscrit" ajouté, stop)
- 🟠 **Quiet hours** (pas de SMS entre 22h-8h)
- 🟠 **Time zone respect** (utilise timezone du lead)

#### Test / debug
- 🔴 **Test run sur 1 lead** (dry run) — cf. P3.7
- 🟠 **Step-by-step debugger** (lance manuellement chaque step)
- 🟠 **Replay logs** (voir l'exécution d'un enrollment passé)

#### Analytics par workflow
- 🔴 **Enrollment over time** chart
- 🔴 **Step conversion rates** (drop-off par step)
- 🔴 **Email open/click rates** par step
- 🟠 **Revenue attributed** (deals fermés via ce workflow)
- 🟠 **Time saved estimation**

#### Versioning
- 🟠 **Save as draft** without publishing
- 🟠 **Version history** (rollback)
- 🟠 **Compare versions**

**Effort enrichissement Workflows : ~10 jours (gros morceau)**

---

## 7. Page Templates — `src/pages/Templates.tsx` (340 lignes)

### État actuel
- ✅ CRUD email templates
- ✅ Categories (welcome, followup, reminder, notification, marketing, general)
- ✅ Variables JSON

### Ce que GHL Templates a en plus :

#### Email templates
- 🔴 **Drag & drop builder visuel** (cf. P4.7) — actuellement HTML brut
- 🔴 **Live preview desktop / mobile** split view
- 🔴 **Send test email** to my address
- 🔴 **Variables auto-suggested** (autocomplete `{{` puis liste)
- 🟠 **Folders / categories drag&drop**
- 🟠 **Template duplication**
- 🟠 **Template version history**
- 🟠 **Spam score check** (Mail-Tester API)
- 🟠 **Subject line A/B test**
- 🟠 **Pre-header text**
- 🟠 **Reply-to override**
- 🟠 **Email scheduling rules** (don't send weekends)

#### SMS templates
- 🔴 **Onglet SMS templates séparé** (actuellement email only)
- 🔴 **Character count** (limite 160 chars / 1000 pour MMS)
- 🔴 **Variables `{{}}`** auto
- 🟠 **MMS attachment**
- 🟠 **Trigger links insertion** (raccourcir + tracker)
- 🟠 **Opt-out auto-injecté** (CASL)

#### Voice templates (post P4.1)
- 🟠 **Voicemail drops library** (audio MP3 uploadés)
- 🟠 **TTS templates** (text-to-speech with variables)

#### Library partagée
- 🟠 **Marketplace templates** (templates shared across sub-accounts)
- 🟠 **Templates pré-faits par niche** (immo, hypothécaire, financier)
- 🟠 **Import / export templates** JSON

#### Snippets / Saved replies (cf. C2)
- 🔴 **Snippets section** : courtes phrases réutilisables dans inbox
- 🟠 **Snippets organisés par dossier**
- 🟠 **Trigger via `/`** dans inbox

**Effort enrichissement Templates : ~5 jours**

---

## 8. Page Tasks — `src/pages/Tasks.tsx` (294 lignes)

### État actuel
- ✅ CRUD tasks
- ✅ Filter status (todo/in_progress/done)
- ✅ Sort priority/due_date/status
- ✅ Vue list / kanban
- ✅ Liée à lead/client

### Ce que GHL Tasks a en plus :

#### Filtres
- 🔴 **Filter by assigned_to**
- 🔴 **Filter by due date** (overdue, today, this week, no due)
- 🔴 **Filter by lead** (autocomplete)
- 🔴 **Filter by tag**
- 🟠 **Filter by created_by**

#### Vues
- 🟠 **Vue Calendar** (tasks par due_date)
- 🟠 **Vue My Tasks** (filtre auto sur user logged)
- 🟠 **Vue Overdue** dédiée
- 🟠 **Vue Today** dédiée

#### Édition task
- 🔴 **Subtasks / checklist** (steps cochables dans une task)
- 🔴 **Task comments** (discussion entre users)
- 🟠 **Task attachments** (besoin R2)
- 🟠 **Mention users in description**
- 🟠 **Recurring task** (every Monday)
- 🟠 **Reminders** (email 1h avant due_date)
- 🟠 **Task templates** (boilerplate "Préparer dossier hypothécaire" avec checklist)

#### Bulk actions
- 🟠 **Bulk reassign**
- 🟠 **Bulk change due date**
- 🟠 **Bulk mark done**

#### Notifications
- 🔴 **Notification when task assigned to me** (cf. P1.4 notifications)
- 🔴 **Notification 1h before due**
- 🟠 **Daily digest** "Tasks for today"

#### Analytics tasks
- 🟠 **Tasks completed per user this month** chart
- 🟠 **Avg time to complete** par type
- 🟠 **Overdue rate** par user

**Effort enrichissement Tasks : ~3 jours**

---

## 9. Page Settings — `src/pages/Settings.tsx` (264 lignes)

### État actuel : minimal (à voir le code)

### Ce que GHL Settings a en plus (énorme manque)

**GHL Settings = ~30 sous-pages organisées en sections.** Ce qu'on doit avoir :

#### Profile & Account
- 🔴 **My Profile** (name, email, avatar, signature email, phone, timezone, language)
- 🔴 **Change password** (cf. P0.2 done) — déjà OK
- 🔴 **2FA setup** (cf. S1)
- 🔴 **Active sessions** (cf. S3)
- 🟠 **API tokens** (cf. T4)

#### Sub-account / Location
- 🔴 **Business info** (name, address, phone, website, logo, currency, timezone)
- 🔴 **Branding** (primary color, logo, favicon)
- 🔴 **AMF certificate** (différenciateur QC)
- 🔴 **OACIQ license**

#### Team / Users
- 🔴 **Users list** (invite, edit role, deactivate, delete)
- 🔴 **Roles & permissions** (cf. A4) — granular
- 🟠 **User groups / teams** (équipes pour assignation)
- 🟠 **Round-robin rules**

#### Integrations
- 🔴 **Connected apps** : Stripe, Google Calendar, Twilio, Resend, Meta, etc.
- 🔴 **OAuth connection flow** par integration

#### Custom Fields
- 🔴 **Custom fields builder** (cf. P3.4)
- 🔴 **Folders / groups**
- 🔴 **Field types editor**

#### Tags
- 🔴 **Tags management** (rename, delete, merge, color)
- 🟠 **Tag categories**

#### Pipelines
- 🔴 **Pipelines management** (CRUD pipelines + stages) — cf. C25
- 🔴 **Pipeline default** (lequel ouvert par défaut)

#### Email
- 🔴 **From email config** (verify domain Resend)
- 🔴 **Email signatures par user** (cf. C3)
- 🔴 **Email tracking** (open/click pixels) — cf. C15
- 🟠 **Spam suppressions list**
- 🟠 **Bounces management**

#### SMS / Phone
- 🔴 **Twilio connection**
- 🔴 **Phone number management** (per sub-account)
- 🔴 **A2P 10DLC compliance**
- 🟠 **SMS opt-out keywords** custom (STOP, ARRÊT, UNSUBSCRIBE)

#### Calendar
- 🔴 **Calendars management** (CRUD multiple calendars)
- 🔴 **Working hours**
- 🔴 **Holidays QC** (import auto)
- 🟠 **Booking page customization**

#### Workflows
- 🟠 **Workflow defaults** (quiet hours, weekends, etc.)
- 🟠 **Webhook secrets management**

#### Notifications
- 🔴 **Notification preferences** par user (cf. N2)
  - Email/SMS/push toggle
  - Quiet hours
  - Per-event-type opt-in/out

#### Lead capture
- 🔴 **Forms management** (CRUD forms — déjà partiel P2)
- 🔴 **Booking pages management**
- 🔴 **Webchat widget config**

#### Compliance / Privacy
- 🔴 **CASL settings** (footer auto, suppression list)
- 🔴 **Loi 25 settings** (consent banner, retention period)
- 🔴 **Data export** (cf. S7)
- 🔴 **Account deletion** (cf. S6)

#### Billing (post Stripe)
- 🟠 **Plan & subscription**
- 🟠 **Usage** (SMS sent, emails sent, storage)
- 🟠 **Invoices history**
- 🟠 **Payment method**

#### White-label (agency)
- 🔴 **Custom domain** (CNAME setup) — cf. A12
- 🔴 **Email sender domain** (cf. A13)
- 🟠 **Mobile app branding** (futur)

#### Snapshots (agency)
- 🟠 **Snapshots library** (clone setups entre sub-accounts) — cf. P2 done partial

#### Audit log
- 🟠 **Audit log viewer** (cf. A5) — table existe, UI manque

#### Developer / API
- 🟠 **API documentation link**
- 🟠 **Webhooks OUT registry** (cf. T5)
- 🟠 **Custom scripts** (HTML embeds, GTM)

**Effort enrichissement Settings : ~10 jours (TRÈS gros — c'est le centre nerveux)**

---

## 10. Page Reports — `src/pages/Reports.tsx` (347 lignes)

### État actuel
- ✅ 4 onglets : funnel, sources, performance, trends
- ✅ Charts Recharts
- ✅ Période 30d/90d/12m

### Ce que GHL Reports a en plus :

#### Reports manquants (au-delà des 4 onglets)
- 🔴 **Sales report** : revenue, deals won/lost, pipeline value
- 🔴 **Agent performance** report (cf. P4.17) : leaderboard, deals/agent, calls/agent
- 🔴 **Source attribution** report : ROI par source/campagne
- 🔴 **Conversion funnel** détaillé avec drop-off rates
- 🟠 **Activity report** : calls, SMS, emails par period
- 🟠 **Workflow report** : enrollments, completions, conversion par workflow
- 🟠 **Email report** : sent, opened, clicked, bounced, unsubscribed
- 🟠 **SMS report** : sent, delivered, replied, opt-outs
- 🟠 **Calendar report** : booked, confirmed, no-show, completion rate
- 🟠 **Forms report** : submissions, conversion rate, abandon rate
- 🟠 **Reviews report** : average rating, review count, response rate
- 🟠 **Tasks report** : completion rate, avg time to complete

#### Customization
- 🟠 **Custom reports builder** (drag widgets)
- 🟠 **Save report as template**
- 🟠 **Schedule report email** (cf. C30)
- 🟠 **Export PDF** (cf. C29)
- 🟠 **Compare two periods** (this month vs last month)

#### Filtres globaux reports
- 🔴 **Filter by user/agent**
- 🔴 **Filter by sub-account** (admin)
- 🔴 **Filter by date custom**
- 🟠 **Filter by source**
- 🟠 **Filter by tag**

**Effort enrichissement Reports : ~5 jours**

---

## 11. Pages restantes — résumé

| Page | LOC | Profondeur actuelle | Effort enrichissement |
|---|---|---|---|
| Clients.tsx | 220 | Liste basique CRUD | 2j (filters, bulk, view modes, sub-account switcher A2) |
| ClientLeads.tsx | 149 | Sous-liste leads | 1j (réutilise enrichissements Leads) |
| Integrations.tsx | 290 | Statique (UI seule) | 5j (vraies OAuth flows par intégration) |
| Login.tsx | 102 | Form basique | 1j (forgot password A7, signup A6, OAuth A9) |
| ChangePassword.tsx | new | Form simple | 0.5j (validation forte, indicateur strength) |
| WorkflowDetail.tsx | 265 | Détail + enrollments | inclus dans Workflows §6 |
| WorkflowBuilder.tsx | 362 | Vertical layout | inclus dans Workflows §6 (canvas) |
| **TOTAL pages restantes** | — | — | **~10j** |

---

## 12. Récap effort total enrichissement

| Section | Effort |
|---|---|
| 1. Dashboard | 5j |
| 2. Leads + LeadDetail | 7j |
| 3. Pipeline | 4j |
| 4. Inbox | 6j |
| 5. Calendar | 5j |
| 6. Workflows (gros) | 10j |
| 7. Templates | 5j |
| 8. Tasks | 3j |
| 9. Settings (TRÈS gros) | 10j |
| 10. Reports | 5j |
| 11. Autres pages | 10j |
| **TOTAL ENRICHISSEMENT** | **~70 jours** |

**~14 semaines à temps plein, ~3.5 mois à 80%.**

---

## 13. Articulation avec les autres docs

Ce doc est **orthogonal** aux autres :

| Doc | Scope |
|---|---|
| `ANTIGRAVITY-TODO.md` | P0+P1+P2 (architecture + features critiques) ✅ done |
| `ANTIGRAVITY-PHASE3-CATCHUP.md` | P3 (compliance, docs, AI, refactor) — partial |
| `ANTIGRAVITY-GHL-INVENTORY.md` | P4 (20 modules GHL manquants comme nouvelles pages) |
| `ANTIGRAVITY-GHL-COMPLETENESS.md` | Vue d'ensemble "fermer GHL" (~91j PC) |
| `ANTIGRAVITY-DEPTH-AUDIT.md` (ce doc) | **Enrichir les pages existantes** (~70j) |

**Question stratégique :** faut-il faire COMPLETENESS (91j) puis DEPTH (70j) = 161j total ?

**OU** mixer intelligemment :
- Sprint type "Vertical slice" : prendre 1 module (ex: Leads) et le pousser à 100% (page existante enrichie + features manquantes liées) avant de passer au suivant
- C'est ce que GHL appelle "Module ownership" en interne

---

## 14. Recommandation finale ordering

**Si Rochdi veut vraiment fermer GHL avec PC complet :**

### Sprint 1 — Foundations (déjà décidé) — 25j
Cf. `ANTIGRAVITY-GHL-COMPLETENESS.md` §14.

### Sprint 2 — Vertical slice : Module Contacts/Leads complet — 15j
- Migration M1+M3 from GHL (3j)
- Enrichissement Leads + LeadDetail (7j) — ce doc §2
- Custom Fields UI (P3.4 — déjà budgété 2j)
- Smart Lists (P3.4 — déjà budgété)
- Q.4 Multi-score profiles (1j)
- Bulk actions enrichies (2j)

### Sprint 3 — Vertical slice : Module Conversations complet — 14j
- P4.2 Webchat live (3j) — déjà budgété
- P4.9 FB Messenger + IG DM (3j) — déjà budgété
- Migration M2 from GHL conversations (2j)
- Enrichissement Inbox (6j) — ce doc §4

### Sprint 4 — Vertical slice : Module Pipeline + Workflows — 16j
- Multi-pipelines UI (P1.8 + C25) — 1j
- Enrichissement Pipeline (4j) — ce doc §3
- Enrichissement Workflows (10j) — ce doc §6
- Migration M4+M7 (4j)

### Sprint 5 — Vertical slice : Module Calendar + Tasks — 9j
- Enrichissement Calendar (5j) — ce doc §5
- Enrichissement Tasks (3j) — ce doc §8
- Migration M5 (1j)

### Sprint 6 — Settings + Reports + admin — 17j
- Enrichissement Settings (10j) — ce doc §9
- Enrichissement Reports (5j) — ce doc §10
- Agency features critiques A1+A2+A3 (4j)

### Sprint 7 — Templates + Forms + integrations — 12j
- Enrichissement Templates (5j) — ce doc §7
- P4.7 Email builder visuel (5j)
- API publique T4 (2j)

### Sprint 8 — Mobile responsive + PWA — 6j
- O13 mobile responsive complet (2j)
- O14 PWA (0.3j)
- Audit + fix (4j)

### Sprint 9 — Différenciateurs Intralys — 12j
- AMF/OACIQ disclaimers + certificate (4j)
- D5 Centris sync (3j)
- D8 PDF mandat OACIQ (2j)
- D11 Dashboard métier (1j)
- D12 Signature 1-clic SMS (2j)

**TOTAL CHEMIN COMPLET PC : Sprint 1 (25j) + Sprint 2-9 (101j) = ~126 jours.**

**~25 semaines à temps plein, ~6 mois à 80%.**

À la fin : **PC = 100% remplaçant GHL**, prêt pour app mobile.

---

## 15. Decision matrix

| Stratégie | Effort | Quand mobile ? | Risque |
|---|---|---|---|
| MVP only (P4.3+P4.6+P4.2 = 11j) | 11j | Tout de suite après | 🔴 GHL reste outil principal, on n'arrive pas à fermer |
| Sprint 1 Foundations (25j) | 25j | Après Sprint 1 | 🟠 Migration possible mais friction UX énorme |
| Vertical slice 1 module (Sprint 2) | 40j | Après vertical slice | 🟡 1 module remplace GHL, autres restent |
| **Fermer GHL complet (Sprint 1-9)** | **126j** | **Après tout** | 🟢 **Zero friction migration, vrai SaaS prêt** |

**Ma recommandation : Sprint 1 + Sprint 2 (Module Leads vertical) = 40j.**

À la fin : Rochdi peut vraiment migrer Mathis Guimont end-to-end avec UX décente. Si ça marche bien → enchaîner Sprint 3-9 en parallèle des ventes.

---

## 16. Status tracker depth audit

| Section | Items à enrichir | Effort | Priorité |
|---|---|---|---|
| Dashboard | 25+ items | 5j | 🟠 |
| Leads + Detail | 50+ items | 7j | 🔴 (le + utilisé) |
| Pipeline | 25+ items | 4j | 🔴 |
| Inbox | 35+ items | 6j | 🔴 |
| Calendar | 25+ items | 5j | 🟠 |
| Workflows | 60+ items | 10j | 🔴 (différenciateur) |
| Templates | 20+ items | 5j | 🟠 |
| Tasks | 15+ items | 3j | 🟡 |
| Settings | 30+ sous-pages | 10j | 🔴 (centre nerveux) |
| Reports | 20+ items | 5j | 🟠 |
| Autres | — | 10j | 🟡 |

**~330 items à enrichir, ~70 jours total.**

---

_Document généré le 2026-05-10 par Claude Opus 4.7. Audit profondeur de l'existant — pas de nouvelles pages, juste enrichissement des sections actuelles à la profondeur GHL._
