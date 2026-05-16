# Changelog

Toutes les évolutions notables d'Intralys CRM.

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage proche de [SemVer](https://semver.org/lang/fr/).

## [1.0.0-beta] - 2026-05-16

Release candidate beta — prête pour les premiers utilisateurs.

### Ajouté

- Documentation utilisateur complète (30+ guides, FR québécois).
- Documentation administrateur (10 guides : organisation, équipe, rôles, facturation, intégrations, clés API, webhooks, audit, Loi 25, 2FA).
- Documentation développeur : spécification OpenAPI 3.1 (`/docs/api/openapi.yaml`), introduction API, authentification, limites de débit, référence des endpoints avec exemples curl/JS/Python.
- Page Nouveautés (changelog) publique sur `/changelog`.
- Fichier `CHANGELOG.md` racine.

### Modifié

- Centre d'aide enrichi : recherche fuzzy, navigation par sections, section Administration et section API & Développeurs.
- Page changelog refondue en style Stripe sobre (timeline verticale, badges de version, catégories Ajouté/Modifié/Corrigé/Retiré) — remplace l'ancienne version à effets visuels.
- `api-introduction` aligné sur l'implémentation réelle du worker (`/api/public/v1`, auth `ApiKey`).

## [0.12.0] - 2026-05-15

### Ajouté

- Site public : accueil, tarifs, blog, à propos, contact.
- Multilingue : français, anglais, espagnol.
- IA avancée : rédaction assistée, prédictions, insights.

### Modifié

- Accessibilité renforcée jusqu'au niveau AAA.

## [0.11.0] - 2026-04

### Ajouté

- Applications mobiles natives iOS et Android.
- Mode hors-ligne.
- Constructeur de tableaux de bord personnalisés.

### Modifié

- Navigation mobile repensée (gestes, pull-to-refresh).

## [0.10.0] - 2026-04

### Ajouté

- Messagerie unifiée enrichie : réactions, réponses rapides, brouillons IA.
- Calendrier avec glisser-déposer et pages de réservation.

### Modifié

- Performance générale environ deux fois plus rapide.
- IA déplacée côté serveur pour plus de fiabilité.

## [0.9.0] - 2026-03

### Modifié

- Refonte design complète : interface épurée style Stripe.
- Tableau de bord, leads et pipeline redessinés.

### Retiré

- Effets visuels superflus, au profit de la clarté et de la lisibilité.

[1.0.0-beta]: https://app.intralys.app/changelog
[0.12.0]: https://app.intralys.app/changelog
[0.11.0]: https://app.intralys.app/changelog
[0.10.0]: https://app.intralys.app/changelog
[0.9.0]: https://app.intralys.app/changelog
