// ── Page Changement de mot de passe ─────────────────────────

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input } from '@/components/ui';
import { changePassword } from '@/lib/api';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (next.length < 8) {
      setError('Le nouveau mot de passe doit faire au moins 8 caractères.');
      return;
    }
    if (next !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
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
      setError('Erreur réseau. Réessayez.');
    }
    setLoading(false);
  };

  return (
    <AppLayout title="Changer le mot de passe">
      <div className="max-w-md mx-auto mt-8">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-1">🔐 Changement de mot de passe</h2>
          <p className="text-xs text-[var(--color-text-muted)] mb-6">
            Votre mot de passe doit faire au moins 8 caractères.
          </p>

          {success ? (
            <div className="p-4 bg-[var(--color-success)]/10 border border-[var(--color-success)]/30 rounded-[var(--radius-md)] text-sm text-[var(--color-success)]">
              ✅ Mot de passe changé avec succès ! Redirection...
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {error && (
                <div className="p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-[var(--radius-md)] text-xs text-[var(--color-danger)]">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
                  Mot de passe actuel
                </label>
                <Input
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="Votre mot de passe actuel"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
                  Nouveau mot de passe
                </label>
                <Input
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="Min. 8 caractères"
                  required
                  minLength={8}
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1 text-[var(--color-text-secondary)]">
                  Confirmer le nouveau mot de passe
                </label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Retapez le nouveau mot de passe"
                  required
                  minLength={8}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Changement...' : 'Changer le mot de passe'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
