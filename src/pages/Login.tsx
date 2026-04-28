// ── Page Login ──────────────────────────────────────────────

import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { Button, Input } from '@/components/ui';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Email et mot de passe requis');
      return;
    }

    const result = await login(email, password);

    if (result.success) {
      void navigate({ to: '/dashboard' });
    } else {
      setError(result.error || 'Erreur de connexion');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--color-bg-primary)]">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-[var(--radius-xl)] bg-[var(--color-accent)] flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-xl">I</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Intralys CRM</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">Connectez-vous à votre espace</p>
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="card p-6 space-y-4">
          <Input
            label="Adresse email"
            type="email"
            id="login-email"
            placeholder="rochdi@intralys.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <Input
            label="Mot de passe"
            type="password"
            id="login-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {error && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] border border-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
            Se connecter
          </Button>
        </form>

        <p className="text-center text-xs text-[var(--color-text-muted)] mt-6">
          © {new Date().getFullYear()} Intralys — Tous droits réservés
        </p>
      </div>
    </div>
  );
}
