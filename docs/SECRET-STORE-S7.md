# SECRET-STORE — Sprint S7 M1 (sécurité intégrations)

> Programme renforcement plateforme · Lot 3 · Phase A SOLO (Manager A).
> Corrige : tokens d'intégration stockés EN CLAIR dans KV
> (`ecommerce-channel-shopify.ts:184`, `ecommerce-channel-woo.ts:140-143`).
> Remplacés par une table D1 chiffrée AES-GCM via une porte d'entrée typée unique.

## §6 Contrats figés (consommables verbatim par Manager B et Manager C)

### Module

`src/worker/lib/secret-store.ts` (NOUVEAU, additif, ne modifie aucun fichier existant).
Chiffrement réutilisé À L'IDENTIQUE par **import** de `encryptToken`/`decryptToken`
(`src/worker/migration-ghl-oauth.ts:16,29`, fichier source INTOUCHÉ — fonctions
`export async` confirmées). AES-GCM, IV 12 octets préfixé, base64, clé `env.TOKEN_KEY`
paddée/tronquée 32. **Fallback dev** : si `env.TOKEN_KEY` absent → identité (clair),
round-trip cohérent. JAMAIS le cas en prod (`wrangler secret put TOKEN_KEY`).

### Type & signatures (FIGÉES — copier tel quel)

```ts
export type IntegrationSecretKind = 'shopify_token' | 'woo_creds';

export interface SecretStore {
  getEnvSecret(key: string): string | undefined;
  getIntegrationToken(
    env: Env, clientId: string, channelId: string,
    kind: IntegrationSecretKind
  ): Promise<string | null>;
  putIntegrationToken(
    env: Env, clientId: string, channelId: string,
    kind: IntegrationSecretKind, plaintext: string
  ): Promise<void>;
  revokeIntegrationToken(
    env: Env, clientId: string, channelId: string,
    kind: string
  ): Promise<void>;
}

export function createSecretStore(env: Env): SecretStore;
```

### Sémantique garantie (contrat consommateurs B/C)

- `getEnvSecret(key)` : lecture additive d'un binding `env[key]` ; `undefined` si absent
  ou non-string. **N'altère rien** — `env.X` reste valide en parallèle (non remplacé).
- `putIntegrationToken(...)` : chiffre puis **UPSERT** sur `UNIQUE(channel_id, kind)`
  (`ON CONFLICT DO UPDATE`, remet `revoked_at=NULL`, bump `rotated_at`/`updated_at`).
  `client_id` figé à l'écriture.
- `getIntegrationToken(...)` : SELECT filtré **`client_id` ET `channel_id` ET `kind`
  ET `revoked_at IS NULL`** → déchiffre → `string`, sinon `null` (rien / révoqué /
  mauvais tenant). Jamais d'exception sur absence.
- `revokeIntegrationToken(...)` : `UPDATE revoked_at=datetime('now')` (idempotent,
  ne touche que les lignes non déjà révoquées du tenant). Après revoke,
  `getIntegrationToken` renvoie `null`.

### Schéma SQL figé

`migration-sprintS7-m1.sql` (seq **75** manifest, `depends_on: migration-sprintE8-m1.sql`,
risk `low`). Table `integration_secrets` : `id` PK `lower(hex(randomblob(16)))`,
`client_id → clients(id)`, `channel_id → sales_channels(id) ON DELETE CASCADE`,
`kind`, `ciphertext`, `rotated_at`, `revoked_at`, `created_at`/`updated_at`
`datetime('now')` (JAMAIS unixepoch), `UNIQUE(channel_id, kind)`,
index `idx_intsec_client` / `idx_intsec_channel`.

### Binding — DÉCISION pour Manager C

**`TOKEN_KEY` est DÉJÀ déclaré dans `src/worker/types.ts:30`.** Aucun nouveau binding
requis par S7. **Manager C ne doit PAS ajouter de binding dans `types.ts`** (revendication
conditionnelle du Chaman → ANNULÉE). `STATE_STORE` (KV CSRF) existe déjà aussi.

### Pour Manager B (connecteurs)

Remplacer les `STATE_STORE.put('shopify_token:'+id, ...)` /
`STATE_STORE.put('woo_creds:'+id, ...)` et leurs relectures par
`createSecretStore(env)` :
- callback → `await store.putIntegrationToken(env, clientId, channelId, 'shopify_token'|'woo_creds', plaintext)`
- pushFn / lecture → `const tok = await store.getIntegrationToken(env, clientId, channelId, kind)` ; `if (!tok) return false /* no-op */`
- rotation/révocation → `revokeIntegrationToken` + nouveau `putIntegrationToken`.
Garder le **no-op KV-absent** : `null` ⇒ comportement actuel préservé (push no-op).
Multi-tenant : toujours résoudre `clientId` via le canal chargé (jamais en dur).

### Anti-fuite Loi 25

Ce module ne log jamais de plaintext/ciphertext et n'appelle pas `audit()`.
Tout `audit()` appelant (B/C : `channel.connect`/`rotate`/`revoke`/rejet-signature)
ne met QUE des métadonnées non sensibles dans `details` (jamais token/ciphertext/secret).

## Activation (Rochdi — hors VM, intégration réelle)

Non testable sur la VM (aucune commande exécutée). Avant prod :
1. `wrangler secret put TOKEN_KEY` (sinon stockage en clair — parité dev seulement).
2. Binding KV `STATE_STORE` actif (CSRF OAuth) + secrets `SHOPIFY_*` / `WOO_*`.
3. Appliquer `migration-sprintS7-m1.sql` via le runner (seq 75 du manifest) —
   soumis aux **5 gates Rochdi** (cf `platform_hardening_program`).
4. Nettoyage best-effort des anciennes clés KV claires `shopify_token:*` /
   `woo_creds:*` après bascule (la révocation S7 peut `STATE_STORE.delete` —
   à câbler côté Manager B/C, documenté).
5. OAuth bout-en-bout (échange code→token Shopify/Woo, webhook signé réel) =
   test d'intégration réel, délégué.

## Statut Phase A

Livré : `secret-store.ts`, `migration-sprintS7-m1.sql`, append manifest seq 75 +
`MIGRATIONS-INVENTORY.md` + `MIGRATIONS-ORDER.md`, ce doc §6, `secret-store.test.ts`.
**§6 FIGÉ → Phase B (Manager B ∥ Manager C) peut démarrer.**
