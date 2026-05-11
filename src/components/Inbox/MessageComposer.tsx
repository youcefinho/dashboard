
import { Button } from '@/components/ui';
import { Send, Wand2 } from 'lucide-react';
import type { MessageChannel } from '@/lib/types';
import { CHANNEL_LABELS } from '@/lib/types';
import { useState } from 'react';

interface Props {
  composerText: string;
  setComposerText: (t: string) => void;
  handleSend: () => void;
  isSending: boolean;
  channel: MessageChannel;
}

export function MessageComposer({ composerText, setComposerText, handleSend, isSending, channel }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);

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
  
  // Custom placeholder and validation based on channel
  const placeholder = `Répondre via ${CHANNEL_LABELS[channel] || channel}...`;
  
  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            value={composerText}
            onChange={e => setComposerText(e.target.value)}
            onKeyDown={e => { 
              if (e.key === 'Enter' && !e.shiftKey) { 
                e.preventDefault(); 
                handleSend(); 
              } 
            }}
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
