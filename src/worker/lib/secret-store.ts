// ── secret-store.ts — Sprint S7 M1 (sécurité intégrations) ───────────────
//
// ⚠ CONTRAT FIGÉ — Phase A SOLO. Consommé en Phase B par Manager B (connecteur
// Shopify) et Manager C (connecteur Woo). Signatures publiées dans
// docs/SECRET-STORE-S7.md §6 — copiables verbatim.
//
// Problème corrigé : tokens d'intégration stockés EN CLAIR dans KV
//   - ecommerce-channel-shopify.ts:184  STATE_STORE.put('shopify_token:'+id, accessToken)
//   - ecommerce-channel-woo.ts:140-143  STATE_STORE.put('woo_creds:'+id, JSON.stringify({ck,cs}))
//
// Solution : table D1 `integration_secrets` (UNIQUE(channel_id,kind)),
// chiffrement AES-GCM réutilisé À L'IDENTIQUE depuis migration-ghl-oauth.ts
// (import des fonctions EXPORTÉES `encryptToken`/`decryptToken` — fichier
// NON modifié). Fallback clair si `env.TOKEN_KEY` absent (parité dev,
// documenté). Multi-tenant strict : filtrage client_id ET channel_id.
//
// Anti-fuite Loi 25 : ce module ne LOG jamais de plaintext/ciphertext et
// n'appelle pas audit() avec un secret dans `details`. Tout audit appelant
// (Manager B/C) doit passer des métadonnées non sensibles uniquement.

import type { Env } from '../types';
// Réutilisation EXACTE du pattern crypto existant — encryptToken/decryptToken
// sont `export` dans migration-ghl-oauth.ts:16,29 (AES-GCM, IV préfixé,
// base64, clé env.TOKEN_KEY paddée 32, fallback clair si !TOKEN_KEY).
// On NE réimplémente PAS : import direct (fichier source intouché).
import { encryptToken, decryptToken } from '../migration-ghl-oauth';

export type IntegrationSecretKind = 'shopify_token' | 'woo_creds';

export interface SecretStore {
  /** Lecture additive non destructive d'un binding env (secret/var Wrangler).
   *  Retourne undefined si absent. N'altère rien. */
  getEnvSecret(key: string): string | undefined;

  /** SELECT (channel_id, kind) WHERE revoked_at IS NULL, déchiffre.
   *  Retourne null si rien / révoqué / mauvais tenant. Filtre client_id ET channel_id. */
  getIntegrationToken(
    env: Env,
    clientId: string,
    channelId: string,
    kind: IntegrationSecretKind
  ): Promise<string | null>;

  /** Chiffre `plaintext` (AES-GCM via TOKEN_KEY, clair si absent) puis UPSERT
   *  dans integration_secrets (UNIQUE(channel_id,kind)). Multi-tenant : client_id figé. */
  putIntegrationToken(
    env: Env,
    clientId: string,
    channelId: string,
    kind: IntegrationSecretKind,
    plaintext: string
  ): Promise<void>;

  /** UPDATE revoked_at = datetime('now') pour (channel_id, kind) du tenant. */
  revokeIntegrationToken(
    env: Env,
    clientId: string,
    channelId: string,
    kind: string
  ): Promise<void>;
}

export function createSecretStore(env: Env): SecretStore {
  return {
    getEnvSecret(key: string): string | undefined {
      // Accès additif : lecture seule du binding, jamais d'écriture.
      const v = (env as unknown as Record<string, unknown>)[key];
      return typeof v === 'string' ? v : undefined;
    },

    async putIntegrationToken(
      envArg: Env,
      clientId: string,
      channelId: string,
      kind: IntegrationSecretKind,
      plaintext: string
    ): Promise<void> {
      // Chiffrement réutilisé verbatim. Si !TOKEN_KEY → renvoie le clair
      // (parité dev documentée — JAMAIS le cas en prod, TOKEN_KEY = secret put).
      const ciphertext = await encryptToken(plaintext, envArg);
      // UPSERT sur la contrainte UNIQUE(channel_id, kind). client_id figé
      // (multi-tenant : on n'écrase jamais le secret d'un autre tenant car
      // channel_id appartient à un seul client via FK sales_channels).
      await envArg.DB.prepare(
        `INSERT INTO integration_secrets
           (client_id, channel_id, kind, ciphertext, rotated_at, revoked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), NULL, datetime('now'), datetime('now'))
         ON CONFLICT(channel_id, kind) DO UPDATE SET
           client_id  = excluded.client_id,
           ciphertext = excluded.ciphertext,
           rotated_at = datetime('now'),
           revoked_at = NULL,
           updated_at = datetime('now')`
      )
        .bind(clientId, channelId, kind, ciphertext)
        .run();
    },

    async getIntegrationToken(
      envArg: Env,
      clientId: string,
      channelId: string,
      kind: IntegrationSecretKind
    ): Promise<string | null> {
      // Multi-tenant strict : filtre client_id ET channel_id ET kind,
      // ignore les secrets révoqués.
      const row = (await envArg.DB.prepare(
        `SELECT ciphertext FROM integration_secrets
          WHERE client_id = ? AND channel_id = ? AND kind = ? AND revoked_at IS NULL
          LIMIT 1`
      )
        .bind(clientId, channelId, kind)
        .first()) as { ciphertext?: string } | null;

      if (!row || typeof row.ciphertext !== 'string') return null;
      // Déchiffrement réutilisé verbatim (clair si !TOKEN_KEY — round-trip ok).
      return await decryptToken(row.ciphertext, envArg);
    },

    async revokeIntegrationToken(
      envArg: Env,
      clientId: string,
      channelId: string,
      kind: string
    ): Promise<void> {
      await envArg.DB.prepare(
        `UPDATE integration_secrets
            SET revoked_at = datetime('now'), updated_at = datetime('now')
          WHERE client_id = ? AND channel_id = ? AND kind = ? AND revoked_at IS NULL`
      )
        .bind(clientId, channelId, kind)
        .run();
    },
  };
}
