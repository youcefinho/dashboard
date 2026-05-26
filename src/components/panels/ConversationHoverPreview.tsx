// ── ConversationHoverPreview — Carte preview hover sur Inbox row (Sprint 25 vague 5A)
// Hover sur conversation row → carte 360×320 affichée après 320ms : avatar
// contact + name + channel chip + last 2 messages snippets + unread badge.
//
// Hook `useConversationHoverPreview` retourne onMouseEnter / onMouseLeave +
// preview portal-rendered. Désactivé sur touch device.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, Icon } from '@/components/ui';
import {
  CHANNEL_LABELS,
  type Conversation,
  type Message,
  type MessageChannel,
} from '@/lib/types';
import { Mail, Phone, Globe, MessageSquare, StickyNote } from 'lucide-react';
import { t } from '@/lib/i18n';

const PREVIEW_WIDTH = 360;
const PREVIEW_HEIGHT = 320;

const CHANNEL_ICON_MAP: Record<string, typeof Mail> = {
  email: Mail,
  sms: Phone,
  webchat: Globe,
  facebook: MessageSquare,
  facebook_messenger: MessageSquare,
  instagram: MessageSquare,
  instagram_dm: MessageSquare,
  internal_note: StickyNote,
};

interface UseConversationHoverPreviewOptions {
  conversation: Conversation;
  lastMessages?: Message[];
  disabled?: boolean;
  delay?: number;
}

interface UseConversationHoverPreviewResult {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  preview: ReactNode;
}

function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export function useConversationHoverPreview({
  conversation,
  lastMessages,
  disabled = false,
  delay = 320,
}: UseConversationHoverPreviewOptions): UseConversationHoverPreviewResult {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!position) return;
    const handleScroll = () => setPosition(null);
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', handleScroll, { capture: true });
  }, [position]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const onMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled || isCoarsePointer()) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const padding = 16;
      let x = rect.right + 12;
      if (x + PREVIEW_WIDTH > window.innerWidth - padding) {
        x = Math.max(padding, rect.left - PREVIEW_WIDTH - 12);
      }
      let y = rect.top;
      if (y + PREVIEW_HEIGHT > window.innerHeight - padding) {
        y = Math.max(padding, window.innerHeight - PREVIEW_HEIGHT - padding);
      }
      setPosition({ x, y });
    }, delay);
  };

  const onMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPosition(null);
  };

  const preview =
    position && typeof document !== 'undefined'
      ? createPortal(
          <ConversationPreviewCard
            conversation={conversation}
            lastMessages={lastMessages}
            position={position}
          />,
          document.body
        )
      : null;

  return { onMouseEnter, onMouseLeave, preview };
}

function relTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('panels.conv_now');
  if (mins < 60) return t('panels.conv_min').replace('{n}', String(mins));
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('panels.conv_hour').replace('{n}', String(hrs));
  const days = Math.floor(hrs / 24);
  return t('panels.conv_day').replace('{n}', String(days));
}

function ConversationPreviewCard({
  conversation,
  lastMessages,
  position,
}: {
  conversation: Conversation;
  lastMessages?: Message[];
  position: { x: number; y: number };
}) {
  const ChannelIcon = CHANNEL_ICON_MAP[conversation.channel] || Mail;
  const hasUnread = (conversation.unread_count || 0) > 0;
  const channelLabel =
    CHANNEL_LABELS[conversation.channel as MessageChannel] || conversation.channel;

  // Si lastMessages fournis : on prend les 2 derniers ; sinon fallback preview
  const recent =
    (lastMessages || []).slice(-2).map((m) => ({
      sender: m.direction === 'outbound' ? t('panels.conv_you') : conversation.lead_name || t('panels.conv_contact'),
      body: (m.body || '').slice(0, 80),
      truncated: (m.body || '').length > 80,
      time: relTime(m.created_at),
    })) || [];

  return (
    <div
      className="fixed z-[100] w-[360px] rounded-2xl overflow-hidden pointer-events-none motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
      style={{
        left: position.x,
        top: position.y,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(249,252,254,0.96) 100%)',
        backdropFilter: 'blur(18px) saturate(170%)',
        WebkitBackdropFilter: 'blur(18px) saturate(170%)',
        border: '1px solid rgba(0,157,219,0.18)',
        boxShadow:
          '0 1px 2px rgba(15,23,42,0.06), 0 16px 40px -10px rgba(0,157,219,0.22), 0 32px 64px -16px rgba(15,23,42,0.20), inset 0 1px 0 rgba(255,255,255,0.8)',
      }}
    >
      {/* Orb décoratif */}
      <div
        aria-hidden
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, rgba(0,157,219,0.20) 0%, rgba(217,110,39,0.08) 50%, transparent 80%)',
          filter: 'blur(32px)',
        }}
      />

      <div className="relative p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <Avatar name={conversation.lead_name || '?'} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3
                className="text-[14px] font-bold truncate"
                style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}
              >
                {conversation.lead_name || t('panels.conv_unknown')}
              </h3>
              {hasUnread && (
                <span
                  className="inline-flex items-center justify-center min-w-[18px] h-[16px] px-1.5 text-[9px] font-bold text-white rounded-full"
                  style={{
                    background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
                    boxShadow: '0 2px 6px rgba(0,157,219,0.4)',
                  }}
                >
                  {conversation.unread_count}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(0,157,219,0.10) 0%, rgba(217,110,39,0.06) 100%)',
                  color: 'var(--primary)',
                  border: '1px solid rgba(0,157,219,0.20)',
                }}
              >
                <Icon as={ChannelIcon} size={10} />
                {channelLabel}
              </span>
              {conversation.lead_email && (
                <span className="text-[10px] text-[var(--text-muted)] truncate">
                  {conversation.lead_email}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Last messages */}
        <div className="space-y-2 mb-3">
          {recent.length > 0 ? (
            recent.map((m, i) => (
              <div
                key={i}
                className="px-3 py-2 rounded-lg"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(0,157,219,0.05) 0%, rgba(217,110,39,0.03) 100%)',
                  border: '1px solid rgba(0,157,219,0.10)',
                }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: 'var(--primary)' }}
                  >
                    {m.sender}
                  </span>
                  <span className="text-[9px] text-[var(--text-muted)]">{m.time}</span>
                </div>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {m.body}
                  {m.truncated ? '…' : ''}
                </p>
              </div>
            ))
          ) : conversation.last_message_preview ? (
            <div
              className="px-3 py-2 rounded-lg"
              style={{
                background:
                  'linear-gradient(135deg, rgba(0,157,219,0.05) 0%, rgba(217,110,39,0.03) 100%)',
                border: '1px solid rgba(0,157,219,0.10)',
              }}
            >
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {conversation.last_message_preview.slice(0, 160)}
                {conversation.last_message_preview.length > 160 ? '…' : ''}
              </p>
              <p className="text-[9px] text-[var(--text-muted)] mt-1">
                {relTime(conversation.last_message_at)}
              </p>
            </div>
          ) : (
            <p className="text-[11px] italic text-[var(--text-muted)]">{t('panels.conv_no_recent')}</p>
          )}
        </div>

        {/* Footer hint */}
        <div
          className="pt-2 mt-1 border-t flex items-center justify-between"
          style={{ borderColor: 'rgba(0,157,219,0.10)' }}
        >
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {t('panels.conv_preview')}
          </span>
          <span className="text-[10px] font-semibold" style={{ color: 'var(--primary)' }}>
            {t('panels.conv_click_open')}
          </span>
        </div>
      </div>
    </div>
  );
}
