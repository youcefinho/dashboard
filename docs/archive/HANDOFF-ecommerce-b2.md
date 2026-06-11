# HANDOFF — Module E-commerce B2 (pause 2026-05-16)

> Source de vérité complète = mémoire auto `ecommerce_module_b2.md` (se recharge automatiquement dans la prochaine conversation Claude). Ce fichier = résumé lisible repo. **On est sur VM : aucune commande git n'est lancée, sauvegarde par fichiers uniquement.**

## État

| Sprint | Statut |
|---|---|
| E1 Fondation (schéma 15 tables + feature-flag modules + skeleton) | ✅ code-complete |
| E2 Catalogue produits/variantes/SKU/inventaire | ✅ code-complete |
| E3 Commandes/line items/TPS-TVQ/panier/facture | ✅ code-complete |
| E-R Internationalisation (multi-devise + moteur taxes pluggable QC/UE/DZ) | ✅ code-complete |
| E4 Paiement multi-provider (Stripe+COD+stub DZ) | ✅ code-complete — ⚠️ RÉGULÉ non-cleared-prod |
| E5 Fulfillment region-aware (shipments/zones/tarifs/BL PDF) | ✅ code-complete |
| E6 Remboursements/litiges/RMA + conso QC-UE-DZ | ✅ code-complete — ⚠️ RÉGULÉ non-cleared-prod |
| E7 Customer 360 + RFM + LTV multi-devise + panier abandonné | ✅ code-complete |
| E8 Omnicanal concurrent (3 stratégies inventaire + Shopify/Woo) | ✅ code-complete |
| E9 Workflows e-comm + analytics + reco IA + pack + hardening | ✅ code-complete |

## ✅ ROADMAP B2 COMPLÈTE (2026-05-17)

Tous les sprints E-R + E1→E9 sont code-complete. Module e-commerce B2 intégral : multi-région DZ/UE/QC, paiement marchand (Stripe/COD/stub DZ), fulfillment, remboursements/RMA, Customer 360/RFM, omnicanal Shopify/Woo concurrent (3 stratégies inventaire), workflows e-comm, analytics revenu/cohortes, reco IA. **Plus rien à coder.**

## Reprise demain — checklist

1. **Lire** `ecommerce_module_b2.md` section "⏸️ REPRISE DEMAIN" (chargée auto en mémoire).
2. **E8 M1 = déjà fait** (vérif rapide disque : inventory-strategy.ts/migration-sprintE8-m1.sql/types.ts/ecommerce.ts) → enchaîner directement E8 Phase B.
3. **E8 Phase B** : M2 (connecteurs Shopify/Woo + sync + câblage worker.ts) ∥ M3 (ChannelSettings + UI + api.ts + i18n) — contrats figés dans la mémoire.
4. **E9** : Chaman dédié puis Phase A/B.
5. Méthode : **Chaman (Plan agent READ-ONLY) AVANT les 3 Managers**, Managers en parallèle `run_in_background`, Phase A/B selon verdict Chaman. Convention DB `datetime('now')` (PAS unixepoch).

## Dette build (Rochdi, avant prod — jamais buildé sur VM)

- `bun run build` + `tsc` sur tout (Sprint 42-51 + E-series), corriger.
- Réconcilier timestamp Sprint 43/46/49/51 (unixepoch) vs reste (datetime).
- Dédupliquer types région E-R (api.ts vs types.ts).
- E4 : créer endpoint GET/PUT payment config (PaymentSettings lecture seule).
- Appliquer tous `migration-sprint*.sql` (déduplication gclid S51 m1+m2).
- Bindings wrangler : NOTIFICATION_ROOMS, ANTHROPIC_API_KEY, META_APP_SECRET, STRIPE_*, SHOPIFY_*/WOO_*.
- E4/E6 régulés : `payments_live_enabled=0` défaut. Go-live conditionné revue légale/PCI/RGPD.
