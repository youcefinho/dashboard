#!/usr/bin/env node
// ── scripts/migrate-encrypt-pii.ts — Sprint 92 (seq187) ─────────────────────
// Script one-shot : chiffre les données PII existantes en D1.
//
// Usage (post-deploy, après migration SQL seq187) :
//   npx wrangler d1 execute intralys-leads --command="SELECT COUNT(*) FROM leads WHERE email_enc IS NULL" --remote
//   npx tsx scripts/migrate-encrypt-pii.ts
//
// Pré-requis :
//   - ENCRYPTION_KEY dans .dev.vars (ou env var)
//   - Migration seq187 exécutée (colonnes email_enc, phone_enc, etc.)
//
// Le script est IDEMPOTENT : les champs déjà chiffrés (email_enc IS NOT NULL)
// sont ignorés. Safe de relancer après interruption.
//
// ⚠️ Ce script utilise l'API REST Wrangler D1 via fetch.
//    En production, on l'exécute via Wrangler directement.
//    Ce fichier sert de DOCUMENTATION et de TEMPLATE pour le script réel.
//
// NOTE : En pratique, ce script est exécuté comme un Worker one-shot
//        ou via un endpoint admin protégé (/api/admin/migrate-encryption).

import {
  encryptField,
  type LeadLike,
} from '../src/worker/lib/field-encryption-engine';
import { computeSearchHash, importHmacKey } from '../src/worker/lib/crypto-search';

// ── Configuration ───────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const PII_FIELDS = ['email', 'phone', 'notes', 'message'] as const;

// ── Types ───────────────────────────────────────────────────────────────────

interface MigrationStats {
  total: number;
  encrypted: number;
  skipped: number;
  errors: number;
}

// ── Migration d'un batch de leads ───────────────────────────────────────────

/**
 * Chiffre un batch de leads et retourne les statements UPDATE.
 * Appelé depuis le handler admin ou le Worker one-shot.
 */
export async function migrateLeadBatch(
  leads: LeadLike[],
  keyHex: string,
): Promise<{
  updates: Array<{
    id: string;
    email_enc: string | null;
    phone_enc: string | null;
    notes_enc: string | null;
    email_hash: string | null;
    phone_hash: string | null;
  }>;
  errors: string[];
}> {
  const updates: Array<{
    id: string;
    email_enc: string | null;
    phone_enc: string | null;
    notes_enc: string | null;
    email_hash: string | null;
    phone_hash: string | null;
  }> = [];
  const errors: string[] = [];

  const hmacKey = await importHmacKey(keyHex);

  for (const lead of leads) {
    try {
      const id = lead.id as string;
      const email = lead.email as string | null;
      const phone = lead.phone as string | null;
      const notes = lead.notes as string | null;

      // Chiffrement PII
      const emailEnc = email ? await encryptField(email, keyHex) : null;
      const phoneEnc = phone ? await encryptField(phone, keyHex) : null;
      const notesEnc = notes ? await encryptField(notes, keyHex) : null;

      // Hash de recherche blind
      const emailHash = email ? await computeSearchHash(email, hmacKey) : null;
      const phoneHash = phone ? await computeSearchHash(phone, hmacKey) : null;

      updates.push({
        id,
        email_enc: emailEnc,
        phone_enc: phoneEnc,
        notes_enc: notesEnc,
        email_hash: emailHash,
        phone_hash: phoneHash,
      });
    } catch (err) {
      errors.push(`Lead ${lead.id}: ${String(err)}`);
    }
  }

  return { updates, errors };
}

// ── Export pour le handler admin (/api/admin/migrate-encryption) ─────────────

/**
 * Handler admin pour lancer la migration progressive.
 * Traite un batch de leads non-chiffrés et retourne les stats.
 */
export async function handleMigrateEncryption(
  db: { prepare: (sql: string) => { bind: (...args: unknown[]) => { all: () => Promise<{ results: LeadLike[] }>; run: () => Promise<void> } } },
  keyHex: string,
  batchSize = BATCH_SIZE,
): Promise<MigrationStats> {
  const stats: MigrationStats = { total: 0, encrypted: 0, skipped: 0, errors: 0 };

  // Récupérer les leads non-chiffrés
  const { results: leads } = await db.prepare(
    'SELECT id, email, phone, notes FROM leads WHERE email_enc IS NULL LIMIT ?'
  ).bind(batchSize).all();

  stats.total = leads.length;

  if (leads.length === 0) {
    return stats; // Rien à migrer
  }

  const { updates, errors } = await migrateLeadBatch(leads, keyHex);
  stats.errors = errors.length;

  // Appliquer les UPDATE en batch
  for (const update of updates) {
    try {
      await db.prepare(
        `UPDATE leads SET email_enc = ?, phone_enc = ?, notes_enc = ?, email_hash = ?, phone_hash = ? WHERE id = ?`
      ).bind(
        update.email_enc,
        update.phone_enc,
        update.notes_enc,
        update.email_hash,
        update.phone_hash,
        update.id,
      ).run();
      stats.encrypted++;
    } catch {
      stats.errors++;
    }
  }

  stats.skipped = stats.total - stats.encrypted - stats.errors;
  return stats;
}

// ── Constantes exportées pour réutilisation ─────────────────────────────────

export { BATCH_SIZE, PII_FIELDS };
