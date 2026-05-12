import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { Card, Button } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { resetPassword } from '@/lib/api';

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
      setError('Jeton de réinitialisation manquant');
      return;
    }

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
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
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-6">Nouveau mot de passe</h1>
          <p className="text-[var(--text-secondary)] mt-2">
            Veuillez entrer votre nouveau mot de passe.
          </p>
        </div>

        <Card className="p-6 md:p-8">
          {success ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[var(--success-subtle)] text-[var(--success)] flex items-center justify-center mx-auto mb-4">
                ✓
              </div>
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">Mot de passe modifié</h3>
              <p className="text-sm text-[var(--text-secondary)] mb-6">
                Votre mot de passe a été mis à jour avec succès. Vous pouvez maintenant vous connecter.
              </p>
              <Link to="/login" className="block w-full">
                <Button className="w-full">Se connecter</Button>
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
                <label htmlFor="password" className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                  Nouveau mot de passe
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 caractères"
                  autoComplete="new-password"
                  required
                />
              </div>

              <Button type="submit" className="w-full mt-2" disabled={loading || !token}>
                {loading ? 'Enregistrement...' : 'Enregistrer le mot de passe'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
