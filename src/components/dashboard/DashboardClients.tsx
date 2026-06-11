// ── DashboardClients — Grille sous-comptes clients (Giga Sprint Design) ──
// Extrait de Dashboard.tsx. Cards avatar + lead count avec bouton "Ajouter".

import type { Client, DashboardStats } from '@/lib/types';
import { t } from '@/lib/i18n';

// Couleurs avatars gradient (identiques au Dashboard original)
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #009DDB 0%, #188BF6 100%)',
  'linear-gradient(135deg, #D96E27 0%, #FF9A00 100%)',
  'linear-gradient(135deg, #757BBD 0%, #D6BCFA 100%)',
  'linear-gradient(135deg, #37CA37 0%, #81E6D9 100%)',
  'linear-gradient(135deg, #E93D3D 0%, #FBB6CE 100%)',
  'linear-gradient(135deg, #F6AD55 0%, #FAF089 100%)',
];

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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 animate-fade-in-up stagger-2">
      {clients.slice(0, 5).map((client, i) => {
        const leadCount = stats?.leads_by_client?.find(
          c => c.client_name === client.name
        )?.count ?? 0;
        return (
          <div
            key={client.id}
            className="surface-card-interactive p-4 flex items-center gap-3"
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
              <div className="text-meta-label" style={{ fontSize: '10px', textTransform: 'none', letterSpacing: 'normal' }}>
                {leadCount} leads
              </div>
            </div>
          </div>
        );
      })}

      {/* Bouton ajouter */}
      <div
        className="surface-card-interactive p-4 flex items-center justify-center"
        style={{ borderStyle: 'dashed' }}
        onClick={onAddClient}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
          <span className="text-lg">+</span>
          {t('dashboard.client.add')}
        </div>
      </div>
    </div>
  );
}
