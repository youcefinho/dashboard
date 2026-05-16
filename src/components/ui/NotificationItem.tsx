// ── NotificationItem — Stripe-clean notification row primitive (Sprint 46 M3.1) ──
// Pattern : avatar 36px + icon type badge bottom-right + content (title 14/600 +
// description 13 muted + time tabular-tiny) + read/unread dot 8px primary.
// Variants : 7 types couvrant tous les events backend.
//
// Stripe sober : no glow, no gradient brand, soft chip type couleur via tints.
// FR québécois friendly. A11y : button role, aria-label, focus-visible.
//
// API publique préservée :
//   - id, type, title, description, time, isRead, onClick, onMarkRead, onDismiss

import {
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  UserPlus,
  UserCheck,
  Clock,
  AtSign,
  MessageSquare,
  Bell,
  ShieldAlert,
  Check,
  X as XIcon,
} from 'lucide-react';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { cn } from '@/lib/cn';

export type NotificationItemType =
  | 'lead_new'
  | 'lead_assigned'
  | 'task_due'
  | 'message'
  | 'mention'
  | 'system'
  | 'compliance';

interface TypeVisual {
  icon: typeof UserPlus;
  /** Background du badge type (tint soft) */
  bg: string;
  /** Couleur du glyph badge (full) */
  fg: string;
  /** Label aria + tooltip lecture */
  label: string;
}

const TYPE_VISUALS: Record<NotificationItemType, TypeVisual> = {
  lead_new: {
    icon: UserPlus,
    bg: 'var(--primary-soft, rgba(99,91,255,0.10))',
    fg: 'var(--primary, #635BFF)',
    label: 'Nouveau lead',
  },
  lead_assigned: {
    icon: UserCheck,
    bg: 'var(--info-soft, rgba(0,157,219,0.10))',
    fg: 'var(--info, #009DDB)',
    label: 'Lead assigné',
  },
  task_due: {
    icon: Clock,
    bg: 'var(--warning-soft, rgba(217,118,39,0.10))',
    fg: 'var(--warning, #D97627)',
    label: 'Tâche échue',
  },
  message: {
    icon: MessageSquare,
    bg: 'var(--info-soft, rgba(0,157,219,0.10))',
    fg: 'var(--info, #009DDB)',
    label: 'Message reçu',
  },
  mention: {
    icon: AtSign,
    bg: 'var(--primary-soft, rgba(99,91,255,0.10))',
    fg: 'var(--primary, #635BFF)',
    label: 'Mention',
  },
  system: {
    icon: Bell,
    bg: 'var(--bg-subtle, #F6F8FA)',
    fg: 'var(--text-secondary, #4B5563)',
    label: 'Système',
  },
  compliance: {
    icon: ShieldAlert,
    bg: 'var(--danger-soft, rgba(220,38,38,0.10))',
    fg: 'var(--danger, #DC2626)',
    label: 'Conformité',
  },
};

export interface NotificationItemProps {
  /** Identifiant unique — utilisé pour aria + onClick payload */
  id: string;
  /** Type de notification — détermine icon badge + couleur */
  type: NotificationItemType;
  /** Titre court (14/600). Si avatar fourni, contient nom de l'auteur */
  title: string;
  /** Description (13 muted) — preview message/lead/task */
  description?: string;
  /** Texte relatif "il y a X min" — tabular-nums tiny */
  time?: string;
  /** Statut lu/non-lu (dot 8px primary visible si false) */
  isRead?: boolean;
  /** Si fourni, affiche Avatar (sinon icon type seul + bg circle gray-50) */
  authorName?: string;
  /** Avatar src (image) — facultatif, fallback initiale */
  authorAvatarUrl?: string;
  /** Click navigate / open source — onClick(id) */
  onClick?: (id: string) => void;
  /** Action inline mark-as-read — affichée au hover si isRead===false */
  onMarkRead?: (id: string) => void;
  /** Action inline dismiss (ignore) — affichée au hover */
  onDismiss?: (id: string) => void;
  /** Bouton custom additionnel à droite (ex: "Voir lead") */
  rightSlot?: ReactNode;
  /** Index pour stagger animation list-item-enter */
  staggerIndex?: number;
  className?: string;
}

export function NotificationItem({
  id,
  type,
  title,
  description,
  time,
  isRead = false,
  authorName,
  authorAvatarUrl,
  onClick,
  onMarkRead,
  onDismiss,
  rightSlot,
  staggerIndex,
  className,
}: NotificationItemProps) {
  const v = TYPE_VISUALS[type] ?? TYPE_VISUALS.system;
  const TypeIcon = v.icon;

  const handleClick = () => onClick?.(id);
  const handleKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(id);
    }
  };
  const handleMark = (e: ReactMouseEvent) => {
    e.stopPropagation();
    onMarkRead?.(id);
  };
  const handleDismiss = (e: ReactMouseEvent) => {
    e.stopPropagation();
    onDismiss?.(id);
  };

  return (
    <div
      role={onClick ? 'button' : 'listitem'}
      tabIndex={onClick ? 0 : -1}
      onClick={onClick ? handleClick : undefined}
      onKeyDown={onClick ? handleKey : undefined}
      aria-label={`${v.label} : ${title}${time ? ` — ${time}` : ''}${isRead ? '' : ' (non lue)'}`}
      className={cn(
        'notification-item',
        !isRead && 'notification-item--unread',
        onClick && 'notification-item--clickable',
        className,
      )}
      style={
        staggerIndex !== undefined
          ? { animationDelay: `${Math.min(staggerIndex * 40, 400)}ms` }
          : undefined
      }
      data-notif-type={type}
    >
      {/* Read/unread dot 8px à gauche */}
      <span
        aria-hidden
        className={cn(
          'notification-item__dot',
          !isRead && 'notification-item__dot--unread',
        )}
      />

      {/* Avatar + badge type bottom-right */}
      <div className="notification-item__avatar-wrap">
        {authorName ? (
          <Avatar
            name={authorName}
            src={authorAvatarUrl}
            size="md"
            aria-label={authorName}
          />
        ) : (
          <div
            className="notification-item__avatar-fallback"
            aria-hidden
            style={{
              background: v.bg,
              color: v.fg,
            }}
          >
            <Icon as={TypeIcon} size={16} />
          </div>
        )}
        {/* Badge type bottom-right (only si avatar — sinon icon est déjà central) */}
        {authorName && (
          <span
            aria-hidden
            className="notification-item__type-badge"
            style={{
              background: v.bg,
              color: v.fg,
            }}
            title={v.label}
          >
            <Icon as={TypeIcon} size={10} />
          </span>
        )}
      </div>

      {/* Content */}
      <div className="notification-item__content">
        <p
          className={cn(
            'notification-item__title',
            !isRead && 'notification-item__title--unread',
          )}
        >
          {title}
        </p>
        {description && (
          <p className="notification-item__description">{description}</p>
        )}
        {time && <p className="notification-item__time tabular-nums">{time}</p>}
      </div>

      {/* Hover actions (mark + dismiss) — sober Stripe icon buttons */}
      <div className="notification-item__actions">
        {rightSlot}
        {!isRead && onMarkRead && (
          <button
            type="button"
            onClick={handleMark}
            className="notification-item__action-btn"
            aria-label="Marquer comme lue"
            title="Marquer comme lue"
          >
            <Icon as={Check} size={12} />
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={handleDismiss}
            className="notification-item__action-btn"
            aria-label="Ignorer cette notification"
            title="Ignorer"
          >
            <Icon as={XIcon} size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
