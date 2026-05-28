// ── BookingManagement — gestion des pages de réservation, des règles de
// disponibilité et des réservations à venir (LOT BOOKING — surface visible).
//
// Enfant ADDITIF monté par src/pages/BookingSettings.tsx. NE touche PAS aux
// helpers FIGÉS Phase A : il consomme uniquement les helpers api existants
// `createBookingPage` / `updateBookingPage` / `deleteBookingPage` /
// `getAvailabilityRules` / `getBookings` / `markNoShow` (+ `getBookingPages`
// / `getClients` en lecture). Pattern calqué sur BookingSettings.tsx :
// AppLayout absent (c'est un enfant), Card + EmptyState + Tag + useConfirm +
// useToast + Modal + état loading/empty/error(role=alert)/retry.
//
// i18n : toutes les chaînes via t('bookingmgmt.*') (clés NOUVELLES — listées
// dans le rapport) ou réutilisation de clés existantes 'booking.*' / 'common.*'.
// Discrimination erreur = absence `data` / champ `error` (§6.A — JAMAIS `code`).

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  CalendarDays,
  Plus,
  Pencil,
  Trash2,
  Clock,
  Users,
  UserX,
} from 'lucide-react';
import {
  getBookingPages,
  createBookingPage,
  updateBookingPage,
  deleteBookingPage,
  getAvailabilityRules,
  getBookings,
  markNoShow,
  getClients,
  type AvailabilityRule,
} from '@/lib/api';
import type { Client } from '@/lib/types';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n';
import { formatDateTime } from '@/lib/i18n/datetime';

// ── Helpers de lecture sûre (les pages/bookings sont des Record<string,unknown>).
function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}
function num(rec: Record<string, unknown>, key: string): number | null {
  const v = rec[key];
  return typeof v === 'number' ? v : null;
}

// Brouillon d'édition d'une page de réservation publique.
type PageDraft = {
  client_id: string;
  title: string;
  slug: string;
  description: string;
  duration_minutes: number;
  color: string;
};

const EMPTY_PAGE_DRAFT: PageDraft = {
  client_id: '',
  title: '',
  slug: '',
  description: '',
  duration_minutes: 30,
  color: '#2563eb',
};

// Libellé jour de semaine (0 = dimanche … 6 = samedi) via Intl, locale courante.
function dayLabel(dow: number): string {
  // Une date de référence connue : 2024-01-07 est un dimanche (dow 0).
  const ref = new Date(Date.UTC(2024, 0, 7 + (((dow % 7) + 7) % 7)));
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(ref);
}

export function BookingManagement() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  // ── Pages de réservation publiques ────────────────────────────
  const [pages, setPages] = useState<Array<Record<string, unknown>>>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [pagesError, setPagesError] = useState<string | null>(null);

  // ── Sélection courante (pilote règles + réservations) ─────────
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  // ── Règles de disponibilité (lecture seule) ───────────────────
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);

  // ── Réservations à venir ──────────────────────────────────────
  const [bookings, setBookings] = useState<Array<Record<string, unknown>>>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  // ── Modal page (création / édition) ───────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PageDraft>(EMPTY_PAGE_DRAFT);
  const [saving, setSaving] = useState(false);

  // Charge pages + clients (client_id requis pour créer une page).
  const loadPages = useCallback(async () => {
    setPagesLoading(true);
    setPagesError(null);
    const [pagesRes, clientsRes] = await Promise.all([
      getBookingPages(),
      getClients(),
    ]);
    if (clientsRes.data) setClients(clientsRes.data);
    if (pagesRes.data) {
      setPages(pagesRes.data);
      setSelectedPageId((prev) => {
        if (prev && pagesRes.data!.some((p) => str(p, 'id') === prev)) {
          return prev;
        }
        const first = pagesRes.data![0];
        return first ? str(first, 'id') || null : null;
      });
    } else {
      setPagesError(pagesRes.error || t('common.loading_error'));
    }
    setPagesLoading(false);
  }, []);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    const res = await getAvailabilityRules();
    if (res.data) setRules(res.data);
    else setRulesError(res.error || t('common.loading_error'));
    setRulesLoading(false);
  }, []);

  const loadBookings = useCallback(async (pageId: string | null) => {
    if (!pageId) {
      setBookings([]);
      setBookingsError(null);
      setBookingsLoading(false);
      return;
    }
    setBookingsLoading(true);
    setBookingsError(null);
    const res = await getBookings(pageId);
    if (res.data) setBookings(res.data);
    else setBookingsError(res.error || t('common.loading_error'));
    setBookingsLoading(false);
  }, []);

  useEffect(() => {
    void loadPages();
    void loadRules();
  }, [loadPages, loadRules]);

  useEffect(() => {
    void loadBookings(selectedPageId);
  }, [selectedPageId, loadBookings]);

  const selectedPage = useMemo(
    () => pages.find((p) => str(p, 'id') === selectedPageId) ?? null,
    [pages, selectedPageId],
  );

  // ── Édition page ──────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null);
    setDraft({
      ...EMPTY_PAGE_DRAFT,
      client_id: clients[0]?.id ?? '',
    });
    setModalOpen(true);
  };

  const openEdit = (page: Record<string, unknown>) => {
    setEditingId(str(page, 'id'));
    setDraft({
      client_id: str(page, 'client_id'),
      title: str(page, 'title'),
      slug: str(page, 'slug'),
      description: str(page, 'description'),
      duration_minutes: num(page, 'duration_minutes') ?? 30,
      color: str(page, 'color') || '#2563eb',
    });
    setModalOpen(true);
  };

  const handleSavePage = async () => {
    if (saving) return;
    if (!draft.title.trim() || !draft.slug.trim()) {
      toastError(t('bookingmgmt.page.error_required'));
      return;
    }
    if (!editingId && !draft.client_id) {
      toastError(t('bookingmgmt.page.error_client'));
      return;
    }
    setSaving(true);
    const res = editingId
      ? await updateBookingPage(editingId, {
          title: draft.title.trim(),
          slug: draft.slug.trim(),
          description: draft.description.trim() || null,
          duration_minutes: draft.duration_minutes,
          color: draft.color,
        })
      : await createBookingPage({
          client_id: draft.client_id,
          title: draft.title.trim(),
          slug: draft.slug.trim(),
          description: draft.description.trim() || undefined,
          duration_minutes: draft.duration_minutes,
          color: draft.color,
        });
    setSaving(false);
    if (res.error || !res.data) {
      toastError(res.error || t('bookingmgmt.page.error_save'));
      return;
    }
    success(t('bookingmgmt.page.saved'));
    setModalOpen(false);
    await loadPages();
  };

  const handleDeletePage = async (page: Record<string, unknown>) => {
    const ok = await confirm({
      title: t('bookingmgmt.page.delete'),
      description: t('bookingmgmt.page.delete_confirm'),
      confirmLabel: t('bookingmgmt.page.delete'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteBookingPage(str(page, 'id'));
    if (res.error || !res.data) {
      toastError(res.error || t('bookingmgmt.page.error_save'));
      return;
    }
    success(t('bookingmgmt.page.deleted'));
    await loadPages();
  };

  // ── No-show ───────────────────────────────────────────────────
  const handleNoShow = async (booking: Record<string, unknown>) => {
    const ok = await confirm({
      title: t('booking.noshow.action'),
      description: t('booking.noshow.confirm'),
      confirmLabel: t('booking.noshow.action'),
      danger: true,
    });
    if (!ok) return;
    const res = await markNoShow(str(booking, 'id'));
    if (res.error || !res.data) {
      toastError(res.error || t('bookingmgmt.booking.error_noshow'));
      return;
    }
    success(t('booking.noshow.done'));
    await loadBookings(selectedPageId);
  };

  const setField = <K extends keyof PageDraft>(key: K, value: PageDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="space-y-6">
      {/* ── Pages de réservation publiques ───────────────────────── */}
      <Card className="settings-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('bookingmgmt.pages.title')}
          </h2>
          <Button
            size="sm"
            onClick={openCreate}
            disabled={pagesLoading}
            leftIcon={<Icon as={Plus} size="sm" />}
          >
            {t('bookingmgmt.pages.new')}
          </Button>
        </div>

        {pagesLoading ? (
          <div
            className="p-8 text-center text-[var(--text-muted)]"
            aria-busy="true"
            aria-live="polite"
          >
            {t('common.loading')}
          </div>
        ) : pagesError ? (
          <div className="p-6 flex flex-col items-start gap-3" role="alert">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {t('common.loading_error')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{pagesError}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadPages()}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : pages.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={CalendarDays} size={32} />}
            title={t('bookingmgmt.pages.empty')}
            action={
              <Button
                onClick={openCreate}
                leftIcon={<Icon as={Plus} size="sm" />}
              >
                {t('bookingmgmt.pages.new')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {pages.map((page, idx) => {
              const id = str(page, 'id');
              const active = id === selectedPageId;
              return (
                <div
                  key={id}
                  className={`row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl group ${
                    active ? 'ring-1 ring-[var(--primary)]' : ''
                  }`}
                  style={{
                    animationDelay: `${idx * 40}ms`,
                    animationFillMode: 'both',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedPageId(id)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                    aria-pressed={active}
                  >
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {str(page, 'title') || t('bookingmgmt.pages.untitled')}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      /{str(page, 'slug')}
                    </p>
                  </button>
                  {active && (
                    <Tag variant="info" dot>
                      {t('bookingmgmt.pages.selected')}
                    </Tag>
                  )}
                  <button
                    type="button"
                    onClick={() => openEdit(page)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                    aria-label={t('bookingmgmt.page.edit')}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeletePage(page)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                    aria-label={t('bookingmgmt.page.delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Règles de disponibilité (lecture seule) ──────────────── */}
      <Card className="settings-card p-6">
        <div className="flex items-center gap-2 mb-1">
          <Icon as={Clock} size="sm" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('bookingmgmt.availability.title')}
          </h2>
        </div>
        <p className="t-caption text-[var(--gray-500)] mb-4">
          {t('bookingmgmt.availability.subtitle')}
        </p>

        {rulesLoading ? (
          <div
            className="p-8 text-center text-[var(--text-muted)]"
            aria-busy="true"
            aria-live="polite"
          >
            {t('common.loading')}
          </div>
        ) : rulesError ? (
          <div className="p-6 flex flex-col items-start gap-3" role="alert">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {t('common.loading_error')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{rulesError}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadRules()}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : rules.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={Clock} size={32} />}
            title={t('bookingmgmt.availability.empty')}
          />
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--bg-subtle)]"
              >
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {dayLabel(rule.day_of_week)}
                </span>
                <span className="text-sm text-[var(--text-secondary)] tabular-nums">
                  {rule.start_time} – {rule.end_time}
                </span>
                <Tag variant={rule.is_active ? 'success' : 'neutral'} dot>
                  {rule.is_active
                    ? t('bookingmgmt.availability.active')
                    : t('bookingmgmt.availability.inactive')}
                </Tag>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Réservations à venir ─────────────────────────────────── */}
      <Card className="settings-card p-6">
        <div className="flex items-center gap-2 mb-1">
          <Icon as={Users} size="sm" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('bookingmgmt.bookings.title')}
          </h2>
        </div>
        <p className="t-caption text-[var(--gray-500)] mb-4">
          {selectedPage
            ? t('bookingmgmt.bookings.subtitle')
            : t('bookingmgmt.bookings.no_page')}
        </p>

        {!selectedPageId ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={Users} size={32} />}
            title={t('bookingmgmt.bookings.no_page')}
          />
        ) : bookingsLoading ? (
          <div
            className="p-8 text-center text-[var(--text-muted)]"
            aria-busy="true"
            aria-live="polite"
          >
            {t('common.loading')}
          </div>
        ) : bookingsError ? (
          <div className="p-6 flex flex-col items-start gap-3" role="alert">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {t('common.loading_error')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{bookingsError}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadBookings(selectedPageId)}
            >
              {t('common.retry')}
            </Button>
          </div>
        ) : bookings.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Icon as={Users} size={32} />}
            title={t('bookingmgmt.bookings.empty')}
          />
        ) : (
          <div className="space-y-2.5">
            {bookings.map((bk, idx) => {
              const id = str(bk, 'id');
              const status = str(bk, 'status');
              const startRaw =
                str(bk, 'start_at') ||
                str(bk, 'starts_at') ||
                str(bk, 'start_time');
              let when = startRaw;
              if (startRaw) {
                const d = new Date(startRaw);
                if (!Number.isNaN(d.getTime())) {
                  when = formatDateTime(d, getLocale());
                }
              }
              const isNoShow = status === 'no_show';
              return (
                <div
                  key={id}
                  className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl group"
                  style={{
                    animationDelay: `${idx * 40}ms`,
                    animationFillMode: 'both',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {str(bk, 'customer_name') ||
                        str(bk, 'name') ||
                        str(bk, 'customer_email') ||
                        t('bookingmgmt.bookings.unknown_guest')}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {when || t('bookingmgmt.bookings.no_date')}
                    </p>
                  </div>
                  {status && (
                    <Tag variant={isNoShow ? 'danger' : 'neutral'}>
                      {status}
                    </Tag>
                  )}
                  {!isNoShow && (
                    <button
                      type="button"
                      onClick={() => handleNoShow(bk)}
                      className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
                      aria-label={t('booking.noshow.action')}
                      title={t('booking.noshow.action')}
                    >
                      <UserX size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Modal création / édition d'une page de réservation ────── */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={
          editingId
            ? t('bookingmgmt.page.edit')
            : t('bookingmgmt.pages.new')
        }
      >
        <div className="space-y-4">
          {!editingId && (
            <div>
              <label
                className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
                htmlFor="bkmgmt-client"
              >
                {t('bookingmgmt.page.client')}
              </label>
              <select
                id="bkmgmt-client"
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                value={draft.client_id}
                onChange={(e) => setField('client_id', e.target.value)}
              >
                <option value="">
                  {t('bookingmgmt.page.client_placeholder')}
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
              htmlFor="bkmgmt-title"
            >
              {t('bookingmgmt.page.field_title')}
            </label>
            <input
              id="bkmgmt-title"
              type="text"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              value={draft.title}
              onChange={(e) => setField('title', e.target.value)}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
              htmlFor="bkmgmt-slug"
            >
              {t('bookingmgmt.page.slug')}
            </label>
            <input
              id="bkmgmt-slug"
              type="text"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              value={draft.slug}
              onChange={(e) => setField('slug', e.target.value)}
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
              htmlFor="bkmgmt-desc"
            >
              {t('bookingmgmt.page.description')}
            </label>
            <textarea
              id="bkmgmt-desc"
              rows={2}
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
              value={draft.description}
              onChange={(e) => setField('description', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
                htmlFor="bkmgmt-duration"
              >
                {t('bookingmgmt.page.duration')}
              </label>
              <input
                id="bkmgmt-duration"
                type="number"
                min={0}
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
                value={draft.duration_minutes}
                onChange={(e) =>
                  setField('duration_minutes', Number(e.target.value) || 0)
                }
              />
            </div>
            <div>
              <label
                className="mb-1 block text-sm font-medium text-[var(--text-secondary)]"
                htmlFor="bkmgmt-color"
              >
                {t('bookingmgmt.page.color')}
              </label>
              <input
                id="bkmgmt-color"
                type="color"
                className="h-[42px] w-full rounded-lg border border-[var(--border)] px-1 py-1 outline-none focus:border-[var(--primary)]"
                value={draft.color}
                onChange={(e) => setField('color', e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <Button
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              {t('booking.public.cancel')}
            </Button>
            <Button onClick={handleSavePage} isLoading={saving}>
              {t('bookingmgmt.page.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
