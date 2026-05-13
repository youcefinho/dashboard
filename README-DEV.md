# README-DEV — Guide développement local Intralys Dashboard

> Clone GHL pour courtiers immobiliers QC.
> Stack : React + TypeScript + Cloudflare Workers (D1 + R2 + Durable Objects)

---

## Prérequis

- [Bun](https://bun.sh) (runtime + package manager)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`bun add -g wrangler`)

---

## Installation rapide

```bash
# 1. Cloner le repo
git clone https://github.com/youcefinho/dashboard.git intralys-dashboard
cd intralys-dashboard

# 2. Installer les dépendances
bun install

# 3. Initialiser la base de données locale (schema + seed + migrations)
bun run db:setup

# 4. Lancer l'app
bun run dev          # Frontend Vite → http://localhost:5173
bun run dev:worker   # Worker Wrangler → http://localhost:8787
```

---

## Compte admin de test

| Email | Mot de passe | Rôle |
|-------|-------------|------|
| `admin@intralys.com` | `Intralys2026!` | admin |
| `mathis@example.com` | `managed` | broker (Gatineau) |

> Le mot de passe `managed` est un placeholder. L'admin doit bootstrapper son mot de passe via la route `/api/auth/bootstrap`.

### Bypass auth en dev local (optionnel)

Pour skip le login pendant le développement :
- `.dev.vars` (backend) : `DEV_BYPASS_AUTH=true` → `requireAuth` retourne admin sans vérifier le token
- `.env.local` (frontend) : `VITE_DEV_BYPASS_AUTH=true` → `login()` retourne un fake token

⚠️ **Sécurité** : les deux variables sont gitignored et ne doivent JAMAIS être définies en prod
(Cloudflare Pages → si non définies, le vrai flow auth est appliqué — c'est le comportement par défaut).

---

## Mode Mock (USE_MOCKS=true)

Par défaut en local, **toutes les APIs externes sont mockées** :

| Service | Vrai | Mock |
|---------|------|------|
| Resend (emails) | Envoie un vrai email | Log console + message `status='mock-sent'` visible dans Inbox |
| Twilio (SMS) | Envoie un vrai SMS | Log console + message `status='mock-sent'` visible dans Inbox |
| Anthropic (Claude AI) | Appelle Claude API | Réponses prédéfinies (score=65, templates FR canned) |
| Google Calendar | Sync bidirectionnelle | Fixtures 8 events statiques |
| Google Business Profile | Fetch reviews GBP | Fixtures 5 reviews fictives |

**Aucune clé API externe n'est nécessaire pour développer en local.**

Pour utiliser les vraies APIs, configurez les secrets dans `.dev.vars` :
```
USE_MOCKS=false
RESEND_API_KEY=re_xxxx
ANTHROPIC_API_KEY=sk-ant-xxxx
```

---

## Scripts disponibles

| Script | Commande | Description |
|--------|----------|-------------|
| `dev` | `bun run dev` | Frontend Vite (localhost:5173) |
| `dev:worker` | `bun run dev:worker` | Worker Wrangler local (localhost:8787) |
| `build` | `bun run build` | Build production (tsc + vite) |
| `test` | `bun run test` | Lance les tests Vitest |
| `db:setup` | `bun run db:setup` | Init DB complète : schema + seed + toutes migrations |
| `db:migrate` | `bun run db:migrate` | Applique uniquement les migrations non encore jouées (idempotent, local) |
| `db:migrate:prod` | `bun run db:migrate:prod` | Applique les migrations sur D1 prod (CI / déploiement) |
| `db:backup` | `bun run db:backup` | Export D1 local en SQL (cf. `docs/BACKUP-RESTORE.md`) |
| `db:backup:prod` | `bun run db:backup:prod` | Export D1 prod en SQL |

---

## Structure du projet

```
src/
├── worker.ts              ← Router central (~400 lignes, dispatch vers modules)
├── worker/
│   ├── types.ts            ← Interface Env + constantes
│   ├── helpers.ts          ← sanitizeInput, json, audit, requireAuth
│   ├── auth.ts             ← Login PBKDF2, sessions, bootstrap
│   ├── crypto.ts           ← Hash/verify helpers
│   ├── leads.ts            ← CRUD leads + bulk + filtres avancés
│   ├── conversations.ts    ← Conversations first-class (Sprint 3)
│   ├── messages.ts         ← Email/SMS/Note inbound+outbound
│   ├── workflows.ts        ← Engine cron + enrollment + steps
│   ├── compliance.ts       ← CASL, Loi 25, AMF, unsubscribe tokens
│   ├── webchat.ts          ← Durable Object WebSocket temps réel
│   ├── documents.ts        ← Upload R2 + e-signature
│   ├── scoring.ts          ← Multi-score profiles
│   ├── ai.ts               ← Claude AI scoring/generate/suggest
│   ├── broadcast.ts        ← Email broadcast en masse
│   ├── pipelines.ts        ← Multi-pipelines + stages
│   ├── templates.ts        ← Templates email/SMS
│   ├── tasks.ts            ← Tâches CRUD
│   ├── appointments.ts     ← RDV CRUD
│   ├── bookings.ts         ← Pages de booking publiques
│   ├── reviews.ts          ← Avis clients
│   ├── notifications.ts    ← Centre de notifications
│   ├── custom-fields.ts    ← Custom fields builder
│   ├── dashboard.ts        ← Stats KPI
│   ├── forms.ts            ← Form builder backend
│   ├── reports.ts          ← Rapports analytiques
│   ├── sub-accounts.ts     ← Multi-clients + snapshots
│   ├── lead-notes.ts       ← Notes sur leads
│   └── mocks/              ← Mocks pour dev local (Phase C.2)
│       ├── mock-resend.ts
│       ├── mock-twilio.ts
│       ├── mock-anthropic.ts
│       ├── mock-gcal.ts
│       └── mock-gbp.ts
├── lib/
│   ├── types.ts            ← Types partagés frontend
│   ├── api.ts              ← Client API (apiFetch + 60+ fonctions)
│   ├── auth.ts             ← AuthProvider + useAuth hook
│   └── schemas.ts          ← Zod schemas validation
├── pages/                  ← 20 pages (lazy-loaded)
├── components/
│   ├── ui/                 ← Design system (Badge, Button, Avatar, etc.)
│   ├── layout/             ← AppLayout, Sidebar, Header
│   └── conversations/      ← ConversationPanel (LeadDetail)
└── index.css               ← Tokens CSS Intralys
```

---

## 20 routes API testables

### Auth
```bash
# Bootstrap admin (première fois)
curl -X POST http://localhost:8787/api/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@intralys.com","password":"Intralys2026!","name":"Admin"}'

# Login → récupérer le token
curl -X POST http://localhost:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@intralys.com","password":"Intralys2026!"}'
# → { "data": { "token": "abc123..." } }
```

### Leads (avec Bearer token)
```bash
TOKEN="abc123..."

# Lister les leads
curl http://localhost:8787/api/leads -H "Authorization: Bearer $TOKEN"

# Créer un lead via webhook (pas de token nécessaire)
curl -X POST http://localhost:8787/api/webhook/lead \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Lead","email":"test@test.com","phone":"514-555-0000","type":"buy","client_id":"gatineau"}'

# Détail d'un lead
curl http://localhost:8787/api/leads/lead-001 -H "Authorization: Bearer $TOKEN"

# Mettre à jour
curl -X PATCH http://localhost:8787/api/leads/lead-001 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"contacted"}'
```

### Conversations
```bash
# Lister les conversations
curl http://localhost:8787/api/conversations -H "Authorization: Bearer $TOKEN"

# Créer une conversation
curl -X POST http://localhost:8787/api/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lead_id":"lead-001","channel":"email","subject":"Premier contact"}'

# Envoyer un message
curl -X POST http://localhost:8787/api/conversations/{id}/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"Bonjour Sophie, merci pour votre intérêt!"}'
```

### Autres routes
```bash
# Dashboard stats
curl http://localhost:8787/api/dashboard -H "Authorization: Bearer $TOKEN"

# Clients
curl http://localhost:8787/api/clients -H "Authorization: Bearer $TOKEN"

# Workflows
curl http://localhost:8787/api/workflows -H "Authorization: Bearer $TOKEN"

# Templates
curl http://localhost:8787/api/templates -H "Authorization: Bearer $TOKEN"

# Tasks
curl http://localhost:8787/api/tasks -H "Authorization: Bearer $TOKEN"

# Appointments
curl http://localhost:8787/api/appointments -H "Authorization: Bearer $TOKEN"

# Notifications
curl http://localhost:8787/api/notifications -H "Authorization: Bearer $TOKEN"

# Pipeline stages
curl http://localhost:8787/api/pipelines -H "Authorization: Bearer $TOKEN"

# Reports
curl http://localhost:8787/api/reports/overview -H "Authorization: Bearer $TOKEN"

# Activity log
curl http://localhost:8787/api/activity -H "Authorization: Bearer $TOKEN"
```

### API Publique & Zapier
L'API Publique Intralys (préfixe `/api/public/v1`) permet l'intégration avec **Zapier** et d'autres systèmes tiers.
Elle nécessite une authentification par clé API (`ApiKey ILYS_...` ou `Bearer ILYS_...`).
Voir la [Documentation de l'API Publique](docs/API-PUBLIC.md) et la [Documentation Zapier](docs/ZAPIER-INTEGRATION.md).

---

## Migrations SQL

Les migrations doivent être appliquées **dans l'ordre** :

| Migration | Contenu |
|-----------|---------|
| `schema.sql` | Tables de base (users, clients, leads, sessions, login_attempts) |
| `seed.sql` | Données démo (3 clients, 14 leads, 1 admin) |
| `migration-phase1.sql` → `migration-phase13.sql` | Extensions progressives (messages, workflows, templates, etc.) |
| `migration-sprint2-phase0.sql` + `migration-sprint2-phase1.sql` | Sprint 2 (booking, compliance) |
| `migration-sprint3.sql` | Sprint 3 (conversations first-class) |

Le script `bun run db:setup` les applique automatiquement.

---

## Features V2 (backlog — pas dans le scope actuel)

Les modules suivants sont dans `src/worker/_v2-backlog/` :
- `migrate.ts` — Migration depuis GHL réel via PIT token
- `gbp.ts` — Google Business Profile (nécessite OAuth2 user-scoped)
- `gcal.ts` — Google Calendar sync (nécessite OAuth2 complet)

Ces modules seront réactivés quand le clone sera mature et qu'on sera prêt pour la migration des premiers vrais clients.
