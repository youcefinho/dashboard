# ANTIGRAVITY-RECTIFICATION.md — Audit honnête + cap rectifié

> Audit fait le 2026-05-10 par Claude Opus 4.7 sur demande de Rochdi.
> **Constat Rochdi :** "on crée une app, on va pas commencer à remplir les ID/tokens/API tout de suite. Je pense que c'est pas bien fait."
> **Mission :** dire la vérité sur l'état du code, retirer la confusion "migration depuis GHL réel" (hors scope actuel), et planifier la suite en MODE CONSTRUCTION.

---

## 0. Erreur fondamentale dans les docs précédents

Les docs `ANTIGRAVITY-GHL-COMPLETENESS.md`, `ANTIGRAVITY-GHL-INVENTORY.md`, `ANTIGRAVITY-PHASE3-CATCHUP.md`, `ANTIGRAVITY-SPRINT1-PLAN.md` et les prompts précédents parlent constamment de :
- Migration depuis GHL réel via PIT token
- Connexion live à `services.leadconnectorhq.com`
- Importer les 11 contacts Mathis Guimont depuis GHL réel
- Mapping data GHL → notre clone
- Stripe Connect / Twilio Voice / Meta Graph API en prod

**Ce n'est PAS la phase actuelle.**

On construit le clone GHL. La migration de Mathis depuis GHL existant viendra **après que le clone soit complet et utilisable** (probablement V2 dans 3-6 mois). Pour l'instant on a besoin :
- Du clone qui MARCHE en local sans aucune API externe
- De seed data réaliste pour tester chaque feature
- De mocks pour les services externes (Resend, Twilio, OpenAI, Google) qui simulent un comportement réaliste
- D'un mode dev vs prod clair

Toutes les références à "PIT token GHL", "migration M1-M7", "importer contacts Mathis depuis GHL" doivent passer en **PHASE V2** (backlog futur), pas en phase actuelle.

---

## 1. État réel du code après tous les sprints

### Quantité livrée
- **16 335 lignes** TS/TSX
- **29 modules worker** dans `src/worker/` (5 898 lignes total)
- **`worker.ts` core** : 388 lignes (juste router) — excellent
- **20 pages** frontend
- **15 migrations SQL** (phases 1-13 + 2 sprint2)
- **40+ commits** propres
- **Build vert** ✅

### Qualité — ventilation honnête

| Catégorie | % code | Verdict |
|---|---|---|
| 🟢 Solide (refactor, compliance, webchat DO, documents R2) | ~30% | OK garder |
| 🟡 Fonctionnel-fragile (leads CRUD, dashboard, workflows engine) | ~40% | À durcir |
| 🟠 Stub / superficiel (gbp, gcal, ai mixte, broadcast loop) | ~20% | À refaire ou couper |
| 🔴 Hors scope actuel (migrate.ts vers GHL prod) | ~10% | À retirer / disable |

---

## 2. Audit module par module — verdict honnête

### 🟢 GARDER tel quel

| Module | LOC | Verdict |
|---|---|---|
| `worker.ts` (router central) | 388 | Excellent — split bien fait |
| `auth.ts` (PBKDF2 + sessions) | 150 | Solide |
| `crypto.ts` (PBKDF2 helpers) | 135 | Bon |
| `helpers.ts` (sanitize, json, audit, requireAuth) | 197 | OK |
| `compliance.ts` (CASL + Loi 25 + AMF) | 210 | Bon — pattern unsubscribe token HMAC propre |
| `webchat.ts` (Durable Object WebSocket) | 367 | Sérieux — Durable Objects vraiment utilisés |
| `documents.ts` (R2 + e-sign) | 437 | Probable OK (à vérifier UI) |
| `custom-fields.ts` | 246 | OK builder |
| `scoring.ts` (multi-score profiles) | 292 | OK |
| `leads.ts` | 627 | Solide CRUD + bulk + filters |
| `workflows.ts` | 451 | Engine cron OK |

### 🟡 À DURCIR (fonctionnel mais incomplet)

| Module | LOC | Problème |
|---|---|---|
| `workflows.ts` | 451 | Engine cron exécute, MAIS pas de retry, pas de DLQ, pas de test runner |
| `messages.ts` | 268 | Channels Twilio/Resend, mais branchés sur APIs prod sans mocks |
| `pipelines.ts` | 159 | Multi-pipelines table OK, mais UI customization basique |
| `reports.ts` | 157 | Queries SQL basiques, prétendre "12 rapports analytiques" est exagéré |
| `forms.ts` | 93 | Form builder backend OK, UI builder probablement minimal |
| `bookings.ts` | 118 | Public booking pages OK, mais availability rules simplistes |
| `notifications.ts` | 43 | Trop court pour vraies notifications enrichies |
| `tasks.ts` | 82 | CRUD minimum, pas de subtasks/comments/recurring (DEPTH-AUDIT §8 not done) |
| `templates.ts` | 102 | CRUD email templates, pas de SMS, pas de visual builder |
| `dashboard.ts` | 177 | Stats basiques |
| `sub-accounts.ts` | 121 | Snapshots/white-label déclarés mais pas testables |
| `appointments.ts` | 137 | CRUD OK |
| `reviews.ts` | 264 | Module reviews OK structure, mais GBP API stub (cf. gbp.ts) |
| `lead-notes.ts` | 114 | OK |

### 🟠 STUB / SUPERFICIEL — à refaire

| Module | LOC | Problème grave |
|---|---|---|
| **`gbp.ts`** | 25 | Google Business Profile API en 25 lignes = STUB. La vraie GBP API utilise OAuth2 user-scoped, **PAS** une API key. Code ne fonctionnera jamais avec `GBP_API_KEY` simple. À refaire ou désactiver. |
| **`gcal.ts`** | 76 | Google Calendar OAuth en 76 lignes = stub. Manque : OAuth callback page, refresh token storage, expiration handling, 2-way sync. À refaire ou désactiver. |
| **`ai.ts`** | 106 | **Contradictions** : ligne 6 mélange `ANTHROPIC_API_KEY \|\| OPENAI_API_KEY`. `handleAiChat` (l.19-46) utilise OpenAI `gpt-4o-mini`. Les autres handlers utilisent Claude `claude-haiku-4-5-20251001`. Commit dit "Claude Haiku 4.5" mais 50% du module utilise OpenAI. À aligner sur Claude uniquement. |
| **`broadcast.ts`** | 60 | Envoie 500 emails en **boucle séquentielle** dans un Worker fetch handler. Timeout 30s Workers free tier → garanti échec sur >100 emails. À refactorer en Cloudflare Queue jobs. |

### 🔴 HORS SCOPE ACTUEL — à retirer/disable

| Module | LOC | Pourquoi le retirer |
|---|---|---|
| **`migrate.ts`** | 653 | **Migration depuis GHL réel via PIT token.** Hors scope phase construction. À déplacer en `_disabled/` ou flag feature `MIGRATION_GHL_ENABLED=false`. |

---

## 3. Dépendances externes — explosion non gérée

`src/worker/types.ts` déclare **15+ env vars externes** :

```typescript
ADMIN_PASSWORD, RESEND_API_KEY, WEBHOOK_SECRET, NOTIFICATION_EMAIL,
ALLOWED_ORIGINS, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
OPENAI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
GBP_API_KEY, ANTHROPIC_API_KEY,
FILES (R2 binding), WEBCHAT_ROOMS (DO binding)
```

**Problèmes :**

1. **Aucun mode dev avec mocks.** Si Rochdi lance `bun run dev` sans toutes ces clés → 50% des features crashent ou renvoient 500.
2. **Aucune feature flag.** Pas moyen de désactiver "Reviews" ou "AI" si les clés manquent — le code essaie quand même.
3. **Coût opérationnel :** Resend gratuit, Twilio payant (~$1/mois + SMS), OpenAI payant (~$5-50/mois selon usage), Anthropic payant, Google Cloud API payant. Pour CONSTRUIRE l'app et la tester, Rochdi paierait $20-100/mois en services qu'il n'utilise pas vraiment.
4. **Risque de leak :** si Rochdi commit accidentellement une clé en `.env`, c'est sur GitHub.

**Solution rectification :**
- Créer `src/worker/mocks/` avec :
  - `mock-resend.ts` (simule envoi email, log console, stocke en DB pour visualiser dans inbox)
  - `mock-twilio.ts` (simule SMS, idem)
  - `mock-anthropic.ts` (réponses canned pour AI scoring/generate)
  - `mock-gcal.ts`, `mock-gbp.ts` (fixtures statiques)
- Flag global `env.USE_MOCKS = true` en dev (default), `false` en prod
- Au boot du worker : `const sendEmail = env.USE_MOCKS ? mockResend : realResend`
- Permet de développer 100% local sans aucune clé externe

---

## 4. Tests = 0

Aucun fichier `*.test.ts` ou `*.spec.ts`. Aucun framework de test installé.

`bun run build` = TypeScript compile + Vite build. Ça ne prouve PAS que :
- Les routes répondent correctement
- Les migrations SQL sont idempotentes
- Le workflow engine exécute les steps
- Le webchat WebSocket fonctionne
- L'upload R2 fonctionne
- La signature de doc génère un vrai PDF
- Le sanitize input filtre les injections SQL

**Solution rectification :**
- Installer `vitest` + `@cloudflare/vitest-pool-workers`
- Smoke tests sur les 20 routes critiques (200 OK + payload conforme)
- Tests unitaires sur sanitize/crypto/compliance helpers
- 1 test e2e par module fonctionnel (creer lead → log activité → trigger workflow → message envoyé via mock)

---

## 5. Frontend — pages existent mais features ?

20 pages dans `src/pages/`. Les commits design D.1 → D2.8 ont refondu le visuel partout (palette Intralys appliquée). Mais les features sous-jacentes :

| Page | Visuel done | Features réellement câblées ? |
|---|---|---|
| Dashboard | ✅ | Stats OK probable. KPIs `total_deal_value`, `avg_conversion_days` = 0 hardcoded au début, à vérifier. |
| Leads | ✅ | CRUD + bulk OK. Filtres avancés DEPTH-AUDIT §2 ? |
| LeadDetail | ✅ | 5 tabs done, 9 tabs visés. DND toggle implémenté. Custom fields rendering ? |
| Pipeline | ✅ | Drag&drop OK. Multi-pipelines UI customization ? |
| Inbox | ✅ | 3 panneaux design. Composer fonctionne ? Snippets ? Schedule send ? |
| Calendar | ✅ | 4 vues design. Drag-to-reschedule fonctionne ? Sync Google ? |
| Workflows + WorkflowBuilder + WorkflowDetail | ✅ | Canvas 2D React Flow ? Branches conditionnelles ? Test runner ? |
| Templates | ✅ | Visual builder MJML ? Live preview ? |
| Tasks | ✅ | Subtasks ? Comments ? Attachments ? |
| Settings | ✅ | 30+ sous-pages prévues — combien câblées ? |
| Reports | ✅ | 12 onglets ? PDF export ? Schedule email ? |
| Documents | ✅ | Upload R2 + canvas signature fonctionnent end-to-end ? |
| Reviews | ✅ | Vrai data depuis GBP ou fixtures ? |
| Integrations | ✅ | OAuth flows réels ou juste UI statique ? |
| Login + ChangePassword | ✅ | OK |
| Clients + ClientLeads | ✅ | Switcher sub-account fonctionne ? |

**Risque :** Antigravity a peut-être fait du "visuel only" sur la moitié des pages, avec données fictives ou non-câblées au backend. À vérifier page par page en lançant `bun run dev`.

---

## 6. Contradictions et code smells observés

| # | Smell | Fichier | Impact |
|---|---|---|---|
| 1 | Mélange Anthropic + OpenAI dans même file | `ai.ts` L6, L19 | Incohérence, deux factures à payer, dépendances doubles |
| 2 | Boucle séquentielle 500 emails | `broadcast.ts` L32-48 | Timeout Worker garanti, perte d'emails |
| 3 | Google Business Profile en API key (vrai = OAuth) | `gbp.ts` | Code mort en prod réelle |
| 4 | Google Calendar 76 lignes (vraie sync = 500+ lignes) | `gcal.ts` | Stub, ne fonctionnera pas |
| 5 | Migration prod GHL livrée mais pas demandée maintenant | `migrate.ts` | Confusion architecture |
| 6 | Pas de feature flags | partout | Tout-ou-rien |
| 7 | Pas de mode dev sans API externes | partout | Dev impossible sans payer |
| 8 | Pas de tests | tout le projet | Build vert ≠ code qui marche |
| 9 | `text-content` non lu dans broadcast | `broadcast.ts` L12 | Email reçu vide en mode text-only |
| 10 | `client_id` non filtré dans broadcast WHERE si filters.tags présent | `broadcast.ts` | Risque cross-tenant si tags partagés |
| 11 | Score lead castré en string : `bind(String(parsed.score))` | `ai.ts` L72 | Colonne attend integer, peut casser |
| 12 | `audit_log` insert dans broadcast.ts hors helper | `broadcast.ts` L28 | Pas DRY, divergence possible avec helper audit() |
| 13 | `recipient_count: leads.length` avant filtrage unsubscribe | `broadcast.ts` L28 | Count inexact |

---

## 7. Phase prochaine RECTIFIÉE — Sprint Consolidation (~10j)

**Abandon temporaire de Sprint Design 2 + Sprint 3 Vertical Conversations.** Avant d'ajouter du nouveau, on consolide ce qui existe.

### Phase C.0 — Documenter l'état réel (0.5j)
- Créer `README-DEV.md` qui dit :
  - Comment lancer l'app en local sans aucune clé externe
  - Quelles features marchent en mode dev / quelles features sont mockées
  - Les 20 routes API testables avec curl + auth bearer
  - Le seed data attendu (clients, leads, templates de démo)

### Phase C.1 — Désactiver hors-scope (0.5j)
- Déplacer `src/worker/migrate.ts` → `src/worker/_v2-backlog/migrate.ts`
- Retirer route `/api/migrate/*` du router central worker.ts
- Documenter en commentaire dans `_v2-backlog/README.md` : "Migration depuis GHL réel — re-activera quand le clone sera prêt pour migration prod V2"

### Phase C.2 — Mode dev avec mocks (2j)
Créer `src/worker/mocks/` :
- `mock-resend.ts` : log email console + INSERT dans table `messages` avec `channel='email'` `status='mock-sent'`. Permet de voir dans inbox les emails "envoyés" sans Resend.
- `mock-twilio.ts` : idem pour SMS
- `mock-anthropic.ts` : réponses prédéfinies pour `handleAiScore` (retourne 65 par défaut), `handleAiGenerate` (retourne lorem ipsum FR), `handleAiSuggestWorkflow` (retourne workflow template fixé)
- `mock-google-calendar.ts` : fixtures statiques d'appointments simulés
- `mock-gbp.ts` : fixtures 5 reviews fictives

Wiring :
- Ajout `USE_MOCKS: string` dans Env interface
- Wrapper dans `messages.ts`, `ai.ts`, etc. :
  ```ts
  const sender = env.USE_MOCKS === 'true' ? mockResend : realResend(env);
  ```
- Default `USE_MOCKS=true` dans `wrangler.jsonc` vars (dev)
- En prod : `npx wrangler secret put USE_MOCKS=false`

### Phase C.3 — Fix contradictions critiques (1.5j)
- **ai.ts** : aligner sur Claude uniquement. Retirer code OpenAI. Garder une seule `callClaude(env, sp, um, max)` helper. `gpt-4o-mini` → `claude-haiku-4-5-20251001`.
- **broadcast.ts** :
  - Refactorer en Cloudflare Queue : POST `/api/broadcast/email` push un job, worker consume async avec batch 50 emails par invocation, log progress dans table `broadcasts (id, status, sent, failed, total)`
  - Filter unsubscribe AVANT count `recipient_count`
  - Lire `text_content` aussi pas juste `body_text`
  - Garde contre cross-tenant : `client_id` obligatoire si filters.tags présent
- **ai.ts L72** : `bind(parsed.score)` (number direct, pas string)
- **types.ts** : retirer `OPENAI_API_KEY` (consolidé sur Claude)

### Phase C.4 — Couper ou compléter stubs (1.5j)
3 options par stub : KEEP-PARTIAL (assumer feature limitée), DISABLE (retirer route + UI), REWRITE.

| Module | Choix recommandé |
|---|---|
| `gbp.ts` | **DISABLE** — retirer route `/api/gbp/*` + cacher page Reviews tab GBP. Re-activera quand on aura un vrai compte GBP setup. Mock fixtures dans Reviews page. |
| `gcal.ts` | **DISABLE** — retirer route Google Calendar OAuth + cacher CTA "Connect Google Calendar" dans Calendar page. Re-activera plus tard. |
| `ai.ts` | **KEEP-PARTIAL** (après fix Claude-only). Garder scoring + generate + suggest_workflow. Mock activable. |
| `broadcast.ts` | **REWRITE** en Queue (cf. C.3). |
| `migrate.ts` | **DISABLE** (cf. C.1). |
| `webchat.ts` | **KEEP** — Durable Objects OK |
| `documents.ts` | **KEEP** — R2 OK |

### Phase C.5 — Smoke tests (2j)
- Installer `vitest` + `@cloudflare/vitest-pool-workers`
- 1 test file par module worker critique :
  - `auth.test.ts` : login → token retourné, change password, session expirée 401
  - `leads.test.ts` : create + get + patch + delete + bulk + pagination
  - `workflows.test.ts` : create workflow + enroll lead + step exécuté via cron mock
  - `compliance.test.ts` : unsubscribe token sign/verify, footer CASL injecté
  - `webchat.test.ts` : WebSocket connect + send + receive
  - `documents.test.ts` : upload mock R2 + signature recorded
  - `ai.test.ts` : scoring retourne 0-100 (avec mock)
- Run via `bun run test`
- Ajouter `test` script dans package.json
- Cible : 30-50 tests passants minimum après C.5

### Phase C.6 — Seed data réaliste (1j)
Élargir `seed.sql` actuel pour avoir un dataset démo crédible :
- 3 clients (Mathis, Serujan, Gatineau)
- 30 leads (10 par client, variés en statut, source, score)
- 15 conversations avec messages historiques (email, sms, internal_note)
- 8 workflows pré-configurés
- 5 custom fields (Budget, Délai, Type propriété, Adresse, Référé par)
- 3 smart lists par défaut
- 10 templates email + 5 SMS
- 12 tasks variées
- 8 appointments (passés, à venir, no-show)
- 5 documents avec audit trail

Permet de cliquer sur n'importe quelle page après `bun run db:init` et voir du contenu réaliste.

### Phase C.7 — Frontend audit + fix câblages (1j)
Page par page (15-30 min chacune) :
- Lancer `bun run dev` + ouvrir la page dans browser
- Vérifier que toutes les actions UI fonctionnent (CRUD, filtres, bulk, etc.)
- Lister les boutons non-câblés / actions sans handler dans `FRONTEND-WIRING-AUDIT.md`
- Fix les plus critiques

---

## 8. Total Sprint Consolidation

| Phase | Effort | Cumul |
|---|---|---|
| C.0 README-DEV | 0.5j | 0.5j |
| C.1 Désactiver hors scope | 0.5j | 1j |
| C.2 Mocks + mode dev | 2j | 3j |
| C.3 Fix contradictions | 1.5j | 4.5j |
| C.4 Couper/compléter stubs | 1.5j | 6j |
| C.5 Smoke tests | 2j | 8j |
| C.6 Seed data réaliste | 1j | 9j |
| C.7 Frontend audit + fix | 1j | 10j |
| **Total Sprint Consolidation** | **~10j** | — |

À la fin : Rochdi a une app **qui marche en local sans aucune API externe payante**, avec **tests** qui prouvent que ça marche, **seed data** qui rend la démo crédible, et un code **cohérent** (pas de contradictions Claude vs OpenAI, pas de stubs muets).

**ENSUITE seulement** on peut reprendre Sprint Design 2 + Sprint 3 Vertical Conversations en confiance.

---

## 9. Docs à rectifier

Les docs suivants contiennent des références à "migration GHL réelle / PIT token / contacts Mathis" qu'il faut **retirer ou marquer V2-BACKLOG** :

| Doc | Action |
|---|---|
| `ANTIGRAVITY-TODO.md` | OK (P0-P2) — pas de migration prod mentionnée |
| `ANTIGRAVITY-PHASE3-CATCHUP.md` | Retirer §P3.2 mention "GHL → notre clone migration" (garder e-sign feature, pas la migration) |
| `ANTIGRAVITY-GHL-INVENTORY.md` | Marquer §1 audit GHL comme "RÉFÉRENCE pour comprendre quelles features cloner" pas "data à importer" |
| `ANTIGRAVITY-GHL-COMPLETENESS.md` | Retirer **toute la §2 Migration data** (M1-M15). Déplacer en V2-BACKLOG. La roadmap "fermer GHL" devient "construire un clone GHL complet" — fermer GHL viendra quand le clone tournera. |
| `ANTIGRAVITY-SPRINT1-PLAN.md` | Retirer Phase 1.3 Migration GHL. Sprint 1 devient juste refactor + MVP P4 + quick wins. |
| `ANTIGRAVITY-SPRINT-COMBO-PLAN.md` (si existe) | Retirer 3.3 Migration M2 |
| `ANTIGRAVITY-DESIGN-SPRINT.md` | Garder tel quel (frontend, pas concerné) |
| `ANTIGRAVITY-DEPTH-AUDIT.md` | Marquer §2 migration items M1-M15 comme "V2 quand migration prod sera priorité" |

Tous les **prompts envoyés à Antigravity** (Sprint 1, Sprint 2 Vertical Leads, Combo B+A) qui mentionnaient migration GHL réelle sont **OBSOLÈTES**.

Nouveau prompt à venir : **Sprint Consolidation** (cf. §7).

---

## 10. Workflow corrigé pour la suite

```
✅ Sprint 0     P0+P1+P2+P3 (livré, 40+ commits)
✅ Sprint Design 1  Dashboard + Leads + LeadDetail refondus (livré)
✅ Sprint Design 2  7 autres pages refondues (livré D2.1-D2.8)
🔜 Sprint Consolidation (10j)   ← NOUVEAU — à faire MAINTENANT
   ↓
🔜 Sprint 3 Vertical Conversations (sans migration M2, juste features)
🔜 Sprint 4 Vertical Pipeline + Workflows
🔜 Sprint 5 Vertical Calendar + Tasks
🔜 Sprint 6 Settings + Reports + admin
🔜 Sprint 7 Templates + Forms + AI killer features
🔜 Sprint 8 Mobile responsive + PWA
🔜 Sprint 9 Différenciateurs Intralys (AMF, OACIQ, Centris, mode visite)
🔜 Sprint App Mobile (Capacitor V1 puis React Native V2)

V2 BACKLOG (3-6 mois plus tard, quand le clone est mature) :
- Migration depuis GHL réel (M1-M15)
- Connecter de vrais comptes Twilio/Stripe/Google
- Première migration courtier production (Mathis Guimont)
```

---

## 11. Status tracker rectifié

| Item | Status |
|---|---|
| Sprint 0 (P0+P1+P2+P3) | ✅ Done (40 commits, qualité mitigée — cf. §6) |
| Sprint Design 1 (3 pages) | ✅ Done |
| Sprint Design 2 (7 pages) | ✅ Done (commits D2.1→D2.8) |
| **Sprint Consolidation (10j)** | ⬜ **TODO — phase actuelle** |
| Sprint 3 Vertical Conversations | 🔒 bloqué tant que Consolidation pas finie |
| Sprint 4+ | 🔒 idem |

---

_Document généré le 2026-05-10 par Claude Opus 4.7. Audit honnête. Cap rectifié vers MODE CONSTRUCTION (pas migration prod GHL). Sprint Consolidation = priorité absolue avant toute nouvelle feature._
