// ── scheduled-reports-engine.ts ─────────────────────────────────────────────
// Helpers PURS pour `scheduled-reports.ts` (P1) :
//   - Validation cron expression (5-field, no @aliases pour sécurité)
//   - Parse + validation recipients (CSV string OR array)
//   - computeNextRun (basic cron parse → Date | null)
//   - validateReportInput (cadence, format, kind, name, ranges)
//   - renderReportHtml (XSS-safe email template)
//   - Constantes / codes d'erreur figés
//
// Bornage tenant : ces helpers sont PURS (zéro accès D1). Le bornage
// `WHERE client_id = ?` reste dans le handler (calque funnel-engine.ts).
//
// Best-effort STRICT : aucune fonction ne throw — toutes retournent un Result
// `{ ok; error?; field? }` ou une valeur fallback honnête (jamais une
// validation silencieusement vraie sur input pourri).

/** Codes d'erreur normalisés (frozen — interdit la mutation runtime). */
export const SCHEDULED_REPORTS_ERROR_CODES = Object.freeze({
  CRON_INVALID: 'CRON_INVALID',
  CRON_FIELD_OUT_OF_RANGE: 'CRON_FIELD_OUT_OF_RANGE',
  CRON_ALIAS_REJECTED: 'CRON_ALIAS_REJECTED',
  RECIPIENTS_EMPTY: 'RECIPIENTS_EMPTY',
  RECIPIENTS_TOO_MANY: 'RECIPIENTS_TOO_MANY',
  RECIPIENT_INVALID: 'RECIPIENT_INVALID',
  CADENCE_INVALID: 'CADENCE_INVALID',
  FORMAT_INVALID: 'FORMAT_INVALID',
  KIND_INVALID: 'KIND_INVALID',
  NAME_TOO_LONG: 'NAME_TOO_LONG',
  DAY_OF_WEEK_OUT_OF_RANGE: 'DAY_OF_WEEK_OUT_OF_RANGE',
  DAY_OF_MONTH_OUT_OF_RANGE: 'DAY_OF_MONTH_OUT_OF_RANGE',
  FREQUENCY_EXCEEDED: 'FREQUENCY_EXCEEDED',
} as const);

export type ScheduledReportsErrorCode =
  (typeof SCHEDULED_REPORTS_ERROR_CODES)[keyof typeof SCHEDULED_REPORTS_ERROR_CODES];

/** Plafond de destinataires (calque scheduled-reports.ts:165 slice(0,50)). */
export const MAX_RECIPIENTS = 50;

/** Plafond fréquence max/jour (anti-abus cron — un rapport ≠ un broadcast). */
export const MAX_FREQUENCY_PER_DAY = 10;

/** Plafond longueur name (calque scheduled-reports.ts:255 slice(0,120)). */
export const MAX_NAME_LENGTH = 120;

/** Cadences valides (calque VALID_CADENCE :60). */
export const VALID_CADENCES = Object.freeze(['weekly', 'monthly'] as const);
/** Statuts valides (calque VALID_STATUS :61). */
export const VALID_STATUSES = Object.freeze(['active', 'paused'] as const);
/** Formats valides (calque VALID_FORMAT :62 — pdf v2 inerte). */
export const VALID_FORMATS = Object.freeze(['html'] as const);
/** Kinds valides (calque VALID_KIND :63). */
export const VALID_KINDS = Object.freeze(['activity'] as const);

/** Result type uniforme. */
export interface SchedReportValidation {
  ok: boolean;
  error?: string;
  code?: ScheduledReportsErrorCode;
  field?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// validateCronExpression — 5-field validation (m h dom mon dow).
// Pas d'aliases (@hourly, @daily, @weekly, …) ⇒ sécurité (ambiguïté tz, calque
// scheduled-reports cron Cloudflare qui n'accepte pas non plus les aliases).
// Accepte: '*', 'N', 'N-M', 'N/S', '*/S', 'A,B,C'. Ranges stricts par champ.
// ────────────────────────────────────────────────────────────────────────────

const CRON_FIELD_RANGES: Array<[number, number]> = [
  [0, 59],   // minute
  [0, 23],   // hour
  [1, 31],   // day of month
  [1, 12],   // month
  [0, 6],    // day of week (0=Sun .. 6=Sat ; 7 toléré → Sun, refusé ici pour stricter safety)
];

const CRON_FIELD_NAMES = ['minute', 'hour', 'day_of_month', 'month', 'day_of_week'];

/**
 * Valide une expression cron 5-fields (POSIX-like sans aliases).
 * Retourne { ok: true } ou { ok: false, error, code, field }.
 */
export function validateCronExpression(cron: unknown): SchedReportValidation {
  if (typeof cron !== 'string') {
    return {
      ok: false,
      error: 'Expression cron requise (string)',
      code: SCHEDULED_REPORTS_ERROR_CODES.CRON_INVALID,
    };
  }
  const expr = cron.trim();
  if (expr === '') {
    return {
      ok: false,
      error: 'Expression cron vide',
      code: SCHEDULED_REPORTS_ERROR_CODES.CRON_INVALID,
    };
  }
  // Rejet aliases (sécurité — ambiguïté tz / dépendance impl runtime).
  if (expr.startsWith('@')) {
    return {
      ok: false,
      error: 'Alias cron @ non supportés (utilise 5 champs)',
      code: SCHEDULED_REPORTS_ERROR_CODES.CRON_ALIAS_REJECTED,
    };
  }
  const fields = expr.split(/\s+/);
  if (fields.length !== 5) {
    return {
      ok: false,
      error: `Cron 5 champs requis (reçu ${fields.length})`,
      code: SCHEDULED_REPORTS_ERROR_CODES.CRON_INVALID,
    };
  }

  for (let i = 0; i < 5; i++) {
    const field = fields[i]!;
    const [lo, hi] = CRON_FIELD_RANGES[i]!;
    const res = validateCronField(field, lo, hi);
    if (!res.ok) {
      return {
        ok: false,
        error: `Champ cron invalide (${CRON_FIELD_NAMES[i]}): ${res.error}`,
        code: SCHEDULED_REPORTS_ERROR_CODES.CRON_FIELD_OUT_OF_RANGE,
        field: CRON_FIELD_NAMES[i],
      };
    }
  }
  return { ok: true };
}

/** Valide un champ cron (lo..hi inclus). Accepte *, N, N-M, N/S, asterisk/S, lists. */
function validateCronField(field: string, lo: number, hi: number): { ok: boolean; error?: string } {
  if (field === '*') return { ok: true };
  // Liste séparée par ',' — récursion par item.
  if (field.includes(',')) {
    const items = field.split(',');
    for (const it of items) {
      const r = validateCronField(it, lo, hi);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  // Pas (N/S ou */S).
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    if (!base || !step) return { ok: false, error: 'syntaxe step invalide' };
    const stepNum = parseInt(step, 10);
    if (!Number.isFinite(stepNum) || stepNum <= 0) {
      return { ok: false, error: 'step doit être un entier > 0' };
    }
    if (base !== '*') {
      const r = validateCronField(base, lo, hi);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  // Range N-M.
  if (field.includes('-')) {
    const [a, b] = field.split('-');
    const an = parseInt(a || '', 10);
    const bn = parseInt(b || '', 10);
    if (!Number.isFinite(an) || !Number.isFinite(bn)) {
      return { ok: false, error: 'range non numérique' };
    }
    if (an < lo || bn > hi || an > bn) {
      return { ok: false, error: `range hors borne [${lo}..${hi}]` };
    }
    return { ok: true };
  }
  // Valeur simple.
  const n = parseInt(field, 10);
  if (!Number.isFinite(n) || String(n) !== field.trim()) {
    return { ok: false, error: 'valeur non numérique' };
  }
  if (n < lo || n > hi) {
    return { ok: false, error: `hors borne [${lo}..${hi}]` };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// parseRecipients — accepte string CSV/semicolon/whitespace OU array.
// Retourne { emails: deduped lowercase[], invalid: string[] }.
// Calque scheduled-reports.ts:normalizeRecipients (:150) — version testable
// + retour des invalid pour observabilité (sans throw).
// ────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseRecipients(input: string | string[] | unknown): {
  emails: string[];
  invalid: string[];
} {
  let arr: unknown[] = [];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === 'string') arr = input.split(/[,;\s]+/);
  else return { emails: [], invalid: [] };

  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const item of arr) {
    const raw = item == null ? '' : String(item).trim();
    if (raw === '') continue;
    const lower = raw.toLowerCase();
    if (EMAIL_RE.test(lower)) {
      if (!seen.has(lower)) {
        seen.add(lower);
        emails.push(lower);
      }
    } else {
      invalid.push(raw);
    }
  }
  return { emails: emails.slice(0, MAX_RECIPIENTS), invalid };
}

// ────────────────────────────────────────────────────────────────────────────
// computeNextRun — parse cron basic + retourne Date prochain match.
// Limitation honnête : on couvre les patterns « routiniers » (minute fixe,
// heure fixe, dom fixe ou *, dow fixe ou *). Patterns complexes (step,
// ranges, listes) ⇒ on retombe sur next-minute-match itératif borné (1440
// itérations max = 24h). Retourne null si pattern impossible / borné dépassé.
// ────────────────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 60 * 24 * 366; // 1 an de minutes — borné dur.

export function computeNextRun(
  cron: string,
  fromDate: Date | null = null,
  _tz?: string, // tz non utilisée v1 — UTC strict (calque advanceRunAt seq 85)
): Date | null {
  const validation = validateCronExpression(cron);
  if (!validation.ok) return null;

  const fields = cron.trim().split(/\s+/);
  const matchers = fields.map((f, i) => buildCronMatcher(f, CRON_FIELD_RANGES[i]![0], CRON_FIELD_RANGES[i]![1]));

  let cursor = new Date(fromDate ? fromDate.getTime() : Date.now());
  // Avance d'une minute pour ne JAMAIS retourner le fromDate exact (next-run STRICT).
  cursor.setUTCSeconds(0, 0);
  cursor = new Date(cursor.getTime() + 60_000);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const min = cursor.getUTCMinutes();
    const hr = cursor.getUTCHours();
    const dom = cursor.getUTCDate();
    const mon = cursor.getUTCMonth() + 1;
    const dow = cursor.getUTCDay();
    if (
      matchers[0]!(min) &&
      matchers[1]!(hr) &&
      matchers[2]!(dom) &&
      matchers[3]!(mon) &&
      matchers[4]!(dow)
    ) {
      return cursor;
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }
  return null;
}

/** Construit un matcher pour un champ cron déjà validé. */
function buildCronMatcher(field: string, lo: number, hi: number): (n: number) => boolean {
  if (field === '*') return () => true;
  const allowed = expandCronField(field, lo, hi);
  return (n: number) => allowed.has(n);
}

/** Expand un champ cron déjà validé en Set<number>. */
function expandCronField(field: string, lo: number, hi: number): Set<number> {
  const out = new Set<number>();
  if (field.includes(',')) {
    for (const it of field.split(',')) {
      for (const n of expandCronField(it, lo, hi)) out.add(n);
    }
    return out;
  }
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    const s = parseInt(step!, 10);
    let a = lo, b = hi;
    if (base !== '*') {
      if (base!.includes('-')) {
        const [x, y] = base!.split('-');
        a = parseInt(x!, 10);
        b = parseInt(y!, 10);
      } else {
        a = parseInt(base!, 10);
      }
    }
    for (let n = a; n <= b; n += s) out.add(n);
    return out;
  }
  if (field.includes('-')) {
    const [a, b] = field.split('-');
    const an = parseInt(a!, 10);
    const bn = parseInt(b!, 10);
    for (let n = an; n <= bn; n++) out.add(n);
    return out;
  }
  out.add(parseInt(field, 10));
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// validateReportInput — valide un payload de création/update.
// ────────────────────────────────────────────────────────────────────────────

export interface ReportInput {
  name?: unknown;
  cadence?: unknown;
  format?: unknown;
  report_kind?: unknown;
  day_of_week?: unknown;
  day_of_month?: unknown;
  recipients?: unknown;
}

export function validateReportInput(input: ReportInput): SchedReportValidation {
  if (input.name != null) {
    const nameStr = String(input.name);
    if (nameStr.length > MAX_NAME_LENGTH * 4) {
      // Garde-fou très large (l'handler slice(120)) mais on flag les vraies abus.
      return {
        ok: false,
        error: `Nom trop long (${nameStr.length} > ${MAX_NAME_LENGTH * 4})`,
        code: SCHEDULED_REPORTS_ERROR_CODES.NAME_TOO_LONG,
        field: 'name',
      };
    }
  }
  if (input.cadence != null && !VALID_CADENCES.includes(String(input.cadence) as never)) {
    return {
      ok: false,
      error: `Cadence invalide (attendu: ${VALID_CADENCES.join('|')})`,
      code: SCHEDULED_REPORTS_ERROR_CODES.CADENCE_INVALID,
      field: 'cadence',
    };
  }
  if (input.format != null && !VALID_FORMATS.includes(String(input.format) as never)) {
    return {
      ok: false,
      error: `Format invalide (attendu: ${VALID_FORMATS.join('|')})`,
      code: SCHEDULED_REPORTS_ERROR_CODES.FORMAT_INVALID,
      field: 'format',
    };
  }
  if (input.report_kind != null && !VALID_KINDS.includes(String(input.report_kind) as never)) {
    return {
      ok: false,
      error: `Kind invalide (attendu: ${VALID_KINDS.join('|')})`,
      code: SCHEDULED_REPORTS_ERROR_CODES.KIND_INVALID,
      field: 'report_kind',
    };
  }
  if (input.day_of_week != null) {
    const n = Number(input.day_of_week);
    if (!Number.isFinite(n) || n < 0 || n > 6) {
      return {
        ok: false,
        error: 'day_of_week hors borne [0..6]',
        code: SCHEDULED_REPORTS_ERROR_CODES.DAY_OF_WEEK_OUT_OF_RANGE,
        field: 'day_of_week',
      };
    }
  }
  if (input.day_of_month != null) {
    const n = Number(input.day_of_month);
    if (!Number.isFinite(n) || n < 1 || n > 28) {
      return {
        ok: false,
        error: 'day_of_month hors borne [1..28]',
        code: SCHEDULED_REPORTS_ERROR_CODES.DAY_OF_MONTH_OUT_OF_RANGE,
        field: 'day_of_month',
      };
    }
  }
  if (input.recipients !== undefined) {
    const parsed = parseRecipients(input.recipients as never);
    if (parsed.emails.length === 0) {
      return {
        ok: false,
        error: 'Au moins un destinataire valide est requis',
        code: SCHEDULED_REPORTS_ERROR_CODES.RECIPIENTS_EMPTY,
        field: 'recipients',
      };
    }
    if (Array.isArray(input.recipients) && input.recipients.length > MAX_RECIPIENTS * 2) {
      // Le slice(MAX_RECIPIENTS) cap silencieusement, mais on flag les abus.
      return {
        ok: false,
        error: `Trop de destinataires (${input.recipients.length} > ${MAX_RECIPIENTS * 2})`,
        code: SCHEDULED_REPORTS_ERROR_CODES.RECIPIENTS_TOO_MANY,
        field: 'recipients',
      };
    }
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// renderReportHtml — template XSS-safe pour email digest.
// Calque buildActivityDigestHtml/buildDashboardDigestHtml — extraction PURE
// pour réutilisation + testabilité. Pas d'images externes, inline styles only.
// ────────────────────────────────────────────────────────────────────────────

export interface ReportSection {
  title: string;
  rows: Array<{ label: string; value: string | number }>;
}

export interface RenderReportInput {
  title: string;
  subtitle?: string;
  sections: ReportSection[];
  footer?: string;
}

/** Échappe un texte pour insertion HTML email-safe (anti-XSS minimal). */
export function escHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderReportHtml(input: RenderReportInput): string {
  const title = escHtml(input.title);
  const subtitle = input.subtitle ? escHtml(input.subtitle) : '';
  const footer = escHtml(input.footer || 'Rapport automatique envoyé par Intralys.');

  const sectionsHtml = (input.sections || [])
    .map((sec) => {
      const rowsHtml = (sec.rows || [])
        .map(
          (r) =>
            `<tr>` +
            `<td style="padding:10px 0;border-bottom:1px solid #eef0f4;color:#475569;font-size:14px;">${escHtml(r.label)}</td>` +
            `<td style="padding:10px 0;border-bottom:1px solid #eef0f4;color:#0f172a;font-size:18px;font-weight:600;text-align:right;">${escHtml(r.value)}</td>` +
            `</tr>`,
        )
        .join('');
      const secTitle = sec.title
        ? `<h2 style="margin:16px 0 8px;font-size:14px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.5px;">${escHtml(sec.title)}</h2>`
        : '';
      return (
        secTitle +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rowsHtml}</table>`
      );
    })
    .join('');

  return (
    `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">` +
    `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">` +
    `<div style="padding:24px 24px 8px;">` +
    `<h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f172a;">${title}</h1>` +
    (subtitle
      ? `<p style="margin:0;font-size:13px;color:#64748b;">${subtitle}</p>`
      : '') +
    `</div>` +
    `<div style="padding:8px 24px 24px;">${sectionsHtml}</div>` +
    `<div style="padding:16px 24px;background:#f8fafc;border-top:1px solid #eef0f4;">` +
    `<p style="margin:0;font-size:12px;color:#94a3b8;">${footer}</p>` +
    `</div>` +
    `</div></div></body></html>`
  );
}
