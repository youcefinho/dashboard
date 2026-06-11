// ── OnboardingChecklistPanel — Sprint 21 (Onboarding durci) ─────────────────
//
// Composant panneau checklist 9 items (6 CRM + 3 e-commerce conditionnels) qui
// synchronise son état avec le serveur via `getOnboardingChecklist` et expose
// 3 actions par item : "Marquer comme fait" / "Passer" / navigate.
//
// 3 variants :
//   - 'page'    : layout complet 3 sections (first_steps / go_further / explore)
//                 utilisé par /getting-started.
//   - 'sidebar' : version compacte (réutilisable depuis SlidePanel chip).
//   - 'modal'   : version compacte (réutilisable dans une Modal).
//
// Best-effort dégradé : si l'API fail, on garde state = null et on rend une
// liste vide (PAS de crash, PAS de toast d'erreur — silencieux pour ne pas
// interrompre le flux user).
//
// E-commerce items : visibles uniquement si module 'ecommerce' actif (réutilise
// `useHasModule` — même contrat que `OnboardingProgressChip`).
//
// i18n : utilise les 24 clés Phase A figées (`onboarding.checklist.crm_*`,
// `onboarding.checklist.ecommerce_*` plat S8, `onboarding.checklist.action_*`,
// `onboarding.getting_started.section_*`).

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  Check, ChevronRight, User, Users, Briefcase, Plug, UserPlus, BookOpen,
  Package, ShoppingBag, Store, RotateCcw, X as XIcon,
} from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  getOnboardingChecklist,
  completeOnboardingItem,
  skipOnboardingItem,
  resetOnboardingChecklist,
} from '@/lib/api';
import type {
  OnboardingChecklistItemKey,
  OnboardingChecklistResponse,
} from '@/lib/types';
import { useHasModule } from '@/components/ecommerce/ModuleGuard';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';

export interface OnboardingChecklistPanelProps {
  variant?: 'page' | 'sidebar' | 'modal';
  /**
   * Si fourni, appelé quand l'user clique un item dont aucune action explicite
   * n'a été déclenchée (CTA principal "Aller à la section").
   */
  onItemNavigate?: (to: string) => void;
}

// ── Mapping item → label/desc/icon/target ────────────────────────────────────
// Les 6 items CRM utilisent les clés Phase A (`crm_<x>.label/.desc`).
// Les 3 items e-comm utilisent les clés S8 existantes en format plat.

interface ItemDef {
  key: OnboardingChecklistItemKey;
  labelKey: string;
  descKey: string;
  icon: typeof Check;
  to: string;
  category: 'crm' | 'ecommerce';
  /** À quelle section appartient l'item dans le variant 'page'. */
  section: 'first_steps' | 'go_further' | 'explore';
}

const ITEM_DEFS: readonly ItemDef[] = [
  {
    key: 'profile_completed',
    labelKey: 'onboarding.checklist.crm_profile.label',
    descKey: 'onboarding.checklist.crm_profile.desc',
    icon: User,
    to: '/settings',
    category: 'crm',
    section: 'first_steps',
  },
  {
    key: 'leads_imported',
    labelKey: 'onboarding.checklist.crm_leads.label',
    descKey: 'onboarding.checklist.crm_leads.desc',
    icon: UserPlus,
    to: '/leads',
    category: 'crm',
    section: 'first_steps',
  },
  {
    key: 'pipeline_configured',
    labelKey: 'onboarding.checklist.crm_pipeline.label',
    descKey: 'onboarding.checklist.crm_pipeline.desc',
    icon: Briefcase,
    to: '/pipeline',
    category: 'crm',
    section: 'first_steps',
  },
  {
    key: 'team_invited',
    labelKey: 'onboarding.checklist.crm_team.label',
    descKey: 'onboarding.checklist.crm_team.desc',
    icon: Users,
    to: '/settings',
    category: 'crm',
    section: 'go_further',
  },
  {
    key: 'integration_connected',
    labelKey: 'onboarding.checklist.crm_integration.label',
    descKey: 'onboarding.checklist.crm_integration.desc',
    icon: Plug,
    to: '/integrations',
    category: 'crm',
    section: 'go_further',
  },
  {
    key: 'docs_visited',
    labelKey: 'onboarding.checklist.crm_docs.label',
    descKey: 'onboarding.checklist.crm_docs.desc',
    icon: BookOpen,
    to: '/help',
    category: 'crm',
    section: 'go_further',
  },
  {
    key: 'ecommerce_catalog',
    labelKey: 'onboarding.checklist.ecommerce_catalog',
    descKey: 'onboarding.checklist.ecommerce_catalog_desc',
    icon: Store,
    to: '/boutique/produits',
    category: 'ecommerce',
    section: 'explore',
  },
  {
    key: 'ecommerce_first_product',
    labelKey: 'onboarding.checklist.ecommerce_first_product',
    descKey: 'onboarding.checklist.ecommerce_first_product_desc',
    icon: Package,
    to: '/boutique/produits',
    category: 'ecommerce',
    section: 'explore',
  },
  {
    key: 'ecommerce_channel',
    labelKey: 'onboarding.checklist.ecommerce_channel',
    descKey: 'onboarding.checklist.ecommerce_channel_desc',
    icon: ShoppingBag,
    to: '/boutique',
    category: 'ecommerce',
    section: 'explore',
  },
] as const;

/** Helper : état effectif (done / skipped / pending) pour un item donné. */
type ItemStatus = 'done' | 'skipped' | 'pending';

function statusFor(
  key: OnboardingChecklistItemKey,
  state: OnboardingChecklistResponse | null,
): ItemStatus {
  const item = state?.items?.[key];
  if (!item) return 'pending';
  if (item.done) return 'done';
  if (item.skipped) return 'skipped';
  return 'pending';
}

export function OnboardingChecklistPanel({
  variant = 'sidebar',
  onItemNavigate,
}: OnboardingChecklistPanelProps) {
  const [state, setState] = useState<OnboardingChecklistResponse | null>(null);
  // Loading initial vs in-flight (refetch après action). Pas de spinner global
  // pour éviter le flash — on garde l'UI précédente pendant l'update.
  const [busyKey, setBusyKey] = useState<OnboardingChecklistItemKey | null>(null);
  const ecommerceStatus = useHasModule('ecommerce');
  const ecommerceActive = ecommerceStatus === 'enabled';

  // ── Initial fetch ──────────────────────────────────────────────────────────
  // Best-effort : si fail, on garde state = null (rendu dégradé silencieux).
  useEffect(() => {
    let cancelled = false;
    getOnboardingChecklist()
      .then((res) => {
        if (cancelled) return;
        if (res.data) setState(res.data);
      })
      .catch(() => { /* silent dégradé */ });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await getOnboardingChecklist();
      if (res.data) setState(res.data);
    } catch { /* silent */ }
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleComplete = useCallback(async (key: OnboardingChecklistItemKey) => {
    setBusyKey(key);
    try {
      const res = await completeOnboardingItem(key);
      if (res.data) setState(res.data);
      else await refresh();
    } catch { await refresh(); }
    finally { setBusyKey(null); }
  }, [refresh]);

  const handleSkip = useCallback(async (key: OnboardingChecklistItemKey) => {
    setBusyKey(key);
    try {
      const res = await skipOnboardingItem(key);
      if (res.data) setState(res.data);
      else await refresh();
    } catch { await refresh(); }
    finally { setBusyKey(null); }
  }, [refresh]);

  const handleReset = useCallback(async () => {
    try {
      const res = await resetOnboardingChecklist();
      if (res.data) setState(res.data);
      else await refresh();
    } catch { await refresh(); }
  }, [refresh]);

  const handleNavigate = useCallback((to: string) => {
    onItemNavigate?.(to);
  }, [onItemNavigate]);

  // ── Filter items selon module e-commerce ──────────────────────────────────
  const visibleItems = ITEM_DEFS.filter((def) =>
    def.category === 'crm' || ecommerceActive,
  );

  // Si rien à afficher (cas extrême : disabled e-comm + erreur fetch), on
  // affiche au moins les 6 items CRM en pending pour ne jamais avoir un vide
  // total trompeur.
  const total = state?.total ?? visibleItems.length;
  const completed = state?.completed ?? 0;
  const pct = state?.pct ?? (total > 0 ? Math.round((completed / total) * 100) : 0);
  const allDone = total > 0 && completed >= total;

  // ── Rendu d'un item ────────────────────────────────────────────────────────

  const renderItem = (def: ItemDef): ReactNode => {
    const status = statusFor(def.key, state);
    const isDone = status === 'done';
    const isSkipped = status === 'skipped';
    const isBusy = busyKey === def.key;
    const label = t(def.labelKey);
    const desc = t(def.descKey);

    return (
      <li key={def.key} className="onboarding-checklist-panel-item">
        <div
          className={cn(
            'checklist-item flex items-start gap-3 rounded-lg border p-3 transition-colors',
            isDone && 'is-done bg-[var(--bg-subtle)] border-[var(--border)]',
            isSkipped && 'bg-[var(--bg-subtle)] border-[var(--border)] opacity-70',
            !isDone && !isSkipped && 'bg-[var(--bg-surface)] border-[var(--border)] hover:bg-[var(--bg-hover)]',
          )}
        >
          {/* Indicateur visuel done/skipped/pending */}
          <span
            className={cn(
              'checklist-check inline-flex h-6 w-6 items-center justify-center rounded-full shrink-0',
              isDone && 'is-done bg-[var(--success-soft,rgba(21,128,61,0.12))] text-[var(--success,#15803D)]',
              isSkipped && 'bg-[var(--gray-100)] text-[var(--text-muted)]',
              !isDone && !isSkipped && 'bg-[var(--primary-soft,rgba(0,157,219,0.10))] text-[var(--primary)]',
            )}
            aria-hidden
          >
            {isDone ? (
              <Icon as={Check} size={14} strokeWidth={3} />
            ) : isSkipped ? (
              <Icon as={XIcon} size={12} />
            ) : (
              <Icon as={def.icon} size={12} />
            )}
          </span>

          <div className="flex-1 min-w-0">
            <p className={cn(
              'checklist-title text-sm font-semibold',
              isDone ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--text-primary)]',
            )}>
              {label}
            </p>
            <p className="checklist-desc text-xs text-[var(--text-muted)] mt-0.5">{desc}</p>

            {/* Actions inline (sauf si déjà done) */}
            {!isDone && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleNavigate(def.to)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline cursor-pointer disabled:opacity-50"
                  disabled={isBusy}
                  aria-label={`${label} — ${t('onboarding.getting_started.continue_setup')}`}
                >
                  {t('onboarding.getting_started.continue_setup')}
                  <Icon as={ChevronRight} size={12} />
                </button>

                <button
                  type="button"
                  onClick={() => void handleComplete(def.key)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-50"
                  disabled={isBusy}
                  aria-label={`${t('onboarding.checklist.action_complete')} — ${label}`}
                >
                  {t('onboarding.checklist.action_complete')}
                </button>

                {!isSkipped && (
                  <button
                    type="button"
                    onClick={() => void handleSkip(def.key)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-50"
                    disabled={isBusy}
                    aria-label={`${t('onboarding.checklist.action_skip')} — ${label}`}
                  >
                    {t('onboarding.checklist.action_skip')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </li>
    );
  };

  // ── Variant 'page' : 3 sections (first_steps / go_further / explore) ───────

  if (variant === 'page') {
    const firstSteps = visibleItems.filter((d) => d.section === 'first_steps');
    const goFurther = visibleItems.filter((d) => d.section === 'go_further');
    const explore = visibleItems.filter((d) => d.section === 'explore');

    return (
      <div className="onboarding-checklist-panel onboarding-checklist-panel--page space-y-6">
        {/* Header : progression globale */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {t('onboarding.getting_started.title')}
              </p>
              <p className="t-h3 text-[var(--text-primary)] mt-1">
                {completed}/{total} · {pct}%
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Icon as={RotateCcw} size={12} />}
              onClick={() => void handleReset()}
              aria-label={t('onboarding.checklist.action_reset')}
            >
              {t('onboarding.checklist.action_reset')}
            </Button>
          </div>
          <div
            className="h-1.5 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct}%`}
          >
            <span
              className="block h-full bg-[var(--primary)] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </Card>

        {/* État "tout fait" */}
        {allDone && (
          <Card className="p-6 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--success-soft,rgba(21,128,61,0.12))] text-[var(--success,#15803D)] mb-3">
              <Icon as={Check} size={24} strokeWidth={3} />
            </div>
            <p className="t-h3 text-[var(--text-primary)] mb-1">
              {t('onboarding.checklist.empty_done')}
            </p>
          </Card>
        )}

        {/* Section 1 — Premiers pas (À faire en premier) */}
        {firstSteps.length > 0 && (
          <section aria-labelledby="onb-section-first-steps">
            <h3
              id="onb-section-first-steps"
              className="text-sm font-semibold text-[var(--text-primary)] mb-2"
            >
              {t('onboarding.getting_started.section_first_steps')}
            </h3>
            <ul className="space-y-2">
              {firstSteps.map(renderItem)}
            </ul>
          </section>
        )}

        {/* Section 2 — Aller plus loin */}
        {goFurther.length > 0 && (
          <section aria-labelledby="onb-section-go-further">
            <h3
              id="onb-section-go-further"
              className="text-sm font-semibold text-[var(--text-primary)] mb-2"
            >
              {t('onboarding.getting_started.section_go_further')}
            </h3>
            <ul className="space-y-2">
              {goFurther.map(renderItem)}
            </ul>
          </section>
        )}

        {/* Section 3 — Tu peux aussi explorer (e-commerce conditionnel) */}
        {explore.length > 0 && (
          <section aria-labelledby="onb-section-explore">
            <h3
              id="onb-section-explore"
              className="text-sm font-semibold text-[var(--text-primary)] mb-2"
            >
              {t('onboarding.getting_started.section_explore')}
            </h3>
            <ul className="space-y-2">
              {explore.map(renderItem)}
            </ul>
          </section>
        )}
      </div>
    );
  }

  // ── Variant 'sidebar' / 'modal' : liste simple compacte ────────────────────

  return (
    <div className={cn(
      'onboarding-checklist-panel',
      variant === 'sidebar' && 'onboarding-checklist-panel--sidebar',
      variant === 'modal' && 'onboarding-checklist-panel--modal',
    )}>
      {/* Mini header progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            {completed}/{total}
          </span>
          <span className="text-xs font-semibold text-[var(--primary)] tabular-nums">{pct}%</span>
        </div>
        <div
          className="h-1 w-full rounded-full bg-[var(--bg-subtle)] overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            className="block h-full bg-[var(--primary)] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Liste plate */}
      <ul className="space-y-2">
        {visibleItems.map(renderItem)}
      </ul>

      {/* Reset (en bas) */}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void handleReset()}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          aria-label={t('onboarding.checklist.action_reset')}
        >
          <Icon as={RotateCcw} size={11} />
          {t('onboarding.checklist.action_reset')}
        </button>
      </div>
    </div>
  );
}
