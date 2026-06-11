// ── Page Changement de mot de passe ─────────────────────────

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, PageHero, Icon } from '@/components/ui';
import { changePassword } from '@/lib/api';
import { Lock, KeyRound, ShieldCheck } from 'lucide-react';
import { t } from '@/lib/i18n';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState<{ next: boolean; confirm: boolean }>({ next: false, confirm: false });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  // Sprint 26-2B — validation visuelle par champ
  const nextTooShort = touched.next && next.length > 0 && next.length < 8;
  const nextValid = next.length >= 8;
  const confirmMismatch = touched.confirm && confirm.length > 0 && confirm !== next;
  const confirmMatch = touched.confirm && nextValid && confirm === next;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (next.length < 8) {
      setError(t('auth.change_pw.err_short'));
      return;
    }
    if (next !== confirm) {
      setError(t('auth.change_pw.err_mismatch'));
      return;
    }

    setLoading(true);
    try {
      const res = await changePassword(current, next);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        // Retirer le flag du localStorage
        localStorage.removeItem('must_change_password');
        setTimeout(() => void navigate({ to: '/dashboard' }), 2000);
      }
    } catch {
      setError(t('auth.change_pw.err_network'));
    }
    setLoading(false);
  };

  return (
    <AppLayout title={t('auth.change_pw.title')}>
      <PageHero
        compact
        meta={t('auth.change_pw.meta')}
        title={t('auth.change_pw.hero_title')}
        highlight={t('auth.change_pw.title')}
        description={t('auth.change_pw.hero_desc')}
      />
      <div className="max-w-md mx-auto animate-stagger stagger-1">
        <Card className="p-6 form-section-s4">

          {success ? (
            <div className="p-4 bg-[var(--success)]/10 border border-[var(--success)]/30 rounded-[var(--radius-md)] text-sm text-[var(--success)]">
              {t('auth.change_pw.success')}
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {error && (
                <div className="p-3 bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded-[var(--radius-md)] text-xs text-[var(--danger)]">
                  {error}
                </div>
              )}

              <Input
                type="password"
                label={t('auth.change_pw.current')}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder={t('auth.change_pw.current_ph')}
                required
                leftSlot={<Icon as={Lock} size="sm" />}
                autoComplete="current-password"
              />


              <Input
                type="password"
                label={t('auth.change_pw.new')}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                onBlur={() => setTouched((t2) => ({ ...t2, next: true }))}
                placeholder={t('auth.change_pw.new_ph')}
                required
                minLength={8}
                leftSlot={<Icon as={KeyRound} size="sm" />}
                autoComplete="new-password"
                error={nextTooShort ? t('auth.change_pw.hint_min') : undefined}
                success={touched.next && nextValid ? t('auth.change_pw.hint_ok') : undefined}
                helper={!touched.next ? t('auth.change_pw.hint_chars') : undefined}
              />

              <Input
                type="password"
                label={t('auth.change_pw.confirm')}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onBlur={() => setTouched((t2) => ({ ...t2, confirm: true }))}
                placeholder={t('auth.change_pw.confirm_ph')}
                required
                minLength={8}
                leftSlot={<Icon as={ShieldCheck} size="sm" />}
                autoComplete="new-password"
                error={confirmMismatch ? t('auth.change_pw.hint_mismatch') : undefined}
                success={confirmMatch ? t('auth.change_pw.hint_match') : undefined}
              />

              <Button type="submit" variant="primary" className="w-full" disabled={loading}>
                {loading ? t('auth.change_pw.submitting') : t('auth.change_pw.submit')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
