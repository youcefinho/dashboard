# ANTIGRAVITY-PHASE3-PLAN.md — Plan d'exécution Phase 3

> Rédigé le 2026-05-10 par Antigravity après lecture de `ANTIGRAVITY-PHASE3-CATCHUP.md`.
> **Aucun code ne sera commité avant validation Rochdi.**

---

## A. Décision MVP vs Full

**Recommandation : MVP Phase 3 (12j).**

Justification : Tu as 0 client payant. Le PMF n'est pas validé. Chaque jour de dev sans feedback réel = risque de construire le mauvais truc. MVP Phase 3 (P3.0 + P3.1 + P3.4 + P3.6) couvre : la conformité légale (sans ça tu ne peux pas vendre au QC), l'UX critique (Smart Lists), et le différenciateur AI. Ça suffit pour signer les 3 premiers clients. Full Phase 3 viendra après validation PMF avec leurs retours.

---

## B. Plan d'attaque détaillé — MVP Phase 3

### P3.0 — Refactor worker.ts (1j)

**Fichiers à créer :**
- `src/worker/helpers.ts` — sanitizeInput, json, corsHeaders, Resend helper (~120 lignes)
- `src/worker/crypto.ts` — hashPassword, verifyPassword, base32, TOTP (~130 lignes)
- `src/worker/auth.ts` — handleLogin/Logout/Me/ChangePassword/TOTP setup/verify/disable (~280 lignes)
- `src/worker/leads.ts` — CRUD leads, bulk, CSV import (~350 lignes)
- `src/worker/clients.ts` — CRUD clients (~120 lignes)
- `src/worker/tasks.ts` — CRUD tasks (~100 lignes)
- `src/worker/workflows.ts` — handlers + processWorkflowQueue + executeStep (~450 lignes)
- `src/worker/appointments.ts` — CRUD RDV (~100 lignes)
- `src/worker/notifications.ts` — CRUD notifications + createNotification (~80 lignes)
- `src/worker/messages.ts` — conversations, SMS Twilio, email inbound (~250 lignes)
- `src/worker/forms.ts` — form CRUD + public submit + widget.js (~200 lignes)
- `src/worker/bookings.ts` — booking pages + public booking + CRUD (~200 lignes)
- `src/worker/pipelines.ts` — pipelines + stages CRUD (~180 lignes)
- `src/worker/reports.ts` — overview, sources, conversion, broadcast history (~200 lignes)
- `src/worker/ai.ts` — AI chat + conversations (~100 lignes)
- `src/worker/sub-accounts.ts` — sub-accounts + snapshots + white-label (~200 lignes)
- `src/worker/gcal.ts` — Google Calendar OAuth + events + sync (~150 lignes)
- `src/worker/gbp.ts` — Google Business Profile reviews + stats (~60 lignes)
- `src/worker.ts` — routeur central uniquement (~150 lignes + imports)

**Migration SQL :** Aucune.

**Sous-tâches ordonnées :**
1. Créer `src/worker/helpers.ts` + `crypto.ts` (feuilles, 0 dépendances)
2. Extraire `auth.ts` (dépend de helpers + crypto)
3. Extraire `notifications.ts` (dépend de helpers)
4. Extraire les modules métier un par un (leads, clients, tasks, etc.)
5. Extraire workflows (le plus complexe, dépend de notifications + messages)
6. Réécrire `worker.ts` en routeur d'imports
7. `bun run build` après chaque extraction

**Tests manuels :** Build vert après chaque commit.

**Risques :**
- Imports circulaires (helpers ↔ auth). Mitigation : helpers ne dépend de rien.
- Env/types partagés. Mitigation : Env + types dans un fichier `types.ts` séparé.
- Beaucoup de commits (14+). Mitigation : un commit par module, atomique.

---

### P3.1 — Conformité légale QC (3j)

**Fichiers à créer/modifier :**
- `src/worker/compliance.ts` — [NEW] handlers CASL + Loi 25 + AMF
- `migration-phase8.sql` — [NEW] tables unsubscribes, consent_log, colonnes AMF
- `src/worker/helpers.ts` — [MODIFY] ajouter footer CASL auto + AMF dans emails
- `src/worker/messages.ts` — [MODIFY] filtre unsubscribes avant envoi
- `src/worker/workflows.ts` — [MODIFY] filtre unsubscribes dans executeStep send_email/sms
- `src/lib/api.ts` — [MODIFY] fonctions API compliance
- `src/pages/Unsubscribes.tsx` — [NEW] page admin unsubscribes

**Migration SQL (phase 8) :**
```sql
CREATE TABLE IF NOT EXISTS unsubscribes (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  channel TEXT CHECK (channel IN ('email','sms','all')) DEFAULT 'all',
  reason TEXT DEFAULT '',
  client_id TEXT,
  unsubscribed_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_unsub_email ON unsubscribes(email);
CREATE INDEX IF NOT EXISTS idx_unsub_phone ON unsubscribes(phone);

CREATE TABLE IF NOT EXISTS consent_log (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  granted INTEGER DEFAULT 0,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  granted_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE clients ADD COLUMN amf_certificate TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN amf_disclaimer_required INTEGER DEFAULT 0;
```

**Sous-tâches ordonnées :**
1. Migration phase 8 + tables
2. `handleUnsubscribe` (public, token HMAC signé)
3. Filtre `NOT IN unsubscribes` dans broadcast + workflow send_email/sms
4. SMS STOP/ARRÊT → auto-unsubscribe dans webhook Twilio inbound
5. Footer CASL auto-injecté dans tous les emails sortants
6. AMF disclaimer server-side dans emails
7. Consent log endpoints (POST/GET)
8. Droit à l'oubli : `POST /api/leads/:id/forget` + `GET /api/leads/:id/export-pii`
9. Page admin `/unsubscribes`

**Tests manuels :**
- Envoyer broadcast → vérifier que footer CASL est présent
- Unsubscribe via lien → vérifier que le prochain broadcast skip ce contact
- SMS "STOP" → vérifier auto-unsubscribe
- Forget lead → vérifier anonymisation

**Risques :**
- HMAC token pour unsubscribe : doit utiliser WEBHOOK_SECRET comme clé, pas une clé dérivée du userId.
- AMF disclaimer : doit être dans le HTML server-side, pas côté client (sinon contournable).
- Performance : le filtre `NOT IN unsubscribes` sur broadcast 500 leads → OK sur D1, mais surveiller.

---

### P3.4 — Smart Lists + Custom Fields (2j)

**Fichiers à créer/modifier :**
- `migration-phase9.sql` — [NEW] tables custom_field_defs, custom_field_values, smart_lists
- `src/worker/custom-fields.ts` — [NEW] CRUD custom fields + values
- `src/worker/smart-lists.ts` — [NEW] CRUD smart lists + exécution
- `src/lib/api.ts` — [MODIFY] fonctions API custom fields + smart lists
- `src/pages/LeadDetail.tsx` — [MODIFY] afficher custom fields dynamiques
- `src/pages/Leads.tsx` — [MODIFY] sidebar "Mes vues" smart lists

**Migration SQL (phase 9) :**
```sql
CREATE TABLE IF NOT EXISTS custom_field_defs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  field_type TEXT CHECK (field_type IN ('text','number','date','select','multiselect','boolean','url','phone','email')) NOT NULL,
  options TEXT DEFAULT '[]',
  is_required INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_field_values (
  lead_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value TEXT DEFAULT '',
  PRIMARY KEY (lead_id, field_id)
);

CREATE TABLE IF NOT EXISTS smart_lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT,
  name TEXT NOT NULL,
  filters TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Sous-tâches ordonnées :**
1. Migration phase 9
2. CRUD custom_field_defs (admin)
3. CRUD custom_field_values (lié au lead)
4. Affichage dynamique dans LeadDetail
5. CRUD smart_lists
6. Exécution smart list (convertir filters JSON → SQL WHERE)
7. Sidebar dans Leads avec compteurs live

**Tests manuels :**
- Créer un champ "Budget" type number → vérifier qu'il apparaît dans LeadDetail
- Créer smart list "Leads > 500k" → vérifier le compteur
- Supprimer un champ → vérifier cascade sur les values

**Risques :**
- SQL dynamique pour smart lists (injection SQL). Mitigation : whitelist des opérateurs, parameterized queries only.
- Custom fields sur des leads existants → valeur = vide par défaut, pas crash.

---

### P3.6 — AI features (4j)

**Fichiers à créer/modifier :**
- `src/worker/ai.ts` — [MODIFY] ajouter scoring, content generator, workflow assistant
- `src/lib/api.ts` — [MODIFY] fonctions API AI
- `src/pages/LeadDetail.tsx` — [MODIFY] afficher score AI + bouton re-score
- `src/pages/Templates.tsx` — [MODIFY] bouton "✨ Générer avec IA"
- `src/pages/WorkflowBuilder.tsx` — [MODIFY] bouton "Suggérer un workflow"

**Migration SQL :** Aucune (utilise les tables ai_conversations/ai_messages existantes).

> **IMPORTANT :** Utiliser **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) via API Anthropic, **PAS** OpenAI GPT-4o-mini. Coût 30x moins cher. L'env var `OPENAI_API_KEY` existante sera renommée en `ANTHROPIC_API_KEY`.

**Sous-tâches ordonnées :**
1. `scoreLeadAI(lead, history)` — Claude Haiku, score 0-100, trigger sur INSERT lead
2. Route `POST /api/ai/score/:leadId` (re-score manuel)
3. Route `POST /api/ai/generate` avec actions : email_followup, centris_description, social_post, objection_handler
4. Prompt système incluant `client.brand_voice` pour personnalisation
5. Route `POST /api/ai/suggest-workflow` — description langage naturel → JSON workflow
6. UI : score affiché dans LeadDetail (badge couleur 0-33-66-100)
7. UI : bouton "✨ Générer" dans Templates + Inbox reply
8. UI : bouton "Suggérer" dans WorkflowBuilder

**Tests manuels :**
- Créer un lead → vérifier qu'un score AI apparaît (0-100)
- Générer un email de suivi → vérifier le ton québécois
- Suggérer un workflow → vérifier que le JSON est valide et parseable

**Risques :**
- Latence Anthropic API (1-3s) : UI doit montrer un spinner, pas bloquer.
- Coûts : ~0.001$/appel Haiku, mais surveiller si scoring automatique sur chaque INSERT lead = volume inattendu.
- Prompt injection : le message du user est dans le prompt → sanitizer le contenu avant envoi.

---

## C. Réponses aux 6 questions bloquantes (§9)

### 1. MVP Phase 3 (12j) ou Full Phase 3 (32j) ?
**Recommandation :** MVP. Si pas de réponse en 24h → je pars sur MVP.

### 2. Stripe Connect compte créé ?
**Recommandation :** Pas besoin pour MVP Phase 3 (P3.8 est hors scope MVP). Créer le compte Stripe quand on attaque Full Phase 3.
**Si pas de réponse :** Skip P3.8/P3.9, aucun impact sur MVP.

### 3. Cloudflare R2 bucket créé ?
**Recommandation :** Pas besoin pour MVP Phase 3 (P3.2 documents est hors scope MVP).
**Si pas de réponse :** Skip P3.2, aucun impact sur MVP.

### 4. Whisper sur Cloudflare Workers AI ou OpenAI direct ?
**Recommandation :** Cloudflare Workers AI (`@cf/openai/whisper`) — 1 binding de moins, même coût, latence plus basse car même infra.
**Si pas de réponse :** Workers AI par défaut. Pas bloquant pour MVP (voice calls = P3.3, hors scope MVP).

### 5. Meta Business Manager + Facebook page reliée ?
**Recommandation :** Pas besoin pour MVP (P3.3 Messenger = hors scope MVP, P3.5 CAPI = hors scope MVP).
**Si pas de réponse :** Skip, aucun impact.

### 6. Numéros Twilio dédiés par client ou partagé ?
**Recommandation :** Un numéro Intralys partagé pour le MVP (moins cher, plus simple). Passer à un numéro dédié par client quand on dépasse 5 clients (deliverability).
**Si pas de réponse :** Numéro partagé par défaut.

---

## D. Refactor P3.0 — Découpage proposé

### Modules à extraire (ordre d'extraction = feuilles d'abord)

| # | Module | Lignes est. | Dépendances | Ordre |
|---|---|---|---|---|
| 1 | `worker/types.ts` | ~30 | aucune | 1er |
| 2 | `worker/helpers.ts` | ~120 | types | 2e |
| 3 | `worker/crypto.ts` | ~130 | aucune | 3e |
| 4 | `worker/auth.ts` | ~280 | helpers, crypto | 4e |
| 5 | `worker/notifications.ts` | ~80 | helpers | 5e |
| 6 | `worker/tasks.ts` | ~100 | helpers | 6e |
| 7 | `worker/clients.ts` | ~120 | helpers, notifications | 7e |
| 8 | `worker/leads.ts` | ~350 | helpers, notifications | 8e |
| 9 | `worker/pipelines.ts` | ~180 | helpers | 9e |
| 10 | `worker/messages.ts` | ~250 | helpers (+ Twilio, Resend) | 10e |
| 11 | `worker/appointments.ts` | ~100 | helpers | 11e |
| 12 | `worker/forms.ts` | ~200 | helpers | 12e |
| 13 | `worker/bookings.ts` | ~200 | helpers, notifications | 13e |
| 14 | `worker/reports.ts` | ~200 | helpers | 14e |
| 15 | `worker/ai.ts` | ~100 | helpers | 15e |
| 16 | `worker/sub-accounts.ts` | ~200 | helpers, crypto | 16e |
| 17 | `worker/gcal.ts` | ~150 | helpers | 17e |
| 18 | `worker/gbp.ts` | ~60 | helpers | 18e |
| 19 | `worker/workflows.ts` | ~450 | helpers, messages, notifications | **dernier** |
| 20 | `worker.ts` (routeur) | ~150 | tous les modules | final |

**Graph de dépendances :**
```
types.ts ← helpers.ts ← presque tout
                       ← crypto.ts ← auth.ts
                       ← notifications.ts ← clients.ts, leads.ts, bookings.ts
                       ← messages.ts ← workflows.ts
```

**Total estimé :** ~3450 lignes réparties en 18 modules + 150 lignes routeur = même volume, bien organisé.

---

## E. Risques & dette technique (audit honnête)

### 3 endroits où la qualité est en dessous

1. **`handleEmailBroadcast` — pas de rate limiting Resend.** Envoyer 500 emails d'un coup va déclencher le rate limit Resend (10 req/s plan gratuit). Il faut un batch avec delay. **Impact :** broadcast cassé en prod.

2. **`generateTotp` — dead code.** La fonction est définie mais jamais appelée (1 ref = déclaration). Devrait être supprimée ou utilisée dans un endpoint de test. **Impact :** code mort.

3. **`handleReportsConversion` — SQL injection potentielle.** La construction du `IN (${reachedStatuses})` avec string interpolation est safe car les valeurs sont hardcodées, mais le pattern est fragile. Si quelqu'un ajoute un status dynamique, c'est une injection. **Impact :** faible aujourd'hui, dette pour le futur.

### 3 endroits où je ne suis pas sûr que ça marche en prod

1. **Google Calendar OAuth2 (`handleGcalCallback`).** Le flux OAuth complet (auth → callback → token refresh) n'a jamais été testé avec de vrais credentials Google. Le stockage des tokens dans `permissions` JSON via `json_set()` dépend de la compatibilité SQLite/D1 avec cette fonction. **Risque :** le callback pourrait échouer silencieusement.

2. **AI bot (`handleAiChat`).** Utilise actuellement `OPENAI_API_KEY` + GPT-4o-mini. Le plan P3.6 migre vers Claude Haiku. Le handler existant n'a pas de timeout — si OpenAI met 30s à répondre, le Worker Cloudflare timeout (30s max). **Risque :** timeout en prod.

3. **Snapshots (`handleApplySnapshot`).** Le snapshot stocke tout dans `audit_log.details` en JSON (potentiellement des centaines de KB). D1 a une limite de 1MB par row. Un client avec 50 workflows + 100 templates pourrait dépasser. **Risque :** crash silencieux sur gros clients.

### 3 dépendances externes fragiles

1. **Resend — domaine non vérifié.** Sans domaine vérifié sur Resend, les emails sortants vont en spam ou sont bloqués. Le `from: 'noreply@intralys.com'` ne fonctionne que si `intralys.com` est vérifié dans Resend Dashboard. **Action :** vérifier le domaine avant tout test broadcast.

2. **Twilio — pas de 10DLC registré.** Les SMS A2P aux US/Canada sans 10DLC registration sont filtrés par les carriers. Sans enregistrement, 30-50% des SMS ne seront jamais reçus. **Action :** enregistrer le brand + campaign Twilio avant envoi en masse.

3. **Google APIs — pas de credentials configurées.** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GBP_API_KEY` sont tous dans Env mais aucun n'est configuré. Google Calendar et GBP sont des coquilles vides en prod. **Action :** créer le projet Google Cloud Console + OAuth consent screen.

---

_Phase 3 plan rédigé. En attente de validation Rochdi sur les 6 questions bloquantes._
