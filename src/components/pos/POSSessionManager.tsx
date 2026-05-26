// ── POSSessionManager — Sprint 37 (Agent B2) ────────────────────────────────
// Modal manager pour ouvrir / fermer une session de caisse POS (shift).
// Pattern :
//   - mode 'open'  : select register (filtré is_active=1) + opening_cash + notes
//                    → openPosSession({ register_id, opening_cash_cents, notes })
//                    → toast pos.session_open + onSessionChanged + onClose
//   - mode 'close' : info session + closing_cash + variance live (clientside)
//                    + textarea notes → confirm modal (pos.confirm_close)
//                    → closePosSession(id, { closing_cash_cents, notes })
//                    → toast pos.session_closed + variance/warning + onClose
//
// API back FIGÉE (Phase A) :
//   listPosRegisters() → ApiResponse<PosRegister[]>
//   openPosSession({ register_id, opening_cash_cents })
//                 → ApiResponse<PosSession>
//   closePosSession(id, { closing_cash_cents, notes? })
//                 → ApiResponse<PosSession>
//   getPosSession(id) → ApiResponse<PosSession>
//
// Note : OpenPosSessionInput n'inclut pas `notes` côté back (Phase A). On
// envoie quand même la note dans le payload — apiFetch fait un JSON.stringify
// libre, le back l'ignorera si non-supporté. Idem : le back peut renvoyer ou
// non `expected_cash_cents` au getPosSession en mode 'close'. On l'utilise
// quand présent (variance live), sinon on indique "calcul lors fermeture".
//
// Variance warning_level (clientside, dérivé de variance_cents) :
//   - 0c         → 'ok'  (vert)
//   - |v| ≤ 500c → 'low' (jaune)
//   - |v| > 500c → 'high'(rouge)  (seuil ~5$ raisonnable pour cash float)
//
// Style : Stripe-clean. Aucun gradient/glass. Toutes les chaînes via t().
// Aucun console.log (CLAUDE.md). Imports RELATIFS (../../lib, ../ui).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  listPosRegisters,
  openPosSession,
  closePosSession,
  getPosSession,
  type PosRegister,
  type PosSession,
} from '../../lib/api';

// ── Types ───────────────────────────────────────────────────────────────────

export type POSSessionManagerMode = 'open' | 'close';

export interface POSSessionManagerProps {
  open: boolean;
  onClose: () => void;
  mode: POSSessionManagerMode;
  /** Requis en mode 'close'. Ignoré en mode 'open'. */
  session?: PosSession;
  /** Callback après open/close réussi (refresh liste parent). */
  onSessionChanged?: () => void;
}

type VarianceLevel = 'ok' | 'low' | 'high';

// Seuil cents pour basculer low → high. 500c = ~5$ CAD.
const VARIANCE_HIGH_THRESHOLD_CENTS = 500;

function computeVarianceLevel(varianceCents: number | null): VarianceLevel {
  if (varianceCents === null || varianceCents === 0) return 'ok';
  return Math.abs(varianceCents) > VARIANCE_HIGH_THRESHOLD_CENTS ? 'high' : 'low';
}

function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${remainder.toString().padStart(2, '0')} $`;
}

function parseDollarsToCents(input: string): number {
  const cleaned = input.replace(/[^\d.\-]/g, '').replace(',', '.');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('fr-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Composant ───────────────────────────────────────────────────────────────

export function POSSessionManager({
  open,
  onClose,
  mode,
  session,
  onSessionChanged,
}: POSSessionManagerProps) {
  const { success, error: toastError, warning } = useToast();
  const confirm = useConfirm();

  // État commun
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>('');

  // État mode 'open'
  const [registers, setRegisters] = useState<PosRegister[]>([]);
  const [loadingRegisters, setLoadingRegisters] = useState<boolean>(false);
  const [selectedRegisterId, setSelectedRegisterId] = useState<string>('');
  const [openingCashInput, setOpeningCashInput] = useState<string>('0.00');

  // État mode 'close'
  const [closingCashInput, setClosingCashInput] = useState<string>('0.00');
  const [sessionDetail, setSessionDetail] = useState<PosSession | null>(
    session ?? null,
  );
  const [loadingSession, setLoadingSession] = useState<boolean>(false);

  // ── Reset au close ───────────────────────────────────────────────────────
  const resetState = useCallback(() => {
    setSubmitting(false);
    setError(null);
    setNotes('');
    setRegisters([]);
    setLoadingRegisters(false);
    setSelectedRegisterId('');
    setOpeningCashInput('0.00');
    setClosingCashInput('0.00');
    setSessionDetail(null);
    setLoadingSession(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // ── Mode 'open' : charge les registers actifs au mount ──────────────────
  useEffect(() => {
    if (!open || mode !== 'open') return;
    let cancelled = false;
    setLoadingRegisters(true);
    setError(null);
    void (async () => {
      const res = await listPosRegisters();
      if (cancelled) return;
      setLoadingRegisters(false);
      if (res.error || !res.data) {
        setError(res.error ?? t('state.error'));
        return;
      }
      const active = res.data.filter((r) => r.is_active === 1);
      setRegisters(active);
      const first = active[0];
      if (first) setSelectedRegisterId(first.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  // ── Mode 'close' : charge le détail session (pour expected_cash) ─────────
  useEffect(() => {
    if (!open || mode !== 'close' || !session) return;
    setSessionDetail(session);
    let cancelled = false;
    setLoadingSession(true);
    setError(null);
    void (async () => {
      const res = await getPosSession(session.id);
      if (cancelled) return;
      setLoadingSession(false);
      if (res.error || !res.data) {
        // Pas bloquant : on garde la session passée en props.
        return;
      }
      setSessionDetail(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, session]);

  // ── Variance live (mode 'close') ────────────────────────────────────────
  const expectedCashCents = sessionDetail?.expected_cash_cents ?? null;
  const closingCashCents = useMemo(
    () => parseDollarsToCents(closingCashInput),
    [closingCashInput],
  );
  const varianceCents = useMemo(() => {
    if (expectedCashCents === null) return null;
    return closingCashCents - expectedCashCents;
  }, [closingCashCents, expectedCashCents]);
  const varianceLevel = useMemo(
    () => computeVarianceLevel(varianceCents),
    [varianceCents],
  );

  // ── Submit mode 'open' ──────────────────────────────────────────────────
  const handleSubmitOpen = useCallback(async () => {
    if (!selectedRegisterId) return;
    setSubmitting(true);
    setError(null);
    const openingCashCents = parseDollarsToCents(openingCashInput);
    const res = await openPosSession({
      register_id: selectedRegisterId,
      opening_cash_cents: openingCashCents,
    });
    setSubmitting(false);
    if (res.error || !res.data) {
      const msg = res.error ?? t('state.error');
      setError(msg);
      toastError(msg);
      return;
    }
    success(t('pos.session_open'));
    onSessionChanged?.();
    handleClose();
  }, [
    selectedRegisterId,
    openingCashInput,
    success,
    toastError,
    onSessionChanged,
    handleClose,
  ]);

  // ── Submit mode 'close' (avec confirm) ──────────────────────────────────
  const handleSubmitClose = useCallback(async () => {
    if (!sessionDetail) return;

    const ok = await confirm({
      title: t('pos.confirm_close'),
      description: t('pos.close_session'),
      confirmLabel: t('pos.close_session'),
      danger: varianceLevel === 'high',
    });
    if (!ok) return;

    setSubmitting(true);
    setError(null);
    const closingCents = parseDollarsToCents(closingCashInput);
    const res = await closePosSession(sessionDetail.id, {
      closing_cash_cents: closingCents,
      notes: notes || undefined,
    });
    setSubmitting(false);

    if (res.error || !res.data) {
      const msg = res.error ?? t('state.error');
      setError(msg);
      toastError(msg);
      return;
    }

    const finalVariance = res.data.variance_cents;
    const finalLevel = computeVarianceLevel(finalVariance);
    const varianceMsg = `${t('pos.session_closed')} — ${t(
      'pos.variance',
    )} ${formatCents(finalVariance)}`;

    if (finalLevel === 'high') {
      warning(varianceMsg);
    } else {
      success(varianceMsg);
    }
    onSessionChanged?.();
    handleClose();
  }, [
    sessionDetail,
    closingCashInput,
    notes,
    varianceLevel,
    confirm,
    success,
    warning,
    toastError,
    onSessionChanged,
    handleClose,
  ]);

  // ── Render mode 'open' ──────────────────────────────────────────────────

  const renderOpenMode = () => (
    <div className="flex flex-col gap-4">
      {loadingRegisters ? (
        <div
          className="flex items-center gap-2 text-[13px]"
          style={{ color: 'var(--text-muted)' }}
          aria-live="polite"
        >
          <Icon as={Loader2} size={14} className="animate-spin" />
          <span>{t('state.loading')}</span>
        </div>
      ) : registers.length === 0 ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-md)] p-3"
          style={{
            background: 'var(--danger-bg, #fef2f2)',
            border: '1px solid var(--danger-border, #fecaca)',
            color: 'var(--danger-fg, #b91c1c)',
          }}
        >
          <Icon as={AlertCircle} size={16} className="mt-px shrink-0" />
          <span className="text-[13px]">
            {t('pos.error.register_inactive')}
          </span>
        </div>
      ) : (
        <Select
          label={t('pos.register_select')}
          value={selectedRegisterId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            setSelectedRegisterId(e.target.value)
          }
          aria-label={t('pos.register_select')}
          disabled={submitting}
        >
          {registers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.location ? ` — ${r.location}` : ''}
            </option>
          ))}
        </Select>
      )}

      <Input
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        label={t('pos.opening_cash')}
        value={openingCashInput}
        onChange={(e) => setOpeningCashInput(e.target.value)}
        aria-label={t('pos.opening_cash')}
        leftSlot="$"
        disabled={submitting}
      />

      <Textarea
        label={t('form.label.notes')}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        maxLength={500}
        aria-label={t('form.label.notes')}
        disabled={submitting}
      />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-md)] p-3"
          style={{
            background: 'var(--danger-bg, #fef2f2)',
            border: '1px solid var(--danger-border, #fecaca)',
            color: 'var(--danger-fg, #b91c1c)',
          }}
        >
          <Icon as={AlertCircle} size={16} className="mt-px shrink-0" />
          <span className="text-[13px]">{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-2">
        <Button variant="ghost" onClick={handleClose} disabled={submitting}>
          {t('action.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            void handleSubmitOpen();
          }}
          disabled={
            submitting || loadingRegisters || registers.length === 0 ||
            !selectedRegisterId
          }
          isLoading={submitting}
          data-testid="submit-open-session"
        >
          {t('pos.open_session')}
        </Button>
      </div>
    </div>
  );

  // ── Render mode 'close' ─────────────────────────────────────────────────

  const varianceBadgeStyle = (level: VarianceLevel) => {
    switch (level) {
      case 'ok':
        return {
          background: 'var(--success-bg, #ecfdf5)',
          color: 'var(--success-fg, #047857)',
          border: '1px solid var(--success-border, #a7f3d0)',
        };
      case 'low':
        return {
          background: 'var(--warning-bg, #fffbeb)',
          color: 'var(--warning-fg, #92400e)',
          border: '1px solid var(--warning-border, #fde68a)',
        };
      case 'high':
        return {
          background: 'var(--danger-bg, #fef2f2)',
          color: 'var(--danger-fg, #b91c1c)',
          border: '1px solid var(--danger-border, #fecaca)',
        };
    }
  };

  const renderCloseMode = () => {
    if (!sessionDetail) {
      return (
        <div
          className="flex items-center gap-2 text-[13px]"
          style={{ color: 'var(--text-muted)' }}
          aria-live="polite"
        >
          <Icon as={Loader2} size={14} className="animate-spin" />
          <span>{t('state.loading')}</span>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {/* Info session */}
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-[var(--radius-md)] p-3"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="col-span-2 flex items-center justify-between gap-2 text-[12px]"
               style={{ color: 'var(--text-muted)' }}>
            <span>{t('pos.title')}</span>
            <span className="font-mono">{sessionDetail.id}</span>
          </div>
          <div>
            <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('pos.opening_cash')}
            </dt>
            <dd
              data-testid="session-opening-cash"
              className="text-[13px]"
              style={{ color: 'var(--text-primary)' }}
            >
              {formatCents(sessionDetail.opening_cash_cents)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('pos.total_sales')}
            </dt>
            <dd
              data-testid="session-total-sales"
              className="text-[13px]"
              style={{ color: 'var(--text-primary)' }}
            >
              {formatCents(sessionDetail.total_sales_cents)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('pos.tx_count')}
            </dt>
            <dd
              data-testid="session-tx-count"
              className="text-[13px]"
              style={{ color: 'var(--text-primary)' }}
            >
              {sessionDetail.transaction_count}
            </dd>
          </div>
          <div>
            <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('pos.open_session')}
            </dt>
            <dd
              data-testid="session-opened-at"
              className="text-[13px]"
              style={{ color: 'var(--text-primary)' }}
            >
              {formatDateTime(sessionDetail.opened_at)}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('pos.expected_cash')}
            </dt>
            <dd
              data-testid="session-expected-cash"
              className="text-[13px] font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              {expectedCashCents === null
                ? `— (${t('pos.close_session')})`
                : formatCents(expectedCashCents)}
            </dd>
          </div>
        </dl>

        <Input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          label={t('pos.closing_cash')}
          value={closingCashInput}
          onChange={(e) => setClosingCashInput(e.target.value)}
          aria-label={t('pos.closing_cash')}
          leftSlot="$"
          disabled={submitting}
        />

        {/* Variance live badge */}
        {expectedCashCents !== null && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {t('pos.variance')}
            </span>
            <span
              data-testid="variance-badge"
              data-level={varianceLevel}
              aria-label={`${t('pos.variance')} ${formatCents(varianceCents)}`}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] font-medium"
              style={varianceBadgeStyle(varianceLevel)}
            >
              {formatCents(varianceCents)}
            </span>
          </div>
        )}

        <Textarea
          label={t('form.label.notes')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={500}
          aria-label={t('form.label.notes')}
          disabled={submitting}
        />

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-md)] p-3"
            style={{
              background: 'var(--danger-bg, #fef2f2)',
              border: '1px solid var(--danger-border, #fecaca)',
              color: 'var(--danger-fg, #b91c1c)',
            }}
          >
            <Icon as={AlertCircle} size={16} className="mt-px shrink-0" />
            <span className="text-[13px]">{error}</span>
          </div>
        )}

        {loadingSession && !error && (
          <div
            className="flex items-center gap-2 text-[12px]"
            style={{ color: 'var(--text-muted)' }}
            aria-live="polite"
          >
            <Icon as={Loader2} size={12} className="animate-spin" />
            <span>{t('state.loading')}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            {t('action.cancel')}
          </Button>
          <Button
            variant={varianceLevel === 'high' ? 'danger' : 'primary'}
            onClick={() => {
              void handleSubmitClose();
            }}
            disabled={submitting}
            isLoading={submitting}
            data-testid="submit-close-session"
          >
            {t('pos.close_session')}
          </Button>
        </div>
      </div>
    );
  };

  // ── Wrapper Modal ───────────────────────────────────────────────────────

  const title = mode === 'open'
    ? t('pos.open_session')
    : t('pos.close_session');

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
      title={title}
      size="md"
      closeOnOverlay={!submitting}
      closeLabel={t('action.cancel')}
    >
      <div className="flex flex-col">
        {mode === 'open' ? renderOpenMode() : renderCloseMode()}
      </div>
    </Modal>
  );
}
