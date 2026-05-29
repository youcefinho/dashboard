import { forwardRef } from 'react';
import type { Message } from '@/lib/types';
import { MessageBubble } from './MessageBubble';
// Sprint 48 M3.2 — Intl date formatter (locale-aware)
import { formatDateShort } from '@/lib/i18n/datetime';
import { getLocale, t } from '@/lib/i18n';

interface Props {
  messages: Message[];
  /** Sprint 20 — Callback pour réessayer un message failed (id + body) */
  onRetry?: (tempId: string, body: string) => void;
  /** Sprint 26 vague 26-1B — Callback toggle reaction emoji sur un message */
  onReact?: (messageId: string, emoji: string) => void;
  /**
   * Sprint 44 M3.1 — Callback swipe-to-reply.
   * Reçoit le message complet pour permettre au parent d'extraire sender/preview.
   * No-op desktop (gesture mobile-only via media query coarse).
   */
  onReply?: (message: Message) => void;
}

export const MessageThread = forwardRef<HTMLDivElement, Props>(({ messages, onRetry, onReact, onReply }, ref) => {
  const formatDate = (d: string) => formatDateShort(d, getLocale());

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
        <p className="text-xs">{t('inbox.thread.empty_message')}</p>
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
            const key = msg.id || `msg-${i}`;

            // Sprint 26 vague 26-1B — Parse attachments + reactions depuis metadata JSON si présent
            let attachments;
            let reactions;
            if (msg.metadata) {
              try {
                const meta = JSON.parse(msg.metadata);
                if (Array.isArray(meta.attachments)) attachments = meta.attachments;
                if (Array.isArray(meta.reactions)) reactions = meta.reactions;
              } catch {
                // metadata pas JSON valide — ignore silencieusement
              }
            }

            return (
              <MessageBubble
                key={key}
                direction={isOut ? 'sent' : 'received'}
                text={msg.body}
                timestamp={msg.created_at}
                status={msg.status}
                subject={msg.subject || undefined}
                isNote={isNote}
                senderName={msg.sender_name}
                avatar={!isOut ? { name: msg.sender_name || msg.lead_name || '?' } : undefined}
                showAvatar
                onRetry={onRetry ? () => onRetry(msg.id, msg.body) : undefined}
                stagger={i}
                attachments={attachments}
                reactions={reactions}
                onReact={onReact ? (emoji) => onReact(msg.id, emoji) : undefined}
                // Sprint 33 vague 33-2A — binding localStorage par messageId
                messageId={msg.id}
                // Sprint 44 M3.1 — swipe-to-reply (mobile only) : reply ne fait
                // sens que pour les messages reçus (inbound). Pour outbound on
                // n'expose pas la gesture (cohérent iMessage / WhatsApp).
                onReply={onReply && !isOut ? () => onReply(msg) : undefined}
                // LOT SMS/WHATSAPP seq 104 (Phase C) — badge canal whatsapp +
                // accusé de livraison SMS sortant. delivery_status n'est PAS
                // (encore) dans le type front Message (posé par le worker,
                // Manager-B) ⇒ lecture défensive via cast/optional chaining,
                // SANS modifier types.ts (signalé au rapport).
                channel={msg.channel}
                deliveryStatus={
                  (msg as { delivery_status?: string }).delivery_status ?? undefined
                }
                sentiment={msg.sentiment ?? undefined}
                detectedIntent={msg.detected_intent ?? undefined}
              />
            );
          })}
        </div>
      ))}
      <div ref={ref} />
    </>
  );
});

MessageThread.displayName = 'MessageThread';
