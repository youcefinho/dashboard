# ANTIGRAVITY-PHASE4-PLAN.md — Plan d'exécution Phase 4

> Rédigé le 2026-05-10 par Antigravity après lecture de `ANTIGRAVITY-GHL-INVENTORY.md` + `ANTIGRAVITY-PHASE3-CATCHUP.md` + audit des 30 derniers commits.
> Worker actuel : **3808 lignes, 114 handlers, 3 modules extraits** (types/helpers/crypto).

---

## A. Décision stratégique — Recommandation : Option C (Hybride)

**Option C : MVP P4 (16j) → Mobile Capacitor V1 (7j) → reste P4 en parallèle ventes.**

Justification :
1. **Fenêtre commerciale** — les 3 premiers clients courtiers QC (Mathis + 2 prospects) ont besoin d'une démo mobile ASAP. Sans app mobile, GHL garde l'avantage "app dans la poche du courtier".
2. **MVP P4 suffit pour signer** — Voice/Calls + Webchat + Documents + Reviews couvrent les 4 objections principales des courtiers QC vs GHL.
3. **saasMode `setup_pending`** chez Intralys = Rochdi veut scaler en SaaS. Le mobile accélère la rétention, donc le SaaS. P3.8/P3.9 (Stripe/SaaS) viennent après les 5 premiers clients.
4. **Risque concurrence** — GHL pousse fort QC depuis Q1 2026. Chaque semaine sans démo mobile = clients perdus.
5. **Séquence exacte** : Refactor P3.0 (3j) → Q.1+Q.5 (1.5j) → P4.3 Documents (5j) → P4.6 Reviews (3j) → P4.1 Voice (5j) → P4.2 Webchat (3j) → **Mobile Capacitor V1** (7j) → reste P4 on-demand.

---

## B. Auto-audit honnête des commits P3

### 3 endroits où la qualité est en-dessous

1. **`callClaude()` dans worker.ts** — Aucun retry, aucun timeout, aucun circuit breaker. Si Anthropic API down → 500 silencieux. Le `JSON.parse(result)` crashe si Claude retourne du texte hors-JSON (ça arrive ~5% du temps avec Haiku). Fix requis : try/catch sur parse + retry 1x + fallback score=50.

2. **`handleExecuteSmartList()` — injection SQL théorique** — La whitelist est correcte MAIS le champ `tag` fait un `LIKE '%${tag}%'` via parameterized query. Le risque est nul (parameterized) mais le pattern est fragile : si quelqu'un ajoute un champ sans whitelist, c'est un trou. Fix : extraire un `buildSecureQuery()` avec validation stricte.

3. **P3.1 CASL — `generateUnsubscribeToken()` utilise HMAC-SHA256 avec `WEBHOOK_SECRET`** — C'est fonctionnel mais le secret est partagé avec les webhooks. Un attaquant qui connaît le webhook secret peut forger des tokens de désabonnement. Fix : utiliser une clé dédiée `UNSUBSCRIBE_SECRET`.

### 3 endroits non testés en prod réelle

1. **Broadcast email avec footer CASL + AMF** — Testé localement avec Resend fake key. Jamais envoyé un vrai email avec le footer injecté. Le HTML pourrait casser dans Gmail/Outlook.
2. **`handleForgetLead()` (droit à l'oubli Loi 25)** — L'anonymisation UPDATE est codée mais jamais exécutée sur un lead réel avec des messages/activités liés. Cascade potentiellement incomplète.
3. **Workflow engine cron `processWorkflowQueue()`** — Tourne en local mais n'a jamais traité un vrai workflow en prod avec des delays de plusieurs heures/jours. Le `datetime('now')` SQLite pourrait avoir des décalages timezone.

### 3 dépendances externes pas configurées

1. **Resend** — Domaine `intralys.com` NON vérifié (envoi depuis `noreply@intralys.com` sans SPF/DKIM = spam). À faire avant tout email en prod.
2. **Twilio Voice** — 10DLC fait pour SMS, mais Voice PAS activé. P4.1 est bloqué tant que Rochdi n'active pas Voice sur son compte Twilio ($1/mois/numéro + $0.013/min).
3. **Stripe Connect** — Le `customerId: cus_TIX3crrzEeA6PO` existe chez Intralys (GHL) mais Connect (platform account pour sub-accounts) n'est PAS configuré. P3.8/P4.18 sont bloqués.

---

## C. Plan détaillé MVP Phase 4

### Ordre d'exécution
```
P3.0 Refactor (3j) → Q.1 DND (0.5j) → Q.5 Champs contact (0.5j) →
P4.3 Documents (5j) → P4.6 Reviews (3j) → P4.1 Voice (5j) → P4.2 Webchat (3j)
```

---

### Q.1 — DND (Do Not Disturb) par canal — 0.5j

**Migration** : `migration-phase10.sql`
```sql
ALTER TABLE leads ADD COLUMN dnd INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN dnd_settings TEXT DEFAULT '{}';
-- dnd_settings JSON: {"email":false,"sms":false,"call":false,"voicemail":false,"gmb":false,"fb":false}
```

**Fichiers modifiés** :
- `src/worker.ts` — Ajouter helper `isDnd(lead, channel): boolean` + filtrer dans `handleSendMessage()`, `handleSendSms()`, `handleEmailBroadcast()`, `executeStep('send_email'|'send_sms')`, et futurs `send_voicemail`/`send_call`
- `src/lib/api.ts` — Exposer `dnd_settings` dans le PATCH lead

**Sous-tâches** :
1. Écrire migration (10min)
2. Helper `isDnd()` dans `helpers.ts` (15min)
3. Intégrer dans les 4 points d'envoi existants (1h)
4. PATCH lead pour toggle DND (30min)
5. Test : créer un lead avec `dnd.email=true`, tenter broadcast → vérifier skip (15min)

**Test manuel** : `curl -X PATCH /api/leads/:id -d '{"dnd_settings":{"email":true}}'` puis broadcast → lead exclu.

**Commit** : `feat(q1-dnd): do not disturb par canal + filtrage global envois`

---

### Q.5 — Champs contact étendus — 0.5j

**Migration** : `migration-phase10.sql` (même fichier que Q.1)
```sql
ALTER TABLE leads ADD COLUMN additional_emails TEXT DEFAULT '[]';
ALTER TABLE leads ADD COLUMN date_of_birth TEXT DEFAULT '';
ALTER TABLE leads ADD COLUMN country TEXT DEFAULT 'CA';
ALTER TABLE leads ADD COLUMN timezone TEXT DEFAULT 'America/Toronto';
```

**Fichiers modifiés** :
- `src/worker.ts` — `handlePatchLead()` ajouter les 4 champs dans l'UPDATE dynamique
- `src/lib/api.ts` — Types mis à jour

**Commit** : `feat(q5-contact-fields): additional_emails, date_of_birth, country, timezone`

---

### P4.3 — Documents & e-signature — 5j

**Pré-requis** : `npx wrangler r2 bucket create intralys-files` + binding dans `wrangler.jsonc`

**Migration** : `migration-phase11.sql`
```sql
CREATE TABLE files (id TEXT PK, client_id, lead_id, name, size INT, mime, r2_key, uploaded_by, created_at);
CREATE TABLE document_templates (id TEXT PK, client_id, name, body_html, variables TEXT DEFAULT '[]', created_at);
CREATE TABLE documents (id TEXT PK, template_id, lead_id, client_id, status, signed_at, signed_html, signature_data, audit_trail TEXT DEFAULT '{}', created_at);
```

**Fichiers à créer** :
- `src/worker/documents.ts` (~400 lignes) — handlers upload R2, templates CRUD, signature publique, PDF generation
- `src/pages/Documents.tsx` — page admin CRUD templates + liste documents
- `src/components/DocumentSign.tsx` — page publique `/sign/:token` avec canvas HTML5

**Sous-tâches** (ordonnées) :
1. R2 bucket + binding wrangler.jsonc (15min)
2. Migration SQL (15min)
3. Upload presigned URL endpoint (2h)
4. Document templates CRUD (2h)
5. Interpolation variables `{{lead.name}}` (1h)
6. Page publique `/sign/:token` + canvas signature (4h)
7. PDF generation avec `pdf-lib` (3h)
8. Email auto avec PDF signé via Resend (1h)
9. Audit trail SHA-256 (1h)
10. Frontend Documents.tsx (4h)

**Risques** : `pdf-lib` poids sur Workers (~180kb). Fallback : générer HTML signé sans PDF.

**Test manuel** : Créer template → générer document pour lead → ouvrir `/sign/:token` → signer → vérifier PDF reçu par email.

**Commit** : `feat(p4.3-documents): templates, e-signature canvas, R2 storage, PDF generation`

---

### P4.6 — Reviews & Reputation Management — 3j

**Migration** : `migration-phase12.sql`
```sql
CREATE TABLE review_requests (id TEXT PK, lead_id, client_id, channel, template_id, sent_at, clicked_at, reviewed_at, status, rating INT, created_at);
CREATE TABLE reviews_cache (id TEXT PK, client_id, platform, author, rating INT, comment, review_date, reply, replied_at, source_id, created_at);
```

**Fichiers à créer** :
- `src/worker/reviews.ts` (~300 lignes) — review request send, GBP sync, AI reply suggestion
- `src/pages/Reviews.tsx` — dashboard reviews, request management

**Sous-tâches** :
1. Migration SQL (15min)
2. Workflow step `request_review` (1h)
3. Email/SMS template review request avec routing intelligent : ≥5★→Google, <5★→form interne (2h)
4. GBP reviews sync (déjà partiel en P2, compléter) (2h)
5. AI reply suggestion via Claude Haiku (1h)
6. Dashboard Reviews.tsx avec aggregateRating + histogramme (4h)
7. Réponse auto-publiée sur GBP (2h)

**Risques** : Google Business Profile API quota 1000 reads/jour. Mettre en cache 1h minimum.

**Test manuel** : Passer un lead en `status=signed` → vérifier envoi review request → cliquer lien → vérifier routing ≥5★/< 5★.

**Commit** : `feat(p4.6-reviews): review requests, GBP sync, AI reply, reputation dashboard`

---

### P4.1 — Voice/Calls Twilio + Voicemail — 5j

**⚠️ BLOQUÉ** tant que Rochdi n'active pas Twilio Voice.

**Migration** : `migration-phase13.sql`
```sql
CREATE TABLE call_logs (id TEXT PK, lead_id, client_id, twilio_sid, direction, from_number, to_number, duration INT, status, recording_url, transcription, summary, created_at);
CREATE TABLE voicemail_drops (id TEXT PK, client_id, name, audio_r2_key, duration INT, created_at);
```

**Fichiers à créer** :
- `src/worker/voice.ts` (~500 lignes) — TwiML routing, recording webhook, Whisper transcription, voicemail drop, click-to-call
- `src/components/CallPlayer.tsx` — player audio inline dans LeadDetail

**Sous-tâches** :
1. Migration SQL + numéro Twilio par client (30min)
2. Endpoint `/api/voice/twiml` TwiML XML routing (2h)
3. Click-to-call initiate via Twilio REST API (2h)
4. Recording auto + webhook `/api/webhook/voice-status` (2h)
5. Transcription Whisper post-call (3h)
6. Résumé AI 3 bullets via Claude Haiku (1h)
7. Call logs dans messages table `channel='call'` (1h)
8. Voicemail drops — enregistrement + bulk send (4h)
9. CallPlayer.tsx dans LeadDetail (2h)
10. IVR basique "tapez 1 pour achat, 2 pour vente" (3h)

**Risques** : Twilio Voice pricing ($0.013/min outbound, $0.0085/min inbound). Whisper sur Workers AI peut timeout sur appels >5min → chunking requis.

**Commit** : `feat(p4.1-voice): Twilio Voice, recording, Whisper transcription, voicemail drops, IVR`

---

### P4.2 — Webchat widget live — 3j

**Migration** : `migration-phase14.sql`
```sql
CREATE TABLE webchat_sessions (id TEXT PK, client_id, visitor_name, visitor_email, status, assigned_to, created_at, ended_at);
-- Messages webchat vont dans la table messages existante avec channel='webchat'
```

**Fichiers à créer** :
- `src/worker/webchat.ts` (~300 lignes) — session management, message polling (long-poll, pas WebSocket pour rester sur Workers standard)
- `public/widget/v1.js` (~200 lignes) — snippet JS embeddable
- `src/components/WebchatInbox.tsx` — vue agent dans Conversations

**Sous-tâches** :
1. Migration SQL (15min)
2. Widget JS snippet avec pré-chat form (4h)
3. Long-polling endpoints `/api/webchat/poll` + `/api/webchat/send` (3h)
4. Session management + auto-assign agent (2h)
5. Intégration dans Inbox existant (3h)
6. Mode online/offline selon business hours (1h)
7. Notification push au courtier (1h)

**Risques** : Long-polling = charge serveur. Si >50 sessions simultanées → passer à Durable Objects (Phase 5). Pour MVP, long-poll suffit.

**Commit** : `feat(p4.2-webchat): widget JS embeddable, long-poll messaging, inbox integration`

---

## D. P3.0 Refactor worker.ts — Plan détaillé

Worker actuel : **3808 lignes, 114 handlers**. Modules déjà extraits : `types.ts` (25L), `helpers.ts` (172L), `crypto.ts` (120L).

### Modules à extraire

| Module | Handlers | Lignes estimées | Dépendances |
|---|---|---|---|
| `auth.ts` | login, logout, me, changePassword, totp* (6) | ~250 | helpers, crypto |
| `leads.ts` | getLeads, patchLead, bulkLeads, getDetail, addTag, removeTag, getAllTags, getActivity, exportCsv (9) | ~450 | helpers |
| `messages.ts` | getLeadMessages, sendMessage, getInbox, sendSms, inboundSms, inboundEmail (6) | ~350 | helpers |
| `clients.ts` | getClients, createClient, getClientLeads (3) | ~100 | helpers |
| `templates.ts` | getTemplates, create, update, delete (4) | ~120 | helpers |
| `workflows.ts` | CRUD + toggle + enroll + processQueue + executeStep (8+) | ~500 | helpers, messages |
| `appointments.ts` | CRUD (4) | ~150 | helpers |
| `tasks.ts` | CRUD (4) | ~100 | helpers |
| `notifications.ts` | get, read, readAll (3) | ~50 | helpers |
| `pipelines.ts` | CRUD pipelines + stages (8) | ~200 | helpers |
| `reports.ts` | overview, sources, conversion (3) | ~200 | helpers |
| `broadcast.ts` | emailBroadcast, broadcastHistory (2) | ~200 | helpers, messages |
| `bookings.ts` | public page, create, CRUD booking pages, getBookings (6) | ~200 | helpers |
| `forms.ts` | public get/submit, CRUD, submissions (6) | ~150 | helpers |
| `ai.ts` | aiChat, getConversations, getConversation, aiScore, aiGenerate, aiSuggestWorkflow (6) | ~400 | helpers |
| `sub_accounts.ts` | get, create, update, snapshots, whitelabel, widget (8) | ~350 | helpers |
| `gcal.ts` | authUrl, callback, events, sync (4) | ~200 | helpers |
| `gbp.ts` | reviews, stats (2) | ~80 | helpers |
| `compliance.ts` | unsubscribe, getUnsubscribes, consent, forget, exportPii (6) | ~200 | helpers |
| `custom_fields.ts` | CRUD defs + values + smart lists + execute (10) | ~300 | helpers |

### Ordre d'extraction (feuilles → racine)

1. `notifications.ts` (50L, 0 dépendances internes)
2. `tasks.ts` (100L)
3. `templates.ts` (120L)
4. `clients.ts` (100L)
5. `gbp.ts` (80L)
6. `pipelines.ts` (200L)
7. `appointments.ts` (150L)
8. `reports.ts` (200L)
9. `compliance.ts` (200L)
10. `custom_fields.ts` (300L)
11. `forms.ts` (150L)
12. `bookings.ts` (200L)
13. `sub_accounts.ts` (350L)
14. `gcal.ts` (200L)
15. `auth.ts` (250L, dépend de crypto)
16. `leads.ts` (450L)
17. `messages.ts` (350L, dépend de helpers.sendSms)
18. `broadcast.ts` (200L, dépend de messages)
19. `ai.ts` (400L)
20. `workflows.ts` (500L, dépend de messages/leads — dernière)

**Résultat** : `worker.ts` réduit à ~200 lignes (router + imports + fetch handler). 20 commits `refactor(worker): extract X module`.

---

## E. Réponses aux 6 questions bloquantes (§8)

### Q1 — Direction commerciale ? Option A/B/C ?
- **Recommandation** : Option C (Hybride)
- **Si pas de réponse 24h** : je pars sur Option C, refactor P3.0 d'abord (non destructif)
- **Impact mauvaise décision** : si Full (B) → mobile retardé de 3 mois, perte de 5-10 clients potentiels

### Q2 — Twilio Voice commandé ?
- **Recommandation** : Commander maintenant ($1/mois/numéro + $0.013/min)
- **Si pas de réponse 24h** : je skip P4.1 Voice et commence par P4.3 Documents (pas bloqué)
- **Impact** : sans Voice, on perd l'argument "téléphone intégré" vs GHL = deal breaker pour 40% des courtiers

### Q3 — Héberger sites courtiers (P4.12) ?
- **Recommandation** : NON pour MVP. Les courtiers gardent leur site existant (Intralys landing pages). P4.12 = Phase 5 si demandé.
- **Si pas de réponse 24h** : skip P4.12
- **Impact** : faible, les courtiers QC ont déjà un site via Intralys landing pages

### Q4 — Affiliate Manager ?
- **Recommandation** : SKIP. Les courtiers QC n'ont pas de rabatteurs formels. Le parrainage est informel.
- **Si pas de réponse 24h** : skip P4.10
- **Impact** : nul pour les 10 premiers clients

### Q5 — Memberships ?
- **Recommandation** : SKIP. Formation courtier = marché niche séparé. Skool/Teachable font ça mieux. Pas de demande client.
- **Si pas de réponse 24h** : skip P4.11
- **Impact** : nul sauf si Rochdi a un plan formation spécifique

### Q6 — Stripe Connect configuré ?
- **Recommandation** : Configurer maintenant (gratuit, 10min sur dashboard Stripe). Nécessaire pour P4.18 Text-to-Pay et futur P3.8 Payments.
- **Si pas de réponse 24h** : je skip les features Stripe et continue sur Documents/Reviews/Voice
- **Impact** : sans Connect, pas de facturation in-app = courtier utilise Stripe/PayPal séparé = friction

---

## F. Estimations

| Phase | Effort | Jours calendrier |
|---|---|---|
| **Refactor worker P3.0 complet** | 20 commits, ~3j | 3j |
| **Quick wins Q.1 + Q.5** | 2 commits, ~1j | 1j |
| **MVP Phase 4** (P4.3 + P4.6 + P4.1 + P4.2) | 4 commits, ~16j | 16j |
| **Mobile Capacitor V1** | ~7j | 7j |
| **Reste Phase 4** (16 features) | ~55j | 55j |
| **Total Option C complète** | ~82j | ~16 semaines |

### Séquence Option C

```
Semaine 1-2  : Refactor P3.0 (3j) + Q.1+Q.5 (1j)
Semaine 2-3  : P4.3 Documents (5j)
Semaine 4    : P4.6 Reviews (3j)
Semaine 5-6  : P4.1 Voice (5j) ← bloqué si Twilio Voice pas activé
Semaine 6-7  : P4.2 Webchat (3j)
              → DÉMO COMMERCIALE MVP ←
Semaine 7-8  : Mobile Capacitor V1 (7j)
              → APP STORE ←
Semaine 9+   : Reste P4 on-demand selon demandes clients
```

---

_En attente de validation Rochdi sur : Option A/B/C, Twilio Voice, Stripe Connect, Affiliate/Memberships skip._
