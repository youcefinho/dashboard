// ── LeadHoverPreview — Carte de prévisualisation hover sur Leads table ───────
// Sprint 23 wave 10. Apparaît au survol prolongé (~320ms) d'une row Lead, sans
// ouvrir le panel. Affiche : avatar XL gradient, score gauge, statut, message
// snippet, valeur deal, tags, infos contact. Click sur la row → ouvre panel.
//
// Exposé sous forme de hook `useLeadHoverPreview` pour pouvoir s'appliquer
// directement sur un `<tr>` sans casser la sémantique table (pas de wrapper div).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, Tag, ScoreGauge, Icon } from '@/components/ui';
import { STATUS_LABELS, STATUS_COLORS, type Lead } from '@/lib/types';
import { Mail, Phone, MapPin, Calendar as CalendarIcon, Sparkles } from 'lucide-react';
// Sprint 48 M3 — Intl currency + relative time
import { formatMoneyCAD } from '@/lib/i18n/number';
import { formatRelativeTime } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';

const PREVIEW_WIDTH = 340;
const PREVIEW_HEIGHT = 340;

interface UseLeadHoverPreviewOptions {
  lead: Lead;
  clientName?: string;
  disabled?: boolean;
  delay?: number;
}

interface UseLeadHoverPreviewResult {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  preview: ReactNode;
}

export function useLeadHoverPreview({
  lead,
  clientName,
  disabled = false,
  delay = 320,
}: UseLeadHoverPreviewOptions): UseLeadHoverPreviewResult {
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
    if (disabled) return;
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
          <LeadPreviewCard lead={lead} clientName={clientName} position={position} />,
          document.body
        )
      : null;

  return { onMouseEnter, onMouseLeave, preview };
}

function LeadPreviewCard({
  lead,
  clientName,
  position,
}: {
  lead: Lead;
  clientName?: string;
  position: { x: number; y: number };
}) {
  const isHot = lead.score >= 70;
  const tags = (() => {
    try {
      const raw = (lead as unknown as { tags?: string | string[] }).tags;
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string' && raw.startsWith('[')) return JSON.parse(raw) as string[];
      return [];
    } catch {
      return [];
    }
  })();
  const messageSnippet = (lead.message || lead.notes || '').slice(0, 140);

  return (
    <div
      className="fixed z-[100] w-[340px] rounded-[var(--radius-lg)] overflow-hidden pointer-events-none bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-lg animate-in fade-in slide-in-from-left-2 duration-200"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {/* HOT bandeau — sober primary purple */}
      {isHot && (
        <div className="relative h-1" style={{ background: 'var(--primary)' }} />
      )}

      <div className="relative p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <Avatar name={lead.name} size="lg" ring={isHot ? 'hot' : 'none'} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[15px] font-semibold truncate text-[var(--text-primary)] tracking-tight">
                {lead.name}
              </h3>
              {isHot && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold text-white tracking-wider"
                  style={{ background: 'var(--primary)' }}
                >
                  HOT
                </span>
              )}
            </div>
            {clientName && (
              <p className="text-[11px] text-[var(--text-muted)] font-medium truncate">
                {clientName}
              </p>
            )}
            <div className="flex items-center gap-1.5 mt-1">
              <Tag dot size="xs" color={STATUS_COLORS[lead.status]}>{STATUS_LABELS[lead.status]}</Tag>
              {lead.deal_value > 0 && (
                <span className="text-[11px] font-bold text-[var(--primary)] t-mono-num">
                  {formatMoneyCAD(lead.deal_value, getLocale())}
                </span>
              )}
            </div>
          </div>
          <ScoreGauge score={lead.score} size={62} />
        </div>

        {/* Message snippet */}
        {messageSnippet && (
          <div className="px-3 py-2 mb-3 rounded-[var(--radius-md)] text-[12px] leading-relaxed bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
            <div className="flex items-start gap-1.5">
              <Icon
                as={Sparkles}
                size="xs"
                className="mt-0.5 shrink-0"
                style={{ color: 'var(--primary)' }}
              />
              <span className="italic">
                "{messageSnippet}
                {(lead.message || lead.notes || '').length > 140 ? '…' : ''}"
              </span>
            </div>
          </div>
        )}

        {/* Contact meta */}
        <div className="space-y-1 mb-3">
          <ContactRow icon={<Icon as={Mail} size="xs" />} value={lead.email} />
          {lead.phone && <ContactRow icon={<Icon as={Phone} size="xs" />} value={lead.phone} />}
          {(lead.city || lead.address) && (
            <ContactRow
              icon={<Icon as={MapPin} size="xs" />}
              value={[lead.city, lead.address].filter(Boolean).join(' · ')}
            />
          )}
          <ContactRow
            icon={<Icon as={CalendarIcon} size="xs" />}
            value={`Créé ${formatRelative(lead.created_at)}`}
            muted
          />
        </div>

        {/* Tags — Stripe-clean Tag primitive style */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.slice(0, 5).map((t) => (
              <span
                key={t}
                className="text-[9px] px-2 py-0.5 rounded-full font-semibold tracking-wide bg-[var(--brand-tint)] text-[var(--primary)] border border-[var(--primary)]/20"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Footer hint */}
        <div className="pt-2 mt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Aperçu
          </span>
          <span className="text-[10px] font-semibold text-[var(--primary)]">
            Cliquer pour ouvrir →
          </span>
        </div>
      </div>
    </div>
  );
}

function ContactRow({
  icon,
  value,
  muted = false,
}: {
  icon: ReactNode;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 text-[11px]"
      style={{ color: muted ? 'var(--text-muted)' : 'var(--text-secondary)' }}
    >
      <span className="shrink-0" style={{ color: 'var(--primary)', opacity: 0.7 }}>
        {icon}
      </span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return '';
  // Sprint 48 M3.2 — Intl.RelativeTimeFormat locale-aware
  return formatRelativeTime(iso, getLocale());
}
