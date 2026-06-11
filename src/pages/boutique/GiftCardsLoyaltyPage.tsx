// ── GiftCardsLoyaltyPage — Sprint 38 (Agent B4) ─────────────────────────────
// Page standalone routée `/boutique/giftcards-loyalty` — fusionne deux modules
// e-commerce satellites du checkout :
//   - Onglet 1 (giftcards) : wrap <GiftCardManager /> (B1).
//   - Onglet 2 (loyalty)   : liste des programmes fidélité + bouton "Créer".
//     Click sur un programme = drawer d'édition <LoyaltyProgramSettings /> (B2).
//     Click "Créer" = même drawer en mode create.
//
// Wrap AppLayout + ModuleGuard("ecommerce") + PageHero — calque POS.tsx /
// SnapshotsPage.tsx. Stripe-clean, imports RELATIFS, i18n via t(), aria-labels
// i18n. Aucun console.log (CLAUDE.md).

import { useCallback, useEffect, useState } from 'react';
import { Plus, Gift, Award, Wallet, type LucideIcon } from 'lucide-react';
import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SlidePanel } from '../../components/ui/SlidePanel';
import { useToast } from '../../components/ui/Toast';
import { ModuleGuard } from '../../components/ecommerce/ModuleGuard';
import { GiftCardManager } from '../../components/giftcards/GiftCardManager';
import { LoyaltyProgramSettings } from '../../components/loyalty/LoyaltyProgramSettings';
import { GiftLoyaltyOps } from '../../components/boutique/GiftLoyaltyOps';
import { getLoyaltyPrograms, type LoyaltyProgram } from '../../lib/api';
import { t } from '../../lib/i18n';

// ── Types ──────────────────────────────────────────────────────────────────

type TabKey = 'giftcards' | 'loyalty' | 'operations';

// ── Composant ──────────────────────────────────────────────────────────────

export function GiftCardsLoyaltyPage() {
  const { error: toastError } = useToast();

  const [tab, setTab] = useState<TabKey>('giftcards');

  // Loyalty list state.
  const [programs, setPrograms] = useState<LoyaltyProgram[]>([]);
  const [programsLoading, setProgramsLoading] = useState<boolean>(false);
  const [programsLoaded, setProgramsLoaded] = useState<boolean>(false);

  // Drawer state (édition / création programme).
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(
    null,
  );

  // ── Chargement programmes loyalty (au switch tab + après save) ───────────
  const loadPrograms = useCallback(async () => {
    setProgramsLoading(true);
    const res = await getLoyaltyPrograms();
    if (res.error) {
      toastError(res.error);
      setPrograms([]);
    } else if (res.data) {
      setPrograms(res.data);
    }
    setProgramsLoading(false);
    setProgramsLoaded(true);
  }, [toastError]);

  // Lazy-load la liste à la première activation des onglets loyalty / ops
  // (l'onglet opérations a besoin de la liste des programmes pour le sélecteur).
  useEffect(() => {
    if ((tab === 'loyalty' || tab === 'operations') && !programsLoaded) {
      void loadPrograms();
    }
  }, [tab, programsLoaded, loadPrograms]);

  // ── Drawer handlers ──────────────────────────────────────────────────────

  const openCreateDrawer = useCallback(() => {
    setSelectedProgramId(null);
    setDrawerOpen(true);
  }, []);

  const openEditDrawer = useCallback((programId: string) => {
    setSelectedProgramId(programId);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedProgramId(null);
  }, []);

  const handleSaved = useCallback(() => {
    closeDrawer();
    void loadPrograms();
  }, [closeDrawer, loadPrograms]);

  // ── Header dynamique selon tab actif ─────────────────────────────────────
  const heroTitle =
    tab === 'giftcards'
      ? t('giftCards.title')
      : tab === 'loyalty'
        ? t('loyalty.title')
        : t('giftloyalty.ops.title');
  const heroDescription =
    tab === 'giftcards'
      ? t('giftCards.description')
      : tab === 'loyalty'
        ? t('loyalty.description')
        : t('giftloyalty.ops.description');

  return (
    <AppLayout title={heroTitle}>
      <ModuleGuard module="ecommerce">
        <PageHero
          meta="Boutique · Fidélisation"
          title={heroTitle}
          description={heroDescription}
        />

        {/* ── Tab nav (state-driven, pas Radix : test-friendly + zéro dep) ── */}
        <nav
          role="tablist"
          aria-label={t('giftCardsLoyalty.tabs.aria')}
          className="flex gap-1 border-b border-[var(--border-subtle)] mb-6"
          data-testid="giftcards-loyalty-tabs"
        >
          <TabButton
            active={tab === 'giftcards'}
            onClick={() => setTab('giftcards')}
            icon={Gift}
            label={t('giftCards.title')}
            testId="tab-giftcards"
          />
          <TabButton
            active={tab === 'loyalty'}
            onClick={() => setTab('loyalty')}
            icon={Award}
            label={t('loyalty.title')}
            testId="tab-loyalty"
          />
          <TabButton
            active={tab === 'operations'}
            onClick={() => setTab('operations')}
            icon={Wallet}
            label={t('giftloyalty.ops.tab')}
            testId="tab-operations"
          />
        </nav>

        {/* ── Tab panels ──────────────────────────────────────────────────── */}
        {tab === 'giftcards' ? (
          <section
            role="tabpanel"
            aria-label={t('giftCards.title')}
            data-testid="panel-giftcards"
          >
            <GiftCardManager />
          </section>
        ) : tab === 'loyalty' ? (
          <section
            role="tabpanel"
            aria-label={t('loyalty.title')}
            data-testid="panel-loyalty"
            className="space-y-6"
          >
            {/* Header liste programmes + bouton Créer */}
            <header className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <h2 className="t-h2">{t('loyalty.programs.title')}</h2>
                <p className="t-caption text-[var(--gray-500)] mt-1">
                  {t('loyalty.programs.description')}
                </p>
              </div>
              <Button
                onClick={openCreateDrawer}
                size="sm"
                leftIcon={<Icon as={Plus} size="md" />}
                aria-label={t('loyalty.program.create')}
                data-testid="loyalty-create-button"
              >
                {t('loyalty.program.create')}
              </Button>
            </header>

            {/* Liste / loading / empty */}
            {programsLoading ? (
              <div
                className="space-y-3"
                data-testid="loyalty-programs-loading"
              >
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  >
                    <Skeleton className="h-5 w-1/3 mb-2" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </div>
            ) : programs.length === 0 ? (
              <EmptyState
                icon={<Icon as={Award} size={40} />}
                title={t('loyalty.programs.empty')}
                description={t('loyalty.programs.emptyHelper')}
                action={
                  <Button
                    onClick={openCreateDrawer}
                    leftIcon={<Icon as={Plus} size="sm" />}
                    aria-label={t('loyalty.program.create')}
                  >
                    {t('loyalty.program.create')}
                  </Button>
                }
              />
            ) : (
              <ul
                className="space-y-3 list-none p-0 m-0"
                data-testid="loyalty-programs-list"
                aria-label={t('loyalty.programs.title')}
              >
                {programs.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => openEditDrawer(p.id)}
                      className="w-full text-left p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] transition-colors"
                      data-testid={`loyalty-program-row-${p.id}`}
                      aria-label={`${t('loyalty.program.editTitle')} — ${p.name}`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                              {p.name}
                            </h3>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                                p.is_active === 1
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]'
                              }`}
                              data-testid={`loyalty-program-status-${p.id}`}
                            >
                              {p.is_active === 1
                                ? t('loyalty.program.active')
                                : t('loyalty.program.inactive')}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            {t('loyalty.earn.rate')}:{' '}
                            <span className="font-medium text-[var(--text-secondary)]">
                              {p.earn_rate_per_dollar}
                            </span>
                            {' · '}
                            {t('loyalty.redeem.rate')}:{' '}
                            <span className="font-medium text-[var(--text-secondary)]">
                              {p.redeem_rate_cents_per_point}¢
                            </span>
                            {' · '}
                            {t('loyalty.redeem.min')}:{' '}
                            <span className="font-medium text-[var(--text-secondary)]">
                              {p.min_redeem_points}
                            </span>
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section
            role="tabpanel"
            aria-label={t('giftloyalty.ops.title')}
            data-testid="panel-operations"
          >
            {programsLoading ? (
              <div
                className="space-y-3"
                aria-busy="true"
                data-testid="operations-loading"
              >
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  >
                    <Skeleton className="h-5 w-1/3 mb-2" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </div>
            ) : (
              <GiftLoyaltyOps programs={programs} />
            )}
          </section>
        )}

        {/* ── Drawer édition / création programme ────────────────────────── */}
        <SlidePanel
          open={drawerOpen}
          onOpenChange={(o) => {
            if (!o) closeDrawer();
          }}
          title={
            selectedProgramId
              ? t('loyalty.program.editTitle')
              : t('loyalty.program.createTitle')
          }
          size="lg"
          closeLabel={t('action.close')}
        >
          <div className="p-4" data-testid="loyalty-drawer-body">
            <LoyaltyProgramSettings
              // Re-mount à chaque changement de programId / mode (clé) pour
              // garantir un reset propre du form interne (load via useEffect).
              key={selectedProgramId ?? '__create__'}
              programId={selectedProgramId ?? undefined}
              onSaved={handleSaved}
            />
          </div>
        </SlidePanel>
      </ModuleGuard>
    </AppLayout>
  );
}

// ── TabButton helper (local, evite Radix pour test-friendliness) ───────────

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  testId: string;
}

function TabButton({
  active,
  onClick,
  icon: IconCmp,
  label,
  testId,
}: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      data-state={active ? 'active' : 'inactive'}
      className={`relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
        active
          ? 'text-[var(--primary)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
      }`}
    >
      <Icon as={IconCmp} size="sm" />
      {label}
      {active ? (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-2 right-2 h-[3px] rounded-t-full"
          style={{
            background:
              'linear-gradient(90deg, #009DDB 0%, #D96E27 100%)',
            boxShadow:
              '0 -2px 12px rgba(0,157,219,0.5), 0 0 8px rgba(217,110,39,0.4)',
          }}
        />
      ) : null}
    </button>
  );
}

export default GiftCardsLoyaltyPage;
