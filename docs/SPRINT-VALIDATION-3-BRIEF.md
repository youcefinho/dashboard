# Brief validation Antigravity — 3e vague (sprints 2e ordre A→F, seq 97→102)

> Prompt prêt à copier-coller dans Antigravity (Gemini, qui a bun/node sur le repo).
> Préparé 2026-05-21. Empilé par-dessus les 2 vagues déjà validées vertes (seq 79→96).

---

```
## Mission : Validation groupée build + tests + migrations (Intralys — 3e vague, sprints 2e ordre)

Tu valides une 3e vague de code écrite sans build (VM VMware sans bun/node), EMPILÉE
par-dessus une base déjà validée verte 2× (seq 79→96). Tout est code-complete, jamais
rebuildé depuis. Objectif : build vert + tests non-régression verts + migrations 97→102
enchaînées.

NE CHANGE PAS la logique métier. Corrige UNIQUEMENT erreurs build/types/tests
(imports, signatures, types, casts). Si tu dois toucher de la logique, ARRÊTE et
liste-moi les cas — ne devine pas.

### Étape 1 — Build
- `bun install` si besoin
- `bun run build` (Vite front) → 0 erreur (warning chunk >600kB connu, pas une erreur)
- `tsc -p tsconfig.worker.json` → 0 erreur worker
Liste toutes les erreurs, corrige les non-structurelles, recompile jusqu'au vert.

### Étape 2 — Migrations 97 → 102 (additives, depends_on chaîné) — EN LOCAL (pas prod)
Via `scripts/migrate.ts` (détecte les pending) OU `wrangler d1 execute <db> --local --file=...` :
- 97 `migration-scheduled-reports-seq97.sql` (table scheduled_reports)
- 98 `migration-multilang-out-seq98.sql` (ALTER leads ADD preferred_language + index)
- 99 `migration-proactive-ai-seq99.sql` (churn_scores + proactive_alerts)
- 100 `migration-attribution-cohort-seq100.sql` (lead_touchpoints)
- 101 `migration-portal-seq101.sql` (portal_users + portal_sessions + portal_sites)
- 102 `migration-telephony-seq102.sql` (call_logs + ivr_menus)
Toutes additives (CREATE TABLE IF NOT EXISTS + INDEX idempotents ; seq 98 = 1 ALTER ADD
COLUMN nullable sans contrainte). `duplicate column`/déjà-présent = TOLÉRÉ. Timestamps
datetime('now'). Confirme : CHECK role users seq 59 jamais touché, tables E4/E6
(payments/refunds/disputes) jamais touchées.

### Étape 3 — Tests non-régression (DOIVENT rester verts)
`bun run test` (Vitest). Les suites déjà vertes (tenant-context, lot1..4, ecommerce-multitenant,
teamA-*, leads-api-role, + toutes) ne doivent PAS régresser. Corrige les tests cassés par
dérive de types/signatures SANS toucher la logique testée. Vraie régression → ARRÊTE et signale.

### Périmètre de cette vague (par sprint)

**A. Reporting planifié (97)** — `scheduled-reports.ts` (CRUD + processor cron best-effort calque
ecommerce-subscriptions + buildActivityDigestHtml SELECT bornés client_id + Resend mock honnête),
hook scheduled() worker.ts, api.ts, i18n reports.scheduled.*, Reports.tsx onglet + ScheduledReportsPanel.
Vigilance : processor best-effort jamais throw ; digest ne réutilise PAS handleReportsOverview (non borné).

**B. Multi-langue sortant (98)** — `i18n-server.ts` (tLead pur, importe catalogues PAS la fn t() navigateur),
ALTER leads preferred_language, PATCH/ingestion capture, compliance.generateCaslFooter(url,locale='fr-CA')
param optionnel byte-identique, broadcast SELECT preferred_language, reviews localisé, segments.ts critère
langue, LeadDetail sélecteur, Leads.tsx filtre. Vigilance : byte-identique fr-CA préservé (ancienne string FR
si locale=fr-CA) ; documents.ts volontairement non-i18n (dette tracée).

**C. IA proactive batch (99)** — `proactive-ai.ts` (runProactiveBatch DISTINCT client_id + generateChurnScores/
generateNbaAlerts DÉTERMINISTE PUR zéro LLM + createNotification récap), hook cron, routes /api/ai/proactive/alerts,
ProactiveAlertsWidget.tsx + Dashboard montage. Vigilance : zéro Claude en batch (coût) ; bornage tenant itéré ;
computeDeterministic répliqué (lead-predict non exporté).

**D. Attribution multi-touch (100)** — `touchpoints.ts` (recordTouchpoint best-effort sentinel -1), 2 hooks
leads.ts (création+merge try/catch total), reports.ts handleReportsAttribution (4 modèles) + handleReportsLeadCohorts
(calque ecommerce), AttributionPanel.tsx + CohortHeatmap.tsx. Vigilance : multi-touch prospectif (convergent si 1 touch) ;
hooks leads.ts ne cassent jamais l'ingestion.

**E. Portail client (101)** — `portal-auth.ts` (requirePortalUser séparé, jamais users/admin_sessions/members),
`portal.ts` (5 agrégateurs ISOLATION DOUBLE lead_id+client_id + create ticket + config PRO), PortalSpace.tsx +
PortalSettings.tsx, routes /portal/$slug + /portal-settings. Vigilance : isolation double (lead_id ET client_id
session jamais body) ; facture lecture seule (zéro payment_url) ; token intralys_portal_token distinct.

**F. Téléphonie (102)** — `telephony.ts` NEUF (voice.ts INTOUCHÉ ; call_logs + IVR TwiML + click-to-call flag
Twilio inactif calque sendSms + status-callback), LeadDetail carte Appels, Settings tab telephonie.
Vigilance : credentials Twilio absents → call_log mock sans appel réseau ; escapeXml TwiML ; routes webhook
/api/voice/ivr + /status-callback sans collision avec /api/voice/twiml + /webhook/record existantes.

### Dettes mineures
- ✅ Sprint A (labels jours-semaine + placeholder/helper destinataires) + Sprint F ("Transcription"/IVR JSON invalide) : **NETTOYÉS le 2026-05-21** (11 clés i18n ×4 parité ajoutées + câblées — voir `docs/LOT-I18N-CLEANUP.md`). Inclus dans cette vague à valider.
- Sprint B : `documents.ts` non-i18n-isé (copy OACIQ légal, clés system.doc_* à créer) = v2 volontairement (touche logique d'envoi + byte-identique légal, hors scope nettoyage carte-blanche).
- Sprint D : multi-touch prospectif (modèles convergent tant qu'1 touch/lead — densifie avec le temps, par conception).

### Livrable
Rapport : build OK/KO + corrections faites (par fichier) + tests (X passés/Y échoués) +
migrations 97→102 appliquées local OK/KO + toute vraie régression fonctionnelle (signalée, PAS corrigée).
```
