// ── MfaSettings — Authentification à deux facteurs (2FA / TOTP) ──────────────
// Surface du flux MFA déjà câblé côté API (totpSetup / totpVerify / totpDisable)
// mais sans écran jusqu'ici. 100 % additif : nouveau composant enfant rendu dans
// l'onglet « Sécurité & Sessions » des réglages (à côté de <SecuritySettings/>).
//
// Flux :
//   - Activation : totpSetup() → secret + otpauth_url affichés → saisie du code à
//     6 chiffres → totpVerify(token) → état activé.
//   - Désactivation : confirm dialog → saisie code/mot de passe → totpDisable().
//
// i18n : toutes les chaînes via t('mfa.<key>'). Aucun catalogue édité ici.
import { useState } from 'react';
import { Card, Button, Input, Icon, useToast, useConfirm } from '@/components/ui';
import { totpSetup, totpVerify, totpDisable } from '@/lib/api';
import { ShieldCheck, KeyRound, Copy, Check } from 'lucide-react';
import { t } from '@/lib/i18n';

// Étapes du flux d'activation.
type SetupStep = 'idle' | 'setup' | 'verify';

export function MfaSettings() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [enabled, setEnabled] = useState(false);
  const [step, setStep] = useState<SetupStep>('idle');

  // Données renvoyées par totpSetup()
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');

  // Saisie code de vérification (6 chiffres)
  const [code, setCode] = useState('');

  // États transverses
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  const resetSetup = () => {
    setStep('idle');
    setSecret('');
    setOtpauthUrl('');
    setCode('');
    setError(null);
    setSecretCopied(false);
  };

  // ── Étape 1 — démarrer l'activation (totpSetup) ──
  const handleStartSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await totpSetup();
      // Parsing défensif : on n'avance que si un secret exploitable est présent.
      const secretVal = typeof res.data?.secret === 'string' ? res.data.secret : '';
      const otpauthVal = typeof res.data?.otpauth_url === 'string' ? res.data.otpauth_url : '';
      if (res.data && secretVal) {
        setSecret(secretVal);
        setOtpauthUrl(otpauthVal);
        setStep('setup');
      } else {
        setError(res.error || t('mfa.error.setup_failed'));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('mfa.error.setup_failed'));
    } finally {
      setBusy(false);
    }
  };

  // ── Étape 2 — vérifier le code (totpVerify) ──
  const handleVerify = async () => {
    if (code.trim().length !== 6) {
      setError(t('mfa.error.code_length'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await totpVerify(code.trim());
      if (res.data?.enabled) {
        setEnabled(true);
        resetSetup();
        success(t('mfa.toast.enabled'));
      } else if (res.error) {
        setError(res.error);
      } else {
        setError(t('mfa.error.invalid_code'));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('mfa.error.invalid_code'));
    } finally {
      setBusy(false);
    }
  };

  // ── Désactivation (totpDisable) ──
  const handleDisable = async () => {
    const ok = await confirm({
      title: t('mfa.disable.confirm_title'),
      description: t('mfa.disable.confirm_desc'),
      confirmLabel: t('mfa.disable.confirm_label'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await totpDisable(code.trim() ? { token: code.trim() } : {});
      if (res.data && res.data.enabled === false) {
        setEnabled(false);
        setCode('');
        success(t('mfa.toast.disabled'));
      } else if (res.error) {
        setError(res.error);
        toastError(res.error);
      } else {
        setError(t('mfa.error.disable_failed'));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('mfa.error.disable_failed');
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      success(t('mfa.toast.secret_copied'));
      window.setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      /* clipboard indisponible — non bloquant */
    }
  };

  // Garde les chiffres uniquement, max 6.
  const onCodeChange = (raw: string) => {
    setCode(raw.replace(/\D/g, '').slice(0, 6));
    if (error) setError(null);
  };

  return (
    <Card className="settings-card p-6" aria-busy={busy}>
      <header className="settings-section-header">
        <h3 className="t-h3 flex items-center gap-2">
          <Icon as={ShieldCheck} size={18} /> {t('mfa.title')}
        </h3>
        <p className="t-caption text-[var(--gray-500)]">{t('mfa.subtitle')}</p>
      </header>

      {/* Bannière d'erreur inline (a11y) */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-3 mt-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5"
        >
          <p className="text-[12px] font-semibold text-[var(--danger)]">{error}</p>
        </div>
      )}

      {/* ── État activé ── */}
      {enabled ? (
        <div className="settings-toggle-row">
          <div className="settings-toggle-row__meta">
            <p className="settings-toggle-row__title inline-flex items-center gap-1.5">
              <Icon as={Check} size={14} className="text-[var(--success)]" />
              {t('mfa.status.enabled')}
            </p>
            <p className="settings-toggle-row__desc">{t('mfa.status.enabled_desc')}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="settings-danger-action"
            onClick={() => void handleDisable()}
            disabled={busy}
            aria-busy={busy}
          >
            {t('mfa.disable.cta')}
          </Button>
        </div>
      ) : step === 'idle' ? (
        /* ── État désactivé — proposer l'activation ── */
        <div className="settings-toggle-row">
          <div className="settings-toggle-row__meta">
            <p className="settings-toggle-row__title">{t('mfa.status.disabled')}</p>
            <p className="settings-toggle-row__desc">{t('mfa.status.disabled_desc')}</p>
          </div>
          <Button
            size="sm"
            onClick={() => void handleStartSetup()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? t('mfa.enable.starting') : t('mfa.enable.cta')}
          </Button>
        </div>
      ) : (
        /* ── Flux d'activation : secret + code ── */
        <div className="mt-3 space-y-4">
          <div>
            <p className="settings-toggle-row__title">{t('mfa.setup.step1_title')}</p>
            <p className="settings-toggle-row__desc">{t('mfa.setup.step1_desc')}</p>
          </div>

          {/* Secret / clé manuelle */}
          <div className="p-4 bg-[var(--bg-subtle)] rounded-lg border border-[var(--border-subtle)] space-y-2">
            <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider inline-flex items-center gap-1.5">
              <Icon as={KeyRound} size={12} /> {t('mfa.setup.secret_label')}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 break-all font-mono text-sm text-[var(--text-primary)] tracking-widest">
                {secret}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copySecret()}
                disabled={busy || !secret}
                leftIcon={<Icon as={secretCopied ? Check : Copy} size={14} />}
              >
                {secretCopied ? t('mfa.setup.copied') : t('mfa.setup.copy')}
              </Button>
            </div>
            {otpauthUrl && (
              <p className="text-[11px] text-[var(--text-muted)] break-all">
                {t('mfa.setup.otpauth_hint')}{' '}
                <span className="font-mono">{otpauthUrl}</span>
              </p>
            )}
          </div>

          {/* Saisie du code de vérification */}
          <div>
            <Input
              label={t('mfa.setup.code_label')}
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6 && !busy) void handleVerify();
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              className="font-mono tracking-[0.4em] text-center"
              helper={t('mfa.setup.code_help')}
              disabled={busy}
            />
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void handleVerify()}
              disabled={busy || code.length !== 6}
              aria-busy={busy}
            >
              {busy ? t('mfa.verify.verifying') : t('mfa.verify.cta')}
            </Button>
            <Button size="sm" variant="secondary" onClick={resetSetup} disabled={busy}>
              {t('mfa.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
