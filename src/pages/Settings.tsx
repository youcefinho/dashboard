// ── Page Settings — Configuration ───────────────────────────

import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <AppLayout title="Paramètres">
      <div className="max-w-2xl space-y-4">
        {/* Profil */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">Profil</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-[var(--color-border-subtle)]">
              <span className="text-sm text-[var(--color-text-secondary)]">Nom</span>
              <span className="text-sm font-medium">{user?.name || '—'}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[var(--color-border-subtle)]">
              <span className="text-sm text-[var(--color-text-secondary)]">Email</span>
              <span className="text-sm font-medium">{user?.email || '—'}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-[var(--color-text-secondary)]">Rôle</span>
              <span className="text-sm font-medium">{user?.role === 'admin' ? 'Administrateur' : 'Courtier'}</span>
            </div>
          </div>
        </Card>

        {/* Infos système */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">Système</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-[var(--color-border-subtle)]">
              <span className="text-sm text-[var(--color-text-secondary)]">Version</span>
              <span className="text-sm font-medium text-[var(--color-text-muted)]">1.0.0 — Phase 1 MVP</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[var(--color-border-subtle)]">
              <span className="text-sm text-[var(--color-text-secondary)]">Hébergement</span>
              <span className="text-sm font-medium text-[var(--color-text-muted)]">Cloudflare Workers + D1</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-[var(--color-text-secondary)]">Base de données</span>
              <span className="text-sm font-medium text-[var(--color-text-muted)]">intralys-crm</span>
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
