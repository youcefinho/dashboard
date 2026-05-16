---
title: Automatisations du pipeline
description: Déclencher des actions automatiques quand un deal change d'étape.
section: automation
order: 1
---

# Automatisations du pipeline

Fais travailler ton pipeline à ta place. Chaque changement d'étape peut déclencher des actions.

## Le principe : déclencheur → action

Une automatisation a deux parties :

- **Déclencheur** — « quand un lead entre dans l'étape Proposition »
- **Action(s)** — « envoie le courriel devis + crée une tâche de relance à J+3 »

## Créer une règle

Va dans **Pipeline → Réglages → Automatisations** (ou **Workflows**). Choisis :

1. L'étape déclencheuse (entrée ou sortie)
2. Une condition optionnelle (score ≥ 50, source = référence…)
3. Une ou plusieurs actions

## Actions disponibles

- Envoyer un courriel / SMS (depuis un template)
- Créer une tâche assignée
- Ajouter ou retirer un tag
- Changer le propriétaire
- Notifier un membre de l'équipe
- Appeler un **webhook** externe (Zapier, etc.)

## Exemple concret

> Quand un lead entre dans **Négociation** :
> 1. SMS « On peut s'appeler cette semaine ? »
> 2. Tâche « Préparer le contrat » assignée au propriétaire, échéance J+2
> 3. Tag `négo-en-cours`

## Tester avant d'activer

Chaque règle a un mode **brouillon**. Active-la sur un lead test d'abord. Les actions exécutées apparaissent dans la timeline du lead pour audit.

## Prochaines étapes

- [Configurer ton pipeline →](/help/configurer-pipeline)
- [La prévision (forecast) →](/help/forecast)
