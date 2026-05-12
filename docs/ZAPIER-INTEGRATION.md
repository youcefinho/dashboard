# Intégration Zapier - Intralys CRM

L'application Zapier pour Intralys CRM permet d'automatiser vos flux de travail entre Intralys et plus de 5000 autres applications sans coder.

## Statut Actuel
L'application est actuellement en mode **Privé/Sandbox**. Vous devez obtenir un lien d'invitation privé auprès du support Intralys pour l'ajouter à votre compte Zapier.

## Prérequis
1. Un compte Zapier.
2. Un accès administrateur à votre Dashboard Intralys.
3. Une Clé API Intralys générée depuis **Settings > API & Webhooks**.

## Triggers (Déclencheurs)
Ces événements déclenchent vos Zaps en temps réel grâce aux Webhooks (instantané) :

- **Nouveau Lead (New Lead)** : Se déclenche instantanément lorsqu'un lead est créé (via formulaire web, import, ou ajout manuel).
- **Nouvelle Tâche (New Task)** : Se déclenche à la création d'une tâche.
- **Nouveau Rendez-vous (New Appointment)** : Se déclenche lorsqu'un rendez-vous est booké dans le calendrier Intralys.
- *(Bientôt)* : Lead Modifié, Message Reçu.

*Note de sécurité : L'application Zapier vérifie automatiquement la signature HMAC (`X-Intralys-Signature`) pour garantir que les événements proviennent bien de votre serveur Intralys.*

## Actions (Opérations)
Intralys peut être mis à jour suite à un événement dans une autre app :

- **Créer un Lead (Create Lead)** : Ajoute un prospect dans le CRM Intralys.
- **Ajouter un Tag (Add Tag)** : Ajoute un tag spécifique à un lead existant.
- **Envoyer un SMS (Send SMS)** : Envoie un message texte à un prospect via la ligne Intralys du courtier.
- **Envoyer un Email (Send Email)** : Envoie un email transactionnel à un prospect.

## Exemples de cas d'usage (Zaps populaires)

1. **Facebook Lead Ads → Intralys** : Quand un formulaire Facebook est soumis, créer automatiquement un Lead dans Intralys et lui envoyer un SMS de bienvenue.
2. **Intralys → Google Sheets** : Quand un Nouveau Lead est créé dans Intralys, ajouter une ligne dans un tableau de bord Google Sheets pour la comptabilité.
3. **Calendly → Intralys** : Si vous utilisez un calendrier externe non connecté nativement, créer un Rendez-vous ou une Tâche dans Intralys quand un slot est réservé.
4. **Intralys → Slack** : Quand un Nouveau Lead arrive sur votre site immobilier, envoyer une notification Slack à l'équipe.
