# Checklist Go-Live e-commerce — PCI · RGPD/Loi 25 · Multi-région

> Sprint E9 M3.4 — clôt la roadmap e-commerce B2. Document **d'audit et
> de checklist uniquement** : aucune modification du code régulé
> (paiement E4, remboursement/litige E6, billing, providers). À faire
> valider par Rochdi + revue légale avant toute mise en production.

---

## 1. Périmètre PCI-DSS

**Constat d'audit (vérifié par grep — voir `HARDENING-ecommerce-E9.md`) :
zéro donnée carte stockée ou transitée dans le code Intralys.**

- Aucune colonne `PAN`, `CVV`, `expiry`, `track`, `card_number` dans
  AUCUNE migration (`migration-sprintE4-m1.sql` et `E6-*` portent des
  commentaires d'assertion « ZÉRO colonne carte », pas de schéma carte).
- Le paiement passe par un provider externe (Stripe / passerelle DZ) :
  Intralys ne manipule QUE des **références opaques**
  (`connect_account_ref`, IDs de transaction). Tokenisation 100 % côté
  fournisseur — `src/worker/payments/stripe-provider.ts`,
  `dz-gateway-provider.ts`, `ecommerce-payments.ts`.
- Conséquence : périmètre PCI réduit au **SAQ-A** (aucune saisie/stockage
  carte côté Intralys ; pages de paiement hébergées par le fournisseur).
- ⚠️ Ne JAMAIS ajouter de colonne carte. Si un besoin « last4 /
  card_brand » émerge, ces valeurs doivent provenir **du token
  fournisseur uniquement** et rester non sensibles (jamais le PAN).

**Avant go-live PCI :**
- [ ] Confirmer SAQ-A applicable avec l'acquéreur / le fournisseur.
- [ ] Vérifier que les clés API fournisseur sont en secrets Workers
      (binding), jamais en base ni en clair dans le repo.
- [ ] `payments_live_enabled = 0` tant que la revue légale + PCI n'est
      pas signée (flag inchangé par E9 — voir §4).

---

## 2. RGPD / Loi 25 (Québec) — données client

- **Droit d'accès / portabilité** : export des données customer
  (commandes, paniers, métriques) via les agrégats existants
  (`Customer 360` E7). Documenter la procédure d'export pour le DPO.
- **Droit à l'oubli / suppression** : la suppression d'un `customer`
  doit cascader ou anonymiser les données liées (commandes conservées
  pour obligations comptables → anonymiser l'identité, conserver les
  montants agrégés). Vérifier la politique de rétention.
- **Minimisation** : les analytics E9 (revenu, cohortes, LTV, top
  produits) sont **agrégés / pseudonymisés** — pas de PII exposée dans
  les widgets dashboard. Le churn (`/reco/churn/:id`) renvoie des
  **raisons explicables** (décision automatisée compréhensible — exigence
  Loi 25 art. 12.1 / RGPD art. 22).
- **Consentement** : relances panier abandonné / reconquête / après-achat
  (pack E-commerce, workflows seedés `is_active = 0`) — ne PAS activer
  sans base légale (intérêt légitime ou consentement explicite CASL pour
  le courriel commercial). Le client active manuellement.
- [ ] Mentions légales boutique à jour (vendeur, conditions, retours).
- [ ] Registre des traitements mis à jour (analytics + churn = profilage).
- [ ] Politique de conservation documentée (commandes vs identité).

---

## 3. Cohérence multi-région

- **Devise** : règle d'or **jamais de somme cross-devise** (aucun taux
  FX en base). Tous les agrégats E9 (revenu / LTV / top produits) sont
  **ventilés par devise** côté worker M2 ET côté UI (widgets
  `BoutiqueDashboard`). Hérité de E7.
- **Taxe / legal_flags** : la config régionale (E-R) résout
  devise + taxe + mentions légales par boutique
  (`resolveRegionContext`). Vérifier la cohérence avant go-live multi-pays
  (QC : TPS/TVQ ; FR : TVA ; etc.).
- [ ] Config région boutique vérifiée (`/api/ecommerce/region`).
- [ ] Mentions fiscales correctes par région sur factures.

---

## 4. Checklist go-live — migrations & déploiement

**Ordre d'application des migrations e-commerce** (idempotentes,
`INSERT OR IGNORE` / `CREATE TABLE IF NOT EXISTS`) :

1. `migration-sprintE1-m1-ecommerce-schema.sql`
2. `migration-sprintE1-m2-modules-role.sql`
3. `migration-sprintE2-m2.sql`
4. `migration-sprintER-m1.sql` / `migration-sprintER-m2.sql` (région)
5. `migration-sprintE3-m1.sql`
6. `migration-sprintE4-m1.sql` (paiement — **revue PCI requise**)
7. `migration-sprintE5-m1.sql` / `migration-sprintE5-m2.sql`
8. `migration-sprintE6-m1.sql` / `migration-sprintE6-m2.sql`
   (remboursement/litige — **revue légale requise**)
9. `migration-sprintE7-m1.sql` / `migration-sprintE7-m2.sql`
10. `migration-sprintE8-m1.sql` / `migration-sprintE8-m2.sql`
11. `migration-sprintE9-m1.sql` (workflows e-comm M1)
12. `migration-phase27.sql` (table `industry_packs`, si non déjà appliquée)
13. **`migration-sprintE9-m3.sql`** (seed pack « E-commerce » — ce sprint ;
    dépend de `industry_packs`, à appliquer APRÈS phase27)

> Toutes idempotentes : ré-exécution sans effet de bord. Aucune
> double-ALTER. Convention DB : `id TEXT DEFAULT (lower(hex(randomblob(16))))`,
> `TEXT DEFAULT (datetime('now'))`.

**Bindings / config :**
- [ ] `DB` (D1) bindée sur la base de prod.
- [ ] Secrets fournisseurs paiement en secrets Workers (jamais repo/base).
- [ ] `payments_live_enabled = 0` **inchangé** tant que revue
      PCI + légale (E4/E6) non signée par Rochdi. E9 n'altère PAS ce flag.

**Revue finale :**
- [ ] Revue légale chemins paiement E4 + remboursement/litige E6.
- [ ] Revue PCI (SAQ-A) signée.
- [ ] Revue RGPD/Loi 25 (export, oubli, profilage churn, consentement
      relances).
- [ ] Test E2E commande → paiement (sandbox) → remboursement (sandbox).
- [ ] Workflows e-comm du pack restent `is_active = 0` jusqu'à validation
      consentement par le client.
