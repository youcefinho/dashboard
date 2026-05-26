// ── Sprint 35 — snapshots-import.ts — Handler REST import (PHASE B) ────────
// 1 handler : POST /api/snapshots/import (signature FIGÉE inter-agent).
//
// Branche les helpers de `./lib/snapshot-import.ts` (parseBundle +
// validateBundleSchema + verifySignature + applyImport) et persiste l'entrée
// snapshot_imports (status running → completed/failed).
//
// Garde capability 'settings.manage' (FIGÉE seq80 — ZÉRO ajout).
// Body accepté :
//   {
//     bundle?: SnapshotBundle,         // import depuis upload direct
//     snapshot_id?: string,            // import depuis un snapshot existant
//     target_client_id: string,        // OBLIGATOIRE (multi-tenant)
//     mode: 'dry_run' | 'commit'       // OBLIGATOIRE
//   }
//
// Bornage tenant STRICT (§6.6) :
//   - target_client_id doit appartenir à tenant.accessibleClientIds, sinon 403.
//   - SELECT snapshots scoped sur accessibleClientIds (anti-IDOR).
//   - applyImport force client_id/agency_id depuis options (jamais depuis bundle).

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit } from './helpers';
import { resolveTenantContext } from './tenant-context';
import {
  parseBundle,
  validateBundleSchema,
  verifySignature,
  applyImport,
  type ImportLogEntry,
  type ImportSummary,
} from './lib/snapshot-import';
import type { SnapshotBundle } from './lib/snapshot-export';

type SnapshotsImportAuth = CapAuth & { capabilities?: Set<string> };

// ── POST /api/snapshots/import ──────────────────────────────────────────────
export async function handleImportSnapshot(
  request: Request,
  env: Env,
  auth: SnapshotsImportAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    // ── 1) Parse body ─────────────────────────────────────────────────────
    let body: {
      snapshot_id?: unknown;
      bundle?: unknown;
      target_client_id?: unknown;
      mode?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const snapshotId =
      typeof body.snapshot_id === 'string' && body.snapshot_id.length > 0
        ? body.snapshot_id
        : null;
    const rawBundle =
      body.bundle && typeof body.bundle === 'object' ? (body.bundle as SnapshotBundle) : null;
    const targetClientId =
      typeof body.target_client_id === 'string' && body.target_client_id.length > 0
        ? body.target_client_id
        : null;
    const mode =
      body.mode === 'dry_run' || body.mode === 'commit'
        ? (body.mode as 'dry_run' | 'commit')
        : null;

    if (!targetClientId) {
      return json({ error: 'target_client_id requis' }, 400);
    }
    if (!mode) {
      return json({ error: 'mode requis (dry_run | commit)' }, 400);
    }
    if (!snapshotId && !rawBundle) {
      return json({ error: 'snapshot_id ou bundle requis' }, 400);
    }

    // ── 2) Bornage tenant — accessibleClientIds doit contenir target ─────
    const tenant = await resolveTenantContext(env, auth.userId, auth.role);
    if (!tenant.accessibleClientIds.includes(targetClientId)) {
      return json({ error: 'target_client_id_not_accessible' }, 403);
    }

    // ── 3) Résolution bundle ─────────────────────────────────────────────
    let bundle: SnapshotBundle;
    if (snapshotId) {
      // Lookup snapshot scoped sur accessibleClientIds (anti-IDOR).
      const placeholders = tenant.accessibleClientIds.map(() => '?').join(', ');
      const row = (await env.DB.prepare(
        `SELECT payload_json
           FROM snapshots
          WHERE id = ?
            AND client_id IN (${placeholders})
          LIMIT 1`,
      )
        .bind(snapshotId, ...tenant.accessibleClientIds)
        .first()) as { payload_json: string | null } | null;

      if (!row || !row.payload_json) {
        return json({ error: 'Snapshot introuvable' }, 404);
      }
      const parsed = parseBundle(row.payload_json);
      if (!parsed.ok) {
        return json({ error: parsed.error }, 400);
      }
      bundle = parsed.bundle;
    } else {
      bundle = rawBundle as SnapshotBundle;
    }

    // ── 4) Validation schema ─────────────────────────────────────────────
    const schemaCheck = validateBundleSchema(bundle);
    if (!schemaCheck.ok) {
      return json({ error: schemaCheck.error }, 400);
    }

    // ── 5) Vérification signature (anti-altération) ──────────────────────
    const sigCheck = await verifySignature(bundle);
    if (!sigCheck.ok) {
      // Audit upstream signature mismatch (best-effort).
      await audit(env, auth.userId, 'snapshot_signature_mismatch', 'snapshot', snapshotId ?? '', {
        target_client_id: targetClientId,
        expected: sigCheck.expected,
        actual: sigCheck.actual,
      });
      return json(
        {
          error: 'signature_mismatch',
          meta: { expected: sigCheck.expected, actual: sigCheck.actual },
        },
        400,
      );
    }

    // ── 6) Lookup target_agency_id ───────────────────────────────────────
    let targetAgencyId: string | null = null;
    try {
      const c = (await env.DB.prepare('SELECT agency_id FROM clients WHERE id = ?')
        .bind(targetClientId)
        .first()) as { agency_id: string | null } | null;
      targetAgencyId = c?.agency_id ?? null;
    } catch {
      targetAgencyId = null;
    }

    // ── 7) INSERT snapshot_imports (status='running') ────────────────────
    const importId = crypto.randomUUID();
    const sourceClientId = bundle.source?.client_id ?? null;
    const payloadHash = bundle.signature?.hash_hex ?? '';
    const schemaVersion = bundle.schema_version;

    try {
      await env.DB.prepare(
        `INSERT INTO snapshot_imports (
          id, snapshot_id, source_client_id, target_client_id, target_agency_id,
          mode, status, payload_hash_sha256, schema_version,
          started_by, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, datetime('now'))`,
      )
        .bind(
          importId,
          snapshotId,
          sourceClientId,
          targetClientId,
          targetAgencyId,
          mode,
          payloadHash,
          schemaVersion,
          auth.userId,
        )
        .run();
    } catch (err) {
      // Si l'INSERT initial échoue, on ne peut pas tracer — renvoie 500.
      return json(
        { error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }

    // ── 8) Apply import (dry_run ou commit) ──────────────────────────────
    let result: { summary: ImportSummary; log: ImportLogEntry[] };
    try {
      result = await applyImport(env, bundle, {
        targetClientId,
        targetAgencyId,
        mode,
        startedBy: auth.userId,
        importId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? 'unknown_error');
      // Marque l'import comme failed avec log de l'erreur (best-effort).
      try {
        await env.DB.prepare(
          `UPDATE snapshot_imports
              SET status = 'failed',
                  completed_at = datetime('now'),
                  log_json = ?
            WHERE id = ?`,
        )
          .bind(JSON.stringify([{ error: msg }]), importId)
          .run();
      } catch {
        /* best-effort */
      }
      await audit(env, auth.userId, 'snapshot_import_failed', 'snapshot_import', importId, {
        target_client_id: targetClientId,
        mode,
        error: msg,
      });
      return json({ error: msg }, 500);
    }

    // ── 9) UPDATE snapshot_imports (status='completed') ──────────────────
    try {
      await env.DB.prepare(
        `UPDATE snapshot_imports
            SET status = 'completed',
                completed_at = datetime('now'),
                summary_json = ?,
                log_json = ?,
                id_mapping_json = ?
          WHERE id = ?`,
      )
        .bind(
          JSON.stringify(result.summary),
          JSON.stringify(result.log),
          JSON.stringify(result.summary.id_mapping),
          importId,
        )
        .run();
    } catch {
      /* best-effort — l'import a réussi côté business, le UPDATE meta n'est pas bloquant */
    }

    // ── 10) Audit succès ─────────────────────────────────────────────────
    await audit(env, auth.userId, `snapshot_imported_${mode}`, 'snapshot_import', importId, {
      target_client_id: targetClientId,
      source_client_id: sourceClientId,
      snapshot_id: snapshotId,
      totals: result.summary.totals,
    });

    return json({
      data: {
        import_id: importId,
        summary: result.summary,
        log: result.log,
      },
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
}
