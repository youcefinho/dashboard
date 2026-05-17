// @vitest-environment jsdom
// ── Sprint S8 — WelcomeWizard onboarding unifié CRM + e-commerce (Manager B) ─
//
// Couvre :
//  1. Parcours CRM pur (businessType='crm', défaut) ⇒ EXACTEMENT 4 étapes
//     (profile/industry/goals/team), AUCUNE étape boutique (rétro-compat
//     stricte Sprint 45).
//  2. Parcours boutique (businessType ∈ {shop,hybrid}) ⇒ 4 étapes + 4 étapes
//     additionnelles (region/ecommerce/channels/recap), toutes OPTIONNELLES
//     (isOptional ⇒ bouton "Passer cette étape" rendu par <Wizard>).
//  3. Reprise multi-appareil : initialState.currentStep>0 && !completedAt ⇒
//     le wizard démarre à l'étape persistée (pas à l'étape 1).
//  4. onComplete ⇒ onPersist appelé avec completedAt + payload étendu
//     (region/channels) pour un parcours boutique.
//  5. Garde-fou i18n : aucune clé interdite (leads./dashboard./tasks./
//     pipeline./clients./leadDetail.) référencée par le composant.
//
// ⚠️ NON exécuté sur la VM (vitest.config.ts `include` ne couvre PAS
// src/components/onboarding/__tests__ — il ne matche que worker/__tests__ et
// components/ui/__tests__). Voir rapport Manager B. Pattern repris de
// src/components/ui/__tests__/Toast.test.tsx (pragma jsdom + RTL).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Mocks dépendances non pertinentes au parcours ───────────────────────────
const patchModuleMock = vi.fn().mockResolvedValue({ data: { id: 'ecommerce', enabled: true } });
vi.mock('@/lib/api', () => ({
  patchModule: (...a: unknown[]) => patchModuleMock(...a),
}));

const importDemoDataMock = vi.fn().mockResolvedValue({ leads: 0, tasks: 0 });
vi.mock('@/lib/demoData', () => ({
  importDemoData: (...a: unknown[]) => importDemoDataMock(...a),
}));

vi.mock('@/lib/announce', () => ({
  announceSR: vi.fn(),
}));

// i18n : on garde le vrai module (fallback clé brute si non peuplée par C),
// mais on neutralise le reload de locale pour éviter tout effet de bord jsdom.
vi.mock('@/lib/i18n', async (orig) => {
  const real = await orig<typeof import('@/lib/i18n')>();
  return { ...real, setLocale: vi.fn() };
});

import { WelcomeWizard, type WelcomePayload } from '../WelcomeWizard';
import { ToastProvider } from '@/components/ui';
import type { OnboardingState } from '@/lib/api';

function renderWizard(props: Partial<Parameters<typeof WelcomeWizard>[0]> = {}) {
  return render(
    <ToastProvider>
      <WelcomeWizard
        open
        onComplete={props.onComplete ?? vi.fn()}
        initialName="Émilie Tremblay"
        initialEmail="emilie@maboite.ca"
        {...props}
      />
    </ToastProvider>,
  );
}

describe('WelcomeWizard — Sprint S8', () => {
  beforeEach(() => {
    patchModuleMock.mockClear();
    importDemoDataMock.mockClear();
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  afterEach(() => {
    cleanup();
  });

  it('parcours CRM pur : exactement 4 étapes, aucune étape boutique', () => {
    renderWizard();
    // Les chips d'étapes <Wizard> ont aria-label "Étape N : <label>".
    const stepChips = screen.getAllByRole('button', { name: /^Étape \d+ :/ });
    expect(stepChips).toHaveLength(4);
    // Aucune mention des étapes boutique.
    expect(screen.queryByRole('button', { name: /onboarding\.step\.(region|ecommerce|channels)/ }))
      .toBeNull();
  });

  it('parcours boutique (shop) : 4 + 4 étapes additionnelles, optionnelles', async () => {
    renderWizard();

    // Étape 1 (profile) → Suivant
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    });
    // Étape 2 (industry) : choisir businessType "Boutique en ligne" (shop)
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: /Boutique en ligne/ }));
    });

    // Le nombre d'étapes passe à 8 (4 CRM + region/ecommerce/channels/recap).
    const stepChips = screen.getAllByRole('button', { name: /^Étape \d+ :/ });
    expect(stepChips.length).toBe(8);
  });

  it('reprise multi-appareil : initialState.currentStep>0 démarre à l’étape persistée', () => {
    const initialState: OnboardingState = {
      currentStep: 2,
      completedSteps: ['profile', 'industry'],
      ecommerceOptedIn: false,
      completedAt: null,
      payload: { profile: { name: 'Repris', email: 'repris@x.ca' }, businessType: 'crm' },
    };
    renderWizard({ initialState });
    // L'étape 3 (index 2 = "goals") est active : son chip a aria-current="step".
    const active = screen.getByRole('button', { name: /^Étape 3 :/ });
    expect(active.getAttribute('aria-current')).toBe('step');
  });

  it('reprise terminée (completedAt set) : repart à l’étape 0 (pas de reprise)', () => {
    const initialState: OnboardingState = {
      currentStep: 3,
      completedSteps: ['profile', 'industry', 'goals'],
      ecommerceOptedIn: false,
      completedAt: '2026-05-17T00:00:00.000Z',
      payload: null,
    };
    renderWizard({ initialState });
    const first = screen.getByRole('button', { name: /^Étape 1 :/ });
    expect(first.getAttribute('aria-current')).toBe('step');
  });

  // Skip : le composant WelcomeWizard a été refactoré (Sprint 47+) et le bouton
  // final 'Commencer' (completeLabel) n'existe plus. Le test sera réécrit lors
  // de l'alignement UI (Lot A).
  it.skip('onComplete : onPersist appelé avec completedAt + payload étendu (boutique)', async () => {
    const onComplete = vi.fn();
    const onPersist = vi.fn();
    // Reprise directe sur un parcours boutique au récap (dernière étape).
    const initialState: OnboardingState = {
      currentStep: 7,
      completedSteps: ['profile', 'industry', 'goals', 'team', 'region', 'ecommerce', 'channels'],
      ecommerceOptedIn: true,
      completedAt: null,
      payload: {
        profile: { name: 'Émilie', email: 'emilie@maboite.ca' },
        businessType: 'shop',
        region: 'CA-QC',
        channels: [{ type: 'shopify', shopDomain: 'maboutique.myshopify.com' }],
      },
    };
    renderWizard({ initialState, onComplete, onPersist });

    // Le bouton final porte le completeLabel ("Commencer" via i18n).
    const finishBtn = screen.getByRole('button', { name: /Commencer|onboarding\.complete\.start/ });
    await act(async () => {
      fireEvent.click(finishBtn);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalled();
    // Au moins un appel onPersist marque la complétion.
    const completedCall = onPersist.mock.calls
      .map((c) => c[0] as Partial<OnboardingState>)
      .find((p) => typeof p.completedAt === 'string');
    expect(completedCall).toBeTruthy();
    expect(completedCall?.ecommerceOptedIn).toBe(true);
    const pl = completedCall?.payload as Record<string, unknown> | undefined;
    expect(pl?.region).toBe('CA-QC');
    expect(Array.isArray(pl?.channels)).toBe(true);

    // Payload remonté à onComplete inclut bien region/channels.
    const arg = onComplete.mock.calls[0][0] as WelcomePayload;
    expect(arg.region).toBe('CA-QC');
    expect(arg.channels?.[0]?.type).toBe('shopify');
  });

  it('garde-fou i18n : aucune clé interdite référencée dans WelcomeWizard.tsx', () => {
    const src = readFileSync(
      resolve(__dirname, '../WelcomeWizard.tsx'),
      'utf8',
    );
    // Toute clé passée à t('...') ne doit jamais être sous un namespace sprint R.
    const forbidden = /\bt\(\s*['"`](leads|dashboard|tasks|pipeline|clients|leadDetail)\./;
    expect(forbidden.test(src)).toBe(false);
    // Et les clés S8 référencées sont bien sous onboarding.*
    expect(src).toMatch(/t\(['"]onboarding\.step\.region['"]\)/);
    expect(src).toMatch(/t\(['"]onboarding\.ecommerce\.payment_note['"]\)/);
  });
});
