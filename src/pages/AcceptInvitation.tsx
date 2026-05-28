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
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 35%, #F0FAFE 70%, #FFE9D6 100%)' }}>
      {/* Orbs dramatiques animés — calque Signup.tsx */}
      <div className="hero-stat-orb absolute w-[600px] h-[600px] rounded-full -top-60 -right-60 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.32) 0%, rgba(0,157,219,0.08) 50%, transparent 80%)', filter: 'blur(60px)' }} />
      <div className="hero-stat-orb absolute w-[500px] h-[500px] rounded-full -bottom-40 -left-40 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.28) 0%, rgba(217,110,39,0.08) 50%, transparent 80%)', filter: 'blur(60px)', animationDelay: '4s' }} />
      <div className="hero-stat-orb absolute w-[300px] h-[300px] rounded-full top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(55,202,55,0.12) 0%, transparent 70%)', filter: 'blur(80px)', animationDelay: '2s' }} />

      <div className="w-full max-w-sm animate-fade-in relative z-10">
        {/* Logo — calque Signup.tsx */}
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
          <p className="text-sm text-[var(--text-secondary)] mt-1.5">{t('team.accept.title')}</p>
        </div>

        {invalidLink ? (
          // Lien invalide/expiré/déjà utilisé — pas de retry token.
          // Renforcement a11y : role=alert + aria-live=assertive pour annonce
          // immédiate lecteurs d'écran ; clé help_link distincte de
          // error_invalid (évite duplication clé identique).
          <div
            role="alert"
            aria-live="assertive"
            className="p-6 rounded-2xl relative overflow-hidden text-center"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)',
              backdropFilter: 'blur(16px) saturate(160%)',
              WebkitBackdropFilter: 'blur(16px) saturate(160%)',
              border: '1px solid rgba(255,255,255,0.6)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 24px 64px -12px rgba(0,157,219,0.18), 0 0 60px -8px rgba(217,110,39,0.12)',
            }}>
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
          /* Formulaire — premium card calque Signup.tsx */
          <form onSubmit={handleSubmit} className="p-6 space-y-4 rounded-2xl relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 100%)',
              backdropFilter: 'blur(16px) saturate(160%)',
              WebkitBackdropFilter: 'blur(16px) saturate(160%)',
              border: '1px solid rgba(255,255,255,0.6)',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 24px 64px -12px rgba(0,157,219,0.18), 0 0 60px -8px rgba(217,110,39,0.12)',
            }}>
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
              // Renforcement a11y : live-region polite pour annoncer l'erreur
              // au lecteur d'écran sans interrompre la saisie. Calque Signup.tsx.
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
              {isLoading ? t('team.accept.loading') : t('team.accept.submit')}
            </Button>

            <p className="text-center text-sm text-[var(--text-secondary)]">
              <Link to="/login" className="font-medium text-[var(--primary)] hover:underline">
                {t('login.submit')}
              </Link>
            </p>
          </form>
        )}

        <p className="text-center text-xs text-[var(--text-muted)] mt-4">
          {t('login.copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
}
