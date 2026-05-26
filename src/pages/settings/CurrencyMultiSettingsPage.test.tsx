// @vitest-environment jsdom
// ── CurrencyMultiSettingsPage.test — Sprint 39 (Agent B4) ───────────────────
// Couvre :
//  1. Default tab = currency → CurrencySettings rendu, TaxRegionsManager non
//     monté (Radix Tabs ne monte que le contenu actif), drawer fermé.
//  2. Click tab "regions" → TaxRegionsManager rendu, CurrencySettings démonté,
//     header switch vers shop.tax.regions.title.
//  3. onSelectRegion(id) sur TaxRegionsManager → drawer ouvre avec
//     TaxRulesEditor rendu et regionId propagé.
//  4. onOpenChange(false) sur le SlidePanel → drawer ferme, TaxRulesEditor
//     démonté.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from '@testing-library/react';
import type { ReactNode } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

// i18n : renvoie la clé brute (assertions stables).
vi.mock('../../lib/i18n', () => ({
  t: (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}|${JSON.stringify(vars)}` : k,
  getLocale: () => 'fr-CA',
}));

// AppLayout : stub minimal.
vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({
    title,
    children,
  }: {
    title?: string;
    children: ReactNode;
  }) => (
    <div data-testid="app-layout" data-title={title}>
      {children}
    </div>
  ),
}));

// PageHero : stub minimal — rend title + description.
vi.mock('../../components/ui/PageHero', () => ({
  PageHero: ({
    title,
    description,
  }: {
    title?: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    meta?: ReactNode;
    highlight?: ReactNode;
  }) => (
    <div data-testid="page-hero">
      <h1 data-testid="page-hero-title">{title}</h1>
      <p data-testid="page-hero-description">{description}</p>
    </div>
  ),
}));

// Icon : stub.
vi.mock('../../components/ui/Icon', () => ({
  Icon: ({ size }: { size?: number | string }) => (
    <span data-testid="icon-stub" data-size={String(size ?? '')} />
  ),
}));

// Tabs (Radix) : stub headless avec gestion du state interne via callback.
// Tabs.Root expose value + onValueChange. On simule Radix : seul le content
// dont `value` matche le tab actif est rendu (matches le comportement réel).
vi.mock('../../components/ui/Tabs', () => {
  type TabsCtx = {
    value: string;
    onValueChange: (v: string) => void;
  };
  // Petit "contexte" via DOM data attribute pour propager value aux content/trigger.
  return {
    Tabs: ({
      value,
      onValueChange,
      children,
      'aria-label': ariaLabel,
    }: {
      value: string;
      onValueChange: (v: string) => void;
      children: ReactNode;
      'aria-label'?: string;
    }) => {
      // Inject context via React Children walk would be overkill ; on passe
      // par un global module-scoped state que les enfants stub lisent. Les
      // stubs Trigger/Content réagissent à `data-active-tab` posé sur root.
      (globalThis as unknown as { __tabsValue?: string }).__tabsValue = value;
      (globalThis as unknown as { __tabsChange?: TabsCtx['onValueChange'] }).__tabsChange =
        onValueChange;
      return (
        <div
          data-testid="tabs-root"
          data-active-tab={value}
          aria-label={ariaLabel}
        >
          {children}
        </div>
      );
    },
    TabsList: ({ children }: { children: ReactNode }) => (
      <div data-testid="tabs-list" role="tablist">
        {children}
      </div>
    ),
    TabsTrigger: ({
      value,
      children,
      'aria-label': ariaLabel,
      'data-testid': dataTestId,
    }: {
      value: string;
      children: ReactNode;
      'aria-label'?: string;
      'data-testid'?: string;
    }) => (
      <button
        type="button"
        role="tab"
        data-testid={dataTestId}
        aria-label={ariaLabel}
        onClick={() => {
          const change = (
            globalThis as unknown as { __tabsChange?: (v: string) => void }
          ).__tabsChange;
          change?.(value);
        }}
      >
        {children}
      </button>
    ),
    TabsContent: ({
      value,
      children,
    }: {
      value: string;
      children: ReactNode;
      className?: string;
    }) => {
      const active = (globalThis as unknown as { __tabsValue?: string })
        .__tabsValue;
      if (active !== value) return null;
      return (
        <div data-testid={`tabs-content-${value}`} role="tabpanel">
          {children}
        </div>
      );
    },
  };
});

// SlidePanel : stub — n'affiche le contenu que si open=true ; expose onOpenChange.
vi.mock('../../components/ui/SlidePanel', () => ({
  SlidePanel: ({
    open,
    onOpenChange,
    title,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    children: ReactNode;
    size?: string;
    closeLabel?: string;
  }) => (
    <div
      data-testid="slide-panel-stub"
      data-open={open ? 'true' : 'false'}
      data-title={title}
    >
      {open ? (
        <>
          <button
            type="button"
            data-testid="slide-panel-close"
            onClick={() => onOpenChange(false)}
          >
            close
          </button>
          {children}
        </>
      ) : null}
    </div>
  ),
}));

// CurrencySettings (B1) : stub — marqueur de présence.
vi.mock('../../components/settings/CurrencySettings', () => ({
  CurrencySettings: () => (
    <div data-testid="currency-settings-stub">CurrencySettings</div>
  ),
}));

// TaxRegionsManager (B2) : stub neutre — marqueur de présence.
vi.mock('../../components/settings/TaxRegionsManager', () => ({
  TaxRegionsManager: () => (
    <div data-testid="tax-regions-manager-stub">TaxRegionsManager</div>
  ),
}));

// api.listTaxRegions : stub — renvoie 2 régions fictives.
vi.mock('../../lib/api', () => ({
  listTaxRegions: vi.fn().mockResolvedValue({
    data: [
      {
        id: 'region_qc',
        client_id: 'c1',
        code: 'QC',
        name: 'Québec',
        country: 'CA',
        country_subdiv: 'QC',
        type: 'gst_pst',
        rates_json: { gst: 5, qst: 9.975 },
        tax_inclusive: false,
        active: true,
      },
      {
        id: 'region_on',
        client_id: 'c1',
        code: 'ON',
        name: 'Ontario',
        country: 'CA',
        country_subdiv: 'ON',
        type: 'gst_pst',
        rates_json: { hst: 13 },
        tax_inclusive: false,
        active: true,
      },
    ],
    error: null,
  }),
}));

// TaxRulesEditor (B3) : stub — affiche le regionId reçu.
vi.mock('../../components/settings/TaxRulesEditor', () => ({
  TaxRulesEditor: ({ regionId }: { regionId: string }) => (
    <div data-testid="tax-rules-editor-stub" data-region-id={regionId}>
      TaxRulesEditor for {regionId}
    </div>
  ),
}));

// Imports APRÈS les mocks.
import { CurrencyMultiSettingsPage } from './CurrencyMultiSettingsPage';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('<CurrencyMultiSettingsPage /> — Sprint 39 B4', () => {
  beforeEach(() => {
    (globalThis as unknown as { __tabsValue?: string }).__tabsValue = undefined;
    (globalThis as unknown as { __tabsChange?: unknown }).__tabsChange = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('1. default tab=currency → CurrencySettings rendu, drawer fermé', () => {
    render(<CurrencyMultiSettingsPage />);

    // Header titre = devises par défaut.
    expect(screen.getByTestId('page-hero-title')).toHaveTextContent(
      'shop.currency.title',
    );

    // Tabs root état actif = currency.
    expect(screen.getByTestId('tabs-root')).toHaveAttribute(
      'data-active-tab',
      'currency',
    );

    // CurrencySettings rendu, TaxRegionsManager non monté (tab inactif).
    expect(screen.getByTestId('currency-settings-stub')).toBeInTheDocument();
    expect(
      screen.queryByTestId('tax-regions-manager-stub'),
    ).not.toBeInTheDocument();

    // Drawer fermé.
    expect(screen.getByTestId('slide-panel-stub')).toHaveAttribute(
      'data-open',
      'false',
    );
  });

  it('2. click tab "regions" → TaxRegionsManager rendu, header switch', () => {
    render(<CurrencyMultiSettingsPage />);

    const regionsTab = screen.getByTestId('tab-regions');
    act(() => {
      fireEvent.click(regionsTab);
    });

    // Tabs root état actif = regions.
    expect(screen.getByTestId('tabs-root')).toHaveAttribute(
      'data-active-tab',
      'regions',
    );

    // Header bascule sur tax regions title.
    expect(screen.getByTestId('page-hero-title')).toHaveTextContent(
      'shop.tax.regions.title',
    );

    // TaxRegionsManager rendu, CurrencySettings démonté.
    expect(screen.getByTestId('tax-regions-manager-stub')).toBeInTheDocument();
    expect(
      screen.queryByTestId('currency-settings-stub'),
    ).not.toBeInTheDocument();
  });

  it('3. select region → drawer ouvre avec TaxRulesEditor + regionId', async () => {
    render(<CurrencyMultiSettingsPage />);

    // Switch sur l'onglet régions.
    act(() => {
      fireEvent.click(screen.getByTestId('tab-regions'));
    });

    // Drawer initialement fermé.
    expect(screen.getByTestId('slide-panel-stub')).toHaveAttribute(
      'data-open',
      'false',
    );

    // Attend le résolu du useEffect (listTaxRegions) pour peupler le <select>.
    const picker = (await screen.findByTestId(
      'region-rules-picker',
    )) as unknown as HTMLSelectElement;

    // Change la valeur du <select> → onChange déclenche setSelectedRegionId.
    act(() => {
      fireEvent.change(picker, { target: { value: 'region_qc' } });
    });

    // Drawer ouvert + TaxRulesEditor rendu avec regionId propagé.
    expect(screen.getByTestId('slide-panel-stub')).toHaveAttribute(
      'data-open',
      'true',
    );
    const editor = screen.getByTestId('tax-rules-editor-stub');
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveAttribute('data-region-id', 'region_qc');
  });

  it('4. onOpenChange(false) → drawer ferme, TaxRulesEditor démonté', async () => {
    render(<CurrencyMultiSettingsPage />);

    // Ouvre le drawer (régions + select).
    act(() => {
      fireEvent.click(screen.getByTestId('tab-regions'));
    });

    const picker = (await screen.findByTestId(
      'region-rules-picker',
    )) as unknown as HTMLSelectElement;
    act(() => {
      fireEvent.change(picker, { target: { value: 'region_qc' } });
    });

    expect(screen.getByTestId('slide-panel-stub')).toHaveAttribute(
      'data-open',
      'true',
    );

    // Ferme via le bouton du stub SlidePanel.
    act(() => {
      fireEvent.click(screen.getByTestId('slide-panel-close'));
    });

    expect(screen.getByTestId('slide-panel-stub')).toHaveAttribute(
      'data-open',
      'false',
    );
    expect(
      screen.queryByTestId('tax-rules-editor-stub'),
    ).not.toBeInTheDocument();
  });
});
