---
title: Référence des endpoints
description: Tous les endpoints de l'API publique avec exemples curl, JS et Python.
section: api
order: 6
---

# Référence des endpoints

Base URL : `https://app.intralys.app/api/public/v1`
En-tête requis : `Authorization: ApiKey ILYS_...`

> Référence dérivée des routes réelles du worker (`/api/public/v1/`). Spec machine : [`/docs/api/openapi.yaml`](/docs/api/openapi.yaml).

## Tableau récapitulatif

| Méthode | Endpoint | Scope | Description |
|---------|----------|-------|-------------|
| GET | `/me` | — | Identité de la clé API |
| GET | `/leads` | read | Lister les leads (`limit`, `offset`, `status`) |
| POST | `/leads` | write | Créer un lead |
| GET | `/leads/{id}` | read | Détail d'un lead |
| PATCH | `/leads/{id}` | write | Mettre à jour un lead |
| POST | `/leads/{id}/tags` | write | Ajouter un tag |
| POST | `/leads/{id}/messages` | write | Envoyer un message |
| GET | `/tasks` | read | Lister les tâches |
| POST | `/tasks` | write | Créer une tâche |
| GET | `/appointments` | read | Lister les rendez-vous |
| POST | `/appointments` | write | Créer un rendez-vous |
| POST | `/webhooks` | — | Créer un webhook sortant |
| DELETE | `/webhooks/{id}` | — | Supprimer un webhook |

---

## 1. Lister les leads — `GET /leads`

Paramètres : `limit` (def. 50, max 100), `offset` (def. 0), `status`.

### curl

```bash
curl "https://app.intralys.app/api/public/v1/leads?limit=20&status=new" \
  -H "Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx"
```

### JavaScript (fetch)

```js
const res = await fetch(
  'https://app.intralys.app/api/public/v1/leads?limit=20&status=new',
  { headers: { Authorization: 'ApiKey ILYS_xxxxxxxxxxxxxxxx' } }
);
const { data } = await res.json();
console.log(data);
```

### Python (requests)

```python
import requests

r = requests.get(
    "https://app.intralys.app/api/public/v1/leads",
    headers={"Authorization": "ApiKey ILYS_xxxxxxxxxxxxxxxx"},
    params={"limit": 20, "status": "new"},
)
print(r.json()["data"])
```

---

## 2. Créer un lead — `POST /leads`

Scope `write`. Champ requis : `first_name`.

### curl

```bash
curl -X POST https://app.intralys.app/api/public/v1/leads \
  -H "Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Sophie",
    "last_name": "Tremblay",
    "email": "sophie@example.com",
    "phone": "+15145551234",
    "source": "api"
  }'
```

### JavaScript (fetch)

```js
const res = await fetch('https://app.intralys.app/api/public/v1/leads', {
  method: 'POST',
  headers: {
    Authorization: 'ApiKey ILYS_xxxxxxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    first_name: 'Sophie',
    last_name: 'Tremblay',
    email: 'sophie@example.com',
    source: 'api',
  }),
});
const { data } = await res.json(); // { id: "lead_..." }
```

### Python (requests)

```python
import requests

r = requests.post(
    "https://app.intralys.app/api/public/v1/leads",
    headers={"Authorization": "ApiKey ILYS_xxxxxxxxxxxxxxxx"},
    json={
        "first_name": "Sophie",
        "last_name": "Tremblay",
        "email": "sophie@example.com",
        "source": "api",
    },
)
print(r.status_code, r.json())
```

Réponse `201` :

```json
{ "data": { "id": "lead_abc123" } }
```

---

## 3. Mettre à jour un lead — `PATCH /leads/{id}`

Scope `write`. Champs partiels acceptés.

### curl

```bash
curl -X PATCH https://app.intralys.app/api/public/v1/leads/lead_abc123 \
  -H "Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{ "status": "active", "value": 4500 }'
```

### JavaScript (fetch)

```js
await fetch('https://app.intralys.app/api/public/v1/leads/lead_abc123', {
  method: 'PATCH',
  headers: {
    Authorization: 'ApiKey ILYS_xxxxxxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ status: 'active', value: 4500 }),
});
```

### Python (requests)

```python
import requests

requests.patch(
    "https://app.intralys.app/api/public/v1/leads/lead_abc123",
    headers={"Authorization": "ApiKey ILYS_xxxxxxxxxxxxxxxx"},
    json={"status": "active", "value": 4500},
)
```

---

## 4. Envoyer un message à un lead — `POST /leads/{id}/messages`

Scope `write`. Requis : `channel`, `body`. Les désabonnements CASL / préférences Loi 25 sont appliqués automatiquement.

### curl

```bash
curl -X POST https://app.intralys.app/api/public/v1/leads/lead_abc123/messages \
  -H "Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{ "channel": "email", "subject": "Suivi", "body": "Bonjour Sophie, ..." }'
```

### JavaScript (fetch)

```js
await fetch(
  'https://app.intralys.app/api/public/v1/leads/lead_abc123/messages',
  {
    method: 'POST',
    headers: {
      Authorization: 'ApiKey ILYS_xxxxxxxxxxxxxxxx',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: 'sms', body: 'Bonjour, on peut se parler ?' }),
  }
);
```

### Python (requests)

```python
import requests

requests.post(
    "https://app.intralys.app/api/public/v1/leads/lead_abc123/messages",
    headers={"Authorization": "ApiKey ILYS_xxxxxxxxxxxxxxxx"},
    json={"channel": "email", "subject": "Suivi", "body": "Bonjour Sophie, ..."},
)
```

---

## 5. Créer un webhook — `POST /webhooks`

Requis : `url`, `events`.

### curl

```bash
curl -X POST https://app.intralys.app/api/public/v1/webhooks \
  -H "Authorization: ApiKey ILYS_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://hooks.exemple.com/intralys", "events": ["lead.created","lead.updated"] }'
```

### JavaScript (fetch)

```js
await fetch('https://app.intralys.app/api/public/v1/webhooks', {
  method: 'POST',
  headers: {
    Authorization: 'ApiKey ILYS_xxxxxxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://hooks.exemple.com/intralys',
    events: ['lead.created', 'lead.updated'],
  }),
});
```

### Python (requests)

```python
import requests

requests.post(
    "https://app.intralys.app/api/public/v1/webhooks",
    headers={"Authorization": "ApiKey ILYS_xxxxxxxxxxxxxxxx"},
    json={
        "url": "https://hooks.exemple.com/intralys",
        "events": ["lead.created", "lead.updated"],
    },
)
```

Supprimer : `DELETE /webhooks/{id}` avec la même authentification.

---

## Codes de réponse

| Code | Sens |
|------|------|
| 200 | Succès |
| 201 | Ressource créée |
| 401 | Clé absente, invalide ou révoquée |
| 403 | Scope insuffisant |
| 404 | Ressource introuvable |
| 429 | Limite de débit dépassée |

## Prochaines étapes

- [Authentification →](/help/authentication)
- [Limites de débit →](/help/rate-limits)
