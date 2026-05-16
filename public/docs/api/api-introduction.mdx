---
title: Introduction à l'API
description: API REST publique d'Intralys — vue d'ensemble, base URL, premiers appels.
section: api
order: 1
---

# Introduction à l'API

Intralys expose une **API REST publique** pour gérer leads, tâches, rendez-vous, messages et webhooks par programmation.

## Base URL

```
https://app.intralys.app/api/public/v1
```

Tous les endpoints documentés ici sont relatifs à cette base.

## Spécification OpenAPI

- **Fichier** : [`/docs/api/openapi.yaml`](/docs/api/openapi.yaml) (OpenAPI 3.1)
- **Spec live** : `GET https://app.intralys.app/api/openapi.json`
- **Explorateur Swagger** : `https://app.intralys.app/docs/api`

## Authentification

L'API utilise une **clé API** dans l'en-tête `Authorization`, au format `ApiKey` :

```
Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx
```

Crée et scope tes clés dans **Settings → API & Webhooks**. Détails : [Authentification](/help/authentication).

## Format des réponses

Les réponses réussies enveloppent les données dans `data` :

```json
{ "data": { "id": "lead_abc123" } }
```

Les erreurs renvoient un objet `error` avec le code HTTP approprié :

```json
{ "error": "Non autorisé" }
```

## Premier appel — qui suis-je ?

```bash
curl https://app.intralys.app/api/public/v1/me \
  -H "Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx"
```

Réponse :

```json
{
  "data": {
    "client_id": "cli_123",
    "user_id": "usr_456",
    "scopes": ["read", "write"]
  }
}
```

## Endpoints disponibles

| Méthode | Endpoint | Scope |
|---------|----------|-------|
| GET | `/me` | — |
| GET | `/leads` | read |
| POST | `/leads` | write |
| GET | `/leads/{id}` | read |
| PATCH | `/leads/{id}` | write |
| POST | `/leads/{id}/tags` | write |
| POST | `/leads/{id}/messages` | write |
| GET | `/tasks` | read |
| POST | `/tasks` | write |
| GET | `/appointments` | read |
| POST | `/appointments` | write |
| POST | `/webhooks` | — |
| DELETE | `/webhooks/{id}` | — |

Détail complet : [Référence des endpoints](/help/endpoints-reference).

## Conformité intégrée

> Les envois de messages via l'API respectent automatiquement les **désabonnements CASL** et les **préférences de contact Loi 25**. Un envoi vers un canal refusé est bloqué côté serveur — pas besoin de le gérer dans ton code.

## Prochaines étapes

- [Authentification →](/help/authentication)
- [Limites de débit →](/help/rate-limits)
- [Référence des endpoints →](/help/endpoints-reference)
- [API & Webhooks (guide non technique) →](/help/api-webhooks)
