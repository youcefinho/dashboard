---
title: Authentification
description: Clés API, scopes et en-tête Authorization.
section: api
order: 4
---

# Authentification

L'API publique d'Intralys s'authentifie par **clé API** dans l'en-tête HTTP `Authorization`.

## Format

```
Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx
```

Le préfixe `ApiKey ` (avec l'espace) est obligatoire. Le jeton commence toujours par `ILYS_`.

## Créer une clé

1. **Settings → API & Webhooks → Nouvelle clé**
2. Donne un nom descriptif (« Zapier prod »)
3. Choisis le **scope** : `read` ou `read+write`
4. Copie la clé **immédiatement** — elle n'est affichée qu'une fois

## Scopes

| Scope | Permet |
|-------|--------|
| `read` | `GET` sur leads, tasks, appointments, `/me` |
| `write` | en plus : `POST`/`PATCH`, ajout de tags, envoi de messages |

Un appel sans le scope requis renvoie **403 Forbidden**. Une clé absente, malformée ou révoquée renvoie **401 Unauthorized**.

## Vérifier ta clé

```bash
curl https://app.intralys.app/api/public/v1/me \
  -H "Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx"
```

Un `200` avec `client_id`, `user_id` et `scopes` confirme que la clé est valide.

## Bonnes pratiques

- **Une clé par intégration** — révocable isolément en cas de fuite
- **Lecture seule** quand l'écriture n'est pas nécessaire
- **Jamais en clair** dans un dépôt Git, un courriel ou le front-end
- **Rotation périodique** : crée la nouvelle, migre, révoque l'ancienne
- Stocke la clé dans un **gestionnaire de secrets** (variables d'environnement chiffrées)

## Révocation

**Settings → API & Webhooks → (clé) → Révoquer**. Effet immédiat et définitif. Toute requête avec une clé révoquée renvoie `401`.

## Prochaines étapes

- [Introduction à l'API →](/help/api-introduction)
- [Limites de débit →](/help/rate-limits)
- [Référence des endpoints →](/help/endpoints-reference)
