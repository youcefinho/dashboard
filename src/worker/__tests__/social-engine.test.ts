// ── Tests src/worker/lib/social-engine.ts — LOT SOCIAL (Integrations P2-4) ─
// Helpers PURS : whitelist providers, max length per channel, validation
// pièces jointes, scheduledAt. ZÉRO I/O.
import { describe, it, expect } from 'vitest';
import {
  SOCIAL_ERROR_CODES,
  VALID_SOCIAL_PROVIDERS,
  MAX_LENGTH_PER_PROVIDER,
  MAX_MEDIA_PER_PROVIDER,
  validateSocialProvider,
  validatePostLength,
  validateMediaAttachments,
  computeScheduledDate,
  validatePostInput,
  MAX_PROVIDERS_PER_POST,
  MAX_MEDIA_SIZE_BYTES,
} from '../lib/social-engine';

describe('SOCIAL_ERROR_CODES + VALID_SOCIAL_PROVIDERS — frozen', () => {
  it('expose des codes stables', () => {
    expect(SOCIAL_ERROR_CODES.CONTENT_TOO_LONG).toBe('social.content.too_long');
    expect(Object.isFrozen(SOCIAL_ERROR_CODES)).toBe(true);
  });

  it('expose une whitelist providers frozen', () => {
    expect(VALID_SOCIAL_PROVIDERS).toEqual([
      'facebook', 'instagram', 'linkedin', 'twitter', 'google_business',
    ]);
    expect(Object.isFrozen(VALID_SOCIAL_PROVIDERS)).toBe(true);
  });

  it('expose les limites par provider conformes aux specs publiques', () => {
    expect(MAX_LENGTH_PER_PROVIDER.facebook).toBe(63206);
    expect(MAX_LENGTH_PER_PROVIDER.instagram).toBe(2200);
    expect(MAX_LENGTH_PER_PROVIDER.linkedin).toBe(3000);
    expect(MAX_LENGTH_PER_PROVIDER.twitter).toBe(280);
    expect(MAX_LENGTH_PER_PROVIDER.google_business).toBe(1500);
    expect(Object.isFrozen(MAX_LENGTH_PER_PROVIDER)).toBe(true);
  });
});

describe('validateSocialProvider', () => {
  it('accepte les 5 providers whitelistés', () => {
    expect(validateSocialProvider('facebook')).toBe(true);
    expect(validateSocialProvider('instagram')).toBe(true);
    expect(validateSocialProvider('linkedin')).toBe(true);
    expect(validateSocialProvider('twitter')).toBe(true);
    expect(validateSocialProvider('google_business')).toBe(true);
  });

  it('refuse les providers non supportés', () => {
    expect(validateSocialProvider('tiktok')).toBe(false);
    expect(validateSocialProvider('snapchat')).toBe(false);
  });

  it('refuse les non-strings', () => {
    expect(validateSocialProvider(null)).toBe(false);
    expect(validateSocialProvider(undefined)).toBe(false);
  });
});

describe('validatePostLength — par provider', () => {
  it('accepte un post court sur tous les providers', () => {
    for (const p of VALID_SOCIAL_PROVIDERS) {
      expect(validatePostLength('hello', p).ok).toBe(true);
    }
  });

  it('refuse un post de 281 chars sur Twitter', () => {
    const r = validatePostLength('a'.repeat(281), 'twitter');
    expect(r.ok).toBe(false);
    expect(r.truncated).toBe(true);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.CONTENT_TOO_LONG);
    expect(r.actualLength).toBe(281);
    expect(r.maxLength).toBe(280);
  });

  it('accepte 280 chars sur Twitter (boundary)', () => {
    const r = validatePostLength('a'.repeat(280), 'twitter');
    expect(r.ok).toBe(true);
  });

  it('refuse un post de 2201 chars sur Instagram', () => {
    expect(validatePostLength('a'.repeat(2201), 'instagram').ok).toBe(false);
  });

  it('refuse content vide', () => {
    const r = validatePostLength('', 'facebook');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.CONTENT_EMPTY);
  });

  it('refuse provider invalide', () => {
    const r = validatePostLength('hi', 'unknown' as never);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.PROVIDER_INVALID);
  });

  it('mesure les emojis en code points (proxy grapheme)', () => {
    // Un emoji = 2 UTF-16 surrogates mais 1 code point
    const post = '🎉'.repeat(280);
    const r = validatePostLength(post, 'twitter');
    expect(r.actualLength).toBe(280);
    expect(r.ok).toBe(true);
  });
});

describe('validateMediaAttachments — count + mime per provider', () => {
  it('accepte aucun media (optionnel)', () => {
    expect(validateMediaAttachments(undefined, 'facebook').ok).toBe(true);
    expect(validateMediaAttachments(null, 'facebook').ok).toBe(true);
  });

  it('accepte un media valide', () => {
    const r = validateMediaAttachments(
      [{ url: 'https://cdn/x.jpg', mime: 'image/jpeg', size: 1024 }],
      'facebook',
    );
    expect(r.ok).toBe(true);
  });

  it('refuse media non-array', () => {
    const r = validateMediaAttachments({ mime: 'image/jpeg' }, 'facebook');
    expect(r.ok).toBe(false);
  });

  it('refuse trop de medias sur Twitter (>4)', () => {
    const media = Array.from({ length: 5 }, () => ({
      mime: 'image/jpeg', size: 1024,
    }));
    const r = validateMediaAttachments(media, 'twitter');
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.MEDIA_TOO_MANY);
  });

  it('accepte 4 medias sur Twitter (boundary)', () => {
    const media = Array.from({ length: 4 }, () => ({
      mime: 'image/jpeg', size: 1024,
    }));
    expect(validateMediaAttachments(media, 'twitter').ok).toBe(true);
  });

  it('refuse mime non whitelisté par provider', () => {
    const r = validateMediaAttachments(
      [{ mime: 'video/webm' }],
      'twitter', // twitter n'accepte pas video/webm
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.MEDIA_MIME_INVALID);
    expect(r.invalidIndex).toBe(0);
  });

  it('refuse une taille > 100MB', () => {
    const r = validateMediaAttachments(
      [{ mime: 'image/jpeg', size: MAX_MEDIA_SIZE_BYTES + 1 }],
      'facebook',
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.MEDIA_SIZE_INVALID);
  });

  it('refuse une taille <= 0', () => {
    expect(
      validateMediaAttachments([{ mime: 'image/jpeg', size: 0 }], 'facebook').ok,
    ).toBe(false);
  });

  it('expose une limite per provider', () => {
    expect(MAX_MEDIA_PER_PROVIDER.twitter).toBe(4);
    expect(MAX_MEDIA_PER_PROVIDER.facebook).toBe(10);
  });
});

describe('computeScheduledDate', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('renvoie null si scheduledAt absent', () => {
    expect(computeScheduledDate({}, now)).toBeNull();
    expect(computeScheduledDate(null, now)).toBeNull();
  });

  it('accepte une Date dans le futur', () => {
    const future = new Date('2026-01-01T13:00:00Z');
    expect(computeScheduledDate({ scheduledAt: future }, now)).toEqual(future);
  });

  it('accepte une ISO string dans le futur', () => {
    const r = computeScheduledDate({ scheduledAt: '2026-01-01T13:00:00Z' }, now);
    expect(r).not.toBeNull();
    expect(r!.toISOString()).toBe('2026-01-01T13:00:00.000Z');
  });

  it('accepte un epoch ms', () => {
    const r = computeScheduledDate({ scheduledAt: now.getTime() + 3600_000 }, now);
    expect(r).not.toBeNull();
  });

  it('renvoie null pour date dans le passé (au-delà de la tolérance 60s)', () => {
    const past = new Date('2026-01-01T11:00:00Z');
    expect(computeScheduledDate({ scheduledAt: past }, now)).toBeNull();
  });

  it('renvoie null pour string invalide', () => {
    expect(computeScheduledDate({ scheduledAt: 'not-a-date' }, now)).toBeNull();
  });
});

describe('validatePostInput — input complet', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('accepte un input minimal valide', () => {
    const r = validatePostInput(
      { content: 'hello', providers: ['twitter'] },
      now,
    );
    expect(r.ok).toBe(true);
  });

  it('refuse content vide', () => {
    const r = validatePostInput({ content: '', providers: ['twitter'] }, now);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.CONTENT_EMPTY);
  });

  it('refuse providers vide', () => {
    const r = validatePostInput({ content: 'hi', providers: [] }, now);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.PROVIDERS_EMPTY);
  });

  it('refuse trop de providers', () => {
    const r = validatePostInput(
      {
        content: 'hi',
        providers: Array.from(
          { length: MAX_PROVIDERS_PER_POST + 1 },
          () => 'twitter',
        ),
      },
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.PROVIDERS_TOO_MANY);
  });

  it('refuse un provider invalide', () => {
    const r = validatePostInput(
      { content: 'hi', providers: ['discord'] },
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.PROVIDER_INVALID);
  });

  it('refuse si content > limite du provider le plus strict', () => {
    const r = validatePostInput(
      { content: 'a'.repeat(300), providers: ['facebook', 'twitter'] },
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.CONTENT_TOO_LONG);
  });

  it('refuse scheduledAt passé', () => {
    const r = validatePostInput(
      {
        content: 'hi',
        providers: ['twitter'],
        scheduledAt: '2025-01-01T00:00:00Z',
      },
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SOCIAL_ERROR_CODES.SCHEDULED_AT_INVALID);
  });

  it('accepte scheduledAt absent', () => {
    expect(
      validatePostInput({ content: 'hi', providers: ['twitter'] }, now).ok,
    ).toBe(true);
  });

  it('refuse input non-objet', () => {
    expect(validatePostInput(null, now).ok).toBe(false);
    expect(validatePostInput('string', now).ok).toBe(false);
  });

  it('valide les médias en cascade', () => {
    const r = validatePostInput(
      {
        content: 'hi',
        providers: ['twitter'],
        media: [{ mime: 'video/webm' }],
      },
      now,
    );
    expect(r.ok).toBe(false);
    expect(r.field).toBe('media');
  });
});
