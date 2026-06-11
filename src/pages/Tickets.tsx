// ── Tickets — file de support & détail ticket (LOT G1 HELPDESK, Sprint 8) ──
//
// Phase B Manager-C (front exclusif). Liste des tickets (listTickets) + détail
// en panneau slide-over (SlidePanel — calque conceptuel LeadDetail/Leads) :
// fil ticket_messages (inbound/outbound/note interne distincts) + zone réponse
// (replyTicket) + actions statut/assignation/SLA (updateTicket). La route
// /tickets/$ticketId ouvre le même panneau (pas de page séparée). Helpers api
// FIGÉS Phase A consommés tels quels. i18n t('ticket.*') — clés figées Phase A.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  EmptyState,
  PageHero,
  Select,
  SlidePanel,
  Skeleton,
  Tag,
  Textarea,
  useToast,
} from '@/components/ui';
import {
  listTickets,
  getTicket,
  updateTicket,
  replyTicket,
  type Ticket,
  type TicketMessage,
  type TicketStatus,
  type SlaLevel,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { NewTicketModal } from '@/components/tickets/NewTicketModal';
import { LifeBuoy, Plus, Send, StickyNote } from 'lucide-react';

// ── Color-coding statuts (brief) : ouvert=info(bleu), en_cours=warning(orange),
//    attente_client=neutral(gris), resolu=success(vert), escale=danger(rouge).
const STATUS_VARIANT: Record<
  TicketStatus,
  'info' | 'warning' | 'neutral' | 'success' | 'danger'
> = {
  ouvert: 'info',
  en_cours: 'warning',
  attente_client: 'neutral',
  resolu: 'success',
  escale: 'danger',
};

const STATUS_ORDER: TicketStatus[] = [
  'ouvert',
  'en_cours',
  'attente_client',
  'resolu',
  'escale',
];

const SLA_ORDER: SlaLevel[] = ['none', '1h', '4h', '24h', '72h'];

function statusLabel(s: TicketStatus): string {
  return t(`ticket.status.${s}`);
}

function slaLabel(s: SlaLevel): string {
  return t(`ticket.sla.${s}`);
}

function fmtRelative(ts?: number | null): string {
  if (!ts) return '—';
  const ms = ts < 1e12 ? ts * 1000 : ts; // tolère epoch s ou ms
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return t('ticket.time.just_now');
  if (min < 60) return t('ticket.time.minutes_ago', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('ticket.time.hours_ago', { n: h });
  const d = Math.round(h / 24);
  return t('ticket.time.days_ago', { n: d });
}

// SLA dépassé / proche (badge urgence si sla_due_at proche/dépassé).
function slaUrgency(ticket: Ticket): 'overdue' | 'soon' | null {
  if (!ticket.sla_due_at || ticket.status === 'resolu') return null;
  const ms = ticket.sla_due_at < 1e12 ? ticket.sla_due_at * 1000 : ticket.sla_due_at;
  const left = ms - Date.now();
  if (left <= 0) return 'overdue';
  if (left <= 60 * 60 * 1000) return 'soon';
  return null;
}

function MessageRow({ m }: { m: TicketMessage }) {
  const internal = !!m.is_internal;
  const inbound = m.direction === 'inbound';
  // Note interne = encadré ambre discret ; inbound = aligné gauche neutre ;
  // outbound (réponse équipe) = aligné droite primary-soft.
  const tone = internal
    ? { bg: 'var(--warning-soft)', align: 'stretch', label: t('ticket.action.reply') }
    : inbound
      ? { bg: 'var(--bg-subtle)', align: 'flex-start', label: m.author_name || t('ticket.col.requester') }
      : { bg: 'var(--primary-soft)', align: 'flex-end', label: m.author_name || t('ticket.message.team') };
  return (
    <div
      className="ticket-msg"
      style={{ display: 'flex', justifyContent: tone.align as any }}
    >
      <div
        className="ticket-msg-bubble"
        style={{
          background: tone.bg,
          maxWidth: internal ? '100%' : '85%',
          borderRadius: 'var(--radius-md)',
          padding: '8px 12px',
          border: internal
            ? '1px dashed color-mix(in srgb, var(--warning) 40%, transparent)'
            : '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 4,
          }}
        >
          {internal && <StickyNote size={11} />}
          <span>
            {internal ? t('ticket.message.internal_note') : tone.label}
          </span>
          <span style={{ fontWeight: 400 }}>· {fmtRelative(m.created_at)}</span>
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5,
          }}
        >
          {m.body}
        </div>
      </div>
    </div>
  );
}

export function TicketsPage() {
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const { ticketId } = useParams({ strict: false }) as { ticketId?: string };

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  // Fetch error inline (role="alert" + retry) — additif §audit.
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Filtres
  const [fStatus, setFStatus] = useState<string>('');
  const [fAssigned, setFAssigned] = useState<string>('');
  const [fPriority, setFPriority] = useState<string>('');

  // Création (modale) — flux additif LOT G1.
  const [createOpen, setCreateOpen] = useState(false);

  // Détail (slide-over)
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<(Ticket & { messages: TicketMessage[] }) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await listTickets();
      if (res.data) setTickets(res.data);
      else if (res.error) setFetchError(res.error);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      setFetchError(t('common.error.load_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Param URL /tickets/$ticketId → ouvre le panneau sur ce ticket.
  useEffect(() => {
    if (ticketId) setOpenId(ticketId);
  }, [ticketId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    const res = await getTicket(id);
    if (res.data) setDetail(res.data);
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (openId) void loadDetail(openId);
    else setDetail(null);
  }, [openId, loadDetail]);

  const openTicket = (id: string) => {
    setOpenId(id);
    setReply('');
    setInternalNote(false);
    navigate({ to: '/tickets/$ticketId', params: { ticketId: id } }).catch(() => {});
  };

  const closePanel = (open: boolean) => {
    if (open) return;
    setOpenId(null);
    setDetail(null);
    if (ticketId) navigate({ to: '/tickets' }).catch(() => {});
  };

  // Options de filtres dérivées des données.
  const assignees = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((tk) => tk.assigned_to && set.add(tk.assigned_to));
    return [...set];
  }, [tickets]);
  const priorities = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((tk) => tk.priority && set.add(tk.priority));
    return [...set];
  }, [tickets]);

  const filtered = useMemo(
    () =>
      tickets.filter((tk) => {
        if (fStatus && tk.status !== fStatus) return false;
        if (fAssigned && (tk.assigned_to || '') !== fAssigned) return false;
        if (fPriority && (tk.priority || '') !== fPriority) return false;
        return true;
      }),
    [tickets, fStatus, fAssigned, fPriority],
  );

  // ── Actions détail (optimistic léger + reload sur succès) ──────────────────
  const patchTicket = async (patch: Partial<Ticket>) => {
    if (!detail) return;
    const prev = detail;
    setDetail({ ...detail, ...patch });
    const res = await updateTicket(detail.id, patch);
    if (res.error) {
      setDetail(prev);
      toastError(res.error);
      return;
    }
    // Reflète aussi dans la liste.
    setTickets((list) =>
      list.map((tk) => (tk.id === detail.id ? { ...tk, ...patch } : tk)),
    );
  };

  const sendReply = async () => {
    if (!detail || !reply.trim()) return;
    setSending(true);
    const res = await replyTicket(detail.id, {
      body: reply.trim(),
      is_internal: internalNote,
    });
    setSending(false);
    if (res.error) {
      toastError(res.error);
      return;
    }
    setReply('');
    setInternalNote(false);
    success(t('ticket.action.reply'));
    void loadDetail(detail.id);
    void load();
  };

  return (
    <AppLayout title={t('ticket.col.subject')}>
      <div className="page-tickets" style={{ padding: '4px 0' }}>
        {/* En-tête sobre Stripe (PageHero) + filtres en actions */}
        <PageHero
          compact
          meta="Support"
          title={t('ticket.col.subject')}
          description={t('ticket.list.count', { n: filtered.length })}
          actions={
            <>
              <Button
                size="sm"
                variant="primary"
                leftIcon={<Plus size={14} />}
                onClick={() => setCreateOpen(true)}
              >
                {t('ticketsx.create.action')}
              </Button>
              <Select
                size="sm"
                containerClassName="w-auto"
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
                aria-label={t('ticket.col.status')}
              >
                <option value="">{t('ticket.col.status')}</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </Select>
              <Select
                size="sm"
                containerClassName="w-auto"
                value={fAssigned}
                onChange={(e) => setFAssigned(e.target.value)}
                aria-label={t('ticket.col.assigned')}
              >
                <option value="">{t('ticket.col.assigned')}</option>
                {assignees.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
              {priorities.length > 0 && (
                <Select
                  size="sm"
                  containerClassName="w-auto"
                  value={fPriority}
                  onChange={(e) => setFPriority(e.target.value)}
                  aria-label={t('ticket.col.priority')}
                >
                  <option value="">{t('ticket.col.priority')}</option>
                  {priorities.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              )}
            </>
          }
        />

        {/* Erreur de chargement inline (additif §audit) — role="alert" + retry */}
        {fetchError && !loading && (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              borderRadius: 'var(--radius-md)',
              border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
              background: 'var(--danger-soft)',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--danger)' }}>{fetchError}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()}>{t('common.retry')}</Button>
          </div>
        )}

        {/* Liste / table */}
        <div aria-busy={loading} aria-live="polite">
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-[var(--radius-md)]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<LifeBuoy size={48} />}
              variant={tickets.length === 0 ? 'first-time' : 'filtered'}
              title={
                tickets.length === 0
                  ? t('ticket.empty.title')
                  : t('ticket.empty.filtered_title')
              }
              description={
                tickets.length === 0
                  ? t('ticket.empty.desc')
                  : undefined
              }
              action={
                tickets.length === 0 ? (
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Plus size={14} />}
                    onClick={() => setCreateOpen(true)}
                  >
                    {t('ticketsx.create.action')}
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Card className="!p-0 overflow-hidden stripe-card animate-stagger stagger-1">
            <div className="ticket-table" role="table">
              <div className="ticket-row ticket-row--head" role="row">
                <span role="columnheader">{t('ticket.col.subject')}</span>
                <span role="columnheader">{t('ticket.col.requester')}</span>
                <span role="columnheader">{t('ticket.col.status')}</span>
                <span role="columnheader">{t('ticket.col.assigned')}</span>
                <span role="columnheader">SLA</span>
                <span role="columnheader">{t('ticket.col.updated')}</span>
              </div>
              {filtered.map((tk) => {
                const urg = slaUrgency(tk);
                return (
                  <button
                    key={tk.id}
                    type="button"
                    className="ticket-row ticket-row--clickable"
                    role="row"
                    onClick={() => openTicket(tk.id)}
                  >
                    <span role="cell" className="ticket-cell-subject">
                      {tk.subject || t('ticket.subject.empty')}
                    </span>
                    <span role="cell" className="t-caption ticket-cell-truncate">
                      {tk.requester_name || tk.requester_email || '—'}
                    </span>
                    <span role="cell">
                      <Tag variant={STATUS_VARIANT[tk.status]} size="xs" statusIcon>
                        {statusLabel(tk.status)}
                      </Tag>
                    </span>
                    <span role="cell" className="t-caption ticket-cell-truncate">
                      {tk.assigned_to || '—'}
                    </span>
                    <span role="cell">
                      {urg ? (
                        <Tag variant={urg === 'overdue' ? 'danger' : 'warning'} size="xs" dot pulse>
                          {urg === 'overdue' ? t('ticket.sla.overdue') : t('ticket.sla.soon')}
                        </Tag>
                      ) : (
                        <span className="t-caption">
                          {slaLabel((tk.sla_level as SlaLevel) || 'none')}
                        </span>
                      )}
                    </span>
                    <span role="cell" className="t-caption" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtRelative(tk.last_message_at || tk.updated_at)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        )}
        </div>
      </div>

      {/* ── Slide-over détail ────────────────────────────────────────────── */}
      <SlidePanel
        open={!!openId}
        onOpenChange={closePanel}
        size="lg"
        title={detail?.subject || t('ticket.col.subject')}
        description={detail?.requester_name || detail?.requester_email || undefined}
        closeLabel={t('common.close')}
        headerActions={
          detail ? (
            <Tag variant={STATUS_VARIANT[detail.status]} size="sm" statusIcon>
              {statusLabel(detail.status)}
            </Tag>
          ) : undefined
        }
        footer={
          detail ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={
                  internalNote
                    ? t('ticket.reply.internal_placeholder')
                    : `${t('ticket.action.reply')}…`
                }
                rows={3}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label className="t-caption ticket-note-toggle">
                  <input
                    type="checkbox"
                    className="ticket-note-checkbox"
                    checked={internalNote}
                    onChange={(e) => setInternalNote(e.target.checked)}
                  />
                  <StickyNote size={13} /> {t('ticket.message.internal_note')}
                </label>
                <Button
                  variant="primary"
                  size="sm"
                  style={{ marginLeft: 'auto' }}
                  isLoading={sending}
                  disabled={!reply.trim()}
                  leftIcon={<Send size={14} />}
                  onClick={sendReply}
                >
                  {t('ticket.action.reply')}
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {detailLoading || !detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton className="h-16 w-3/4 rounded-[var(--radius-md)]" />
            <Skeleton className="h-16 w-2/3 rounded-[var(--radius-md)] self-end" />
            <Skeleton className="h-16 w-3/4 rounded-[var(--radius-md)]" />
          </div>
        ) : (
          <>
            {/* Bloc actions statut / assignation / SLA */}
            <div
              className="ticket-actions"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                paddingBottom: 14,
                marginBottom: 14,
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <Select
                size="sm"
                containerClassName="w-auto"
                label={t('ticket.col.status')}
                value={detail.status}
                onChange={(e) => patchTicket({ status: e.target.value as TicketStatus })}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </Select>
              <Select
                size="sm"
                containerClassName="w-auto"
                label={t('ticket.col.sla')}
                value={(detail.sla_level as SlaLevel) || 'none'}
                onChange={(e) => patchTicket({ sla_level: e.target.value as SlaLevel })}
              >
                {SLA_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {slaLabel(s)}
                  </option>
                ))}
              </Select>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                {detail.status !== 'escale' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => patchTicket({ status: 'escale' })}
                  >
                    {t('ticket.action.escalate')}
                  </Button>
                )}
                {detail.status !== 'resolu' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => patchTicket({ status: 'resolu' })}
                  >
                    {t('ticket.action.resolve')}
                  </Button>
                )}
              </div>
            </div>

            {/* Demande initiale (body du ticket) */}
            {detail.body && (
              <div style={{ marginBottom: 14 }}>
                <div className="t-label-form" style={{ marginBottom: 6 }}>
                  {t('ticket.detail.request')}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.5,
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 12px',
                  }}
                >
                  {detail.body}
                </div>
              </div>
            )}

            {/* Fil des messages */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(detail.messages || []).length === 0 ? (
                <p className="t-caption">{t('ticket.thread.empty')}</p>
              ) : (
                detail.messages.map((m) => <MessageRow key={m.id} m={m} />)
              )}
            </div>
          </>
        )}
      </SlidePanel>

      {/* ── Création de ticket (modale additive LOT G1) ──────────────────── */}
      <NewTicketModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setCreateOpen(false);
          success(t('ticketsx.create.success'));
          void load();
          openTicket(id);
        }}
      />
    </AppLayout>
  );
}
