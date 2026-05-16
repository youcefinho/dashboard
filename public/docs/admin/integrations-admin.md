---
title: Intégrations (administration)
description: Gérer les connexions au niveau de l'organisation.
section: admin
order: 5
---

# Intégrations (administration)

Réservé aux **administrateurs**. Les intégrations sensibles se gèrent au niveau organisation, pas par membre.

## Connexions organisationnelles

Certaines intégrations s'autorisent une fois pour toute l'organisation :

- **Stripe** (facturation/paiements)
- **Meta** (capture de leads pub)
- **Domaine d'envoi courriel** (SPF/DKIM/DMARC)
- **Google Workspace** (calendrier/courriel partagés)

## Domaine d'envoi & délivrabilité

Pour que tes courriels n'atterrissent pas en pourriel, configure les enregistrements **SPF**, **DKIM** et **DMARC** de ton domaine. Intralys fournit les valeurs DNS exactes ; ton fournisseur de domaine (ou notre support) les ajoute.

## Révoquer une intégration

Déconnecter une intégration au niveau organisation l'enlève pour **tous** les membres. Vérifie l'impact (workflows, capture de leads) avant.

## Surveillance

L'onglet **Intégrations → État** montre la santé de chaque connexion (OK / expirée / erreur). Une connexion expirée (token OAuth) doit être reconnectée par un admin.

## Webhooks sortants

Les webhooks de l'organisation se gèrent ici aussi — voir [Configuration des webhooks](/help/webhooks-config).

## Prochaines étapes

- [Clés API →](/help/cles-api)
- [Configuration des webhooks →](/help/webhooks-config)
