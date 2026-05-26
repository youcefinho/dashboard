// @vitest-environment jsdom
// ── CookiesBanner — Sprint 23 Sécurité / conformité ─────────────────────────
// Couvre :
//  1. Banner rendu si localStorage cookies_consent_v1 absent.
//  2. Banner masqué si déjà stocké avec policy_version match.
//  3. "Accept all" → postCookieConsent appelé + localStorage updaté.
//  4. "Reject non-essential" → seuls essential=true.
//  5. "Customize" → checkboxes essential disabled, autres togglables, save.
//  6. useCookieConsent() retourne null avant consent, l'objet après.
//  7. policy_version différent → banner re-affiché.
//  8. crypto.randomUUID fail → fallback string utilisé, banner OK.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, act, renderHook, fireEvent } from '@testing-library/react';

// ─ Mock @/lib/api avant l'import du composant ─────────────────
const postCookieConsentMock = vi.fn(async () => ({ data: { ok: true } }));
vi.mock('@/lib/api', () => ({
  postCookieConsent: (...args: unknown[]) => postCookieConsentMock(...args as []),
}));

// Mock i18n — on retourne juste la clé pour assertions stables
vi.mock('@/lib/i18n', () => ({
  t: (k: string) => k,
}));

// Import APRÈS les mocks
import { CookiesBanner, useCookieConsent } from '../CookiesBanner';

const STORAGE_KEY = 'cookies_consent_v1';

beforeEach(() => {
  localStorage.clear();
  postCookieConsentMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('CookiesBanner — Sprint 23', () => {
  it('1. rend le banner si aucun consentement stocké', () => {
    render(<CookiesBanner />);
    expect(screen.getByText('cookies.banner.title')).toBeInTheDocument();
    expect(screen.getByText('cookies.banner.accept_all')).toBeInTheDocument();
    expect(screen.getByText('cookies.banner.reject_non_essential')).toBeInTheDocument();
    expect(screen.getByText('cookies.banner.customize')).toBeInTheDocument();
  });

  it('2. masque le banner si consentement déjà stocké avec policy_version match', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        anonymous_id: 'abc',
        categories: { essential: true, preferences: false, analytics: false, marketing: false },
        policy_version: '1.0',
        granted_at: new Date().toISOString(),
      }),
    );
    const { container } = render(<CookiesBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('3. "Accept all" → postCookieConsent appelé + localStorage updaté', async () => {
    render(<CookiesBanner />);
    await act(async () => {
      fireEvent.click(screen.getByText('cookies.banner.accept_all'));
    });
    // Storage est updaté immédiatement
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(stored.categories).toEqual({
      essential: true,
      preferences: true,
      analytics: true,
      marketing: true,
    });
    expect(stored.policy_version).toBe('1.0');
    expect(typeof stored.anonymous_id).toBe('string');
    expect(stored.anonymous_id.length).toBeGreaterThan(0);
    expect(postCookieConsentMock).toHaveBeenCalledTimes(1);
    const call = postCookieConsentMock.mock.calls[0]![0] as {
      categories: Record<string, boolean>;
    };
    expect(call.categories).toEqual({
      essential: true,
      preferences: true,
      analytics: true,
      marketing: true,
    });
  });

  it('4. "Reject non-essential" → seul essential=true', async () => {
    render(<CookiesBanner />);
    await act(async () => {
      fireEvent.click(screen.getByText('cookies.banner.reject_non_essential'));
    });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(stored.categories).toEqual({
      essential: true,
      preferences: false,
      analytics: false,
      marketing: false,
    });
    expect(postCookieConsentMock).toHaveBeenCalledTimes(1);
  });

  it('5. "Customize" → checkbox essential disabled, autres togglables, save fonctionne', async () => {
    render(<CookiesBanner />);
    await act(async () => {
      fireEvent.click(screen.getByText('cookies.banner.customize'));
    });
    // Checkboxes visibles
    const essentialCb = document.getElementById('cookies-cat-essential') as HTMLInputElement;
    const analyticsCb = document.getElementById('cookies-cat-analytics') as HTMLInputElement;
    const marketingCb = document.getElementById('cookies-cat-marketing') as HTMLInputElement;
    expect(essentialCb).toBeInTheDocument();
    expect(essentialCb.disabled).toBe(true);
    expect(essentialCb.checked).toBe(true);

    // Activer analytics, laisser marketing à false (default)
    await act(async () => {
      fireEvent.click(analyticsCb);
    });
    expect(analyticsCb.checked).toBe(true);
    expect(marketingCb.checked).toBe(false);

    // Save
    await act(async () => {
      fireEvent.click(screen.getByText('cookies.banner.save_preferences'));
    });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    expect(stored.categories.essential).toBe(true);
    expect(stored.categories.analytics).toBe(true);
    expect(stored.categories.marketing).toBe(false);
    expect(postCookieConsentMock).toHaveBeenCalledTimes(1);
  });

  it('6. useCookieConsent() retourne null avant consent, l\'objet après', async () => {
    const { result, rerender } = renderHook(() => useCookieConsent());
    expect(result.current).toBeNull();

    // Pose le consent + dispatch event
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        anonymous_id: 'x',
        categories: { essential: true, preferences: true, analytics: false, marketing: false },
        policy_version: '1.0',
        granted_at: new Date().toISOString(),
      }),
    );
    await act(async () => {
      window.dispatchEvent(new Event('intralys:cookie-consent-change'));
    });
    rerender();
    expect(result.current).toEqual({
      essential: true,
      preferences: true,
      analytics: false,
      marketing: false,
    });
  });

  it('7. policy_version différent → banner re-affiché', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        anonymous_id: 'abc',
        categories: { essential: true, preferences: false, analytics: false, marketing: false },
        policy_version: '0.9', // version obsolète
        granted_at: new Date().toISOString(),
      }),
    );
    render(<CookiesBanner />);
    // Banner doit être visible (policy_version mismatch invalide le stored)
    expect(screen.getByText('cookies.banner.title')).toBeInTheDocument();
  });

  it('8. crypto.randomUUID fail → fallback string utilisé, banner fonctionne', async () => {
    // Forcer un fail (jsdom expose crypto.randomUUID dans certaines versions).
    // On utilise vi.spyOn pour rester resilient si la prop n'est pas configurable.
    let spy: ReturnType<typeof vi.spyOn> | null = null;
    try {
      if (typeof globalThis.crypto?.randomUUID === 'function') {
        spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
          throw new Error('not available');
        });
      }
      render(<CookiesBanner />);
      await act(async () => {
        fireEvent.click(screen.getByText('cookies.banner.accept_all'));
      });
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      expect(typeof stored.anonymous_id).toBe('string');
      expect(stored.anonymous_id.length).toBeGreaterThan(0);
      expect(postCookieConsentMock).toHaveBeenCalledTimes(1);
    } finally {
      spy?.mockRestore();
    }
  });
});
