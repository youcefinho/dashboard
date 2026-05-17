# Liste de contrôle — Go-live & lancement bêta Intralys

> **Doc maître unique de go-live.** Réécrit Sprint S10 (renforcement
> plateforme — dernier sprint). L'ancienne version (datée 12 mai, antérieure
> au runner S2 / 77 migrations / E1-E9 / S7-S9) est **obsolète et remplacée
> en place**.
>
> ⚠️ **VM VMware : aucune commande git/bun/node n'a été exécutée pour produire
> ce document.** Chaque item ci-dessous est **écrit, NON exécuté — à exécuter
> par Rochdi** sur la machine hôte. Aucune case n'est cochée : rien n'est
> vert tant que Rochdi n'a pas exécuté et vérifié.
>
> Documents liés (RÉFÉRENCÉS, non dupliqués) : `docs/GOLIVE-S10.md` (5 gates
> détaillés pas-à-pas + synthèse plateforme + §6 contrats),
> `docs/PCI-RGPD-GOLIVE-checklist.md` (PCI SAQ-A / RGPD-Loi 25 / multi-région
> / E4-E6 — **source de vérité régulée**), `docs/BINDINGS-SECRETS-S10.md`
> (inventaire bindings/secrets), `docs/SECRET-STORE-S7.md` /
> `docs/ONBOARDING-S8.md` / `docs/PERF-S9.md` (sections « Activation »).

---

## ✅ SPRINT R — RÉSOLU 2026-05-17 (restauration Antigravity)

**Régression i18n levée.** Les 6 pages cœur CRM (`Leads`, `Dashboard`,
`LeadDetail`, `Tasks`, `Pipeline`, `Clients`) ont été restaurées par
Antigravity depuis le commit `5764096` (parent du commit S6-M2 cassé
`84e909b`), commit de réparation `7846e72` poussé sur `master`.
**Vérifié sur disque** : 0 appel `t()` orphelin dans les 6 pages, texte
FR hardcodé restauré, build `bun run build` vert (tsconfig exclut
désormais `src/**/__tests__` ; tests toujours exécutés via vitest),
2 doublons i18n `calendar.*` nettoyés sans casser S9 (parité 79 clés ×
4 catalogues). Vérif visuelle navigateur OK (Antigravity).

**Dette future tracée (NON bloquante go-live)** : les 6 pages sont
dé-internationalisées (FR hardcodé) → fr-FR/en/es affichent du FR sur
ces pages. Acceptable (marché cible fr-CA Québec). Ré-i18n propre = tâche
future en petits lots (créer TOUTES les clés AVANT conversion).

**VERDICT : R ne bloque plus le go-live.** Restent les gates de prod
normaux ci-dessous (build/tests exécutés hors VM, 5 gates, PCI/légale
E4/E6, bindings) — ce sont des prérequis d'infra/qualité standard, pas
une régression produit.

- [x] **Sprint R remédié** : 6 pages CRM affichent le FR (zéro clé brute)
      — restauration commit `5764096`, vérifié disque + navigateur.

---

## 1. Build & tests — **Gate 1**

- [ ] **(Rochdi)** `bun run build` → **0 erreur TypeScript**
      (= `tsc && vite build`, `package.json:20`).
      *Risque : code-complete mais jamais buildé sur la VM (sandbox VMware) —
      1er build réel peut révéler des erreurs TS latentes E1-E9 / S7-S9.*
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** `bun run test` → **toutes suites vertes** (~53)
      (= `vitest run`, `package.json:21` ; inclut `s9-backend`,
      `s9-frontend`, `onboarding-s8`, `secret-store`, `ecommerce-multitenant`).
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*

## 2. Backup D1 prod — **Gate 2** (AVANT toute migration)

- [ ] **(Rochdi)** `bun run db:backup:prod`
      (= `bash scripts/backup.sh --remote`, `package.json:16`) — backup
      vérifié récupérable, conservé hors VM.
      *Risque : sans backup, aucune voie de retour si une migration dégrade
      la prod (conflit gclid C1, rebuild E9).*
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*

## 3. Dry-run migrations — **Gate 3**

- [ ] **(Rochdi)** `bun run scripts/migrate.ts --remote --dry-run`
      (`migrate.ts:220-226`) → ordre listé = `docs/migrations-manifest.json`
      **seq 1 → 77** (S7=75 `integration_secrets`, S8=76 `onboarding_state`,
      S9=77 index + `web_vitals`).
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** **Garde E9 NON déclenchée** : aucun `⛔ STOP`. Si
      `migration-sprintE9-m1.sql` (seq 73) en attente → `migration-phase3.sql`
      (seq 3) DOIT déjà être dans `_migrations` (`migrate.ts:172-183`). STOP
      affiché → suivre `docs/AUDIT-workflow-enrollments-E9.md` avant Gate 4.
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*

## 4. Migration prod + anti-régression — **Gate 4**

- [ ] **(Rochdi)** `bun run db:migrate:prod`
      (= `bun run scripts/migrate.ts --remote`, `package.json:14`) → aucune
      erreur DURE non reconnue.
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** **Conflit gclid C1 vérifié** :
      `npx wrangler d1 execute intralys-crm --remote --command "PRAGMA table_info(leads);"`
      → présence de **toutes** ces colonnes : `gclid`, `utm_term`,
      `utm_content`, `fbclid`, `referrer`, `consent_status`,
      `lead_source_id`. *Si manquantes : double `ALTER ADD COLUMN gclid`
      (`migration-sprint51-m1.sql:33` + `sprint51-m2.sql:29`) → 2e fichier
      skip bénin au niveau FICHIER → 6 ALTER suivants perdus. Découper
      manuellement `migration-sprint51-m2.sql` et rejouer ses 6 ALTER
      restants isolément (`migrate.ts:14-19`).*
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** Index seq 77 présents :
      `npx wrangler d1 execute intralys-crm --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_leads_%' OR name LIKE 'idx_tasks_%' OR name='idx_order_items_variant' OR name LIKE 'idx_web_vitals_%');"`
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** `_migrations` cohérent :
      `npx wrangler d1 execute intralys-crm --remote --command "SELECT COUNT(*) FROM _migrations;"`
      → cohérent avec migrations appliquées (seq ≤ 77).
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*

## 5. Non-régression analytics multi-tenant — **Gate 5**

- [ ] **(Rochdi)** Suites `ecommerce-multitenant.*` vertes (isolation
      `client_id` agrégats E9 : revenu/cohortes/LTV/churn).
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** `GET https://<domaine-prod>/api/health` → HTTP **200**,
      body `{ status:'ok', db:'ok', version:'2.1.0', uptime_s,
      migrations_count }`. *(`migrations_count` = champ readiness additif
      best-effort ajouté par Manager B — shape existant inchangé ;
      `src/worker/health.ts`.)*
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** Smoke isolation : utilisateur `client_id` A ne voit JAMAIS
      les données de `client_id` B (leads, onboarding_state, agrégats e-comm).
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*

> Détail pas-à-pas des 5 gates (objectif / commande / critère / risque) :
> **`docs/GOLIVE-S10.md` §1**. NON dupliqué ici.

## 6. Bindings & secrets Cloudflare

- [ ] **(Rochdi)** Tous les bindings **obligatoires** configurés : `DB`,
      `FILES` (R2), `WEBCHAT_ROOMS` (DO), `BROADCAST_QUEUE`,
      `ADMIN_PASSWORD`, `WEBHOOK_SECRET`, `NOTIFICATION_EMAIL`,
      `ALLOWED_ORIGINS`. *(Source de vérité : `src/worker/types.ts:4-58`.)*
- [ ] **(Rochdi)** Secrets conditionnels selon features activées, via
      `wrangler secret put <NAME>` (JAMAIS de valeur dans un fichier/repo) :
      `ANTHROPIC_API_KEY` (sinon `USE_MOCKS="true"` — **décision Rochdi**,
      actuellement `true` `wrangler.jsonc:39`), `RESEND_API_KEY`, `TWILIO_*`,
      **`TOKEN_KEY`** (S7 — sinon tokens d'intégration EN CLAIR),
      `STATE_STORE` (KV CSRF OAuth), `RATE_LIMITER` (KV), `META_APP_*`,
      `GHL_*`.
- [ ] **(Rochdi)** `DEV_BYPASS_AUTH` **ABSENT en prod** (bypass login —
      JAMAIS configuré en production, `types.ts:32`).
- [ ] **(Rochdi)** Inventaire complet revu : **`docs/BINDINGS-SECRETS-S10.md`**
      (produit par Manager C — référencé, non dupliqué ici).

## 7. Paiement régulé E4/E6 — `payments_live_enabled = 0`

- [ ] **(Rochdi)** `payments_live_enabled = 0` **NON levé** tant que la
      revue PCI (SAQ-A) **et** la revue légale E4/E6 ne sont pas signées.
- [ ] **(Rochdi)** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` **NON
      configurés** tant que le flag n'est pas levé.
- [ ] **(Rochdi)** Revue PCI / RGPD-Loi 25 / multi-région complétée selon
      **`docs/PCI-RGPD-GOLIVE-checklist.md`** (source de vérité régulée —
      checklist intégrale là-bas, NON dupliquée ici).

## 8. SEO canonical — **À TRANCHER (Rochdi)**

- [ ] **(Rochdi — décision)** Incohérence de domaine canonical à arbitrer :
      `index.html:30,52` → `https://intralys.com/` **vs**
      `public/sitemap.xml` / `wrangler.jsonc:38` → `https://crm.intralys.com`.
      *Documenté, NON corrigé en S10 (S10 = doc only ; `index.html` /
      `wrangler.jsonc` / `sitemap.xml` intouchés). Choisir un domaine
      canonical unique et aligner les 3 sources avant indexation.*

## 9. Déploiement & post-deploy

- [ ] **(Rochdi)** `npx wrangler deploy` (après Gates 1-5 verts + bindings).
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** Purge cache Cloudflare après déploiement (éviter bundle /
      service worker stale).
- [ ] **(Rochdi)** Smoke E2E : **login** sur le domaine prod fonctionne.
      *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** Smoke E2E : **onboarding** (`WelcomeWizard`) se lance au
      1er login + reprise multi-appareil (`GET/PUT /api/onboarding/state`,
      S8). *Écrit, NON exécuté (VM VMware) — à exécuter par Rochdi.*
- [ ] **(Rochdi)** Pages publiques (`/`, `/pricing`, `/help`) chargent sans
      authentification. *Écrit, NON exécuté (VM VMware) — à exécuter par
      Rochdi.*

## 10. Bêta — paramétrage & communication

- [ ] **(Rochdi)** Codes d'invitation des 5 premiers clients liés / liens
      `?code=XXX` envoyés.
- [ ] **(Rochdi)** Test création de lead → email de notification part bien
      (Resend) — *si `RESEND_API_KEY` configuré.*
- [ ] **(Rochdi)** Interface mobile (PWA) chargée sur un appareil de test.
- [ ] **(Rochdi)** Email d'annonce bêta-testeurs rédigé + programmé.
- [ ] **(Rochdi)** Suivi white-glove planifié dans les 48 h du 1er login.

---

## Verdict final

| Condition | Statut |
|---|---|
| 🔴 Sprint R remédié (6 pages CRM i18n) | **NON — BLOQUANT non enterrable** |
| Gate 1 — Build & tests | Écrit, NON exécuté (VM) — à exécuter Rochdi |
| Gate 2 — Backup D1 prod | Écrit, NON exécuté (VM) — à exécuter Rochdi |
| Gate 3 — Dry-run migrations | Écrit, NON exécuté (VM) — à exécuter Rochdi |
| Gate 4 — Migration + anti-régression C1 | Écrit, NON exécuté (VM) — à exécuter Rochdi |
| Gate 5 — Non-régression multi-tenant | Écrit, NON exécuté (VM) — à exécuter Rochdi |
| Revue PCI/légale E4/E6 signée | NON — `payments_live_enabled=0` non levé |

**GO-LIVE : NON.** Tant que le sprint R n'est pas remédié et vérifié, et que
les 5 gates Rochdi + la revue régulée E4/E6 ne sont pas tous verts, la
plateforme n'est PAS prête à la production. Plateforme code-complete ≠ prête
au go-live. Synthèse plateforme complète : `docs/GOLIVE-S10.md §2`.
