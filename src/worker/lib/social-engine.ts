// ── social-engine.ts — helpers PURS pour LOT SOCIAL (Integrations P2-4) ────
//
// Engine helpers RENFORCEMENT pour social-accounts.ts + social-publish.ts.
// ZÉRO I/O DB / réseau. Toutes les fonctions sont déterministes et testables.
//
// Périmètre :
//   - Whitelist providers sociaux (facebook | instagram | linkedin | twitter |
//     google_business).
//   - Limites de caractères par provider (FB 63206, IG 2200, LinkedIn 3000,
//     Twitter 280, Google Business 1500).
//   - Validation d'un input de publication (content, providers, media,
//     scheduledAt).
//   - Validation longueur post per provider (avec flag truncated).
//   - Validation pièces jointes médias (count + mime per provider).
//   - Calcul de la date planifiée (parsing ISO + futur).
//
// 100% additif : social-accounts.ts / social-publish.ts continuent de
// fonctionner sans cet engine.

// ── Codes d'erreur stables ──────────────────────────────────────────────────
export const SOCIAL_ERROR_CODES = Object.freeze({
  PROVIDER_INVALID: 'social.provider.invalid',
  PROVIDERS_EMPTY: 'social.providers.empty',
  PROVIDERS_TOO_MANY: 'social.providers.too_many',
  CONTENT_EMPTY: 'social.content.empty',
  CONTENT_TOO_LONG: 'social.content.too_long',
  MEDIA_TOO_MANY: 'social.media.too_many',
  MEDIA_MIME_INVALID: 'social.media.mime_invalid',
  MEDIA_SIZE_INVALID: 'social.media.size_invalid',
  SCHEDULED_AT_INVALID: 'social.scheduled_at.invalid',
  SCHEDULED_AT_PAST: 'social.scheduled_at.past',
} as const);

// ── Whitelist providers sociaux ────────────────────────────────────────────
// Aligne sur src/lib/types:SocialProvider mais ajoute twitter (P2-4).
export const VALID_SOCIAL_PROVIDERS = Object.freeze([
  'facebook',
  'instagram',
  'linkedin',
  'twitter',
  'google_business',
] as const);
export type SocialProviderName = (typeof VALID_SOCIAL_PROVIDERS)[number];

export const MAX_PROVIDERS_PER_POST = 8;

// ── Limites de caractères par provider (sources officielles 2024-2025) ────
export const MAX_LENGTH_PER_PROVIDER: Readonly<Record<SocialProviderName, number>> = Object.freeze({
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  twitter: 280,
  google_business: 1500,
});

// ── Limites de médias par provider ─────────────────────────────────────────
export const MAX_MEDIA_PER_PROVIDER: Readonly<Record<SocialProviderName, number>> = Object.freeze({
  facebook: 10,
  instagram: 10, // carousel max
  linkedin: 9,
  twitter: 4,
  google_business: 10,
});

// MIME acceptés par provider (image + vidéo).
// On reste large : la validation fine (codec, ratio) revient au provider lui-même.
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

export const ALLOWED_MIMES_PER_PROVIDER: Readonly<Record<SocialProviderName, readonly string[]>> =
  Object.freeze({
    facebook: [...IMAGE_MIMES, ...VIDEO_MIMES],
    instagram: [...IMAGE_MIMES, ...VIDEO_MIMES],
    linkedin: [...IMAGE_MIMES, ...VIDEO_MIMES],
    twitter: [...IMAGE_MIMES, 'video/mp4'],
    google_business: [...IMAGE_MIMES, 'video/mp4'],
  });

// Taille max par média (en octets) — heuristique conservatrice cross-provider.
export const MAX_MEDIA_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

// ── Validation provider ────────────────────────────────────────────────────
export function validateSocialProvider(p: unknown): p is SocialProviderName {
  if (typeof p !== 'string') return false;
  return (VALID_SOCIAL_PROVIDERS as readonly string[]).includes(p);
}

// ── Validation longueur post per provider ──────────────────────────────────
export interface PostLengthResult {
  ok: boolean;
  truncated?: boolean;
  error?: string;
  maxLength?: number;
  actualLength?: number;
}
export function validatePostLength(
  content: unknown,
  provider: unknown,
): PostLengthResult {
  if (typeof content !== 'string' || content.length === 0) {
    return { ok: false, error: SOCIAL_ERROR_CODES.CONTENT_EMPTY };
  }
  if (!validateSocialProvider(provider)) {
    return { ok: false, error: SOCIAL_ERROR_CODES.PROVIDER_INVALID };
  }
  const max = MAX_LENGTH_PER_PROVIDER[provider];
  // Mesure en code points Unicode (grapheme proxy via Array spread) — plus
  // proche du comptage Twitter/IG que .length (qui compte les surrogates).
  const actual = [...content].length;
  if (actual > max) {
    return {
      ok: false,
      truncated: true,
      error: SOCIAL_ERROR_CODES.CONTENT_TOO_LONG,
      maxLength: max,
      actualLength: actual,
    };
  }
  return { ok: true, maxLength: max, actualLength: actual };
}

// ── Validation pièces jointes médias ───────────────────────────────────────
export interface MediaAttachment {
  url?: string;
  mime?: string;
  size?: number;
}
export interface MediaValidationResult {
  ok: boolean;
  error?: string;
  invalidIndex?: number;
}
export function validateMediaAttachments(
  media: unknown,
  provider: unknown,
): MediaValidationResult {
  if (!validateSocialProvider(provider)) {
    return { ok: false, error: SOCIAL_ERROR_CODES.PROVIDER_INVALID };
  }
  if (media == null) return { ok: true };
  if (!Array.isArray(media)) {
    return { ok: false, error: SOCIAL_ERROR_CODES.MEDIA_MIME_INVALID };
  }
  const max = MAX_MEDIA_PER_PROVIDER[provider];
  if (media.length > max) {
    return { ok: false, error: SOCIAL_ERROR_CODES.MEDIA_TOO_MANY };
  }
  const allowed = ALLOWED_MIMES_PER_PROVIDER[provider];
  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    if (!m || typeof m !== 'object') {
      return { ok: false, error: SOCIAL_ERROR_CODES.MEDIA_MIME_INVALID, invalidIndex: i };
    }
    const mm = m as MediaAttachment;
    if (typeof mm.mime !== 'string' || !allowed.includes(mm.mime)) {
      return { ok: false, error: SOCIAL_ERROR_CODES.MEDIA_MIME_INVALID, invalidIndex: i };
    }
    if (typeof mm.size === 'number') {
      if (mm.size <= 0 || mm.size > MAX_MEDIA_SIZE_BYTES) {
        return { ok: false, error: SOCIAL_ERROR_CODES.MEDIA_SIZE_INVALID, invalidIndex: i };
      }
    }
  }
  return { ok: true };
}

// ── Calcul de la date planifiée ────────────────────────────────────────────
// Retourne :
//   - Date dans le futur si parsing OK + > now
//   - null si input absent (post immédiat)
// Lève PAS : on retourne null en cas de string invalide (caller décide).
export function computeScheduledDate(
  input: { scheduledAt?: unknown } | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!input || input.scheduledAt == null) return null;
  const raw = input.scheduledAt;
  let d: Date;
  if (raw instanceof Date) {
    d = raw;
  } else if (typeof raw === 'number') {
    d = new Date(raw);
  } else if (typeof raw === 'string' && raw.length > 0) {
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return null;
    d = new Date(parsed);
  } else {
    return null;
  }
  if (Number.isNaN(d.getTime())) return null;
  // Tolérance 60s sur "passé" pour les clock drifts (calque webhook signature).
  if (d.getTime() <= now.getTime() - 60_000) return null;
  return d;
}

// ── Validation complète d'un input de publication ──────────────────────────
export interface PostInput {
  content?: unknown;
  providers?: unknown;
  media?: unknown;
  scheduledAt?: unknown;
}
export interface PostInputResult {
  ok: boolean;
  error?: string;
  field?: string;
}
export function validatePostInput(
  input: unknown,
  now: Date = new Date(),
): PostInputResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: SOCIAL_ERROR_CODES.CONTENT_EMPTY, field: 'content' };
  }
  const i = input as PostInput;

  // content
  if (typeof i.content !== 'string' || i.content.trim().length === 0) {
    return { ok: false, error: SOCIAL_ERROR_CODES.CONTENT_EMPTY, field: 'content' };
  }

  // providers
  if (!Array.isArray(i.providers) || i.providers.length === 0) {
    return { ok: false, error: SOCIAL_ERROR_CODES.PROVIDERS_EMPTY, field: 'providers' };
  }
  if (i.providers.length > MAX_PROVIDERS_PER_POST) {
    return { ok: false, error: SOCIAL_ERROR_CODES.PROVIDERS_TOO_MANY, field: 'providers' };
  }
  for (const p of i.providers) {
    if (!validateSocialProvider(p)) {
      return { ok: false, error: SOCIAL_ERROR_CODES.PROVIDER_INVALID, field: 'providers' };
    }
    // Longueur par provider (le contenu doit tenir dans la limite du plus
    // strict — sinon on flag, le caller peut tronquer ou refuser).
    const lenRes = validatePostLength(i.content, p);
    if (!lenRes.ok) {
      return { ok: false, error: lenRes.error, field: 'content' };
    }
    // Médias par provider
    if (i.media !== undefined) {
      const mediaRes = validateMediaAttachments(i.media, p);
      if (!mediaRes.ok) {
        return { ok: false, error: mediaRes.error, field: 'media' };
      }
    }
  }

  // scheduledAt (optionnel)
  if (i.scheduledAt !== undefined && i.scheduledAt !== null && i.scheduledAt !== '') {
    const sd = computeScheduledDate({ scheduledAt: i.scheduledAt }, now);
    if (sd === null) {
      return { ok: false, error: SOCIAL_ERROR_CODES.SCHEDULED_AT_INVALID, field: 'scheduledAt' };
    }
  }

  return { ok: true };
}
