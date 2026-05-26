// ── LOT B / S-B2 — Export CSV configurable (Manager C) ───────────────────────
// Endpoint admin-only : export CSV de leads | orders | conversations avec
// sélection de colonnes contrôlée par whitelist STRICTE (anti-injection
// SQL/CSV). Aucun nom de colonne brut interpolé : la liste SELECT est
// reconstruite UNIQUEMENT depuis la whitelist, jamais depuis l'input client.
//
// Pattern réutilisé verbatim de `leads.ts:700-737` (handleExportCsv) :
//   - garde admin-only `if (auth.role !== 'admin') return json({...}, 403)`
//   - escaping CSV `"${String(v ?? '').replace(/"/g, '""')}"`
//   - headers Content-Type text/csv + Content-Disposition attachment
//
// Dispatch : NON câblé ici (worker.ts hors périmètre — voir note handoff
// dans le rapport Manager C). Route cible : GET /api/exports/configurable.

import type { Env } from './types';
import { json, corsHeaders } from './helpers';

// ── Whitelists colonnes par entité ───────────────────────────────────────────
// Colonnes RÉELLES vérifiées sur les schémas :
//   leads          → schema.sql:35-68
//   orders         → migration-sprintE1-m1-ecommerce-schema.sql:162-186
//   conversations  → migration-sprint3.sql:5-21
// Toute colonne demandée hors de ces listes → 400 (rejet strict).
const COLUMN_WHITELIST: Record<string, readonly string[]> = {
  leads: [
    'id', 'name', 'email', 'phone', 'type', 'status', 'source',
    'budget', 'deal_value', 'score', 'message', 'created_at',
  ],
  orders: [
    'id', 'order_number', 'status', 'financial_status', 'fulfillment_status',
    'subtotal_cents', 'total_cents', 'currency', 'email', 'source',
    'placed_at', 'created_at',
  ],
  conversations: [
    'id', 'subject', 'channel', 'status', 'last_message_preview',
    'last_message_at', 'unread_count', 'created_at',
  ],
};

// Colonnes par défaut si `?columns=` absent (sous-ensemble lisible).
const DEFAULT_COLUMNS: Record<string, readonly string[]> = {
  leads: ['name', 'email', 'phone', 'status', 'source', 'deal_value', 'created_at'],
  orders: ['order_number', 'status', 'financial_status', 'total_cents', 'currency', 'created_at'],
  conversations: ['subject', 'channel', 'status', 'last_message_preview', 'created_at'],
};

// Borne dure sur le volume exporté (évite dump massif accidentel).
const MAX_EXPORT_ROWS = 5000;

export async function handleConfigurableExport(
  env: Env,
  auth: { role: string },
  url: URL,
): Promise<Response> {
  // ── Admin-only (copie EXACTE de leads.ts:701) ──────────────────────────────
  if (auth.role !== 'admin') {
    return json({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  // ── Whitelist entité STRICTE ───────────────────────────────────────────────
  const entity = (url.searchParams.get('entity') || '').trim().toLowerCase();
  if (!entity || !Object.prototype.hasOwnProperty.call(COLUMN_WHITELIST, entity)) {
    return json(
      { error: 'Entité invalide. Valeurs acceptées : leads, orders, conversations.', code: 'EXPORT' },
      400,
    );
  }

  const allowed = COLUMN_WHITELIST[entity]!;

  // ── Whitelist colonnes STRICTE (anti-injection) ────────────────────────────
  // On ne construit le SELECT QUE depuis `allowed` : chaque colonne demandée
  // doit appartenir à la whitelist, sinon 400. Aucune interpolation brute.
  const rawColumns = (url.searchParams.get('columns') || '').trim();
  let columns: string[];
  if (rawColumns) {
    const requested = rawColumns
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);
    if (requested.length === 0) {
      return json({ error: 'Aucune colonne valide demandée.', code: 'EXPORT' }, 400);
    }
    const invalid = requested.filter((c) => !allowed.includes(c));
    if (invalid.length > 0) {
      return json(
        { error: `Colonne(s) non autorisée(s) : ${invalid.join(', ')}.`, code: 'EXPORT' },
        400,
      );
    }
    // Dédup en préservant l'ordre demandé.
    columns = [...new Set(requested)];
  } else {
    columns = [...DEFAULT_COLUMNS[entity]!];
  }

  // ── Requête bornée ─────────────────────────────────────────────────────────
  // `columns` est 100 % issu de la whitelist statique → safe à interpoler dans
  // le SELECT (aucun input brut). Table name issu d'une clé whitelistée.
  try {
    const selectList = columns.join(', ');
    const query = `SELECT ${selectList} FROM ${entity} ORDER BY created_at DESC LIMIT ?`;
    const { results } = await env.DB.prepare(query).bind(MAX_EXPORT_ROWS).all();
    const rows = (results || []) as Record<string, unknown>[];

    // ── Sérialisation CSV (escaping identique leads.ts:725) ──────────────────
    const headerLine = columns
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(',');
    const bodyLines = rows.map((r) =>
      columns
        .map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [headerLine, ...bodyLines].join('\n');

    const filename = `${entity}-intralys-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        ...corsHeaders(),
      },
    });
  } catch {
    return json(
      { error: "Erreur lors de l'export. Réessaie plus tard.", code: 'EXPORT' },
      500,
    );
  }
}
