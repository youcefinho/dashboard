# RUNBOOK-OPS — Exploitation Intralys (déploiement / incident / beta / observabilité)

> **LOT E — Release candidate, Manager 3 (doc only).** Runbook d'exploitation
> opérationnel. **Source de vérité go-live = `docs/GOLIVE-S10.md` (5 gates) +
> `LAUNCH-CHECKLIST.md`.** Ce document ne remplace ni ne contredit ces deux-là :
> il décrit *comment opérer* une fois les gates franchis par Rochdi.
>
> ⚠️ **VM VMware : aucune commande git/bun/node/wrangler n'a été exécutée pour
> produire ce runbook.** Toute commande ci-dessous est **écrite, NON exécutée —
> à exécuter par Rochdi sur la machine hôte.** Rien n'est « vert ». Le verdict
> go-live reste **NON** (cf `LAUNCH-CHECKLIST.md` § Verdict final).

---

## 0. Pré-requis avant toute opération de prod

Avant de toucher la prod, les conditions suivantes DOIVENT être réunies
(détail : `docs/GOLIVE-S10.md` §1, non dupliqué ici) :

- Les **5 gates Rochdi** franchis dans l'ordre, sur la machine hôte.
- **Build combiné LOT A→E re-vérifié** (`bun run build` 0 erreur TS) — jamais
  exécuté sur la VM, jamais re-vérifié avec les acquis A-D-E empilés.
- Revue **PCI (SAQ-A) + légale E4/E6** signée — `payments_live_enabled = 0`
  reste **non levé** tant que non signé (`docs/PCI-RGPD-GOLIVE-checklist.md`).
- Bindings/secrets configurés — inventaire : **`docs/BINDINGS-SECRETS-S10.md`**.

---

## 1. Déploiement (Cloudflare Workers + D1)

> Ordre **impératif** : build → 5 gates `GOLIVE-S10.md` → `wrangler deploy`.
> Un gate échoué = STOP, on ne déploie pas.

### 1.1 — Séquence de déploiement

1. **Build** : `bun run build` (= `tsc && vite build`, `package.json:20`) →
   **0 erreur TS**. Premier build réel avec les acquis LOT A-E empilés
   (sandbox VMware = jamais buildé). À traiter AVANT tout le reste.
2. **Gate 1 — Build & tests** : `bun run build` + `bun run test`
   (`vitest run`, ~53 suites). Référence : `GOLIVE-S10.md` Gate 1.
3. **Gate 2 — Backup D1 prod** : `bun run db:backup:prod`
   (= `bash scripts/backup.sh --remote`). Backup vérifié récupérable,
   conservé **hors VM**. AVANT toute migration.
4. **Gate 3 — Dry-run migrations** :
   `bun run scripts/migrate.ts --remote --dry-run` → ordre seq **1 → 77**
   (`docs/migrations-manifest.json`), **garde E9 non déclenchée** (aucun
   `⛔ STOP` ; sinon suivre `docs/AUDIT-workflow-enrollments-E9.md`).
5. **Gate 4 — Migration prod + anti-régression** : `bun run db:migrate:prod`
   puis vérifier le **conflit gclid C1** (`PRAGMA table_info(leads)` → 7
   colonnes `gclid/utm_term/utm_content/fbclid/referrer/consent_status/
   lead_source_id`), index seq 77, cohérence `_migrations`. Détail + procédure
   de remédiation C1 : `GOLIVE-S10.md` Gate 4 (NON dupliqué).
6. **Gate 5 — Non-régression multi-tenant** : suites
   `ecommerce-multitenant.*` vertes + `GET /api/health` 200 + smoke isolation
   cross-`client_id`.
7. **Déploiement** : `npx wrangler deploy` (UNIQUEMENT après Gates 1-5 verts +
   bindings configurés + revue E4/E6 signée).
8. **Purge cache Cloudflare** post-deploy (éviter bundle / service worker
   stale — cf `LAUNCH-CHECKLIST.md` §9).
9. **Smoke E2E post-deploy** : login sur le domaine prod, onboarding
   (`WelcomeWizard`) au 1er login, pages publiques (`/`, `/pricing`, `/help`)
   sans auth.

### 1.2 — LOT B/C/D : aucune migration additive

Décision figée par les Phases A des lots concernés (`LOT-B.md` §6.2,
`SPRINT-D.md` §État Phase A) : **LOT B et LOT D = 0-migration** (recherche
globale via `LIKE` sur index S9 seq 77 ; web-vitals / data-reconcile via
tables et index S9 existants). Les seq 1-77 restent la seule liste à jouer
(Gate 3/4). Aucune seq 78+ introduite par les lots A-E.

---

## 2. Procédure incident / rollback

### 2.1 — Détection

Signaux d'incident à surveiller :

- `GET /api/health` ≠ HTTP 200, ou body `db` ≠ `'ok'`.
- `migrations_count` (`/api/health`, champ readiness additif S10) incohérent
  avec le nombre attendu de migrations appliquées (seq ≤ 77).
- Erreurs en masse dans `npx wrangler tail` (5xx, exceptions worker).
- Fuite cross-tenant suspectée (un `client_id` voit des données d'un autre) =
  **incident grave Loi 25 / RGPD** — escalade immédiate.

### 2.2 — Rollback code (worker)

Le code worker est sans état. Rollback = redéployer la version précédente :

1. Identifier le dernier déploiement sain.
2. Revenir au commit/tag connu bon, `bun run build`, `npx wrangler deploy`.
3. **Purge cache Cloudflare** (sinon bundle/service worker stale servi —
   cf `sw_cache_trap`).
4. Re-vérifier `GET /api/health` 200 + smoke login.

> Cloudflare conserve un historique de déploiements (`wrangler deployments
> list`) — un rollback de version peut aussi se faire via le dashboard
> Cloudflare. Documenté, NON exécuté (VM).

### 2.3 — Rollback données (D1)

Une migration **D1 n'est pas réversible automatiquement**. La seule voie de
retour est le **backup pris au Gate 2** (`bun run db:backup:prod`, conservé
hors VM) :

1. STOP toute écriture (mettre la plateforme en maintenance si possible).
2. Restaurer le backup D1 (artefact Gate 2).
3. Re-jouer le dry-run (Gate 3) avant toute nouvelle tentative de migration.

**Cas spécifique conflit gclid C1** : si `PRAGMA table_info(leads)` ne montre
pas les 6 colonnes post-`migration-sprint51-m2.sql`, NE PAS restaurer le
backup en réflexe — découper manuellement `migration-sprint51-m2.sql` et
rejouer ses 6 ALTER restants isolément (procédure : `GOLIVE-S10.md` Gate 4,
`migrate.ts:14-19`). Le backup reste le filet ultime si la remédiation manuelle
échoue.

### 2.4 — Garde-fous incident

- 🚫 Ne JAMAIS lever `payments_live_enabled` pendant un incident pour
  « débloquer » un paiement — flag régulé, revue PCI/légale E4/E6 préalable
  obligatoire.
- 🚫 Ne JAMAIS éditer une migration historique (seq 1-77 figées) pour
  contourner un échec — découper/rejouer isolément, jamais réécrire l'historique.
- En cas de doute sur l'isolation tenant : couper l'accès avant d'investiguer
  (la confidentialité prime sur la disponibilité — Loi 25).

---

## 3. Invitation beta — procédure MANUELLE

> ⚠️ **`sendMagicEmail` est un STUB log-only.** `src/worker/beta.ts:172-179` :
> la fonction n'envoie **aucun courriel** — elle fait un
> `console.log(\`[MAGIC LINK] ${email} -> ${link}\`)`. Le commentaire du code
> le dit explicitement : *« Pour l'instant on log le lien (visible dans
> wrangler tail) — suffisant pour la beta privée où l'invitation est faite à
> la main. »* L'intégration Resend/SendGrid est un `TODO(prod)` non fait.
> **Conséquence : aucune invitation beta n'est automatique. Procédure 100 %
> manuelle ci-dessous.**

### 3.1 — Mettre un courriel en statut `invited`

Le magic link n'est émis QUE si l'email est dans `beta_signups` avec
`status = 'invited'` (`beta.ts:189-192` ; réponse anti-énumération identique
sinon). Le candidat arrive en `status='pending'` via `POST /api/beta/signup`
(consentement Loi 25/CASL `consent=1` obligatoire, `beta.ts:139-142`).

Passer un signup de `pending` à `invited` (à exécuter par Rochdi, machine
hôte — écrit, NON exécuté VM) :

```
npx wrangler d1 execute intralys-crm --remote --command "UPDATE beta_signups SET status='invited', invited_at=unixepoch() WHERE email='<email>';"
```

### 3.2 — Déclencher et récupérer le lien magique

1. Le client (ou Rochdi pour lui) appelle
   `POST /api/auth/magic-link` avec `{ "email": "<email>" }`.
2. Le worker insère un `magic_tokens` (TTL **15 min**, `MAGIC_TTL_MS`,
   single-use) et **logue le lien** au lieu de l'envoyer.
3. Récupérer le lien dans les logs worker :

```
npx wrangler tail
```

   Chercher la ligne `[MAGIC LINK] <email> -> https://<domaine-prod>/auth/verify?token=...`.

4. Transmettre **manuellement** ce lien au client (courriel perso, message).
   Le client ouvre le lien → `GET /api/auth/magic-verify` crée une session
   Bearer (72 h, même format que le login password) et redirige vers
   `/dashboard?welcome=1` (déclenche l'onboarding WelcomeWizard).

> Le lien expire en 15 min et est **à usage unique** (`used_at`) : le
> récupérer dans `wrangler tail` et le transmettre rapidement. Si expiré,
> re-déclencher l'étape 1 (nouveau token).

### 3.3 — Quand brancher l'envoi automatique

Dès qu'un fournisseur d'email est configuré (`RESEND_API_KEY` ou
`SENDGRID_API_KEY`, `wrangler secret put <NAME>`), le `TODO(prod)` de
`sendMagicEmail` (`beta.ts:173-178`) devra être implémenté pour automatiser
l'envoi. Tant que ce n'est pas fait, **la procédure manuelle ci-dessus reste
la seule voie** (tracé en dette, `LAUNCH-CHECKLIST.md` § Dette technique).

### 3.4 — Communication beta (référence)

Codes/liens d'invitation, email d'annonce, suivi white-glove 48 h :
cf `LAUNCH-CHECKLIST.md` §10 (NON dupliqué ici).

---

## 4. Observabilité

| Sonde | Endpoint / source | Usage |
|---|---|---|
| Santé worker + DB | `GET /api/health` | HTTP 200 + `{ status:'ok', db:'ok', version:'2.1.0', uptime_s, migrations_count }`. `migrations_count` = readiness additif best-effort (S10, omis/`null` si COUNT échoue — ne fait JAMAIS basculer en 503, `health.ts`). |
| Web Vitals (perf réelle) | `GET /api/admin/web-vitals?period=24h\|7d\|30d` | **LOT D**, admin-only. Agrège `web_vitals` (S9) : `count`, `avg`, `p75` par `metric_name` (LCP/CLS/INP/…). Robuste : table absente → `{ data:{ metrics:[], period, since } }` 200, jamais 500/503. |
| Intégrité données | `GET /api/admin/data-reconcile` | **LOT D**, admin-only, **READ-ONLY** (zéro mutation). Rapport `COUNT(*)` FK orphelines : `{ data:{ orphans:[...] } }`. Table absente → liste vide, jamais 500. |
| Piste d'audit | table `audit_log` | Tracé des actions sensibles via `audit()` (helper figé). Consultable D1 pour investigation incident / conformité Loi 25. |
| Logs live | `npx wrangler tail` | Erreurs runtime, exceptions worker, **et lien magic link beta** (cf §3.2). |

> Endpoints LOT D : garde admin LOCALE (défense en profondeur — la 403 est
> aussi rendue en amont par le dispatch `worker.ts`). Spécifications figées :
> `docs/SPRINT-D.md` §6.3 / §6.5 (NON dupliquées ici).

---

## 5. Bindings critiques

> **Inventaire complet & format figé : `docs/BINDINGS-SECRETS-S10.md`**
> (source de vérité, NON dupliqué ici). Rappel des points critiques ops :

- **`TOKEN_KEY`** (S7, `types.ts:30`) — **critique** : sans ce secret, les
  tokens d'intégration sont stockés **EN CLAIR** en base. À configurer via
  `wrangler secret put TOKEN_KEY` AVANT toute connexion d'intégration en prod.
- **`DEV_BYPASS_AUTH`** (`types.ts:32`) — **INTERDIT en prod** : bypass de
  login. Vérifier son **absence totale** de la config production.
- Obligatoires : `DB`, `FILES` (R2), `WEBCHAT_ROOMS` (DO), `BROADCAST_QUEUE`,
  `ADMIN_PASSWORD`, `WEBHOOK_SECRET`, `NOTIFICATION_EMAIL`, `ALLOWED_ORIGINS`.
- Conditionnels selon features : `ANTHROPIC_API_KEY` (sinon
  `USE_MOCKS="true"` — actuellement `true`, `wrangler.jsonc:39`, décision
  Rochdi), `RESEND_API_KEY` (requis pour automatiser l'envoi magic link —
  cf §3.3), `TWILIO_*`, `STATE_STORE` (KV CSRF OAuth), `RATE_LIMITER` (KV),
  `META_APP_*`, `GHL_*`.
- Régulé NON configuré : `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` —
  **ne PAS configurer** tant que `payments_live_enabled=0` non levé (revue
  PCI/légale E4/E6).
- 🚫 **JAMAIS de valeur de secret** dans un fichier/repo/log — uniquement
  `wrangler secret put <NAME>` (saisie interactive).

---

## 6. Verdict opérationnel

Ce runbook est **doc only**. Aucune commande n'a été exécutée (VM VMware).
Le go-live reste **conditionné** au build combiné A-E re-vérifié + les
5 gates Rochdi + la revue régulée E4/E6 — **verdict actuel : NON**
(cf `LAUNCH-CHECKLIST.md` § Verdict final, source unique du verdict).
