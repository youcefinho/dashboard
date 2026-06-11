// ── LoyaltyProgramSettings — Sprint 38 (Agent B2) ───────────────────────────
// Formulaire create/edit d'un programme de fidélité (Loyalty).
//
// API back FIGÉE (Phase A) :
//   getLoyaltyPrograms()                          → ApiResponse<LoyaltyProgram[]>
//   createLoyaltyProgram(CreateLoyaltyProgramInput)  → ApiResponse<LoyaltyProgram>
//   updateLoyaltyProgram(id, UpdateLoyaltyProgramInput) → ApiResponse<LoyaltyProgram>
//   deleteLoyaltyProgram(id)                      → ApiResponse<{ ok: true }>
//
// Props : { programId?: string; onSaved?: () => void }
// Style : Stripe-clean, flat surfaces, focus ring brand. Toutes les chaînes via t().
// Aucun console.log (CLAUDE.md). aria-labels i18n sur chaque champ.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { Save, Award } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import {
  getLoyaltyPrograms,
  createLoyaltyProgram,
  updateLoyaltyProgram,
} from '../../lib/api';

// ── Defaults ──────────────────────────────────────────────────────────────
// Centralisés pour réuse dans reset() et test snapshots.

const DEFAULT_EARN_RATE = 1;
const DEFAULT_REDEEM_RATE_CENTS = 1;
const DEFAULT_MIN_REDEEM = 100;

const DEFAULT_TIER_THRESHOLDS: Record<string, number> = {
  bronze: 0,
  silver: 500,
  gold: 2000,
};

const DEFAULT_TIER_BENEFITS: Record<string, { earn_multiplier: number }> = {
  gold: { earn_multiplier: 2.0 },
};

// ── Helpers ───────────────────────────────────────────────────────────────

/** Parse JSON safe → renvoie null si invalide. */
function parseJsonOrNull<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Coerce string → finite number ou fallback. Tolère virgule décimale FR-CA. */
function parseNumber(raw: string, fallback: number): number {
  const cleaned = raw.replace(',', '.').trim();
  if (cleaned === '') return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce string → positive int ou null si vide. */
function parseOptionalInt(raw: string): number | null {
  const cleaned = raw.trim();
  if (cleaned === '') return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Composant ─────────────────────────────────────────────────────────────

export interface LoyaltyProgramSettingsProps {
  programId?: string;
  onSaved?: () => void;
}

export function LoyaltyProgramSettings({
  programId,
  onSaved,
}: LoyaltyProgramSettingsProps) {
  const { success, error: toastError } = useToast();

  const mode: 'create' | 'edit' = programId ? 'edit' : 'create';

  // ── Form state ────────────────────────────────────────────────────────
  const [name, setName] = useState<string>('');
  const [earnRate, setEarnRate] = useState<string>(String(DEFAULT_EARN_RATE));
  const [redeemRate, setRedeemRate] = useState<string>(
    String(DEFAULT_REDEEM_RATE_CENTS),
  );
  const [minRedeem, setMinRedeem] = useState<string>(String(DEFAULT_MIN_REDEEM));
  const [expiryDays, setExpiryDays] = useState<string>(''); // '' = null = jamais
  const [tierThresholdsJson, setTierThresholdsJson] = useState<string>(
    JSON.stringify(DEFAULT_TIER_THRESHOLDS, null, 2),
  );
  const [tierBenefitsJson, setTierBenefitsJson] = useState<string>(
    JSON.stringify(DEFAULT_TIER_BENEFITS, null, 2),
  );
  const [isActive, setIsActive] = useState<boolean>(true);

  // UI state
  const [loading, setLoading] = useState<boolean>(mode === 'edit');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [thresholdsError, setThresholdsError] = useState<string | null>(null);
  const [benefitsError, setBenefitsError] = useState<string | null>(null);

  // ── Load existing program si edit ──────────────────────────────────────
  useEffect(() => {
    if (!programId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const res = await getLoyaltyPrograms();
      if (cancelled) return;
      if (res.error) {
        toastError(res.error);
        setLoading(false);
        return;
      }
      const found = (res.data ?? []).find((p) => p.id === programId);
      if (!found) {
        toastError(t('loyalty.errors.programInactive'));
        setLoading(false);
        return;
      }
      setName(found.name);
      setEarnRate(String(found.earn_rate_per_dollar));
      setRedeemRate(String(found.redeem_rate_cents_per_point));
      setMinRedeem(String(found.min_redeem_points));
      setExpiryDays(
        found.points_expiry_days === null
          ? ''
          : String(found.points_expiry_days),
      );
      if (found.tier_thresholds_json) {
        // Re-format pour l'éditeur.
        const parsed = parseJsonOrNull<Record<string, number>>(
          found.tier_thresholds_json,
        );
        setTierThresholdsJson(
          parsed
            ? JSON.stringify(parsed, null, 2)
            : found.tier_thresholds_json,
        );
      }
      if (found.tier_benefits_json) {
        const parsed = parseJsonOrNull<Record<string, unknown>>(
          found.tier_benefits_json,
        );
        setTierBenefitsJson(
          parsed ? JSON.stringify(parsed, null, 2) : found.tier_benefits_json,
        );
      }
      setIsActive(found.is_active === 1);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [programId, toastError]);

  // ── Live aide : 1 point = X $ ────────────────────────────────────────
  const redeemHelperText = useMemo(() => {
    const cents = parseNumber(redeemRate, DEFAULT_REDEEM_RATE_CENTS);
    const dollars = (cents / 100).toFixed(2);
    return `${t('loyalty.redeem.helper')} : 1 ${t('loyalty.points')} = ${dollars} $`;
  }, [redeemRate]);

  // ── Validate JSON editors ────────────────────────────────────────────
  const handleThresholdsChange = useCallback((raw: string) => {
    setTierThresholdsJson(raw);
    if (raw.trim() === '') {
      setThresholdsError(null);
      return;
    }
    try {
      JSON.parse(raw);
      setThresholdsError(null);
    } catch {
      setThresholdsError(t('loyalty.tier.thresholdsInvalid'));
    }
  }, []);

  const handleBenefitsChange = useCallback((raw: string) => {
    setTierBenefitsJson(raw);
    if (raw.trim() === '') {
      setBenefitsError(null);
      return;
    }
    try {
      JSON.parse(raw);
      setBenefitsError(null);
    } catch {
      setBenefitsError(t('loyalty.tier.benefitsInvalid'));
    }
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmedName = name.trim();
      if (!trimmedName) return;
      if (thresholdsError || benefitsError) return;

      const payloadBase = {
        name: trimmedName,
        earn_rate_per_dollar: parseNumber(earnRate, DEFAULT_EARN_RATE),
        redeem_rate_cents_per_point: parseNumber(
          redeemRate,
          DEFAULT_REDEEM_RATE_CENTS,
        ),
        min_redeem_points: parseNumber(minRedeem, DEFAULT_MIN_REDEEM),
        points_expiry_days: parseOptionalInt(expiryDays),
        tier_thresholds_json: tierThresholdsJson.trim(),
        tier_benefits_json: tierBenefitsJson.trim(),
      };

      setSubmitting(true);
      if (mode === 'edit' && programId) {
        const res = await updateLoyaltyProgram(programId, {
          ...payloadBase,
          is_active: isActive ? 1 : 0,
        });
        setSubmitting(false);
        if (res.error) {
          toastError(res.error);
          return;
        }
        success(t('loyalty.program.updated'));
        onSaved?.();
      } else {
        const res = await createLoyaltyProgram(payloadBase);
        setSubmitting(false);
        if (res.error) {
          toastError(res.error);
          return;
        }
        success(t('loyalty.program.created'));
        onSaved?.();
      }
    },
    [
      name,
      earnRate,
      redeemRate,
      minRedeem,
      expiryDays,
      tierThresholdsJson,
      tierBenefitsJson,
      isActive,
      mode,
      programId,
      thresholdsError,
      benefitsError,
      success,
      toastError,
      onSaved,
    ],
  );

  // ── Render loading skeleton ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6" data-testid="loyalty-program-loading">
        <Skeleton className="h-7 w-64" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      </div>
    );
  }

  const submitLabel =
    mode === 'edit'
      ? t('loyalty.program.save')
      : t('loyalty.program.create');

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
      data-testid="loyalty-program-settings"
      aria-label={t('loyalty.program.formAria')}
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2 flex items-center gap-2">
            <Icon as={Award} size="md" />
            {mode === 'edit'
              ? t('loyalty.program.editTitle')
              : t('loyalty.program.createTitle')}
          </h2>
          <p className="t-caption text-[var(--gray-500)] mt-1">
            {t('loyalty.program.description')}
          </p>
        </div>
      </header>

      {/* Section : Identité */}
      <section className="space-y-4">
        <div>
          <label
            htmlFor="loyalty-name"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('loyalty.program.name')}
          </label>
          <Input
            id="loyalty-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            aria-label={t('loyalty.program.name')}
            data-testid="loyalty-name-input"
          />
        </div>
      </section>

      {/* Section : Earn / Redeem rates */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="loyalty-earn-rate"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('loyalty.earn.rate')}
          </label>
          <Input
            id="loyalty-earn-rate"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={earnRate}
            onChange={(e) => setEarnRate(e.target.value)}
            aria-label={t('loyalty.earn.rate')}
            data-testid="loyalty-earn-rate-input"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('loyalty.earn.helper')}
          </p>
        </div>
        <div>
          <label
            htmlFor="loyalty-redeem-rate"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('loyalty.redeem.rate')}
          </label>
          <Input
            id="loyalty-redeem-rate"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={redeemRate}
            onChange={(e) => setRedeemRate(e.target.value)}
            aria-label={t('loyalty.redeem.rate')}
            data-testid="loyalty-redeem-rate-input"
          />
          <p
            className="text-xs text-[var(--text-muted)] mt-1"
            data-testid="loyalty-redeem-helper"
          >
            {redeemHelperText}
          </p>
        </div>
      </section>

      {/* Section : Min redeem / Expiry */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="loyalty-min-redeem"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('loyalty.redeem.min')}
          </label>
          <Input
            id="loyalty-min-redeem"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={minRedeem}
            onChange={(e) => setMinRedeem(e.target.value)}
            aria-label={t('loyalty.redeem.min')}
            data-testid="loyalty-min-redeem-input"
          />
        </div>
        <div>
          <label
            htmlFor="loyalty-expiry"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('loyalty.expiry.days')}
          </label>
          <Input
            id="loyalty-expiry"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
            placeholder={t('loyalty.expiry.placeholder')}
            aria-label={t('loyalty.expiry.days')}
            data-testid="loyalty-expiry-input"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {t('loyalty.expiry.helper')}
          </p>
        </div>
      </section>

      {/* Section : Tier thresholds (JSON editor) */}
      <section className="space-y-2">
        <label
          htmlFor="loyalty-tier-thresholds"
          className="text-sm font-medium text-[var(--text-secondary)] block"
        >
          {t('loyalty.tier.thresholds')}
        </label>
        <Textarea
          id="loyalty-tier-thresholds"
          value={tierThresholdsJson}
          onChange={(e) => handleThresholdsChange(e.target.value)}
          rows={5}
          spellCheck={false}
          aria-label={t('loyalty.tier.thresholds')}
          data-testid="loyalty-tier-thresholds-input"
          className="font-mono text-sm"
        />
        {thresholdsError ? (
          <p
            className="text-xs text-rose-600"
            data-testid="loyalty-tier-thresholds-error"
            role="alert"
          >
            {thresholdsError}
          </p>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            {t('loyalty.tier.thresholdsHelper')}
          </p>
        )}
      </section>

      {/* Section : Tier benefits (JSON editor) */}
      <section className="space-y-2">
        <label
          htmlFor="loyalty-tier-benefits"
          className="text-sm font-medium text-[var(--text-secondary)] block"
        >
          {t('loyalty.tier.benefits')}
        </label>
        <Textarea
          id="loyalty-tier-benefits"
          value={tierBenefitsJson}
          onChange={(e) => handleBenefitsChange(e.target.value)}
          rows={5}
          spellCheck={false}
          aria-label={t('loyalty.tier.benefits')}
          data-testid="loyalty-tier-benefits-input"
          className="font-mono text-sm"
        />
        {benefitsError ? (
          <p
            className="text-xs text-rose-600"
            data-testid="loyalty-tier-benefits-error"
            role="alert"
          >
            {benefitsError}
          </p>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            {t('loyalty.tier.benefitsHelper')}
          </p>
        )}
      </section>

      {/* Section : is_active toggle (edit mode only — create = always active) */}
      {mode === 'edit' ? (
        <section
          className="flex items-center justify-between gap-4 p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
          data-testid="loyalty-active-section"
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('loyalty.program.active')}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {t('loyalty.program.activeHelper')}
            </p>
          </div>
          <Switch
            checked={isActive}
            onCheckedChange={setIsActive}
            aria-label={t('loyalty.program.active')}
            data-testid="loyalty-active-toggle"
            id="loyalty-active"
          />
        </section>
      ) : null}

      {/* Footer actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="submit"
          isLoading={submitting}
          disabled={
            submitting ||
            !name.trim() ||
            !!thresholdsError ||
            !!benefitsError
          }
          leftIcon={<Icon as={Save} size="sm" />}
          aria-label={submitLabel}
          data-testid="loyalty-submit-button"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export default LoyaltyProgramSettings;
