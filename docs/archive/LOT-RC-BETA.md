# LOT 3 — Sprint 30 : Release Candidate / Beta (SPRINT FINAL)

> Doc contrat §6 figé. Migration : seq125 — `migration-release-gates-seq125.sql`.
> SPRINT META qui consolide LOT 3 (Sprints 21-29) et prépare beta launch.

## Objectif
7 axes finalisation :
1. `docs/GOLIVE-LOT3.md` — playbook go-live enrichi (migrations seq119-125, env vars, smoke tests, activation flags, rollback)
2. `docs/BETA-GUIDE.md` — guide beta testers (5 codes, workflow magic link, feedback widget)
3. `docs/TECH-DEBT-RC.md` — bilan dette priorisée P0-P3 (15 items)
4. Update `LAUNCH-CHECKLIST.md` (racine, APPEND-ONLY) — sections Sprints 21-29
5. Migration seq125 — `release_gates_runs` + `beta_invite_codes` (seed 5 codes idempotent)
6. Route `GET /api/admin/release-gates` — check programmatique read-only
7. Patches polish résiduels (3) : FCM_SERVER_KEY typé Env, beta code câblage, ensureSchema enrichi

## Hors-scope (post-RC manuel Rochdi)
- **Cleanup BYPASS auth** (12 occurrences) — documenté procédure
- **Migration FCM Legacy → v1 OAuth** — backlog P0
- **Branche `sendMagicEmail` Resend** — backlog P0
- **Revue PCI/légale E4 Stripe SaaS** — révision externe avant flip flag
- Exécution migration prod D1 seq119-125 (Sprint 30 pose rails, Rochdi exécute)
- Exécution tests E2E Playwright (Sprint 26 specs, Rochdi exécute)
- App Store/Play Store submission (Sprint 27 doc, Rochdi exécute)
- Activation E6 régulé DZ
- Cron évaluation `alert_rules` (backlog)
- Cron purge web_vitals/request_metrics 90j (backlog)
- Refactor 166 `console.*` worker → logger (mini-sprint séparé)

## §6 Contrats figés

### 6.1 Migration SQL `migration-release-gates-seq125.sql`

```sql
-- ── Sprint 30 — Release Candidate / Beta — seq125 (2026-05-23) ──────────────
-- 100 % ADDITIF : CREATE TABLE IF NOT EXISTS + seed idempotent (ON CONFLICT).
-- AUCUN ALTER de table existante. AUCUNE capability ajoutée (ALL_CAPABILITIES
-- seq80 figées). AUCUN CHECK touché. Convention figée : id TEXT DEFAULT
-- (lower(hex(randomblob(16)))), timestamps TEXT DEFAULT (datetime('now')).
-- depends_on : seq124 (migration-mobile-harden-seq124.sql).

CREATE TABLE IF NOT EXISTS release_gates_runs (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  ran_by      TEXT,
  all_green   INTEGER NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_release_gates_created
  ON release_gates_runs(created_at);

CREATE TABLE IF NOT EXISTS beta_invite_codes (
  code         TEXT PRIMARY KEY,
  max_uses     INTEGER NOT NULL DEFAULT 1,
  used_count   INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO beta_invite_codes (code) VALUES
  ('BETA-INTRALYS-2026-X7K9'),
  ('BETA-INTRALYS-2026-M4P2'),
  ('BETA-INTRALYS-2026-L8V5'),
  ('BETA-INTRALYS-2026-R3N1'),
  ('BETA-INTRALYS-2026-Q9J4');
```

### 6.2 Types front (`src/lib/types.ts` append)

```ts
export interface ReleaseGateCheck {
  ok: boolean;
  value?: unknown;
  missing?: string[];
  status?: number;
  count?: number;
}

export interface ReleaseGatesStatus {
  all_green: boolean;
  checks: {
    migrations_last_seq: ReleaseGateCheck;
    env_critical_present: ReleaseGateCheck;
    env_optional_present: ReleaseGateCheck;
    dev_bypass_off: ReleaseGateCheck;
    payments_live_disabled: ReleaseGateCheck;
    health_endpoint: ReleaseGateCheck;
    web_vitals_endpoint: ReleaseGateCheck;
    beta_codes_seeded: ReleaseGateCheck;
  };
  checked_at: string;
}

export interface ReleaseGatesRun {
  id: string;
  ran_by: string | null;
  all_green: 0 | 1;
  payload: string;
  created_at: string;
}
```

### 6.3 API front (`src/lib/api.ts` append)

```ts
export async function fetchReleaseGates(): Promise<ApiResponse<ReleaseGatesStatus>> {
  return apiFetch<ReleaseGatesStatus>('/admin/release-gates');
}
```

### 6.4 Patch `src/worker/types.ts`

Ajout `FCM_SERVER_KEY?: string;` dans interface `Env` (typage propre,
suppression cast `as unknown` push.ts). FCM Legacy HTTP deprecated juin
2024 → migration FCM v1 OAuth backlog P0 (`docs/TECH-DEBT-RC.md`).

### 6.5 Patch `src/worker/push.ts`

Cast `(env as unknown as Record<string, unknown>).FCM_SERVER_KEY` retiré
ligne ~80 → `env.FCM_SERVER_KEY` direct (typé via 6.4). Comportement
runtime byte-identique.

### 6.6 Stub `src/worker/release-gates.ts`

Signature handler `handleReleaseGatesCheck(request, env, auth)` + EMPTY
response. Manager-B remplit le corps des checks (migrations_last_seq,
env_critical, env_optional, dev_bypass_off, payments_live_disabled,
health_endpoint, web_vitals_endpoint, beta_codes_seeded, all_green).

### 6.7 Route worker (`src/worker.ts`)

```ts
if (path === '/api/admin/release-gates' && method === 'GET') {
  if (auth.role !== 'admin' && auth.role !== 'owner') {
    return json({ error: 'Accès réservé aux administrateurs.', code: 'AGENCY_ONLY' }, 403);
  }
  const m = await import('./worker/release-gates');
  return m.handleReleaseGatesCheck(request, env, auth);
}
```

### 6.8 i18n ~10 clés × 4 catalogues

Append fin de chaque catalogue sous commentaire
`// ── Sprint 30 Release Candidate / Beta ──` :
`release_gates.title`, `subtitle`, `run_check`, `all_green`,
`gate_failed`, `migrations_seq`, `env_critical`, `env_missing`,
`dev_bypass_off`, `payments_disabled`. Parité ×4 stricte (fr-CA tutoyé,
fr-FR neutre, en, es).

## Garde-fous
- Migration seq125 100% additive (CREATE IF NOT EXISTS + INSERT OR IGNORE)
- Route release-gates JAMAIS leak de secrets (booléen `ok` + clés `missing[]` seulement, jamais valeurs)
- ALL_CAPABILITIES seq80 INTOUCHABLE (utilise `settings.manage`)
- LAUNCH-CHECKLIST.md APPEND ONLY (sections Sprint 1-20 intactes)
- BYPASS auth code conservé (retrait manuel Rochdi post-RC documenté)
- Pas d'exécution validation (Antigravity groupé post-Sprint 30)

## Validation finale (Antigravity post-Sprint 30)
Voir checklist 9 étapes dans `docs/GOLIVE-LOT3.md §6`.
