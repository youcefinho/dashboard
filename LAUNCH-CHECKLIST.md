# Liste de contrôle - Lancement Bêta Intralys

Avant d'inviter les 5 premiers clients, vérifiez que ces points sont complétés :

## 1. Déploiement Cloudflare
- [ ] Base de données de production D1 créée (`npx wrangler d1 create intralys-crm-prod`)
- [ ] Exécuter les migrations (`npx wrangler d1 execute intralys-crm-prod --remote --file=schema.sql`)
- [ ] ID D1 ajouté dans `wrangler.jsonc` ou via les variables d'environnement Cloudflare.
- [ ] Vérifier les clés Resend (`RESEND_API_KEY`) dans les secrets Cloudflare.
- [ ] Configurer l'URL de base dans `.env.production`.
- [ ] Lancer le déploiement (`bun run build` puis `npx wrangler deploy`).

## 2. Validation Technique
- [ ] Vérifier que le login fonctionne sur le domaine en production.
- [ ] Le workflow d'onboarding (`OnboardingWizard`) se lance bien lors du premier login.
- [ ] Le `FeedbackWidget` et la `NpsModal` insèrent correctement dans la base de données.
- [ ] Les pages publiques (`/`, `/pricing`, `/help`) se chargent sans nécessiter d'authentification.
- [ ] Installer un pack métier depuis le wizard et vérifier que les workflows associés se créent bien en base de données.

## 3. Paramétrage Clients Bêta
- [ ] Lier les 5 codes d'invitation à des adresses courriel de courtiers, ou envoyer les liens d'inscriptions avec `?code=XXX`.
- [ ] Faire un test de création de lead pour vérifier que l'email de notification automatique (si défini) part bien via Resend.
- [ ] Vérifier que l'interface mobile (PWA) charge correctement sur un iPhone de test.

## 4. Communication
- [ ] Rédiger et programmer l'email d'annonce aux bêta-testeurs.
- [ ] Assurer un suivi manuel "white-glove" dans les 48h suivant leur premier login.
