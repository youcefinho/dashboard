// ── lazy-routes.test.ts — Sprint 95 (seq190) ────────────────────────────────
// Tests pour la division de code & composants lazy.
// 8 cas : factory, préchargement, catalogue, helpers.

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  lazyPage,
  preloadPage,
  createLazyComponent,
  LAZY_PAGE_REGISTRY,
} from '../../lib/lazy-routes';

// ──────────────────────────────────────────────────────────────────────────
// lazyPage factory — 3 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S95 — lazyPage', () => {
  it('1. Crée un composant React fonctionnel', () => {
    const Lazy = lazyPage(() => Promise.resolve({ default: () => null }));
    expect(typeof Lazy).toBe('function');
    expect(Lazy.displayName).toMatch(/^LazyPage/);
  });

  it('2. DisplayName contient le nom de la fonction', () => {
    const namedImport = function settingsLoader() {
      return Promise.resolve({ default: (() => null) as React.FC });
    };
    const Lazy = lazyPage(namedImport);
    expect(Lazy.displayName).toBe('LazyPage(settingsLoader)');
  });

  it('3. Options custom (fallback) sont acceptées', () => {
    const customFallback = React.createElement('div', null, 'Chargement...');
    const Lazy = lazyPage(
      () => Promise.resolve({ default: (() => null) as React.FC }),
      { fallback: customFallback },
    );
    expect(typeof Lazy).toBe('function');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// preloadPage — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S95 — preloadPage', () => {
  it('4. Déclenche l\'importFn une seule fois (cache)', () => {
    const importFn = vi.fn(() => Promise.resolve({ default: (() => null) as React.FC }));
    preloadPage(importFn, 'test-unique-key-1');
    preloadPage(importFn, 'test-unique-key-1'); // 2ème appel = cache hit
    expect(importFn).toHaveBeenCalledTimes(1);
  });

  it('5. Clé différente → 2 appels distincts', () => {
    const importFn = vi.fn(() => Promise.resolve({ default: (() => null) as React.FC }));
    preloadPage(importFn, 'key-A');
    preloadPage(importFn, 'key-B');
    expect(importFn).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// createLazyComponent — 1 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S95 — createLazyComponent', () => {
  it('6. Crée un composant avec displayName LazyComponent(...)', () => {
    const Comp = createLazyComponent(
      () => Promise.resolve({ default: (() => null) as React.FC }),
    );
    expect(typeof Comp).toBe('function');
    expect(Comp.displayName).toMatch(/^LazyComponent/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// LAZY_PAGE_REGISTRY — 2 cas
// ──────────────────────────────────────────────────────────────────────────

describe('S95 — LAZY_PAGE_REGISTRY', () => {
  it('7. Contient au moins 8 pages candidates', () => {
    expect(LAZY_PAGE_REGISTRY.length).toBeGreaterThanOrEqual(8);
  });

  it('8. Chaque entrée a key, path, estimatedKb', () => {
    for (const entry of LAZY_PAGE_REGISTRY) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.path).toBe('string');
      expect(typeof entry.estimatedKb).toBe('number');
      expect(entry.estimatedKb).toBeGreaterThan(0);
    }
  });
});
