---
title: Journal d'audit
description: Tracer qui a fait quoi, quand — exigence Loi 25.
section: admin
order: 8
---

# Journal d'audit

Réservé aux **administrateurs**. Le journal d'audit enregistre les actions sensibles — clé pour la conformité Loi 25.

## Ce qui est journalisé

- Connexions / déconnexions / échecs d'authentification
- Création, modification, suppression de leads
- Changements de rôle et de permissions
- Accès et exports de données personnelles
- Création/révocation de clés API et webhooks
- Suppressions Loi 25 (droit à l'oubli)

## Consulter le journal

**Settings → Audit**. Chaque entrée : horodatage, acteur (utilisateur ou clé API), action, cible, adresse IP. Filtre par membre, type d'action, période.

## Exporter pour audit

Exporte une plage de dates en CSV pour une revue interne, un auditeur externe ou une demande réglementaire. L'export est lui-même journalisé.

## Rétention

Les entrées d'audit sont conservées selon la politique de rétention de l'organisation (au moins la durée exigée par la Loi 25). Elles ne sont pas modifiables ni supprimables manuellement (intégrité).

## Bon usage

- Revue **mensuelle** des changements de rôle et créations de clés API
- Alerte sur les **échecs de connexion répétés** (tentative d'intrusion)
- Conserver les exports liés à une demande Loi 25 dans ton dossier de conformité

## Prochaines étapes

- [Conformité Loi 25 (admin) →](/help/conformite-loi25-admin)
- [Sécurité & 2FA →](/help/securite-2fa)
