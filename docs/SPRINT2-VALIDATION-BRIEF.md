# SPRINT 2 — Validation & Durcissement — BRIEF ANTIGRAVITY

> À exécuter côté HÔTE (Antigravity / machine avec `bun`+`node`+`npx wrangler`).
> La VM VMware de dev n'a NI bun NI node → tout build/test/migration est délégué ici.
> Objectif : purger la dette d'empilage (4 programmes code-complete jamais buildés)
> AVANT de construire Sprint 3 (Booking). Ne PAS démarrer Sprint 3 tant que ce
> brief n'est pas VERT.

---

## 1. Contexte — ce qui est empilé non validé

Code-complete, vérifié sur disque, **jamais buildé/testé** :

| Programme | Migrations | Fichiers clés |
|---|---|---|
| Team & Permissions LOT A | **seq 79** `migration-team-lotA-seq79.sql` | `src/worker/team.ts`, `src/pages/AcceptInvitation.tsx`, `src/App.tsx`, `src/lib/api.ts`, i18n ×4 (35 clés `team.*`) |
| Team LOT B | **seq 80** `migration-team-lotB-seq80.sql` | `src/worker/capabilities.ts`, `team.ts` (handleListInvitations/handleGetRoles), `RolesPermissionsSettings.tsx`, `TeamSettings.tsx` |
| Team LOT C | **seq 81** `migration-team-lotC-seq81.sql` | `src/worker/clients-admin.ts`, `BrandingSettings.tsx`, `SubAccountsSettings.tsx` |
| Team LOT B-bis | (aucune migration) | 14 gardes `capGuard` conditionnelles dans `leads.ts`/`workflows.ts`/`billing.ts`/`team.ts` |
| Facturation | **seq 82** `migration-invoice-real-seq82.sql` | `src/worker/quotes.ts`, `billing.ts`, `Invoices.tsx`, `Quotes.tsx`, `pdfExport.ts`, `src/App.tsx`, i18n ×4 (44 clés) |
| Funnels (Sprint 1) | **seq 83** `migration-funnel-seq83.sql` | `src/worker/funnels.ts`, `funnel-blocks.ts`, `Funnels.tsx`, `FunnelBuilder.tsx`, `PublicFunnel.tsx`, `funnel-templates.ts`, `route-meta-ssr.ts`, `worker.ts`, `src/App.tsx`, i18n ×4 (84 clés) |

Tous suivent la même architecture additive prouvée : rétro-compat byte-identique
legacy, best-effort (jamais throw), migrations idempotentes `IF NOT EXISTS`,
**jamais** de rebuild `users` / touch CHECK seq 59, E4/E6 régulés jamais activés.

---

## 2. Séquence d'exécution (ordre strict)

### Étape A — Build / typecheck
```
bun install            # si besoin
bun run build          # DOIT finir tsc 0 erreur + vite build OK
```
Si erreurs tsc : ce sont quasi toujours des écarts type/setup « écrit-sur-VM-sans-exécution »
(locale FR-CA assumée, jest-dom, casts). Les corriger SANS toucher la logique métier.
Points de vigilance build connus (écarts CODE>brief documentés, à confirmer compilants) :
- cast `auth as never` dans `capGuard` (4 fichiers : `leads.ts`/`workflows.ts`/`billing.ts`/`team.ts`).
- `getAgencyReports` typé `ApiResponse<Record<string,unknown>>` côté helper vs `AgencyReportRow[]` worker (cast souple front).
- `funnel-blocks.ts` : `compileBlocksToHtml` param `_blocks`-style + libellés de section « CORPS PHASE C » résiduels (cosmétiques, corps réels présents — ne pas s'y fier comme « non fait »).
- `funnel-templates.ts` est dans `src/pages/` (pas `src/lib/`) — imports à vérifier cohérents.

### Étape B — Migrations seq 79→83 sur D1 de test (LOCAL d'abord)
```
npx tsx scripts/migrate.ts --dry-run        # 1. AFFICHE l'ordre prévu SANS exécuter
```
**Vérifier dans la sortie dry-run :**
- Que `migration-team-lotA-seq79.sql` → `...seq80` → `...seq81` → `migration-invoice-real-seq82.sql` → `migration-funnel-seq83.sql` apparaissent **dans cet ordre** (seq croissant).
- **AUCUN `⚠ Fichier "X" présent sur disque mais absent du manifest`** : si ce warn apparaît pour un `migration-*.sql`, ce fichier ne sera JAMAIS appliqué → bug réel à corriger (voir Étape D).
- Pas de `⚠ Manifest illisible` (sinon fallback 5-buckets qui ignore les `sprintE*` — JSON manifest invalide à réparer).

```
npx tsx scripts/migrate.ts                  # 2. applique LOCAL (idempotent, best-effort)
```
Migrations attendues « pending » (seq 79-83) — les seq ≤78 doivent déjà être appliquées.
Si une migration échoue sur motif **non bénin** (≠ `duplicate column`/`already exists`/`no such table`),
le runner STOP sans enregistrer : lire l'erreur, corriger le `.sql`, relancer.
`migration-team-lotA-seq79.sql` fait `ALTER users ADD last_login_at` **défensif** :
`duplicate column` ATTENDU et bénin (la colonne existe déjà via auth.ts) — le runner
le skip proprement, normal.

### Étape C — Tests non-régression
```
bun run test
```
Suites qui DOIVENT rester **vertes** (rétro-compat byte-identique = invariant n°1) :
`tenant-context`, `lot1-isolation-regression`, `lot2-*`, `lot3-*`, `lot4-*`,
`ecommerce-multitenant.*`, `leads-api-role`, `teamA-isolation`, `teamA-invitation`,
+ suites `forms`/`leads`/`capabilities`/`billing`. Tout échec ici = régression réelle
à investiguer (pas un « fix de test » réflexe : vérifier que ce n'est pas l'isolation
tenant ou le legacy byte-identique qui a cassé).
Créer/exécuter les nouvelles suites funnel si absentes (smoke : CRUD borné tenant,
submit public → lead `source='funnel'`, slug unicité, XSS `esc()`/`safeUrl()`).

### Étape D — Fix du vrai bug runner (`scripts/migrate.ts`)
Le `_meta.runner_bug` du manifest est **imprécis**. Diagnostic réel après lecture
`scripts/migrate.ts` :
- `getOrderedMigrations` (L109-163) lit le manifest et ordonne par `seq` TOUS les
  fichiers présents au manifest ET sur disque. Les `sprintE*`/`sprintER*` SONT au
  manifest (seq 58-89) → **ordonnés correctement quand le manifest est valide**.
- **Vrai trou 1** : un `migration-*.sql` sur disque **absent du manifest** n'est
  que `console.warn` (L141-144) puis **silencieusement jamais appliqué**.
- **Vrai trou 2** : si manifest absent/JSON invalide → `getOrderedMigrationsFallback`
  (L87-103) ne catch QUE `phase*`/`p3_*`/`sprint2-*`/`sprint3` → tous les
  `sprintE*`/`sprintER*`/`sprintLOT*`/`team-*`/`invoice-*`/`funnel-*` IGNORÉS.
**Correctif S2 minimal (additif, sans casser le fallback figé L85-86) :**
1. Faire de « fichier sur disque absent du manifest » une **ERREUR DURE**
   (`process.exitCode=1`) au lieu d'un warn — sauf flag explicite `--allow-unmanifested`.
2. Si le fallback 5-buckets se déclenche ET qu'il existe des fichiers
   `migration-sprint(E|ER|LOT|51)`/`team-`/`invoice-`/`funnel-` sur disque → STOP
   explicite (le fallback ne sait pas les ordonner, ne pas appliquer en aveugle).
3. Garder `assertE9Guard` et la logique bénigne intacts.
NE PAS modifier `getOrderedMigrationsFallback` elle-même (filet figé). Ajouter des
tests unitaires pour 1 & 2 (les exports existent déjà L274-281).

### Étape E — (optionnel, après LOCAL vert) Remote
`npx tsx scripts/migrate.ts --remote` — UNIQUEMENT sur décision Rochdi (gate D1 prod).
NE PAS lancer en remote sans validation explicite.

---

## 3. Points de vigilance par lot empilé

- **Team A** : `team.ts handleGetUsers` legacy DOIT rester SQL byte-identique
  (`SELECT … LIMIT 50` sans WHERE tenant si `!auth.tenant||agencyId==null`).
  `handleAcceptInvitation` PUBLIC pré-requireAuth (route worker.ts ~569).
- **Team B** : `resolveCapabilities` best-effort, en legacy → set LARGE
  (`legacyCapsFromRole`) sans requête D1. Si une suite legacy casse, la garde a
  fuité hors mode-agence → régression.
- **Team B-bis** : 14 `capGuard` doivent être no-op en legacy/API-key/tests
  (condition `auth?.tenant?.agencyId != null && auth.capabilities`). Si
  `teamA-invitation`/`lot*` cassent → la condition a été mal posée.
- **Facture** : numérotation facture par `client_id` (pas `agency_id` — `invoices`
  n'a pas la colonne) ; devis par `agency_id`. `payment_url` doit être `null`
  (jamais `pay.intralys.com`). E4/E6 (`payments_live_enabled`) intacts.
- **Funnels** : route publique `/api/p/:slug` pré-requireAuth ; submit réutilise
  les helpers `forms.ts` (applyLeadMapping/resolveDedup/autoEnrollForTrigger) —
  vérifier que les imports dynamiques résolvent. XSS : `esc()`/`safeUrl()` dans
  `funnel-blocks.ts` (whitelist bloque `javascript:`/`data:`). Capability réutilisée
  = `workflows.manage` (PAS de `funnels.manage` dans `ALL_CAPABILITIES`).

---

## 4. Critères de succès (à rapporter)

- [ ] `bun run build` : tsc 0 erreur, vite OK (lister tout fix appliqué + nature).
- [ ] `migrate --dry-run` : ordre seq 79→83 correct, **zéro warn « absent du manifest »**.
- [ ] `migrate` LOCAL : seq 79-83 appliquées (ou skip bénin documenté), 0 erreur dure.
- [ ] `bun run test` : suites listées §2-C **vertes**, 0 régression isolation/legacy
      (rapporter nb suites/tests, et CHAQUE échec avec cause racine — pas « fixé le test »).
- [ ] Runner `migrate.ts` durci (trous 1&2 §2-D) + tests unitaires verts.
- [ ] Confirmer : aucun rebuild `users`, CHECK seq 59 intact, E4/E6 non activés,
      aucune fuite cross-tenant introduite.
- [ ] Verdict : GO / NO-GO pour Sprint 3 (Booking).

Rapporter le tout à Rochdi. Si NO-GO : lister précisément les blocages.
Tant que ce brief n'est pas vert, **Sprint 3 ne démarre pas**.
