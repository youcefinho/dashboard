# VALIDATION FINALE — BRIEF ANTIGRAVITY (état complet roadmap plateforme-pro)

> À exécuter côté HÔTE (Antigravity / machine avec `bun`+`node`+`npx wrangler`).
> La VM VMware de dev n'a NI bun NI node → tout build/test/migration est délégué ici.
> Remplace/consolide `docs/SPRINT2-VALIDATION-BRIEF.md` (devenu partiel : ne couvrait que seq 79→83).
> Objectif : valider TOUT l'empilage (11 strates, migrations seq 79→87) AVANT tout go-live.
> Aucun nouveau code à empiler : la roadmap fonctionnelle est 100% code-complete.

---

## 1. Les 11 strates empilées, code-complete, JAMAIS buildées

| # | Lot | Migration | Fichiers clés |
|---|---|---|---|
| 1 | Team LOT A (fix isolation + invitations) | **79** `migration-team-lotA-seq79.sql` | `worker/team.ts`, `pages/AcceptInvitation.tsx`, `App.tsx`, `lib/api.ts` |
| 2 | Team LOT B (capabilities composables) | **80** `migration-team-lotB-seq80.sql` | `worker/capabilities.ts`, `team.ts`, `RolesPermissionsSettings.tsx`, `TeamSettings.tsx` |
| 3 | Team LOT C (sous-comptes/branding/reports agence) | **81** `migration-team-lotC-seq81.sql` | `worker/clients-admin.ts`, `BrandingSettings.tsx`, `SubAccountsSettings.tsx` |
| 4 | Team LOT B-bis (14 gardes capGuard conditionnelles) | (aucune) | `leads.ts`, `workflows.ts`, `billing.ts`, `team.ts` |
| 5 | Facturation conforme QC + Devis | **82** `migration-invoice-real-seq82.sql` | `worker/quotes.ts`, `billing.ts`, `Invoices.tsx`, `Quotes.tsx`, `pdfExport.ts` |
| 6 | Sprint 1 Funnels & Landing builder | **83** `migration-funnel-seq83.sql` | `worker/funnels.ts`, `funnel-blocks.ts`, `Funnels.tsx`, `FunnelBuilder.tsx`, `PublicFunnel.tsx`, `route-meta-ssr.ts` |
| 7 | Sprint 3 Booking + 3-bis (endpoint public meta) | **84** `migration-booking-seq84.sql` | `worker/booking-public.ts`, `bookings.ts`, `PublicBooking.tsx`, `BookingSettings.tsx` |
| 8 | Sprint 4 E-commerce enrichi + micro-fix analytics | **85** `migration-promo-seq85.sql` | `worker/ecommerce-coupons.ts`, `ecommerce-subscriptions.ts`, `ecommerce-cart.ts`, `ecommerce-orders.ts` (injection currency), `ecommerce-analytics.ts`, `boutique/Coupons.tsx`, `boutique/Abonnements.tsx` |
| 9 | Sprint 5 Email marketing & séquences | **86** `migration-emailseq-seq86.sql` | `worker/sequences.ts`, `broadcast.ts`, `workflows.ts` (garde additive send_email), `Sequences.tsx`, `Campaigns.tsx` |
| 10 | Sprint 6 Memberships/Cours/Espace membre | **87** `migration-member-seq87.sql` | `worker/member-auth.ts`, `memberships.ts`, `MemberSpace.tsx`, `CoursesAdmin.tsx` |
| 11 | Sprint 7 Convergence i18n (LOT 1+2) | (aucune, front pur) | 11 pages CRM non-R + `Leads.tsx` (string→`t()`) + 37 clés ×4 catalogues |

Tous suivent l'archi additive prouvée : rétro-compat byte-identique legacy, best-effort (jamais throw),
migrations idempotentes `IF NOT EXISTS`, **jamais** rebuild `users` / touch CHECK seq 59, E4/E6
régulés (`payments_live_enabled=0`) jamais activés.

---

## 2. Séquence d'exécution (ordre strict)

### A — Build / typecheck
```
bun install
bun run build        # DOIT finir tsc 0 erreur + vite build OK
```
Erreurs tsc attendues = écarts type/setup « écrit-sur-VM-sans-exécution ». Corriger SANS toucher
la logique métier. Points de vigilance connus (écarts CODE>brief documentés dans les `docs/LOT-*.md`) :
- cast `auth as never` dans `capGuard` (Team B-bis : `leads.ts`/`workflows.ts`/`billing.ts`/`team.ts`)
- `getAgencyReports`/`getEcommerceSalesByChannel` types souples côté helper vs worker
- `funnel-blocks.ts` libellés section « CORPS PHASE C » résiduels (cosmétiques, corps réels présents)
- `funnel-templates.ts` dans `src/pages/` (pas `src/lib/`) — imports
- `member-auth.ts`/`memberships.ts` accès `env` indexé tolérant (binding FILES, PUBLIC_BASE_URL)
- garde additive `workflows.ts:561-637` (send_email tracking) — vérifier branche legacy intacte

### B — Migrations seq 79→87 sur D1 de test (LOCAL d'abord)
```
npx tsx scripts/migrate.ts --dry-run     # affiche l'ordre, AUCUNE exécution
```
Vérifier dans la sortie : ordre seq croissant 79→80→81→82→83→84→85→86→87 ;
**AUCUN warn `⚠ Fichier "X" présent sur disque mais absent du manifest`** (sinon ce fichier
ne sera jamais appliqué — bug réel) ; pas de `⚠ Manifest illisible` (sinon fallback 5-buckets
qui ignore tous les sprintE*/team-*/invoice-*/funnel-*/booking-*/member-* — JSON manifest à réparer).
```
npx tsx scripts/migrate.ts               # applique LOCAL (idempotent, best-effort)
```
`duplicate column` ATTENDU/bénin sur seq 79 (`last_login_at` défensif) — le runner skip proprement.
Si échec sur motif NON bénin → STOP, lire l'erreur, corriger le `.sql`, relancer.

### C — Tests non-régression
```
bun run test
```
Suites qui DOIVENT rester **vertes** (rétro-compat byte-identique = invariant n°1) :
`tenant-context`, `lot1-isolation-regression`, `lot2-*`, `lot3-*`, `lot4-*`,
`ecommerce-multitenant.*`, `ecommerce-tax-engine`, `ecommerce-payments-sandbox`,
`ecommerce-refunds-sandbox`, `leads-api-role`, `teamA-isolation`, `teamA-invitation`,
`i18n-parity-lotC` (filet anti-régression-R — DOIT rester vert après les 37 clés S7),
`PageHero-lotA`, suites `forms`/`leads`/`capabilities`/`billing`/`workflows`/`calendar`.
Tout échec = cause racine à investiguer (PAS un « fix de test » réflexe : vérifier que ce n'est
pas l'isolation tenant ou le legacy byte-identique qui a cassé). Créer smoke tests pour les
nouveaux modules si absents (funnel/booking/coupons/subscriptions/sequences/member-auth).

### D — Durcir `scripts/migrate.ts`
Le `_meta.runner_bug` du manifest est imprécis. `getOrderedMigrations` ordonne bien par seq
quand le manifest est valide. Vrais trous : (1) fichier sur disque absent du manifest = `console.warn`
silencieux puis jamais appliqué ; (2) fallback 5-buckets (manifest absent/illisible) ignore tous
les préfixes modernes. Correctif minimal additif (sans modifier `getOrderedMigrationsFallback`,
filet figé) : (1) fichier hors-manifest → ERREUR DURE (`process.exitCode=1`) sauf
`--allow-unmanifested` ; (2) fallback déclenché AVEC fichiers `sprint(E|ER|LOT|51)`/`team-`/
`invoice-`/`funnel-`/`booking-`/`promo-`/`emailseq-`/`member-` sur disque → STOP explicite.
Ajouter tests unitaires (exports déjà présents).

### E — (optionnel, après LOCAL vert) Remote
`npx tsx scripts/migrate.ts --remote` — UNIQUEMENT sur décision explicite Rochdi (gate D1 prod).

---

## 3. Vigilance par lot (invariants à ne PAS casser)

- **Team A** : `handleGetUsers` legacy SQL byte-identique sans WHERE tenant si `!auth.tenant||agencyId==null` ; `handleAcceptInvitation` PUBLIC pré-requireAuth.
- **Team B/B-bis** : `resolveCapabilities` best-effort legacy = set LARGE sans requête D1 ; 14 `capGuard` no-op hors mode-agence (condition `auth?.tenant?.agencyId!=null && auth.capabilities`).
- **Facture** : numérotation par `client_id` (invoices sans agency_id) ; `payment_url=null` (zéro `pay.intralys.com`) ; E4/E6 intacts.
- **Funnels** : route publique `/api/p/:slug` pré-auth ; submit réutilise pipeline `forms.ts` ; XSS `esc()`/`safeUrl()` ; capability = `workflows.manage` (pas de `funnels.manage` dans ALL_CAPABILITIES).
- **Booking** : moteur créneaux fuseau `America/Toronto` via `Intl.DateTimeFormat` (jamais `T..:..Z` naïf) ; CHECK status `bookings` seq 7 intouché ; `Calendar.tsx`/`calendar.ts handleGetAvailability` interne non régressés.
- **E-comm** : `createOrderCore` signature + calcul total byte-identique (seule addition = persist `currency`) ; coupons legacy `discount_amount/percent` conservées ; abonnements = COD/mock via createOrderCore (jamais E4) ; jamais sommer multi-devise.
- **Email** : `workflows.ts` moteur ordonnancement intouché — SEULE modif = garde additive `send_email` (branche legacy byte-identique quand `is_sequence≠1`) ; CHECK status `broadcasts` seq 24 intouché ; mock honnête si `!RESEND_API_KEY`.
- **Memberships** : auth membre 100% séparée (`member_sessions`, JAMAIS `users`/`admin_sessions`/`requireAuth`) ; vidéo R2 triple-borne avant `env.FILES.get` (jamais URL R2 publique) ; `course_enrollments` ≠ `workflow_enrollments`.
- **S7 i18n** : 37 clés ×4 parité stricte (`i18n-parity-lotC` vert) ; `Leads.tsx` = 4 littéraux only (zéro logique) — **validation visuelle Rochdi requise sur cette page R** ; Dashboard/LeadDetail/Clients NON touchés.

---

## 4. Critères de succès (à rapporter)

- [ ] `bun run build` : tsc 0 erreur, vite OK — lister chaque fix + nature
- [ ] `migrate --dry-run` : ordre 79→87 correct, zéro warn « absent du manifest »
- [ ] `migrate` LOCAL : seq 79-87 appliquées (skips bénins documentés), 0 erreur dure
- [ ] `bun run test` : suites §2-C vertes, 0 régression isolation/legacy — rapporter nb suites/tests + CHAQUE échec avec cause racine (pas « fixé le test »)
- [ ] Runner `migrate.ts` durci (trous 1&2 §2-D) + tests unitaires verts
- [ ] Confirmer : aucun rebuild `users`, CHECK seq 59 intact, E4/E6 non activés, aucune fuite cross-tenant, auth membre séparée intacte
- [ ] VERDICT explicite **GO** (plateforme réellement livrable) / **NO-GO** (lister précisément les blocages, par strate si possible — le découpage en 11 strates traçables aide l'attribution)

Rapporter le tout à Rochdi. Tant que ce n'est pas vert, la plateforme reste *écrite*, pas *livrable*.
