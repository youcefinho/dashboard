# Envoyer des emails automatiques

## Ajouter une action Email

Dans le workflow builder, ajoutez l'action **Envoyer email**.

## Choisir un template

Sélectionnez un template existant ou créez-en un nouveau depuis **Templates → Email**.

## Variables dynamiques

Insérez des variables personnalisées :
- `{{lead.first_name}}`
- `{{lead.email}}`
- `{{company.name}}`
- `{{appointment.date}}`

## Expéditeur

Configurez l'expéditeur (votre nom, votre adresse). Pour utiliser votre domaine, configurez SPF/DKIM dans **Paramètres → Domaine email**.

## Délai d'envoi

Vous pouvez ajouter un délai avant l'envoi (immédiat, +1h, +1 jour, etc.).

## Suivi

Tous les emails envoyés sont tracés : ouverture, clic, bounce, désabonnement.

## Conformité

Tous les emails marketing incluent automatiquement un lien de désabonnement (obligatoire CASL au Canada).
