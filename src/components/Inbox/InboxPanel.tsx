
import { Link } from '@tanstack/react-router';
import { Avatar } from '@/components/ui/Avatar';
import { ExternalLink } from 'lucide-react';
import type { Conversation, ConversationStatus, MessageChannel } from '@/lib/types';
import { CHANNEL_LABELS, CONVERSATION_STATUS_LABELS, CONVERSATION_STATUS_COLORS } from '@/lib/types';

interface Props {
  activeConv: Conversation & { messages: any[] };
  changeStatus: (s: ConversationStatus) => void;
}

export function InboxPanel({ activeConv, changeStatus }: Props) {
  return (
    <div className="w-72 shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-y-auto">
      <div className="p-4">
        {/* Avatar + nom */}
        <div className="text-center mb-4">
          <Avatar name={activeConv.lead_name || '?'} size="lg" className="mx-auto mb-2" />
          <h3 className="text-sm font-semibold">{activeConv.lead_name || 'Inconnu'}</h3>
          <p className="text-[10px] text-[var(--text-muted)]">{activeConv.lead_email}</p>
          {activeConv.lead_phone && (
            <p className="text-[10px] text-[var(--text-muted)]">{activeConv.lead_phone}</p>
          )}
        </div>

        {/* Actions rapides */}
        <div className="flex gap-2 mb-4">
          <Link to={`/leads/${activeConv.lead_id}`} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium bg-[var(--brand-tint)] text-[var(--brand-primary)] rounded-lg hover:opacity-80 transition-opacity">
            <ExternalLink size={12} /> Voir le lead
          </Link>
        </div>

        {/* Infos conversation */}
        <div className="space-y-3">
          <div>
            <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Conversation</p>
            <div className="space-y-1.5">
              {[
                ['Canal', CHANNEL_LABELS[activeConv.channel as MessageChannel] || activeConv.channel],
                ['Statut', CONVERSATION_STATUS_LABELS[activeConv.status as ConversationStatus] || activeConv.status],
                ['Assigné à', activeConv.assigned_name || '—'],
                ['Créée', new Date(activeConv.created_at).toLocaleDateString('fr-CA')],
                ['Messages', String(activeConv.messages?.length || 0)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-[10px]">
                  <span className="text-[var(--text-muted)]">{label}</span>
                  <span className="text-[var(--text-primary)] font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Changer statut */}
          <div>
            <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Actions</p>
            <div className="space-y-1">
              {(['open', 'closed', 'snoozed'] as const).filter(s => s !== activeConv.status).map(s => (
                <button key={s} onClick={() => void changeStatus(s as ConversationStatus)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] rounded-lg hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors text-left">
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
