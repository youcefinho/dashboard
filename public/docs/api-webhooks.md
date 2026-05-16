---
title: API & Webhooks
description: Recevoir des événements et piloter Intralys par programmation.
section: api
order: 3
---

# API & Webhooks

Pour les usages avancés, Intralys expose une **API REST** et des **webhooks**. Pas besoin d'être développeur pour les bases.

## C'est quoi un webhook ?

Un **webhook** prévient un autre service quand un événement se produit dans Intralys (nouveau lead, deal gagné…). Tu donnes une URL, on y envoie les données automatiquement.

## Créer un webhook

**Settings → API & Webhooks → Nouveau webhook** :

1. Colle l'URL de destination (ton Zapier, Make, ou serveur)
2. Choisis les événements (lead créé, lead mis à jour, message reçu…)
3. Enregistre — un événement test est envoyé pour valider

## Clés API

Pour appeler l'API depuis ton code ou Zapier, génère une **clé API** dans le même écran. Format `ILYS_...`. Garde-la secrète — elle donne accès à tes données.

Chaque clé a des **scopes** (lecture seule, lecture+écriture) pour limiter ce qu'elle peut faire.

## Documentation développeur

La référence technique complète (endpoints, authentification, exemples curl/JS/Python, spec OpenAPI) est dans la section développeurs :

- [Introduction à l'API →](/help/api-introduction)
- [Authentification →](/help/authentication)
- [Limites de débit →](/help/rate-limits)
- [Référence des endpoints →](/help/endpoints-reference)

## Cas d'usage fréquents

- Pousser les leads d'un formulaire externe vers Intralys
- Notifier Slack quand un deal est gagné
- Synchroniser avec un outil de compta

## Prochaines étapes

- [Introduction à l'API →](/help/api-introduction)
- [Intégrations →](/help/integrations)
