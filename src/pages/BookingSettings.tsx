// ── BookingSettings — réglages réservation client pro (LOT BOOKING, S3) ────
//
// Corps réel Phase C Manager-C. L'export nommé `BookingSettingsPage` est FIGÉ
// (App.tsx GELÉ le lazy-importe sous LazyGuard — page PROTÉGÉE).
//
// Calque le pattern d'une page Settings réelle (src/pages/settings/
// CustomFieldsSettings.tsx : AppLayout + header + Card + EmptyState + Tag +
// useConfirm + useToast + row-premium). CRUD types de RDV via les helpers
// FIGÉS Phase A (getBookingEventTypes / createBookingEventType /
// updateBookingEventType / deleteBookingEventType) + Modal d'édition. Lien de
// réservation public dérivé de getBookingPages() (helper api existant, lecture
// seule — borne le scope `booking_page_id`). i18n 100% t('booking.*') (clés
// FIGÉES Phase A — AUCUNE création Phase C). Discrimination erreur = absence
// `data` / champ `error` (§6.A — JAMAIS de `code`).
//
// PAIEMENT NON EXPOSÉ : BookingEventType.price_cents est POSÉ INACTIF (§6.B,
// E4/E6 sous revue PCI/légale) — ce champ n'apparaît PAS dans le formulaire.
// Les règles de disponibilité (availability_rules / date_overrides) ont déjà
// une UI dédiée côté Calendar/Settings — non dupliquées ici (§6.G : le moteur
// les lit, leur édition reste hors de cette page). Cf. docs/LOT-BOOKING.md.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Card,
  Button,
  Tag,
  EmptyState,
  Modal,
  useToast,
  useConfirm,
  Icon,
} from '@/components/ui';
import { CalendarClock, Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';
import {
  getBookingEventTypes,
  createBookingEventType,
  updateBookingEventType,
  deleteBookingEventType,
  getBookingPages,
  type BookingEventType,
} from '@/lib/api';
import { t } from '@/lib/i18n';

// Brouillon d'édition (sous-ensemble éditable — price_cents JAMAIS exposé).
type Draft = {
  name: string;
  description: string;
  duration_minutes: number;
  buffer_before_min: number;
  buffer_after_min: number;
  slot_step_min: number;
  min_notice_min: number;
  // seq 103 — rappel auto. offset en minutes AVANT le RDV (0 = aucun).
  reminder_offset_min: number;
  // seq 103 — canal du rappel. 'none' (UI) ↔ null (payload).
  reminder_channel: 'none' | 'email' | 'sms' | 'both';
  is_active: number;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  duration_minutes: 30,
  buffer_before_min: 0,
  buffer_after_min: 0,
  slot_step_min: 30,
  min_notice_min: 0,
  reminder_offset_min: 0,
  reminder_channel: 'none',
  is_active: 1,
};

function toDraft(et: BookingEventType): Draft {
  return {
    name: et.name || '',
    description: et.description || '',
    duration_minutes: et.duration_minutes ?? 30,
    buffer_before_min: et.buffer_before_min ?? 0,
    buffer_after_min: et.buffer_after_min ?? 0,
    slot_step_min: et.slot_step_min ?? 30,
    min_notice_min: et.min_notice_min ?? 0,
    // Rétro-compat : anciennes données sans ces colonnes → defaults sûrs.
    reminder_offset_min: et.reminder_offset_min ?? 0,
    reminder_channel:
      et.reminder_channel === 'email' ||
      et.reminder_channel === 'sms' ||
      et.reminder_channel === 'both'
        ? et.reminder_channel
        : 'none',
    is_active: et.is_active ?? 1,
  };
}

export function BookingSettingsPage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [eventTypes, setEventTypes] = useState<BookingEventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bookingPageId, setBookingPageId] = useState<string | null>(null);
  const [bookingSlug, setBookingSlug] = useState<string | null>(null);

  // Modal d'édition (création ou mise à jour).
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  // Charge la page de réservation (slug public + scope booking_page_id) puis
  // les types de RDV. best-effort : absence de page → liste vide propre.
  // Erreur réseau du fetch des event types → état error inline + retry.
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const pagesRes = await getBookingPages();
    let pageId: string | undefined;
    if (pagesRes.data && pagesRes.data.length > 0) {
      const p = pagesRes.data[0] as Record<string, unknown>;
      pageId = typeof p.id === 'string' ? p.id : undefined;
      setBookingPageId(pageId ?? null);
      setBookingSlug(typeof p.slug === 'string' ? p.slug : null);
    }
    const res = await getBookingEventTypes(pageId);
    if (res.data) setEventTypes(res.data);
    else setLoadError(res.error || t('common.loading_error'));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const reload = async () => {
    const res = await getBookingEventTypes(bookingPageId ?? undefined);
    if (res.data) setEventTypes(res.data);
  };

  const publicUrl = useMemo(() => {
    if (!bookingSlug) return null;
    const origin =
      typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/book/${bookingSlug}`;
  }, [bookingSlug]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setModalOpen(true);
  };

  const openEdit = (et: BookingEventType) => {
    setEditingId(et.id);
    setDraft(toDraft(et));
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!draft.name.trim()) {
      toastError(t('booking.error.save'));
      return;
    }
    setSaving(true);
    // canal 'none' (UI) → null (payload) ; offset sans effet si pas de canal.
    const noReminder = draft.reminder_channel === 'none';
    const payload: Partial<BookingEventType> = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      reminder_offset_min: noReminder ? 0 : draft.reminder_offset_min,
      reminder_channel: noReminder ? null : draft.reminder_channel,
      ...(bookingPageId ? { booking_page_id: bookingPageId } : {}),
    };
    const res = editingId
      ? await updateBookingEventType(editingId, payload)
      : await createBookingEventType(payload);
    setSaving(false);
    if (res.error || !res.data) {
      toastError(
        res.error ||
          (editingId
            ? t('booking.error.save')
            : t('booking.error.create')),
      );
      return;
    }
    success(t('booking.settings.saved'));
    setModalOpen(false);
    await reload();
  };

  const handleDelete = async (et: BookingEventType) => {
    const ok = await confirm({
      title: t('booking.event_type.delete'),
      description: t('booking.event_type.delete_confirm'),
      confirmLabel: t('booking.event_type.delete'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteBookingEventType(et.id);
    if (res.error || !res.data) {
      toastError(res.error || t('booking.error.save'));
      return;
    }
    success(t('booking.settings.saved'));
    await reload();
  };

  const numField = (
    key: keyof Draft,
    label: string,
  ) => (
    <div>
      <label
        className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
        htmlFor={`bk-${key}`}
      >
        {label}
      </label>
      <input
        id={`bk-${key}`}
        type="number"
        min={0}
        className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
        value={draft[key] as number}
        onChange={(e) =>
          setDraft((d) => ({
            ...d,
            [key]: Number(e.target.value) || 0,
          }))
        }
      />
    </div>
  );

  return (
    <AppLayout title={t('booking.settings.title')}>
      <div className="space-y-6 p-6 animate-fade-in">
        <header className="settings-page-header">
          <div>
            <h1 className="t-h2">{t('booking.settings.title')}</h1>
            <p className="t-caption text-[var(--gray-500)]">
              {t('booking.settings.subtitle')}
            </p>
          </div>
        </header>

        {/* Lien de réservation public */}
        {publicUrl && (
          <Card className="settings-card p-5">
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">
              {t('booking.settings.page_link')}
            </p>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--primary)] hover:underline break-all"
            >
              <Icon as={ExternalLink} size="sm" />
              {publicUrl}
            </a>
          </Card>
        )}

        {/* Types de RDV */}
        <Card className="settings-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('booking.settings.event_types')}
            </h2>
            <Button
              size="sm"
              onClick={openCreate}
              leftIcon={<Icon as={Plus} size="sm" />}
            >
              {t('booking.settings.new_event_type')}
            </Button>
          </div>

          {loading ? (
            <div
              className="p-8 text-center text-[var(--text-muted)]"
              aria-busy="true"
              aria-live="polite"
            >
              {t('common.loading')}
            </div>
          ) : loadError ? (
            <div className="p-6 flex flex-col items-start gap-3" role="alert">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t('common.loading_error')}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{loadError}</p>
              <Button variant="secondary" size="sm" onClick={() => void loadAll()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : eventTypes.length === 0 ? (
            <EmptyState
              variant="compact"
              icon={<Icon as={CalendarClock} size={32} />}
              title={t('booking.settings.event_types_empty')}
              action={
                <Button
                  onClick={openCreate}
                  leftIcon={<Icon as={Plus} size="sm" />}
                >
                  {t('booking.settings.new_event_type')}
                </Button>
              }
            />
          ) : (
            <div className="space-y-2.5">
              {eventTypes.map((et, idx) => (
                <div
                  key={et.id}
                  className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl group"
                  style={{
                    animationDelay: `${idx * 40}ms`,
                    animationFillMode: 'both',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {et.name}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {et.duration_minutes} {t('booking.event_type.duration')}
                    </p>
                  </div>
                  <Tag variant={et.is_active ? 'success' : 'neutral'} dot>
                    {t('booking.event_type.active')}
                  </Tag>
                  <button
                    type="button"
                    onClick={() => openEdit(et)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                    aria-label={t('booking.event_type.save')}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(et)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                    aria-label={t('booking.event_type.delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Modal création / édition d'un type de RDV (price_cents NON exposé) */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={
          editingId
            ? t('booking.event_type.save')
            : t('booking.settings.new_event_type')
        }
      >
        <div className="space-y-4">
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
              htmlFor="bk-name"
            >
              {t('booking.event_type.name')}
            </label>
            <input
              id="bk-name"
              type="text"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
              htmlFor="bk-desc"
            >
              {t('booking.event_type.description')}
            </label>
            <textarea
              id="bk-desc"
              rows={2}
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {numField('duration_minutes', t('booking.event_type.duration'))}
            {numField('slot_step_min', t('booking.event_type.slot_step'))}
            {numField(
              'buffer_before_min',
              t('booking.event_type.buffer_before'),
            )}
            {numField(
              'buffer_after_min',
              t('booking.event_type.buffer_after'),
            )}
            {numField('min_notice_min', t('booking.event_type.min_notice'))}
          </div>

          {/* Rappel automatique (seq 103) — canal + offset. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
                htmlFor="bk-reminder-channel"
              >
                {t('booking.event_type.reminder_channel')}
              </label>
              <select
                id="bk-reminder-channel"
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                value={draft.reminder_channel}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    reminder_channel: e.target
                      .value as Draft['reminder_channel'],
                  }))
                }
              >
                <option value="none">
                  {t('booking.reminder.channel.none')}
                </option>
                <option value="email">
                  {t('booking.reminder.channel.email')}
                </option>
                <option value="sms">
                  {t('booking.reminder.channel.sms')}
                </option>
                <option value="both">
                  {t('booking.reminder.channel.both')}
                </option>
              </select>
            </div>
            <div>
              <label
                className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
                htmlFor="bk-reminder_offset_min"
              >
                {t('booking.event_type.reminder_offset')}
              </label>
              <input
                id="bk-reminder_offset_min"
                type="number"
                min={0}
                disabled={draft.reminder_channel === 'none'}
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)] disabled:opacity-50"
                value={draft.reminder_offset_min}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    reminder_offset_min: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={draft.is_active === 1}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  is_active: e.target.checked ? 1 : 0,
                }))
              }
            />
            {t('booking.event_type.active')}
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              {t('booking.public.cancel')}
            </Button>
            <Button onClick={handleSave} isLoading={saving}>
              {t('booking.event_type.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
