import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui';
import { forgotPassword } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Mail, CheckCircle } from 'lucide-react';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email) {
      setError(t('auth.forgot.required'));
      return;
    }

    setLoading(true);
    try {
      const res = await forgotPassword(email);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
      }
    } catch (err: any) {
      setError(err.message || t('auth.forgot.generic_error'));
    } finally {
      setLoading(false);
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
            {t('auth.forgot.title')}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {t('auth.forgot.desc')}
          </p>
        </div>

        {/* Card Stripe-clean : bg-surface + border + shadow-lg */}
        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--border)] shadow-[var(--shadow-lg)]">
          {success ? (
            <div
              className="text-center py-4"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={t('auth.forgot.aria.success')}
            >
              <div className="w-12 h-12 rounded-full bg-[var(--success-soft)] text-[var(--success)] flex items-center justify-center mx-auto mb-4" aria-hidden="true">
                <Icon as={CheckCircle} size={24} />
              </div>
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">{t('auth.forgot.success_title')}</h3>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                {t('auth.forgot.success_desc')}
              </p>
              <Link to="/login" className="block w-full">
                <Button variant="primary" className="w-full">{t('auth.forgot.back')}</Button>
              </Link>
            </div>
          ) : (
            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="space-y-4"
              noValidate
              aria-busy={loading || undefined}
            >
              {error && (
                <div
                  className="p-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] text-sm text-[var(--danger-text)] animate-fade-in"
                  role="alert"
                  aria-live="assertive"
                  aria-atomic="true"
                  aria-label={t('auth.forgot.aria.error')}
                >
                  {error}
                </div>
              )}
              
              <Input
                id="forgot-email"
                type="email"
                label={t('auth.forgot.email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jean@exemple.com"
                autoComplete="email"
                required
                leftSlot={<Icon as={Mail} size="sm" />}
              />

              <Button type="submit" variant="primary" className="w-full" size="lg" isLoading={loading}>
                {loading ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
              </Button>
            </form>
          )}
        </div>

        {/* Lien retour */}
        <div className="mt-6 text-center text-sm">
          <Link to="/login" className="font-medium text-[var(--text-muted)] hover:text-[var(--text-link)] hover:underline">
            {t('auth.forgot.back')}
          </Link>
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-3">
          {t('login.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
}
