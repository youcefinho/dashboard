// ── MessageReactions — Sprint 26 vague 26-1B ─────────────────────────────────
// Reactions emoji bar contextuelle apparaissant au hover du bubble parent.
// 6 emoji presets : 👍 ❤️ 😂 😮 😢 🎉.
//
// La gestion de "reactions existantes" (chips sous le bubble) est faite
// directement dans MessageBubble — ce composant ne fait que la BARRE de picker.
//
// ── Sprint 33 vague 33-2A — Persistence localStorage + optimistic UI ─────────
// Quand un `messageId` est fourni, ce composant :
//   1. Hydrate au mount via `getReactions(messageId)`
//   2. Sur click emoji → optimistic update local + appel async `toggleReaction`
//   3. Sur erreur (futur backend) → rollback au state précédent
//   4. Notifie le parent via `onReactionsChange` après chaque commit
// Le parent (MessageBubble) consomme `onReactionsChange` pour mettre à jour
// le rendu des chips sous le bubble.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Smile } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/DropdownMenu';
import { useSound } from '@/hooks/useSound';
import { useHaptic } from '@/hooks/useHaptic';
import { getReactions, toggleReaction, type Reaction } from '@/lib/reactions';

// Re-export pour préserver les imports existants (MessageBubble + autres).
export type { Reaction } from '@/lib/reactions';

export const PRESET_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const;

// Extended set pour le picker DropdownMenu
const EXTENDED_EMOJIS = [
  '👍', '👎', '❤️', '🔥', '🎉', '🙏',
  '😂', '😮', '😢', '😡', '🤔', '👀',
  '✅', '❌', '⭐', '💯', '🚀', '💡',
];

interface Props {
  visible: boolean;
  align: 'left' | 'right';
  /**
   * Sprint 33 — Si fourni, le composant gère lui-même la persistence
   * localStorage via `toggleReaction(messageId, emoji)` et notifie le parent
   * via `onReactionsChange`. Si absent → legacy mode, on appelle juste `onReact`.
   */
  messageId?: string;
  /** Callback "stub" optionnel (utilisé en legacy ou pour analytics/telemetry). */
  onReact?: (emoji: string) => void;
  /** Sprint 33 — Notifié après chaque toggle persisté (state agrégé du store). */
  onReactionsChange?: (reactions: Reaction[]) => void;
}

export function MessageReactions({
  visible,
  align,
  messageId,
  onReact,
  onReactionsChange,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { play } = useSound();
  const { vibrate } = useHaptic();

  // Snapshot local pour optimistic UI + rollback (Sprint 33 vague 33-2A).
  // Pas affiché dans ce composant, juste utilisé pour calculer le rollback
  // si la promesse `toggleReaction` rejette plus tard (futur backend).
  const lastReactionsRef = useRef<Reaction[]>([]);

  // Sync au mount via `getReactions` quand messageId est connu
  useEffect(() => {
    if (!messageId) return;
    const initial = getReactions(messageId);
    lastReactionsRef.current = initial;
    onReactionsChange?.(initial);
    // Volontairement pas de dep sur `onReactionsChange` (ref-stable côté parent)
    // pour éviter une boucle infinie si le parent réassigne.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  const handleReact = async (emoji: string) => {
    play('toggle');
    vibrate('light');
    // Legacy callback (analytics / extension)
    onReact?.(emoji);

    if (!messageId) return;

    // Optimistic : compute next state localement avant le résolu de la promesse
    const prev = lastReactionsRef.current;
    const userId = 'current-user';
    const existingIdx = prev.findIndex((r) => r.emoji === emoji);
    let optimistic: Reaction[];
    if (existingIdx >= 0) {
      const r = prev[existingIdx]!;
      if (r.reacted) {
        // unreact → decrement / remove
        const nextCount = r.count - 1;
        if (nextCount <= 0) {
          optimistic = prev.filter((_, i) => i !== existingIdx);
        } else {
          optimistic = [
            ...prev.slice(0, existingIdx),
            {
              ...r,
              count: nextCount,
              userIds: r.userIds.filter((u) => u !== userId),
              reacted: false,
            },
            ...prev.slice(existingIdx + 1),
          ];
        }
      } else {
        // react → increment
        optimistic = [
          ...prev.slice(0, existingIdx),
          {
            ...r,
            count: r.count + 1,
            userIds: [...r.userIds, userId],
            reacted: true,
          },
          ...prev.slice(existingIdx + 1),
        ];
      }
    } else {
      // nouvelle reaction
      optimistic = [
        ...prev,
        { emoji, count: 1, userIds: [userId], reacted: true },
      ];
    }
    onReactionsChange?.(optimistic);

    // Async commit → en cas d'erreur, rollback au state précédent
    try {
      const persisted = await toggleReaction(messageId, emoji, userId);
      lastReactionsRef.current = persisted;
      onReactionsChange?.(persisted);
    } catch {
      // Rollback (futur backend rejection)
      onReactionsChange?.(prev);
      lastReactionsRef.current = prev;
    }
  };

  const positionStyle: CSSProperties =
    align === 'right' ? { right: 4 } : { left: 4 };

  return (
    <div
      role="toolbar"
      aria-label="Réagir au message"
      aria-hidden={!visible && !pickerOpen}
      className={`msg-reactions-bar ${visible || pickerOpen ? 'is-visible' : ''}`}
      style={positionStyle}
    >
      {PRESET_EMOJIS.map(e => (
        <button
          key={e}
          type="button"
          onClick={() => void handleReact(e)}
          className="msg-reactions-bar-btn"
          aria-label={`Réagir avec ${e}`}
        >
          {e}
        </button>
      ))}
      <DropdownMenuRoot open={pickerOpen} onOpenChange={setPickerOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="msg-reactions-bar-btn msg-reactions-bar-more"
            aria-label="Plus d'emojis"
          >
            <Icon as={Smile} size="sm" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" sideOffset={8}>
          <div className="grid grid-cols-6 gap-1 p-1" role="grid" aria-label="Picker d'emojis">
            {EXTENDED_EMOJIS.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  void handleReact(e);
                  setPickerOpen(false);
                }}
                className="msg-reactions-picker-btn"
                aria-label={`Réagir avec ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenuRoot>
    </div>
  );
}
