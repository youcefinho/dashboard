// ── ContextualActionsSheet — Sprint 44 M3.2 ─────────────────────────────────
// Primitive uniforme pour menus contextuels mobile (long-press → actions list).
// Wraps BottomSheet avec une liste d'actions configurables (icon + label +
// optional variant `danger`).
//
// Pattern usage typique :
//   const [open, setOpen] = useState(false);
//   const ref = useRef<HTMLDivElement>(null);
//   const longPress = useLongPress(() => setOpen(true), undefined, { mobileOnly: true });
//   <div ref={ref} {...longPress}>...</div>
//   <ContextualActionsSheet
//     open={open}
//     onOpenChange={setOpen}
//     title="Lead · Marie Tremblay"
//     actions={[
//       { id: 'edit', icon: Pencil, label: 'Modifier', onSelect: () => ... },
//       { id: 'duplicate', icon: Copy, label: 'Dupliquer', onSelect: ... },
//       { id: 'archive', icon: Archive, label: 'Archiver', onSelect: ... },
//       { id: 'delete', icon: Trash2, label: 'Supprimer', variant: 'danger', onSelect: ... },
//     ]}
//   />
//
// Design : iOS-style action sheet — rows hauteur 48px, icon 18px gauche,
// label centré gauche, danger row = rouge. Auto-close après tap action.
// Haptic light au tap. Respect prefers-reduced-motion (BottomSheet le fait).

import type { ComponentType, SVGProps } from 'react';
import { BottomSheet } from './BottomSheet';
import { Icon } from './Icon';
import { triggerHaptic } from '@/lib/sensorial';

export type ContextualActionVariant = 'default' | 'primary' | 'danger';

export interface ContextualAction {
  /** Identifiant unique (key React + tracking). */
  id: string;
  /** Icon Lucide (component, ex: `Pencil`). */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Label affiché à droite de l'icône. */
  label: string;
  /** Sous-titre optionnel (1 ligne, gris). */
  description?: string;
  /** Variant visuel ; `danger` = rouge. */
  variant?: ContextualActionVariant;
  /** Désactive l'action (grisée, non cliquable). */
  disabled?: boolean;
  /** Callback exécuté au tap. La sheet se ferme automatiquement avant. */
  onSelect: () => void;
}

export interface ContextualActionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Titre de la sheet (ex: "Lead · Marie Tremblay" ou "Tâche"). */
  title?: string;
  /** Sous-titre optionnel sous le titre. */
  description?: string;
  /** Liste d'actions à afficher (ordre = ordre d'affichage). */
  actions: ContextualAction[];
}

export function ContextualActionsSheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
}: ContextualActionsSheetProps) {
  const handleSelect = (action: ContextualAction) => {
    if (action.disabled) return;
    triggerHaptic('light');
    onOpenChange(false);
    // Délai léger pour laisser l'animation de fermeture démarrer avant l'action
    // (évite que la sheet "saute" en cas d'action synchrone qui re-render).
    requestAnimationFrame(() => action.onSelect());
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="auto"
      showHandle
    >
      <ul className="contextual-actions-list" role="menu">
        {actions.map((action) => {
          const variantClass =
            action.variant === 'danger'
              ? 'is-danger'
              : action.variant === 'primary'
                ? 'is-primary'
                : '';
          return (
            <li key={action.id} role="none">
              <button
                role="menuitem"
                type="button"
                disabled={action.disabled}
                onClick={() => handleSelect(action)}
                className={`contextual-actions-row ${variantClass}`}
              >
                <span className="contextual-actions-row__icon" aria-hidden>
                  <Icon as={action.icon as any} size={18} strokeWidth={2} />
                </span>
                <span className="contextual-actions-row__body">
                  <span className="contextual-actions-row__label">{action.label}</span>
                  {action.description && (
                    <span className="contextual-actions-row__desc">{action.description}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
