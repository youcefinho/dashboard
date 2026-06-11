// ── lazy-routes.ts — Sprint 95 (seq190) ─────────────────────────────────────
// Division de code & chunks optimisés via React.lazy + Suspense.
//
// Couvre :
//   - Factory `lazyPage` : wrapper React.lazy avec fallback Suspense standardisé
//   - `preloadPage` : préchargement intentionnel (hover/route-prefetch)
//   - Catalogue des pages lazy (modules les + lourds)
//   - Helper `createLazyComponent` pour composants non-page
//
// Pattern compatible TanStack Router `defaultPreload: 'intent'`.

import React, { Suspense, type ComponentType } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────

export type LazyImportFn<T extends ComponentType<unknown>> = () => Promise<{
  default: T;
}>;

export interface LazyPageOptions {
  /** Fallback JSX pendant le chargement. Par défaut : skeleton spinner brand. */
  fallback?: React.ReactNode;
  /** Délai minimal (ms) avant d'afficher le fallback (évite flash). */
  minimumDelay?: number;
}

// ── Fallback par défaut ───────────────────────────────────────────────────

/** Skeleton spinner brand — cohérent avec le design system Intralys. */
const DefaultFallback = React.createElement(
  'div',
  {
    className: 'lazy-page-loader',
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      width: '100%',
    },
  },
  React.createElement('div', {
    className: 'spinner-brand',
    style: {
      width: 40,
      height: 40,
      border: '3px solid rgba(0,157,219,0.15)',
      borderTopColor: '#009DDB',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    },
  }),
);

// ── Factory lazyPage ──────────────────────────────────────────────────────

/** Crée un composant lazy-loadé avec Suspense intégré.
 *  Usage : `const LazySettings = lazyPage(() => import('@/pages/Settings'));`
 *  Le composant peut être utilisé directement dans le routeur. */
export function lazyPage<T extends ComponentType<unknown>>(
  importFn: LazyImportFn<T>,
  options?: LazyPageOptions,
): React.FC {
  const LazyComponent = React.lazy(importFn) as unknown as React.ComponentType<Record<string, unknown>>;
  const fallback = options?.fallback ?? DefaultFallback;

  const WrappedPage: React.FC = (props) => {
    return React.createElement(
      Suspense,
      { fallback },
      React.createElement(LazyComponent, props as Record<string, unknown>),
    );
  };

  // Nom pour les DevTools
  WrappedPage.displayName = `LazyPage(${importFn.name || 'Anonymous'})`;

  return WrappedPage;
}

// ── Préchargement ─────────────────────────────────────────────────────────

/** Cache des modules déjà préchargés (évite les appels multiples). */
const preloadCache = new Set<string>();

/** Précharge un module de page (déclenche le téléchargement du chunk).
 *  Idéal pour hover intent ou route prefetch TanStack.
 *  Le module est chargé en arrière-plan mais pas encore rendu. */
export function preloadPage<T extends ComponentType<unknown>>(
  importFn: LazyImportFn<T>,
  key?: string,
): void {
  const cacheKey = key ?? importFn.toString().slice(0, 100);
  if (preloadCache.has(cacheKey)) return;
  preloadCache.add(cacheKey);

  // Déclencher le chargement en arrière-plan (pas d'attente)
  importFn().catch(() => {
    // Échec silencieux — le chargement réel fera un retry via React.lazy
    preloadCache.delete(cacheKey);
  });
}

// ── Catalogue des pages lazy ──────────────────────────────────────────────
// Pages identifiées comme les + gros chunks dans l'analyse de build.
// Seules ces pages sont lazy-loadées — les pages fréquentes (Dashboard,
// Leads, Pipeline) restent dans le bundle principal pour un accès instantané.

/** Pages candidates au lazy loading (par poids de chunk décroissant). */
export const LAZY_PAGE_REGISTRY = Object.freeze([
  { key: 'settings', path: '@/pages/Settings', estimatedKb: 180 },
  { key: 'reports', path: '@/pages/Reports', estimatedKb: 150 },
  { key: 'warehouse', path: '@/pages/Warehouse', estimatedKb: 140 },
  { key: 'calendar', path: '@/pages/Calendar', estimatedKb: 120 },
  { key: 'inbox', path: '@/pages/Inbox', estimatedKb: 110 },
  { key: 'email-builder', path: '@/pages/EmailBuilder', estimatedKb: 100 },
  { key: 'workflow-builder', path: '@/pages/WorkflowBuilder', estimatedKb: 90 },
  { key: 'form-builder', path: '@/pages/FormBuilder', estimatedKb: 85 },
] as const);

// ── Helper pour composants non-page ───────────────────────────────────────

/** Crée un composant lazy (non-page) avec Suspense et fallback custom.
 *  Utile pour les modales lourdes ou les éditeurs intégrés. */
export function createLazyComponent<T extends ComponentType<unknown>>(
  importFn: LazyImportFn<T>,
  fallback: React.ReactNode = null,
): React.FC {
  const LazyComp = React.lazy(importFn) as unknown as React.ComponentType<Record<string, unknown>>;
  const Wrapped: React.FC = (props) =>
    React.createElement(
      Suspense,
      { fallback },
      React.createElement(LazyComp, props as Record<string, unknown>),
    );
  Wrapped.displayName = `LazyComponent(${importFn.name || 'Anonymous'})`;
  return Wrapped;
}

