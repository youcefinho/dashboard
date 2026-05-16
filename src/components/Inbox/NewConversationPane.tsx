import { useState, useEffect } from 'react';
import { Button, Input, Icon } from '@/components/ui';
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
        <button onClick={onCancel} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" aria-label="Fermer">
          <Icon as={X} size="md" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex justify-center">
        <div className="w-full max-w-2xl card-premium overflow-hidden flex flex-col">
          
          <div className="p-4 space-y-4 border-b border-[var(--border-subtle)]">
            {/* Destinataire */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">À :</label>
              {!selectedLead ? (
                <div className="relative">
                  <Input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Rechercher un client (nom, email)..."
                    leftIcon={<Icon as={Search} size="sm" />}
                  />
                  {showDropdown && leads.length > 0 && (
                    <div
                      className="absolute top-full left-0 right-0 mt-1 rounded-xl z-20 max-h-48 overflow-y-auto"
                      style={{
                        background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(240,250,254,0.92) 100%)',
                        backdropFilter: 'blur(14px) saturate(170%)',
                        WebkitBackdropFilter: 'blur(14px) saturate(170%)',
                        border: '1px solid rgba(0,157,219,0.20)',
                        boxShadow: '0 16px 48px -12px rgba(0,157,219,0.28), 0 4px 14px -4px rgba(15,23,42,0.10)',
                      }}
                    >
                      <div
                        className="px-3 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase"
                        style={{
                          background: 'linear-gradient(90deg, rgba(0,157,219,0.10) 0%, rgba(217,110,39,0.06) 100%)',
                          borderBottom: '1px solid rgba(0,157,219,0.15)',
                          letterSpacing: '0.18em',
                        }}
                      >
                        Suggestions
                      </div>
                      {leads.map((lead, i) => (
                        <button
                          key={lead.id}
                          onClick={() => { setSelectedLead(lead); setShowDropdown(false); setSearch(''); }}
                          className={`w-full text-left px-4 py-2 flex items-center justify-between cursor-pointer transition-colors list-item-enter border-l-2 ${
                            i === 0
                              ? 'bg-[rgba(0,157,219,0.08)] border-[var(--primary)]'
                              : 'hover:bg-[rgba(0,157,219,0.05)] border-transparent'
                          }`}
                          style={{ animationDelay: `${i * 25}ms` }}
                        >
                          <span className="text-sm font-semibold text-[var(--text-primary)]">{lead.name}</span>
                          <span className="text-xs text-[var(--text-muted)]">{lead.email || lead.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-[var(--brand-tint)] text-[var(--primary)] px-3 py-1.5 rounded-lg w-fit">
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
                  leftIcon={<Icon as={Mail} size="sm" />}
                >Email</Button>
                <Button
                  variant={channel === 'sms' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setChannel('sms')}
                  leftIcon={<Icon as={Phone} size="sm" />}
                >SMS</Button>
              </div>
            </div>

            {/* Sujet (Email seulement) */}
            {channel === 'email' && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Sujet :</label>
                <Input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="Sujet du message..."
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
