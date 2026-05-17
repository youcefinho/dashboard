// ── Page Login — Connexion ──────────────────────────────────

import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
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
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 35%, #F0FAFE 70%, #FFE9D6 100%)' }}>
      {/* Sprint 23 — Orbs dramatiques animés (opacités fortes) */}
      <div className="hero-stat-orb absolute w-[600px] h-[600px] rounded-full -top-60 -right-60 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.32) 0%, rgba(0,157,219,0.08) 50%, transparent 80%)', filter: 'blur(60px)' }} />
      <div className="hero-stat-orb absolute w-[500px] h-[500px] rounded-full -bottom-40 -left-40 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.28) 0%, rgba(217,110,39,0.08) 50%, transparent 80%)', filter: 'blur(60px)', animationDelay: '4s' }} />
      <div className="hero-stat-orb absolute w-[300px] h-[300px] rounded-full top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(55,202,55,0.12) 0%, transparent 70%)', filter: 'blur(80px)', animationDelay: '2s' }} />

      <div className="w-full max-w-sm animate-fade-in relative z-10">
        {/* Logo Sprint 23 — gros, gradient brand, pulse halo */}
        <div className="text-center mb-8">
          <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{
              background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
              boxShadow: '0 8px 32px rgba(0,157,219,0.45), 0 0 40px rgba(217,110,39,0.3)',
              animation: 'hot-lead-pulse 3s ease-in-out infinite',
            }}>
            <span className="text-white font-bold text-3xl tracking-tight">I</span>
            {/* Subtle inner highlight */}
            <div className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 50%)' }} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-gradient-brand">Intralys</span> <span className="text-[var(--text-primary)]">CRM</span>
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1.5">{t('login.subtitle')}</p>
        </div>

        {/* Formulaire — Sprint 23 premium card */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 rounded-2xl relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)',
            backdropFilter: 'blur(16px) saturate(160%)',
            WebkitBackdropFilter: 'blur(16px) saturate(160%)',
            border: '1px solid rgba(255,255,255,0.6)',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 24px 64px -12px rgba(0,157,219,0.18), 0 0 60px -8px rgba(217,110,39,0.12)',
          }}>
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
            <div className="p-3 rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] text-sm text-[var(--danger)] animate-fade-in">
              {error}
            </div>
          )}

          <Button type="submit" variant="premium" className="w-full" size="lg" isLoading={isLoading}>
            {t('login.submit')}
          </Button>

          {biometricReady && (
            <button
              type="button"
              onClick={() => void handleBiometricLogin()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] transition-colors text-sm font-medium cursor-pointer"
            >
              <Icon as={Fingerprint} size={18} />
              {t('login.biometric')}
            </button>
          )}
        </form>

        {/* Badges statut */}
        <div className="flex items-center justify-center gap-4 mt-6 text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
            {t('login.status.online')}
          </span>
          <span>v2.0</span>
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-4">
          {t('login.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
}
