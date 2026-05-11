
import { Button } from '@/components/ui';
import { Send } from 'lucide-react';
import type { MessageChannel } from '@/lib/types';
import { CHANNEL_LABELS } from '@/lib/types';

interface Props {
  composerText: string;
  setComposerText: (t: string) => void;
  handleSend: () => void;
  isSending: boolean;
  channel: MessageChannel;
}

export function MessageComposer({ composerText, setComposerText, handleSend, isSending, channel }: Props) {
  
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
            rows={2}
            className="w-full px-3 py-2 text-xs bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--brand-primary)] resize-none"
          />
        </div>
        <Button size="sm" onClick={() => handleSend()} isLoading={isSending} leftIcon={<Send size={14} />}>
          Envoyer
        </Button>
      </div>
    </div>
  );
}
