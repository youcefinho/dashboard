// ── AdminGuard — Sprint 46 M2.1 ──────────────────────────────
// Route guard pour routes admin/* — vérifie user.role === 'admin' || 'owner'.
// Non-admin : redirect vers /dashboard + toast warning FR-QC.
//
// Usage typique :
//   const adminOverviewRoute = createRoute({
//     getParentRoute: () => rootRoute,
//     path: '/admin/overview',
//     component: () => (
//       <LazyGuard>
//         <AdminGuard>
//           <AdminOverviewPage />
//         </AdminGuard>
//       </LazyGuard>
//     ),
//   });
//
// Le guard est COMPOSABLE avec AuthGuard (qui vérifie isLoggedIn) :
// il assume que l'utilisateur est déjà connecté (sinon AuthGuard l'a
// déjà redirigé vers /login). Si user est null ici, on redirige aussi
// vers /dashboard par sécurité — l'auth doit avoir tranché avant.

import { type ReactNode, useEffect, useRef } from 'react';
import { Navigate } from '@tanstack/react-router';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui';

const ADMIN_ROLES = new Set(['admin', 'owner']);

export function AdminGuard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { warning } = useToast();
  // Évite de relancer le toast en boucle si le composant re-render
  // pendant le micro-tick avant que <Navigate> ne déplace l'utilisateur.
  const announcedRef = useRef(false);

  const isAdmin = !!user?.role && ADMIN_ROLES.has(user.role);

  useEffect(() => {
    if (!isAdmin && !announcedRef.current) {
      announcedRef.current = true;
      warning('Accès réservé aux administrateurs.', {
        title: 'Section restreinte',
      });
    }
  }, [isAdmin, warning]);

  if (!isAdmin) {
    return <Navigate to="/dashboard" />;
  }

  return <>{children}</>;
}

/** Hook utilitaire pour conditionner du rendu UI au rôle admin (sans guard route). */
export function useIsAdmin(): boolean {
  const { user } = useAuth();
  return !!user?.role && ADMIN_ROLES.has(user.role);
}
