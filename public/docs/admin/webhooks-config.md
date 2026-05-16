---
title: Configuration des webhooks
description: Mettre en place des webhooks fiables au niveau organisation.
section: admin
order: 7
---

# Configuration des webhooks

Réservé aux **administrateurs**. Les webhooks notifient un service externe à chaque événement Intralys.

## Créer un webhook

**Settings → API & Webhooks → Nouveau webhook** :

1. **URL de destination** (HTTPS obligatoire)
2. **Événements** abonnés : `lead.created`, `lead.updated`, `message.received`, `task.created`, `deal.won`…
3. **Secret de signature** (généré) pour vérifier l'authenticité côté récepteur

## Vérifier la signature

Chaque envoi inclut un en-tête de signature HMAC calculé avec ton secret. Côté récepteur, recalcule et compare avant de traiter — ça empêche les faux appels.

## Format du payload

JSON, avec `event`, `timestamp`, et `data` (l'objet concerné). Idempotence : chaque envoi a un `id` unique — déduplique côté récepteur.

## Reprises (retry)

Si ton endpoint ne répond pas `2xx`, Intralys retente avec backoff exponentiel (plusieurs tentatives sur ~24 h). Réponds vite (`200`) puis traite en asynchrone pour éviter les timeouts.

## Tester

Bouton **Envoyer un test** : un événement factice part vers ton URL. L'onglet **Livraisons** montre l'historique (statut, code HTTP, corps de réponse) pour déboguer.

## Désactiver / supprimer

Désactive temporairement (sans perdre la config) ou supprime. Les webhooks via clé API publique se gèrent aussi par l'[API publique](/help/endpoints-reference) (`POST /webhooks`, `DELETE /webhooks/{id}`).

## Prochaines étapes

- [Clés API →](/help/cles-api)
- [Référence des endpoints →](/help/endpoints-reference)
