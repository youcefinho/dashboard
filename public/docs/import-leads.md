---
title: Importer des leads
description: Charger un CSV/Excel, mapper les colonnes, éviter les doublons.
section: leads-pipeline
order: 2
---

# Importer des leads

Tu as une liste de prospects dans Excel ou un autre CRM ? Importe-la en quelques clics.

## Lancer l'import

Va dans **Leads → Importer**. Glisse-dépose ton fichier ou clique pour le sélectionner. Formats acceptés :

- `.csv` (recommandé)
- `.xlsx` (Excel)

## Le mapping des colonnes

Intralys devine automatiquement les colonnes courantes : `email`, `téléphone`, `nom`, `prénom`, `source`. Vérifie le mapping proposé et ajuste au besoin :

1. Glisse chaque colonne de ton fichier vers le champ Intralys correspondant
2. Les colonnes non mappées sont ignorées (ou stockées en champ personnalisé si tu le choisis)
3. Aperçu des 5 premières lignes avant validation

## Dédoublonnage

Avant l'import, choisis la clé de détection des doublons :

- Par **courriel** (le plus fiable)
- Par **téléphone**
- Aucun (tout importer)

Les doublons détectés sont soit ignorés, soit fusionnés (tu choisis).

## Tags d'import

Ajoute un **tag d'import** (ex. `import-mai-2026`) pour retrouver facilement ce lot plus tard et mesurer sa performance.

## Conformité Loi 25 / CASL

> En important des contacts, tu confirmes avoir une **base légale** pour les contacter (consentement, relation d'affaires existante). Intralys journalise la source du consentement. Voir [Conformité Loi 25](/help/loi-25-conformite).

## Prochaines étapes

- [Gérer tes leads →](/help/gerer-leads)
- [Conformité Loi 25 →](/help/loi-25-conformite)
