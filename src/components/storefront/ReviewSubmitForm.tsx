// ── Storefront — ReviewSubmitForm (Sprint 40 Agent B2, seq135) ───────────────
//
// Form public de soumission d'un avis produit. Honeypot `website_url` caché
// anti-bot (toute valeur ⇒ rejet silencieux côté worker, voir
// ProductReviewSubmitInput.website_url dans lib/types.ts). Throttle front
// 1/30s via localStorage (anti-spam clic ; le worker a son propre rate limit).
// Upload photos : pattern "array d'URLs" (le worker n'expose pas encore de
// presigned R2 dédié reviews → on accepte file inputs locaux et on les passe
// en data URLs comme placeholder — un futur sprint branchera R2 si besoin).
//
// API publique :
//   <ReviewSubmitForm productId="prod_xxx" onSubmitted={() => …} />
//
// Imports RELATIFS uniquement.
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import type { ProductReviewSubmitInput } from '../../lib/types';
import { submitProductReview } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useToast } from '../ui/Toast';

export interface ReviewSubmitFormProps {
  productId: string;
  onSubmitted?: () => void;
}

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB
const BODY_MIN = 10;
const BODY_MAX = 2000;
const THROTTLE_MS = 30_000;
const THROTTLE_KEY_PREFIX = 'intralys_review_last_submit_';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('file_read_error'));
    reader.readAsDataURL(file);
  });
}

export function ReviewSubmitForm({ productId, onSubmitted }: ReviewSubmitFormProps) {
  const reactId = useId();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rating, setRating] = useState<number>(0);
  const [title, setTitle] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState<string>(''); // honeypot
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const throttleKey = useMemo(
    () => `${THROTTLE_KEY_PREFIX}${productId}`,
    [productId],
  );

  const getThrottleRemainingMs = useCallback((): number => {
    try {
      const last = localStorage.getItem(throttleKey);
      if (!last) return 0;
      const lastTs = Number(last);
      if (!Number.isFinite(lastTs)) return 0;
      const elapsed = Date.now() - lastTs;
      return Math.max(0, THROTTLE_MS - elapsed);
    } catch {
      return 0;
    }
  }, [throttleKey]);

  const onPhotosChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList).slice(0, MAX_PHOTOS - photos.length);
      const accepted: string[] = [];
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        if (f.size > MAX_PHOTO_BYTES) continue;
        try {
          const url = await readFileAsDataUrl(f);
          accepted.push(url);
        } catch {
          /* skip */
        }
      }
      setPhotos((p) => [...p, ...accepted].slice(0, MAX_PHOTOS));
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [photos.length],
  );

  const removePhoto = useCallback((idx: number) => {
    setPhotos((p) => p.filter((_, i) => i !== idx));
  }, []);

  const validate = useCallback((): string | null => {
    if (rating <= 0 || rating > 5) return 'rating_required';
    if (body.trim().length < BODY_MIN) return 'body_too_short';
    if (body.length > BODY_MAX) return 'body_too_long';
    if (!email.trim() || !email.includes('@')) return 'email_required';
    return null;
  }, [rating, body, email]);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);

      const v = validate();
      if (v) {
        setError(v);
        return;
      }

      const remaining = getThrottleRemainingMs();
      if (remaining > 0) {
        setError('throttled');
        toast.warning(
          `${t('products.reviews.submit')} — ${Math.ceil(remaining / 1000)}s`,
        );
        return;
      }

      setSubmitting(true);
      const input: ProductReviewSubmitInput = {
        rating,
        title: title.trim() || undefined,
        body: body.trim(),
        email: email.trim(),
        name: name.trim() || undefined,
        photos: photos.length > 0 ? photos : undefined,
        website_url: websiteUrl, // honeypot — passe la string vide explicitement
      };

      const res = await submitProductReview(productId, input);
      setSubmitting(false);

      if (res.error) {
        setError(res.error);
        toast.error(res.error);
        return;
      }

      try {
        localStorage.setItem(throttleKey, String(Date.now()));
      } catch {
        /* best effort */
      }

      toast.success(t('products.reviews.submitted_pending'));

      // Reset
      setRating(0);
      setTitle('');
      setBody('');
      setEmail('');
      setName('');
      setPhotos([]);
      setWebsiteUrl('');
      onSubmitted?.();
    },
    [
      validate,
      getThrottleRemainingMs,
      rating,
      title,
      body,
      email,
      name,
      photos,
      websiteUrl,
      productId,
      throttleKey,
      onSubmitted,
      toast,
    ],
  );

  const ratingLabelId = `${reactId}-rating-label`;

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4"
      aria-label={t('products.reviews.submit')}
      data-testid="review-submit-form"
      noValidate
    >
      <h2 className="text-base font-semibold text-[var(--text-primary)]">
        {t('products.reviews.submit')}
      </h2>

      {/* Rating — 5 boutons étoiles */}
      <div className="mt-3">
        <span id={ratingLabelId} className="block text-xs" style={{ color: 'var(--text-muted, #6b7280)' }}>
          {t('products.reviews.rating')} <span aria-hidden="true">*</span>
        </span>
        <div
          role="radiogroup"
          aria-labelledby={ratingLabelId}
          className="mt-1 flex items-center gap-1"
          data-testid="rating-stars"
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const active = n <= rating;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n}/5`}
                data-testid={`rating-star-${n}`}
                onClick={() => setRating(n)}
                className="text-2xl leading-none"
                style={{
                  color: active ? '#f59e0b' : 'var(--border, #d1d5db)',
                  background: 'transparent',
                  padding: 0,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ★
              </button>
            );
          })}
        </div>
      </div>

      {/* Title */}
      <label className="mt-3 block text-xs" style={{ color: 'var(--text-muted, #6b7280)' }}>
        {t('products.reviews.title')}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          data-testid="review-title"
          className="mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
        />
      </label>

      {/* Body */}
      <label className="mt-3 block text-xs" style={{ color: 'var(--text-muted, #6b7280)' }}>
        {t('products.reviews.body')} <span aria-hidden="true">*</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          minLength={BODY_MIN}
          maxLength={BODY_MAX}
          required
          data-testid="review-body"
          className="mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
        />
        <span className="mt-1 block text-[10px]" style={{ color: 'var(--text-muted, #9ca3af)' }}>
          {body.length}/{BODY_MAX}
        </span>
      </label>

      {/* Email + Name */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs" style={{ color: 'var(--text-muted, #6b7280)' }}>
          email <span aria-hidden="true">*</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            data-testid="review-email"
            className="mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
          />
        </label>
        <label className="block text-xs" style={{ color: 'var(--text-muted, #6b7280)' }}>
          name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            data-testid="review-name"
            className="mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
          />
        </label>
      </div>

      {/* Photos */}
      <div className="mt-3">
        <label className="block text-xs" style={{ color: 'var(--text-muted, #6b7280)' }}>
          photos ({photos.length}/{MAX_PHOTOS})
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPhotosChange}
            disabled={photos.length >= MAX_PHOTOS}
            data-testid="review-photos-input"
            className="mt-1 block w-full text-xs"
          />
        </label>
        {photos.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2" data-testid="review-photos-preview">
            {photos.map((url, i) => (
              <span
                key={url.slice(0, 32) + i}
                className="relative inline-block overflow-hidden rounded-md border border-[var(--border)]"
                style={{ width: 56, height: 56 }}
              >
                <img
                  src={url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label="remove"
                  className="absolute right-0 top-0 rounded-bl-md bg-black/60 px-1 text-[10px] text-white"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Honeypot — caché humains + bots intelligents ignorent display:none mais
          rempliront le champ visible "website" → toute valeur = rejet silencieux
          côté worker (ProductReviewSubmitInput.website_url). */}
      <div
        aria-hidden="true"
        style={{
          display: 'none',
          position: 'absolute',
          left: -9999,
          top: -9999,
          width: 0,
          height: 0,
          overflow: 'hidden',
        }}
      >
        <label>
          website
          <input
            type="text"
            name="website_url"
            tabIndex={-1}
            autoComplete="off"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            data-testid="review-honeypot"
          />
        </label>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 text-xs"
          style={{ color: 'var(--danger, #b91c1c)' }}
          data-testid="review-error"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4">
        <button
          type="submit"
          disabled={submitting}
          data-testid="review-submit-btn"
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {t('products.reviews.submit')}
        </button>
      </div>
    </form>
  );
}
