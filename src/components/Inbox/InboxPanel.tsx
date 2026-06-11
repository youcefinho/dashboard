
import { Link } from '@tanstack/react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Tag, Icon } from '@/components/ui';
import { ExternalLink } from 'lucide-react';
import type { Conversation, ConversationStatus, MessageChannel } from '@/lib/types';
import { CHANNEL_LABELS, CONVERSATION_STATUS_LABELS, CONVERSATION_STATUS_COLORS } from '@/lib/types';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'info'> = {
  open: 'success',
  closed: 'neutral',
  snoozed: 'warning',
};

interface Props {
  activeConv: Conversation & { messages: any[] };
  changeStatus: (s: ConversationStatus) => void;
}

export function InboxPanel({ activeConv, changeStatus }: Props) {
  return (
    <div className="w-72 shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-y-auto">
      <div className="p-4 space-y-5">
        {/* Avatar + nom */}
        <div className="text-center mb-4">
          <Avatar
            name={activeConv.lead_name || '?'}
            size="lg"
            status={activeConv.status === 'open' ? 'online' : undefined}
            className="mx-auto mb-2"
          />
          <h3 className="text-sm font-semibold">{activeConv.lead_name || 'Inconnu'}</h3>
          <p className="text-[10px] text-[var(--text-muted)]">{activeConv.lead_email}</p>
          {activeConv.lead_phone && (
            <p className="text-[10px] text-[var(--text-muted)]">{activeConv.lead_phone}</p>
          )}
        </div>

        {/* Actions rapides */}
        <div className="flex gap-2 mb-4">
          <Link to={`/leads/${activeConv.lead_id}`} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium bg-[var(--brand-tint)] text-[var(--primary)] rounded-lg hover:opacity-80 transition-opacity">
            <Icon as={ExternalLink} size="xs" /> Voir le lead
          </Link>
        </div>

        {/* Infos conversation */}
        <div className="space-y-3">
          <div>
            <p className="inbox-panel-section-label-s9">Conversation</p>
            <div className="inbox-panel-info-card-s9">
              {[
                ['Canal', CHANNEL_LABELS[activeConv.channel as MessageChannel] || activeConv.channel, null] as const,
                ['Statut', CONVERSATION_STATUS_LABELS[activeConv.status as ConversationStatus] || activeConv.status, STATUS_TONE[activeConv.status] || 'neutral'] as const,
                ['Assigné à', activeConv.assigned_name || '—', null] as const,
                ['Créée', new Date(activeConv.created_at).toLocaleDateString('fr-CA'), null] as const,
                ['Messages', String(activeConv.messages?.length || 0), null] as const,
              ].map(([label, value, tone]) => (
                <div key={label} className="inbox-panel-info-row-s9">
                  <span className="label">{label}</span>
                  {tone ? (
                    <Tag variant={tone} size="xs">{value}</Tag>
                  ) : (
                    <span className="value">{value}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Changer statut */}
          <div>
            <p className="inbox-panel-section-label-s9">Actions</p>
            <div className="space-y-1">
              {(['open', 'closed', 'snoozed'] as const).filter(s => s !== activeConv.status).map(s => (
                <button key={s} onClick={() => void changeStatus(s as ConversationStatus)}
                  className="inbox-panel-action-btn-s9">
                  <div className="w-2 h-2 rounded-full" style={{ background: CONVERSATION_STATUS_COLORS[s as ConversationStatus] }} />
                  Marquer comme {CONVERSATION_STATUS_LABELS[s as ConversationStatus].toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
