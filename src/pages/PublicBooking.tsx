// ── PublicBooking — page de réservation publique (LOT BOOKING, Sprint 3) ───
//
// Corps réel Phase C Manager-C. L'export nommé `PublicBookingPage` est FIGÉ
// (App.tsx GELÉ le lazy-importe — route publique `/book/$slug`, hors auth).
//
// Calque EXACT le pattern src/pages/PublicFunnel.tsx / PublicForm.tsx : pas
// d'auth, fetch brut via helpers api FIGÉS (getBookingAvailability /
// createPublicBooking / cancelPublicBooking / reschedulePublicBooking),
// spinner loading (PublicFunnel.tsx:145-160), écran succès
// (PublicFunnel.tsx:175-204), discrimination erreur = absence `data` / champ
// `error` (§6.A — JAMAIS de `code`). i18n 100% t('booking.*') (clés FIGÉES
// Phase A — AUCUNE création Phase C). Fuseaux : les créneaux arrivent en
// ISO8601 UTC (§6.C/§6.G) → ré-localisés à l'affichage via Intl.
//
// Sprint 3-bis : l'endpoint PUBLIC `/api/book/:slug/meta` expose désormais le
// fuseau de la booking page + ses types de RDV actifs (projection minimale,
// zéro donnée tenant). Le front affiche donc un sélecteur de type de RDV
// (clé i18n EXISTANTE booking.public.pick_type) et re-localise les créneaux
// dans le fuseau de la PAGE (et non du visiteur) via Intl timeZone. Le front
// n'invente JAMAIS de données (créneaux/prix/fuseau) — tout vient du backend.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  getPublicBookingMeta,
  getBookingAvailability,
  createPublicBooking,
  cancelPublicBooking,
  reschedulePublicBooking,
  type PublicBookingMeta,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { Select } from '@/components/ui';

// Date du jour (local visiteur) au format YYYY-MM-DD pour l'input <input type="date">.
function todayInput(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Re-localisation d'un slot ISO8601 UTC (§6.G) → heure lisible DANS LE FUSEAU
// DE LA PAGE (Sprint 3-bis : tz vient de /book/:slug/meta). Si tz absent
// (meta non chargée / fuseau inconnu) → fuseau du visiteur (fallback honnête,
// Intl natif). Aucune donnée inventée : on affiche l'instant exact renvoyé
// par le moteur, juste re-localisé.
function fmtTime(iso: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      ...(tz ? { timeZone: tz } : {}),
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtDateLong(iso: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(tz ? { timeZone: tz } : {}),
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function PublicBookingPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };

  // Mode annulation / reprogrammation porté par l'URL (?booking_id=…&action=cancel|reschedule).
  const urlParams = useMemo(
    () =>
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams(),
    [],
  );
  const bookingIdParam = urlParams.get('booking_id') || '';
  const actionParam = urlParams.get('action') || ''; // 'cancel' | 'reschedule' | ''

  // Métadonnées publiques de la page (fuseau + types de RDV) — Sprint 3-bis.
  const [meta, setMeta] = useState<PublicBookingMeta | null>(null);
  const [selectedEventType, setSelectedEventType] = useState<string>('');

  const [date, setDate] = useState<string>(todayInput());
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Écran de fin : 'booked' | 'cancelled' | 'rescheduled'
  const [done, setDone] = useState<{
    kind: 'booked' | 'cancelled' | 'rescheduled';
    redirectUrl?: string;
  } | null>(null);

  // Fuseau de la page (source de vérité §6.G) — fallback visiteur si meta KO.
  const pageTz = meta?.page.timezone || undefined;
  const eventTypes = meta?.event_types || [];

  // Chargement des métadonnées publiques (fuseau + types de RDV). Sans auth,
  // discrimination res.error/!res.data (§6.A — jamais de `code`). Best-effort :
  // si KO, le flux reste fonctionnel (fuseau visiteur + type résolu backend).
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    getPublicBookingMeta(slug).then((res) => {
      if (!alive) return;
      if (res.error || !res.data) return;
      setMeta(res.data);
      // Pré-sélection du 1ᵉʳ type si plusieurs (sélecteur affiché) ; si un
      // seul, on le pré-sélectionne aussi (sélecteur masqué, transparent).
      const ets = res.data.event_types || [];
      if (ets.length > 0) setSelectedEventType(ets[0]!.id);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  // Chargement des créneaux pour la date choisie (calque PublicFunnel.tsx:38-59
  // — fetch helper public sans auth, discrimination res.error/!res.data §6.A).
  // Le type de RDV sélectionné est passé au moteur (le backend retombe sur le
  // fallback dérivé de la page si vide — §6.C étape 2).
  const loadSlots = useCallback(() => {
    if (!slug || !date) return;
    let alive = true;
    setSlotsLoading(true);
    setSlotsError('');
    setSelectedSlot('');
    getBookingAvailability(slug, date, selectedEventType || undefined)
      .then((res) => {
        if (!alive) return;
        if (res.error || !res.data) {
          setSlotsError(res.error || t('booking.public.not_found'));
          setSlots([]);
          return;
        }
        setSlots([...(res.data.slots || [])].sort());
      })
      .finally(() => {
        if (alive) setSlotsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, date, selectedEventType]);

  useEffect(() => {
    // En mode annulation pure, on ne charge pas la dispo.
    if (actionParam === 'cancel') return;
    const cleanup = loadSlots();
    return cleanup;
  }, [loadSlots, actionParam]);

  // ── Création de réservation ───────────────────────────────────────────────
  const handleBook = useCallback(async () => {
    if (submitting) return;
    if (!selectedSlot || !name.trim() || !email.trim()) {
      setError(t('booking.error.book'));
      return;
    }
    setSubmitting(true);
    setError('');
    const res = await createPublicBooking(slug, {
      event_type_id: selectedEventType || undefined,
      start_time: selectedSlot,
      guest_name: name.trim(),
      guest_email: email.trim(),
      guest_phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (res.error || !res.data) {
      setError(res.error || t('booking.error.book'));
      return;
    }
    setDone({ kind: 'booked', redirectUrl: res.data.redirect_url });
  }, [submitting, selectedSlot, name, email, phone, notes, slug, selectedEventType]);

  // ── Annulation via token URL ──────────────────────────────────────────────
  // Destructive : confirm() natif (page publique, pas de ConfirmDialog provider).
  const handleCancel = useCallback(async () => {
    if (submitting || !bookingIdParam) return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const ok = window.confirm(t('booking.public.cancel_confirm'));
      if (!ok) return;
    }
    setSubmitting(true);
    setError('');
    const res = await cancelPublicBooking(slug, {
      booking_id: bookingIdParam,
      reason: cancelReason.trim() || undefined,
    });
    setSubmitting(false);
    if (res.error || !res.data) {
      setError(res.error || t('booking.error.cancel'));
      return;
    }
    setDone({ kind: 'cancelled' });
  }, [submitting, bookingIdParam, cancelReason, slug]);

  // ── Reprogrammation via token URL ─────────────────────────────────────────
  const handleReschedule = useCallback(async () => {
    if (submitting || !bookingIdParam || !selectedSlot) return;
    setSubmitting(true);
    setError('');
    const res = await reschedulePublicBooking(slug, {
      booking_id: bookingIdParam,
      start_time: selectedSlot,
    });
    setSubmitting(false);
    if (res.error || !res.data) {
      setError(res.error || t('booking.error.reschedule'));
      return;
    }
    setDone({ kind: 'rescheduled', redirectUrl: res.data.redirect_url });
  }, [submitting, bookingIdParam, selectedSlot, slug]);

  // Honore redirect_url si le backend en renvoie un (calque PublicFunnel.tsx:108-112).
  useEffect(() => {
    if (done?.redirectUrl) {
      const timer = setTimeout(() => {
        window.location.href = done.redirectUrl as string;
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [done]);

  const isReschedule = actionParam === 'reschedule' && !!bookingIdParam;
  const isCancel = actionParam === 'cancel' && !!bookingIdParam;

  // ── Écran de fin (calque PublicFunnel.tsx:175-204) ────────────────────────
  if (done) {
    const heading =
      done.kind === 'cancelled'
        ? t('booking.public.cancelled')
        : done.kind === 'rescheduled'
          ? t('booking.public.rescheduled')
          : t('booking.public.confirmed');
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6 text-center bg-[var(--bg-surface)]"
        role="status"
        aria-live="polite"
        data-testid="bk-done"
      >
        <div style={{ maxWidth: 480 }}>
          <div
            style={{
              width: 64,
              height: 64,
              background: '#ecfdf5',
              color: '#10b981',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: 28,
            }}
          >
            ✓
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            {heading}
          </h1>
          {done.kind === 'booked' && (
            <p style={{ color: '#6b7280' }}>
              {t('booking.public.confirmed_detail')}
            </p>
          )}
        </div>
      </div>
    );
  }

  const labelClasses =
    'mb-1 block text-sm font-medium text-[var(--text-secondary)]';
  const inputClasses =
    'w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]';

  return (
    <div
      className="min-h-screen bg-[var(--bg-surface)] p-4 flex justify-center items-start"
      data-testid="bk-page"
    >
      <div className="w-full max-w-lg p-6">
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          {isCancel
            ? t('booking.public.cancel')
            : isReschedule
              ? t('booking.public.reschedule')
              : t('booking.public.title')}
        </h1>
        <p
          className="text-sm"
          style={{ color: '#6b7280', marginBottom: 20 }}
          data-booking-slug={slug}
        >
          {t('booking.public.timezone_note')}
          {pageTz ? ` (${pageTz})` : ''}
        </p>

        {/* Mode annulation : raison optionnelle + confirmation. */}
        {isCancel ? (
          <div className="space-y-4">
            <div>
              <label className={labelClasses} htmlFor="bk-cancel-reason">
                {t('booking.public.cancel_reason')}
              </label>
              <textarea
                id="bk-cancel-reason"
                className={inputClasses}
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
            {error && (
              <p
                className="text-sm text-red-500"
                role="alert"
                aria-live="polite"
                data-testid="bk-error"
              >
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              aria-busy={submitting || undefined}
              aria-label={t('booking.public.cancel')}
              data-testid="bk-btn-cancel"
              className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting
                ? t('booking.public.booking')
                : t('booking.public.cancel')}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Choix du type de RDV — affiché seulement si ≥2 types actifs
                (Calendly-grade). 1 seul = pré-sélectionné, masqué. 0 =
                fallback dérivé de la page côté backend (§6.C). Masqué en
                mode reprogrammation (le type suit l'ancien booking). */}
            {!isReschedule && eventTypes.length >= 2 && (
              <div>
                <label className={labelClasses} htmlFor="bk-event-type">
                  {t('booking.public.pick_type')}
                </label>
                <Select
                  id="bk-event-type"
                  value={selectedEventType}
                  onChange={(e) => setSelectedEventType(e.target.value)}
                >
                  {eventTypes.map((et) => (
                    <option key={et.id} value={et.id}>
                      {et.name || t('booking.public.title')}
                      {et.duration_minutes
                        ? ` · ${et.duration_minutes} min`
                        : ''}
                    </option>
                  ))}
                </Select>
                {(() => {
                  const sel = eventTypes.find(
                    (et) => et.id === selectedEventType,
                  );
                  return sel?.description ? (
                    <p
                      className="mt-1 text-xs"
                      style={{ color: '#6b7280' }}
                    >
                      {sel.description}
                    </p>
                  ) : null;
                })()}
              </div>
            )}

            {/* Choix de la date */}
            <div>
              <label className={labelClasses} htmlFor="bk-date">
                {t('booking.public.pick_date')}
              </label>
              <input
                id="bk-date"
                type="date"
                className={inputClasses}
                value={date}
                min={todayInput()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            {/* Choix du créneau */}
            <div>
              <label className={labelClasses}>
                {t('booking.public.pick_slot')}
              </label>
              {slotsLoading ? (
                <div
                  className="flex justify-center py-6"
                  role="status"
                  aria-busy="true"
                  aria-label={t('state.loading')}
                  data-testid="bk-slots-loading"
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      border: '3px solid rgba(0,157,219,0.2)',
                      borderTopColor: '#009DDB',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                </div>
              ) : slotsError ? (
                <p
                  className="text-sm text-red-500"
                  role="alert"
                  aria-live="polite"
                  data-testid="bk-slots-error"
                >
                  {slotsError}
                </p>
              ) : slots.length === 0 ? (
                <p
                  className="text-sm"
                  style={{ color: '#6b7280' }}
                  data-testid="bk-slots-empty"
                >
                  {t('booking.public.no_slots')}
                </p>
              ) : (
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label={t('booking.public.pick_slot')}
                  data-testid="bk-slots-list"
                >
                  {slots.map((s) => {
                    const active = s === selectedSlot;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSelectedSlot(s)}
                        aria-pressed={active}
                        aria-label={fmtTime(s, pageTz)}
                        className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                            : 'border-[var(--border)] hover:border-[var(--primary)]'
                        }`}
                      >
                        {fmtTime(s, pageTz)}
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedSlot && (
                <p className="mt-2 text-xs" style={{ color: '#6b7280' }}>
                  {fmtDateLong(selectedSlot, pageTz)} ·{' '}
                  {fmtTime(selectedSlot, pageTz)}
                </p>
              )}
            </div>

            {/* Mode reprogrammation : pas de coordonnées, juste le nouveau créneau. */}
            {isReschedule ? (
              <>
                {error && (
                  <p
                    className="text-sm text-red-500"
                    role="alert"
                    aria-live="polite"
                    data-testid="bk-error"
                  >
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleReschedule}
                  disabled={submitting || !selectedSlot}
                  aria-busy={submitting || undefined}
                  aria-label={t('booking.public.reschedule')}
                  data-testid="bk-btn-reschedule"
                  className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting
                    ? t('booking.public.booking')
                    : t('booking.public.reschedule')}
                </button>
              </>
            ) : (
              <>
                {/* Coordonnées invité */}
                <div>
                  <h2
                    className="text-sm font-semibold"
                    style={{ marginBottom: 10 }}
                  >
                    {t('booking.public.your_info')}
                  </h2>
                  <div className="space-y-3">
                    <div>
                      <label className={labelClasses} htmlFor="bk-name">
                        {t('booking.public.name')}
                      </label>
                      <input
                        id="bk-name"
                        type="text"
                        className={inputClasses}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClasses} htmlFor="bk-email">
                        {t('booking.public.email')}
                      </label>
                      <input
                        id="bk-email"
                        type="email"
                        className={inputClasses}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className={labelClasses} htmlFor="bk-phone">
                        {t('booking.public.phone')}
                      </label>
                      <input
                        id="bk-phone"
                        type="tel"
                        className={inputClasses}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClasses} htmlFor="bk-notes">
                        {t('booking.public.notes')}
                      </label>
                      <textarea
                        id="bk-notes"
                        className={inputClasses}
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {error && (
                  <p
                    className="text-sm text-red-500"
                    role="alert"
                    aria-live="polite"
                    data-testid="bk-error"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleBook}
                  disabled={
                    submitting ||
                    !selectedSlot ||
                    !name.trim() ||
                    !email.trim()
                  }
                  aria-busy={submitting || undefined}
                  aria-label={t('booking.public.confirm')}
                  data-testid="bk-btn-confirm"
                  className="w-full rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting
                    ? t('booking.public.booking')
                    : t('booking.public.confirm')}
                </button>
              </>
            )}

            <p
              className="text-center pt-2"
              style={{ fontSize: 10, color: '#6b7280' }}
            >
              Propulsé par <strong>Intralys</strong>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
