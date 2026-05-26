# LOT 3 — Sprint 23 : Sécurité / conformité

> Doc contrat §6 figé. Migration : seq121 — `migration-security-compliance-seq121.sql`.

## Objectif

5 axes prioritaires :

1. **Rate-limit middleware D1** — sliding window fail-open, fallback sans KV.
2. **Audit trail enrichi + viewer admin** — colonnes `request_id`, `tenant_id`, `redacted` + filtres (action / user / date / type ressource).
3. **RBAC overrides UI/API** — writer applicatif pour `user_capability_overrides` (déjà migrée seq80, 0 writer historique). Gardes `team.manage`.
4. **Loi 25 "Mes données"** — export (JSON profil + sessions + audit + consents) + delete-account soft 30j avec annulation.
5. **Cookies consent banner global** — 4 catégories (essential / preferences / analytics / marketing) + log anonyme ou identifié, policy version.

## Hors-scope (renvoyé)

- Retrait `BYPASS PROVISOIRE` auth → **Sprint 30 RC**
- CSP strict → backlog Sprint 24/29
- Validation zod retrofit massif → backlog continu
- Rotation auto secrets (`integration_secrets`) → backlog post-RC
- DPO contact interactif → simple `mailto:` (pas de modal/ticket)

## §6 Contrats figés

### 6.1 Migration SQL

```sql
-- ── Sprint 23 — Sécurité / conformité — seq121 (2026-05-22) ─────────────────
-- 100% additif : ALTER … ADD COLUMN nullable + CREATE TABLE IF NOT EXISTS.
-- AUCUN CHECK modifié, aucune capability ajoutée (ALL_CAPABILITIES seq80 figées).

-- 1) rate_limit_buckets — sliding window D1 fallback (pas de KV requis).
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  bucket_key  TEXT NOT NULL,
  hit_at      TEXT NOT NULL DEFAULT (datetime('now')),
  meta        TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_rl_buckets_key_time
  ON rate_limit_buckets(bucket_key, hit_at);

-- 2) audit_log enrichi (additif nullable).
ALTER TABLE audit_log ADD COLUMN request_id TEXT;
ALTER TABLE audit_log ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_log ADD COLUMN redacted INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- 3) cookie_consent_log — anonyme ou user_id si connecté.
CREATE TABLE IF NOT EXISTS cookie_consent_log (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  anonymous_id    TEXT,
  user_id         TEXT,
  categories      TEXT NOT NULL,
  policy_version  TEXT NOT NULL DEFAULT '1.0',
  ip              TEXT DEFAULT '',
  user_agent      TEXT DEFAULT '',
  url             TEXT DEFAULT '',
  granted_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_anon ON cookie_consent_log(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_user ON cookie_consent_log(user_id);

-- 4) account_deletion_requests — soft-delete avec délai 30j (Loi 25).
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL,
  reason          TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending',
  requested_at    TEXT DEFAULT (datetime('now')),
  scheduled_for   TEXT NOT NULL,
  executed_at     TEXT,
  ip              TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_acct_del_user ON account_deletion_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_acct_del_status ON account_deletion_requests(status, scheduled_for);

-- 5) data_export_requests — trace des exports utilisateurs.
CREATE TABLE IF NOT EXISTS data_export_requests (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL,
  ip          TEXT DEFAULT '',
  user_agent  TEXT DEFAULT '',
  bytes       INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_data_export_user ON data_export_requests(user_id, created_at);
```

### Manifest entry

```json
{ "seq": 121, "file": "migration-security-compliance-seq121.sql",
  "depends_on": ["migration-phase5.sql", "migration-billing-stripe-mock-seq120.sql"],
  "objects": ["table:rate_limit_buckets", "alter:audit_log",
              "table:cookie_consent_log", "table:account_deletion_requests",
              "table:data_export_requests", "index:audit_log", "index:rate_limit_buckets",
              "index:cookie_consent_log", "index:account_deletion_requests", "index:data_export_requests"],
  "risk": "low" }
```

### 6.2 Types (`src/lib/types.ts` append)

8 types : `CookieCategory`, `CookieConsent`, `CookieConsentRecord`, `AccountDeletionRequest`, `MyDataExport`, `AuditLogEntry`, `AuditLogQuery`, `CapabilityOverride`, `RateLimitResult`.

### 6.3 Schemas zod (`src/lib/schemas.ts` append)

5 schemas : `cookieConsentSchema`, `accountDeletionRequestSchema`, `capabilityOverrideSchema` (enum sur les 12 capabilities figées de `capabilities.ts:36-49`), `auditLogQuerySchema`, `forgotPasswordSchema` + `resetPasswordSchema`.

### 6.4 API front (`src/lib/api.ts` append)

10 fonctions :
- `getCookieConsent()`, `postCookieConsent(input)`
- `getMyDataExport()`, `getMyDeletionRequest()`, `requestAccountDeletion(reason, confirm_email)`, `cancelAccountDeletion()`
- `getAuditLog(query)`, `getCapabilityOverrides(userId)`, `setCapabilityOverride(userId, capability, granted)`, `deleteCapabilityOverride(userId, capability)`

### 6.5 Helper stubs

- `src/worker/lib/rate-limit.ts` — `checkRateLimit(env, bucketKey, max, windowSec): Promise<RateLimitResult>`. Stub fail-open Phase A, Manager-B remplit avec SELECT COUNT + INSERT D1.
- `src/worker/lib/audit-redact.ts` — `auditRedact(details): { sanitized, redacted }`. Stub passthrough Phase A. `SENSITIVE_KEYS_REGEX` figée : `password|password_hash|token|secret|.*_secret|.*_key|ciphertext|api_key|webhook_secret|stripe_secret_key|access_token|refresh_token`.

### 6.6 Handler stubs

- `src/worker/security-admin.ts` — 4 handlers admin (`handleGetAuditLog`, `handleGetCapabilityOverrides`, `handleSetCapabilityOverride`, `handleDeleteCapabilityOverride`). Gardes `settings.manage` (audit) / `team.manage` (RBAC) à appliquer Phase B.
- `src/worker/me-privacy.ts` — 4 handlers Loi 25 (`handleGetMyDataExport`, `handleGetMyDeletionRequest`, `handleRequestAccountDeletion`, `handleCancelAccountDeletion`). Rate-limits 5/h export, 3/jour delete.
- `src/worker/cookies-consent.ts` — 2 handlers (`handlePostCookieConsent` PUBLIC, `handleGetMyCookieConsent` AUTHED).

### 6.7 Routes worker (`src/worker.ts`)

- **PUBLIQUE** (avant chokepoint `requireAuth` ~ligne 1123) : `POST /api/cookies/consent`.
- **AUTHED** (après chokepoint) :
  - `GET /api/cookies/consent/me`
  - `GET /api/me/export-data`
  - `GET /api/me/delete-account`
  - `POST /api/me/delete-account`
  - `POST /api/me/delete-account/cancel`
  - `GET /api/admin/audit-log`
  - `GET|POST /api/admin/capability-overrides/:userId`
  - `DELETE /api/admin/capability-overrides/:userId/:capability`

### 6.8 Clés i18n (~75 × 4 catalogues)

Préfixes : `cookies.*` (15) · `privacy.*` (16) · `audit.viewer.*` (12) · `rbac.override.*` (10) · `security.*` (2). Parité STRICTE 4 catalogues `fr-CA` (tutoiement) / `fr-FR` (vouvoiement) / `en` / `es`.

## Codes d'erreur stables (Sprint 23)

| Code | HTTP | Contexte |
|---|---|---|
| `RATE_LIMITED` | 429 | Rate-limit dépassé (export, delete, cookies POST) |
| `CONSENT_REQUIRED` | 400 | Payload cookie consent invalide / catégorie essentielle refusée |
| `DELETION_ALREADY_REQUESTED` | 409 | Demande de suppression déjà `pending` |
| `DELETION_NOT_FOUND` | 404 | Annulation sans demande active |
| `OVERRIDE_INVALID` | 400 | Capability hors enum 12 / payload invalide |
| `INVALID_INPUT` | 400 | Confirmation email / payload générique |

## Garde-fous

- **Redaction PII** whitelist stricte (password / token / secret / `*_key` / ciphertext) — pas de hash, pas d'email/IP (déjà loggés dans colonnes dédiées).
- **Rate-limit fail-open** : si table `rate_limit_buckets` absente (migration non jouée), `checkRateLimit` retourne `allowed: true` au lieu de bloquer (calque idiome `audit()` best-effort).
- **Account deletion soft** : 30 jours (`scheduled_for = datetime('now', '+30 days')`), annulation par l'utilisateur tant que `status='pending'`.
- **ALL_CAPABILITIES figées** : aucune nouvelle capability ajoutée. Utilise `team.manage` (RBAC overrides + admin) et `settings.manage` (audit log viewer). Cf. `src/worker/capabilities.ts:36-49`.
- **`BYPASS PROVISOIRE`** auth NE PAS RETIRER (Sprint 30 release candidate).
- **Manager-B retrofit** : `audit()` helper étendu chirurgicalement (`request_id` / `tenant_id` / redaction call) — Phase A ne modifie PAS `helpers.ts`.

## Matrice fichiers Phase A / B / C

| Fichier | Phase A | Phase B | Phase C |
|---|---|---|---|
| `migration-security-compliance-seq121.sql` | CRÉER | — | — |
| `docs/migrations-manifest.json` | APPEND | — | — |
| `docs/LOT-SECURITY-COMPLIANCE.md` | CRÉER | — | — |
| `src/lib/types.ts` | APPEND 8 types | — | — |
| `src/lib/schemas.ts` | APPEND 5 schemas | — | — |
| `src/lib/api.ts` | APPEND 10 fns | — | — |
| `src/worker/lib/rate-limit.ts` | STUB | IMPL | — |
| `src/worker/lib/audit-redact.ts` | STUB | IMPL | — |
| `src/worker/security-admin.ts` | STUBS | IMPL | — |
| `src/worker/me-privacy.ts` | STUBS | IMPL | — |
| `src/worker/cookies-consent.ts` | STUBS | IMPL | — |
| `src/worker.ts` | CÂBLAGE 10 routes | — | — |
| `src/worker/helpers.ts` (`audit()`) | — | EXT redact | — |
| `src/worker/auth.ts` (forgot/reset retrofit) | — | EDIT chirurgical | — |
| 4 catalogues i18n | APPEND ~75 clés | — | — |
| `src/components/CookiesBanner.tsx` | — | — | CRÉER |
| `src/components/settings/AuditLogSettings.tsx` | — | — | CRÉER |
| `src/components/settings/RoleOverridesPanel.tsx` | — | — | CRÉER |
| `src/components/settings/DataPrivacyPanel.tsx` | — | — | CRÉER |
| `src/App.tsx`, `src/pages/Settings.tsx` | — | — | INSERTION |
