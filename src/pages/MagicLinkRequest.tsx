// ── Sprint 50 M3.2 — Magic link request (/login/magic) ─────────────────────
// Demande d'un lien de connexion sans mot de passe (beta status='invited').
// ADDITIF : le login password (/login) reste inchangé.

import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Mail, Loader2, MailCheck, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/lib/i18n';

export function MagicLinkRequestPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        // Réponse volontairement identique (anti-énumération) → on affiche
        // toujours l'écran "Vérifie ta boîte courriel".
        setSent(true);
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setError(j?.error || t('auth.magic.generic_error'));
      }
    } catch {
      setError(t('auth.magic.network_error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="magic-auth">
      <div className="magic-auth__card animate-stagger stagger-1">
        {sent ? (
          <div
            className="magic-auth__state animate-stagger stagger-2"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={t('auth.magic.aria.success')}
          >
            <span className="magic-auth__icon magic-auth__icon--ok">
              <Icon as={MailCheck} size={26} aria-hidden />
            </span>
            <h1 className="magic-auth__title">{t('auth.magic.check_inbox')}</h1>
            <p className="magic-auth__text">
              {t('auth.magic.check_inbox_desc', { email })}
            </p>
            <Link to="/login" className="magic-auth__back">
              <Icon as={ArrowLeft} size={14} aria-hidden /> {t('auth.magic.back')}
            </Link>
          </div>
        ) : (
          <>
            <span className="magic-auth__icon">
              <Icon as={Mail} size={24} aria-hidden />
            </span>
            <h1 className="magic-auth__title">{t('auth.magic.request_title')}</h1>
            <p className="magic-auth__text">
              {t('auth.magic.body_desc')}
            </p>
            <form
              className="magic-auth__form"
              onSubmit={handleSubmit}
              noValidate
              aria-busy={submitting || undefined}
            >
              <Input
                label={t('auth.magic.label_email')}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder={t('auth.magic.placeholder_email')}
                error={error || undefined}
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={submitting}
                leftIcon={
                  submitting ? (
                    <Icon as={Loader2} size={16} className="animate-spin" />
                  ) : (
                    <Icon as={Mail} size={16} />
                  )
                }
              >
                {submitting ? t('auth.magic.submitting') : t('auth.magic.submit')}
              </Button>
            </form>
            <div className="magic-auth__alt">
              <Link to="/login" className="magic-auth__back">
                <Icon as={ArrowLeft} size={14} aria-hidden /> {t('auth.magic.alt_password')}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MagicLinkRequestPage;
