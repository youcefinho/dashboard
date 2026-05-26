// ── MessageBubble — Sprint 26 vague 26-1A ────────────────────────────────────
// Bubble premium pour MessageThread : asymmetric rounded + read receipts +
// gradient brand subtil (sent) + surface-1 (received).
//
// Sprint 26 vague 26-1B — intègre attachments + reactions bar contextuelle.
//
// API :
//   <MessageBubble
//     direction="sent" | "received"
//     text="Hello"
//     timestamp="2026-05-14T12:00:00Z"
//     status="sending" | "sent" | "delivered" | "read" | "failed"
//     avatar={{ src, name }}            // received only
//     showAvatar                          // affiche avatar (sinon spacer)
//     subject="Re: Devis"
//     isNote                              // bubble jaune note interne
//     senderName="Marc"
//     onRetry={() => ...}                 // bouton retry si failed
//     stagger={2}                         // index pour stagger entrance (msgs batch)
//     attachments={[{ kind: 'image', url, name, size }]}
//     reactions={[{ emoji: '👍', count: 2, reacted: true }]}
//     onReact={(emoji) => ...}
//   />
//
// Respect prefers-reduced-motion via @keyframes msg-bubble-enter
// (réglage CSS — voir index.css).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCheck, Clock3, AlertCircle, RotateCw, Reply, Smile, Forward, Copy as CopyIcon, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import type { MessageStatus } from '@/lib/types';
import { MessageAttachment, type Attachment } from './MessageAttachment';
import { MessageReactions, type Reaction } from './MessageReactions';
// Sprint 33 vague 33-2A — hydrate les reactions persistées en localStorage
import { getReactions, toggleReaction } from '@/lib/reactions';
// Sprint 44 M3.1 — Haptic feedback au crossing du threshold swipe-to-reply
import { triggerHaptic } from '@/lib/sensorial';
// Sprint 48 M3.2 — Intl time formatter (locale-aware)
import { formatTime as i18nFormatTime } from '@/lib/i18n/datetime';
import { getLocale } from '@/lib/i18n';
// Sprint 44 M3.2 — Long-press → contextual actions sheet
import { useLongPress } from '@/hooks/useLongPress';
import { ContextualActionsSheet, type ContextualAction } from '@/components/ui/ContextualActionsSheet';

export interface MessageBubbleProps {
  direction: 'sent' | 'received';
  text: string;
  timestamp: string;
  status?: MessageStatus;
  avatar?: { src?: string; name: string };
  /** Affiche l'avatar (sinon spacer pour alignement vertical des bulles d'un même speaker). */
  showAvatar?: boolean;
  /** Sujet optionnel (email — affiché en gras au-dessus du body). */
  subject?: string;
  /** Bubble note interne (jaune sticky). */
  isNote?: boolean;
  /** Nom expéditeur (affiché à droite du timestamp si présent). */
  senderName?: string;
  /** Callback retry pour messages failed. */
  onRetry?: () => void;
  /** Index dans un batch pour stagger 30ms entrance (max 240ms). */
  stagger?: number;
  /** Attachments inline (Sprint 26 vague 26-1B). */
  attachments?: Attachment[];
  /** Reactions emoji existantes — seed initial (Sprint 26 vague 26-1B). */
  reactions?: Reaction[];
  /** Callback legacy toggle reaction emoji (analytics / extension). */
  onReact?: (emoji: string) => void;
  /**
   * Sprint 33 vague 33-2A — id du message pour binding localStorage.
   * Si fourni, MessageReactions gère persistence + optimistic UI ;
   * MessageBubble hydrate le state initial via `getReactions(messageId)`.
   */
  messageId?: string;
  /**
   * Sprint 44 M3.1 — Callback swipe-to-reply.
   * Si fourni, swipe horizontal >40px sur la bubble (touch) trigger reply mode :
   * threshold cross → haptic medium + onReply(). Translation visuelle pendant le drag.
   * No-op desktop (pas de gesture si pointer:fine).
   */
  onReply?: () => void;
  /**
   * Sprint 44 M3.2 — Long-press → contextual menu (mobile).
   * Actions standard : Répondre / Réagir / Transférer / Copier / Supprimer.
   * Callbacks individuels optionnels — l'action n'apparaît dans la sheet que
   * si son callback est fourni. `onCopy` est interne (clipboard) si pas fourni.
   * onForward, onDelete : appelés par le parent (sheet se ferme avant).
   */
  onForward?: () => void;
  onDelete?: () => void;
  /** Texte exposé pour quick-copy. Si non fourni utilise `text`. */
  copyableText?: string;
  /**
   * LOT SMS/WHATSAPP seq 104 (Phase C) — canal du message. Si 'whatsapp',
   * affiche un petit badge canal sobre. Optionnel : absent ⇒ aucun badge
   * (comportement legacy inchangé).
   */
  channel?: string;
  /**
   * LOT SMS/WHATSAPP seq 104 (Phase C) — accusé de livraison SMS sortant
   * (colonne messages.delivery_status posée par handleSmsStatusCallback côté
   * worker, Manager-B). DISTINCT de `status`. Optionnel/défensif : le type
   * front Message n'expose pas encore ce champ (signalé au rapport) ⇒ lecture
   * via optional chaining côté MessageThread. Valeurs libres (sans CHECK) :
   * ex 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed'.
   */
  deliveryStatus?: string;
}

const SWIPE_REPLY_THRESHOLD = 40;
const SWIPE_REPLY_MAX = 96;

function formatTime(d: string): string {
  // Sprint 48 M3.2 — locale-aware via Intl
  return i18nFormatTime(d, getLocale());
}

export function MessageBubble({
  direction,
  text,
  timestamp,
  status,
  avatar,
  showAvatar = true,
  subject,
  isNote = false,
  senderName,
  onRetry,
  stagger = 0,
  attachments,
  reactions,
  onReact,
  messageId,
  onReply,
  onForward,
  onDelete,
  copyableText,
  channel,
  deliveryStatus,
}: MessageBubbleProps) {
  const isSent = direction === 'sent';
  const isFailed = status === 'failed';
  const isSending = status === 'sending';
  const [hovered, setHovered] = useState(false);

  // ── Sprint 44 M3.1 — Swipe-to-reply state ─────────────────────────────────
  // Touch-only horizontal swipe. Threshold 40px → trigger onReply().
  // Direction selon orientation : received = swipe right (positive delta),
  // sent = swipe left (negative delta) — feel naturel "tirer vers l'extérieur".
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeFiredRef = useRef(false);
  const swipeAxisLockedRef = useRef<'h' | 'v' | null>(null);
  const [swipeDelta, setSwipeDelta] = useState(0);

  const canSwipe =
    !!onReply &&
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches;

  const swipeDirSign = isSent ? -1 : 1; // received → tire vers la droite, sent → vers la gauche
  const swipeProgress = Math.min(Math.abs(swipeDelta) / SWIPE_REPLY_THRESHOLD, 1);

  const handleSwipeStart = (e: React.TouchEvent) => {
    if (!canSwipe) return;
    const t = e.touches[0];
    if (!t) return;
    swipeStartXRef.current = t.clientX;
    swipeStartYRef.current = t.clientY;
    swipeFiredRef.current = false;
    swipeAxisLockedRef.current = null;
  };

  const handleSwipeMove = (e: React.TouchEvent) => {
    if (!canSwipe || swipeStartXRef.current == null || swipeStartYRef.current == null) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - swipeStartXRef.current;
    const dy = t.clientY - swipeStartYRef.current;
    // Verrouille l'axe une fois 8px franchis pour éviter de capter du scroll vertical
    if (!swipeAxisLockedRef.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        swipeAxisLockedRef.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
    }
    if (swipeAxisLockedRef.current !== 'h') return;
    // Direction : received = positif uniquement, sent = négatif uniquement
    if (swipeDirSign > 0 && dx <= 0) {
      setSwipeDelta(0);
      return;
    }
    if (swipeDirSign < 0 && dx >= 0) {
      setSwipeDelta(0);
      return;
    }
    const clamped = Math.max(-SWIPE_REPLY_MAX, Math.min(SWIPE_REPLY_MAX, dx));
    setSwipeDelta(clamped);
    // Haptic medium au franchissement du threshold (une seule fois par swipe)
    if (!swipeFiredRef.current && Math.abs(clamped) >= SWIPE_REPLY_THRESHOLD) {
      swipeFiredRef.current = true;
      triggerHaptic('medium');
    }
  };

  const handleSwipeEnd = () => {
    if (!canSwipe) return;
    const fired = swipeFiredRef.current;
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
    swipeAxisLockedRef.current = null;
    swipeFiredRef.current = false;
    setSwipeDelta(0);
    if (fired) {
      onReply?.();
    }
  };

  // ── Sprint 44 M3.2 — Long-press contextual menu (mobile only) ────────────
  // Conditionnel : on n'affiche le menu que si au moins une callback est fournie
  // (sinon long-press = no-op, comme avant). Tap normal reste pass-through.
  const hasContextActions = !!(onReply || onReact || onForward || onDelete || messageId);
  const [actionsOpen, setActionsOpen] = useState(false);
  const longPressProps = useLongPress(
    () => setActionsOpen(true),
    undefined,
    { delay: 500, mobileOnly: true, shouldPreventDefault: false }
  );
  const handleCopy = () => {
    const t = copyableText ?? text;
    if (!t) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(t);
    }
  };
  const contextActions: ContextualAction[] = useMemo(() => {
    const out: ContextualAction[] = [];
    if (onReply) {
      out.push({
        id: 'reply',
        icon: Reply,
        label: 'Répondre',
        description: 'Citer ce message',
        onSelect: () => onReply(),
      });
    }
    if (onReact || messageId) {
      out.push({
        id: 'react',
        icon: Smile,
        label: 'Réagir',
        description: 'Ajouter un emoji',
        onSelect: () => {
          // Trigger l'affichage de la reactions bar via hover state simulé
          setHovered(true);
          // Auto-clear après 4s pour mimer un blur naturel
          window.setTimeout(() => setHovered(false), 4000);
        },
      });
    }
    if (onForward) {
      out.push({
        id: 'forward',
        icon: Forward,
        label: 'Transférer',
        description: 'Vers une autre conversation',
        onSelect: () => onForward(),
      });
    }
    if (text) {
      out.push({
        id: 'copy',
        icon: CopyIcon,
        label: 'Copier le texte',
        description: 'Vers le presse-papiers',
        onSelect: handleCopy,
      });
    }
    if (onDelete) {
      out.push({
        id: 'delete',
        icon: Trash2,
        label: 'Supprimer',
        description: 'Action définitive',
        variant: 'danger',
        onSelect: () => onDelete(),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReply, onReact, onForward, onDelete, messageId, text, copyableText]);

  // Sprint 33 vague 33-2A — state local des reactions, hydraté depuis
  // localStorage si `messageId` fourni. Fallback sur la prop `reactions`
  // (seed legacy depuis metadata JSON).
  const [reactionsState, setReactionsState] = useState<Reaction[]>(reactions ?? []);
  useEffect(() => {
    if (!messageId) {
      setReactionsState(reactions ?? []);
      return;
    }
    const stored = getReactions(messageId);
    if (stored.length > 0) {
      setReactionsState(stored);
    } else if (reactions && reactions.length > 0) {
      setReactionsState(reactions);
    } else {
      setReactionsState([]);
    }
  }, [messageId, reactions]);

  // Shape asymmetric : sent = tail bottom-right (rounded-br-md),
  //                   received = tail top-left (rounded-tl-md).
  // Tailwind rounded-2xl = 16px, rounded-md = 6px.
  const shapeClass = isSent
    ? 'rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-md'
    : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl';

  // Background / border selon état
  let bgClass = '';
  let textClass = 'text-[var(--text-primary)]';
  let metaClass = 'text-[var(--text-muted)]';

  if (isNote) {
    bgClass = 'bg-[#FFF9C4] border border-[#FFE082]';
    textClass = 'text-[#5D4037]';
    metaClass = 'text-[#8D6E63]';
  } else if (isFailed) {
    bgClass = 'bg-[var(--danger-soft)] border border-[var(--danger)]';
    textClass = 'text-[var(--danger)]';
    metaClass = 'text-[var(--danger)]';
  } else if (isSent) {
    bgClass = 'msg-bubble-gradient-sent';
    textClass = 'text-white';
    metaClass = 'text-white/70';
  } else {
    bgClass = 'surface-1 border border-[var(--border-subtle)]';
  }

  // Stagger entrance (max 240ms)
  const delay = Math.min(stagger * 30, 240);

  // Width avatar slot pour alignement consistant
  const avatarSlot = !isSent ? (
    <div className="w-8 shrink-0 flex items-end">
      {showAvatar && avatar ? (
        <Avatar name={avatar.name} src={avatar.src} size="sm" />
      ) : (
        <div className="w-8 h-8" aria-hidden />
      )}
    </div>
  ) : null;

  // Sprint 44 M3.1 + M3.2 — Merge swipe-to-reply + long-press handlers
  // Les deux gestures coexistent : long-press (500ms timer) annulé si swipe > 10px,
  // swipe annulé si long-press fire d'abord (mais en pratique 500ms se déclenche
  // avant que l'user dépasse les 40px de swipe sauf en touch rapide).
  const handleTouchStartMerged = (e: React.TouchEvent) => {
    handleSwipeStart(e);
    if (hasContextActions) longPressProps.onTouchStart(e);
  };
  const handleTouchMoveMerged = (e: React.TouchEvent) => {
    handleSwipeMove(e);
    if (hasContextActions) longPressProps.onTouchMove(e);
  };
  const handleTouchEndMerged = (e: React.TouchEvent) => {
    handleSwipeEnd();
    if (hasContextActions) longPressProps.onTouchEnd(e);
  };

  return (
    <div
      className={`flex mb-2 gap-2 msg-bubble-enter ${isSent ? 'justify-end' : 'justify-start'}`}
      style={{ animationDelay: `${delay}ms` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={handleTouchStartMerged}
      onTouchMove={handleTouchMoveMerged}
      onTouchEnd={handleTouchEndMerged}
      onTouchCancel={handleSwipeEnd}
    >
      {avatarSlot}

      <div
        className={`relative max-w-[70%] flex flex-col ${isSent ? 'items-end' : 'items-start'}`}
        style={{
          transform: swipeDelta !== 0 ? `translateX(${swipeDelta}px)` : undefined,
          transition: swipeDelta === 0 ? 'transform 220ms cubic-bezier(0.32,0.72,0,1)' : 'none',
          willChange: swipeDelta !== 0 ? 'transform' : undefined,
        }}
      >
        {/* Sprint 44 M3.1 — Reveal reply icon derriere la bulle pendant le swipe.
            Positionnement : ancré du cote oppose au swipe (received=left, sent=right). */}
        {canSwipe && swipeProgress > 0 && (
          <div
            aria-hidden
            className={`msg-swipe-reply-hint ${swipeProgress >= 1 ? 'is-active' : ''}`}
            style={{
              opacity: swipeProgress,
              transform: `scale(${0.7 + swipeProgress * 0.3})`,
              [swipeDirSign > 0 ? 'left' : 'right']: -40,
            }}
          >
            <Icon as={Reply} size="sm" />
          </div>
        )}
        {/* Reactions bar contextuelle au-dessus du bubble (Sprint 26 vague 26-1B)
            Sprint 33 vague 33-2A — visible aussi quand `messageId` est fourni
            (persistence locale autonome, pas besoin d'un callback parent). */}
        {(onReact || messageId) && (
          <MessageReactions
            visible={hovered}
            align={isSent ? 'right' : 'left'}
            messageId={messageId}
            onReact={onReact}
            onReactionsChange={setReactionsState}
          />
        )}

        <div
          className={`px-3 py-2 transition-opacity ${shapeClass} ${bgClass} ${textClass} ${isSending ? 'opacity-60' : ''}`}
        >
          {isNote && (
            <p className="text-[9px] font-bold mb-0.5 opacity-70">📝 Note interne</p>
          )}
          {subject && (
            <p className={`text-[10px] font-semibold mb-0.5 ${isSent && !isNote && !isFailed ? 'text-white/85' : 'text-[var(--text-muted)]'}`}>
              {subject}
            </p>
          )}
          {text && (
            <p className="text-xs whitespace-pre-wrap break-words leading-relaxed">{text}</p>
          )}

          {/* Attachments (Sprint 26 vague 26-1B) */}
          {attachments && attachments.length > 0 && (
            <div className={text ? 'mt-2' : ''}>
              <MessageAttachment
                attachments={attachments}
                tone={isSent && !isNote && !isFailed ? 'on-brand' : 'on-surface'}
              />
            </div>
          )}

          {/* Meta row : status icon + time + sender */}
          <div className={`flex items-center justify-end gap-1 mt-1 ${metaClass}`}>
            {isSending && (
              <>
                <Icon as={Clock3} size="xs" className="msg-bubble-status-pulse" aria-label="Envoi en cours" />
                <span className="text-[9px] italic">Envoi…</span>
              </>
            )}
            {isFailed && (
              <>
                <Icon as={AlertCircle} size="xs" aria-label="Échec d'envoi" />
                <span className="text-[9px] font-semibold">Échoué</span>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="chip-btn chip-btn--sm ml-1"
                    title="Renvoyer le message"
                    style={{ height: 20, padding: '0 8px', fontSize: 10 }}
                  >
                    <Icon as={RotateCw} size={10} /> Renvoyer
                  </button>
                )}
              </>
            )}
            {!isSending && !isFailed && (
              <>
                {/* LOT SMS/WHATSAPP seq 104 — badge canal WhatsApp (sobre). */}
                {channel === 'whatsapp' && (
                  <span className="text-[9px] font-semibold" aria-label="WhatsApp">
                    WhatsApp
                  </span>
                )}
                <span className="text-[9px] t-mono-num">{formatTime(timestamp)}</span>
                {senderName && <span className="text-[9px]">· {senderName}</span>}
                {isSent && status && <StatusIcon status={status} />}
                {/* LOT SMS/WHATSAPP seq 104 — accusé de livraison SMS sortant.
                    DISTINCT de status ; n'apparaît que sur les messages sortants
                    et seulement si le worker a posé delivery_status. */}
                {isSent && deliveryStatus && (
                  <DeliveryStatusBadge deliveryStatus={deliveryStatus} />
                )}
              </>
            )}
          </div>
        </div>

        {/* Reactions existantes (chips compact) — Sprint 33 vague 33-2A :
            source = `reactionsState` (localStorage-backed si messageId fourni).
            Click chip → toggle direct via `toggleReaction` (persiste + update),
            sinon fallback callback legacy `onReact`. */}
        {reactionsState.length > 0 && (onReact || messageId) && (
          <div className={`flex flex-wrap gap-1 mt-1 ${isSent ? 'justify-end' : 'justify-start'}`}>
            {reactionsState.map(r => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => {
                  if (messageId) {
                    void toggleReaction(messageId, r.emoji).then(setReactionsState);
                  }
                  onReact?.(r.emoji);
                }}
                className={`msg-reaction-chip ${r.reacted ? 'msg-reaction-chip--active' : ''}`}
                aria-label={`Réaction ${r.emoji} (${r.count})`}
                aria-pressed={r.reacted}
              >
                <span className="msg-reaction-chip-emoji">{r.emoji}</span>
                <span className="t-mono-num text-[9px] font-semibold">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sprint 44 M3.2 — Contextual actions sheet (long-press mobile) */}
      {hasContextActions && contextActions.length > 0 && (
        <ContextualActionsSheet
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          title={isSent ? 'Message envoyé' : (senderName || avatar?.name || 'Message reçu')}
          description={subject || (text ? text.slice(0, 80) : undefined)}
          actions={contextActions}
        />
      )}
    </div>
  );
}

// ── LOT SMS/WHATSAPP seq 104 — accusé de livraison SMS (Phase C) ─────────────
// Petit badge sobre dérivé de messages.delivery_status (valeurs libres, sans
// CHECK côté DB — posées par handleSmsStatusCallback). On normalise vers 3
// familles d'icônes (envoyé / livré / échec) + un libellé court ; toute valeur
// inconnue retombe sur un affichage texte brut neutre (jamais d'erreur).
function DeliveryStatusBadge({ deliveryStatus }: { deliveryStatus: string }) {
  const s = deliveryStatus.toLowerCase();
  const isDelivered = s === 'delivered';
  const isFailed = s === 'failed' || s === 'undelivered';
  const Ico = isDelivered ? CheckCheck : isFailed ? AlertCircle : Check;
  const label = isDelivered
    ? 'Livré'
    : isFailed
      ? 'Échec'
      : s === 'sent'
        ? 'Envoyé'
        : deliveryStatus;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[9px]"
      style={isFailed ? { color: 'var(--danger)' } : undefined}
      aria-label={`Livraison SMS : ${label}`}
      title={`Livraison SMS : ${label}`}
    >
      <Icon as={Ico} size="xs" />
      <span>{label}</span>
    </span>
  );
}

// ── Status icon ─────────────────────────────────────────────────────────────
function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === 'sent') {
    return <Icon as={Check} size="xs" aria-label="Envoyé" />;
  }
  if (status === 'delivered') {
    return <Icon as={CheckCheck} size="xs" aria-label="Livré" />;
  }
  if (status === 'read') {
    return (
      <Icon
        as={CheckCheck}
        size="xs"
        className="msg-bubble-status-read"
        aria-label="Lu"
      />
    );
  }
  return null;
}
