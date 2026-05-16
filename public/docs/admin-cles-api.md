---
title: Clés API
description: Créer, scoper et révoquer les clés API de l'organisation.
section: admin
order: 6
---

# Clés API

Réservé aux **administrateurs**. Les clés API donnent un accès programmatique aux données — à manier avec rigueur.

## Créer une clé

**Settings → API & Webhooks → Nouvelle clé**. Donne-lui :

- Un **nom** descriptif (« Zapier prod », « script compta »)
- Un **scope** : `read` (lecture seule) ou `read+write`

La clé `ILYS_...` n'est affichée **qu'une seule fois**. Copie-la immédiatement dans un coffre (gestionnaire de secrets), jamais en clair dans un courriel ou un dépôt Git.

## Scopes

- **read** — lister/consulter leads, tâches, rendez-vous
- **write** — créer/modifier leads, tâches, rendez-vous, déclencher des webhooks

Une clé d'intégration en lecture (reporting) ne devrait jamais avoir `write`.

## Format d'authentification

En-tête HTTP :

```
Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx
```

Voir la [référence des endpoints](/help/endpoints-reference).

## Rotation & révocation

- **Révoquer** une clé compromise est immédiat et définitif
- Fais une **rotation périodique** (créer la nouvelle, migrer, révoquer l'ancienne)
- Une clé par intégration : si l'une fuit, tu révoques sans tout casser

## Audit

Chaque création/révocation de clé est journalisée dans le [journal d'audit](/help/audit-log). L'usage d'une clé y est tracé (endpoint, horodatage).

## Prochaines étapes

- [Configuration des webhooks →](/help/webhooks-config)
- [Journal d'audit →](/help/audit-log)
