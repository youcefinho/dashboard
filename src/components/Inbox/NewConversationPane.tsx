import { useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import { X, Mail, Phone, Search } from 'lucide-react';
import type { Lead, MessageChannel } from '@/lib/types';
import { apiFetch } from '@/lib/api';
import { MessageComposer } from './MessageComposer';

interface Props {
  onCancel: () => void;
  onSent: (convId: string) => void;
  snippets?: any[];
  templates?: any[];
  className?: string;
}

export function NewConversationPane({ onCancel, onSent, snippets = [], templates = [], className = '' }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [channel, setChannel] = useState<MessageChannel>('email');
  const [subject, setSubject] = useState('');
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    if (search.length < 2) {
      setLeads([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<Lead[]>(`/leads?search=${search}&limit=5`).then(res => {
        if (res.data) {
          setLeads(res.data);
          setShowDropdown(true);
        }
      }).catch(console.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleSend = async () => {
    if (!selectedLead || !composerText.trim()) return;
    setIsSending(true);

    try {
      // 1. Create conversation (or find existing open)
      const convRes = await apiFetch<{ id: string; existing: boolean }>('/conversations', {
        method: 'POST',
        body: JSON.stringify({
          lead_id: selectedLead.id,
          channel,
          subject
        })
      });

      if (convRes.data?.id) {
        // 2. Send message
        await apiFetch(`/conversations/${convRes.data.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            body: composerText,
            subject
          })
        });
        
        onSent(convRes.data.id);
      }
    } catch (e) {
      console.error(e);
    }
    
    setIsSending(false);
  };

  return (
    <div className={`flex-1 flex flex-col min-w-0 bg-[var(--bg-canvas)] relative ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <h3 className="text-sm font-semibold">Nouvelle Conversation</h3>
        <button onClick={onCancel} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex justify-center">
        <div className="w-full max-w-2xl bg-white border border-[var(--border-subtle)] rounded-xl shadow-sm overflow-hidden flex flex-col">
          
          <div className="p-4 space-y-4 border-b border-[var(--border-subtle)]">
            {/* Destinataire */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">À :</label>
              {!selectedLead ? (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Rechercher un client (nom, email)..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-[var(--border-subtle)] rounded-lg outline-none focus:border-[var(--brand-primary)]"
                  />
                  {showDropdown && leads.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[var(--border-subtle)] shadow-lg rounded-lg z-20 max-h-48 overflow-y-auto">
                      {leads.map(lead => (
                        <button
                          key={lead.id}
                          onClick={() => { setSelectedLead(lead); setShowDropdown(false); setSearch(''); }}
                          className="w-full text-left px-4 py-2 hover:bg-[var(--bg-subtle)] flex items-center justify-between cursor-pointer"
                        >
                          <span className="text-sm font-medium">{lead.name}</span>
                          <span className="text-xs text-[var(--text-muted)]">{lead.email || lead.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-[var(--brand-tint)] text-[var(--brand-primary)] px-3 py-1.5 rounded-lg w-fit">
                  <span className="text-sm font-medium">{selectedLead.name}</span>
                  <button onClick={() => setSelectedLead(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Canal */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Canal :</label>
              <div className="flex gap-2">
                <Button 
                  variant={channel === 'email' ? 'primary' : 'secondary'} 
                  size="sm" 
                  onClick={() => setChannel('email')}
                  leftIcon={<Mail size={14} />}
                >Email</Button>
                <Button 
                  variant={channel === 'sms' ? 'primary' : 'secondary'} 
                  size="sm" 
                  onClick={() => setChannel('sms')}
                  leftIcon={<Phone size={14} />}
                >SMS</Button>
              </div>
            </div>

            {/* Sujet (Email seulement) */}
            {channel === 'email' && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Sujet :</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="Sujet du message..."
                  className="w-full px-3 py-2 text-sm border border-[var(--border-subtle)] rounded-lg outline-none focus:border-[var(--brand-primary)]"
                />
              </div>
            )}
          </div>

          <div className="flex-1 bg-[var(--bg-canvas)]">
            <MessageComposer
              composerText={composerText}
              setComposerText={setComposerText}
              handleSend={handleSend}
              isSending={isSending}
              channel={channel}
              snippets={snippets}
              templates={templates}
              leadId={selectedLead?.id}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
