# GOLIVE-S10 — Sprint S10 « Production-readiness & go-live »

> DERNIER sprint du programme de renforcement plateforme Intralys.
> Manager A (Phase A SOLO). Ce document **consolide** les 5 gates Rochdi
> (jusqu'ici épars : `SECRET-STORE-S7.md:95`, `ONBOARDING-S8.md:232`,
> `PERF-S9.md:312-320`), fige les contrats partagés (`## §6`), et clôt la
> plateforme par une synthèse finale honnête.
>
> ⚠️ **VM VMware : aucune commande git/bun/node exécutée ici.** Toute mention
> de build/test/migration est **« écrit, NON exécuté (VM VMware) — à exécuter
> par Rochdi »**. Ce sprint ne produit QUE de la documentation (aucun code,
> aucune migration, aucune DB touchée).

---

## ✅ SPRINT R — RÉSOLU 2026-05-17 (restauration Antigravity)

**Régression i18n levée.** Les 6 pages cœur CRM (`Leads`, `Dashboard`,
`LeadDetail`, `Tasks`, `Pipeline`, `Clients`) restaurées depuis commit
`5764096` (parent du S6-M2 cassé `84e909b`), réparation `7846e72` sur
`master`. **Vérifié disque** : 0 `t()` orphelin, FR hardcodé restauré,
build vert (tsconfig exclut `src/**/__tests__`, tests via vitest),
2 doublons `calendar.*` nettoyés sans casser S9 (parité 79×4 catalogues),
vérif visuelle navigateur OK.

**Dette future NON bloquante** : 6 pages dé-i18n (FR hardcodé) →
fr-FR/en/es en FR sur ces pages. Acceptable (cible fr-CA Québec).
Ré-i18n propre = tâche future en petits lots, clés créées AVANT conversion.

**VERDICT : R ne bloque plus le go-live.** Restent les prérequis prod
normaux : build/tests hors VM, 5 gates, PCI/légale E4/E6, bindings —
infra/qualité standard, pas une régression produit.

---

## 1. Les 5 gates Rochdi — CONSOLIDÉS (pas-à-pas)

> Source unique désormais : ce document. Ordre canonique figé. Chaque gate
> doit être franchi **dans l'ordre**, sur la machine hôte de Rochdi (jamais
> sur la VM). Un gate échoué = STOP, on ne passe pas au suivant.
>
> ⚠️ **Préalable absolu à TOUS les gates : le bloc 🔴 R ci-dessus.** Même les
> 5 gates verts ne lèvent pas R. Les gates valident l'infra ; R valide que
> l'app est utilisable. Les deux sont requis.

### Gate 1 — Build & tests

- **Objectif** : compilation TypeScript sans erreur + suite de tests verte.
- **Commande exacte** :
  - `bun run build` (= `tsc && vite build`, cf `package.json:20`)
  - `bun run test` (= `vitest run`, cf `package.json:21` — ~53 suites)
- **Critère de succès** : `bun run build` → 0 erreur TS ; `bun run test` →
  toutes suites vertes (dont `s9-backend.test.ts`, `s9-frontend.test.ts`,
  `onboarding-s8.test.ts`, `secret-store.test.ts`, `ecommerce-multitenant.*`).
- **Risque** : code-complete mais **jamais buildé sur la VM** (sandbox
  VMware). Premier build réel peut révéler des erreurs TS latentes
  (e-comm E1-E9, S7-S9). À traiter avant tout déploiement.
- **Statut** : écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.

### Gate 2 — Backup D1 prod (AVANT toute migration)

- **Objectif** : sauvegarde complète de la base de production **avant** la
  moindre migration. Filet de restauration.
- **Commande exacte** : `bun run db:backup:prod`
  (= `bash scripts/backup.sh --remote`, cf `package.json:16`).
- **Critère de succès** : artefact de backup généré et vérifié récupérable
  (taille non nulle, restaurable). À conserver hors VM.
- **Risque** : sauter ce gate = aucune voie de retour si une migration (ex.
  conflit gclid C1, rebuild E9 seq 73) corrompt ou dégrade la prod.
- **Statut** : écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.

### Gate 3 — Dry-run migrations

- **Objectif** : vérifier l'ordre exact des migrations en attente **sans rien
  appliquer**, et confirmer que la garde E9 ne se déclenche pas.
- **Commande exacte** :
  `bun run scripts/migrate.ts --remote --dry-run`
  (`db:migrate:prod` + flag `--dry-run`, `migrate.ts:220-226`).
- **Critère de succès** :
  - L'ordre listé suit `docs/migrations-manifest.json` seq **1 → 77**
    (S7=75 `integration_secrets`, S8=76 `onboarding_state`, S9=77 index +
    `web_vitals`).
  - **AUCUN** `⛔ STOP` de la garde E9 (`migrate.ts:172-183`) : si
    `migration-sprintE9-m1.sql` (seq 73, `rebuild:workflow_enrollments`) est
    en attente, alors `migration-phase3.sql` (seq 3) DOIT déjà être dans
    `_migrations`. Si STOP affiché → suivre
    `docs/AUDIT-workflow-enrollments-E9.md` (backup + COUNT) AVANT Gate 4.
  - Warnings « fichier sur disque absent du manifest » = à examiner (non
    ordonné = non appliqué), mais non bloquant si attendu.
- **Risque** : sans dry-run, on découvre l'ordre / la garde E9 en plein
  `--remote` réel (déjà partiellement appliqué = état hybride).
- **Statut** : écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.

### Gate 4 — Migration prod + vérif anti-régression

- **Objectif** : appliquer les migrations en attente sur la prod, puis
  prouver qu'aucune colonne n'a été perdue (conflit gclid C1) et que les
  objets seq 77 sont bien en place.
- **Commande exacte** :
  - Application : `bun run db:migrate:prod`
    (= `bun run scripts/migrate.ts --remote`, `package.json:14`).
  - Vérif colonnes leads (conflit C1) :
    `npx wrangler d1 execute intralys-crm --remote --command "PRAGMA table_info(leads);"`
    → doit lister **toutes** les colonnes de `migration-sprint51-m2.sql` :
    `gclid`, `utm_term`, `utm_content`, `fbclid`, `referrer`,
    `consent_status`, `lead_source_id`.
  - Vérif index seq 77 :
    `npx wrangler d1 execute intralys-crm --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_leads_%' OR name LIKE 'idx_tasks_%' OR name='idx_order_items_variant' OR name LIKE 'idx_web_vitals_%');"`
  - Vérif cohérence tracker :
    `npx wrangler d1 execute intralys-crm --remote --command "SELECT COUNT(*) FROM _migrations;"`
    → cohérent avec le nombre de migrations appliquées (seq ≤ 77).
- **Critère de succès** : migrations appliquées sans erreur DURE ; les 7
  colonnes leads présentes ; index seq 77 présents ; `_migrations` cohérent.
- **Risque — CONFLIT gclid C1 (à surveiller)** :
  `migration-sprint51-m1.sql:33` ET `migration-sprint51-m2.sql:29` font tous
  deux `ALTER ... ADD COLUMN gclid`. Le 2e échoue sur `duplicate column`
  (motif **bénin** → skip best-effort au **niveau FICHIER**,
  `migrate.ts:13-24,58-61`). Conséquence possible : les **6 ALTER suivants**
  de `migration-sprint51-m2.sql` (`utm_term/utm_content/fbclid/referrer/
  consent_status/lead_source_id`) ne sont **pas appliqués** alors que le
  fichier est marqué appliqué dans `_migrations`. → **Si le `PRAGMA
  table_info(leads)` ne montre pas ces 6 colonnes** : découper manuellement
  `migration-sprint51-m2.sql` et rejouer ses 6 ALTER restants isolément
  (procédure documentée dans `migrate.ts:14-19`).
- **Statut** : écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.

### Gate 5 — Non-régression analytics multi-tenant

- **Objectif** : prouver l'isolation tenant (pas de fuite cross-`client_id`)
  et la santé du worker après déploiement.
- **Commande exacte** :
  - `bun run test` filtré : suites `ecommerce-multitenant.*` (isolation
    `client_id` agrégats E9 : revenu/cohortes/LTV/churn).
  - Post-deploy : `GET https://<domaine-prod>/api/health` → HTTP `200`,
    body `{ status:'ok', db:'ok', version:'2.1.0', uptime_s, migrations_count }`
    (champ `migrations_count` ajouté par Manager B — cf §6.4).
  - Smoke isolation : un utilisateur de `client_id` A ne voit JAMAIS les
    données d'un `client_id` B (leads, onboarding_state, agrégats e-comm).
- **Critère de succès** : suites multi-tenant vertes ; `/api/health` 200 ;
  zéro fuite cross-tenant constatée.
- **Risque** : régression d'isolation = fuite de données client (Loi 25 /
  RGPD) — incident grave. Ne PAS ouvrir la bêta sans ce gate vert.
- **Statut** : écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.

---

## 2. Synthèse finale plateforme (10 lignes)

1. **S1→S10 (renforcement)** : S1 manifest migrations figé · S2 runner
   manifest-driven + `--dry-run` + garde E9 + skip bénin · S7 secret-store
   AES-GCM (tokens intégrations chiffrés) · S8 onboarding persisté serveur
   multi-appareil · S9 8 index perf + télémétrie web-vitals · S10 (ce sprint)
   = consolidation go-live, **doc only**.
2. **E-commerce B2** : E-R + E1→E9 code-complete (plateforme e-comm
   multi-région DZ/UE/QC, paiement marchand, omnicanal, RFM/reco/churn).
3. **Code-complete** : CRM + e-comm + 77 migrations manifestées + 5 gates
   consolidés + bindings inventoriés.
4. **Reste AVANT prod (non négociable)** :
   - 🔴 **Sprint R** : 6 pages cœur CRM affichent des clés i18n brutes
     (≈185 `t()` orphelins) — BLOQUANT absolu, non enterrable.
   - Les **5 gates Rochdi** (build/tests jamais exécutés VM ; backup ;
     dry-run ; migration + vérif C1 ; non-régression multi-tenant).
   - **Revue PCI (SAQ-A) + légale E4/E6** signée ; `payments_live_enabled=0`
     non levé tant que non signé.
   - **Build jamais exécuté** sur la VM (sandbox VMware) — 1er build réel à
     faire par Rochdi.
5. **Verdict** : plateforme techniquement code-complete, **PAS prête au
   go-live** tant que R + 5 gates + revue régulée E4/E6 ne sont pas tous
   verts. La doc est honnête : rien de vert sur build/tests/R.

---

## §6 Contrats figés

> **Section transmise VERBATIM aux Managers B et C.** Tout y est EXACT et
> copiable. Phase B (B ∥ C) ne démarre qu'après lecture de ce §6.

### §6.1 — Libellé canonique du bloc 🔴 R-ROUGE (référence à l'identique)

Manager C **doit référencer ce bloc à l'identique** dans ses docs ; Manager B
le mentionne si pertinent. Texte canonique (copier tel quel) :

> **🔴 BLOQUANT GO-LIVE — SPRINT R NON REMÉDIÉ**
> Les 6 pages cœur CRM — `Leads`, `Dashboard`, `LeadDetail`, `Tasks`,
> `Pipeline`, `Clients` — affichent des clés i18n brutes (≈185 appels `t()`
> orphelins) au lieu du texte français. **VERDICT : GO-LIVE = NON.** Aucune
> autre case cochée ne rend ce verdict vert tant que R est ouvert.

> **✅ MISE À JOUR 2026-05-17 — R RÉSOLU.** Libellé §6.1 ci-dessus conservé
> pour trace historique. R a été remédié par Antigravity (restauration des
> 6 pages depuis commit `5764096`, réparation `7846e72`, 0 `t()` orphelin
> vérifié, build vert). Le bloc 🔴 n'est plus actif — voir la section
> « ✅ SPRINT R — RÉSOLU » en tête de ce document et de `LAUNCH-CHECKLIST.md`.

### §6.2 — Liste canonique numérotée des 5 gates Rochdi

Manager C les référence **par ce numéro + intitulé court figé** :

1. **Gate 1 — Build & tests** (`bun run build` 0 err TS ; `bun run test`).
2. **Gate 2 — Backup D1 prod** (`bun run db:backup:prod`, AVANT migration).
3. **Gate 3 — Dry-run migrations** (`migrate.ts --remote --dry-run` ; ordre
   seq 1-77 ; garde E9 non déclenchée).
4. **Gate 4 — Migration prod + vérif anti-régression** (`db:migrate:prod` ;
   colonnes leads post-sprint51-m2 présentes — conflit C1 ; index seq 77 ;
   `_migrations` cohérent).
5. **Gate 5 — Non-régression analytics multi-tenant** (suites
   `ecommerce-multitenant.*` ; `/api/health` 200 ; isolation `client_id`).

> Préalable transverse aux 5 : le bloc 🔴 R (§6.1) — non levé par les gates.

### §6.3 — Format figé de l'inventaire bindings (`docs/BINDINGS-SECRETS-S10.md`)

Manager C produit `docs/BINDINGS-SECRETS-S10.md`. **Tableau aux colonnes
EXACTES suivantes (aucune colonne en plus, aucune en moins, dans cet ordre)** :

```
| Binding | Type | Obligatoire/Conditionnel/Interdit-prod | Commande config | Source (types.ts:ligne) | Note |
```

Règles figées que Manager C DOIT respecter :

- **JAMAIS de valeur de secret** dans le doc — uniquement le **nom** du
  binding et la commande `wrangler secret put <NAME>` (jamais `<NAME>=valeur`,
  jamais d'exemple de clé réelle ou factice ressemblant à une clé).
- Colonne `Type` = `D1` | `R2` | `Durable Object` | `Queue` | `KV` |
  `secret (string)` | `var (string)`.
- Colonne `Source (types.ts:ligne)` = référence ligne réelle de
  `src/worker/types.ts` (source de vérité `Env`, lignes 4-58).
- Classement minimal attendu (extrait de `types.ts`, à formaliser par C — A
  ne fige QUE le format, pas l'inventaire complet) :
  - **Obligatoires** : `DB` (`:5`), `FILES` (`:19`), `WEBCHAT_ROOMS` (`:20`),
    `BROADCAST_QUEUE` (`:24`), `ADMIN_PASSWORD` (`:6`), `WEBHOOK_SECRET`
    (`:9`), `NOTIFICATION_EMAIL` (`:10`), `ALLOWED_ORIGINS` (`:11`).
  - **Conditionnels** : `ANTHROPIC_API_KEY` (`:15`, sinon `USE_MOCKS="true"`
    `:16` — actuellement `true` dans `wrangler.jsonc:39`, décision Rochdi),
    `RESEND_API_KEY` (`:7`), `TWILIO_*` (`:12-14`), `TOKEN_KEY` (`:30` — S7 :
    sinon tokens stockés EN CLAIR), `STATE_STORE` KV (`:31`, CSRF OAuth),
    `RATE_LIMITER` KV (`:26`), `META_APP_*` (`:17-18`), `GHL_*` (`:27-29`),
    `NOTIFICATION_ROOMS` (`:23`), `WEBHOOK_QUEUE` (`:25`).
  - **Régulé NON configuré (E4/E6)** : `STRIPE_SECRET_KEY` (`:38`),
    `STRIPE_WEBHOOK_SECRET` (`:39`) — tant que `payments_live_enabled=0`.
    `SHOPIFY_*` (`:46-48`) / `WOO_*` (`:49-51`) conditionnels omnicanal.
  - **Interdit-prod** : `DEV_BYPASS_AUTH` (`:32`) — JAMAIS en prod.
- **Ancrage append `PCI-RGPD-GOLIVE-checklist.md`** : Manager C ajoute, dans
  `docs/PCI-RGPD-GOLIVE-checklist.md`, une section
  **« Conditions de levée `payments_live_enabled` »** — **SEULEMENT si elle
  est absente** (C vérifie d'abord par lecture : le fichier mentionne déjà le
  flag `:33,105-106` mais sans section dédiée intitulée ainsi). Si absente,
  append en fin de fichier (additif, non destructif) renvoyant à
  `BINDINGS-SECRETS-S10.md` pour `STRIPE_*` et à la revue PCI/légale E4/E6.
  Si déjà présente → ne rien dupliquer, juste la référencer.

### §6.4 — Sémantique figée du champ health readiness (Manager B)

Manager B ajoute **un seul champ** au handler `handleHealth`
(`src/worker/health.ts:4-19`) :

- **Nom exact** : `migrations_count` (snake_case).
- **Type** : `number`.
- **Source** : `SELECT COUNT(*) FROM _migrations` (table du runner S2).
- **Caractère** : **ADDITIF et best-effort**. Le shape de réponse existant
  `{ status, db, version, uptime_s }` reste **INCHANGÉ** (mêmes clés, mêmes
  types, même ordre, `version:'2.1.0'`). `migrations_count` est **optionnel** :
  si la requête `COUNT(*)` échoue (table absente, DB lente), le champ est
  **omis** ou `null` — il ne doit JAMAIS faire passer `/api/health` en `503`
  ni changer le `status`. La branche `503` (db error) reste strictement
  identique (pas de `migrations_count` ajouté au payload d'erreur requis).
- **Alignement** : la checklist (Manager A, `LAUNCH-CHECKLIST.md` Gate 5) et
  le test (Manager B) référencent ce champ par ce nom exact `migrations_count`.

### §6.5 — INTERDICTIONS (rappel non négociable B/C)

- 🚫 **JAMAIS** ouvrir en écriture : `src/pages/{Leads,Dashboard,LeadDetail,
  Tasks,Pipeline,Clients}.tsx` (6 pages verrouillées sprint R).
- 🚫 **AUCUNE** clé i18n sous `leads.* / dashboard.* / tasks.* / pipeline.* /
  clients.* / leadDetail.*` (namespaces R).
- 🚫 Zones E4/E6 paiement (`stripe-provider.ts`, `ecommerce-payments.ts`,
  refund/dispute) : intouchées. `payments_live_enabled=0` non levé.
- 🚫 Migrations historiques (seq 1-77 figées) : aucune édition. `scripts/
  migrate.ts` (runner S2 figé) : aucune modification.
- 🚫 `wrangler.jsonc`, `index.html`, `public/sitemap.xml` : intouchés.
- 🚫 Helpers figés (rappel S9 §8) : `schemas.ts`+`validate()`,
  `validate-response.ts`, `error-response.ts`, `logger.ts`, `audit()`,
  `webVitals.ts`, `vite.config.ts`.

---

## Activation (Rochdi)

> VM VMware = aucune commande jouée ici. Tout ci-dessous est **écrit, NON
> exécuté — à exécuter par Rochdi sur la machine hôte**, dans l'ordre.

**Ordre impératif :**

1. **D'ABORD** : remédier le **🔴 sprint R** (6 pages CRM i18n) — prérequis
   dur, hors scope S10 (S10 = doc only). Sans R remédié, tout le reste est
   inutile pour un go-live.
2. **Gate 1** : `bun run build` (0 err TS) puis `bun run test` (~53 suites).
3. **Gate 2** : `bun run db:backup:prod` (backup AVANT toute migration).
4. **Gate 3** : `bun run scripts/migrate.ts --remote --dry-run` (ordre seq
   1-77, garde E9 non déclenchée).
5. **Gate 4** : `bun run db:migrate:prod` + `PRAGMA table_info(leads)` (7
   colonnes sprint51-m2 — conflit C1) + vérif index seq 77 + `COUNT(*)
   _migrations`.
6. **Gate 5** : suites `ecommerce-multitenant.*` + `GET /api/health` 200
   (`migrations_count` présent) + smoke isolation cross-tenant.
7. **Revue régulée** : PCI (SAQ-A) + légale E4/E6 signée AVANT toute levée de
   `payments_live_enabled` — cf `docs/PCI-RGPD-GOLIVE-checklist.md` (NON
   dupliqué ici, source de vérité régulée).
8. Configuration bindings/secrets : cf `docs/BINDINGS-SECRETS-S10.md`
   (produit par Manager C — `wrangler secret put <NAME>`).
9. SEO canonical à trancher (`index.html` `intralys.com` vs `wrangler.jsonc`/
   sitemap `crm.intralys.com`) — décision Rochdi (cf `LAUNCH-CHECKLIST.md`).
10. Purge cache Cloudflare + smoke E2E (login, onboarding) post-deploy.

**Statut Phase A** : `LAUNCH-CHECKLIST.md` réécrit + ce document créé.
**§6 FIGÉ → Phase B (Manager B ∥ Manager C) peut démarrer.**
