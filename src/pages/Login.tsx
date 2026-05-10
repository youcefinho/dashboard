// ── Page Login — Connexion ──────────────────────────────────

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-canvas)] relative overflow-hidden">
      {/* Cercles décoratifs animés */}
      <div className="absolute w-[500px] h-[500px] rounded-full opacity-[0.04] -top-48 -right-48"
        style={{ background: 'radial-gradient(circle, var(--brand-primary), transparent)' }} />
      <div className="absolute w-[400px] h-[400px] rounded-full opacity-[0.05] -bottom-32 -left-32"
        style={{ background: 'radial-gradient(circle, var(--info), transparent)' }} />

      <div className="w-full max-w-sm animate-fade-in relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-[var(--radius-xl)] bg-[var(--brand-primary)] flex items-center justify-center mx-auto mb-4 shadow-[var(--shadow-glow)]"
            style={{ animation: 'pulse-glow 3s ease-in-out infinite' }}>
            <span className="text-white font-bold text-2xl">I</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Intralys CRM</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Connectez-vous à votre espace</p>
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
            <div className="p-3 rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] text-sm text-[var(--danger)] animate-fade-in">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
            Se connecter
          </Button>
        </form>

        {/* Badges statut */}
        <div className="flex items-center justify-center gap-4 mt-6 text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
            Système en ligne
          </span>
          <span>v2.0</span>
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-4">
          © {new Date().getFullYear()} Intralys — Tous droits réservés
        </p>
      </div>
    </div>
  );
}
