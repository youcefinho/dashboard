# Documentation API Publique Intralys

L'API Publique Intralys vous permet d'intégrer votre CRM Intralys avec vos propres systèmes ou applications tierces.

## Authentification

Toutes les requêtes vers l'API publique (sous le préfixe `/api/public/v1`) doivent être authentifiées avec une **Clé API**.

- Allez dans **Settings > API & Webhooks** depuis le Dashboard Intralys.
- Créez une nouvelle clé.
- Copiez la clé (elle ne sera plus visible ensuite).

Ajoutez cette clé dans le header `Authorization` de vos requêtes :
```http
Authorization: ApiKey ILYS_votrecletreslongue12345
```

Alternative (compatibilité Zapier/OAuth2) :
```http
Authorization: Bearer ILYS_votrecletreslongue12345
```

## Endpoints Principaux

Tous les endpoints commencent par : `https://votredomaine.com/api/public/v1`

### Tester l'authentification
`GET /me`
Retourne les informations du client associé à la clé API et les scopes accordés.

### Leads
- `GET /leads` : Liste les leads (supporte la pagination et filtres).
- `POST /leads` : Crée un nouveau lead (Idéal pour les formulaires externes).
- `GET /leads/:id` : Détails d'un lead.
- `PATCH /leads/:id` : Met à jour un lead.
- `POST /leads/:id/tags` : Ajoute un tag (Format: `{"tag": "VIP"}`).
- `POST /leads/:id/messages` : Envoie un message SMS ou Email au lead.

### Tâches & Rendez-vous
- `GET /tasks` : Liste les tâches.
- `POST /tasks` : Crée une tâche.
- `GET /appointments` : Liste les rendez-vous.
- `POST /appointments` : Crée un rendez-vous (Calendrier).

### Webhooks (Gestion des abonnements)
- `POST /webhooks` : S'abonner aux webhooks. Payload : `{"url": "https://votre-serveur.com/hook", "events": "lead.created,task.created"}`. Retourne l'ID et le `secret` pour la vérification HMAC.
- `DELETE /webhooks/:id` : Supprimer un abonnement.

## Rate Limiting
La limite par défaut est de **1000 requêtes par heure** par clé API. En cas de dépassement, l'API renvoie un statut HTTP `429 Too Many Requests`.

## Format de réponse
Toutes les réponses de l'API suivent ce format :
```json
{
  "data": { ... } 
}
// ou en cas d'erreur
{
  "error": "Message d'erreur"
}
```
