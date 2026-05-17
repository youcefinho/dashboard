// @vitest-environment jsdom
// ── Sprint S8 — OnboardingProgressChip + i18n parité (Manager C) ─────────────
//
// Couvre :
//  1. Items e-commerce MASQUÉS si module 'ecommerce' inactif (status disabled).
//  2. Items e-commerce VISIBLES si module 'ecommerce' actif (status enabled).
//  3. Auto-hide 100% inchangé : sans items e-comm (6/6 CRM) ET avec items
//     e-comm (9/9 = 6 CRM + 3 e-comm) ⇒ le chip se masque (rend null).
//  4. Smoke i18n : chaque nouvelle clé `onboarding.*` S8 existe dans fr-CA ET
//     en ; parité STRICTE des clés entre les 4 catalogues ; aucune clé S8 sous
//     un namespace interdit (leads./dashboard./tasks./pipeline./clients./leadDetail.).
//
// ⚠️ NON exécuté sur la VM (vitest.config.ts `include` ne couvre pas
// src/components/onboarding/__tests__ — voir rapport Manager C). Pattern repris
// de src/components/ui/__tests__/Toast.test.tsx (pragma jsdom + RTL).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import { frCA } from '@/lib/i18n/fr-CA';
import { frFR } from '@/lib/i18n/fr-FR';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { t } from '@/lib/i18n';

// ── Mocks (router + API + module guard) ─────────────────────────────────────
// useNavigate : le chip l'appelle au click ; un noop suffit pour le rendu.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

// getLeads : contrôle l'item CRM "leads" (>=5 ⇒ done).
const getLeadsMock = vi.fn();
vi.mock('@/lib/api', () => ({
  getLeads: (...args: unknown[]) => getLeadsMock(...args),
}));

// useHasModule : contrôle la visibilité des items e-commerce.
const useHasModuleMock = vi.fn();
vi.mock('@/components/ecommerce/ModuleGuard', () => ({
  useHasModule: (...args: unknown[]) => useHasModuleMock(...args),
}));

// Import APRÈS les mocks (hoisting vi.mock garanti, mais explicite = clair).
import { OnboardingProgressChip } from '../OnboardingProgressChip';

// Libellés résolus via t() (jsdom détecte locale 'en', pas 'fr-CA').
// On utilise t() pour matcher la locale réellement active dans le test.
const L_CATALOG = () => t('onboarding.checklist.ecommerce_catalog');
const L_PRODUCT = () => t('onboarding.checklist.ecommerce_first_product');
const L_CHANNEL = () => t('onboarding.checklist.ecommerce_channel');

function setFlags(flags: Record<string, '1' | undefined>) {
  for (const [k, v] of Object.entries(flags)) {
    if (v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  }
}

const CRM_DONE_FLAGS = {
  profile_completed: '1' as const,
  pipeline_configured: '1' as const,
  team_invited: '1' as const,
  integration_connected: '1' as const,
  docs_visited: '1' as const,
};

const ECOM_DONE_FLAGS = {
  ecommerce_catalog_created: '1' as const,
  ecommerce_first_product: '1' as const,
  ecommerce_channel_connected: '1' as const,
};

describe('OnboardingProgressChip — items e-commerce conditionnels (S8)', () => {
  beforeEach(() => {
    localStorage.clear();
    getLeadsMock.mockResolvedValue({ data: [] }); // 0 lead ⇒ chip visible
    useHasModuleMock.mockReturnValue('disabled');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('masque les items e-commerce si le module Boutique est inactif', async () => {
    useHasModuleMock.mockReturnValue('disabled');
    render(<OnboardingProgressChip />);
    // Ouvrir le panneau pour voir la checklist.
    screen.getByRole('button', { name: /Configuration|setup/i }).click();
    await waitFor(() =>
      expect(screen.getByText(/Compléter ton profil|Complete your profile/i)).not.toBeNull(),
    );
    expect(screen.queryByText(L_CATALOG())).toBeNull();
    expect(screen.queryByText(L_PRODUCT())).toBeNull();
    expect(screen.queryByText(L_CHANNEL())).toBeNull();
  });

  it('masque aussi les items e-commerce tant que le module est en chargement', async () => {
    useHasModuleMock.mockReturnValue('loading');
    render(<OnboardingProgressChip />);
    screen.getByRole('button', { name: /Configuration|setup/i }).click();
    await waitFor(() =>
      expect(screen.getByText(/Compléter ton profil|Complete your profile/i)).not.toBeNull(),
    );
    expect(screen.queryByText(L_CATALOG())).toBeNull();
  });

  it('affiche les 3 items e-commerce si le module Boutique est actif', async () => {
    useHasModuleMock.mockReturnValue('enabled');
    render(<OnboardingProgressChip />);
    screen.getByRole('button', { name: /Configuration|setup/i }).click();
    await waitFor(() =>
      expect(screen.getByText(L_CATALOG())).not.toBeNull(),
    );
    expect(screen.getByText(L_PRODUCT())).not.toBeNull();
    expect(screen.getByText(L_CHANNEL())).not.toBeNull();
  });

  it('auto-hide 100% inchangé SANS items e-comm (6/6 CRM, module inactif)', async () => {
    useHasModuleMock.mockReturnValue('disabled');
    setFlags(CRM_DONE_FLAGS);
    getLeadsMock.mockResolvedValue({ data: new Array(5).fill({}) }); // leads done
    const { container } = render(<OnboardingProgressChip />);
    // Le chip se masque (return null) une fois tous les items CRM faits.
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('auto-hide 100% inchangé AVEC items e-comm (9/9 = 6 CRM + 3 e-comm, module actif)', async () => {
    useHasModuleMock.mockReturnValue('enabled');
    setFlags({ ...CRM_DONE_FLAGS, ...ECOM_DONE_FLAGS });
    getLeadsMock.mockResolvedValue({ data: new Array(5).fill({}) });
    const { container } = render(<OnboardingProgressChip />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('ne se masque PAS si module actif et items e-comm incomplets (dénominateur inclut e-comm)', async () => {
    useHasModuleMock.mockReturnValue('enabled');
    // Tous les CRM faits mais AUCUN e-comm ⇒ 6/9 ⇒ chip toujours visible.
    setFlags(CRM_DONE_FLAGS);
    getLeadsMock.mockResolvedValue({ data: new Array(5).fill({}) });
    const { container } = render(<OnboardingProgressChip />);
    await waitFor(() => expect(container.firstChild).not.toBeNull());
  });
});

// ── Smoke i18n — clés S8 + parité 4 catalogues + namespaces interdits ────────

const S8_KEYS = [
  'onboarding.step.region',
  'onboarding.step.ecommerce',
  'onboarding.step.channels',
  'onboarding.region.title',
  'onboarding.region.description',
  'onboarding.region.qc',
  'onboarding.region.ca',
  'onboarding.region.fr',
  'onboarding.region.eu',
  'onboarding.region.dz',
  'onboarding.region.other',
  'onboarding.ecommerce.title',
  'onboarding.ecommerce.description',
  'onboarding.ecommerce.payment_note',
  'onboarding.ecommerce.optin_label',
  'onboarding.ecommerce.skip',
  'onboarding.channels.title',
  'onboarding.channels.description',
  'onboarding.channels.shopify',
  'onboarding.channels.woo',
  'onboarding.channels.none',
  'onboarding.channels.domain_placeholder',
  'onboarding.checklist.title',
  'onboarding.checklist.ecommerce_catalog',
  'onboarding.checklist.ecommerce_catalog_desc',
  'onboarding.checklist.ecommerce_first_product',
  'onboarding.checklist.ecommerce_first_product_desc',
  'onboarding.checklist.ecommerce_channel',
  'onboarding.checklist.ecommerce_channel_desc',
  'onboarding.resume.title',
  'onboarding.resume.description',
  'onboarding.resume.cta',
  'onboarding.resume.dismiss',
];

const FORBIDDEN_PREFIXES = [
  'leads.', 'dashboard.', 'tasks.', 'pipeline.', 'clients.', 'leadDetail.',
];

describe('i18n S8 — clés, parité 4 catalogues, namespaces', () => {
  const catalogs = { 'fr-CA': frCA, 'fr-FR': frFR, en, es } as const;

  it('toutes les clés S8 existent et sont non vides dans les 4 catalogues', () => {
    for (const [name, cat] of Object.entries(catalogs)) {
      for (const k of S8_KEYS) {
        expect(cat[k], `${name} manque '${k}'`).toBeDefined();
        expect(typeof cat[k]).toBe('string');
        expect(cat[k].trim().length, `${name}.'${k}' vide`).toBeGreaterThan(0);
      }
    }
  });

  it('chaque clé S8 existe dans fr-CA (source) ET en (fallback)', () => {
    for (const k of S8_KEYS) {
      expect(frCA[k], `fr-CA manque '${k}'`).toBeDefined();
      expect(en[k], `en manque '${k}'`).toBeDefined();
    }
  });

  it('parité STRICTE : les 4 catalogues ont exactement le même jeu de clés', () => {
    const ref = Object.keys(frCA).sort();
    for (const [name, cat] of Object.entries(catalogs)) {
      const keys = Object.keys(cat).sort();
      const missing = ref.filter((k) => !(k in cat));
      const extra = keys.filter((k) => !(k in frCA));
      expect(missing, `${name} : clés manquantes vs fr-CA`).toEqual([]);
      expect(extra, `${name} : clés en trop vs fr-CA`).toEqual([]);
    }
  });

  it('aucune clé S8 sous un namespace interdit', () => {
    for (const k of S8_KEYS) {
      expect(k.startsWith('onboarding.'), `'${k}' hors onboarding.*`).toBe(true);
      for (const p of FORBIDDEN_PREFIXES) {
        expect(k.startsWith(p), `'${k}' sous namespace interdit '${p}'`).toBe(false);
      }
    }
  });

  it('payment_note mentionne clairement l\'absence d\'activation de paiement', () => {
    for (const [name, cat] of Object.entries(catalogs)) {
      const v = cat['onboarding.ecommerce.payment_note'].toLowerCase();
      // Doit évoquer paiement + négation/sandbox (FR/EN/ES tolérés).
      const mentionsPay = /pai|pay|pago/.test(v);
      const mentionsNoneOrSandbox = /aucun|ne |not |no |sandbox|test|ningún/.test(v);
      expect(mentionsPay, `${name} payment_note ne parle pas de paiement`).toBe(true);
      expect(
        mentionsNoneOrSandbox,
        `${name} payment_note ne clarifie pas l'absence d'activation`,
      ).toBe(true);
    }
  });
});
