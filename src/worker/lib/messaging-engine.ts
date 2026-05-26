// ── lib/messaging-engine.ts — Core CRM P0-3 (renforcement messages.ts) ──────
//
// Helpers PURS (zéro I/O, zéro D1, zéro fetch, pas de Resend / Twilio /
// Meta) extraits/dérivés de messages.ts pour rendre la validation des
// messages, des canaux, des attachements et la sanitization XSS testable
// indépendamment du runtime Worker. Tout est additif : messages.ts continue
// à fonctionner avec son comportement actuel.
//
// CONTENU :
//   - MESSAGE_ERROR_CODES        codes erreur stables
//   - MESSAGE_VALID_CHANNELS     enum frozen (email, sms, whatsapp, chat,
//                                 webchat, internal_note, facebook,
//                                 instagram, facebook_messenger, instagram_dm)
//   - MESSAGE_VALID_DIRECTIONS   enum frozen ('inbound' | 'outbound')
//   - MESSAGE_BODY_MAX_LEN       10 000 (cap dur — calque sanitizeInput)
//   - MESSAGE_SMS_BODY_MAX_LEN   1 600 (cap SMS Twilio — 10 segments)
//   - MESSAGE_SUBJECT_MAX_LEN    500
//   - ATTACHMENT_MAX_SIZE_BYTES  10 MB
//   - ATTACHMENT_MAX_COUNT       10
//   - ATTACHMENT_ALLOWED_MIME    whitelist (img/pdf/doc/audio)
//   - isValidChannel             guard rapide
//   - isValidDirection           guard rapide
//   - sanitizeBody               strip XSS basique (script/iframe/event handlers
//                                 + javascript: URLs)
//   - validateMessageInput       orchestre validation pré-INSERT
//   - validateAttachments        validation list attachments (size + mime)
//   - computeMessageBodyCapForChannel cap dynamique selon canal
//
// AUCUNE dépendance Worker (Env, D1, fetch) → 100 % unit-testable.

// ════════════════════════════════════════════════════════════
//  CODES ERREUR STABLES
// ════════════════════════════════════════════════════════════

export const MESSAGE_ERROR_CODES = {
  MESSAGE_NOT_FOUND: 'message_not_found',
  INVALID_CHANNEL: 'invalid_channel',
  INVALID_DIRECTION: 'invalid_direction',
  INVALID_BODY: 'invalid_body',
  BODY_TOO_LONG: 'body_too_long',
  SUBJECT_TOO_LONG: 'subject_too_long',
  EMPTY_BODY: 'empty_body',
  INVALID_ATTACHMENT: 'invalid_attachment',
  ATTACHMENT_TOO_LARGE: 'attachment_too_large',
  TOO_MANY_ATTACHMENTS: 'too_many_attachments',
  UNSUPPORTED_MIME: 'unsupported_mime',
  DND_BLOCKED: 'dnd_blocked',
  UNSUBSCRIBED: 'unsubscribed',
} as const;

export type MessageErrorCode =
  (typeof MESSAGE_ERROR_CODES)[keyof typeof MESSAGE_ERROR_CODES];

// ════════════════════════════════════════════════════════════
//  ENUMS FROZEN
// ════════════════════════════════════════════════════════════

export const MESSAGE_VALID_CHANNELS = Object.freeze([
  'email',
  'sms',
  'whatsapp',
  'chat',
  'webchat',
  'internal_note',
  'facebook',
  'instagram',
  'facebook_messenger',
  'instagram_dm',
] as const);
export type MessageChannel = (typeof MESSAGE_VALID_CHANNELS)[number];

export const MESSAGE_VALID_DIRECTIONS = Object.freeze([
  'inbound',
  'outbound',
] as const);
export type MessageDirection = (typeof MESSAGE_VALID_DIRECTIONS)[number];

// ════════════════════════════════════════════════════════════
//  CAPS / LIMITES
// ════════════════════════════════════════════════════════════

export const MESSAGE_BODY_MAX_LEN = 10000 as const;
export const MESSAGE_SMS_BODY_MAX_LEN = 1600 as const;
export const MESSAGE_SUBJECT_MAX_LEN = 500 as const;

export const ATTACHMENT_MAX_SIZE_BYTES: number = 10 * 1024 * 1024; // 10 MB
export const ATTACHMENT_MAX_COUNT = 10 as const;

/**
 * Whitelist MIME conservatrice pour pièces jointes : images, PDF, docs
 * Office, audio voicenote, plain text. Refuse explicitement les
 * exécutables, archives non-zip, scripts.
 */
export const ATTACHMENT_ALLOWED_MIME = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'text/plain',
  'text/csv',
] as const);

// ════════════════════════════════════════════════════════════
//  GUARDS RAPIDES
// ════════════════════════════════════════════════════════════

export function isValidChannel(c: unknown): c is MessageChannel {
  return (
    typeof c === 'string' &&
    (MESSAGE_VALID_CHANNELS as readonly string[]).includes(c)
  );
}

export function isValidDirection(d: unknown): d is MessageDirection {
  return (
    typeof d === 'string' &&
    (MESSAGE_VALID_DIRECTIONS as readonly string[]).includes(d)
  );
}

// ════════════════════════════════════════════════════════════
//  XSS SANITIZE
// ════════════════════════════════════════════════════════════

/**
 * Strip XSS basique pour body de messages. Retire :
 *   - balises <script>…</script> (greedy, multiline)
 *   - balises <iframe>…</iframe>
 *   - balises <object>, <embed>, <link>, <style>
 *   - event handlers inline (onclick=, onerror=, onload=, on*=)
 *   - URLs javascript: et data:text/html
 *
 * NE remplace PAS DOMPurify côté front pour rendu HTML, mais sécurise le
 * stockage côté worker (un email-template ou note interne ne doit jamais
 * contenir de <script>).
 */
export function sanitizeBody(input: unknown): string {
  if (typeof input !== 'string') return '';
  let s = input;
  // Balises dangereuses (greedy, dotAll-like via [\s\S])
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '');
  s = s.replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, '');
  s = s.replace(/<embed\b[^>]*\/?>/gi, '');
  s = s.replace(/<link\b[^>]*\/?>/gi, '');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  // Self-closing dangereux
  s = s.replace(/<script\b[^>]*\/?>/gi, '');
  s = s.replace(/<iframe\b[^>]*\/?>/gi, '');
  // Event handlers inline (onclick=, onerror=, …)
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // URLs javascript: + data:text/html
  s = s.replace(/javascript\s*:/gi, '');
  s = s.replace(/data\s*:\s*text\/html/gi, '');
  return s;
}

// ════════════════════════════════════════════════════════════
//  BODY CAP PAR CANAL
// ════════════════════════════════════════════════════════════

/**
 * Renvoie le cap body applicable selon le canal. SMS = 1600 (cap Twilio
 * 10 segments). Tout autre canal email/chat/note = 10 000.
 */
export function computeMessageBodyCapForChannel(channel: unknown): number {
  if (channel === 'sms' || channel === 'whatsapp') {
    return MESSAGE_SMS_BODY_MAX_LEN;
  }
  return MESSAGE_BODY_MAX_LEN;
}

// ════════════════════════════════════════════════════════════
//  VALIDATE MESSAGE INPUT
// ════════════════════════════════════════════════════════════

export interface MessageInput {
  channel?: unknown;
  body?: unknown;
  subject?: unknown;
  direction?: unknown;
}

export interface ValidateMessageResult {
  ok: boolean;
  error?: MessageErrorCode;
  message?: string;
  // Champs normalisés (présents si ok)
  channel?: MessageChannel;
  body?: string;
  subject?: string;
  direction?: MessageDirection;
}

/**
 * Valide + normalise un input message pré-INSERT :
 *   - channel obligatoire, whitelisted
 *   - body obligatoire non-vide, capped + sanitized XSS
 *   - subject optionnel, capped à 500
 *   - direction optionnelle, défaut 'outbound', whitelistée
 *
 * Retourne les valeurs normalisées prêtes à INSERT.
 */
export function validateMessageInput(
  input: MessageInput,
): ValidateMessageResult {
  if (!isValidChannel(input.channel)) {
    return {
      ok: false,
      error: MESSAGE_ERROR_CODES.INVALID_CHANNEL,
      message: `channel must be one of: ${MESSAGE_VALID_CHANNELS.join(', ')}`,
    };
  }
  const channel = input.channel as MessageChannel;

  if (typeof input.body !== 'string') {
    return {
      ok: false,
      error: MESSAGE_ERROR_CODES.INVALID_BODY,
      message: 'body must be a string',
    };
  }
  const sanitized = sanitizeBody(input.body).trim();
  if (!sanitized) {
    return {
      ok: false,
      error: MESSAGE_ERROR_CODES.EMPTY_BODY,
      message: 'body is empty after sanitization',
    };
  }
  const cap = computeMessageBodyCapForChannel(channel);
  if (sanitized.length > cap) {
    return {
      ok: false,
      error: MESSAGE_ERROR_CODES.BODY_TOO_LONG,
      message: `body exceeds ${cap} chars for channel ${channel}`,
    };
  }

  let subject: string | undefined;
  if (input.subject !== undefined && input.subject !== null && input.subject !== '') {
    if (typeof input.subject !== 'string') {
      return {
        ok: false,
        error: MESSAGE_ERROR_CODES.SUBJECT_TOO_LONG,
        message: 'subject must be a string',
      };
    }
    if (input.subject.length > MESSAGE_SUBJECT_MAX_LEN) {
      return {
        ok: false,
        error: MESSAGE_ERROR_CODES.SUBJECT_TOO_LONG,
        message: `subject exceeds ${MESSAGE_SUBJECT_MAX_LEN} chars`,
      };
    }
    subject = input.subject;
  }

  let direction: MessageDirection = 'outbound';
  if (input.direction !== undefined && input.direction !== null) {
    if (!isValidDirection(input.direction)) {
      return {
        ok: false,
        error: MESSAGE_ERROR_CODES.INVALID_DIRECTION,
        message: 'direction must be inbound or outbound',
      };
    }
    direction = input.direction as MessageDirection;
  }

  return {
    ok: true,
    channel,
    body: sanitized,
    subject,
    direction,
  };
}

// ════════════════════════════════════════════════════════════
//  VALIDATE ATTACHMENTS
// ════════════════════════════════════════════════════════════

export interface AttachmentLike {
  filename?: unknown;
  mime?: unknown;
  size?: unknown;
  url?: unknown;
}

export interface ValidateAttachmentsResult {
  ok: boolean;
  error?: MessageErrorCode;
  message?: string;
  count?: number;
}

/**
 * Valide une liste d'attachements pour un message :
 *   - count ≤ ATTACHMENT_MAX_COUNT (10)
 *   - chaque attachement : mime ∈ whitelist, size ≤ 10 MB, size > 0
 *   - filename optionnel mais si présent, doit être string non-vide
 *
 * NE valide PAS la signature binaire (le worker ne lit pas le fichier ici)
 * — la confiance est sur l'uploader (R2 / S3 presigned + content-type
 * vérifié côté ingestion).
 */
export function validateAttachments(
  attachments: unknown,
): ValidateAttachmentsResult {
  if (attachments === undefined || attachments === null) {
    return { ok: true, count: 0 };
  }
  if (!Array.isArray(attachments)) {
    return {
      ok: false,
      error: MESSAGE_ERROR_CODES.INVALID_ATTACHMENT,
      message: 'attachments must be an array',
    };
  }
  if (attachments.length === 0) return { ok: true, count: 0 };
  if (attachments.length > ATTACHMENT_MAX_COUNT) {
    return {
      ok: false,
      error: MESSAGE_ERROR_CODES.TOO_MANY_ATTACHMENTS,
      message: `max ${ATTACHMENT_MAX_COUNT} attachments per message`,
    };
  }
  for (const a of attachments as AttachmentLike[]) {
    if (!a || typeof a !== 'object') {
      return {
        ok: false,
        error: MESSAGE_ERROR_CODES.INVALID_ATTACHMENT,
        message: 'attachment must be an object',
      };
    }
    if (typeof a.mime !== 'string' || !a.mime) {
      return {
        ok: false,
        error: MESSAGE_ERROR_CODES.INVALID_ATTACHMENT,
        message: 'attachment.mime required',
      };
    }
    if (!(ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(a.mime)) {
      return {
        ok: false,
        error: MESSAGE_ERROR_CODES.UNSUPPORTED_MIME,
        message: `mime ${a.mime} not allowed`,
      };
    }
    if (typeof a.size !== 'number' || !Number.isFinite(a.size)) {
      return {
        ok: false,
        error: MESSAGE_ERROR_CODES.INVALID_ATTACHMENT,
        message: 'attachment.size must be a finite number',
      };
    }
    if (a.size <= 0) {
      return {
        ok: false,
        error: MESSAGE_ERROR_CODES.INVALID_ATTACHMENT,
        message: 'attachment.size must be > 0',
      };
    }
    if (a.size > ATTACHMENT_MAX_SIZE_BYTES) {
      return {
        ok: false,
        error: MESSAGE_ERROR_CODES.ATTACHMENT_TOO_LARGE,
        message: `attachment exceeds ${ATTACHMENT_MAX_SIZE_BYTES} bytes`,
      };
    }
    if (a.filename !== undefined && a.filename !== null) {
      if (typeof a.filename !== 'string' || !a.filename.trim()) {
        return {
          ok: false,
          error: MESSAGE_ERROR_CODES.INVALID_ATTACHMENT,
          message: 'attachment.filename must be a non-empty string',
        };
      }
    }
  }
  return { ok: true, count: attachments.length };
}
