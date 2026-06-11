# GIGA-PLAN V2 — Vers un vrai produit (exécution Antigravity, méthode 18 agents)

> Document autoportant. Antigravity exécute ce plan lot par lot.
> Le programme de renforcement S1→S10 + sprint R sont TERMINÉS (voir
> `LAUNCH-CHECKLIST.md`, `docs/GOLIVE-S10.md`, `docs/PERF-S9.md`,
> `docs/SECRET-STORE-S7.md`, `docs/ONBOARDING-S8.md`). Ce plan est la SUITE :
> combler la profondeur produit (design, fonctions, UX, tout domaine) pour
> passer de « code-complete » à « vrai outil prêt clients ».

---

## 0. État de départ honnête (ne pas se mentir)

**Fait (code-complete, NON tout buildé/testé) :**
- Backend durci : runner migrations corrigé, multi-tenant, validation, observabilité, tests transactionnels e-comm (S1-S5).
- Secret store chiffré + rotation (S7), onboarding unifié CRM+e-comm persisté serveur (S8), index D1 + télémétrie web-vitals + pagination leads + split OrderDetailPanel + i18n Calendar/Inbox (S9), docs go-live + health readiness (S10).
- E-commerce B2 complet E1→E9 (multi-région QC/UE/DZ, omnicanal Shopify/Woo).
- Sprint R résolu : 6 pages CRM restaurées (commit `5764096` → `7846e72`).

**PAS fait / dette réelle (point de départ de ce plan) :**
1. **Build/tests JAMAIS exécutés intégralement** (VM VMware). Antigravity DOIT faire `bun run build` + `bun run test` AVANT tout nouveau sprint (= LOT 0).
2. **Les 6 pages CRM restaurées viennent d'un commit ANCIEN (`5764096`)** → elles ont potentiellement PERDU des améliorations design/UX faites après (sprints design 36-41, polish Stripe). À auditer en premier (LOT A S-A1).
3. **6 pages dé-internationalisées** (FR hardcodé) → ré-i18n propre à refaire (LOT C).
4. `tsconfig.json` exclut `src/**/__tests__` du typecheck build.
5. **Stubs non comblés hors zones régulées** : intégrations réelles (email/SMS/OAuth selon config), recherche avancée, certains workflows, exports.
6. **Zones E4/E6 régulées** (paiement/remboursement/litige) : `payments_live_enabled=0`, JAMAIS activées sans revue PCI/légale signée.
7. Profondeur design/UX inégale, a11y/mobile/i18n partiels, perf à l'échelle au-delà de S9 non couverte.

---

## 1. Principes d'exécution — MÉTHODE 18 AGENTS (non négociable)

Chaque sprint suit EXACTEMENT ce pattern (éprouvé S1→S10) :

1. **CHAMAN** = 1 agent d'audit **READ-ONLY** (aucune écriture). Il lit le code réel (grep/read intensif), produit : constats fichier:ligne, périmètre ajusté au réel, **matrice file-ownership stricte** (1 seul agent par fichier partagé), verdict **Phase A/B**, **§6 contrats figés** (signatures/SQL/clés exactes), risques & garde-fous, plan de tests. JAMAIS sauter le Chaman.
2. **Phase A = 1 Manager SOLO** : implémente les fichiers qui portent les contrats partagés, puis **fige un doc `docs/<SPRINT>.md` section `## §6 Contrats figés`** (copiable verbatim).
3. **Phase B = 2 Managers EN PARALLÈLE** (B ∥ C), lancés ensemble, sur fichiers DISJOINTS, consommant le §6 figé.
4. Total = User + Coordinateur + Chaman + 3 Managers ×4 atomic = pattern « 18 agents ».

**Règles d'or transverses :**
- **CODE > mémoire** : tout vérifier par grep/read, jamais supposer. Un agent coupé sur timeout → l'orchestrateur complète depuis le code réel, ne relance pas à zéro.
- **Additif / non destructif** : MODIFIER > AJOUTER. JAMAIS réécrire une migration historique, supprimer une classe CSS legacy contractuelle, ni casser une API consommée par le front (le front lit souvent `data.error` string brute → erreurs rétro-compat `{error:<string>,code,fields?}`).
- **Convention DB** : `id TEXT DEFAULT (lower(hex(randomblob(16))))`, timestamps `TEXT DEFAULT (datetime('now'))`, JAMAIS `unixepoch()`. Nouvelle migration = additive, append au manifest `docs/migrations-manifest.json` (dernier seq utilisé = 77 → prochaine = 78).
- **JAMAIS prétendre build/tests verts sans les avoir exécutés.** Antigravity PEUT les exécuter (accès hôte) → il DOIT, et rapporter le réel.
- **Petits lots** : tâche large (i18n, split pages) = 1-2 unités/Manager, jamais 6 d'un coup (leçon S6-M2).
- **Checkpoint entre lots** : bilan + ajustement avant le lot suivant. Qualité > vitesse.

---

## 2. Garde-fous absolus (tous lots)

- 🚫 NE PAS activer E4/E6 (`payments_live_enabled` reste `0`) sans revue PCI SAQ-A + légale signée. Configuration/doc sandbox uniquement.
- 🚫 NE PAS réécrire les migrations 1-77 ni `scripts/migrate.ts` (runner figé S2).
- 🚫 NE PAS casser les livrables S1-S10 : `secret-store.ts`, `onboarding_state`, index seq 77, telemetry, validation layer, helpers figés (`schemas.ts`+`validate()`, `validate-response.ts`, `error-response.ts`, `logger.ts`, `audit()`, `webVitals.ts`).
- Ré-i18n des 6 pages CRM : créer TOUTES les clés dans les 4 catalogues (fr-CA source, fr-FR, en, es) **AVANT** de convertir une page. Parité stricte testée. Jamais convertir sans les clés (= la cause de la régression R).
- Préserver la logique métier TPS/TVQ, multi-région, Loi 25/CASL, sécurité.

---

## 3. ROADMAP GIGA — lots & sprints

Ordre recommandé. Chaque sprint = 1 Chaman + Phase A/B. ~3-4 sprints/lot, checkpoint entre lots.

### LOT 0 — Vérité terrain (PRÉREQUIS, à faire en premier)
- **S0.1 Build & tests réels** : `bun run build` (0 erreur TS hors `__tests__` exclus), `bun run test` (toutes suites S1-S10). Corriger les vraies erreurs (additif). Rapport honnête : ce qui passe / ce qui casse.
- **S0.2 Exécution des 5 gates** (cf `docs/GOLIVE-S10.md`) sur snapshot : backup → dry-run migrations → migration seq 1-77 → vérif anti-régression gclid `sprint51` → non-régression multi-tenant. Sortie : la plateforme tourne vraiment.
> Sans LOT 0 vert, les lots suivants bâtissent sur du sable. Ne pas sauter.

### LOT A — Design system & cohérence visuelle (vrai produit visuel)
- **S-A1 Audit design des 6 pages restaurées** : comparer `Leads/Dashboard/LeadDetail/Tasks/Pipeline/Clients` (revenues du commit `5764096`) vs le reste de l'app (paradigme Stripe sobre actuel, primitives `src/components/ui`, `<PageHero>`). Identifier ce qu'elles ont PERDU (polish, primitives, cohérence). → backlog réalignement.
- **S-A2 Réalignement design 6 pages** (petits lots 2 pages/Manager) : remettre au standard Stripe actuel SANS re-casser l'i18n (FR hardcodé OK à ce stade, l'i18n = LOT C). Iso-fonctionnel.
- **S-A3 Profondeur design system** : cohérence primitives, états vides/erreur/chargement uniformes, micro-interactions sobres, responsive, tokens (couleurs/typo/espacements), audit a11y visuel (contrastes WCAG AA).
- **S-A4 Polish e-commerce/boutique UI** : parité visuelle module e-comm avec le CRM (OrderDetailPanel déjà splitté S9, catalogue, checkout, dashboards boutique).

### LOT B — Complétude fonctionnelle (combler les stubs, hors E4/E6)
- **S-B1 Intégrations réelles** : email (Resend), SMS (Twilio), OAuth Shopify/Woo réels via secret store S7 — câblage prod-ready + fallback documenté. Pas d'activation paiement.
- **S-B2 Recherche & filtres avancés** : recherche cross-entités performante (s'appuyer sur index S9), filtres sauvegardés, tri.
- **S-B3 Workflows & automatisations** : compléter le workflow builder, déclencheurs, actions, enrôlements (réutiliser l'existant, combler les trous).
- **S-B4 Notifications & temps réel** : push/WS robustes, centre de notifications, préférences.
- **S-B5 Exports & rapports** : exports CSV/PDF réels, rapports paramétrables (s'appuyer sur télémétrie/analytics existants).

### LOT C — UX / Mobile / A11y / i18n (utilisable par tous)
- **S-C1 Ré-i18n propre 6 pages CRM** (petits lots 1-2 pages, clés AVANT conversion, parité 4 catalogues testée).
- **S-C2 i18n du reste** (~pages non couvertes, namespaces propres, jamais casser l'existant).
- **S-C3 Mobile/Capacitor** : polish natif, safe-areas, gestes, offline gracieux, PWA.
- **S-C4 A11y AA→AAA** : navigation clavier, ARIA, lecteurs d'écran, focus, reduce-motion.
- **S-C5 Onboarding & empty states** : étendre l'onboarding unifié S8 (parcours guidés, checklists, états vides actionnables).

### LOT D — Robustesse / Data / Observabilité / Perf à l'échelle
- **S-D1 Perf au-delà de S9** : profilage réel, requêtes lourdes restantes, bundle, lazy, cache.
- **S-D2 Intégrité données** : contraintes, cohérence cross-tenant, jobs de réconciliation, FK orphelines.
- **S-D3 Observabilité ops** : dashboards web-vitals (table S9), logs structurés exploités, alerting, healthchecks étendus.
- **S-D4 Résilience** : rate limiting, retries, idempotence end-to-end, dégradation gracieuse.

### LOT E — Release candidate
- **S-E1 E2E complets** (Playwright) sur parcours critiques CRM + e-comm.
- **S-E2 Dossier conformité** : finaliser PCI/RGPD/Loi 25 (documenté), conditions de levée E4/E6.
- **S-E3 Beta flow & doc** : invitations, doc utilisateur, runbook ops, LAUNCH-CHECKLIST exécutée bout en bout.

---

## 4. Template d'un sprint (à suivre par Antigravity)

Pour CHAQUE sprint :

1. **Lancer le Chaman** (agent read-only). Brief type :
   > « Tu es le CHAMAN (READ-ONLY) du sprint <X> "<titre>". Tu NE MODIFIES AUCUN FICHIER. Contexte : <repo, stack, contraintes VM/DB/additif, livrables S1-S10 à ne pas casser, garde-fous §2 de GIGA-PLAN-V2>. Objectif : <objectif sprint>. Lis et audite : <pistes grep/read>. Livrable : 1) constats fichier:ligne 2) périmètre ajusté 3) découpage 3 Managers + matrice file-ownership STRICTE (1 agent/fichier partagé, colonne INTERDIT) 4) verdict Phase A/B + contenu §6 proposé 5) risques/garde-fous 6) plan de tests. »
2. **Phase A** : 1 Manager solo implémente + écrit `docs/<SPRINT>.md` §6 figé.
3. **Lire le §6**, puis **Phase B** : 2 Managers en parallèle (un seul message), fichiers disjoints, consommant le §6 verbatim.
4. **Vérifier sur disque** (grep/read) la cohérence inter-managers + **exécuter `bun run build` + tests ciblés** (Antigravity a l'accès). Rapport honnête.
5. **Commit + push** avec message clair. Mettre à jour `LAUNCH-CHECKLIST.md` si l'état go-live change.
6. **Checkpoint** en fin de lot : bilan + ajustement du lot suivant.

Briefs Manager type : périmètre exact, fichiers EXCLUSIFS écriture + lecture seule, §6 verbatim, garde-fous, « incertitude → grep le réel, CODE > mémoire », rapport final (fichiers, écarts justifiés, build/test réel).

---

## 5. Definition of Done (vrai outil)

- LOT 0 vert (build + tests + 5 gates réellement exécutés).
- 6 pages CRM réalignées design + ré-i18n propre (parité 4 catalogues testée).
- Stubs hors E4/E6 comblés (intégrations réelles câblées).
- A11y AA, mobile correct, perf à l'échelle validée.
- E2E critiques verts, dossier conformité prêt, LAUNCH-CHECKLIST exécutée.
- E4/E6 toujours `payments_live_enabled=0` tant que revue PCI/légale non signée.
- Aucun livrable S1-S10 cassé (vérifié).

> Mémoire programme persistante (hors repo) : la session Claude tient à jour
> `platform_hardening_program.md`. Antigravity rapporte l'état réel après
> chaque lot pour resynchroniser.
