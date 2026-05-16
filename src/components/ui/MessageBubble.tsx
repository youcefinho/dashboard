// ── MessageBubble (primitive ui) — Sprint 41 M1.1 ───────────────────────────
// Bubble Stripe-grade autonome pour usages génériques (preview, demos, mockups,
// composants externes). NE remplace PAS `components/Inbox/MessageBubble.tsx`
// qui reste utilisé par MessageThread (intégration domain + status Message).
//
// Paradigme Stripe : asymetric soft, monochromatique, shadows noir 5-10%,
// surface gray-50 pour incoming + primary-soft (#F0EFFE) pour outgoing.
// AUCUN gradient brand massif, AUCUN glow cyan/orange.
//
// API :
//   <MessageBubble
//     direction="in" | "out"
//     content="Hello"
//     timestamp={Date.now()}
//     status="sent" | "delivered" | "read"   // out only
//     reactions={[{ emoji: '👍', count: 2, reactedByMe: true }]}
//     attachments={[{ type: 'image', url, name }]}
//     replyTo={{ author: 'Marie', preview: 'Bonjour, ...' }}
//     avatarSrc="..."        // override
//     avatarName="Marc"      // initial fallback (in only)
//   />
//
// Reactions hover bar : 6 emojis presets (👍 ❤️ 😂 😮 😢 🎉) affichés au hover
// au-dessus du bubble. Click → callback `onReact(emoji)`.

import { useState } from 'react';
import { Check, CheckCheck, Eye } from 'lucide-react';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
// Sprint 48 M3.2 — Intl time formatter (locale-aware)
import { formatTime as i18nFormatTime } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';

export type MessageBubbleDirection = 'in' | 'out';
export type MessageBubbleStatus = 'sent' | 'delivered' | 'read';
export type MessageBubbleAttachmentType = 'image' | 'file' | 'audio';

export interface MessageBubbleReaction {
  emoji: string;
  count: number;
  reactedByMe?: boolean;
}

export interface MessageBubbleAttachment {
  type: MessageBubbleAttachmentType;
  url: string;
  name?: string;
}

export interface MessageBubbleReplyTo {
  author: string;
  preview: string;
}

export interface MessageBubbleProps {
  direction: MessageBubbleDirection;
  content: string;
  timestamp: number | Date;
  status?: MessageBubbleStatus;
  reactions?: MessageBubbleReaction[];
  attachments?: MessageBubbleAttachment[];
  replyTo?: MessageBubbleReplyTo;
  avatarSrc?: string;
  avatarName?: string;
  /** Callback emoji click (preset bar ou chip existant). */
  onReact?: (emoji: string) => void;
  /** Désactive la bar hover reactions (default false). */
  disableReactionsBar?: boolean;
  /** Optional className extension. */
  className?: string;
}

const PRESET_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const;

function formatTime(t: number | Date): string {
  // Sprint 48 M3.2 — locale-aware via Intl
  return i18nFormatTime(t, getLocale());
}

function StatusIcon({ status }: { status: MessageBubbleStatus }) {
  if (status === 'sent') {
    return <Icon as={Check} size="xs" aria-label="Envoyé" />;
  }
  if (status === 'delivered') {
    return <Icon as={CheckCheck} size="xs" aria-label="Livré" />;
  }
  return (
    <Icon
      as={Eye}
      size="xs"
      className="msg-bubble-ui-status-read"
      aria-label="Lu"
    />
  );
}

export function MessageBubble({
  direction,
  content,
  timestamp,
  status,
  reactions,
  attachments,
  replyTo,
  avatarSrc,
  avatarName,
  onReact,
  disableReactionsBar = false,
  className = '',
}: MessageBubbleProps) {
  const isOut = direction === 'out';
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`msg-bubble-ui ${isOut ? 'msg-bubble-ui--out' : 'msg-bubble-ui--in'} ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isOut && (
        <div className="msg-bubble-ui-avatar">
          {(avatarSrc || avatarName) && (
            <Avatar name={avatarName || '?'} src={avatarSrc} size="sm" />
          )}
        </div>
      )}

      <div className="msg-bubble-ui-stack">
        {/* Reactions hover bar (top, Stripe-clean) */}
        {!disableReactionsBar && (
          <div
            className={`msg-bubble-ui-react-bar ${hovered ? 'is-visible' : ''}`}
            role="toolbar"
            aria-label="Réactions rapides"
            aria-hidden={!hovered}
          >
            {PRESET_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onReact?.(e)}
                className="msg-bubble-ui-react-btn"
                aria-label={`Réagir avec ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        <div className="msg-bubble-ui-shell">
          {/* Reply preview pill (au-dessus du contenu) */}
          {replyTo && (
            <div className="msg-bubble-ui-reply">
              <span className="msg-bubble-ui-reply-author">{replyTo.author}</span>
              <span className="msg-bubble-ui-reply-preview">{replyTo.preview}</span>
            </div>
          )}

          {content && (
            <p className="msg-bubble-ui-content">{content}</p>
          )}

          {/* Attachments */}
          {attachments && attachments.length > 0 && (
            <div className={`msg-bubble-ui-attachments ${content ? 'has-text' : ''}`}>
              {attachments.map((att, i) => {
                if (att.type === 'image') {
                  return (
                    <a
                      key={i}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="msg-bubble-ui-att msg-bubble-ui-att--image"
                      aria-label={att.name || 'Image attachée'}
                    >
                      {/* Sprint 43 M1.3 — width/height + loading=lazy : prévient CLS
                          + diffère le fetch hors viewport. Dimensions intrinsèques
                          conservatrices (msg-bubble-ui-att--image scale CSS si plus grand). */}
                      <img
                        src={att.url}
                        alt={att.name || ''}
                        width={320}
                        height={240}
                        loading="lazy"
                        decoding="async"
                      />
                    </a>
                  );
                }
                if (att.type === 'audio') {
                  return (
                    <div key={i} className="msg-bubble-ui-att msg-bubble-ui-att--audio">
                      <div className="msg-bubble-ui-att-wave" aria-hidden />
                      <span className="msg-bubble-ui-att-name">{att.name || 'Audio'}</span>
                    </div>
                  );
                }
                return (
                  <a
                    key={i}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="msg-bubble-ui-att msg-bubble-ui-att--file"
                  >
                    <span className="msg-bubble-ui-att-icon" aria-hidden>📎</span>
                    <span className="msg-bubble-ui-att-name">{att.name || 'Fichier'}</span>
                  </a>
                );
              })}
            </div>
          )}

          {/* Meta row : time + status */}
          <div className="msg-bubble-ui-meta">
            <span className="msg-bubble-ui-time">{formatTime(timestamp)}</span>
            {isOut && status && <StatusIcon status={status} />}
          </div>
        </div>

        {/* Reactions chips (sous le bubble) */}
        {reactions && reactions.length > 0 && (
          <div className="msg-bubble-ui-reactions">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact?.(r.emoji)}
                className={`msg-bubble-ui-reaction-chip ${r.reactedByMe ? 'is-active' : ''}`}
                aria-pressed={!!r.reactedByMe}
                aria-label={`Réaction ${r.emoji} (${r.count})`}
              >
                <span className="msg-bubble-ui-reaction-emoji">{r.emoji}</span>
                <span className="msg-bubble-ui-reaction-count">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
