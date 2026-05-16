// ── ModuleGuard + useHasModule — Sprint E1 M2.2 (2026-05-16) ─────────────────
//
// Garde frontend réutilisable pour isoler le module Boutique (e-commerce).
// - useHasModule(moduleId) : hook qui lit /api/modules (cache léger module-scope).
// - <ModuleGuard module="ecommerce"> : si module absent ⇒ redirect /dashboard
//   + Toast info FR québécois. Tant que l'état charge ⇒ rien (pas de flash).
//
// M3 wirera les vraies pages Boutique derrière <ModuleGuard>. Ici on fournit
// uniquement le garde + le hook réutilisables. Stripe SUBTLE, A11y respectés
// (aucune surface décorative ; le composant ne rend que ses enfants ou null).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useToast } from '@/components/ui';
import { getModules, type ModuleId } from '@/lib/api';

// ── Cache module-scope (évite un fetch /api/modules par guard monté) ─────────
let _cache: { active: ModuleId[]; ts: number } | null = null;
let _inflight: Promise<ModuleId[]> | null = null;
const TTL_MS = 30_000;

async function loadActiveModules(): Promise<ModuleId[]> {
  if (_cache && Date.now() - _cache.ts < TTL_MS) return _cache.active;
  if (_inflight) return _inflight;
  _inflight = getModules()
    .then((res) => {
      const active = res.data?.active ?? ['crm'];
      _cache = { active, ts: Date.now() };
      return active;
    })
    .catch(() => ['crm'] as ModuleId[])
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

/** Invalide le cache (à appeler après un PATCH /api/modules réussi). */
export function invalidateModulesCache(): void {
  _cache = null;
}

export type ModuleStatus = 'loading' | 'enabled' | 'disabled';

/**
 * Hook : statut d'un module pour le tenant courant.
 * 'crm' est toujours 'enabled' (socle, pas de fetch nécessaire).
 */
export function useHasModule(moduleId: ModuleId): ModuleStatus {
  const [status, setStatus] = useState<ModuleStatus>(
    moduleId === 'crm' ? 'enabled' : 'loading',
  );

  useEffect(() => {
    if (moduleId === 'crm') {
      setStatus('enabled');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    void loadActiveModules().then((active) => {
      if (cancelled) return;
      setStatus(active.includes(moduleId) ? 'enabled' : 'disabled');
    });
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  return status;
}

interface ModuleGuardProps {
  module: ModuleId;
  children: ReactNode;
  /** Destination de repli si le module est absent (défaut: /dashboard). */
  redirectTo?: string;
  /** Override du message Toast (défaut: message Boutique FR-QC). */
  deniedMessage?: string;
}

/**
 * Enveloppe une page/section gated. Si le module n'est pas activé pour le
 * tenant ⇒ Toast info + navigate(redirectTo). Pendant le chargement ⇒ null
 * (évite tout flash de contenu protégé). Si activé ⇒ rend les enfants.
 */
export function ModuleGuard({
  module,
  children,
  redirectTo = '/dashboard',
  deniedMessage,
}: ModuleGuardProps) {
  const status = useHasModule(module);
  const navigate = useNavigate();
  const { info } = useToast();
  const notified = useRef(false);

  useEffect(() => {
    if (status !== 'disabled' || notified.current) return;
    notified.current = true;
    info(
      deniedMessage ??
        (module === 'ecommerce'
          ? "Le module Boutique n'est pas activé. Active-le dans Paramètres → Modules."
          : "Ce module n'est pas activé pour ton compte."),
    );
    void navigate({ to: redirectTo });
  }, [status, module, deniedMessage, redirectTo, navigate, info]);

  if (status === 'enabled') return <>{children}</>;
  return null;
}
