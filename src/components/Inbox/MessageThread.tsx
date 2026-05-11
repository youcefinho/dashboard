import { forwardRef } from 'react';
import type { Message } from '@/lib/types';

interface Props {
  messages: Message[];
}

export const MessageThread = forwardRef<HTMLDivElement, Props>(({ messages }, ref) => {
  const formatTime = (d: string) => new Date(d).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  const formatDate = (d: string) => new Date(d).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });

  const groupMessagesByDay = (messages: Message[]) => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = '';
    for (const msg of messages) {
      const d = formatDate(msg.created_at);
      if (d !== currentDate) {
        currentDate = d;
        groups.push({ date: d, messages: [msg] });
      } else {
        groups[groups.length - 1]!.messages.push(msg);
      }
    }
    return groups;
  };

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        <p className="text-xs">Aucun message dans cette conversation</p>
      </div>
    );
  }

  return (
    <>
      {groupMessagesByDay(messages).map(group => (
        <div key={group.date}>
          <div className="flex items-center gap-2 my-3">
            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
            <span className="text-[9px] text-[var(--text-muted)] uppercase font-medium">{group.date}</span>
            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
          </div>
          {group.messages.map((msg, i) => {
            const isOut = msg.direction === 'outbound';
            const isNote = msg.channel === 'internal_note';
            // Clé robuste
            const key = msg.id || `msg-${i}`;
            
            return (
              <div key={key} className={`flex mb-2 ${isOut ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] rounded-xl px-3 py-2 ${
                  isNote ? 'bg-[#FFF9C4] border border-[#FFE082] text-[#5D4037]' :
                  isOut ? 'bg-[var(--brand-primary)] text-white' :
                  'bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)]'
                }`}>
                  {isNote && <p className="text-[9px] font-bold mb-0.5 opacity-70">📝 Note interne</p>}
                  {msg.subject && <p className={`text-[10px] font-semibold mb-0.5 ${isOut && !isNote ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>{msg.subject}</p>}
                  <p className="text-xs whitespace-pre-wrap break-words">{msg.body}</p>
                  <div className={`flex items-center justify-end gap-1 mt-1 ${isOut && !isNote ? 'text-white/60' : 'text-[var(--text-muted)]'}`}>
                    <span className="text-[9px]">{formatTime(msg.created_at)}</span>
                    {msg.sender_name && <span className="text-[9px]">· {msg.sender_name}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div ref={ref} />
    </>
  );
});

MessageThread.displayName = 'MessageThread';
