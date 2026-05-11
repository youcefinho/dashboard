import { useState, useRef } from 'react';
import { Button } from '@/components/ui';
import { Send, Wand2, FileText } from 'lucide-react';
import type { MessageChannel, Snippet, EmailTemplate } from '@/lib/types';
import { CHANNEL_LABELS } from '@/lib/types';
import { interpolateTemplate } from '@/lib/api';

interface Props {
  composerText: string;
  setComposerText: (t: string) => void;
  handleSend: () => void;
  isSending: boolean;
  channel: MessageChannel;
  snippets?: Snippet[];
  templates?: EmailTemplate[];
  leadId?: string;
}

export function MessageComposer({ composerText, setComposerText, handleSend, isSending, channel, snippets = [], templates = [], leadId }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [snippetQuery, setSnippetQuery] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Détecter "/" pour ouvrir les snippets
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setComposerText(val);

    const lastWord = val.split(/\s/).pop() || '';
    if (lastWord.startsWith('/')) {
      setShowSnippets(true);
      setSnippetQuery(lastWord.slice(1).toLowerCase());
    } else {
      setShowSnippets(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSnippets) {
      if (e.key === 'Escape') {
        setShowSnippets(false);
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const filtered = snippets.filter(s => s.shortcut.toLowerCase().includes(snippetQuery) || s.name.toLowerCase().includes(snippetQuery));
        if (filtered.length > 0) {
          applySnippet(filtered[0]!);
        }
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) { 
      e.preventDefault(); 
      handleSend(); 
    }
  };

  const applySnippet = (snippet: Snippet) => {
    const words = composerText.split(/\s/);
    words.pop(); // remove the /shortcut
    const newText = words.join(' ') + (words.length > 0 ? ' ' : '') + snippet.body;
    setComposerText(newText);
    setShowSnippets(false);
    inputRef.current?.focus();
  };

  const applyTemplate = async (template: EmailTemplate) => {
    if (!leadId) {
      setComposerText(template.body_text || template.body_html || '');
      setShowTemplates(false);
      return;
    }
    const res = await interpolateTemplate(template.body_text || template.body_html || '', leadId);
    if (res.data) {
      setComposerText(res.data.text);
    }
    setShowTemplates(false);
    inputRef.current?.focus();
  };

  const handleAIGenerate = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reply_message',
          context: composerText || 'Un message cordial pour répondre à ce lead.',
        }),
      });
      const data = await res.json() as any;
      if (data?.data?.content) {
        setComposerText(data.data.content);
      }
    } catch (e) {
      console.error('Erreur IA:', e);
    }
    setIsGenerating(false);
  };
  
  const placeholder = `Répondre via ${CHANNEL_LABELS[channel] || channel} (tapez / pour modèles rapides)...`;
  const filteredSnippets = snippets.filter(s => s.shortcut.toLowerCase().includes(snippetQuery) || s.name.toLowerCase().includes(snippetQuery)).slice(0, 5);
  const channelTemplates = templates.filter(t => t.channel === channel);
  
  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 relative">
      {/* Snippet Popover */}
      {showSnippets && filteredSnippets.length > 0 && (
        <div className="absolute bottom-full mb-2 left-3 w-80 bg-white border border-[var(--border-subtle)] shadow-lg rounded-lg overflow-hidden z-10">
          <div className="px-3 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] text-[10px] font-medium text-[var(--text-muted)] uppercase">
            Réponses rapides
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredSnippets.map((s, i) => (
              <button
                key={s.id}
                onClick={() => applySnippet(s)}
                className={`w-full text-left px-3 py-2 hover:bg-[var(--bg-subtle)] flex flex-col gap-0.5 ${i === 0 ? 'bg-[var(--bg-canvas)]' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--text-primary)]">{s.name}</span>
                  {s.shortcut && <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-subtle)] px-1.5 rounded">/{s.shortcut}</span>}
                </div>
                <span className="text-[10px] text-[var(--text-muted)] truncate">{s.body}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Template Menu */}
      {showTemplates && (
        <div className="absolute bottom-full mb-2 left-3 w-64 bg-white border border-[var(--border-subtle)] shadow-lg rounded-lg overflow-hidden z-10">
          <div className="px-3 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] text-[10px] font-medium text-[var(--text-muted)] uppercase">
            Templates {CHANNEL_LABELS[channel] || channel}
          </div>
          <div className="max-h-48 overflow-y-auto">
            {channelTemplates.length === 0 ? (
              <div className="px-3 py-4 text-xs text-center text-[var(--text-muted)]">Aucun template configuré pour ce canal.</div>
            ) : (
              channelTemplates.map(t => (
                <button
                  key={t.id}
                  onClick={() => void applyTemplate(t)}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--bg-subtle)] text-xs text-[var(--text-primary)] truncate"
                >
                  {t.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5 h-full self-start mt-1">
          <Button variant="ghost" size="sm" onClick={() => setShowTemplates(!showTemplates)} className="h-[28px] px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Insérer un template">
            <FileText size={16} />
          </Button>
        </div>
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={composerText}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={3}
            className="w-full px-3 py-2 text-xs bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--brand-primary)] resize-none"
          />
        </div>
        <div className="flex flex-col gap-1.5 h-full">
          <Button variant="ghost" size="sm" onClick={() => void handleAIGenerate()} isLoading={isGenerating} leftIcon={<Wand2 size={14} className="text-[#A855F7]" />} className="h-[28px] border border-[var(--border-subtle)] bg-white hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200">
            IA
          </Button>
          <Button size="sm" onClick={() => handleSend()} isLoading={isSending} leftIcon={<Send size={14} />} className="h-[28px]">
            Envoyer
          </Button>
        </div>
      </div>
    </div>
  );
}
