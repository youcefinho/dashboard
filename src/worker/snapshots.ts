// ── Sprint 35 — snapshots.ts — Handlers REST snapshots (Phase B Manager-B) ──
// 7 handlers : create / list / get / download / publish / archive / delete.
// Signatures FIGÉES Phase A — Phase B remplit les corps (calque catalog.ts /
// exports-extra.ts). Routes câblées worker.ts dans routeProtected.
//
// Contrats GELÉS (docs/LOT-TEAM-BC.md §6.A) :
//   - succès : json({ data })
//   - erreur  : json({ error }, status)   ← JAMAIS de champ `code`
//
// Bornage tenant strict : `WHERE client_id = ?` partout (defense-in-depth
// IDOR — §6.6). resolveClientId() = calque catalog.ts:57 (getClientModules).
// Garde capability `settings.manage` (FIGÉE seq80) au top de chaque handler.

import type { Env } from './types';
import type { CapAuth } from './capabilities';
import { requireCapability } from './capabilities';
import { json, audit, sanitizeInput } from './helpers';
import { getClientModules } from './modules';
import {
  collectSnapshotPayload,
  signPayload,
  serializeBundle,
  validateBundleSize,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshottableEntity,
} from './lib/snapshot-export';

type SnapshotsAuth = CapAuth & { capabilities?: Set<string> };

// ── helpers locaux ──────────────────────────────────────────────────────────

/** Résout le client_id du tenant courant (calque catalog.ts:57). */
async function resolveClientId(
  env: Env,
  auth: SnapshotsAuth,
): Promise<string | null> {
  const { clientId } = await getClientModules(env, auth.userId);
  return clientId;
}

/** Lookup agency_id depuis clients (best-effort). */
async function lookupAgencyId(env: Env, clientId: string): Promise<string | null> {
  try {
    const row = (await env.DB.prepare('SELECT agency_id FROM clients WHERE id = ?')
      .bind(clientId)
      .first()) as { agency_id: string | null } | null;
    return row?.agency_id ?? null;
  } catch {
    return null;
  }
}

/** Sanitize un nom pour usage filesystem (Content-Disposition). */
function safeFilenamePart(input: string): string {
  return (input || 'snapshot')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'snapshot';
}

/** Parse tables_summary_json en best-effort. */
function parseTablesSummary(raw: unknown): Record<string, number> | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Compte les rows par entité depuis bundle.entities. */
function computeTablesSummary(
  entities: Record<string, Array<Record<string, unknown>>>,
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const [key, rows] of Object.entries(entities)) {
    summary[key] = Array.isArray(rows) ? rows.length : 0;
  }
  return summary;
}

// ── POST /api/snapshots ─────────────────────────────────────────────────────
export async function handleCreateSnapshot(
  request: Request,
  env: Env,
  auth: SnapshotsAuth,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    // 1) parse body
    let body: { name?: unknown; description?: unknown; entities?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'Corps JSON invalide' }, 400);
    }

    const name = sanitizeInput(typeof body.name === 'string' ? body.name : '', 200);
    if (!name) {
      return json({ error: 'Le nom du snapshot est requis' }, 400);
    }
    const description = sanitizeInput(
      typeof body.description === 'string' ? body.description : '',
      2000,
    ) || null;

    // 2) borne tenant
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }
    const agencyId = await lookupAgencyId(env, clientId);

    // 3) collecte + signature
    const subset =
      Array.isArray(body.entities)
        ? (body.entities.filter((e) => typeof e === 'string') as SnapshottableEntity[])
        : undefined;
    const unsigned = await collectSnapshotPayload(
      env,
      clientId,
      subset ? { entities: subset } : undefined,
    );

    // Surcharge name/description depuis body (§6 — l'utilisateur les renseigne).
    const unsignedWithMeta = {
      ...unsigned,
      source: {
        ...unsigned.source,
        name,
        description,
      },
    };

    const signed = await signPayload(unsignedWithMeta);
    const serialized = serializeBundle(signed);

    // 4) borne taille (§6.5 : 5 MiB hard cap)
    const sizeCheck = validateBundleSize(serialized);
    if (!sizeCheck.ok) {
      return json({ error: 'bundle_too_large' }, 413);
    }

    // 5) tables_summary
    const summary = computeTablesSummary(signed.entities);

    // 6) INSERT snapshots
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO snapshots (
        id, client_id, agency_id, name, description,
        version, schema_version,
        payload_json, payload_hash_sha256, payload_size_bytes,
        tables_summary_json, status, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        id,
        clientId,
        agencyId,
        name,
        description,
        1,
        SNAPSHOT_SCHEMA_VERSION,
        serialized,
        signed.signature.hash_hex,
        serialized.length,
        JSON.stringify(summary),
        'draft',
        auth.userId,
      )
      .run();

    // 7) audit (best-effort, ne bloque pas)
    await audit(env, auth.userId, 'snapshot_created', 'snapshot', id, {
      size: serialized.length,
      tables: summary,
    });

    // 8) renvoie meta SANS payload (économie bande)
    return json({
      data: {
        id,
        client_id: clientId,
        agency_id: agencyId,
        name,
        description,
        version: 1,
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        payload_hash_sha256: signed.signature.hash_hex,
        payload_size_bytes: serialized.length,
        tables_summary: summary,
        status: 'draft',
        created_by: auth.userId,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/snapshots ──────────────────────────────────────────────────────
export async function handleListSnapshots(
  env: Env,
  auth: SnapshotsAuth,
  url: URL,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Filtres ?status=&?limit=100 (cap dur 100)
    const statusFilter = sanitizeInput(url.searchParams.get('status') || '', 40);
    const rawLimit = parseInt(url.searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 100;

    // SELECT SANS payload_json (économie bande, §3 list = meta-only)
    let query =
      `SELECT id, client_id, agency_id, name, description, schema_version,
              payload_hash_sha256, payload_size_bytes, tables_summary_json,
              status, created_by, created_at, updated_at
       FROM snapshots
       WHERE client_id = ?`;
    const bindings: unknown[] = [clientId];
    if (statusFilter) {
      query += ' AND status = ?';
      bindings.push(statusFilter);
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    bindings.push(limit);

    const { results } = await env.DB.prepare(query).bind(...bindings).all();
    const rows = ((results || []) as Array<Record<string, unknown>>).map((r) => {
      const { tables_summary_json, ...rest } = r;
      return {
        ...rest,
        tables_summary: parseTablesSummary(tables_summary_json),
      };
    });

    return json({ data: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/snapshots/:id ──────────────────────────────────────────────────
export async function handleGetSnapshot(
  env: Env,
  auth: SnapshotsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const row = (await env.DB.prepare(
      `SELECT id, client_id, agency_id, name, description, schema_version,
              payload_hash_sha256, payload_size_bytes, tables_summary_json,
              status, created_by, created_at, updated_at
       FROM snapshots
       WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .first()) as Record<string, unknown> | null;

    if (!row) {
      return json({ error: 'Snapshot introuvable' }, 404);
    }

    const { tables_summary_json, ...rest } = row;
    return json({
      data: {
        ...rest,
        tables_summary: parseTablesSummary(tables_summary_json),
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── GET /api/snapshots/:id/download ─────────────────────────────────────────
// Renvoie le bundle complet sérialisé en JSON (Content-Type application/json
// + Content-Disposition attachment). Filtrage tenant strict.
export async function handleDownloadSnapshotBundle(
  env: Env,
  auth: SnapshotsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const row = (await env.DB.prepare(
      'SELECT payload_json, name, created_at FROM snapshots WHERE id = ? AND client_id = ?',
    )
      .bind(id, clientId)
      .first()) as { payload_json: string; name: string; created_at: string } | null;

    if (!row) {
      return json({ error: 'Snapshot introuvable' }, 404);
    }

    const datePart = (row.created_at || '').slice(0, 10) || 'undated';
    const safeName = safeFilenamePart(row.name);
    const filename = `snapshot-${safeName}-${datePart}.intralys.json`;

    return new Response(row.payload_json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/snapshots/:id/publish ─────────────────────────────────────────
export async function handlePublishSnapshot(
  env: Env,
  auth: SnapshotsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Update conditional : status doit être 'draft' pour publier.
    const res = await env.DB.prepare(
      `UPDATE snapshots
         SET status = 'published', updated_at = datetime('now')
       WHERE id = ? AND client_id = ? AND status = 'draft'`,
    )
      .bind(id, clientId)
      .run();

    // D1 meta.changes : nombre de rows affectées.
    const changes = (res?.meta?.changes ?? 0) as number;
    if (changes === 0) {
      // Soit pas trouvé, soit pas en statut draft. Lookup pour discriminer.
      const existing = (await env.DB.prepare(
        'SELECT status FROM snapshots WHERE id = ? AND client_id = ?',
      )
        .bind(id, clientId)
        .first()) as { status: string } | null;

      if (!existing) {
        return json({ error: 'Snapshot introuvable' }, 404);
      }
      return json(
        { error: `Snapshot non publiable (statut courant: ${existing.status})` },
        409,
      );
    }

    await audit(env, auth.userId, 'snapshot_published', 'snapshot', id, {});

    return json({ data: { id, status: 'published' } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── POST /api/snapshots/:id/archive ─────────────────────────────────────────
export async function handleArchiveSnapshot(
  env: Env,
  auth: SnapshotsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    const res = await env.DB.prepare(
      `UPDATE snapshots
         SET status = 'archived', updated_at = datetime('now')
       WHERE id = ? AND client_id = ?`,
    )
      .bind(id, clientId)
      .run();

    const changes = (res?.meta?.changes ?? 0) as number;
    if (changes === 0) {
      return json({ error: 'Snapshot introuvable' }, 404);
    }

    await audit(env, auth.userId, 'snapshot_archived', 'snapshot', id, {});

    return json({ data: { id, status: 'archived' } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

// ── DELETE /api/snapshots/:id ───────────────────────────────────────────────
// Politique :
//   - status='draft' → DELETE physique (jamais publié → safe à supprimer).
//   - status='published'|'archived' → soft-delete (UPDATE status='archived').
//     L'audit_log conserve la trace de l'action.
export async function handleDeleteSnapshot(
  env: Env,
  auth: SnapshotsAuth,
  id: string,
): Promise<Response> {
  const g = requireCapability(auth.capabilities, 'settings.manage');
  if (g) return g;

  try {
    const clientId = await resolveClientId(env, auth);
    if (!clientId) {
      return json({ error: 'Client introuvable pour cet utilisateur' }, 400);
    }

    // Lookup statut + bornage tenant.
    const existing = (await env.DB.prepare(
      'SELECT status FROM snapshots WHERE id = ? AND client_id = ?',
    )
      .bind(id, clientId)
      .first()) as { status: string } | null;

    if (!existing) {
      return json({ error: 'Snapshot introuvable' }, 404);
    }

    const isDraft = existing.status === 'draft';
    if (isDraft) {
      await env.DB.prepare('DELETE FROM snapshots WHERE id = ? AND client_id = ?')
        .bind(id, clientId)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE snapshots
           SET status = 'archived', updated_at = datetime('now')
         WHERE id = ? AND client_id = ?`,
      )
        .bind(id, clientId)
        .run();
    }

    await audit(env, auth.userId, 'snapshot_deleted', 'snapshot', id, {
      previous_status: existing.status,
      hard_delete: isDraft,
    });

    return json({ data: { id, deleted: isDraft } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
