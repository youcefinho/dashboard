// ── DashboardClients — Grille sous-comptes clients (Giga Sprint Design) ──
// Extrait de Dashboard.tsx. Cards avatar + lead count avec bouton "Ajouter".

import type { Client, DashboardStats } from '@/lib/types';
import { t } from '@/lib/i18n';
import { AVATAR_GRADIENTS } from '@/lib/avatarColors';

interface DashboardClientsProps {
  clients: Client[];
  stats: DashboardStats | null;
  onClientClick: (clientId: string) => void;
  onAddClient: () => void;
}

export function DashboardClients({
  clients,
  stats,
  onClientClick,
  onAddClient,
}: DashboardClientsProps) {
  if (clients.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8 animate-fade-in-up stagger-2">
      {clients.slice(0, 5).map((client, i) => {
        const leadCount = stats?.leads_by_client?.find(
          c => c.client_name === client.name
        )?.count ?? 0;
        return (
          <div
            key={client.id}
            className="surface-card-interactive p-4 flex items-center gap-3 hover-lift"
            onClick={() => onClientClick(client.id)}
          >
            <div
              className="avatar-gradient avatar-md rounded-lg"
              style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], borderRadius: '8px' }}
            >
              {client.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">{client.name}</div>
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
                {leadCount} leads
              </div>
            </div>
          </div>
        );
      })}

      {/* Bouton ajouter */}
      <div
        className="group surface-card-interactive p-4 flex items-center justify-center hover:border-[var(--primary)] hover:text-[var(--primary)] transition-all duration-200"
        style={{ borderStyle: 'dashed' }}
        onClick={onAddClient}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
          <span className="w-8 h-8 rounded-full border-2 border-dashed border-[var(--border)] flex items-center justify-center text-base transition-colors group-hover:border-[var(--primary)] group-hover:text-[var(--primary)]" style={{ color: 'var(--text-muted)' }}>+</span>
          {t('dashboard.client.add')}
        </div>
      </div>
    </div>
  );
}
