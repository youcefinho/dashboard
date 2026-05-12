import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Card, Button } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { forgotPassword } from '@/lib/api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email) {
      setError('Veuillez entrer votre adresse courriel');
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
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-2xl">⚡</span>
            <span className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              Intralys <span className="text-[var(--brand-primary)]">CRM</span>
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-6">Mot de passe oublié</h1>
          <p className="text-[var(--text-secondary)] mt-2">
            Entrez votre courriel pour recevoir un lien de réinitialisation.
          </p>
        </div>

        <Card className="p-6 md:p-8">
          {success ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[var(--success-subtle)] text-[var(--success)] flex items-center justify-center mx-auto mb-4">
                ✓
              </div>
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">Lien envoyé</h3>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                Si un compte est associé à cette adresse, vous recevrez un courriel avec les instructions.
              </p>
              <Link to="/login" className="block w-full">
                <Button className="w-full">Retour à la connexion</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {error && (
                <div className="p-3 text-sm text-[var(--danger)] bg-[var(--danger-subtle)] border border-[var(--danger-border)] rounded-lg">
                  {error}
                </div>
              )}
              
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                  Courriel
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jean@exemple.com"
                  autoComplete="email"
                  required
                />
              </div>

              <Button type="submit" className="w-full mt-2" disabled={loading}>
                {loading ? 'Envoi...' : 'Envoyer le lien'}
              </Button>
            </form>
          )}
        </Card>

        <p className="text-center text-sm text-[var(--text-muted)] mt-8">
          <Link to="/login" className="text-[var(--brand-primary)] hover:underline font-medium">
            Retour à la connexion
          </Link>
        </p>
      </div>
    </div>
  );
}
