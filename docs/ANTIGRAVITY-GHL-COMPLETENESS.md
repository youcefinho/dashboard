# ANTIGRAVITY-GHL-COMPLETENESS.md — Checklist finale "fermer GHL"

> Audit final 2026-05-10 par Claude Opus 4.7.
> **Mission :** lister TOUT ce qui manque pour que Rochdi puisse migrer ses 3+ sub-accounts depuis GHL vers son propre dashboard et fermer son compte agency GHL.
> Objectif : finir l'app PC à 100% avant l'app mobile. Ne rien laisser au hasard.

**Documents pré-requis lus :**
- `ANTIGRAVITY-TODO.md` (P0+P1+P2) — fait
- `ANTIGRAVITY-PHASE3-CATCHUP.md` (P3) — fait
- `ANTIGRAVITY-GHL-INVENTORY.md` (P4 + 6 quick wins, scope verrouillé) — fait

**Légende sévérité :**
- 🔴 **BLOCK MIGRATION** : sans ça, impossible de fermer GHL
- 🟠 **BLOCK VENTE** : sans ça, refus du client de migrer
- 🟡 **BLOCK PROD** : sans ça, ça crashe ou coûte cher en support
- 🟢 **NICE-TO-HAVE** : améliore l'expérience mais pas critique
- 💎 **DIFFÉRENCIATEUR** : on fait MIEUX que GHL = argument de vente

---

## 1. Features GHL critiques HORS des 40 modules permissions

Le tableau §0 du `GHL-INVENTORY.md` couvre les permissions visibles. Mais GHL a ~30 features supplémentaires "cachées" dans les sous-menus. Inventaire :

| # | Feature GHL | Sévérité | Effort | Description |
|---|---|---|---|---|
| C1 | **Tag automation rules** | 🟠 | 1j | Quand un tag est ajouté → déclenche workflow / change owner / etc. (trigger `tag_added` existe, mais pas l'UI builder de règles tag→action sans workflow) |
| C2 | **Saved replies / Snippets** | 🟠 | 0.5j | Bibliothèque de réponses rapides ("Bonjour, merci pour votre message...") accessible via `/` dans inbox |
| C3 | **Email signatures par user** | 🟠 | 0.5j | Chaque user a sa signature HTML auto-injectée dans tous ses emails |
| C4 | **Bulk SMS scheduling** | 🟠 | 1j | Programmer un SMS broadcast pour 9h demain (notre broadcast est immédiat) |
| C5 | **Conversation assignment rules** | 🟠 | 1j | Round-robin auto des conversations entrantes selon dispo agents |
| C6 | **Conversation tags** | 🟡 | 0.5j | Tags spécifiques aux conversations (différents des tags contact) — ex: "résolu", "réclamation" |
| C7 | **Snooze conversations** | 🟡 | 0.5j | Mettre une conversation en sommeil jusqu'à demain 9h (revient en haut de l'inbox) |
| C8 | **Quick filters dans inbox** | 🟡 | 0.5j | Boutons rapides : "Mes assignations", "Non lus", "Mentionnés", "Starred" |
| C9 | **Bulk delete contacts** | 🟡 | 0.5j | Sélection multi + delete (on a bulk actions P1.7 mais pas delete) |
| C10 | **Merge duplicate contacts** | 🟠 | 1.5j | Détection auto des doublons (email/phone fuzzy) + UI merge (choisir quels champs garder) |
| C11 | **Manual contact entry form** | 🔴 | 0.5j | UI formulaire pour ajouter un contact à la main dans le dashboard (on a webhook + import CSV mais pas UI manuel) |
| C12 | **Contact relationships** | 🟢 | 1j | Lier 2 contacts (couple, enfant/parent, conjoint) — utile en immo |
| C13 | **Contact timeline filters** | 🟡 | 0.5j | Filtrer la timeline par type d'event (emails seulement, calls seulement) |
| C14 | **Note attachments** | 🟠 | 1j | Joindre des fichiers aux notes internes (besoin R2 P4.3) |
| C15 | **Email open + click tracking** | 🟠 | 1j | Pixel tracking dans emails Resend + lien wrapper qui log les clics |
| C16 | **SMS link tracking** | 🟠 | 0.5j | Wrapper auto les liens dans SMS via trigger links (P4.5 dépend) |
| C17 | **Calendar sync 2-way** | 🟠 | 2j | Quand RDV créé dans Google Cal → apparaît dans dashboard ET inversement (P2 fait Google OAuth mais sync 1-way) |
| C18 | **Calendar availability rules** | 🟠 | 1j | Heures de bureau par calendar + jours fériés QC + buffer min entre RDV |
| C19 | **Booking page redirect post-RDV** | 🟡 | 0.5j | URL custom de redirect après booking (pour tracking conversion) |
| C20 | **Workflow drafts / unpublished** | 🟡 | 0.5j | Garder un workflow brouillon avant publication (actuellement is_active = 0 mais pas distingué visuellement) |
| C21 | **Workflow folder organization** | 🟢 | 0.5j | Folders pour grouper les workflows ("Onboarding", "Reactivation", "Sales") |
| C22 | **Workflow analytics dashboard** | 🟠 | 1.5j | Pour chaque workflow : enrolled, completed, dropped per step, conversion rate |
| C23 | **Lead form spam protection** | 🟡 | 0.5j | Honeypot + reCAPTCHA v3 (déjà en best practices mais à vérifier dans nos forms) |
| C24 | **Lead form embed customization** | 🟢 | 0.5j | Width, theme dark/light, colors via params URL |
| C25 | **Pipeline customization UI** | 🔴 | 1j | UI pour créer/modifier des pipelines + stages custom (P1.8 a la table mais pas l'UI) |
| C26 | **Opportunity custom fields** | 🟠 | 1j | Custom fields aussi sur opportunities, pas juste contacts (P3.4 doit couvrir) |
| C27 | **Opportunity activities** | 🟡 | 0.5j | Timeline d'events spécifiques à l'opportunity (pas juste au lead) |
| C28 | **Bulk import opportunities** | 🟢 | 0.5j | CSV import pour opportunities aussi (pas juste leads) |
| C29 | **Reports export PDF** | 🟠 | 1j | Reports actuels exportables en PDF (pour client à présenter) |
| C30 | **Reports scheduled emails** | 🟠 | 1j | Envoyer auto le rapport hebdo lundi 8h à l'agence + courtier |

**Total features cachées : ~22.5 jours de dev.**

---

## 2. Migration data depuis GHL existant 🔴

**Test ultime de fermeture GHL** : Rochdi doit pouvoir importer TOUTES ses données existantes depuis ses 3 sub-accounts GHL vers le clone, sans perte. Aujourd'hui, c'est impossible.

| # | Item à migrer | Sévérité | Effort | API GHL source |
|---|---|---|---|---|
| M1 | Contacts (avec custom fields, tags, attributions) | 🔴 | 2j | `GET /contacts` (paginate) + `GET /contacts/:id` |
| M2 | Conversations (tous les messages historiques) | 🔴 | 2j | `GET /conversations/search` + `GET /conversations/:id/messages` |
| M3 | Custom fields definitions | 🔴 | 1j | `GET /locations/:id/customFields` |
| M4 | Pipelines + stages + opportunities | 🔴 | 1j | `GET /opportunities/pipelines` + `GET /opportunities/search` |
| M5 | Calendars + appointments | 🔴 | 1j | `GET /calendars` + `GET /calendars/events` |
| M6 | Email templates | 🟠 | 0.5j | `GET /emails/builder` |
| M7 | Workflows + steps + enrollments actifs | 🔴 | 3j | `GET /workflows` (mapping vers notre format steps) |
| M8 | Tags hiérarchique | 🟠 | 0.5j | extraction depuis tous les contacts |
| M9 | Files / Documents uploadés | 🟠 | 1j | `GET /files` + transfert R2 |
| M10 | Notes internes sur contacts | 🟠 | 0.5j | `GET /contacts/:id/notes` |
| M11 | Tasks GHL | 🟠 | 0.5j | `GET /contacts/:id/tasks` |
| M12 | Forms & form submissions | 🟠 | 1j | `GET /forms` |
| M13 | Booking pages config | 🟠 | 0.5j | `GET /calendars` (settings) |
| M14 | Triggers & automations rules | 🟡 | 1j | `GET /triggers` (legacy GHL) |
| M15 | Settings location (logo, address, social) | 🟠 | 0.5j | `GET /locations/:id` (déjà dispo via MCP) |

**Total migration : ~15.5 jours.**

**Endpoint cible :** `POST /api/migrate/ghl` qui prend `{location_id, pit_token}` et lance un job background (Cloudflare Queues) qui pull tout depuis GHL et populate notre D1. Progress affiché dans `/settings/migrate-from-ghl`.

---

## 3. UX patterns GHL spécifiques manquants

GHL a une UX très spécifique que les courtiers connaissent par cœur. Sans ces patterns, friction = refus de migrer.

| # | Pattern UX GHL | Sévérité | Effort | Description |
|---|---|---|---|---|
| U1 | **Sidebar collapsible avec icônes seulement** | 🟡 | 0.5j | Réduit en 60px de large avec tooltips au hover |
| U2 | **Double sidebar (modules + sous-menu)** | 🟡 | 1j | Niveau 1 : modules. Niveau 2 : sous-pages du module sélectionné |
| U3 | **Breadcrumb partout** | 🟡 | 0.5j | "Conversations > John Doe > Email du 10 mai" |
| U4 | **Filtres persistants par user** | 🟠 | 1j | Quand tu reviens sur Leads, tes filtres précédents sont restaurés |
| U5 | **Recherche globale dans tout** | 🟠 | 1j | ⌘K (déjà fait) mais doit chercher contacts + conversations + tasks + workflows + tout |
| U6 | **Dropdown owner avec photos + statut online** | 🟢 | 0.5j | Voir qui est connecté en temps réel |
| U7 | **Drag&drop entre status pipeline** | 🟡 | déjà fait ✅ | — |
| U8 | **Inline edit partout** | 🟠 | 1.5j | Cliquer sur un champ contact = édition directe sans modal (on a partial sur LeadDetail) |
| U9 | **Hover preview cards** | 🟢 | 1j | Hover sur un nom de contact dans une liste = popup avec infos clés |
| U10 | **Modals stacked (multi-niveau)** | 🟡 | 0.5j | Ouvrir un contact dans une modal qui ouvre une autre modal pour son task |
| U11 | **Toast notifications bottom-right** | 🟡 | 0.5j | Pour confirmations actions ("Lead sauvegardé", "Email envoyé") |
| U12 | **Loading skeletons partout** | 🟡 | déjà fait ✅ | — |
| U13 | **Confirmation modals destructives** | 🟡 | 0.5j | "Vraiment supprimer 47 contacts ? Tape 'SUPPRIMER' pour confirmer" |
| U14 | **Undo après suppression** | 🟠 | 1j | Toast avec bouton "Annuler" pendant 10s après delete |
| U15 | **Date pickers FR avec presets** | 🟡 | 0.5j | "Aujourd'hui", "Hier", "Cette semaine", "Ce mois", "30 derniers jours" |
| U16 | **Tableaux avec colonnes draggables + cachables** | 🟢 | 1.5j | User customise les colonnes affichées dans Leads/Tasks |
| U17 | **Empty states illustrés** | 🟡 | 0.5j | Quand 0 leads, illustration + CTA "Créer ton premier lead" |
| U18 | **Onboarding tour interactif** | 🟢 | 1j | Intro.js : 7 étapes guide nouveau user |
| U19 | **Keyboard shortcuts** | 🟢 | 1j | `j/k` navigation, `e` edit, `s` send, `?` help (style Gmail) |
| U20 | **Bulk select avec shift+click range** | 🟡 | 0.5j | Sélection rangée comme dans Gmail |

**Total UX patterns : ~14 jours.**

---

## 4. Agency-level features (multi-tenant production)

Pour vraiment vendre du SaaS comme GHL agency, il faut ces features admin :

| # | Feature | Sévérité | Effort | Description |
|---|---|---|---|---|
| A1 | **Sub-account creation wizard** | 🔴 | 1.5j | UI pour créer un nouveau sub-account avec snapshot par défaut |
| A2 | **Sub-account switcher** | 🔴 | 1j | Dropdown top-bar pour basculer entre sub-accounts (admin agency) |
| A3 | **User management par sub-account** | 🔴 | 1.5j | Inviter/désactiver/changer rôle des users dans chaque sub-account |
| A4 | **Permissions custom roles** | 🟠 | 2j | Au-delà de admin/broker : créer des rôles custom (Manager, Agent, Viewer, Custom) |
| A5 | **Audit log par user / par sub-account** | 🟠 | 1j | Voir qui a fait quoi (déjà table `audit_log` mais pas d'UI) |
| A6 | **Email invitation user** | 🔴 | 1j | Inviter un user par email avec lien d'activation (au lieu de créer le compte direct) |
| A7 | **Self-serve password reset** | 🔴 | 0.5j | "Mot de passe oublié" → email avec lien token (sécurisé) |
| A8 | **Email vérification** | 🟠 | 0.5j | Email confirmation à la création compte |
| A9 | **Login with Google / Microsoft** | 🟢 | 2j | OAuth providers pour login (Memberstack-style) |
| A10 | **Account billing self-serve** | 🟠 | 2j | Page billing : voir consommation (SMS/email/storage) + facture courante (besoin Stripe quand activé) |
| A11 | **Usage quotas par sub-account** | 🟠 | 1j | Limite SMS/mois, contacts max, users max — selon plan |
| A12 | **White-label total custom domain** | 🟠 | 1.5j | Le client se logge sur `crm.mathisguimont.com` au lieu de intralys.com (CNAME + Cloudflare for SaaS) |
| A13 | **White-label email sender** | 🟠 | 1j | Emails partent de `noreply@mathisguimont.com` au lieu de intralys |
| A14 | **Logo & couleurs par sub-account** | 🟠 | 1j | Branding custom dans le dashboard (déjà partiel en P2) |
| A15 | **Mobile app branding (futur)** | 🟢 | 5j+ | App store dédiée par agency (React Native config flavors) |

**Total agency : ~22 jours.**

---

## 5. Compliance / sécurité prod (au-delà Loi 25)

| # | Feature | Sévérité | Effort | Description |
|---|---|---|---|---|
| S1 | **2FA TOTP enforcement par user** | 🔴 | 0.5j | Migration P5 a la table mais pas l'enforcement UI (admin peut forcer 2FA) |
| S2 | **2FA backup codes** | 🟠 | 0.5j | 10 codes one-shot pour récupérer accès si Google Authenticator perdu |
| S3 | **Session management** | 🟠 | 0.5j | Liste des sessions actives + bouton "Fermer cette session" |
| S4 | **IP allowlist par sub-account** | 🟢 | 1j | Restriction par IP pour clients sécurité élevée |
| S5 | **Data residency** | 🟢 | 0j | Cloudflare D1 est multi-region — déjà conforme QC (Toronto) |
| S6 | **Right to be forgotten (Loi 25)** | 🔴 | 1j | Endpoint + UI `/settings/delete-account` qui hard-delete TOUT |
| S7 | **Data export (RGPD/Loi 25)** | 🔴 | 1j | User peut télécharger toutes ses données en JSON/CSV |
| S8 | **Audit log immuable** | 🟠 | 0.5j | Append-only WAL pour `audit_log` table (pas de delete) |
| S9 | **Encryption at rest** | 🟢 | 0j | D1 chiffre déjà au repos par défaut |
| S10 | **Encryption pour custom fields sensibles** | 🟠 | 1j | SIN/SSN/numéros bancaires chiffrés application-level (AES-GCM) |
| S11 | **Rate limiting per-tenant** | 🟠 | 1j | API rate limit par sub-account (pas juste IP global) |
| S12 | **CSP / HSTS / security headers** | 🟡 | 0.5j | Headers stricts dans tous les responses |
| S13 | **Pen test / security audit external** | 🟠 | externe | Faire auditer par un tiers avant 10 clients |
| S14 | **SOC 2 / ISO 27001 prep** | 🟢 | 30j+ | Pour vendre à des grosses agences |
| S15 | **Privacy policy + Terms of Service generators** | 🟠 | 0.5j | Pages auto-générées avec placeholder client |

**Total compliance : ~9 jours.**

---

## 6. Infra production (monitoring, backup, observability)

| # | Feature | Sévérité | Effort | Description |
|---|---|---|---|---|
| I1 | **Backup automatique D1 → R2 quotidien** | 🔴 | 0.5j | Cron daily : `wrangler d1 export` → upload R2. Rotation 30j |
| I2 | **Restore from backup** | 🔴 | 0.5j | Procédure documentée + endpoint `/admin/restore` |
| I3 | **Status page publique** | 🟠 | 0.5j | `status.intralys.com` avec uptime + incidents |
| I4 | **Error tracking (Sentry / Logflare)** | 🟠 | 0.5j | Capturer les erreurs Worker non gérées |
| I5 | **Performance monitoring** | 🟠 | 0.5j | Dashboard latence par endpoint (Cloudflare Analytics) |
| I6 | **Alertes critiques** | 🟡 | 0.5j | Email Rochdi si error rate > 1% / latence > 1s / D1 quota > 80% |
| I7 | **Health check endpoint** | 🟡 | 0.2j | `GET /api/health` qui check DB + R2 + Resend connectivity |
| I8 | **Feature flags system** | 🟢 | 1j | Activer/désactiver features par sub-account sans deploy |
| I9 | **Database migration tracker** | 🟠 | 0.5j | Table `_migrations (filename, applied_at)` pour ne pas réappliquer |
| I10 | **Soft delete + corbeille 30j** | 🔴 | 1j | Déjà mentionné en P3.10, à confirmer fait |
| I11 | **Dead letter queue pour cron failures** | 🟠 | 0.5j | Si workflow step fail 3x → DLQ + alerte |
| I12 | **Logs queryable** | 🟢 | 0.5j | Cloudflare Logs Push vers R2 ou Datadog |
| I13 | **Metrics business (DAU, MAU, retention)** | 🟢 | 1j | Dashboard interne Rochdi pour suivre santé business |

**Total infra : ~7 jours.**

---

## 7. Self-serve, onboarding, support utilisateur

Sans ça, Rochdi passe son temps en hotline support.

| # | Feature | Sévérité | Effort | Description |
|---|---|---|---|---|
| O1 | **Welcome email post-signup** | 🟠 | 0.5j | Bienvenue + lien onboarding wizard |
| O2 | **Onboarding wizard 8 étapes** | 🟠 | 2j | Logo, palette, calendrier, Twilio, FB, Google Reviews, premier contact, premier workflow (P4.19 Launchpad) |
| O3 | **In-app product tour** | 🟢 | 1j | Intro.js : tour 7 étapes interface |
| O4 | **Help center embedded** | 🟠 | 1.5j | Docs intégrées : `/help` avec recherche + FAQ + tutoriels |
| O5 | **Tooltip help icons partout** | 🟢 | 0.5j | `(?)` à côté des labels avec explication courte |
| O6 | **Video tutorials links** | 🟠 | 0.5j | Loom embeds dans les pages clés (créer un workflow, etc.) |
| O7 | **Live chat support intégré** | 🟢 | 0.5j | Notre propre webchat P4.2 utilisé sur dashboard intralys.com |
| O8 | **Changelog page** | 🟢 | 0.3j | `/changelog` avec dernières features livrées (genre Linear) |
| O9 | **Roadmap publique** | 🟢 | 0.3j | `/roadmap` pour montrer quoi vient (genre Canny) |
| O10 | **User feedback widget** | 🟠 | 0.5j | Bouton "Feedback" qui ouvre modal envoyée à Rochdi |
| O11 | **NPS survey périodique** | 🟢 | 0.5j | Tous les 90j, modal "Tu nous recommanderais ?" |
| O12 | **Email digest hebdo** | 🟠 | 0.5j | Récap activité semaine envoyé chaque lundi 8h |
| O13 | **Mobile responsive 100%** | 🔴 | 2j | Audit chaque page sur mobile (PWA avant l'app native) |
| O14 | **PWA installable** | 🟠 | 0.3j | Manifest.json + service worker pour install sur mobile/desktop |
| O15 | **Offline mode partial** | 🟡 | 2j | Cache lecture leads/contacts/messages récents en IndexedDB |

**Total self-serve : ~13 jours.**

---

## 8. Intégrations tierces critiques

Sans ça, le client doit garder GHL pour ses intégrations.

| # | Intégration | Sévérité | Effort | Description |
|---|---|---|---|---|
| T1 | **Zapier integration** | 🔴 | 3j | App Zapier publique avec triggers + actions |
| T2 | **Make.com integration** | 🟠 | 2j | App Make (similaire Zapier) |
| T3 | **n8n integration** | 🟢 | 1j | Custom node n8n pour les pros tech |
| T4 | **API publique OpenAPI** | 🔴 | 2j | Bearer key par client + doc Scalar UI sur `/api/docs` |
| T5 | **Webhooks OUT registry** | 🔴 | 1.5j | Client peut s'abonner à des events (lead.created, deal.won, etc.) |
| T6 | **iCal feed** | 🟠 | 0.5j | Lien `.ics` pour s'abonner au calendrier dans Apple/Outlook |
| T7 | **Centris.ca integration** | 💎 | 3j | DIFFÉRENCIATEUR QC : sync auto fiches propriétés Centris (compte data) |
| T8 | **Banque Royale / Desjardins API** | 💎 | externe | DIFFÉRENCIATEUR QC : pré-qualification hypothécaire en 1 clic |
| T9 | **Notarius / DocuSign / HelloSign** | 🟠 | 1.5j | Si Rochdi ne veut pas faire e-sign maison (P4.3), use these |
| T10 | **Slack notifications** | 🟢 | 0.5j | Webhook Slack pour notifs équipe |
| T11 | **Microsoft Teams integration** | 🟢 | 0.5j | Idem Slack |
| T12 | **Google Drive / Dropbox sync** | 🟢 | 1j | Stockage des documents alternative à R2 |
| T13 | **HubSpot import** | 🟢 | 1j | Permet d'importer depuis HubSpot (autre concurrent) |
| T14 | **Pipedrive import** | 🟢 | 1j | Idem |
| T15 | **CSV bulk import (any field mapping)** | 🟠 | déjà fait ✅ | — |

**Total intégrations : ~17 jours (sans Centris/Banques qui sont externes).**

---

## 9. Notifications & accessibilité

| # | Feature | Sévérité | Effort | Description |
|---|---|---|---|---|
| N1 | **Push notifications navigateur (web)** | 🟠 | 1j | Notifications desktop via Web Push API |
| N2 | **Per-user notification preferences** | 🟠 | 1j | Quiet hours, channels (email/sms/push), types d'events |
| N3 | **Digest mode** | 🟢 | 0.5j | Au lieu de notif par event, regroupé toutes les heures |
| N4 | **Notification center (cloche)** | 🟡 | déjà fait ✅ | — |
| N5 | **WCAG 2.1 AA compliance** | 🟠 | 2j | Audit + fix : contraste, ARIA labels, keyboard nav, focus visible |
| N6 | **Skip-to-content link** | 🟡 | 0.2j | Pour navigation clavier (skill `intralys-skip-content-a11y`) |
| N7 | **Screen reader testing** | 🟢 | 1j | Tester avec NVDA/VoiceOver |

**Total notif/a11y : ~5.7 jours.**

---

## 10. Performance & SLA prod

| # | Feature | Sévérité | Effort | Description |
|---|---|---|---|---|
| P1 | **Bundle splitting agressif** | 🟡 | déjà fait ✅ (-29% en P2) | — |
| P2 | **Image optimization** | 🟡 | 0.5j | Logos/photos via Cloudflare Images (resize on-the-fly) |
| P3 | **CDN cache headers** | 🟡 | 0.3j | Static assets cache 1 an immutable |
| P4 | **Database query optimization** | 🟠 | 1j | EXPLAIN sur queries lentes + index manquants |
| P5 | **Pagination cursor partout** | 🟠 | partial | Audit qu'aucun endpoint ne renvoie 500+ rows |
| P6 | **Workers KV cache** | 🟢 | 1j | Cache des reads fréquents (custom_fields_defs, pipelines, templates) |
| P7 | **Streaming responses** | 🟢 | 1j | Pour gros exports CSV/PDF |
| P8 | **Time-to-interactive < 2s** | 🟠 | 1j | Audit Lighthouse + fix |

**Total perf : ~4.8 jours.**

---

## 11. Différenciateurs Intralys 💎 (faire MIEUX que GHL)

Pour vendre, il faut pas juste cloner — il faut quelques killer features qui font dire "wow, GHL n'a pas ça".

| # | Différenciateur | Sévérité | Effort | Pourquoi GHL ne le fait pas / fait mal |
|---|---|---|---|---|
| D1 | **AI lead scoring auto contextualisé immo QC** | 💎 | 1j | GHL a bot générique, pas de modèle fine-tuné immo QC |
| D2 | **AI workflow assistant en français québécois** | 💎 | 2j | GHL est anglais-only |
| D3 | **AMF compliance auto (disclaimers + certificate)** | 💎 | 2j | Personne d'autre fait ça (cf. skill `intralys-amf-disclaimer`) |
| D4 | **OACIQ courtier immo compliance** | 💎 | 1j | Idem AMF, tout pareil pour OACIQ |
| D5 | **Centris.ca sync** | 💎 | 3j | API publique Centris + display fiches dans dashboard |
| D6 | **Calculator hypothécaire intégré** | 💎 | 0.5j | Réutiliser composant skill `intralys-outils-immobiliers-qc` |
| D7 | **Lexique éditorial automatique** | 💎 | 1j | AutoGlossary skill (termes techniques expliqués au survol) |
| D8 | **PDF mandat de courtage pre-rempli QC** | 💎 | 2j | Templates conformes OACIQ avec variables auto-remplies |
| D9 | **Multi-touch attribution avec session reconciliation** | 💎 | 2j | Reconcile avant/après login (anonymous → identified) |
| D10 | **Carte interactive des leads (Mapbox)** | 💎 | 1.5j | Voir les leads sur une carte du QC avec heatmap densité |
| D11 | **Dashboard métier (vs dashboard générique GHL)** | 💎 | 1j | KPIs spécifiques courtier : ratio acheteur/vendeur, propriétés sous mandat, deals en notaire |
| D12 | **Signature mandat 1-clic depuis SMS** | 💎 | 1j | Flow ultra-court : SMS → tap → sign → done (mobile-first) |
| D13 | **Mode "courtier en visite"** | 💎 | 2j | Vue mobile spéciale pendant visite propriété : check-list, photos, notes vocales auto-transcrites |
| D14 | **Intégration pré-qualification hypothécaire** | 💎 | externe | API Banque Royale / Desjardins (besoin partnerships) |
| D15 | **Génération automatique de matériel marketing** | 💎 | 2j | À partir d'une fiche propriété → flyer PDF + post FB + email blast en 1 clic |

**Total différenciateurs : ~22 jours (qui font la valeur Intralys).**

---

## 12. Mobile responsive (PWA) — préalable à l'app native

Avant React Native / Capacitor, le dashboard PC doit être 100% responsive mobile. Sans ça, l'app mobile sera juste un hack.

| # | Item | Sévérité | Effort |
|---|---|---|---|
| R1 | Audit chaque page sur iPhone SE (375px) | 🔴 | 1j |
| R2 | Sidebar mobile : drawer overlay (déjà partiel) | 🟡 | 0.5j |
| R3 | Tableaux → cards stack sur mobile | 🟠 | 1j |
| R4 | Pipeline kanban → swiper horizontal sur mobile | 🟠 | 0.5j |
| R5 | Workflow builder → version simplifiée mobile (read-only) | 🟢 | 0.5j |
| R6 | Touch interactions partout (swipe to delete, long-press menu) | 🟠 | 1j |
| R7 | Bottom nav bar mobile | 🟡 | 0.5j |
| R8 | PWA manifest + service worker basique | 🟠 | 0.3j |
| R9 | Test sur 5 devices réels (iPhone, iPad, Android, tablette) | 🔴 | 0.5j |

**Total responsive : ~5.3 jours.**

---

## 13. Récap total — TOUT ce qui reste pour fermer GHL

### Bloquants migration (🔴) — sans ça, impossible de fermer GHL
- Features cachées : C11 (manual entry), C25 (pipeline UI)
- Migration data : M1, M2, M3, M4, M5, M7 = ~10j
- Agency : A1, A2, A3, A6, A7
- Infra : I1, I2, I10
- Intégrations : T1, T4, T5
- Self-serve : O13 (responsive)
- Compliance : S1, S6, S7
- Différenciateurs : aucun (mais sans D3+D4 AMF/OACIQ, pas vendable QC)

**Total 🔴 BLOCK MIGRATION : ~30 jours**

### Bloquants vente (🟠) — sans ça, refus client
- Features cachées : C1, C2, C3, C4, C5, C10, C14, C15, C16, C17, C18, C22, C26, C29, C30
- Migration : M6, M8, M9, M10, M11, M12, M13, M15
- UX : U4, U5, U8, U14
- Agency : A4, A5, A8, A10, A11, A12, A13, A14
- Compliance : S2, S3, S10, S11, S15
- Infra : I3, I4, I5, I9, I11
- Self-serve : O1, O2, O4, O6, O10, O12, O14
- Intégrations : T2, T6, T9
- Notif : N1, N2, N5
- Perf : P4, P5, P8
- Différenciateurs : D1, D2, D3, D4, D5, D6, D7, D8, D9

**Total 🟠 BLOCK VENTE : ~50 jours**

### Bloquants prod (🟡) — sans ça, ça casse
- Features cachées : C6, C7, C8, C9, C13, C19, C20, C23
- UX : U1, U3, U10, U11, U13, U15, U17, U20
- Migration : M14
- Compliance : S8, S12
- Infra : I6, I7
- Notif : N6
- Perf : P2, P3
- Responsive : R1-R9 (déjà comptés en self-serve)

**Total 🟡 BLOCK PROD : ~15 jours**

### Nice-to-have (🟢) — peut attendre Phase 6+
~70 jours additionnels (everything else)

---

## 14. Roadmap finale "Fermer GHL avant mobile"

### Sprint final 1 — Foundations (~25j)
**Objectif : Rochdi peut migrer Mathis Guimont depuis GHL**
- P3.0 Refactor worker (3j)
- Q.1, Q.5 quick wins (1.5j)
- MVP Phase 4 actuel : P4.3 + P4.6 + P4.2 (11j) — déjà décidé
- Migration data essentielle : M1+M2+M3+M4+M5+M7 (~10j)

### Sprint final 2 — Agency & Compliance (~18j)
**Objectif : Rochdi peut administrer 5+ sub-accounts en SaaS**
- A1 sub-account creation wizard (1.5j)
- A2 sub-account switcher (1j)
- A3 user management (1.5j)
- A6 email invitation (1j)
- A7 password reset (0.5j)
- S1 2FA enforcement (0.5j)
- S6 right to be forgotten (1j)
- S7 data export (1j)
- I1+I2 backup/restore (1j)
- O13 mobile responsive complet (2j)
- Différenciateurs critiques : D1+D2+D3+D4 (6j)

### Sprint final 3 — Polish & UX GHL-like (~15j)
**Objectif : un courtier GHL ne sent pas la différence**
- Features cachées critiques : C1+C2+C3+C5+C10+C14+C15+C25 (~7j)
- UX patterns : U4+U5+U8+U11+U13+U15 (~4j)
- Onboarding : O1+O2+O4 (~3j)

### Sprint final 4 — API & intégrations (~10j)
**Objectif : 3rd party integrations possibles**
- T4 API publique OpenAPI (2j)
- T5 Webhooks OUT (1.5j)
- T1 Zapier app (3j)
- T6 iCal feed (0.5j)
- O14 PWA installable (0.3j)
- Reste = backlog

### Sprint final 5 — Différenciateurs vente (~12j)
**Objectif : avoir des killer features uniques**
- D5 Centris sync (3j)
- D8 PDF mandat OACIQ (2j)
- D10 Carte leads Mapbox (1.5j)
- D11 Dashboard métier courtier (1j)
- D12 Signature 1-clic depuis SMS (1j)
- D13 Mode "courtier en visite" (2j)
- D15 Génération matériel marketing (2j)

---

## 15. TOTAL "Fermer GHL" sur PC

| Sprint | Effort | Cumul | État après |
|---|---|---|---|
| MVP Phase 4 actuel (déjà décidé) | 11j | 11j | 3 features GHL critiques manquantes ajoutées |
| Sprint 1 — Foundations | 25j | 36j | Rochdi peut migrer Mathis Guimont |
| Sprint 2 — Agency & Compliance | 18j | 54j | 5+ sub-accounts gérables en prod |
| Sprint 3 — Polish & UX GHL-like | 15j | 69j | Pas de friction migration courtiers |
| Sprint 4 — API & intégrations | 10j | 79j | Zapier + API + webhooks live |
| Sprint 5 — Différenciateurs vente | 12j | 91j | Killer features Intralys uniques |
| **TOTAL pour fermer GHL** | **91j** | — | **PC complet, prêt pour mobile** |

**~91 jours = ~18 semaines à temps plein, ~4-5 mois à 80%.**

À la fin : Rochdi ferme son compte agency GHL ($297/mois économisés × 12 = ~$3,500/an + ~10K en SMS/email rebilling) ET vend son propre SaaS aux courtiers QC.

---

## 16. Décisions recommandées maintenant

1. **Tu vises vraiment "fermer GHL" ou juste "compléter le clone" ?** Question existentielle.
   - Si "fermer GHL" : enchaîne les 5 sprints (~91j) avant mobile.
   - Si "juste compléter" : MVP Phase 4 actuel (11j) suffit pour démo + signer 5 clients pendant que GHL reste l'outil principal.
2. **Quel sub-account on migre en premier (PoC migration)** ? Mathis (récent, peu de data) ou Intralys (agency pivot, plus de risque) ?
3. **Combien d'argent tu mets en infra ?** Cloudflare R2 + KV + Queues + Images = ~$50/mois pour 5 clients. Sentry/Logflare = ~$30/mois. Mapbox Centris = $0-100/mois selon volume.
4. **Tu attends combien de clients avant Stripe Connect ?** 5 ? 10 ? 1 si payant ?
5. **Tu veux push tous les sprints en monorepo `intralys-dashboard` ou commencer à séparer** (`intralys-api`, `intralys-web`, `intralys-mobile` futur) ?

---

## 17. Status tracker "fermer GHL"

| Sprint | Items | Status | Dates |
|---|---|---|---|
| MVP Phase 4 (déjà locked §inventory) | 3 features + 2 quick wins | ⬜ todo | — |
| Sprint 1 — Foundations | 4 items + migration | ⬜ todo | — |
| Sprint 2 — Agency & Compliance | 11 items | ⬜ todo | — |
| Sprint 3 — Polish & UX GHL-like | 14 items | ⬜ todo | — |
| Sprint 4 — API & intégrations | 5 items | ⬜ todo | — |
| Sprint 5 — Différenciateurs | 7 items | ⬜ todo | — |
| **PC ready for mobile** | — | ⬜ todo | — |

---

_Document généré le 2026-05-10 par Claude Opus 4.7. Source de vérité finale pour fermer le gap GHL avant l'app mobile. À relire avant chaque nouveau sprint pour vérifier qu'on ne dévie pas._
