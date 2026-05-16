---
title: Slash-variables
description: Personnaliser tes messages sans copier-coller.
section: communication
order: 2
---

# Slash-variables

Les **slash-variables** insèrent automatiquement les infos du lead dans ton message. Fini le « Bonjour [prénom] » oublié.

## Comment ça marche

Dans la zone de message de l'Inbox, tape `/`. Un menu propose les variables disponibles :

- `/prenom` → le prénom du lead
- `/nom` → nom complet
- `/entreprise` → société du lead
- `/proprietaire` → ton nom (l'utilisateur courant)
- `/calendly` → ton lien de réservation
- `/etape` → étape pipeline actuelle

Sélectionne-la : elle s'insère et sera **remplacée par la vraie valeur** à l'envoi.

## Exemple

Tu tapes :

```
Bonjour /prenom, suite à notre échange chez /entreprise,
voici un créneau : /calendly
```

Le lead « Marie Dubois » de « Clinique Vie » reçoit :

> Bonjour Marie, suite à notre échange chez Clinique Vie, voici un créneau : https://...

## Valeur manquante ?

Si une variable n'a pas de valeur (lead sans entreprise), Intralys te prévient avant l'envoi pour éviter un « Bonjour ,  » embarrassant.

## Dans les templates

Les slash-variables fonctionnent aussi dans les **templates** et les **réponses rapides** — écris-les une fois, réutilise partout.

## Prochaines étapes

- [Réponses rapides →](/help/reponses-rapides)
- [La messagerie unifiée →](/help/messagerie-unifiee)
