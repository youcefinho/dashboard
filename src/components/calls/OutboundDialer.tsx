// ── OutboundDialer — Sprint 34 (Agent B1) ───────────────────────────────────
// Click-to-call dialer Stripe-clean : input E.164 + numpad 3x4 (1-9, *, 0, #)
// + backspace + toggle "Enregistrer cet appel" + checkbox CRTC consent
// (conditionnelle). Sécurité : aucun client_id envoyé (tenant re-borné worker-
// side). Si Twilio non configuré → worker répond `{ mock: true }` dans `data`
// (call_log row créé quand même), on affiche le toast `voice.outbound.mock`.
//
// API publique :
//   <OutboundDialer leadId="lead_xxx?" onCallPlaced={(callLogId) => …} />
//
// Imports RELATIFS uniquement (consigne Sprint 34 — pas d'alias `@/`).
import { useCallback, useId, useMemo, useState } from 'react';
import { Phone, Delete, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Icon } from '../ui/Icon';
import { Switch } from '../ui/Switch';
import { useToast } from '../ui/Toast';
import { initiateOutboundCall } from '../../lib/api';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';

export interface OutboundDialerProps {
  /** Lead lié à l'appel (optionnel — appel cold dial sinon). */
  leadId?: string;
  /** Callback quand l'appel est initié avec succès (réel ou mock). */
  onCallPlaced?: (result: { id: string | null; mock: boolean }) => void;
  className?: string;
}

// E.164 strict : optional leading + then 1-9 + 6-14 digits (total 7-15 digits).
// (`+` accepté dans l'UI, le worker normalise.)
const E164_REGEX = /^\+?[1-9]\d{6,14}$/;
const DIALPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const;

export function OutboundDialer({
  leadId,
  onCallPlaced,
  className,
}: OutboundDialerProps) {
  const [number, setNumber] = useState<string>('');
  const [record, setRecord] = useState<boolean>(false);
  const [consent, setConsent] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const toast = useToast();
  const reactId = useId();
  const consentId = `dialer-consent-${reactId}`;
  const numberInputId = `dialer-number-${reactId}`;

  const numberIsValid = useMemo(() => E164_REGEX.test(number.trim()), [number]);

  // Bouton désactivé si :
  //   - numéro vide ou format invalide
  //   - on enregistre mais le consentement n'est pas coché
  //   - submission en cours
  const callDisabled =
    !numberIsValid || submitting || (record && !consent);

  const handleAppend = useCallback((key: string) => {
    setNumber((prev) => (prev + key).slice(0, 16));
  }, []);

  const handleBackspace = useCallback(() => {
    setNumber((prev) => prev.slice(0, -1));
  }, []);

  const handleRecordToggle = useCallback((next: boolean) => {
    setRecord(next);
    // Si on éteint le record, on reset le consent pour éviter qu'il reste
    // coché "fantôme" lors d'un futur toggle ON.
    if (!next) setConsent(false);
  }, []);

  const handleCall = useCallback(async () => {
    if (callDisabled) return;
    setSubmitting(true);
    try {
      const res = await initiateOutboundCall({
        to: number.trim(),
        ...(leadId ? { lead_id: leadId } : {}),
        record,
        ...(record ? { consent_obtained: consent } : {}),
      });

      if (res.error) {
        // Erreur worker : "no_number" si validation côté worker rejette,
        // sinon erreur générique.
        const isNoNumber = /no.?number|aucun.?num/i.test(res.error);
        toast.error(
          isNoNumber ? t('voice.outbound.no_number') : t('voice.outbound.failed'),
        );
        return;
      }

      const data = res.data;
      const isMock = Boolean(data?.mock);

      if (isMock) {
        // Twilio désactivé côté worker → call_log row créée mais pas d'appel
        // réel. On affiche `voice.outbound.mock` (warning).
        toast.warning(t('voice.outbound.mock'));
      } else {
        toast.success(t('voice.outbound.success'));
      }

      onCallPlaced?.({ id: data?.id ?? null, mock: isMock });

      // Reset state APRÈS succès (mock OU réel).
      setNumber('');
      setRecord(false);
      setConsent(false);
    } catch {
      toast.error(t('voice.outbound.failed'));
    } finally {
      setSubmitting(false);
    }
  }, [callDisabled, consent, leadId, number, onCallPlaced, record, toast]);

  return (
    <div
      className={cn(
        'flex flex-col gap-4 p-5 rounded-[var(--radius-md)]',
        'border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)]',
        'w-full max-w-sm mx-auto',
        className,
      )}
      data-testid="outbound-dialer"
    >
      <header className="flex items-center gap-2">
        <Icon as={Phone} size="sm" className="text-[var(--primary)]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          {t('voice.outbound.cta')}
        </h2>
      </header>

      {/* ── Input numéro E.164 ──────────────────────────────────────── */}
      <Input
        id={numberInputId}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={number}
        placeholder="+1 514 555 1234"
        onChange={(e) => setNumber(e.target.value)}
        aria-label={t('voice.outbound.cta')}
        data-testid="dialer-number-input"
        size="lg"
        className="text-center font-mono tracking-wider"
      />

      {/* ── Numpad 3x4 ─────────────────────────────────────────────── */}
      <div
        className="grid grid-cols-3 gap-2"
        role="group"
        aria-label={t('voice.outbound.cta')}
        data-testid="dialer-numpad"
      >
        {DIALPAD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => handleAppend(key)}
            disabled={submitting}
            data-testid={`dialer-key-${key}`}
            aria-label={key}
            className={cn(
              'inline-flex items-center justify-center h-12 rounded-[var(--radius-md)]',
              'border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]',
              'text-base font-medium tabular-nums',
              'shadow-[var(--shadow-xs)]',
              'hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
              'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]',
              'transition-colors duration-150',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {key}
          </button>
        ))}
      </div>

      {/* ── Backspace ─────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackspace}
          disabled={!number || submitting}
          leftIcon={<Icon as={Delete} size="sm" />}
          aria-label="backspace"
          data-testid="dialer-backspace"
        >
          ⌫
        </Button>
      </div>

      {/* ── Toggle enregistrer ────────────────────────────────────── */}
      <Switch
        checked={record}
        onCheckedChange={handleRecordToggle}
        label={t('voice.outbound.record_toggle')}
        variant="brand"
        disabled={submitting}
        id={`dialer-record-${reactId}`}
      />

      {/* ── Consent CRTC (conditionnel sur record) ────────────────── */}
      {record && (
        <label
          htmlFor={consentId}
          className={cn(
            'flex items-start gap-2 p-3 rounded-[var(--radius-md)]',
            'border border-[var(--border)] bg-[var(--bg-subtle)]',
            'text-xs text-[var(--text-secondary)] cursor-pointer',
          )}
          data-testid="dialer-consent-wrap"
        >
          <input
            id={consentId}
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={submitting}
            aria-label={t('voice.outbound.consent_required')}
            data-testid="dialer-consent-checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
          />
          <span>{t('voice.outbound.consent_required')}</span>
        </label>
      )}

      {/* ── Bouton primary "Appeler" ───────────────────────────────── */}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        onClick={handleCall}
        disabled={callDisabled}
        leftIcon={
          submitting
            ? <Icon as={Loader2} size="sm" className="animate-spin" />
            : <Icon as={Phone} size="sm" />
        }
        aria-label={t('voice.outbound.cta')}
        data-testid="dialer-call-button"
        className={cn(
          // Vert (success) Stripe-clean override sur primary
          !callDisabled && 'bg-[var(--success)] hover:brightness-[1.03]',
        )}
      >
        {submitting ? t('voice.outbound.calling') : t('voice.outbound.cta')}
      </Button>
    </div>
  );
}

export default OutboundDialer;
