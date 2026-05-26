// ── lib/voicemails-engine.ts — RENFORCEMENT Communication P3 (voicemails.ts) ──
//
// Helpers PURS (zéro I/O, zéro D1, zéro fetch, pas de R2) pour :
//   - construction/parse R2 key déterministe (clientId/callSid/ts).
//   - rétention 90 jours (RGPD / Loi 25 Québec).
//   - validation metadata voicemail (duration, transcription, status).
//   - format export RGPD (CSV + JSON shape pour right-to-portability).
//
// AUCUNE dépendance Worker (Env, D1, fetch, R2 bindings) → 100 % unit-testable.
// Module ADDITIF : voicemails.ts continue de fonctionner inchangé.

// ════════════════════════════════════════════════════════════════════════════
//  CODES ERREUR STABLES
// ════════════════════════════════════════════════════════════════════════════

export const VOICEMAILS_ERROR_CODES = {
  INVALID_R2_KEY: 'invalid_r2_key',
  INVALID_CLIENT_ID: 'invalid_client_id',
  INVALID_CALL_SID: 'invalid_call_sid',
  INVALID_TIMESTAMP: 'invalid_timestamp',
  INVALID_METADATA: 'invalid_metadata',
  INVALID_DURATION: 'invalid_duration',
  INVALID_TRANSCRIPTION_STATUS: 'invalid_transcription_status',
  RETENTION_EXPIRED: 'retention_expired',
} as const;

export type VoicemailsErrorCode =
  (typeof VOICEMAILS_ERROR_CODES)[keyof typeof VOICEMAILS_ERROR_CODES];

// ════════════════════════════════════════════════════════════════════════════
//  CAPS / RÉTENTION
// ════════════════════════════════════════════════════════════════════════════

/** Rétention 90 jours (Loi 25 Québec — proportionnalité + RGPD-équivalent). */
export const RETENTION_DAYS = 90;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Cap durée voicemail (Twilio max 120s). */
export const VOICEMAIL_MAX_DURATION_SEC = 600; // sécurité applicative (>= Twilio 120)
export const VOICEMAIL_MIN_DURATION_SEC = 0;

/** Cap transcription (texte plain). */
export const TRANSCRIPTION_MAX_LEN = 20_000;

export const VALID_TRANSCRIPTION_STATUSES = Object.freeze([
  'pending',
  'completed',
  'failed',
  'skipped',
] as const);
export type TranscriptionStatus = (typeof VALID_TRANSCRIPTION_STATUSES)[number];
const VALID_TRANSCRIPTION_STATUS_SET = new Set<string>(VALID_TRANSCRIPTION_STATUSES);

// ════════════════════════════════════════════════════════════════════════════
//  R2 key builder / parser
// ════════════════════════════════════════════════════════════════════════════

/**
 * Format R2 key déterministe : `voicemails/<clientId>/<YYYY-MM-DD>/<callSid>-<ts>.mp3`.
 * Le préfixe par date facilite les list-prefix R2 + retention scrub par jour.
 *
 * Contraintes :
 *   - clientId : string non vide, ≤ 64 chars, [a-zA-Z0-9_-].
 *   - callSid  : string non vide, ≤ 64 chars, alphanum + - + _.
 *   - ts       : ms epoch number > 0.
 */
export function buildR2VoicemailKey(input: {
  clientId: string;
  callSid: string;
  ts: number;
  ext?: string;
}): string {
  const { clientId, callSid, ts, ext = 'mp3' } = input;
  if (!isValidR2Component(clientId, 64)) {
    throw new Error(VOICEMAILS_ERROR_CODES.INVALID_CLIENT_ID);
  }
  if (!isValidR2Component(callSid, 64)) {
    throw new Error(VOICEMAILS_ERROR_CODES.INVALID_CALL_SID);
  }
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
    throw new Error(VOICEMAILS_ERROR_CODES.INVALID_TIMESTAMP);
  }
  const day = isoDay(new Date(ts));
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'mp3';
  return `voicemails/${clientId}/${day}/${callSid}-${ts}.${safeExt}`;
}

export interface ParsedR2VoicemailKey {
  clientId: string;
  callSid: string;
  ts: number;
  day: string;
  ext: string;
}

/**
 * Parse une R2 key écrite par `buildR2VoicemailKey`. Retourne null si format
 * inattendu (toléré pour rétro-compat — handler peut fallback).
 */
export function parseR2VoicemailKey(key: unknown): ParsedR2VoicemailKey | null {
  if (typeof key !== 'string' || !key) return null;
  // voicemails/<clientId>/<YYYY-MM-DD>/<callSid>-<ts>.<ext>
  const re = /^voicemails\/([A-Za-z0-9_-]{1,64})\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_-]{1,64})-(\d{1,20})\.([a-z0-9]{1,8})$/;
  const m = key.match(re);
  if (!m) return null;
  const ts = Number.parseInt(m[4]!, 10);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return {
    clientId: m[1]!,
    day: m[2]!,
    callSid: m[3]!,
    ts,
    ext: m[5]!,
  };
}

function isValidR2Component(s: unknown, maxLen: number): boolean {
  return typeof s === 'string' && s.length > 0 && s.length <= maxLen && /^[A-Za-z0-9_-]+$/.test(s);
}

function isoDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ════════════════════════════════════════════════════════════════════════════
//  Retention guard
// ════════════════════════════════════════════════════════════════════════════

/**
 * Retourne true si createdAt est dans la fenêtre de rétention (90 jours).
 * Au-delà ⇒ candidat purge RGPD (soft-delete déjà fait, hard-delete cron).
 *
 * Accepte createdAt en ms epoch (number) ou string ISO. Format invalide ⇒
 * false (force purge — défensif).
 */
export function isWithinRetention(createdAt: number | string | null | undefined, now: number = Date.now()): boolean {
  if (createdAt === null || createdAt === undefined) return false;
  let ts: number;
  if (typeof createdAt === 'number') {
    ts = createdAt;
  } else if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt);
    if (!Number.isFinite(parsed)) return false;
    ts = parsed;
  } else {
    return false;
  }
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const age = now - ts;
  return age >= 0 && age <= RETENTION_MS;
}

// ════════════════════════════════════════════════════════════════════════════
//  Metadata validator
// ════════════════════════════════════════════════════════════════════════════

export interface VoicemailMetadata {
  durationSec?: unknown;
  transcription?: unknown;
  transcriptionStatus?: unknown;
  transcriptionLang?: unknown;
}

export interface VoicemailMetadataValidation {
  ok: boolean;
  error?: string;
  code?: VoicemailsErrorCode;
  field?: keyof VoicemailMetadata;
}

const VALID_TRANSCRIPTION_LANGS = new Set(['fr', 'fr-CA', 'fr-FR', 'en', 'en-US', 'en-CA']);

export function validateVoicemailMetadata(meta: VoicemailMetadata | null | undefined): VoicemailMetadataValidation {
  if (!meta || typeof meta !== 'object') {
    return { ok: false, error: 'metadata invalide', code: VOICEMAILS_ERROR_CODES.INVALID_METADATA };
  }
  if (meta.durationSec !== undefined && meta.durationSec !== null) {
    const d = typeof meta.durationSec === 'number' ? meta.durationSec : Number.NaN;
    if (!Number.isFinite(d) || d < VOICEMAIL_MIN_DURATION_SEC || d > VOICEMAIL_MAX_DURATION_SEC) {
      return {
        ok: false,
        error: `durationSec hors borne (0..${VOICEMAIL_MAX_DURATION_SEC})`,
        code: VOICEMAILS_ERROR_CODES.INVALID_DURATION,
        field: 'durationSec',
      };
    }
  }
  if (meta.transcription !== undefined && meta.transcription !== null) {
    if (typeof meta.transcription !== 'string') {
      return {
        ok: false,
        error: 'transcription doit être string',
        code: VOICEMAILS_ERROR_CODES.INVALID_METADATA,
        field: 'transcription',
      };
    }
    if (meta.transcription.length > TRANSCRIPTION_MAX_LEN) {
      return {
        ok: false,
        error: `transcription trop longue (max ${TRANSCRIPTION_MAX_LEN})`,
        code: VOICEMAILS_ERROR_CODES.INVALID_METADATA,
        field: 'transcription',
      };
    }
  }
  if (meta.transcriptionStatus !== undefined && meta.transcriptionStatus !== null) {
    if (typeof meta.transcriptionStatus !== 'string' || !VALID_TRANSCRIPTION_STATUS_SET.has(meta.transcriptionStatus)) {
      return {
        ok: false,
        error: 'transcriptionStatus invalide',
        code: VOICEMAILS_ERROR_CODES.INVALID_TRANSCRIPTION_STATUS,
        field: 'transcriptionStatus',
      };
    }
  }
  if (meta.transcriptionLang !== undefined && meta.transcriptionLang !== null) {
    if (typeof meta.transcriptionLang !== 'string' || !VALID_TRANSCRIPTION_LANGS.has(meta.transcriptionLang)) {
      return {
        ok: false,
        error: 'transcriptionLang invalide',
        code: VOICEMAILS_ERROR_CODES.INVALID_METADATA,
        field: 'transcriptionLang',
      };
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
//  RGPD Export formatter
// ════════════════════════════════════════════════════════════════════════════

export interface VoicemailExportRow {
  id: string;
  client_id?: string | null;
  call_log_id?: string | null;
  lead_id?: string | null;
  from_number?: string | null;
  to_number?: string | null;
  duration_sec?: number | null;
  transcription?: string | null;
  transcription_status?: string | null;
  created_at?: string | null;
  listened_at?: string | null;
  deleted_at?: string | null;
}

export interface VoicemailExportResult {
  csv: string;
  json: string;
  rowCount: number;
}

/**
 * Export RGPD (right-to-portability) — CSV + JSON sérialisés.
 * Colonnes stables, ordre figé, CSV-RFC4180 (quote escape doublé).
 * URLs / R2 keys / sids JAMAIS exportés (PII minimisée : ID + métier + texte).
 */
export function formatVoicemailExport(rows: ReadonlyArray<VoicemailExportRow>): VoicemailExportResult {
  const cols: Array<keyof VoicemailExportRow> = [
    'id',
    'client_id',
    'call_log_id',
    'lead_id',
    'from_number',
    'to_number',
    'duration_sec',
    'transcription',
    'transcription_status',
    'created_at',
    'listened_at',
    'deleted_at',
  ];
  const header = cols.join(',');
  const lines = [header];
  for (const r of rows || []) {
    const values = cols.map((c) => csvEscape(r ? (r as unknown as Record<string, unknown>)[c] : null));
    lines.push(values.join(','));
  }
  const csv = lines.join('\r\n');
  const json = JSON.stringify({ rowCount: rows?.length ?? 0, rows: rows ?? [] });
  return { csv, json, rowCount: rows?.length ?? 0 };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else s = JSON.stringify(value);
  // RFC 4180 : quote si contient , " CR LF ; double-quote internes.
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
