// ── GuidedEmptyState — Sprint 21 (Onboarding durci) ─────────────────────────
//
// Wrapper de `<EmptyState variant="first-time">` pour empty states "guidés"
// pages métier (Leads, Pipeline, etc.). Enrichit l'empty state existant avec :
//   1. `meta` automatique = "Étape de configuration" (i18n) si itemKey fourni
//   2. action secondaire "Passer" qui appelle `skipOnboardingItem(itemKey)`
//      (best-effort, silencieux côté UI).
//   3. `tips[]` rendus nativement par EmptyState (Sprint 38 supporte déjà tips
//      avec liste numérotée — pas besoin de slot custom).
//
// API publique stricte (props additives, optionnelles). NE casse PAS l'API
// d'EmptyState d'origine. Si `itemKey` absent, le composant se dégrade en
// `<EmptyState>` standard (pas de meta auto, pas de skip secondaire).

import { type ReactNode } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { skipOnboardingItem } from '@/lib/api';
import type { OnboardingChecklistItemKey } from '@/lib/types';
import { t } from '@/lib/i18n';

export interface GuidedEmptyStateProps {
  /** Clé checklist Sprint 21. Si fourni, "Passer" devient visible. */
  itemKey?: OnboardingChecklistItemKey;
  icon?: ReactNode;
  title: string;
  description?: string;
  /** CTA principal (ex: bouton "Importer mes leads"). */
  action?: ReactNode;
  /** Sous-titre pour les conseils (i18n `tips_title`). */
  tips?: string[];
  className?: string;
}

export function GuidedEmptyState({
  itemKey,
  icon,
  title,
  description,
  action,
  tips,
  className,
}: GuidedEmptyStateProps) {
  const handleSkip = itemKey
    ? () => { void skipOnboardingItem(itemKey); }
    : undefined;

  const secondaryAction = handleSkip ? (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleSkip}
      aria-label={t('onboarding.checklist.action_skip')}
    >
      {t('onboarding.checklist.action_skip')}
    </Button>
  ) : undefined;

  return (
    <EmptyState
      variant="first-time"
      icon={icon}
      title={title}
      description={description}
      meta={itemKey ? t('onboarding.guided_empty.step_label') : undefined}
      action={action}
      secondaryAction={secondaryAction}
      tips={tips}
      className={className}
    />
  );
}
