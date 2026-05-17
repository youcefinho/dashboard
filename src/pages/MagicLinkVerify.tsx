// ── Sprint 50 M3.2 — Magic link verify (/auth/verify?token=...) ────────────
// Vérifie le token, crée la session Bearer, stocke comme le login password
// (mêmes clés localStorage : intralys_token + intralys_user), puis redirige
// vers /dashboard?welcome=1 (déclenche l'onboarding beta — M3.3).

import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Loader2, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { t } from '@/lib/i18n';

type Phase = 'verifying' | 'success' | 'error';

export function MagicLinkVerifyPage() {
  const [phase, setPhase] = useState<Phase>('verifying');
  const [error, setError] = useState<string>('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // évite double-run StrictMode (token single-use)
    ran.current = true;

    const token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) {
      setError('Lien invalide : aucun jeton fourni.');
      setPhase('error');
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/auth/magic-verify?token=${encodeURIComponent(token)}`);
        const j = await res.json().catch(() => ({})) as { data?: { token?: string; user?: unknown; redirect?: string }; error?: string };
        if (res.ok && j?.data?.token) {
          // Même persistance que api.login() — auth context picke au reload.
          localStorage.setItem('intralys_token', j.data.token);
          localStorage.setItem('intralys_user', JSON.stringify(j.data.user));
          localStorage.removeItem('must_change_password');
          setPhase('success');
          const redirect: string = j.data.redirect || '/dashboard?welcome=1';
          // Hard redirect : recharge l'AuthProvider avec la nouvelle session.
          window.setTimeout(() => { window.location.href = redirect; }, 900);
        } else {
          setError(j?.error || 'Ce lien est invalide ou a expiré.');
          setPhase('error');
        }
      } catch {
        setError('Erreur réseau. Réessaye dans un instant.');
        setPhase('error');
      }
    })();
  }, []);

  return (
    <div className="magic-auth">
      <div className="magic-auth__card">
        {phase === 'verifying' && (
          <div className="magic-auth__state" role="status" aria-live="polite">
            <span className="magic-auth__icon">
              <Icon as={Loader2} size={26} className="animate-spin" aria-hidden />
            </span>
            <h1 className="magic-auth__title">{t('auth.magic.verifying')}</h1>
            <p className="magic-auth__text">On vérifie ton lien sécurisé.</p>
          </div>
        )}

        {phase === 'success' && (
          <div className="magic-auth__state" role="status" aria-live="polite">
            <span className="magic-auth__icon magic-auth__icon--ok">
              <Icon as={CheckCircle2} size={28} aria-hidden />
            </span>
            <h1 className="magic-auth__title">Connecté !</h1>
            <p className="magic-auth__text">On t'amène à ton tableau de bord…</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="magic-auth__state" role="alert">
            <span className="magic-auth__icon magic-auth__icon--err">
              <Icon as={XCircle} size={28} aria-hidden />
            </span>
            <h1 className="magic-auth__title">Lien invalide</h1>
            <p className="magic-auth__text">{error}</p>
            <Link to="/login/magic" className="magic-auth__back">
              <Icon as={ArrowLeft} size={14} aria-hidden /> Demander un nouveau lien
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default MagicLinkVerifyPage;
