// ── WarehousePage — Sprint 47 (Agent B2) ────────────────────────────────────
// Page standalone routée `/warehouse` — regroupe sous 4 onglets la gestion
// multi-entrepôt + dropshipping :
//   1. Warehouses        — WarehousesManager (B1)
//   2. Transferts        — InventoryTransfersList (B1)
//   3. Suppliers         — DropshipSuppliersManager (B1)
//   4. Routings & Orders — DropshipRoutingsEditor + DropshipOrdersDashboard (B2)
//
// Style : Stripe-clean, cohérent avec CurrencyMultiSettingsPage (AppLayout +
// PageHero + Tabs Radix underline). Titre dynamique selon l'onglet actif.
//
// Imports RELATIFS uniquement (consigne Sprint 47 B2). aria-labels via t().

import { useCallback, useMemo, useState } from 'react';
import {
  Warehouse as WarehouseIcon,
  ArrowLeftRight,
  Truck,
  Route as RouteIcon,
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
import { WarehousesManager } from '../../components/warehouse/WarehousesManager';
import { InventoryTransfersList } from '../../components/warehouse/InventoryTransfersList';
import { DropshipSuppliersManager } from '../../components/warehouse/DropshipSuppliersManager';
import { DropshipRoutingsEditor } from '../../components/warehouse/DropshipRoutingsEditor';
import { DropshipOrdersDashboard } from '../../components/warehouse/DropshipOrdersDashboard';
import { ErrorBoundary } from '../ErrorBoundary';
import { t } from '../../lib/i18n';

type WarehouseTab = 'warehouses' | 'transfers' | 'suppliers' | 'routings';

export function WarehousePage() {
  const [tab, setTab] = useState<WarehouseTab>('warehouses');

  // Header dynamique : titre + description varient selon le tab actif.
  const headerCopy = useMemo<{ title: string; description: string }>(() => {
    switch (tab) {
      case 'transfers':
        return {
          title: t('transfers.title'),
          description: t('warehouse.transfers.description'),
        };
      case 'suppliers':
        return {
          title: t('dropship.suppliers.title'),
          description: t('warehouse.suppliers.description'),
        };
      case 'routings':
        return {
          title: t('dropship.routings.title'),
          description: t('warehouse.routings.description'),
        };
      case 'warehouses':
      default:
        return {
          title: t('warehouse.title'),
          description: t('warehouse.page.description'),
        };
    }
  }, [tab]);

  const handleTabChange = useCallback((value: string) => {
    if (
      value === 'warehouses' ||
      value === 'transfers' ||
      value === 'suppliers' ||
      value === 'routings'
    ) {
      setTab(value);
    }
  }, []);

  const pageTitle = t('warehouse.page.title');

  return (
    <AppLayout title={pageTitle}>
      <PageHero
        meta={t('page.meta.workspace_multi_warehouse')}
        title={pageTitle}
        highlight={pageTitle}
        description={headerCopy.description}
      />

      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        aria-label={pageTitle}
      >
        <TabsList>
          <TabsTrigger
            value="warehouses"
            data-testid="tab-warehouses"
            aria-label={t('warehouse.title')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon as={WarehouseIcon} size="sm" />
              {t('warehouse.title')}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="transfers"
            data-testid="tab-transfers"
            aria-label={t('transfers.title')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon as={ArrowLeftRight} size="sm" />
              {t('transfers.title')}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="suppliers"
            data-testid="tab-suppliers"
            aria-label={t('dropship.suppliers.title')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon as={Truck} size="sm" />
              {t('dropship.suppliers.title')}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="routings"
            data-testid="tab-routings"
            aria-label={`${t('dropship.routings.title')} & ${t('dropship.orders.title')}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon as={RouteIcon} size="sm" />
              {t('dropship.routings.title')} & {t('dropship.orders.title')}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* ── Tab Warehouses (B1) ────────────────────────────────────────── */}
        <TabsContent value="warehouses" className="space-y-6 mt-4">
          <ErrorBoundary>
            <WarehousesManager />
          </ErrorBoundary>
        </TabsContent>

        {/* ── Tab Transferts (B1) ────────────────────────────────────────── */}
        <TabsContent value="transfers" className="space-y-6 mt-4">
          <ErrorBoundary>
            <InventoryTransfersList />
          </ErrorBoundary>
        </TabsContent>

        {/* ── Tab Suppliers (B1) ─────────────────────────────────────────── */}
        <TabsContent value="suppliers" className="space-y-6 mt-4">
          <ErrorBoundary>
            <DropshipSuppliersManager />
          </ErrorBoundary>
        </TabsContent>

        {/* ── Tab Routings & Orders (B2) ─────────────────────────────────── */}
        <TabsContent value="routings" className="space-y-8 mt-4">
          <ErrorBoundary>
            <DropshipRoutingsEditor />
            <DropshipOrdersDashboard />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}

export default WarehousePage;
