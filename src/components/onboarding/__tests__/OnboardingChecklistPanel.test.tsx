// @vitest-environment jsdom
// ── Sprint 21 (Onboarding durci) — Manager-C frontend ──────────────────────
//
// Couvre :
//  1. Rend la liste des items avec `getOnboardingChecklist` mocké.
//  2. Click "Passer" → appelle `skipOnboardingItem`, refresh state.
//  3. Click "Marquer comme fait" → appelle `completeOnboardingItem`.
//  4. Click "Recommencer" → appelle `resetOnboardingChecklist`.
//  5. Click CTA item → appelle `onItemNavigate(target)`.
//  6. `variant='page'` rend les 3 sections (first_steps / go_further / explore).
//  7. Hook `useOnboardingItemCompletion('profile_completed', true)` appelle
//     `completeOnboardingItem` UNE seule fois (testé avec spy + remount).
//  8. `GuidedEmptyState` rend titre + meta i18n + bouton "Passer" qui appelle
//     `skipOnboardingItem`.
//
// Pattern repris de `OnboardingProgressChip-s8.test.tsx` (pragma jsdom + RTL +
// mocks `vi.mock('@/lib/api', ...)` et `vi.mock('@/components/ecommerce/...')`).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

const getOnboardingChecklistMock = vi.fn();
const completeOnboardingItemMock = vi.fn();
const skipOnboardingItemMock = vi.fn();
const resetOnboardingChecklistMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getOnboardingChecklist: (...args: unknown[]) => getOnboardingChecklistMock(...args),
  completeOnboardingItem: (...args: unknown[]) => completeOnboardingItemMock(...args),
  skipOnboardingItem: (...args: unknown[]) => skipOnboardingItemMock(...args),
  resetOnboardingChecklist: (...args: unknown[]) => resetOnboardingChecklistMock(...args),
}));

const useHasModuleMock = vi.fn();
vi.mock('@/components/ecommerce/ModuleGuard', () => ({
  useHasModule: (...args: unknown[]) => useHasModuleMock(...args),
}));

// Imports APRÈS les mocks
import { OnboardingChecklistPanel } from '../OnboardingChecklistPanel';
import { GuidedEmptyState } from '../GuidedEmptyState';
import { useOnboardingItemCompletion } from '../useOnboardingItemCompletion';

// ── Fixtures ────────────────────────────────────────────────────────────────

function emptyChecklist() {
  return {
    data: {
      items: {},
      total: 6,
      completed: 0,
      skipped: 0,
      pct: 0,
      lastActiveAt: null,
    },
  };
}

function partialChecklist() {
  return {
    data: {
      items: {
        profile_completed: {
          done: true,
          skipped: false,
          completedAt: '2026-05-22T10:00:00Z',
          skippedAt: null,
        },
        leads_imported: {
          done: false,
          skipped: true,
          completedAt: null,
          skippedAt: '2026-05-22T10:01:00Z',
        },
      },
      total: 6,
      completed: 1,
      skipped: 1,
      pct: 17,
      lastActiveAt: '2026-05-22T10:01:00Z',
    },
  };
}

// ── OnboardingChecklistPanel — variant 'sidebar' (par défaut) ────────────────

describe('OnboardingChecklistPanel — variant sidebar (CRM-only)', () => {
  beforeEach(() => {
    localStorage.clear();
    getOnboardingChecklistMock.mockResolvedValue(emptyChecklist());
    completeOnboardingItemMock.mockResolvedValue(emptyChecklist());
    skipOnboardingItemMock.mockResolvedValue(emptyChecklist());
    resetOnboardingChecklistMock.mockResolvedValue(emptyChecklist());
    useHasModuleMock.mockReturnValue('disabled');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('rend les 6 items CRM via getOnboardingChecklist', async () => {
    render(<OnboardingChecklistPanel />);
    await waitFor(() => expect(getOnboardingChecklistMock).toHaveBeenCalled());
    // Au moins le label profil + leads doivent apparaître
    expect(
      screen.queryByText(t('onboarding.checklist.crm_profile.label')),
    ).not.toBeNull();
    expect(
      screen.queryByText(t('onboarding.checklist.crm_leads.label')),
    ).not.toBeNull();
  });

  it('click "Marquer comme fait" appelle completeOnboardingItem', async () => {
    render(<OnboardingChecklistPanel />);
    await waitFor(() => expect(getOnboardingChecklistMock).toHaveBeenCalled());

    // On clique sur le premier bouton "Marquer comme fait" trouvé
    const completeBtns = screen.getAllByRole('button', {
      name: new RegExp(t('onboarding.checklist.action_complete'), 'i'),
    });
    expect(completeBtns.length).toBeGreaterThan(0);
    fireEvent.click(completeBtns[0]!);
    await waitFor(() => expect(completeOnboardingItemMock).toHaveBeenCalledTimes(1));
  });

  it('click "Passer" appelle skipOnboardingItem', async () => {
    render(<OnboardingChecklistPanel />);
    await waitFor(() => expect(getOnboardingChecklistMock).toHaveBeenCalled());

    const skipBtns = screen.getAllByRole('button', {
      name: new RegExp(t('onboarding.checklist.action_skip'), 'i'),
    });
    expect(skipBtns.length).toBeGreaterThan(0);
    fireEvent.click(skipBtns[0]!);
    await waitFor(() => expect(skipOnboardingItemMock).toHaveBeenCalledTimes(1));
  });

  it('click "Recommencer" appelle resetOnboardingChecklist', async () => {
    render(<OnboardingChecklistPanel />);
    await waitFor(() => expect(getOnboardingChecklistMock).toHaveBeenCalled());

    const resetBtn = screen.getByRole('button', {
      name: new RegExp(t('onboarding.checklist.action_reset'), 'i'),
    });
    fireEvent.click(resetBtn);
    await waitFor(() =>
      expect(resetOnboardingChecklistMock).toHaveBeenCalledTimes(1),
    );
  });

  it('click sur "Continuer la configuration" appelle onItemNavigate(to)', async () => {
    const onNav = vi.fn();
    render(<OnboardingChecklistPanel onItemNavigate={onNav} />);
    await waitFor(() => expect(getOnboardingChecklistMock).toHaveBeenCalled());

    const ctaBtns = screen.getAllByRole('button', {
      name: new RegExp(t('onboarding.getting_started.continue_setup'), 'i'),
    });
    expect(ctaBtns.length).toBeGreaterThan(0);
    // Le premier item = profile → cible '/settings'
    fireEvent.click(ctaBtns[0]!);
    expect(onNav).toHaveBeenCalledWith('/settings');
  });

  it('items partiellement done/skipped reflètent l\'état serveur', async () => {
    getOnboardingChecklistMock.mockResolvedValue(partialChecklist());
    render(<OnboardingChecklistPanel />);
    await waitFor(() => expect(getOnboardingChecklistMock).toHaveBeenCalled());
    // Profile = done ⇒ pas de bouton "Marquer comme fait" pour profile
    // (mais d'autres items pending ont encore le bouton, donc on vérifie juste
    // que le label profile apparaît avec une classe line-through OU que le
    // compteur affiche 1/6).
    await waitFor(() => {
      expect(screen.queryByText(/1\/6/)).not.toBeNull();
    });
  });

  it('dégrade silencieusement si getOnboardingChecklist fail', async () => {
    getOnboardingChecklistMock.mockRejectedValue(new Error('network'));
    render(<OnboardingChecklistPanel />);
    // Pas de crash. Les items CRM apparaissent quand même (pending).
    await waitFor(() =>
      expect(
        screen.queryByText(t('onboarding.checklist.crm_profile.label')),
      ).not.toBeNull(),
    );
  });
});

// ── OnboardingChecklistPanel — variant 'page' (3 sections) ──────────────────

describe("OnboardingChecklistPanel — variant 'page' (sections)", () => {
  beforeEach(() => {
    localStorage.clear();
    getOnboardingChecklistMock.mockResolvedValue(emptyChecklist());
    useHasModuleMock.mockReturnValue('enabled'); // pour avoir la section explore
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("rend les 3 sections (first_steps / go_further / explore) quand e-commerce actif", async () => {
    render(<OnboardingChecklistPanel variant="page" />);
    await waitFor(() => expect(getOnboardingChecklistMock).toHaveBeenCalled());

    expect(
      screen.queryByText(t('onboarding.getting_started.section_first_steps')),
    ).not.toBeNull();
    expect(
      screen.queryByText(t('onboarding.getting_started.section_go_further')),
    ).not.toBeNull();
    expect(
      screen.queryByText(t('onboarding.getting_started.section_explore')),
    ).not.toBeNull();
  });

  it("masque la section 'explore' si e-commerce inactif", async () => {
    useHasModuleMock.mockReturnValue('disabled');
    render(<OnboardingChecklistPanel variant="page" />);
    await waitFor(() => expect(getOnboardingChecklistMock).toHaveBeenCalled());

    expect(
      screen.queryByText(t('onboarding.getting_started.section_first_steps')),
    ).not.toBeNull();
    expect(
      screen.queryByText(t('onboarding.getting_started.section_explore')),
    ).toBeNull();
  });
});

// ── useOnboardingItemCompletion — idempotence ───────────────────────────────

describe('useOnboardingItemCompletion — idempotent', () => {
  beforeEach(() => {
    localStorage.clear();
    completeOnboardingItemMock.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function HookHarness({ should }: { should: boolean }) {
    useOnboardingItemCompletion('profile_completed', should);
    return null;
  }

  it('appelle completeOnboardingItem UNE seule fois quand shouldComplete=true', async () => {
    const { rerender } = render(<HookHarness should={true} />);
    await waitFor(() =>
      expect(completeOnboardingItemMock).toHaveBeenCalledTimes(1),
    );
    // Re-render avec la même prop → pas de second appel (ref guard).
    rerender(<HookHarness should={true} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(completeOnboardingItemMock).toHaveBeenCalledTimes(1);
  });

  it("ne re-tire pas après un remount (flag localStorage)", async () => {
    const { unmount } = render(<HookHarness should={true} />);
    await waitFor(() =>
      expect(completeOnboardingItemMock).toHaveBeenCalledTimes(1),
    );
    unmount();
    // Remount d'une instance neuve : firedRef reset, mais le flag
    // localStorage est set ⇒ pas d'appel.
    render(<HookHarness should={true} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(completeOnboardingItemMock).toHaveBeenCalledTimes(1);
  });

  it("n'appelle rien quand shouldComplete=false", async () => {
    render(<HookHarness should={false} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(completeOnboardingItemMock).not.toHaveBeenCalled();
  });
});

// ── GuidedEmptyState — empty state guidé ────────────────────────────────────

describe('GuidedEmptyState', () => {
  beforeEach(() => {
    localStorage.clear();
    skipOnboardingItemMock.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('rend le titre + meta i18n quand itemKey fourni', () => {
    render(
      <GuidedEmptyState
        itemKey="leads_imported"
        title="No leads yet"
        description="Import or create your first lead"
      />,
    );
    expect(screen.queryByText('No leads yet')).not.toBeNull();
    expect(
      screen.queryByText(t('onboarding.guided_empty.step_label')),
    ).not.toBeNull();
  });

  it('click "Passer" appelle skipOnboardingItem(itemKey)', () => {
    render(
      <GuidedEmptyState
        itemKey="leads_imported"
        title="No leads yet"
        description="Import or create your first lead"
      />,
    );
    const skipBtn = screen.getByRole('button', {
      name: new RegExp(t('onboarding.checklist.action_skip'), 'i'),
    });
    fireEvent.click(skipBtn);
    expect(skipOnboardingItemMock).toHaveBeenCalledWith('leads_imported');
  });

  it('omet le bouton "Passer" quand itemKey absent (dégradation propre)', () => {
    render(
      <GuidedEmptyState
        title="No leads yet"
        description="Import or create your first lead"
      />,
    );
    const skipBtn = screen.queryByRole('button', {
      name: new RegExp(t('onboarding.checklist.action_skip'), 'i'),
    });
    expect(skipBtn).toBeNull();
  });

  it('rend tips[] quand fournis', () => {
    render(
      <GuidedEmptyState
        itemKey="leads_imported"
        title="No leads yet"
        tips={['Importez un CSV', 'Connectez Facebook Lead Ads', 'Créez à la main']}
      />,
    );
    expect(screen.queryByText('Importez un CSV')).not.toBeNull();
    expect(screen.queryByText('Connectez Facebook Lead Ads')).not.toBeNull();
  });
});
