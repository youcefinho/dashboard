// ── Page AcceptInvitation — LOT TEAM A (Phase B / M2) ────────
// Page PUBLIQUE d'acceptation d'invitation. Calque visuel EXACT de
// Signup.tsx. Flux succès NE passe PAS par useAuth().login : appelle
// api.acceptInvitation() (qui a déjà fait setToken + localStorage,
// IDENTIQUE à register()) puis window.location.assign (full reload pour
// réhydrater AuthProvider depuis localStorage — même pattern que Signup).

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { acceptInvitation } from '@/lib/api';
import { Button, Input, Icon } from '@/components/ui';
import { t } from '@/lib/i18n';
import { Lock, User } from 'lucide-react';

// Lecture du token clair dans la querystring (?token=...). Pas de
// dépendance routeur : la route est publique et le token n'est jamais
// re-soumis ni stocké côté front.
function readToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return new URLSearchParams(window.location.search).get('token') || '';
  } catch {
    return '';
  }
}

export function AcceptInvitationPage() {
  const [token] = useState(readToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState<{ password: boolean; confirm: boolean }>({ password: false, confirm: false });
  const [error, setError] = useState('');
  // 'invalid' = lien invalide/expiré (code INVALID_INVITE) : on bloque
  // tout re-submit et on affiche le CTA contact admin.
  const [invalidLink, setInvalidLink] = useState(!token);
  const [isLoading, setIsLoading] = useState(false);

  // Renforcement a11y : autofocus champ password au montage (premier champ
  // requis). On évite de voler le focus si l'utilisateur a déjà cliqué.
  // Calque exact du pattern Signup.tsx (Sprint 26-2B).
  useEffect(() => {
    if (invalidLink) return;
    const el = document.getElementById('accept-password') as HTMLInputElement | null;
    if (el && document.activeElement === document.body) {
      try { el.focus(); } catch { /* noop */ }
    }
  }, [invalidLink]);

  const passwordError = touched.password && password.length > 0 && password.length < 12
    ? t('team.accept.error_password_short')
    : '';
  // Renforcement : confirm utilise une clé dédiée (mismatch), pas la clé
  // password_short — distingue les deux problèmes pour l'utilisateur.
  const confirmError = touched.confirm && confirm.length > 0 && confirm !== password
    ? t('team.accept.error_password_mismatch')
    : '';

  // Renforcement : état "form globalement invalide" pour désactiver visuellement
  // le submit. Aide la perception (le handler re-valide quand même).
  const formInvalid =
    password.length < 12 || confirm.length < 12 || confirm !== password;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setInvalidLink(true);
      return;
    }
    if (password.length < 12) {
      setError(t('team.accept.error_password_short'));
      return;
    }
    if (confirm !== password) {
      // Renforcement : distinction confirm-mismatch vs password-short.
      setError(t('team.accept.error_password_mismatch'));
      return;
    }

    setIsLoading(true);
    const result = await acceptInvitation({
      token,
      password,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    setIsLoading(false);

    if (result.data && 'token' in result.data) {
      // Succès — acceptInvitation() a déjà fait setToken + localStorage.
      // Full reload pour réhydrater AuthProvider (PAS navigate() SPA),
      // calque EXACT du flux Signup.tsx.
      window.location.assign('/dashboard');
      return;
    }

    // ── Mapping erreurs → i18n ──────────────────────────────────
    // CODE > mémoire : apiFetch (figé, api.ts:103-105) réduit la réponse
    // d'erreur à { error: data.error } et DROP le champ `code`. On ne peut
    // donc pas discriminer sur `code:'INVALID_INVITE'` ; on mappe sur le
    // `error` string réel renvoyé par handleAcceptInvitation (§6.B) :
    //   'Invitation invalide ou expirée' (INVALID_INVITE)  → lien invalide
    //   'Mot de passe trop court (min 12 caractères)'        → password court
    //   'Cet utilisateur existe déjà'                       → error_invalid
    const msg = ((result as { error?: string }).error || '').toLowerCase();
    if (msg.includes('invitation invalide') || msg.includes('expir')) {
      setInvalidLink(true);
    } else if (msg.includes('mot de passe')) {
      setError(t('team.accept.error_password_short'));
    } else {
      setError(t('team.accept.error_invalid'));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-canvas)]">

      <div className="w-full max-w-sm animate-stagger stagger-1">
        {/* Logo compact Stripe-clean */}
        <div className="text-center mb-6">
          <div
            className="w-10 h-10 rounded-[var(--radius-lg)] flex items-center justify-center mx-auto mb-4 text-white font-bold text-lg shadow-[var(--shadow-sm)]"
            style={{ background: 'var(--brand-gradient)' }}
          >
            I
          </div>
        </div>

        {invalidLink ? (
          // Lien invalide/expiré/déjà utilisé — pas de retry token.
          <div
            role="alert"
            aria-live="assertive"
            className="auth-card-s4 text-center animate-stagger stagger-2"
          >
            <p className="text-sm text-[var(--danger)] font-medium mb-2">
              {t('team.accept.error_invalid')}
            </p>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              {t('team.accept.help_link')}
            </p>
            <Link
              to="/login"
              className="inline-block text-sm font-medium text-[var(--primary)] hover:underline"
            >
              {t('login.submit')}
            </Link>
          </div>
        ) : (
          /* Formulaire — auth-card-s4 Stripe-clean */
          <form onSubmit={handleSubmit} className="auth-card-s4 animate-stagger stagger-2">
            <h1 className="auth-title">{t('team.accept.title')}</h1>
            <div className="space-y-4">
            <Input
              type="password"
              id="accept-password"
              label={t('team.accept.password_label')}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((s) => ({ ...s, password: true }))}
              autoComplete="new-password"
              required
              leftSlot={<Icon as={Lock} size="sm" />}
              error={passwordError || undefined}
            />

            <Input
              type="password"
              id="accept-confirm"
              label={t('team.accept.confirm_label')}
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={() => setTouched((s) => ({ ...s, confirm: true }))}
              autoComplete="new-password"
              required
              leftSlot={<Icon as={Lock} size="sm" />}
              error={confirmError || undefined}
            />

            <Input
              type="text"
              id="accept-name"
              label={t('team.accept.name_label')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              leftSlot={<Icon as={User} size="sm" />}
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
              {isLoading ? t('team.accept.loading') : t('team.accept.submit')}
            </Button>

            <p className="text-center text-sm text-[var(--text-secondary)]">
              <Link to="/login" className="font-medium text-[var(--primary)] hover:underline">
                {t('login.submit')}
              </Link>
            </p>
            </div>
          </form>
        )}

        <p className="text-center text-xs text-[var(--text-muted)] mt-4 animate-stagger stagger-3">
          {t('login.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
}
