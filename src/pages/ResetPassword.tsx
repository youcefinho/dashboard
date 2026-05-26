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

    if (password.length < 8) {
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
    <div className="min-h-screen flex flex-col justify-center items-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 35%, #F0FAFE 70%, #FFE9D6 100%)' }}>
      <div className="hero-stat-orb absolute w-[500px] h-[500px] rounded-full -top-48 -right-48 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.28) 0%, transparent 70%)', filter: 'blur(60px)' }} />
      <div className="hero-stat-orb absolute w-[400px] h-[400px] rounded-full -bottom-32 -left-32 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.25) 0%, transparent 70%)', filter: 'blur(60px)', animationDelay: '3s' }} />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{
              background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
              boxShadow: '0 8px 32px rgba(0,157,219,0.45)',
              animation: 'hot-lead-pulse 3s ease-in-out infinite',
            }}>
            <span className="text-white font-bold text-2xl">I</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-gradient-brand">{t('auth.reset.title')}</span>
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-2">
            {t('auth.reset.desc')}
          </p>
        </div>

        <div className="p-6 md:p-7 rounded-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)',
            backdropFilter: 'blur(16px) saturate(160%)',
            WebkitBackdropFilter: 'blur(16px) saturate(160%)',
            border: '1px solid rgba(255,255,255,0.6)',
            boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 24px 64px -12px rgba(0,157,219,0.18)',
          }}>
          {success ? (
            <div
              className="text-center py-4"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={t('auth.reset.aria.success')}
            >
              <div className="w-12 h-12 rounded-full bg-[var(--success-subtle)] text-[var(--success)] flex items-center justify-center mx-auto mb-4" aria-hidden="true">
                ✓
              </div>
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">{t('auth.reset.success_title')}</h3>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                {t('auth.reset.success_desc')}
              </p>
              <Link to="/login" className="block w-full">
                <Button className="w-full">{t('auth.reset.signin')}</Button>
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
                  className="p-3 text-sm text-[var(--danger)] bg-[var(--danger-subtle)] border border-[var(--danger-border)] rounded-lg"
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
                  minLength={8}
                  aria-describedby="reset-password-hint"
                />
                <p id="reset-password-hint" className="text-xs text-[var(--text-muted)] mt-1.5">
                  {t('auth.reset.placeholder')}
                </p>
              </div>

              <Button type="submit" variant="premium" className="w-full mt-2" disabled={loading || !token}>
                {loading ? t('auth.reset.submitting') : t('auth.reset.submit')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
