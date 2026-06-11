// ── Page Signup — Création de compte (SaaS Lot 4 §6.20) ─────
// Calque visuel EXACT de Login.tsx. Flux succès NE passe PAS par
// useAuth().login : appelle api.register() puis window.location.assign
// (full reload pour réhydrater AuthProvider depuis localStorage).

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { register } from '@/lib/api';
import { Button, Input, Icon } from '@/components/ui';
import { t } from '@/lib/i18n';
import { Mail, Lock, User, Building2 } from 'lucide-react';

// Même regex email que Login.tsx (Sprint 26 vague 26-2B)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  // Renforcement : touched étendu sur tous les champs requis (name) pour
  // afficher l'erreur inline au blur, comme Login.tsx (Sprint 26-2B).
  const [touched, setTouched] = useState<{ email: boolean; password: boolean; name: boolean }>({
    email: false,
    password: false,
    name: false,
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Renforcement a11y : autofocus champ email au montage (cohérent avec
  // pratiques formulaires d'inscription — premier champ requis). On évite
  // de voler le focus si l'utilisateur a déjà cliqué ailleurs.
  useEffect(() => {
    const el = document.getElementById('signup-email') as HTMLInputElement | null;
    if (el && document.activeElement === document.body) {
      try { el.focus(); } catch { /* noop */ }
    }
  }, []);

  const emailValid = EMAIL_RE.test(email);
  const emailError = touched.email && email.length > 0 && !emailValid
    ? t('auth.signup.invalid')
    : '';
  const passwordError = touched.password && password.length > 0 && password.length < 12
    ? t('auth.signup.password_hint')
    : '';
  // Renforcement : erreur inline name quand champ touché ET vide.
  const nameError = touched.name && name.trim().length === 0
    ? t('auth.signup.name_required')
    : '';

  // Renforcement : état "form globalement invalide" pour désactiver visuellement
  // le submit (pas un blocage hard — handleSubmit re-valide). Aide la perception.
  const formInvalid = !emailValid || password.length < 12 || name.trim().length === 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!emailValid || password.length < 12 || !name.trim()) {
      setError(t('auth.signup.invalid'));
      return;
    }

    setIsLoading(true);
    const result = await register({
      email,
      password,
      name: name.trim(),
      ...(company.trim() ? { company: company.trim() } : {}),
    });
    setIsLoading(false);

    if (result.data && 'token' in result.data) {
      // Succès — register() a déjà fait setToken + localStorage.
      // Full reload pour réhydrater AuthProvider (PAS navigate() SPA).
      window.location.assign('/dashboard');
      return;
    }

    // ── Mapping erreurs → i18n ──────────────────────────────────
    const msg = ((result as { error?: string }).error || '').toLowerCase();
    if (msg.includes('déjà utilisé')) {
      setError(t('auth.signup.email_taken'));
    } else if (
      msg.includes('requête invalide') ||
      msg.includes('mot de passe') ||
      msg.includes('email requis') ||
      msg.includes('nom requis')
    ) {
      setError(t('auth.signup.invalid'));
    } else {
      setError(t('auth.signup.error'));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-canvas)]">

      <div className="w-full max-w-[380px] animate-fade-in">
        {/* Logo — compact 40×40, gradient brand conservé (signature Intralys) */}
        <div className="text-center mb-8">
          <div
            className="w-10 h-10 rounded-[var(--radius-lg)] flex items-center justify-center mx-auto mb-4 text-white font-bold text-lg shadow-[var(--shadow-sm)]"
            style={{ background: 'var(--brand-gradient)' }}
          >
            I
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Intralys <span className="font-normal text-[var(--text-secondary)]">CRM</span>
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{t('auth.signup.subtitle')}</p>
        </div>

        {/* Formulaire — Card Stripe-clean : bg-surface + border + shadow-lg */}
        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-4 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--border)] shadow-[var(--shadow-lg)]"
          noValidate
          aria-label={t('auth.signup.aria_form')}
          aria-busy={isLoading || undefined}
        >
          <Input
            type="text"
            id="signup-name"
            label={t('auth.signup.name_label')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((s) => ({ ...s, name: true }))}
            autoComplete="name"
            required
            leftSlot={<Icon as={User} size="sm" />}
            error={nameError || undefined}
          />

          <Input
            type="email"
            id="signup-email"
            label={t('auth.signup.email_label')}
            placeholder="rochdi@intralys.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((s) => ({ ...s, email: true }))}
            autoComplete="email"
            required
            leftSlot={<Icon as={Mail} size="sm" />}
            error={emailError || undefined}
          />

          <Input
            type="password"
            id="signup-password"
            label={t('auth.signup.password_label')}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((s) => ({ ...s, password: true }))}
            autoComplete="new-password"
            required
            leftSlot={<Icon as={Lock} size="sm" />}
            error={passwordError || undefined}
            helper={!touched.password ? t('auth.signup.password_hint') : undefined}
          />

          <Input
            type="text"
            id="signup-company"
            label={t('auth.signup.company_label')}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            autoComplete="organization"
            leftSlot={<Icon as={Building2} size="sm" />}
          />

          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] text-sm text-[var(--danger-text)] animate-fade-in"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            size="lg"
            isLoading={isLoading}
            disabled={isLoading || formInvalid}
            aria-busy={isLoading || undefined}
            aria-disabled={isLoading || formInvalid || undefined}
          >
            {isLoading ? t('auth.signup.loading') : t('auth.signup.submit')}
          </Button>
        </form>

        {/* Liens auth — espacés, propres */}
        <div className="mt-6 space-y-2 text-center text-sm">
          <p className="text-[var(--text-secondary)]">
            {t('auth.signup.have_account')}{' '}
            <Link to="/login" className="font-medium text-[var(--text-link)] hover:underline">
              {t('login.submit')}
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-3">
          {t('login.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
}
