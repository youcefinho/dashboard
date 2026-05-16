---
title: Limites de débit
description: Quotas de requêtes, en-têtes et bonnes pratiques de reprise.
section: api
order: 5
---

# Limites de débit

Pour garantir la stabilité du service, l'API publique applique des **limites de débit** (rate limiting) par clé API.

## Quotas

| Plan | Par minute | Par heure |
|------|-----------|-----------|
| Standard | 100 req/min | 5 000 req/h |
| Pro | 500 req/min | 25 000 req/h |
| Entreprise | Sur mesure | Sur mesure |

La pagination est plafonnée : `limit` maximum **100** par requête sur `/leads`.

## En-têtes de réponse

Chaque réponse inclut l'état de ton quota :

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1715789580
```

`X-RateLimit-Reset` est un timestamp Unix : moment où le compteur se réinitialise.

## Dépassement

Au-delà du quota, l'API renvoie **429 Too Many Requests**. Respecte l'en-tête `Retry-After` (secondes) avant de réessayer.

## Bonnes pratiques

- **Backoff exponentiel** sur les `429` et `5xx` (1 s, 2 s, 4 s, 8 s…)
- **Pagine** plutôt que de tout charger : `limit`/`offset`
- **Mets en cache** les données peu changeantes côté client
- Préfère les **webhooks** au polling : laisse Intralys te pousser les événements plutôt que d'interroger en boucle
- Lisse les imports massifs (batchs espacés) plutôt qu'une rafale

## Exemple de reprise (JavaScript)

```js
async function callWithRetry(url, opts, max = 5) {
  for (let attempt = 0; attempt < max; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 && res.status < 500) return res;
    const wait = Number(res.headers.get('Retry-After')) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  throw new Error('Rate limit: abandon après tentatives');
}
```

## Prochaines étapes

- [Authentification →](/help/authentication)
- [Référence des endpoints →](/help/endpoints-reference)
