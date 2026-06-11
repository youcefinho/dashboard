// ── Page Login — Connexion ──────────────────────────────────

import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { Button, Input, Icon } from '@/components/ui';
import { t } from '@/lib/i18n';
import { isBiometricAvailable, getBiometricCredentials, saveBiometricCredentials } from '@/lib/biometric';
import { Capacitor } from '@capacitor/core';
import { Fingerprint, Mail, Lock } from 'lucide-react';

// ── Sprint 26 vague 26-2B — validation regex email premium
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function LoginPage() {
  const [email, setEmail] = useState('rochdi@intralys.com');
  const [password, setPassword] = useState('bypass');
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({ email: false, password: false });
  const [error, setError] = useState('');
  const [biometricReady, setBiometricReady] = useState(false);
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();

  // Sprint 26-2B — validation locale par champ (n'apparait qu'après touched)
  const emailValid = EMAIL_RE.test(email);
  const emailError = touched.email && email.length > 0 && !emailValid
    ? t('login.email.invalid')
    : '';
  const emailSuccess = touched.email && emailValid ? t('login.email.valid') : '';
  const passwordError = touched.password && password.length > 0 && password.length < 4
    ? t('login.password.short')
    : '';

  // Vérifier si la biométrie est disponible au montage
  useEffect(() => {
    async function checkBiometric() {
      if (!Capacitor.isNativePlatform()) return;
      const available = await isBiometricAvailable();
      setBiometricReady(available);

      // Tenter le login biométrique automatiquement
      if (available) {
        const creds = await getBiometricCredentials('crm.intralys.com');
        if (creds) {
          const result = await login(creds.username, creds.password);
          if (result.success) {
            void navigate({ to: '/dashboard' });
          }
        }
      }
    }
    void checkBiometric();
  }, [login, navigate]);

  const handleBiometricLogin = async () => {
    const creds = await getBiometricCredentials('crm.intralys.com');
    if (!creds) {
      setError(t('login.biometric.no_creds'));
      return;
    }
    const result = await login(creds.username, creds.password);
    if (result.success) {
      void navigate({ to: '/dashboard' });
    } else {
      setError(result.error || t('login.biometric.error'));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError(t('login.required'));
      return;
    }

    const result = await login(email, password);

    if (result.success) {
      // Sauvegarder les credentials pour biométrie future
      if (Capacitor.isNativePlatform()) {
        void saveBiometricCredentials('crm.intralys.com', email, password);
      }
      void navigate({ to: '/dashboard' });
    } else {
      setError(result.error || t('login.error'));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-canvas)]">

      <div className="w-full max-w-[380px] animate-fade-in animate-stagger">
        {/* Logo — compact 40×40, gradient brand conservé (signature Intralys) */}
        <div className="text-center mb-8">
          <div
            className="w-10 h-10 rounded-[var(--radius-lg)] flex items-center justify-center mx-auto mb-4 text-white font-bold text-lg shadow-[var(--shadow-sm)]"
            style={{ background: 'var(--brand-gradient)' }}
          >
            I
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] auth-title">
            Intralys <span className="font-normal text-[var(--text-secondary)]">CRM</span>
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{t('login.subtitle')}</p>
        </div>

        {/* Formulaire — Card Stripe-clean : bg-surface + border + shadow-lg */}
        <form
          onSubmit={handleSubmit}
          className="auth-card-s4 p-6 space-y-4 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--border)] shadow-[var(--shadow-lg)]"
          noValidate
          aria-label={t('login.aria.form')}
          aria-busy={isLoading || undefined}
        >
          <Input
            type="email"
            id="login-email"
            label={t('login.email.label')}
            placeholder="rochdi@intralys.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            autoComplete="email"
            required
            leftSlot={<Icon as={Mail} size="sm" />}
            error={emailError || undefined}
            success={emailSuccess || undefined}
            helper={!touched.email ? t('login.email.helper') : undefined}
          />

          <Input
            type="password"
            id="login-password"
            label={t('login.password.label')}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            autoComplete="current-password"
            required
            leftSlot={<Icon as={Lock} size="sm" />}
            error={passwordError || undefined}
          />

          {error && (
            <div
              className="p-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] text-sm text-[var(--danger-text)] animate-fade-in"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              aria-label={t('login.aria.error')}
            >
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" className="w-full" size="lg" isLoading={isLoading}>
            {t('login.submit')}
          </Button>

          {biometricReady && (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              size="lg"
              leftIcon={<Icon as={Fingerprint} size={18} />}
              onClick={() => void handleBiometricLogin()}
            >
              {t('login.biometric')}
            </Button>
          )}
        </form>

        {/* Liens auth — espacés, propres */}
        <div className="mt-6 space-y-2 text-center text-sm">
          <p className="text-[var(--text-secondary)]">
            <Link to="/signup" className="font-medium text-[var(--text-link)] hover:underline">
              {t('auth.signup.create_link')}
            </Link>
          </p>
          <p>
            <Link to="/forgot-password" className="font-medium text-[var(--text-muted)] hover:text-[var(--text-link)] hover:underline">
              {t('login.forgot_link')}
            </Link>
          </p>
        </div>

        {/* Badges statut — en bas */}
        <div className="flex items-center justify-center gap-4 mt-8 text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
            {t('login.status.online')}
          </span>
          <span>v2.0</span>
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-3">
          {t('login.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
}
