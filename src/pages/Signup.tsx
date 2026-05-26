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
  const passwordError = touched.password && password.length > 0 && password.length < 8
    ? t('auth.signup.password_hint')
    : '';
  // Renforcement : erreur inline name quand champ touché ET vide.
  const nameError = touched.name && name.trim().length === 0
    ? t('auth.signup.name_required')
    : '';

  // Renforcement : état "form globalement invalide" pour désactiver visuellement
  // le submit (pas un blocage hard — handleSubmit re-valide). Aide la perception.
  const formInvalid = !emailValid || password.length < 8 || name.trim().length === 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!emailValid || password.length < 8 || !name.trim()) {
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
    // CODE > mémoire : apiFetch (figé, api.ts:103-105) écrase la réponse
    // d'erreur en { error: data.error } et DROP le champ `code`. Le contrat
    // §6.20 (mapping par code 409/400/500) n'est donc pas applicable tel
    // quel sans toucher apiFetch (interdit). On mappe sur le `error` string
    // réel renvoyé par handleRegister (auth.ts) :
    //   409 → 'Cet email est déjà utilisé'        → email_taken
    //   400 → 'Requête invalide' / 'Mot de passe trop court…' / 'Nom requis'… → invalid
    //   500 / réseau / autre                       → error (générique)
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
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 35%, #F0FAFE 70%, #FFE9D6 100%)' }}>
      {/* Orbs dramatiques animés — calque Login.tsx */}
      <div className="hero-stat-orb absolute w-[600px] h-[600px] rounded-full -top-60 -right-60 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.32) 0%, rgba(0,157,219,0.08) 50%, transparent 80%)', filter: 'blur(60px)' }} />
      <div className="hero-stat-orb absolute w-[500px] h-[500px] rounded-full -bottom-40 -left-40 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.28) 0%, rgba(217,110,39,0.08) 50%, transparent 80%)', filter: 'blur(60px)', animationDelay: '4s' }} />
      <div className="hero-stat-orb absolute w-[300px] h-[300px] rounded-full top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(55,202,55,0.12) 0%, transparent 70%)', filter: 'blur(80px)', animationDelay: '2s' }} />

      <div className="w-full max-w-sm animate-fade-in relative z-10">
        {/* Logo — calque Login.tsx */}
        <div className="text-center mb-8">
          <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{
              background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
              boxShadow: '0 8px 32px rgba(0,157,219,0.45), 0 0 40px rgba(217,110,39,0.3)',
              animation: 'hot-lead-pulse 3s ease-in-out infinite',
            }}>
            <span className="text-white font-bold text-3xl tracking-tight">I</span>
            <div className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 50%)' }} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-gradient-brand">Intralys</span> <span className="text-[var(--text-primary)]">CRM</span>
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1.5">{t('auth.signup.subtitle')}</p>
        </div>

        {/* Formulaire — premium card calque Login.tsx */}
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
            type="text"
            id="signup-company"
            label={t('auth.signup.company_label')}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            autoComplete="organization"
            leftSlot={<Icon as={Building2} size="sm" />}
          />

          {/* Renforcement a11y : live-region polite pour annoncer l'erreur
              au lecteur d'écran sans interrompre. role="alert" implique
              aria-live=assertive — ici on préfère polite pour ne pas
              couper la saisie. */}
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] text-sm text-[var(--danger)] animate-fade-in"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="premium"
            className="w-full"
            size="lg"
            isLoading={isLoading}
            disabled={isLoading || formInvalid}
            aria-busy={isLoading || undefined}
            aria-disabled={isLoading || formInvalid || undefined}
          >
            {isLoading ? t('auth.signup.loading') : t('auth.signup.submit')}
          </Button>

          <p className="text-center text-sm text-[var(--text-secondary)]">
            {t('auth.signup.have_account')}{' '}
            <Link to="/login" className="font-medium text-[var(--primary)] hover:underline">
              {t('login.submit')}
            </Link>
          </p>
        </form>

        <p className="text-center text-xs text-[var(--text-muted)] mt-4">
          {t('login.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
}
