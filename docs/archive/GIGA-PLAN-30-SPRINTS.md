# GIGA-PLAN 30 SPRINTS — Intralys (roadmap + handoff)

> Doc canonique partagé (repo, visible VM + machine hôte). Source de vérité de la roadmap des 30 sprints + point de reprise. Rédigé 2026-05-22.

## 🔴 REPRISE NOUVELLE SESSION (handoff 2026-05-22)

**Avancement : LOT 1 (S1-10) ✅ + LOT 2 (S11-20) ✅ = 20/30 sprints code-complete NON buildés, empilés sans validation.**
- Migrations **seq103 → seq118** (sprints S2/S11/S19/S20 sans migration). Dernière migration au manifest = **seq118** (`migration-catalog-seq118.sql`). Prochaine libre = **seq119**.
- Chaque sprint a un doc `docs/LOT-*.md` (contrat §6 figé) + une note mémoire VM `sprint*_*.md`.

**PROCHAINE ACTION = LOT 3 / Sprint 21 (onboarding durci), puis enchaîner S22→S30 sans s'arrêter.**

## Méthode par sprint (pattern « 18 agents » — NE PAS dévier)
1. **Chaman** = agent `Plan` (ou Explore) READ-ONLY : audit de l'existant sur disque → cible le VRAI gap. ⚠️ Le projet est TRÈS mature — la quasi-totalité des fonctionnalités existe déjà. La plupart des sprints = **enrichissement / activation / completion** d'un module existant, PAS reconstruction. Produit un scope §6 figé.
2. **Phase A SOLO** = agent `general-purpose` : écrit le socle = migration `seqN` (+ entrée `docs/migrations-manifest.json`) + types (`src/lib/types.ts`/`api.ts`) + helpers + routes (`src/worker.ts`) + stubs handlers worker + i18n ×4 (`src/lib/i18n/{fr-CA,fr-FR,en,es}.ts`) + doc contrat `docs/LOT-<sprint>.md` §6 FIGÉ. Gèle tous les fichiers partagés.
3. **Phase B** = Manager-B (backend) ∥ Manager-C (frontend), lancés dans le MÊME message en `run_in_background`, sur fichiers **DISJOINTS** (zéro fichier partagé entre B et C).
4. **Passe de cohérence** : vérifier le câblage (routes ↔ handlers ↔ helpers ↔ manifest ↔ exports/routes front), corriger les gaps inter-agents.
5. Maj note de sprint + enchaîner le suivant.

## Règles dures invariantes (chaque sprint)
- **100 % ADDITIF** : `ALTER TABLE ADD COLUMN` (nullable, sans DEFAULT non-constant), `CREATE TABLE IF NOT EXISTS`. **JAMAIS** modifier un CHECK existant (rebuild SQLite = INTERDIT). Zéro FK destructrice / DROP / RENAME.
- **Migrations manifest-driven** : tout `migration-*.sql` DOIT avoir une entrée dans `docs/migrations-manifest.json` (sinon le runner STOP). `depends_on` chaîné sur la migration précédente. Convention id = `lower(hex(randomblob(16)))`, timestamps `datetime('now')`, enums validés HANDLER (pas de CHECK).
- **Capabilities FIGÉES (seq80, 12 capabilities)** : réutiliser (`leads.write`, `invoices.write`, `workflows.manage`, `settings.manage`, `clients.manage`, `ai.use`, `reports.view`…). ZÉRO ajout à `ALL_CAPABILITIES`.
- **Contrats GELÉS** : `apiFetch`/`ApiResponse` → réponses `json({ data })` succès / `json({ error }, status)` erreur. JAMAIS de champ `code`.
- **Imports worker RELATIFS** (`./helpers`, `./types`…), jamais d'alias `@/` côté worker (le `@/` est réservé au frontend).
- **E4 (paiements Stripe marchands) + E6 (régulé DZ) = INACTIFS / flag off** : poser les rails en mock/flag inactif, JAMAIS activer un paiement réel (revue PCI/RGPD/légale = main Rochdi). Idiome : `if (!env.<CREDENTIAL>) return { success:false, mock:true }` sans appel réseau.
- **i18n** : parité STRICTE sur les 4 catalogues `src/lib/i18n/{fr-CA,fr-FR,en,es}.ts` (PAS `src/i18n/*.json` qui sont des vestiges). fr-CA tutoiement, fr-FR vouvoiement.
- **VM VMware** (Z: mappé) sans bun/node/git → travailler outils fichier uniquement, build/tests délégués à Antigravity côté hôte. Jamais de commande git.
- **AUCUNE validation intermédiaire** (consigne Rochdi ferme) : on empile TOUS les sprints code-complete, validation Antigravity GROUPÉE à la TOUTE FIN. Ne pas s'arrêter pour proposer une validation entre sprints — enchaîner Chaman→A→B∥C en continu.

## Les 3 lots

### LOT 1 (S1-10) — capacités cœur tout-en-un ✅ FAIT (seq103→111)
1. Booking (rappels auto + liens self-service + no-show) — seq103
2. Sequence Analytics (stats engagement par séquence) — sans migration
3. SMS/WhatsApp (STOP/opt-out CASL + delivery + broadcast SMS + WhatsApp flag) — seq104
4. Automations Builder (config réelle nodes + mode édition + templates + drop-off) — seq105
5. Forms XL (logique conditionnelle + multi-step + fix Loi 25 + Forms.tsx) — seq106
6. Memberships (inscription + nav leçons — module mort débloqué) — seq107
7. Storefront Checkout (tunnel acheteur public, paiement mock) — seq108
8. Reputation (page publique + routing intelligent avis) — seq109
9. Social Planner (composer + calendrier + cron mock + IA posts) — seq110
10. Site Builder (sites multi-pages + nav + SEO) — seq111

### LOT 2 (S11-20) — avancé + IA ✅ FAIT (seq112→118)
11. Copilot v2 (le copilot AGIT : actions sûres + confirmation + contexte page) — sans migration
12. IA contenu (atelier centralisé + brand voice multi-presets + bibliothèque) — seq112
13. Scoring prédictif (score conversion calibré sur historique réel du tenant) — seq113
14. Forecasting (projection tendance + objectifs vs réalisé + scénarios) — seq114
15. Reports builder (templates de dashboards + planif dashboard custom) — seq115
16. Téléphonie (disposition + notes + appel manqué→tâche + page dédiée) — seq116
17. Proposals e-sign (pont devis→signature→facture) — seq117
18. Catalogue (catalogue de services + sélecteur dans les devis) — seq118
19. Marketplace (activation UI — était invisible — + recherche/tri) — sans migration
20. White-label (propagation du branding : UI + emails + PDF + favicon) — sans migration

### LOT 4 (S31-40) — ✅ FAIT (seq126→135)
31. **Billing Stripe LIVE** — webhooks Stripe + subscriptions plan management. ⚠️ Flag inactif (rails posés, paiement réel non activé) — seq126
32. **GBP (Google Business Profile)** — OAuth + posts auto + reviews sync + compliance Loi 25 publication — seq127
33. **Calendar Sync** — OAuth Google + Outlook bi-directionnel, RGPD purge events — seq128
34. **Twilio Voice** — call routing IVR + voicemail + call recordings RGPD — seq129
35. **Snapshots** — bundle JSON portable export/import + signature SHA-256 + schema versioning — seq130
36. **Live chat widget v2** — webchat enrichi (Turnstile + agent presence + frame-v2.html) — seq131
37. **POS retail caisse** — terminal 3-cols + sessions + receipt ESC/POS + réutilise ecommerce-tax-engine — seq132
38. **Gift Cards + Loyalty Programs** — codes 80 bits + tier engine + ledger idempotent — seq133
39. **Multi-currency + Tax multi-région** — Frankfurter ECB API + tax_regions + rules per category — seq134
40. **Product Reviews + Abandoned Carts Recovery** — avis produits anti-bot + séquence multi-touch 3 steps (1h/24h/72h) — seq135

### LOT 3 (S21-30) — production / scale 🔜 À FAIRE (à partir de seq119)
21. **Onboarding durci** — parcours d'accueil nouveau tenant/utilisateur : checklist de démarrage, assistant de configuration, états vides guidés, première valeur rapide. (vérifier l'existant : onboarding signup/provisioning SaaS existe déjà partiellement → cibler le durcissement/guidage.)
22. **Billing Stripe prod** — rails de facturation/abonnement plans : portail client, gestion plan/quotas, webhooks Stripe. ⚠️ **E4 flag inactif/mock** — poser les rails sans activer le paiement réel.
23. **Sécurité / conformité** — durcissement : rate-limiting, audit trail étendu, RBAC fin, secrets, validation entrées, conformité Loi 25/CASL/RGPD consolidée.
24. **Observabilité** — logs structurés, métriques, traces, dashboard santé/erreurs, alerting (web-vitals existe déjà → étendre côté serveur/worker).
25. **Perf** — optimisation bundle/chunks, requêtes D1, cache, lazy-loading, web-vitals cibles. (audits perf déjà amorcés sprints design → mesurer + optimiser).
26. **E2E** — tests end-to-end des flux critiques (Playwright existe partiellement → étendre la couverture des 30 sprints).
27. **Mobile / PWA** — Capacitor/PWA durci, offline, push, safe-area, responsive final (socle Capacitor existe → compléter).
28. **i18n** — convergence i18n : compléter la parité 4 langues, extraire les libellés en dur restants (plusieurs sprints ont laissé des littéraux fr-CA), audit des clés manquantes.
29. **a11y AAA + convergence design** — accessibilité (focus, ARIA, contrastes, reduce-motion), convergence visuelle finale Stripe-clean, cohérence des primitives.
30. **Release candidate / beta** — checklist go-live, gates de migration prod D1, flags d'activation documentés, doc beta, derniers polish. Bilan final + dette résiduelle pour Rochdi.

> Note : les thèmes S21-30 sont la roadmap cible. Le Chaman de chaque sprint vérifie l'existant et borne le scope réel (souvent = compléter/activer plutôt que construire), comme pour les LOT 1-2.

## Dette accumulée (hors-VM, main Rochdi, à la TOUTE FIN)
- Validation Antigravity GROUPÉE : `bun run build` + tests + appliquer migrations seq103→118 (+ LOT 3) côté hôte.
- Activations flags quand credentials dispo : Twilio (SMS/voice), OAuth social (FB/IG/LinkedIn/GBP), Cloudflare for SaaS (domaine custom white-label), Stripe E4 (paiements/billing) — toutes en flag inactif actuellement.
- Revue PCI / RGPD / légale pour E4 (paiements) et E6 (régulé DZ) avant toute activation prod.
