# LOT E — Release candidate (GIGA-PLAN-V2) — DERNIER lot

> Doc du lot E + **bilan GIGA-PLAN-V2 honnête**. Phase B parallèle pur
> (Managers 1/2/3 sur fichiers disjoints). Ce Manager (M2) ÉCRIT de la
> **documentation seulement**.
>
> ⚠️ **Pas de §6 « Contrats figés » dans ce lot.** Contrairement à LOT C
> (`docs/LOT-C.md` §6 = clés i18n consommées en Phase B) ou à
> `docs/GOLIVE-S10.md` §6 (signatures health/bindings), **LOT E n'a aucun
> contrat partagé inter-Managers** : les livrables M1 (E2E/runbook), M2 (ce
> dossier + conformité, doc-only) et M3 (`LAUNCH-CHECKLIST.md`) sont
> **strictement disjoints**, aucune signature/clé/SQL à figer et transmettre.
> L'absence de §6 est **intentionnelle et notée ici**, pas un oubli.
>
> ⚠️ **VM VMware** : aucune commande `bun`/`node`/`git`/`wrangler` exécutée
> dans ce lot. Toute mention build/test/gate = **« écrit, NON exécuté —
> à exécuter par Rochdi sur la machine hôte »**.

---

## 1. Périmètre LOT E (mapping GIGA-PLAN-V2 §3 → LOT E)

`docs/GIGA-PLAN-V2.md:95-98` définit le LOT E « Release candidate » :

- **S-E1 E2E complets** (Playwright, parcours critiques CRM + e-comm) →
  Manager 1 (E2E + runbook ops).
- **S-E2 Dossier conformité** : PCI/RGPD/Loi 25 documenté + conditions de
  levée E4/E6 → **Manager 2 (ce dossier)** :
  `docs/CONFORMITE-GOLIVE-LOT-E.md` (synthèse + renvois `chemin:section`,
  zéro duplication régulée) + ce `docs/LOT-E.md`.
- **S-E3 Beta flow & doc** : invitations, doc utilisateur, runbook,
  `LAUNCH-CHECKLIST.md` exécutée bout en bout → Manager 3
  (`LAUNCH-CHECKLIST.md`, intouché par M2).

Découpage Phase B (fichiers EXCLUSIFS, disjoints) :

| Manager | Fichiers | Nature |
|---|---|---|
| M1 | E2E Playwright + runbook ops | code de test + doc |
| **M2 (nous)** | `docs/CONFORMITE-GOLIVE-LOT-E.md`, `docs/LOT-E.md` | **doc-only** |
| M3 | `LAUNCH-CHECKLIST.md` | doc |

> M2 ne touche QUE ses 2 fichiers. Sources lues seules (non modifiées) :
> `docs/PCI-RGPD-GOLIVE-checklist.md`, `docs/GOLIVE-S10.md`,
> `docs/BINDINGS-SECRETS-S10.md`, `src/worker/compliance.ts`,
> `src/worker/beta.ts`, `docs/GIGA-PLAN-V2.md`, `docs/LOT-{A,B,C}.md`.

---

## 2. Livrables Manager 2 (ce lot)

1. **`docs/CONFORMITE-GOLIVE-LOT-E.md`** — dossier de synthèse conformité
   go-live. Sections (a) PCI SAQ-A, (b) RGPD/Loi 25/CASL, (c) multi-région,
   (d) conditions de levée `payments_live_enabled`, (e) attestation honnête,
   (f) verdict. **100 % renvois `chemin:section` + preuves code
   (fichier:ligne)**, ZÉRO ré-analyse régulée, ZÉRO duplication du contenu
   PCI/RGPD. Vérifié : `PCI-RGPD-GOLIVE-checklist.md:119-149` contient bien
   la section « §5 Conditions de levée `payments_live_enabled` » (5
   conditions cumulatives `:127-143`).
2. **`docs/LOT-E.md`** (ce fichier) — doc du lot + bilan GIGA-PLAN-V2.

---

## 3. Bilan GIGA-PLAN-V2 — état HONNÊTE (A → E)

Source plan : `docs/GIGA-PLAN-V2.md`. État de départ honnête du plan
lui-même : `docs/GIGA-PLAN-V2.md:12-27` (« ne pas se mentir »).

### LOT 0 — Vérité terrain (prérequis)
- Périmètre : `GIGA-PLAN-V2.md:64-67` — build/tests réels + 5 gates.
- **État : NON re-vérifié sur cette VM.** `bun run build` / `bun run test`
  et les 5 gates restent **« écrit, NON exécuté (VM VMware) »**
  (`docs/GOLIVE-S10.md` §1, Statut de chaque gate). Dette dure.

### LOT A — Design system & cohérence visuelle
- Périmètre : `GIGA-PLAN-V2.md:69-73` ; doc : `docs/LOT-A.md` (présent).
- État : Phase A/B faites (code-complete). **Build combiné non re-vérifié**
  sur VM. Audit/réalignement des 6 pages restaurées : livré côté code,
  validation visuelle navigateur non rejouée ici.

### LOT B — Complétude fonctionnelle (hors E4/E6)
- Périmètre : `GIGA-PLAN-V2.md:75-80` ; doc : `docs/LOT-B.md` (présent).
- État : Phase A/B faites (code-complete). **Stubs résiduels** : intégrations
  réelles câblées sous réserve config (secrets RESEND/TWILIO/META/GHL non
  configurés VM, cf `docs/BINDINGS-SECRETS-S10.md` § 3). Pas d'activation
  paiement (E4/E6 hors scope par garde-fou).

### LOT C — UX / i18n résiduel
- Périmètre : `GIGA-PLAN-V2.md:82-87` ; doc : `docs/LOT-C.md` (présent,
  §6 = 705 clés en parité 4 catalogues, test parité).
- État : Phase A/B faites. **Dette explicite assumée (non cachée)** :
  - **`LOT C-bis`** reporté honnêtement (`docs/LOT-C.md:657-671`) :
    `ScopePicker.tsx` (~40 strings), `BulkActionBar.tsx`,
    `UserActivityHeatmap` jours semaine, titres articles `HelpCenter`.
  - **6 pages cœur CRM dé-i18n** (FR hardcodé, restaurées commit `5764096`)
    : affichent du FR en `fr-FR/en/es`. **Acceptable** (cible fr-CA Québec,
    `docs/GOLIVE-S10.md:26-28`), ré-i18n propre = tâche future en petits
    lots (clés AVANT conversion — cause racine régression R, `LOT-C.md:35`).

### LOT D — Robustesse / Data / Observabilité / Perf
- Périmètre : `GIGA-PLAN-V2.md:89-93`. **Aucun `docs/LOT-D.md` sur disque**
  (vérifié `Glob` — seuls LOT-A/B/C existent). Travail D rapporté
  code-complete dans la mémoire programme mais **doc dédiée absente**
  → écart documentaire noté ici (non bloquant conformité, à tracer).
- État : Phase A/B faites côté code (rate limiting, retries, idempotence,
  observabilité web-vitals S9). **Build combiné A-D non re-vérifié VM.**

### LOT E — Release candidate (CE LOT)
- Périmètre : `GIGA-PLAN-V2.md:95-98`.
- État : S-E1 (E2E/runbook M1), S-E2 (conformité M2 — ce livrable),
  S-E3 (`LAUNCH-CHECKLIST.md` M3) — Phase B faite côté doc/code de test.
  **E2E Playwright écrits NON exécutés (VM).**

### Synthèse build (honnête, non négociable)

> **Le build combiné A → D + E n'a JAMAIS été re-vérifié sur cette VM
> (sandbox VMware, doc-only).** « Code-complete » ≠ « buildé/testé ».
> Premier build réel = acte Rochdi sur la machine hôte (Gate 1,
> `docs/GOLIVE-S10.md:46-58`). Aucune affirmation « vert » n'est faite.
> C'est la **dette Antigravity** structurante de tout le GIGA-PLAN-V2
> (`docs/GIGA-PLAN-V2.md:21,44`, `docs/GOLIVE-S10.md:55-57`).

---

## 4. Dette résiduelle exhaustive (rien d'enterré)

1. **Build/tests jamais exécutés intégralement sur VM** — Gate 1
   (`bun run build` / `bun run test`) non joué. Premier build réel à faire
   par Rochdi (`docs/GOLIVE-S10.md:46-58`, `GIGA-PLAN-V2.md:21`).
2. **6 pages cœur CRM dé-i18n** (`Leads/Dashboard/LeadDetail/Tasks/
   Pipeline/Clients`) — FR hardcodé, `fr-FR/en/es` affichent FR. Acceptable
   cible fr-CA, ré-i18n future en petits lots (`docs/GOLIVE-S10.md:26-28`).
3. **LOT C-bis** non fait (reporté explicitement `docs/LOT-C.md:657-671`) :
   `ScopePicker`, `BulkActionBar`, jours semaine Heatmap, titres articles.
4. **E4/E6 NON cleared** — `payments_live_enabled=0`, 5 conditions de levée
   toutes NON remplies, revue PCI/légale NON signée (détail :
   `docs/CONFORMITE-GOLIVE-LOT-E.md` (d)+(f) ;
   `docs/PCI-RGPD-GOLIVE-checklist.md:119-149`). **Régulé non-cleared-prod.**
5. **`sendMagicEmail` = stub** — `src/worker/beta.ts:172-179` : `TODO(prod)`,
   log console au lieu d'envoi Resend/SendGrid (suffit pour beta privée à
   invitation manuelle, à câbler avant beta self-serve).
6. **SEO canonical à trancher** — `index.html` (`intralys.com`) vs
   `wrangler.jsonc`/sitemap (`crm.intralys.com`), décision Rochdi
   (`docs/GOLIVE-S10.md:312-313`, renvoi `LAUNCH-CHECKLIST.md`). Non touché
   par M2 (`index.html`/`wrangler.jsonc` interdits).
7. **5 gates Rochdi NON exécutés** (build/tests, backup D1, dry-run
   migrations, migration prod + vérif conflit gclid C1 / colonnes
   `sprint51-m2` dont `consent_status`, non-régression multi-tenant) —
   `docs/GOLIVE-S10.md:36-143`, tous « écrit, NON exécuté (VM) ».
8. **Conflit migration gclid C1** à surveiller au Gate 4
   (`migration-sprint51-m1.sql` + `-m2.sql` double `ADD COLUMN gclid`) —
   procédure documentée `docs/GOLIVE-S10.md:114-125`. Non résolu (acte
   migration = hôte).
9. **`docs/LOT-D.md` absent** — écart documentaire (LOT D code-complete mais
   pas de doc dédiée comme A/B/C). À régulariser hors ce lot.
10. **Secrets/bindings non configurés VM** — `TOKEN_KEY` absent →
    tokens d'intégration EN CLAIR (`docs/BINDINGS-SECRETS-S10.md` § 3, ligne
    `TOKEN_KEY`) ; `STATE_STORE`/`RATE_LIMITER` KV non bindés. Actes hôte.

---

## 5. Verdict LOT E (honnête)

- **Documentation conformité go-live : ÉCRITE.** Synthèse + renvois sans
  duplication régulée (`docs/CONFORMITE-GOLIVE-LOT-E.md`).
- **GIGA-PLAN-V2 A → E : code-complete, build combiné NON re-vérifié VM.**
- **Go-live régulé (E4/E6 / paiement) : BLOQUÉ** — revue PCI + légale NON
  signées, `payments_live_enabled=0`, 5 conditions cumulatives NON remplies.
- **Go-live non régulé (CRM)** : reste subordonné aux 5 gates Rochdi +
  prérequis infra (`docs/GOLIVE-S10.md`) — **non exécutés sur VM**.
- Aucune affirmation « prêt prod » / « vert ». Tout acte d'exécution et
  toute signature restent à la charge de Rochdi sur la machine hôte.

> **§6 : sans objet pour LOT E** (aucun contrat partagé inter-Managers —
> livrables M1/M2/M3 disjoints). Noté intentionnellement, cf en-tête.

---

## Renvois

- `docs/GIGA-PLAN-V2.md` — plan source (LOT E : `:95-98` ; départ honnête :
  `:12-27`).
- `docs/CONFORMITE-GOLIVE-LOT-E.md` — dossier conformité M2 (renvois +
  preuves code).
- `docs/GOLIVE-S10.md` — 5 gates Rochdi + synthèse plateforme + dette build.
- `docs/PCI-RGPD-GOLIVE-checklist.md` — source de vérité régulée (NON
  dupliquée). `docs/BINDINGS-SECRETS-S10.md` — bindings/secrets, § 4 régulé.
- `docs/LOT-A.md` / `docs/LOT-B.md` / `docs/LOT-C.md` — lots précédents
  (`LOT-D.md` absent — écart noté § 4.9).

> Statut : doc-only **écrit, NON exécuté** (VM VMware). Zéro fichier interdit
> touché. Zéro contenu régulé dupliqué.
