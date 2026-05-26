// @vitest-environment jsdom
// ── SaaS Lot 4 §6.21 — encart agence WelcomeWizard (Manager 3) ──────────────
//
// Contrat §6.21 (verbatim M1) vérifié :
//  1. /api/agency/plan → 200 { data:{ limits:{ maxSubAccounts, maxLeads } } }
//     ⇒ compte AGENCE ⇒ encart agence rendu EN HAUT de l'étape profile
//     (welcome / subaccounts / plan interpolé / CTA → /agencies).
//  2. /api/agency/plan → 403 AGENCY_ONLY (apiFetch ⇒ { error } sans data)
//     ⇒ AUCUN encart : les 4 étapes CRM figées (profile/industry/goals/team)
//     sont BYTE-IDENTIQUES au comportement legacy S8/Sprint 45.
//  3. Erreur réseau / réponse sans limits ⇒ AUCUN encart (best-effort,
//     jamais bloquant : le wizard se comporte exactement comme aujourd'hui).
//  4. limites null = illimité ⇒ glyphe « ∞ » interpolé dans la clé figée
//     onboarding.agency.plan (zéro clé hors §6.19, zéro string FR hardcodée).
//  5. Garde-fou : seules des clés onboarding.agency.* sont consommées par
//     l'encart ; aucune clé i18n créée ; aucun fichier interdit touché.
//
// ⚠️ NON exécuté sur la VM (sandbox VMware). vitest.config.ts `include`
// couvre `src/components/onboarding/__tests__/**/*.test.tsx` (ce fichier y
// est) mais `environment: 'node'` global → le pragma jsdom ci-dessus est
// requis pour RTL. Pattern repris de WelcomeWizard-s8.test.tsx (même dossier).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Mocks dépendances non pertinentes ───────────────────────────────────────
const patchModuleMock = vi.fn().mockResolvedValue({ data: { id: 'ecommerce', enabled: true } });
// apiFetch mocké par test (cas 200 agence / 403 / réseau).
const apiFetchMock = vi.fn();
vi.mock('@/lib/api', () => ({
  patchModule: (...a: unknown[]) => patchModuleMock(...a),
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
}));

const importDemoDataMock = vi.fn().mockResolvedValue({ leads: 0, tasks: 0 });
vi.mock('@/lib/demoData', () => ({
  importDemoData: (...a: unknown[]) => importDemoDataMock(...a),
}));

vi.mock('@/lib/announce', () => ({
  announceSR: vi.fn(),
}));

// i18n réel (fallback clé brute si non peuplée) — neutralise reload locale.
vi.mock('@/lib/i18n', async (orig) => {
  const real = await orig<typeof import('@/lib/i18n')>();
  return { ...real, setLocale: vi.fn() };
});

import { WelcomeWizard } from '../WelcomeWizard';
import { ToastProvider } from '@/components/ui';
import { t } from '@/lib/i18n';

function renderWizard() {
  return render(
    <ToastProvider>
      <WelcomeWizard
        open
        onComplete={vi.fn()}
        initialName="Émilie Tremblay"
        initialEmail="emilie@maboite.ca"
      />
    </ToastProvider>,
  );
}

describe('WelcomeWizard — Lot 4 §6.21 encart agence', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    patchModuleMock.mockClear();
    importDemoDataMock.mockClear();
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  afterEach(() => {
    cleanup();
  });

  it('200 agence : encart rendu EN HAUT de l’étape profile (welcome/subaccounts/plan/CTA)', async () => {
    apiFetchMock.mockResolvedValue({
      data: { plan: 'pro', limits: { maxSubAccounts: 25, maxLeads: 10000 } },
    });
    renderWizard();

    // L'encart apparaît après la résolution best-effort de /agency/plan.
    await waitFor(() => {
      expect(screen.getByText(t('onboarding.agency.welcome'))).toBeTruthy();
    });
    expect(screen.getByText(t('onboarding.agency.subaccounts'))).toBeTruthy();
    // Plan interpolé avec les vraies limites (25 / 10000).
    expect(
      screen.getByText(
        t('onboarding.agency.plan', { subAccounts: 25, leads: 10000 }),
      ),
    ).toBeTruthy();
    // CTA = lien vers la route existante /agencies (App.tsx).
    const cta = screen.getByText(t('onboarding.agency.cta')).closest('a');
    expect(cta?.getAttribute('href')).toBe('/agencies');

    // Appel best-effort sur la route figée Lot 3 §6.15.
    expect(apiFetchMock).toHaveBeenCalledWith('/agency/plan');

    // Rétro-compat : les 4 étapes CRM figées restent EXACTEMENT 4 (l'encart
    // est un bloc additif, PAS une étape supplémentaire).
    const stepChips = screen.getAllByRole('button', { name: /^Étape \d+ :/ });
    expect(stepChips).toHaveLength(4);
  });

  it('limites null = illimité : glyphe ∞ interpolé (zéro clé hors §6.19)', async () => {
    apiFetchMock.mockResolvedValue({
      data: { plan: 'enterprise', limits: { maxSubAccounts: null, maxLeads: null } },
    });
    renderWizard();

    await waitFor(() => {
      expect(
        screen.getByText(
          t('onboarding.agency.plan', { subAccounts: '∞', leads: '∞' }),
        ),
      ).toBeTruthy();
    });
  });

  it('403 AGENCY_ONLY : AUCUN encart — 4 étapes CRM byte-identiques', async () => {
    // apiFetch sur un 403 retourne { error } SANS data (cf. api.ts:103-105).
    apiFetchMock.mockResolvedValue({ error: 'Réservé aux comptes agence' });
    renderWizard();

    // Laisse l'effet best-effort se résoudre, puis vérifie l'absence d'encart.
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByText(t('onboarding.agency.welcome'))).toBeNull();
    expect(screen.queryByText(t('onboarding.agency.subaccounts'))).toBeNull();

    // Rétro-compat dure : exactement les 4 étapes CRM, rien de plus.
    const stepChips = screen.getAllByRole('button', { name: /^Étape \d+ :/ });
    expect(stepChips).toHaveLength(4);
  });

  it('erreur réseau / réponse sans limits : best-effort, AUCUN encart, jamais bloquant', async () => {
    // Cas réseau : apiFetch capture et retourne { error }.
    apiFetchMock.mockResolvedValue({ error: 'Service indisponible' });
    const { unmount } = renderWizard();
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByText(t('onboarding.agency.welcome'))).toBeNull();
    // Le wizard reste pleinement fonctionnel (4 étapes affichées).
    expect(screen.getAllByRole('button', { name: /^Étape \d+ :/ })).toHaveLength(4);
    unmount();

    // Cas 200 mais payload SANS limits (edge backend) ⇒ pas d'encart non plus.
    apiFetchMock.mockResolvedValue({ data: { plan: 'pro' } });
    renderWizard();
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByText(t('onboarding.agency.welcome'))).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Étape \d+ :/ })).toHaveLength(4);
  });

  it('garde-fou source : seules des clés onboarding.agency.* pour l’encart, route /agencies inline', () => {
    const src = readFileSync(resolve(__dirname, '../WelcomeWizard.tsx'), 'utf8');
    // Les 4 clés figées §6.19 sont consommées (aucune autre famille agence).
    expect(src).toMatch(/t\(['"]onboarding\.agency\.welcome['"]\)/);
    expect(src).toMatch(/t\(['"]onboarding\.agency\.subaccounts['"]\)/);
    expect(src).toMatch(/t\(\s*['"]onboarding\.agency\.plan['"]/);
    expect(src).toMatch(/t\(['"]onboarding\.agency\.cta['"]\)/);
    // CTA = route existante /agencies (lien inline, pas de fn api.ts ajoutée).
    expect(src).toMatch(/href="\/agencies"/);
    // best-effort : appel apiFetch inline sur la route figée Lot 3.
    expect(src).toMatch(/apiFetch[\s\S]*?['"]\/agency\/plan['"]\)/);
    // Aucune clé i18n interdite (namespace sprint R) introduite.
    const forbidden = /\bt\(\s*['"`](leads|dashboard|tasks|pipeline|clients|leadDetail)\./;
    expect(forbidden.test(src)).toBe(false);
  });
});
