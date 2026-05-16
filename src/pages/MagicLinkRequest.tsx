// ── Sprint 50 M3.2 — Magic link request (/login/magic) ─────────────────────
// Demande d'un lien de connexion sans mot de passe (beta status='invited').
// ADDITIF : le login password (/login) reste inchangé.

import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Mail, Loader2, MailCheck, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui/Icon';

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
        setError(j?.error || 'Une erreur est survenue. Réessaye.');
      }
    } catch {
      setError('Vérifie ta connexion et réessaye.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="magic-auth">
      <div className="magic-auth__card">
        {sent ? (
          <div className="magic-auth__state" role="status">
            <span className="magic-auth__icon magic-auth__icon--ok">
              <Icon as={MailCheck} size={26} aria-hidden />
            </span>
            <h1 className="magic-auth__title">Vérifie ta boîte courriel</h1>
            <p className="magic-auth__text">
              Si <strong>{email}</strong> fait partie de la beta, on vient de
              t'envoyer un lien de connexion. Il est valable 15 minutes.
            </p>
            <Link to="/login" className="magic-auth__back">
              <Icon as={ArrowLeft} size={14} aria-hidden /> Retour à la connexion
            </Link>
          </div>
        ) : (
          <>
            <span className="magic-auth__icon">
              <Icon as={Mail} size={24} aria-hidden />
            </span>
            <h1 className="magic-auth__title">Connexion par lien magique</h1>
            <p className="magic-auth__text">
              Réservé aux membres de la beta privée. Entre ton courriel, on
              t'envoie un lien sécurisé — pas de mot de passe à retenir.
            </p>
            <form className="magic-auth__form" onSubmit={handleSubmit} noValidate>
              <Input
                label="Courriel"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="toi@entreprise.com"
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
                {submitting ? 'Envoi…' : 'Recevoir mon lien'}
              </Button>
            </form>
            <div className="magic-auth__alt">
              <Link to="/login" className="magic-auth__back">
                <Icon as={ArrowLeft} size={14} aria-hidden /> J'ai un mot de passe
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MagicLinkRequestPage;
