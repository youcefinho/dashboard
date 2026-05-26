// ── OnboardingProgressChip — Sprint 45 M1.4 (2026-05-15) ─────────────────────
// Chip bottom sidebar : "X/5 setup steps" avec progress bar 4px primary.
// Click → ouvre <SlidePanel> droite "Configuration recommandée" avec checklist 5 items.
//
// Auto-hide quand 5/5 atteint.
// Stripe-clean SUBTLE : no glow, no gradient massif.
//
// Source des flags (localStorage) :
//   1. `profile_completed`           — set par WelcomeWizard
//   2. `leads_imported_count` ou via API leads count >= 5
//   3. `pipeline_configured`         — set quand l'user a customisé un pipeline
//   4. `team_invited`                — set quand l'user a invité ≥1 membre
//   5. `integration_connected`       — set quand l'user a connecté une intégration
//
// Le composant lit lui-même les flags via une polling subtile (every 30s + on
// click). Pas de prop drilling pour éviter de toucher Sidebar.

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { SlidePanel } from '@/components/ui/SlidePanel';
import { Icon } from '@/components/ui/Icon';
import {
  Check, ChevronRight, User, Users, Briefcase, Plug, UserPlus, Sparkles, X,
  BookOpen, // Sprint 47 M3.4 — Item "Explorer la documentation"
  // ── Sprint S8 — items e-commerce conditionnels (module Boutique) ──
  Package, ShoppingBag, Store,
} from 'lucide-react';
// ── Sprint 21 (Onboarding durci) — état serveur primaire (fallback localStorage) ──
import { getLeads, getOnboardingChecklist } from '@/lib/api';
import type { OnboardingChecklistResponse, OnboardingChecklistItemKey } from '@/lib/types';
import { useHasModule } from '@/components/ecommerce/ModuleGuard';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  icon: typeof Check;
  done: boolean;
  /** Route à pousser sur click */
  to: string;
}

const DISMISSED_KEY = 'onboarding_chip_dismissed';

function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

interface OnboardingProgressChipProps {
  /** Mode collapsed de la Sidebar — chip rendu en miniature */
  collapsed?: boolean;
}

export function OnboardingProgressChip({ collapsed = false }: OnboardingProgressChipProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISSED_KEY));
  const [leadsCount, setLeadsCount] = useState<number | null>(null);
  // ── Sprint 21 (Onboarding durci) — état serveur primaire ────────────────
  // Best-effort : si l'API fail, on garde null et on retombe sur les flags
  // localStorage existants (comportement Sprint 45 préservé).
  const [serverState, setServerState] = useState<OnboardingChecklistResponse | null>(null);

  // Flags lus à chaque render — pas besoin de state séparé (cheap reads).
  const [tick, setTick] = useState(0);

  // Helper : un item est "done" si le serveur le dit OU (fallback) si le flag
  // localStorage est set. Permet de garder le chip à jour entre 2 polls API.
  const isServerDone = useCallback(
    (key: OnboardingChecklistItemKey): boolean => Boolean(serverState?.items?.[key]?.done),
    [serverState],
  );

  const profileDone = isServerDone('profile_completed') || readFlag('profile_completed');
  const pipelineDone = isServerDone('pipeline_configured') || readFlag('pipeline_configured');
  const teamDone = isServerDone('team_invited') || readFlag('team_invited');
  const integrationDone = isServerDone('integration_connected') || readFlag('integration_connected');
  const leadsDone = isServerDone('leads_imported') || (leadsCount ?? 0) >= 5;

  // ── Sprint S8 — items e-commerce VISIBLES uniquement si module Boutique actif.
  // Réutilise le hook projet useHasModule (cache /api/modules partagé, pas de
  // re-fetch). Statut 'loading'|'enabled'|'disabled' — on n'ajoute les items que
  // si 'enabled' (le dénominateur d'auto-hide n'inclut donc les items e-comm que
  // si le module est réellement actif pour le tenant).
  const ecommerceStatus = useHasModule('ecommerce');
  const ecommerceActive = ecommerceStatus === 'enabled';
  const ecomCatalogDone = isServerDone('ecommerce_catalog') || readFlag('ecommerce_catalog_created');
  const ecomProductDone = isServerDone('ecommerce_first_product') || readFlag('ecommerce_first_product');
  const ecomChannelDone = isServerDone('ecommerce_channel') || readFlag('ecommerce_channel_connected');

  // Refresh leads count
  const refreshLeads = useCallback(async () => {
    try {
      const res = await getLeads({});
      if (res.data) setLeadsCount(res.data.length);
    } catch { /* silent */ }
  }, []);

  // ── Sprint 21 — fetch checklist serveur au mount + refresh sur le même
  //    cycle 30s que les leads. Best-effort : silencieux si fail.
  const refreshChecklist = useCallback(async () => {
    try {
      const res = await getOnboardingChecklist();
      if (res.data) setServerState(res.data);
    } catch { /* silent — fallback localStorage */ }
  }, []);

  useEffect(() => {
    void refreshLeads();
    void refreshChecklist();
    // Poll discret : 30s — l'user peut voir la progression sans refresh manuel.
    const id = setInterval(() => {
      setTick((t) => t + 1);
      void refreshLeads();
      void refreshChecklist();
    }, 30_000);
    return () => clearInterval(id);
  }, [refreshLeads, refreshChecklist]);

  // Listen storage changes (ex: autre onglet)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (!e.key) return;
      const watched = [
        'profile_completed', 'pipeline_configured', 'team_invited', 'integration_connected',
        // Sprint S8 — flags e-commerce (set par les pages Boutique)
        'ecommerce_catalog_created', 'ecommerce_first_product', 'ecommerce_channel_connected',
        DISMISSED_KEY,
      ];
      if (watched.includes(e.key)) {
        setTick((t) => t + 1);
        if (e.key === DISMISSED_KEY) setDismissed(readFlag(DISMISSED_KEY));
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const items: ChecklistItem[] = [
    // ── Sprint 21 — labels via i18n (`onboarding.checklist.crm_*.label/.desc`).
    //    Sources : 4 catalogues Phase A figés. Les flags localStorage restent
    //    le source de vérité local (fallback), mais le label/desc passent par t().
    {
      id: 'profile',
      label: t('onboarding.checklist.crm_profile.label'),
      description: t('onboarding.checklist.crm_profile.desc'),
      icon: User,
      done: profileDone,
      to: '/settings',
    },
    {
      id: 'leads',
      label: t('onboarding.checklist.crm_leads.label'),
      description: t('onboarding.checklist.crm_leads.desc'),
      icon: UserPlus,
      done: leadsDone,
      to: '/leads',
    },
    {
      id: 'pipeline',
      label: t('onboarding.checklist.crm_pipeline.label'),
      description: t('onboarding.checklist.crm_pipeline.desc'),
      icon: Briefcase,
      done: pipelineDone,
      to: '/pipeline',
    },
    {
      id: 'team',
      label: t('onboarding.checklist.crm_team.label'),
      description: t('onboarding.checklist.crm_team.desc'),
      icon: Users,
      done: teamDone,
      to: '/settings',
    },
    {
      id: 'integration',
      label: t('onboarding.checklist.crm_integration.label'),
      description: t('onboarding.checklist.crm_integration.desc'),
      icon: Plug,
      done: integrationDone,
      to: '/integrations',
    },
    // ── Sprint 47 M3.4 — Cross-link "Explorer la documentation" → /help ──
    // Marqué "done" dès que l'user a visité /help une fois (flag
    // `docs_visited` set par MarketingHelpPage à l'arrivée).
    {
      id: 'docs',
      label: t('onboarding.checklist.crm_docs.label'),
      description: t('onboarding.checklist.crm_docs.desc'),
      icon: BookOpen,
      done: isServerDone('docs_visited') || readFlag('docs_visited'),
      to: '/help',
    },
    // ── Sprint S8 — items e-commerce (uniquement si module Boutique actif) ──
    // Mécanisme STRICTEMENT identique aux items CRM : flag localStorage +
    // pattern checklist existant. Libellés via t('onboarding.checklist.*').
    // Le spread conditionnel garantit que ces items (et donc le dénominateur
    // de l'auto-hide 100%) n'existent que si ecommerceActive === true.
    ...(ecommerceActive
      ? ([
          {
            id: 'ecommerce_catalog',
            label: t('onboarding.checklist.ecommerce_catalog'),
            description: t('onboarding.checklist.ecommerce_catalog_desc'),
            icon: Store,
            done: ecomCatalogDone,
            to: '/boutique/produits',
          },
          {
            id: 'ecommerce_product',
            label: t('onboarding.checklist.ecommerce_first_product'),
            description: t('onboarding.checklist.ecommerce_first_product_desc'),
            icon: Package,
            done: ecomProductDone,
            to: '/boutique/produits',
          },
          {
            id: 'ecommerce_channel',
            label: t('onboarding.checklist.ecommerce_channel'),
            description: t('onboarding.checklist.ecommerce_channel_desc'),
            icon: ShoppingBag,
            done: ecomChannelDone,
            to: '/boutique',
          },
        ] satisfies ChecklistItem[])
      : []),
  ];

  // tick reference (silence unused-but-needed-for-reactivity)
  void tick;

  const completed = items.filter((it) => it.done).length;
  const total = items.length;
  const pct = Math.round((completed / total) * 100);

  // Auto-hide quand 5/5 atteint OU si user dismissed
  if (completed >= total || dismissed) return null;

  // Click navigate + close panel
  const handleNavigate = (to: string) => {
    setOpen(false);
    void navigate({ to });
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  // ── Collapsed : mini chip (icône + dot pulse) ──────────────────────────────
  if (collapsed) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="onboarding-chip-collapsed"
          aria-label={`Configuration : ${completed} sur ${total} étapes complétées`}
          title={`${completed}/${total} étapes`}
        >
          <Icon as={Sparkles} size={14} />
          <span aria-hidden className="onboarding-chip-collapsed-dot" />
        </button>
        <OnboardingChecklistPanel
          open={open}
          onOpenChange={setOpen}
          items={items}
          completed={completed}
          total={total}
          pct={pct}
          onNavigate={handleNavigate}
          onDismiss={handleDismiss}
        />
      </>
    );
  }

  // ── Expanded : chip "3/5 setup steps" + progress bar ───────────────────────
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="onboarding-chip"
        aria-label={`Configuration : ${completed} sur ${total} étapes complétées. Ouvrir la liste.`}
      >
        <div className="onboarding-chip-head">
          <span className="onboarding-chip-icon" aria-hidden>
            <Icon as={Sparkles} size={12} />
          </span>
          <span className="onboarding-chip-label">
            {completed}/{total} étapes
          </span>
          <span className="onboarding-chip-pct">{pct}%</span>
        </div>
        <div className="onboarding-chip-bar" aria-hidden>
          <span
            className="onboarding-chip-bar-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>
      <OnboardingChecklistPanel
        open={open}
        onOpenChange={setOpen}
        items={items}
        completed={completed}
        total={total}
        pct={pct}
        onNavigate={handleNavigate}
        onDismiss={handleDismiss}
      />
    </>
  );
}

// ── Panel séparé pour éviter une re-création monstre ─────────────────────────

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ChecklistItem[];
  completed: number;
  total: number;
  pct: number;
  onNavigate: (to: string) => void;
  onDismiss: () => void;
}

function OnboardingChecklistPanel({
  open, onOpenChange, items, completed, total, pct, onNavigate, onDismiss,
}: PanelProps) {
  // Sprint 21 — handler "Voir la page complète" pointe vers /getting-started
  // (réutilise onNavigate qui ferme déjà le panel).
  const handleSeeFullPage = () => onNavigate('/getting-started');
  return (
    <SlidePanel
      open={open}
      onOpenChange={onOpenChange}
      title="Configuration recommandée"
      description={`${completed} sur ${total} étapes complétées`}
      size="sm"
      headerActions={
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-subtle)]"
          aria-label="Masquer la configuration recommandée"
          title="Masquer"
        >
          <Icon as={X} size={11} />
          Masquer
        </button>
      }
    >
      {/* Progress header */}
      <div className="onboarding-panel-header">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            Progression
          </span>
          <span className="text-xs font-semibold tabular-nums text-[var(--primary)]">
            {pct}%
          </span>
        </div>
        <div className="onboarding-panel-bar" aria-hidden>
          <span
            className="onboarding-panel-bar-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Checklist */}
      <ul className="onboarding-checklist" aria-label="Étapes de configuration">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onNavigate(it.to)}
              className={cn('onboarding-checklist-item', it.done && 'is-done')}
              aria-label={`${it.label}${it.done ? ' (complété)' : ''}. Aller à la section.`}
            >
              <span className="onboarding-check" aria-hidden>
                {it.done ? (
                  <Icon as={Check} size={12} strokeWidth={3} />
                ) : (
                  <Icon as={it.icon} size={12} />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="onboarding-check-label">{it.label}</span>
                <span className="onboarding-check-desc">{it.description}</span>
              </span>
              {!it.done && (
                <Icon as={ChevronRight} size={14} className="text-[var(--text-muted)]" />
              )}
            </button>
          </li>
        ))}
      </ul>

      {completed === total && (
        <div className="onboarding-panel-done">
          <Icon as={Check} size={20} strokeWidth={3} className="text-[var(--success)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)] mt-2">{t('onboarding.chip.ready')}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Bonne utilisation d'Intralys.</p>
        </div>
      )}

      {/* Sprint 21 — Cross-link vers la page dédiée /getting-started */}
      <div className="mt-4 pt-3 border-t border-[var(--border)] flex justify-center">
        <button
          type="button"
          onClick={handleSeeFullPage}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline cursor-pointer"
          aria-label={t('onboarding.getting_started.title')}
        >
          {t('onboarding.getting_started.title')}
          <Icon as={ChevronRight} size={12} />
        </button>
      </div>
    </SlidePanel>
  );
}
