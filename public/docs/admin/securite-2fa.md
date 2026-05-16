---
title: Sécurité & 2FA
description: Renforcer la sécurité d'accès de l'organisation.
section: admin
order: 10
---

# Sécurité & 2FA

Réservé aux **administrateurs**. Les leviers pour protéger l'accès aux données clients.

## Double authentification (2FA / TOTP)

Active la 2FA et **exige-la** pour tous les membres : **Settings → Sécurité → Exiger la 2FA**. Chaque membre configure une app d'authentification (TOTP) à la prochaine connexion.

- Codes à 6 chiffres, app type Google Authenticator / 1Password
- **Codes de secours** à générer et conserver hors ligne (perte du téléphone)
- La désactivation 2FA d'un membre est journalisée

## Politique de mot de passe

Longueur minimale, complexité, et réinitialisation forcée si compromission suspectée. Les réinitialisations passent par un lien à durée limitée.

## Gestion des sessions

- Voir les **sessions actives** par membre (appareil, IP, dernière activité)
- **Révoquer** une session suspecte à distance
- Déconnexion automatique après inactivité prolongée

## Bonnes pratiques admin

- 2FA **obligatoire**, sans exception, à partir du premier jour
- **Moindre privilège** sur les rôles (voir [Rôles & permissions](/help/roles-permissions))
- Revue **mensuelle** du [journal d'audit](/help/audit-log)
- Une **clé API par intégration**, en lecture seule quand c'est suffisant
- Désactivation immédiate des comptes au départ d'un employé

## Chiffrement

Les données sont chiffrées **en transit** (HTTPS/TLS) et **au repos**. Les secrets (clés API, tokens) sont stockés chiffrés, jamais en clair.

## Prochaines étapes

- [Gérer les utilisateurs →](/help/gerer-utilisateurs)
- [Journal d'audit →](/help/audit-log)
- [Conformité Loi 25 (admin) →](/help/conformite-loi25-admin)
