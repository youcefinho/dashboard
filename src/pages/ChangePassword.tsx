// ── Page Changement de mot de passe ─────────────────────────

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, PageHero, Icon } from '@/components/ui';
import { changePassword } from '@/lib/api';
import { Lock, KeyRound, ShieldCheck } from 'lucide-react';

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
      <PageHero
        compact
        meta="Sécurité"
        title="🔐 Changement de mot de passe"
        highlight="mot de passe"
        description="Votre mot de passe doit faire au moins 8 caractères."
      />
      <div className="max-w-md mx-auto">
        <Card className="p-6">

          {success ? (
            <div className="p-4 bg-[var(--success)]/10 border border-[var(--success)]/30 rounded-[var(--radius-md)] text-sm text-[var(--success)]">
              ✅ Mot de passe changé avec succès ! Redirection...
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
                label="Mot de passe actuel"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="Votre mot de passe actuel"
                required
                leftSlot={<Icon as={Lock} size="sm" />}
                autoComplete="current-password"
              />

              <Input
                type="password"
                label="Nouveau mot de passe"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, next: true }))}
                placeholder="Min. 8 caractères"
                required
                minLength={8}
                leftSlot={<Icon as={KeyRound} size="sm" />}
                autoComplete="new-password"
                error={nextTooShort ? 'Minimum 8 caractères requis' : undefined}
                success={touched.next && nextValid ? 'Longueur suffisante' : undefined}
                helper={!touched.next ? 'Au moins 8 caractères — mélangez chiffres et lettres' : undefined}
              />

              <Input
                type="password"
                label="Confirmer le nouveau mot de passe"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
                placeholder="Retapez le nouveau mot de passe"
                required
                minLength={8}
                leftSlot={<Icon as={ShieldCheck} size="sm" />}
                autoComplete="new-password"
                error={confirmMismatch ? 'Les mots de passe ne correspondent pas' : undefined}
                success={confirmMatch ? 'Mots de passe identiques' : undefined}
              />

              <Button type="submit" variant="premium" className="w-full" disabled={loading}>
                {loading ? 'Changement...' : 'Changer le mot de passe'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
