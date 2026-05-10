# ANTIGRAVITY-PHASE3-CATCHUP.md — Rattrapage GoHighLevel

> Audité le 2026-05-10 par Claude Opus 4.7 après le sprint P0+P1+P2 d'Antigravity.
> **Lis d'abord** : `ANTIGRAVITY-TODO.md` (contexte P0+P1+P2) et `ANTIGRAVITY-PLAN.md` (ton plan précédent).
> **Mission Phase 3 :** combler le gap restant vs GoHighLevel **avant** d'attaquer l'app mobile.

---

## 0. État au 2026-05-10 — ce qui est posé

- **DB :** 25 tables (7 migrations phasées). Pipelines, bookings, forms, sub-accounts, AI conversations, audit, notifications, tasks, snapshots — tout existe.
- **Worker :** 4 069 lignes, 95 handlers, 57 routes.
- **Auth :** PBKDF2 + change-password + 2FA TOTP.
- **Workflows :** engine cron actif.
- **Tracking :** UTM + activity log + audit log.
- **Marketing :** email broadcast + bulk CSV import + SMS Twilio + email inbound.
- **Calendar :** Google OAuth + booking pages + Google Business Profile.
- **Sub-accounts :** snapshots + white-label + widget embed.
- **Bundle :** -29% via React.lazy code-splitting.

**Build vert ✅. 30+ commits propres sur master.**

---

## 1. Le filtre stratégique

GHL fait **400+ features**. On ne va pas toutes les cloner. Filtre Phase 3 :

✅ **Garde** si la feature satisfait au moins UN critère :
- Bloque la vente vs GHL chez courtiers QC (les courtiers refusent de switcher sans X)
- Différenciateur Intralys (on fait mieux que GHL, pas juste pareil)
- Obligation légale QC (CASL, Loi 25, AMF, OACIQ)
- Pré-requis indispensable avant l'app mobile

❌ **Skip volontairement (Phase 4+ ou jamais) :**
- Memberships / Courses (Skool fait ça mieux, pas demandé par courtiers)
- Ecommerce store builder (hors scope immobilier)
- Marketplace de templates inter-agency (V3, après 50 clients)
- Affiliate tracking (V3)
- Class/group bookings (rare en immo)
- Resource booking — rooms/equipment (hors scope)
- Multi-langue UI (FR-only suffit pour le marché QC, EN viendra avec sub-accounts hors-QC)

---

## 2. Phase 3 — Plan de rattrapage ordonné

### 🔴 P3.1 — Conformité légale Quebec (BLOQUANT vente, ~3j)

**Pourquoi P3.1 :** sans ça, **chaque email/SMS broadcast est illégal** (CASL = amendes jusqu'à 10M$ CAD). Les courtiers AMF refuseront de migrer s'ils risquent leur certificat.

#### P3.1.a — Suppression list & opt-out CASL
- Table `unsubscribes (email/phone, channel, reason, unsubscribed_at, client_id)`
- Endpoint `POST /api/unsubscribe/:token` (token signé HMAC, dans chaque email)
- Lien `Désabonner` auto-injecté dans tous les emails Resend (pied de page obligatoire CASL)
- Filtre `WHERE NOT IN unsubscribes` sur tous les `send_email`/`send_sms` (broadcast + workflow + 1-1)
- SMS : mot-clé STOP/ARRÊT capté par webhook Twilio inbound → ajout auto à unsubscribes
- UI : page `/unsubscribes` admin pour visualiser

#### P3.1.b — Loi 25 consent banner + log + droit à l'oubli
- Banner cookies déclencheur Consent Mode v2 (réutilise pattern skill `intralys-tracking`)
- Table `consent_log (lead_id, consent_type, granted, ip, user_agent, granted_at)` — preuve juridique
- Endpoint `POST /api/leads/:id/forget` (anonymise ou hard-delete selon préférence client)
- Export RGPD : `GET /api/leads/:id/export-pii` (JSON de toutes les données du lead)

#### P3.1.c — AMF disclaimers automatiques
- Champ `client.amf_certificate` (numéro certificat courtier)
- Champ `client.amf_disclaimer_required` (boolean)
- Si activé : footer auto-injecté dans **tous** les emails sortants : *"Inscrit AMF n° X — Les rendements passés ne garantissent pas..."*
- Bloc HTML inséré server-side dans `executeStep('send_email')` + `handleSendMessage`

**Effort :** 3j · **Impact :** débloque la vente à n'importe quel courtier hypothécaire/financier QC.

---

### 🔴 P3.2 — Documents & e-signature (rattrapage GHL critique, ~5j)

**Pourquoi P3.2 :** GHL a `Documents & Contracts`. Sans ça, le courtier doit utiliser DocuSign en parallèle = friction = il reste sur GHL. Killer feature pour signature de mandat de courtage.

#### P3.2.a — Storage Cloudflare R2
- Binding R2 dans `wrangler.jsonc`
- Endpoints `POST /api/files` (upload presigned URL) + `GET /api/files/:id` (download signé)
- Table `files (id, client_id, lead_id, name, size, mime, r2_key, uploaded_by, created_at)`
- Limite 25MB par fichier, scan virus (ClamAV via API tierce — optionnel)

#### P3.2.b — Templates documents
- Table `document_templates (id, client_id, name, body_html, variables JSON)`
- Variables `{{lead.name}}`, `{{property.address}}`, `{{client.amf_certificate}}` interpolées
- Page `/documents/templates` (CRUD)

#### P3.2.c — E-signature simple
- Table `documents (id, template_id, lead_id, status, signed_at, signed_html, audit_trail JSON)`
- Page publique `/sign/:token` : affiche doc + canvas signature (HTML5) + IP/timestamp/user-agent capturés
- PDF généré via `pdf-lib` (npm, fonctionne sur Workers) après signature
- Email auto au lead avec PDF signé en pièce jointe (Resend)
- Audit trail conforme : IP, timestamp, user-agent, hash SHA-256 du document

**Effort :** 5j · **Impact :** killer feature courtiers immo (mandat de courtage signable en 30s). GHL fait ça via add-on payant.

---

### 🟠 P3.3 — Conversations bidirectionnelles complètes (~4j)

**Pourquoi P3.3 :** SMS Twilio bidi est OK, mais inbox unifiée GHL accepte aussi Messenger + WhatsApp + webchat live + voice. Sans ça, les courtiers gardent leurs autres apps.

#### P3.3.a — Webchat widget bidirectionnel (live)
- Snippet JS embeddable : `<script src="https://crm.intralys.com/widget/v1.js" data-client="X"></script>`
- WebSocket via Cloudflare Durable Objects : message live courtier ↔ visiteur
- Pré-chat form : capture name+email avant ouverture chat
- Persistance dans `messages` table avec `channel='webchat'`

#### P3.3.b — Facebook Messenger / Instagram DM
- Meta Graph API OAuth (page connection)
- Webhook `/api/webhook/meta` (validation X-Hub-Signature-256)
- Mapping FB user → lead par PSID
- Outbound via `POST graph.facebook.com/me/messages`

#### P3.3.c — Voice calls Twilio (recording + transcription)
- Numéro Twilio par client (déjà 10DLC fait en P1)
- Endpoint `/api/voice/twiml` (TwiML XML pour routing call)
- Recording auto (`record="true"` dans TwiML)
- Transcription post-call via Whisper API (OpenAI ou Cloudflare Workers AI `@cf/openai/whisper`)
- Player audio dans `LeadDetail.tsx`

**Skip volontaire P3.3 :** WhatsApp Business (process Meta long, 6 sem d'attente). Ajouter en P4 si demandé.

**Effort :** 4j · **Impact :** parité conversations GHL.

---

### 🟠 P3.4 — Smart Lists + Custom Fields UI (~2j)

**Pourquoi P3.4 :** déjà typé dans `types.ts` mais pas implémenté. Sans Smart Lists, les courtiers refont les mêmes filtres 50x/jour. Sans Custom Fields, impossible de modéliser leur process spécifique.

#### P3.4.a — Custom Fields UI builder
- Migration : `custom_field_defs (id, client_id, name, slug, field_type, options JSON, is_required, sort_order)`
- Migration : `custom_field_values (lead_id, field_id, value)`
- Page `/settings/custom-fields` : CRUD avec drag&drop reorder
- Affichage auto dans `LeadDetail.tsx` selon les fields définis du client

#### P3.4.b — Smart Lists exécutables
- Migration : `smart_lists (id, user_id, client_id, name, filters JSON, created_at)`
- Endpoint `GET /api/smart-lists` + `POST` + `DELETE`
- Sidebar Leads : lien "Mes vues" avec compteur live (count par vue)
- "Sauvegarder cette vue" depuis filtres actifs

**Effort :** 2j · **Impact :** UX énorme, gain quotidien courtier.

---

### 🟠 P3.5 — Reporting Attribution server-side (~2j)

**Pourquoi P3.5 :** GHL a `Attribution Reports`. Couplé au skill `intralys-tracking` (que tu as déjà), ça devient un argument de vente massif : *"on attribue chaque deal à sa source réelle, server-side, pas comme les autres CRM"*.

#### P3.5.a — Facebook CAPI (Conversions API server-side)
- Worker route `POST /api/track/conversion` (depuis le frontend ou workflow step)
- Hash SHA-256 du email/phone (PII normalization)
- Forward vers `graph.facebook.com/v18.0/{pixel_id}/events`
- Dédup avec event_id browser pixel (réutilise pattern skill intralys-tracking)
- Champs AAM 7 minimum : em, ph, fn, ln, ct, st, country

#### P3.5.b — Google Ads Conversion API
- Worker route similaire vers `googleads.googleapis.com`
- Click-id GCLID stocké sur le lead à la capture
- Auto-déclenche quand status `lead → signed`

#### P3.5.c — Reports CPL/CPA par source
- Endpoint `GET /api/reports/attribution?from=&to=&source=`
- Calcul : (∑ deal_value des leads converted) / (count leads par source)
- Graphique Recharts sur `/reports` (onglet Attribution)
- Cost manuel saisi par campagne (table `ad_spend`)

**Effort :** 2j · **Impact :** différenciateur vs GHL pour clients qui font de la pub Meta/Google.

---

### 🟠 P3.6 — AI features killer pour courtiers QC (~4j)

**Pourquoi P3.6 :** GHL a `Conversation AI` mais générique. On peut faire mieux **spécifique immobilier QC** = vrai différenciateur 2026.

#### P3.6.a — AI lead scoring auto (remplace `score` manuel)
- Worker : function `scoreLeadAI(lead, history)` → appelle Claude Haiku 4.5 avec prompt système court ("Tu es un expert en qualification de leads immobiliers QC. Score 0-100 basé sur : timeline, budget, source, engagement.")
- Trigger : à chaque INSERT lead + à chaque réponse inbound
- Coût : ~0.001$/lead, négligeable

#### P3.6.b — AI transcription appels + résumé
- Whisper sur Cloudflare Workers AI (`@cf/openai/whisper`)
- Post-call : transcription + résumé en 3 bullets via Claude Haiku
- Stocké dans `messages.body` avec `metadata.transcription_summary`

#### P3.6.c — AI content generator (FR québécois)
- Worker route `POST /api/ai/generate` avec actions : `email_followup`, `centris_description`, `social_post`, `objection_handler`
- Prompt système incluant le ton du client (capturé dans `client.brand_voice`)
- UI : bouton "✨ Générer avec IA" dans Templates + Compose email + Inbox reply

#### P3.6.d — AI workflow assistant
- Bouton dans WorkflowBuilder : "Suggérer un workflow"
- Prompt : description en langage naturel ("relancer les leads qui n'ont pas répondu en 48h") → JSON workflow steps
- Validé par le user avant save

**Effort :** 4j · **Impact :** **différenciateur n°1 pour vendre vs GHL en 2026.** À mettre en avant dans la home Intralys.

---

### 🟡 P3.7 — Workflow canvas 2D + branches conditionnelles (~3j)

**Pourquoi P3.7 :** layout vertical actuel = OK pour workflow simple, mais GHL a un canvas 2D (zoom/pan) avec branches if/else. Sans ça, impossible de faire des workflows complexes ("si lead vient de Facebook ET budget > 500k → branche A").

- Lib : **React Flow** (`reactflow`) — leader open-source, ~120kb gzip
- Refonte `WorkflowBuilder.tsx` en canvas
- Nouveau step type `condition` avec branches `if_true_step_id` + `if_false_step_id`
- Migration : ajouter `parent_step_id` + `branch` (enum: `main|true|false`) dans `workflow_steps`
- Engine `executeStep` : gérer le routing selon condition

**Effort :** 3j · **Impact :** parité GHL workflow builder.

---

### 🟡 P3.8 — Payments & Invoicing (Stripe Connect) (~4j)

**Pourquoi P3.8 :** courtier peut facturer ses commissions/services. Aussi nécessaire pour **vendre du SaaS aux sub-accounts** (P3.10).

- Stripe Connect Standard (sub-accounts gardent leur Stripe perso)
- Migration : `invoices (id, client_id, lead_id, stripe_invoice_id, amount, status, created_at)`
- Endpoints CRUD invoices + webhook Stripe `/api/webhook/stripe`
- UI : page `/invoices` avec création + envoi automatique (email avec lien paiement)
- Coupons : table `coupons` + appliquer sur invoice

**Skip volontaire :** order forms 1-click upsells (Shopify/SamCart fait mieux), affiliate tracking.

**Effort :** 4j · **Impact :** monétisation directe + pré-requis SaaS configurator.

---

### 🟡 P3.9 — SaaS configurator (revente sub-accounts) (~3j)

**Pourquoi P3.9 :** modèle économique GHL agency = $97/mois agency + revente $297/mois aux sub-accounts. Sans ça, tu vends 1-1, pas en SaaS scalable.

**Pré-requis :** P3.8 Stripe Connect doit être fait.

- Migration : `subscriptions (sub_account_id, plan, stripe_subscription_id, status, current_period_end)`
- Plans configurables (table `saas_plans` : nom, prix, features bool)
- Page `/agency/saas` : configurer les plans à revendre
- Page `/billing` côté sub-account : voir leur plan + facturation
- Quota enforcement : si plan = "starter" → max 1000 leads, max 2 users, etc.
- Trial period 14 jours

**Effort :** 3j · **Impact :** **passage de 1-1 à SaaS scalable.** Critique pour scaling Intralys.

---

### 🟢 P3.10 — Mobile prep (avant attaquer V1) (~2j)

**Pourquoi P3.10 :** sans ces fondations, l'app mobile sera buggée et frustrante.

- **Soft delete + corbeille 30j** : ajouter `deleted_at TEXT` sur leads/clients/messages/tasks. Endpoint `/api/trash` + `POST /api/restore/:id`. Cron quotidien hard-delete > 30j.
- **API publique OpenAPI** : générer `openapi.yaml` depuis les schemas Zod (lib `zod-to-openapi`). Servir sur `/api/docs` (Scalar UI). Bearer key par client (table `api_keys`).
- **Push notifications backend** : table `device_tokens (user_id, token, platform, created_at)`. Endpoint `POST /api/devices`. Helper `sendPush(userId, title, body)` qui utilise Firebase Cloud Messaging (FCM API REST, pas besoin de SDK serveur).
- **Optimistic UI partout** : revue des `useState` qui dépendent du backend → ajouter rollback systématique sur error.
- **Activity feed temps réel** : SSE endpoint `/api/events/stream` qui push les changements (lead créé, message reçu, etc.) — base pour notifications mobile push.

**Effort :** 2j · **Impact :** app mobile démarre sur du solide.

---

## 3. Récapitulatif effort & ordre conseillé

| # | Phase | Effort | Pourquoi cet ordre |
|---|---|---|---|
| 1 | **P3.1** Conformité QC | 3j | 🔴 Bloque la vente — fais en premier sinon tout le reste est inutilisable légalement |
| 2 | **P3.4** Smart Lists + Custom Fields | 2j | UX immédiate, débloque la modélisation client-spécifique pour P3.5 |
| 3 | **P3.6** AI features | 4j | Différenciateur 2026 — à mettre en démo commerciale ASAP |
| 4 | **P3.5** Attribution server-side | 2j | Pré-requis pour vendre aux clients qui font de la pub |
| 5 | **P3.2** Documents & e-signature | 5j | Killer feature courtiers — gros morceau, fais quand tu as un week-end |
| 6 | **P3.3** Conversations multi-canal | 4j | Parité GHL inbox — important mais pas bloquant |
| 7 | **P3.7** Workflow canvas 2D | 3j | Parité GHL builder — peut attendre que les utilisateurs demandent |
| 8 | **P3.8** Payments Stripe Connect | 4j | Pré-requis SaaS |
| 9 | **P3.9** SaaS configurator | 3j | Scaling Intralys — critique mais après 5+ clients |
| 10 | **P3.10** Mobile prep | 2j | Juste avant d'attaquer l'app mobile V1 |

**Total Phase 3 :** ~32j de dev solo (~6 semaines à temps plein, ou 3 mois à 50%).

---

## 4. Stratégie pragmatique : MVP Phase 3 vs full Phase 3

### MVP Phase 3 (12 jours) — pour vendre les 3 premiers clients
- ✅ P3.1 conformité QC (3j)
- ✅ P3.4 Smart Lists + Custom Fields (2j)
- ✅ P3.6 AI features (4j) — surtout AI lead scoring + content generator
- ✅ P3.10 Mobile prep light (1j) — juste soft delete + push notif backend
- ⏭️ Skip pour MVP : P3.2, P3.3, P3.5, P3.7, P3.8, P3.9 → V2

### Full Phase 3 (32 jours) — pour scaler à 20+ clients en SaaS
- Tout ce qui est ci-dessus

**Ma recommandation :** **MVP Phase 3 puis app mobile.** Tu signes 3 clients avec ce que tu as + MVP, tu valides le PMF, puis tu construis Full Phase 3 + app mobile en parallèle.

---

## 5. Mobile app — décision après Phase 3 MVP

Au moment d'attaquer mobile, choisis selon ces 3 questions :

| Question | Réponse "oui" → | Réponse "non" → |
|---|---|---|
| Tu as besoin de push notifications natives + voice in-app sous 2 semaines ? | **React Native + Expo** (3-4 sem) | Capacitor wrapper (1 sem) |
| Tu vises white-label par sub-account (chaque agence a son app dans App Store) ? | React Native + EAS Update + custom build per agency | Capacitor PWA install seulement |
| Budget pour gérer des bugs natifs spécifiques iOS/Android ? | React Native | Capacitor (web-first, moins de bugs natifs) |

**Mon vote pour Intralys :** **Capacitor V1 sous 1 semaine** (couvre 80% des features avec ton frontend Vite) puis évalue si vraiment besoin de React Native V2 6 mois plus tard.

---

## 6. Anti-collision et conventions

Mêmes règles que `ANTIGRAVITY-TODO.md` §2 et §7.

**Migrations :** continue sur `migration-phase8.sql`, `migration-phase9.sql`, etc. Une migration par P3.x si touche la DB.

**Format commit :** `feat(p3.X-name): ...`

**Worker.ts à 4 069 lignes — limite atteinte.** Pour P3, **commence par splitter** : extrais les handlers par domaine dans `src/worker/` (auth.ts, leads.ts, workflows.ts, etc.). Le router central reste dans `worker.ts`. C'est R3 dans `ANTIGRAVITY-PLAN.md` qui devient bloquant maintenant.

**Risk update :** R3 du plan précédent (worker monolithique) est maintenant 🔴 HIGH. Refactor en P3.0 obligatoire avant de commencer les autres P3.x.

---

## 7. P3.0 — Refactor worker.ts (préalable obligatoire, 1j)

Avant tout P3.x :

```
src/
  worker.ts            # router central uniquement (~150 lignes)
  worker/
    _helpers.ts        # sanitizeInput, json, corsHeaders, requireAuth, audit
    _crypto.ts         # hashPassword, verifyPassword
    auth.ts            # handleLogin, handleLogout, handleMe, handleChangePassword
    leads.ts           # handleGetLeads, handlePatchLead, handleAddTag, etc.
    tasks.ts
    workflows.ts       # handlers + processWorkflowQueue + executeStep
    appointments.ts
    notifications.ts
    messages.ts        # + Twilio + Resend webhooks
    forms.ts
    bookings.ts
    pipelines.ts
    snapshots.ts
    ai.ts
    sub_accounts.ts
    debug.ts           # endpoints debug à retirer en prod
```

**Test :** `bun run build` doit passer après chaque déplacement. Ne touche PAS la logique, juste extraction. Un commit par fichier déplacé = 14 commits propres `refactor(worker): extract X module`.

---

## 8. Status tracker Phase 3

| ID | Tâche | Status | Commit |
|---|---|---|---|
| P3.0 | Refactor worker.ts en modules | ✅ done | 8970ad9 |
| P3.1 | Conformité QC (CASL + Loi 25 + AMF) | ✅ done | 66155ea |
| P3.2 | Documents & e-signature | ⬜ skip MVP | — |
| P3.3 | Conversations multi-canal complètes | ⬜ skip MVP | — |
| P3.4 | Smart Lists + Custom Fields UI | ✅ done | b9003ab |
| P3.5 | Attribution server-side (CAPI + GAds) | ⬜ skip MVP | — |
| P3.6 | AI features (scoring + content + workflow) | ✅ done | 55e9b6e |
| P3.7 | Workflow canvas 2D + branches | ⬜ skip MVP | — |
| P3.8 | Payments Stripe Connect | ⬜ skip MVP | — |
| P3.9 | SaaS configurator | ⬜ skip MVP | — |
| P3.10 | Mobile prep (soft delete + push backend + OpenAPI) | ⬜ skip MVP | — |

---

## 9. Questions bloquantes pour Rochdi

1. **MVP Phase 3 (12j) ou Full Phase 3 (32j) avant mobile ?** — Ma reco : MVP.
2. **Stripe Connect compte créé ?** — pour P3.8 et P3.9.
3. **Cloudflare R2 bucket créé ?** — pour P3.2 documents storage.
4. **Whisper sur Cloudflare Workers AI ou OpenAI direct ?** — coût quasi équivalent, Workers AI = 1 binding de moins.
5. **Meta Business Manager + Facebook page reliée ?** — pour P3.3.b Messenger.
6. **Numéros Twilio dédiés par client ou un numéro Intralys partagé ?** — coût vs deliverability.

---

_Document généré le 2026-05-10 par Claude Opus 4.7 après audit complet du sprint Antigravity P0+P1+P2._
