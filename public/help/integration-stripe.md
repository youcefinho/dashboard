# Paiements avec Stripe

Acceptez les paiements en ligne dans vos factures Intralys.

## Étape 1 — Compte Stripe

Si vous n'en avez pas, créez un compte sur stripe.com (gratuit).

## Étape 2 — Connexion

**Paramètres → Intégrations → Stripe → Connecter avec Stripe**. Vous serez redirigé chez Stripe pour autoriser.

## Étape 3 — Activation factures

Une fois connecté, toutes vos factures incluent automatiquement un bouton **Payer en ligne**.

## Méthodes acceptées

- Cartes (Visa, MasterCard, Amex)
- Apple Pay / Google Pay
- Interac (Canada)
- Paiements récurrents (abonnements)

## Frais Stripe

Stripe prélève 2.9% + 0.30$ par transaction. Intralys n'ajoute aucun frais.

## Webhooks automatiques

Quand un paiement est reçu, le statut de la facture passe à "Payée" et un workflow peut se déclencher (email merci, etc.).
