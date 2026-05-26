// ── CurrencyMultiSettingsPage — Sprint 39 (Agent B4) ────────────────────────
// Page standalone routée `/settings/currency-multi` — regroupe sous deux onglets
// la gestion des devises multiples (B1 — CurrencySettings) et la gestion des
// régions fiscales (B2 — TaxRegionsManager) avec un sub-drawer (SlidePanel)
// qui ouvre l'éditeur de règles fiscales (B3 — TaxRulesEditor) pour la région
// sélectionnée.
//
// Style : Stripe-clean, cohérent avec SnapshotsPage (AppLayout + PageHero).
// - Tabs Radix underline (cohérent ObservabilityPanel)
// - Titre dynamique selon l'onglet actif (devises / régions fiscales)
// - Imports relatifs (cf. consigne Sprint 39)
// - aria-labels via t()
// - Aucun console.log (CLAUDE.md)
//
// Sélection de région : B2 (TaxRegionsManager) n'expose pas (encore) de
// callback `onSelectRegion`. On rend donc, au-dessus de B2, un sélecteur
// `<select>` natif alimenté par `listTaxRegions()` qui ouvre le drawer
// d'édition des règles via `TaxRulesEditor` (B3 — signature `{ regionId }`).
// Forward-compat : si B2 expose plus tard un callback, on pourra le brancher
// sans changer la surface publique de cette page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, Receipt } from 'lucide-react';
import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import { Icon } from '../../components/ui/Icon';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '../../components/ui/Tabs';
import { SlidePanel } from '../../components/ui/SlidePanel';
import { CurrencySettings } from '../../components/settings/CurrencySettings';
import { TaxRegionsManager } from '../../components/settings/TaxRegionsManager';
import { TaxRulesEditor } from '../../components/settings/TaxRulesEditor';
import { listTaxRegions } from '../../lib/api';
import type { TaxRegion } from '../../lib/types';
import { t } from '../../lib/i18n';

type CurrencyMultiTab = 'currency' | 'regions';

export function CurrencyMultiSettingsPage() {
  const [tab, setTab] = useState<CurrencyMultiTab>('currency');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [regions, setRegions] = useState<TaxRegion[]>([]);

  // Charge la liste des régions (pour le picker du drawer). Silent fail :
  // si l'API échoue, le picker reste vide ; B2 gérera l'erreur côté CRUD.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listTaxRegions();
      if (cancelled) return;
      if (res.data) setRegions(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Header dynamique : titre + description varient selon le tab actif.
  const headerCopy = useMemo<{ title: string; description: string }>(() => {
    if (tab === 'regions') {
      return {
        title: t('shop.tax.regions.title'),
        description: t('shop.region.subtitle'),
      };
    }
    return {
      title: t('shop.currency.title'),
      description: t('shop.region.subtitle'),
    };
  }, [tab]);

  const handleTabChange = useCallback((value: string) => {
    if (value === 'currency' || value === 'regions') {
      setTab(value);
    }
  }, []);

  const handleSelectRegion = useCallback(
    (evt: React.ChangeEvent<HTMLSelectElement>) => {
      const id = evt.target.value;
      setSelectedRegionId(id === '' ? null : id);
    },
    [],
  );

  const handleCloseDrawer = useCallback(() => {
    setSelectedRegionId(null);
  }, []);

  return (
    <AppLayout title={headerCopy.title}>
      <PageHero
        meta="Workspace · Multi-currency"
        title={headerCopy.title}
        highlight={headerCopy.title}
        description={headerCopy.description}
      />

      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        aria-label={t('shop.currency.title')}
      >
        <TabsList>
          <TabsTrigger
            value="currency"
            data-testid="tab-currency"
            aria-label={t('shop.currency.title')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon as={Coins} size="sm" />
              {t('shop.currency.title')}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="regions"
            data-testid="tab-regions"
            aria-label={t('shop.tax.regions.title')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon as={Receipt} size="sm" />
              {t('shop.tax.regions.title')}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* ── Tab Devises ─────────────────────────────────────────── */}
        <TabsContent value="currency" className="space-y-6 mt-4">
          <CurrencySettings />
        </TabsContent>

        {/* ── Tab Régions fiscales ───────────────────────────────── */}
        <TabsContent value="regions" className="space-y-6 mt-4">
          {/* Sélecteur de région pour ouvrir l'éditeur de règles (B3) */}
          <div className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
            <label
              htmlFor="tax-region-rules-picker"
              className="text-sm font-semibold text-[var(--text-primary)]"
            >
              {t('shop.tax.regions.rates')}
            </label>
            <select
              id="tax-region-rules-picker"
              data-testid="region-rules-picker"
              aria-label={t('shop.tax.regions.rates')}
              value={selectedRegionId ?? ''}
              onChange={handleSelectRegion}
              className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <option value="">{t('shop.tax.regions.title')}…</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name} ({region.code})
                </option>
              ))}
            </select>
          </div>

          <TaxRegionsManager />
        </TabsContent>
      </Tabs>

      {/* Sub-drawer : éditeur de règles fiscales pour la région sélectionnée. */}
      <SlidePanel
        open={selectedRegionId !== null}
        onOpenChange={(next) => {
          if (!next) handleCloseDrawer();
        }}
        title={t('shop.tax.regions.rates')}
        size="lg"
        closeLabel={t('action.close')}
      >
        {selectedRegionId !== null ? (
          <TaxRulesEditor regionId={selectedRegionId} />
        ) : null}
      </SlidePanel>
    </AppLayout>
  );
}

export default CurrencyMultiSettingsPage;
