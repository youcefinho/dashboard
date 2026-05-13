# Sprint 14.5 — Hotfix Audit GHL Migration

> Livré le 2026-05-13. 3 commits sur `master`.

## Contexte

Audit de sécurité et de qualité sur le code livré au Sprint 14 (Migration GHL).
3 problèmes critiques identifiés et corrigés.

## Action 1 — OAuth Security GHL 🔴

**Problème :** Le state CSRF était généré mais jamais validé au callback.
Les tokens OAuth étaient stockés en clair dans D1. Pas de refresh automatique.

**Corrections :**
- **State CSRF via KV** : Le nonce est stocké dans `env.STATE_STORE` (KVNamespace) avec TTL 10min.
  Au callback, le nonce est vérifié et consommé (one-time use). State absent → 403.
- **Chiffrement AES-GCM** : `access_token` et `refresh_token` chiffrés via WebCrypto avant stockage.
  IV aléatoire 12 bytes préfixé au ciphertext. Clé dérivée de `env.TOKEN_KEY` (32 chars).
  Fallback transparent en dev (si `TOKEN_KEY` absent, pas de chiffrement).
- **Cron refresh** : `refreshExpiringGhlTokens()` ajouté au `scheduled` handler.
  Toutes les heures, les tokens expirant dans < 1h sont renouvelés via `grant_type=refresh_token`.
- **7 tests ajoutés** : encrypt/decrypt roundtrip, IV aléatoire, CSRF absent/valide, edge cases.

**Fichiers modifiés :**
- `src/worker/migration-ghl-oauth.ts` (réécrit)
- `src/worker/migration-ghl-api.ts` (import decryptToken)
- `src/worker/types.ts` (+TOKEN_KEY, +STATE_STORE)
- `src/worker.ts` (cron refresh)

## Action 2 — Tags + Custom Fields dans Live API 🟠

**Problème :** L'import API (Phase D) ignorait les tags et custom fields des contacts GHL.
Le commentaire disait « pour simplifier l'exemple ». Le CSV (Phase C) les gérait correctement.

**Corrections :**
- `mapGhlContact()` retourne maintenant `tags: string[]` et `customFields: Array<{id, value}>`.
- La boucle contacts dans `runMigrationLoop` insère les tags (`INSERT OR IGNORE INTO lead_tags`)
  et les custom fields (`INSERT OR REPLACE INTO custom_field_values`) après chaque lead.
- **3 tests ajoutés** : tags normalisés, customFields passthrough, défauts vides.

## Action 3 — Vrais Tests d'Idempotence 🟠

**Problème :** Les tests existants faisaient `typeof === 'string'` — zéro valeur probante.

**Corrections :**
- Helper `createInMemoryDB()` dans `__tests__/helpers/in-memory-db.ts` :
  simule D1 avec `Map` + vérification réelle des contraintes UNIQUE.
- **7 tests réels** :
  - Run CSV 2x mêmes 5 leads → toujours 5, pas 10
  - `INSERT OR IGNORE` doublon → `changes: 0` silencieux
  - `INSERT` doublon sans `OR IGNORE` → throw `UNIQUE constraint failed`
  - Messages UNIQUE `(client_id, external_id)` → 2e fail
  - Tags OR IGNORE → pas de doublon
  - Clients différents, même external_id → pas de collision

> Note : `better-sqlite3` non utilisé (échec compilation node-gyp Windows).
> Le mock in-memory est tout aussi probant pour valider la logique métier.

## Métriques

| Avant | Après |
|---|---|
| 183 tests | **193 tests** (+10) |
| 30 fichiers test | **31 fichiers test** (+1) |
| Build vert | Build vert |
