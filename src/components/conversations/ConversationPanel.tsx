// ── ConversationPanel — Historique et envoi de messages dans la fiche lead ──

import { useState, useEffect, useCallback } from 'react';
import { getLeadMessages, sendMessage, getTemplates } from '@/lib/api';
import { Button, Tag, Skeleton, AiSparkles, Input, Select, Textarea } from '@/components/ui';
import type { Message, EmailTemplate } from '@/lib/types';
import { CHANNEL_ICONS, MESSAGE_STATUS_LABELS } from '@/lib/types';
// Sprint 48 M3.2 — Intl relative time + locale-aware date
import { formatRelativeTime } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';

interface ConversationPanelProps {
  leadId: string;
  leadName: string;
  leadEmail: string;
  leadPhone: string;
}

export function ConversationPanel({ leadId, leadName, leadEmail, leadPhone }: ConversationPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'history' | 'compose'>('history');
  const [channel, setChannel] = useState<'email' | 'sms' | 'internal_note'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [sendResult, setSendResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadMessages = useCallback(async () => {
    setIsLoading(true);
    const result = await getLeadMessages(leadId);
    if (result.data) {
      setMessages(result.data);
    }
    setIsLoading(false);
  }, [leadId]);

  const loadTemplates = useCallback(async () => {
    const result = await getTemplates();
    if (result.data) {
      setTemplates(result.data);
    }
  }, []);

  useEffect(() => {
    void loadMessages();
    void loadTemplates();
  }, [loadMessages, loadTemplates]);

  // Appliquer un template
  const applyTemplate = (templateId: string) => {
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) return;
    setSelectedTemplate(templateId);
    // Remplacer les variables basiques
    let subjectFilled = tpl.subject
      .replace(/\{\{nom\}\}/g, leadName)
      .replace(/\{\{email\}\}/g, leadEmail);
    let bodyFilled = tpl.body_html
      .replace(/\{\{nom\}\}/g, leadName)
      .replace(/\{\{email\}\}/g, leadEmail);
    // Retirer les tags HTML pour le body (on affiche du texte brut dans le textarea)
    bodyFilled = bodyFilled.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
    setSubject(subjectFilled);
    setBody(bodyFilled);
  };

  const handleSend = async () => {
    if (!body.trim()) return;
    setIsSending(true);
    setSendResult(null);

    const result = await sendMessage(leadId, {
      channel,
      subject: channel === 'email' ? subject : undefined,
      body: body.trim(),
      template_id: selectedTemplate || undefined,
    });

    if (result.data?.success || result.data?.id) {
      setSendResult({ type: 'success', text: channel === 'email' ? 'Email envoyé !' : channel === 'sms' ? 'SMS envoyé !' : 'Note ajoutée !' });
      setSubject('');
      setBody('');
      setSelectedTemplate('');
      void loadMessages();
    } else {
      setSendResult({ type: 'error', text: result.error || 'Erreur lors de l\'envoi' });
    }
    setIsSending(false);
  };

  const formatDate = (dateStr: string) => {
    // Sprint 48 M3.2 — Intl.RelativeTimeFormat locale-aware
    return formatRelativeTime(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'), getLocale());
  };

  return (
    <div className="space-y-4">
      {/* Tabs — segmented-control premium */}
      <div className="segmented-control" role="tablist" aria-label="Conversations">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          onClick={() => setActiveTab('history')}
          className={activeTab === 'history' ? 'is-active' : ''}
        >
          Historique ({messages.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'compose'}
          onClick={() => setActiveTab('compose')}
          className={activeTab === 'compose' ? 'is-active' : ''}
        >
          Composer
        </button>
      </div>

      {/* Historique */}
      {activeTab === 'history' && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-muted)]">
              <p className="text-2xl mb-2">💬</p>
              <p className="text-sm">Aucune conversation</p>
              <p className="text-xs mt-1">Envoyez le premier message !</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`p-3 rounded-[var(--radius-md)] border text-sm ${
                  msg.direction === 'outbound'
                    ? 'bg-[var(--primary)]/12 border-[var(--primary)]/30 ml-4'
                    : 'bg-[var(--bg-subtle)] border-[var(--border-subtle)] mr-4'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span>{CHANNEL_ICONS[msg.channel]}</span>
                    <span className="font-medium text-xs">
                      {msg.direction === 'outbound' ? 'Vous' : leadName}
                    </span>
                    <Tag dot size="xs" variant={msg.status === 'delivered' || msg.status === 'read' ? 'success' : msg.status === 'failed' ? 'danger' : 'neutral'}>
                      {MESSAGE_STATUS_LABELS[msg.status]}
                    </Tag>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">{formatDate(msg.created_at)}</span>
                </div>
                {msg.subject && (
                  <p className="font-medium text-xs text-[var(--text-secondary)] mb-1">{msg.subject}</p>
                )}
                <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{msg.body.replace(/<[^>]+>/g, '')}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Composer */}
      {activeTab === 'compose' && (
        <div className="space-y-3">
          {/* Sélection du canal — chip-btn group avec gradient sur active */}
          <div className="flex gap-1.5 flex-wrap">
            {(['email', 'sms', 'internal_note'] as const).map((ch) => {
              const isActive = channel === ch;
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannel(ch)}
                  className={`chip-btn chip-btn--label flex-1 ${isActive ? 'is-active' : ''}`}
                  aria-pressed={isActive}
                  style={
                    isActive
                      ? {
                          background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                          color: 'white',
                          borderColor: 'transparent',
                          boxShadow: '0 4px 12px -2px rgba(0,157,219,0.45)',
                          height: 36,
                        }
                      : { height: 36 }
                  }
                >
                  <span className="mr-1">{CHANNEL_ICONS[ch]}</span>
                  {ch === 'email' ? 'Email' : ch === 'sms' ? 'SMS' : 'Note'}
                </button>
              );
            })}
          </div>

          {/* Destinataire */}
          <div className="text-xs text-[var(--text-muted)] px-1">
            {channel === 'email' ? `À : ${leadEmail || 'Pas d\'email'}` :
             channel === 'sms' ? `À : ${leadPhone || 'Pas de téléphone'}` :
             'Note interne (visible uniquement par l\'équipe)'}
          </div>

          {/* Template (email uniquement) */}
          {channel === 'email' && templates.length > 0 && (
            <Select
              value={selectedTemplate}
              onChange={(e) => applyTemplate(e.target.value)}
              size="sm"
            >
              <option value="">— Utiliser un template —</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
              ))}
            </Select>
          )}

          {/* Sujet (email uniquement) */}
          {channel === 'email' && (
            <Input
              type="text"
              placeholder="Sujet de l'email..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          )}

          {/* Corps du message */}
          <div className="relative">
            <Textarea
              placeholder={channel === 'email' ? 'Rédigez votre email...' : channel === 'sms' ? 'Rédigez votre SMS...' : 'Ajoutez une note interne...'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={channel === 'sms' ? 3 : 6}
              maxLength={channel === 'sms' ? 160 : undefined}
              showCounter={channel === 'sms'}
              resize="none"
              className="pr-10"
            />
            <AiSparkles value={body} onChange={setBody} leadId={leadId} className="absolute bottom-2 right-2 z-10" />
          </div>

          {/* Résultat d'envoi */}
          {sendResult && (
            <div className={`text-xs px-3 py-2 rounded-[var(--radius-md)] ${
              sendResult.type === 'success' 
                ? 'bg-[var(--success)]/10 text-[var(--success)]'
                : 'bg-[var(--danger)]/10 text-[var(--danger)]'
            }`}>
              {sendResult.text}
            </div>
          )}

          {/* Bouton envoi */}
          <Button
            onClick={() => void handleSend()}
            disabled={isSending || !body.trim() || (channel === 'email' && !leadEmail) || (channel === 'sms' && !leadPhone)}
            className="w-full"
          >
            {isSending ? 'Envoi en cours...' : channel === 'email' ? '📧 Envoyer l\'email' : channel === 'sms' ? '💬 Envoyer le SMS' : '📝 Ajouter la note'}
          </Button>
        </div>
      )}
    </div>
  );
}
