---
title: Rôles & permissions
description: Qui peut voir et faire quoi dans Intralys.
section: admin
order: 3
---

# Rôles & permissions

Réservé aux **administrateurs**. Le modèle de rôles d'Intralys.

## Les 4 rôles

| Rôle | Leads | Pipeline/Workflows | Rapports | Settings | Facturation |
|------|-------|--------------------|----------|----------|-------------|
| **Admin** | Tous | Oui | Oui | Oui | Oui |
| **Manager** | Tous | Oui | Oui | Limité | Non |
| **Commercial** | Assignés | Vue seule | Les siens | Non | Non |
| **Lecture seule** | Vue seule | Vue seule | Vue seule | Non | Non |

## Principe de moindre privilège

Donne le rôle **minimum** suffisant. Un commercial n'a pas besoin de voir tous les leads de l'équipe ni les paramètres. Ça limite les risques (Loi 25) et le bruit.

## Cloisonnement des leads

Un **Commercial** ne voit que ses leads assignés — il ne peut pas exporter ni consulter le pipeline complet. Idéal pour les équipes où la confidentialité du portefeuille compte.

## Accès aux fonctions sensibles

- **Facturation & abonnement** — Admin uniquement
- **Clés API & webhooks** — Admin uniquement
- **Journal d'audit** — Admin uniquement
- **Suppression Loi 25** — Admin (ou Manager si délégué)

## Changer un rôle

Effet immédiat, journalisé dans l'audit log. Une rétrogradation révoque l'accès aux écrans concernés à la prochaine navigation.

## Prochaines étapes

- [Gérer les utilisateurs →](/help/gerer-utilisateurs)
- [Journal d'audit →](/help/audit-log)
