// ── B2BPage — Sprint 48 (Agent B2) ───────────────────────────────────────────
// Page standalone routée `/b2b` — regroupe sous 4 onglets la gestion B2B
// wholesale + bundles + pre-orders :
//   1. Groupes      — CustomerGroupsManager (A1)
//   2. Tier Prices  — TierPricesEditor (A2)
//   3. Bundles      — BundlesManager (B2)
//   4. Pre-orders   — PreordersDashboard (B2)
//
// Style : Stripe-clean, cohérent avec WarehousePage (AppLayout + PageHero +
// Tabs Radix underline). Titre dynamique selon l'onglet actif. Les composants
// Manager-A (CustomerGroupsManager / TierPricesEditor) sont produits par les
// agents A1/A2 du même sprint et résolus par les imports relatifs ci-dessous.
//
// Imports RELATIFS uniquement. aria-labels via t() i18n.
//
// ── Renforcement (additif, 0 refactor) ──────────────────────────────────────
// Ajoute :
//   - <ErrorBoundary> isolé par onglet (un onglet planté ne casse pas les 3 autres).
//   - Landmark <section role="region" aria-labelledby> + aria-live polite.
//   - data-testid sur la racine page (faciliter QA Playwright).
//   - Garde de type runtime sur handleTabChange (déjà présente) + tests d'égalité
//     stricte sans coercion (sécurité défensive : le `value` reçu vient de Radix).
// Aucun key i18n ajouté (parité STRICT préservée).

import { useCallback, useMemo, useState } from 'react';
import {
  Users,
  Layers,
  Package,
  ListChecks,
} from 'lucide-react';
import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import { Icon } from '../../components/ui/Icon';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/Tabs';
import { CustomerGroupsManager } from '../../components/b2b/CustomerGroupsManager';
import { TierPricesEditor } from '../../components/b2b/TierPricesEditor';
import { BundlesManager } from '../../components/b2b/BundlesManager';
import { PreordersDashboard } from '../../components/b2b/PreordersDashboard';
import { ErrorBoundary } from '../ErrorBoundary';
import { t } from '../../lib/i18n';

type B2BTab = 'groups' | 'tier_prices' | 'bundles' | 'preorders';

export function B2BPage() {
  const [tab, setTab] = useState<B2BTab>('groups');

  // Header dynamique : titre + description varient selon le tab actif.
  const headerCopy = useMemo<{ title: string; description: string }>(() => {
    switch (tab) {
      case 'tier_prices':
        return {
          title: t('tier_prices.title'),
          description:
            'Tarification par palier (variant × groupe × quantité min).',
        };
      case 'bundles':
        return {
          title: t('bundles.title'),
          description:
            'Groupage produits avec rabais calculé vs somme des items.',
        };
      case 'preorders':
        return {
          title: t('preorders.title'),
          description:
            'Liste d\'attente acheteurs sur variants en rupture / pré-lancement.',
        };
      case 'groups':
      default:
        return {
          title: t('customer_groups.title'),
          description:
            'Segmentation tarifaire customers (retail | wholesale | VIP | custom).',
        };
    }
  }, [tab]);

  const handleTabChange = useCallback((value: string) => {
    if (
      value === 'groups' ||
      value === 'tier_prices' ||
      value === 'bundles' ||
      value === 'preorders'
    ) {
      setTab(value);
    }
  }, []);

  return (
    <AppLayout title="B2B & Wholesale">
      <PageHero
        meta="Workspace · B2B wholesale + Bundles + Pre-orders"
        title="B2B & Wholesale"
        highlight="B2B & Wholesale"
        description={headerCopy.description}
      />

      <section
        role="region"
        aria-label="B2B & Wholesale"
        aria-live="polite"
        data-testid="b2b-page-root"
      >
        <Tabs
          value={tab}
          onValueChange={handleTabChange}
          aria-label="B2B & Wholesale"
        >
          <TabsList>
            <TabsTrigger
              value="groups"
              data-testid="tab-groups"
              aria-label={t('customer_groups.title')}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon as={Users} size="sm" />
                {t('customer_groups.title')}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="tier_prices"
              data-testid="tab-tier-prices"
              aria-label={t('tier_prices.title')}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon as={Layers} size="sm" />
                {t('tier_prices.title')}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="bundles"
              data-testid="tab-bundles"
              aria-label={t('bundles.title')}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon as={Package} size="sm" />
                {t('bundles.title')}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="preorders"
              data-testid="tab-preorders"
              aria-label={t('preorders.title')}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon as={ListChecks} size="sm" />
                {t('preorders.title')}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* ── Tab Groups (A1) ─────────────────────────────────────────────── */}
          <TabsContent value="groups" className="space-y-6 mt-4">
            <ErrorBoundary>
              <CustomerGroupsManager />
            </ErrorBoundary>
          </TabsContent>

          {/* ── Tab Tier Prices (A2) ────────────────────────────────────────── */}
          <TabsContent value="tier_prices" className="space-y-6 mt-4">
            <ErrorBoundary>
              <TierPricesEditor />
            </ErrorBoundary>
          </TabsContent>

          {/* ── Tab Bundles (B2) ────────────────────────────────────────────── */}
          <TabsContent value="bundles" className="space-y-6 mt-4">
            <ErrorBoundary>
              <BundlesManager />
            </ErrorBoundary>
          </TabsContent>

          {/* ── Tab Pre-orders (B2) ─────────────────────────────────────────── */}
          <TabsContent value="preorders" className="space-y-6 mt-4">
            <ErrorBoundary>
              <PreordersDashboard />
            </ErrorBoundary>
          </TabsContent>
        </Tabs>
      </section>
    </AppLayout>
  );
}

export default B2BPage;
