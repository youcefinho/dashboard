// ── CookiesBanner — Sprint 23 Sécurité / conformité ─────────────────────────
// Banner global anonyme monté avant tout layout (frère du RouterProvider).
// Lit/écrit localStorage `cookies_consent_v1` + POSTe sur /api/cookies/consent
// (best-effort, n'attend pas la réponse pour cacher). Expose un hook
// `useCookieConsent()` permettant aux composants d'analytics/marketing de
// gater leur init sur la catégorie correspondante.
//
// Loi 25 (Québec) + RGPD : on demande consentement explicite avant tout
// traçage non essentiel. Essentiel = pré-coché ET désactivé (techniquement
// requis pour faire fonctionner le site → pas de choix légal).
//
// Storage shape (versionnée pour invalidation policy bumps) :
//   { anonymous_id, categories: CookieConsent, policy_version, granted_at }
// Si policy_version stockée ≠ POLICY_VERSION courant → banner re-affiché.

import { useEffect, useState } from 'react';
import { postCookieConsent } from '@/lib/api';
import type { CookieConsent } from '@/lib/types';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui';

const STORAGE_KEY = 'cookies_consent_v1';
const POLICY_VERSION = '1.0';

interface StoredConsent {
  anonymous_id: string;
  categories: CookieConsent;
  policy_version: string;
  granted_at: string;
}

function loadStored(): StoredConsent | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsent;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.policy_version !== POLICY_VERSION) return null;
    if (!parsed.categories || typeof parsed.categories !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistStored(consent: StoredConsent): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  } catch {
    /* localStorage indispo (mode privé) — best-effort */
  }
}

function generateAnonymousId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fallback below */
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

const CATEGORIES: ReadonlyArray<keyof CookieConsent> = [
  'essential',
  'preferences',
  'analytics',
  'marketing',
];

const CONSENT_EVENT = 'intralys:cookie-consent-change';

/**
 * Hook lecteur du consentement courant. Retourne null tant que l'user n'a pas
 * répondu. Live-reactive via `storage` event (multi-onglet) + custom event
 * `intralys:cookie-consent-change` (même onglet, après submit).
 */
export function useCookieConsent(): CookieConsent | null {
  const [consent, setConsent] = useState<CookieConsent | null>(
    () => loadStored()?.categories ?? null,
  );
  useEffect(() => {
    const handler = () => setConsent(loadStored()?.categories ?? null);
    window.addEventListener('storage', handler);
    window.addEventListener(CONSENT_EVENT, handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener(CONSENT_EVENT, handler);
    };
  }, []);
  return consent;
}

export function CookiesBanner() {
  const [stored, setStored] = useState<StoredConsent | null>(() => loadStored());
  const [customize, setCustomize] = useState(false);
  const [prefs, setPrefs] = useState<CookieConsent>({
    essential: true,
    preferences: true,
    analytics: false,
    marketing: false,
  });

  // Sync si un autre onglet a soumis le consentement entre temps
  useEffect(() => {
    const sync = () => setStored(loadStored());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  if (stored !== null) return null;

  async function submit(consent: CookieConsent) {
    const id = generateAnonymousId();
    const record: StoredConsent = {
      anonymous_id: id,
      categories: consent,
      policy_version: POLICY_VERSION,
      granted_at: new Date().toISOString(),
    };
    persistStored(record);
    setStored(record);
    // Dispatch immédiat pour useCookieConsent() listeners même onglet
    try {
      window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent }));
    } catch {
      /* noop */
    }
    // Best-effort serveur — erreur silencieuse, ne bloque pas l'UX
    try {
      await postCookieConsent({
        anonymous_id: id,
        categories: consent,
        policy_version: POLICY_VERSION,
        url: typeof window !== 'undefined' ? window.location.pathname : undefined,
      });
    } catch {
      /* noop */
    }
  }

  return (
    <div
      role="dialog"
      aria-label={t('cookies.banner.title')}
      aria-describedby="cookies-banner-desc"
      className="cookies-banner-s18"
    >
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {t('cookies.banner.title')}
        </h2>
        <p
          id="cookies-banner-desc"
          className="mt-1.5 text-sm text-[var(--text-secondary)]"
        >
          {t('cookies.banner.desc')}
        </p>

        {!customize ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              data-testid="cookies-accept-all"
              onClick={() =>
                void submit({
                  essential: true,
                  preferences: true,
                  analytics: true,
                  marketing: true,
                })
              }
            >
              {t('cookies.banner.accept_all')}
            </Button>
            <Button
              data-testid="cookies-reject-non-essential"
              variant="secondary"
              onClick={() =>
                void submit({
                  essential: true,
                  preferences: false,
                  analytics: false,
                  marketing: false,
                })
              }
            >
              {t('cookies.banner.reject_non_essential')}
            </Button>
            <Button data-testid="cookies-customize" variant="ghost" onClick={() => setCustomize(true)}>
              {t('cookies.banner.customize')}
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {CATEGORIES.map((cat) => {
              const isEssential = cat === 'essential';
              const inputId = `cookies-cat-${cat}`;
              return (
                <label
                  key={cat}
                  htmlFor={inputId}
                  className="flex items-start gap-3 cursor-pointer"
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={prefs[cat]}
                    disabled={isEssential}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, [cat]: e.target.checked }))
                    }
                    className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border-strong)] text-[var(--primary)] focus:ring-[var(--ring)]"
                    aria-describedby={`${inputId}-desc`}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      {t(`cookies.category.${cat}.name`)}
                    </div>
                    <div
                      id={`${inputId}-desc`}
                      className="text-xs text-[var(--text-muted)]"
                    >
                      {t(`cookies.category.${cat}.desc`)}
                    </div>
                  </div>
                </label>
              );
            })}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button onClick={() => void submit(prefs)}>
                {t('cookies.banner.save_preferences')}
              </Button>
              <Button variant="ghost" onClick={() => setCustomize(false)}>
                {t('cookies.banner.customize')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
