import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { resetPassword } from '@/lib/api';
import { t } from '@/lib/i18n';

export function ResetPasswordPage() {
  const { token } = useParams({ strict: false }) as { token?: string };
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!token) {
      setError(t('auth.reset.token_missing'));
      return;
    }

    if (password.length < 12) {
      setError(t('auth.reset.too_short'));
      return;
    }

    setLoading(true);
    try {
      const res = await resetPassword(token, password);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
      }
    } catch (err: any) {
      setError(err.message || t('auth.reset.generic_error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-canvas)]">

      <div className="w-full max-w-[420px] animate-stagger stagger-1">
        {/* Logo compact Stripe-clean */}
        <div className="text-center mb-6">
          <div
            className="w-10 h-10 rounded-[var(--radius-lg)] flex items-center justify-center mx-auto mb-4 text-white font-bold text-lg shadow-[var(--shadow-sm)]"
            style={{ background: 'var(--brand-gradient)' }}
          >
            I
          </div>
        </div>

        {/* Card auth Stripe-clean */}
        <div className="auth-card-s4 animate-stagger stagger-2">
          <h1 className="auth-title">
            {t('auth.reset.title')}
          </h1>
          <p className="text-sm text-[var(--text-muted)] text-center mb-6">
            {t('auth.reset.desc')}
          </p>

          {success ? (
            <div
              className="text-center py-4 animate-stagger stagger-3"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={t('auth.reset.aria.success')}
            >
              <div className="w-12 h-12 rounded-full bg-[var(--success-soft)] text-[var(--success)] flex items-center justify-center mx-auto mb-4" aria-hidden="true">
                ✓
              </div>
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">{t('auth.reset.success_title')}</h3>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                {t('auth.reset.success_desc')}
              </p>
              <Link to="/login" className="block w-full">
                <Button variant="primary" className="w-full">{t('auth.reset.signin')}</Button>
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
                  aria-label={t('auth.reset.aria.error')}
                >
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('auth.reset.new')}
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.reset.placeholder')}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  aria-describedby="reset-password-hint"
                />
                <p id="reset-password-hint" className="text-xs text-[var(--text-muted)] mt-1.5">
                  {t('auth.reset.placeholder')}
                </p>
              </div>

              <Button type="submit" variant="primary" className="w-full mt-2" disabled={loading || !token}>
                {loading ? t('auth.reset.submitting') : t('auth.reset.submit')}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-4 animate-stagger stagger-3">
          {t('login.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
}
