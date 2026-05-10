// ── ConversationPanel — Historique et envoi de messages dans la fiche lead ──

import { useState, useEffect, useCallback } from 'react';
import { getLeadMessages, sendMessage, getTemplates } from '@/lib/api';
import { Button, Badge, Skeleton } from '@/components/ui';
import type { Message, EmailTemplate } from '@/lib/types';
import { CHANNEL_ICONS, MESSAGE_STATUS_LABELS } from '@/lib/types';

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
    const d = new Date(dateStr + 'Z');
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'À l\'instant';
    if (mins < 60) return `il y a ${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `il y a ${hours}h`;
    return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-[var(--color-bg-tertiary)] rounded-[var(--radius-md)]">
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2 px-3 rounded-[var(--radius-sm)] text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'history'
              ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] shadow-sm'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          📜 Historique ({messages.length})
        </button>
        <button
          onClick={() => setActiveTab('compose')}
          className={`flex-1 py-2 px-3 rounded-[var(--radius-sm)] text-xs font-medium transition-all cursor-pointer ${
            activeTab === 'compose'
              ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] shadow-sm'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          ✉️ Composer
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
            <div className="text-center py-8 text-[var(--color-text-muted)]">
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
                    ? 'bg-[var(--color-accent)]/5 border-[var(--color-accent)]/20 ml-4'
                    : 'bg-[var(--color-bg-hover)] border-[var(--color-border-subtle)] mr-4'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span>{CHANNEL_ICONS[msg.channel]}</span>
                    <span className="font-medium text-xs">
                      {msg.direction === 'outbound' ? 'Vous' : leadName}
                    </span>
                    <Badge color={msg.status === 'delivered' || msg.status === 'read' ? 'var(--color-success)' : msg.status === 'failed' ? 'var(--color-danger)' : undefined}>
                      {MESSAGE_STATUS_LABELS[msg.status]}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-[var(--color-text-muted)]">{formatDate(msg.created_at)}</span>
                </div>
                {msg.subject && (
                  <p className="font-medium text-xs text-[var(--color-text-secondary)] mb-1">{msg.subject}</p>
                )}
                <p className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap">{msg.body.replace(/<[^>]+>/g, '')}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Composer */}
      {activeTab === 'compose' && (
        <div className="space-y-3">
          {/* Sélection du canal */}
          <div className="flex gap-1 p-1 bg-[var(--color-bg-tertiary)] rounded-[var(--radius-md)]">
            {(['email', 'sms', 'internal_note'] as const).map((ch) => (
              <button
                key={ch}
                onClick={() => setChannel(ch)}
                className={`flex-1 py-1.5 px-2 rounded-[var(--radius-sm)] text-xs font-medium transition-all cursor-pointer ${
                  channel === ch
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {CHANNEL_ICONS[ch]} {ch === 'email' ? 'Email' : ch === 'sms' ? 'SMS' : 'Note'}
              </button>
            ))}
          </div>

          {/* Destinataire */}
          <div className="text-xs text-[var(--color-text-muted)] px-1">
            {channel === 'email' ? `À : ${leadEmail || 'Pas d\'email'}` : 
             channel === 'sms' ? `À : ${leadPhone || 'Pas de téléphone'}` : 
             '📝 Note interne (visible uniquement par l\'équipe)'}
          </div>

          {/* Template (email uniquement) */}
          {channel === 'email' && templates.length > 0 && (
            <select
              value={selectedTemplate}
              onChange={(e) => applyTemplate(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-xs text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">-- Utiliser un template --</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.category})</option>
              ))}
            </select>
          )}

          {/* Sujet (email uniquement) */}
          {channel === 'email' && (
            <input
              type="text"
              placeholder="Sujet de l'email..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          )}

          {/* Corps du message */}
          <textarea
            placeholder={channel === 'email' ? 'Rédigez votre email...' : channel === 'sms' ? 'Rédigez votre SMS...' : 'Ajoutez une note interne...'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={channel === 'sms' ? 3 : 6}
            maxLength={channel === 'sms' ? 160 : undefined}
            className="w-full px-3 py-2 bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
          />

          {/* Compteur SMS */}
          {channel === 'sms' && (
            <p className="text-[10px] text-[var(--color-text-muted)] text-right">{body.length}/160 caractères</p>
          )}

          {/* Résultat d'envoi */}
          {sendResult && (
            <div className={`text-xs px-3 py-2 rounded-[var(--radius-md)] ${
              sendResult.type === 'success' 
                ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                : 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
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
