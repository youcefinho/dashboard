# GO-LIVE LOT 3 — playbook complet (Sprints 21-30)

> **Playbook go-live LOT 3.** Référence opérationnelle pour Rochdi.
> Migrations couvertes : **seq119 → seq125** (7 migrations, 100 % additives).
>
> ⚠️ **Aucune commande ci-dessous n'a été exécutée par l'agent.** Tout est
> écrit, NON exécuté — à exécuter par Rochdi sur la machine hôte. Aucune
> case verte tant que Rochdi n'a pas vérifié.
>
> Compagnons : `docs/GOLIVE-S10.md` (5 gates LOT 1-2 figés),
> `docs/PCI-RGPD-GOLIVE-checklist.md` (régulé E4/E6),
> `docs/LOT-RC-BETA.md` (contrat §6 figé Sprint 30),
> `docs/TECH-DEBT-RC.md` (dette P0-P3).

---

## §1 — Pré-requis env vars & secrets

### 1.1 Bindings obligatoires (échec dur si absents)

- `DB` (D1 — `intralys-crm`)
- `FILES` (R2 — uploads)
- `WEBCHAT_ROOMS` (Durable Object)
- `BROADCAST_QUEUE` (Queue)
- `ADMIN_PASSWORD` (secret)
- `WEBHOOK_SECRET` (secret)
- `NOTIFICATION_EMAIL`
- `ALLOWED_ORIGINS`

### 1.2 Secrets conditionnels (par feature)

| Secret | Quand obligatoire | Sinon |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI activé | `USE_MOCKS='true'` (défaut `wrangler.jsonc:39`) |
| `RESEND_API_KEY` | Email transactionnel | `sendMagicEmail` stub log-only (P0-01) |
| `TWILIO_*` | SMS | `messages.ts` retourne `{success:false}` no-op |
| `WHATSAPP_*` | WhatsApp Business | no-op silencieux |
| `TOKEN_KEY` | OAuth tokens chiffrés | tokens en clair (limite) |
| `STATE_STORE` (KV) | OAuth CSRF | `state` non vérifié |
| `RATE_LIMITER` (KV) | Rate-limit cluster | fallback D1 |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` SaaS | Sprint 22 mock flag levé | NON branché |
| `META_APP_*` / `GHL_*` | Connexions OAuth | provider absent |
| `FCM_SERVER_KEY` | Push notifications | `console.error` + skip |

### 1.3 Variables critiques en prod

- [ ] **`DEV_BYPASS_AUTH` ABSENT en prod** (JAMAIS configurer en production).
      Le code conserve néanmoins 12 occurrences (P0-03, cleanup post-RC).
- [ ] **`USE_MOCKS='false'`** en prod (Rochdi décide ; actuellement `'true'`).
- [ ] `ALLOWED_ORIGINS` = domaines prod uniquement (pas de wildcard).

---

## §2 — Ordre migrations seq119 → seq125

### 2.1 Backup AVANT migration (Gate 2 existant)

```bash
bun run db:backup:prod
# = bash scripts/backup.sh --remote
# Vérifier backup récupérable, conservé hors VM.
```

### 2.2 Dry-run ordre

```bash
bun run scripts/migrate.ts --remote --dry-run
```

Ordre canonique attendu :

| seq | Fichier | Objet principal | Risque |
|---|---|---|---|
| 119 | `migration-onboarding-harden-seq119.sql` | `onboarding_events` + colonnes checklist serveur | low |
| 120 | `migration-billing-stripe-mock-seq120.sql` | `billing_plans` + 4 tiers seed + flag E4 mock | low |
| 121 | `migration-security-compliance-seq121.sql` | `rate_limit_buckets` + `cookie_consent_log` + Loi 25 | low |
| 122 | `migration-observability-seq122.sql` | `request_metrics` + `alert_rules` + `alert_events` | low |
| 123 | `migration-perf-indexes-seq123.sql` | 3 indexes composites perf | low |
| 124 | `migration-mobile-harden-seq124.sql` | `device_tokens` 4 colonnes additives | low |
| 125 | `migration-release-gates-seq125.sql` | `release_gates_runs` + `beta_invite_codes` (seed 5) | low |

### 2.3 Exécution

```bash
bun run db:migrate:prod
# = bun run scripts/migrate.ts --remote
```

### 2.4 Vérifications post-migration

```bash
# 1) _migrations cohérent (seq ≤ 125)
npx wrangler d1 execute intralys-crm --remote --command \
  "SELECT MAX(seq) AS last_seq, COUNT(*) AS total FROM _migrations;"

# 2) Tables Sprint 21-30 présentes
npx wrangler d1 execute intralys-crm --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN \
   ('onboarding_events','billing_plans','rate_limit_buckets','request_metrics', \
    'alert_rules','release_gates_runs','beta_invite_codes');"

# 3) Indexes Sprint 25 + 30 présents
npx wrangler d1 execute intralys-crm --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' AND \
   (name LIKE 'idx_audit_log_%' OR name LIKE 'idx_request_metrics_%' \
    OR name LIKE 'idx_web_vitals_%' OR name='idx_release_gates_created');"

# 4) Seed beta codes (5 attendus)
npx wrangler d1 execute intralys-crm --remote --command \
  "SELECT COUNT(*) FROM beta_invite_codes;"

# 5) device_tokens enrichi seq124 (4 colonnes additives)
npx wrangler d1 execute intralys-crm --remote --command \
  "PRAGMA table_info(device_tokens);"
# Attendu : columns `last_seen_at`, `app_version`, `enabled`, `device_label`.
```

---

## §3 — Smoke tests post-deploy (10 tests LOT 3)

### 3.1 Sprint 21 — Onboarding durci

```bash
curl -s https://<prod>/api/onboarding/state -H "Cookie: session=..." | jq
# Attendu : data.checklist_server (booléens calculés serveur), pas client.
```

### 3.2 Sprint 22 — Billing mock

```bash
curl -s https://<prod>/api/billing/plans -H "Cookie: session=..." | jq '.data | length'
# Attendu : 4 (free, starter, pro, unlimited).
```

### 3.3 Sprint 23 — Cookie banner UI

- [ ] Charger `https://<prod>/` en navigation privée → bannière apparaît
- [ ] Cliquer **Accepter tout** → localStorage `cookie_consent` rempli
- [ ] `/api/admin/audit-log` (admin) → ligne consent log présente

### 3.4 Sprint 24 — X-Request-Id header

```bash
curl -sI https://<prod>/api/health | grep -i "x-request-id"
# Attendu : X-Request-Id: <uuid>
```

### 3.5 Sprint 24 — Observability admin

```bash
curl -s https://<prod>/api/admin/observability/health -H "Cookie: session=..." | jq
# Attendu : 200 + payload status/checks.
```

### 3.6 Sprint 25 — PerfBudgetCard WEB_VITALS

- [ ] Admin → Dashboard observabilité → card "Budget perf" rend
      LCP/INP/CLS p75 avec seuils.

### 3.7 Sprint 27 — PWA install + push

- [ ] iOS Safari : Ajouter à l'écran d'accueil → ouvre standalone.
- [ ] Android Chrome : prompt PWA → install OK.
- [ ] `/api/push/register` → 201 (token stocké `device_tokens`).

### 3.8 Sprint 28 — i18n parité

```bash
bun run scripts/check-i18n-parity 2>&1 || echo "(script absent, skip — manuel)"
# Attendu : parité stricte ×4 catalogues.
```

### 3.9 Sprint 29 — Lighthouse a11y

- [ ] Lighthouse audit `/`, `/dashboard`, `/leads` → score a11y **≥ 95**.
- [ ] axe-core 0 violation critique/serious.

### 3.10 Sprint 30 — Release gates check

```bash
curl -s https://<prod>/api/admin/release-gates -H "Cookie: session=..." | jq '.data.all_green'
# Attendu : true (tous gates verts).
```

---

## §4 — Activation flags ordonnée

> ⚠️ Aucun flag n'est levé automatiquement. Toute activation = décision
> explicite Rochdi APRÈS vérif des prérequis listés.

| Flag | Prérequis | Activation |
|---|---|---|
| `payments_live_enabled` (E4 régulé) | Revue PCI SAQ-A signée + revue légale | UI admin → flip à `1` |
| `e6_returns_dz_enabled` (régulé DZ) | Revue compliance DZ signée | UI admin |
| `whitelabel_provisioning_enabled` (G9) | Custom hostname DNS pointé | env var `'true'` |
| `whitelabel_dkim_enabled` (G9) | DKIM provisioned | env var `'true'` |
| `oauth_google_calendar` (G4) | `GOOGLE_OAUTH_CLIENT_*` bindés | automatique si credentials |
| `oauth_slack` (G4) | `SLACK_CLIENT_*` bindés | automatique si credentials |

---

## §5 — Rollback strategy

### 5.1 Rollback worker (instant)

```bash
# Récupérer le hash du déploiement précédent
npx wrangler deployments list
# Promote l'ancien déploiement
npx wrangler rollback <deployment-id>
```

### 5.2 Rollback D1 (post-migration cassée)

Migrations seq119-125 sont **100 % additives** (CREATE IF NOT EXISTS,
ALTER ADD COLUMN sans DROP). Pas de rollback SQL "automatique" — chemins :

- **Best path** : restore backup `bun run db:backup:prod` pré-migration.
- **Manuel ciblé** : `DROP TABLE` table additive isolée si bug applicatif.
- **JAMAIS** rollback SQL d'un `ALTER ADD COLUMN` sur table critique
  (perte de données).

### 5.3 Rollback flag activé

```bash
# Exemple flip payments_live_enabled → 0
npx wrangler d1 execute intralys-crm --remote --command \
  "UPDATE feature_flags SET value='0' WHERE key='payments_live_enabled';"
```

---

## §6 — Post-deploy : purge cache + tail logs

### 6.1 Purge cache Cloudflare

```bash
# Via dashboard CF → Caching → Configuration → Purge Everything
# OU via API :
curl -X POST "https://api.cloudflare.com/client/v4/zones/<zone-id>/purge_cache" \
  -H "Authorization: Bearer <api-token>" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

### 6.2 Tail logs live (Sprint 24 X-Request-Id)

```bash
npx wrangler tail --format pretty
# Filtrer par request id si bug : grep "X-Request-Id: <id>"
```

### 6.3 Checklist finale 9 étapes (validation Antigravity post-Sprint 30)

- [ ] **Build** : `bun run build` 0 erreur TS (Gate 1)
- [ ] **Tests** : `bun run test` ~500+ tests verts (Gate 1bis)
- [ ] **Backup D1** : `bun run db:backup:prod` OK (Gate 2)
- [ ] **Migrations** : `bun run db:migrate:prod` seq119→125 OK (Gate 4bis)
- [ ] **Post-migration vérifs** : §2.4 — toutes commandes OK
- [ ] **Smoke tests** : §3 — 10 tests verts
- [ ] **Lighthouse a11y** : ≥95 sur 3 pages
- [ ] **Release gates** : `/api/admin/release-gates` `all_green:true`
- [ ] **Tail logs 1h** : aucune erreur 5xx récurrente
