// ── CommunityPage — Sprint 45 (Agent B2) ────────────────────────────────────
//
// Page principale forum communautaire interne (LOT COMMUNITY S45, seq140).
// Compose AppLayout + PageHero + onglets `Discussions` (B1 — <ThreadsList />)
// et `Modération` (B2 — <CommunityModerationQueue />, gated admin).
//
// Route : `/community` (déclarée dans src/App.tsx).
// i18n  : namespace `community_forum.*` (FIGÉ Phase A, parité 4 catalogues).
// Style : Stripe-clean (PageHero sobre + Tabs underline + Card surfaces).
// Imports RELATIFS (consigne agent B2 sprint 45).
//
// ── Renforcement (additif, 0 refactor) ──────────────────────────────────────
// Ajoute :
//   - <ErrorBoundary> autour de chaque onglet (un onglet planté ne casse pas l'autre).
//   - Garde dure côté state : si `tab=moderation` mais user redevient non-admin
//     (ex : downgrade live via /api/me), reset automatique vers `threads`.
//   - Landmark sémantique <section role="region" aria-labelledby> + data-testid.
//   - aria-live polite pour annoncer le changement d'onglet aux lecteurs d'écran.
// Aucun key i18n ajouté (parité STRICT préservée).

import { useState, useEffect } from 'react';
import { AppLayout } from '../../components/layout/AppLayout';
import { PageHero } from '../../components/ui/PageHero';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/Tabs';
import { useAuth } from '../../lib/auth';
import { t } from '../../lib/i18n';
import { ThreadsList } from '../../components/community/ThreadsList';
import { CommunityModerationQueue } from '../../components/community/CommunityModerationQueue';
import { ErrorBoundary } from '../ErrorBoundary';
import { MessageSquare, Shield } from 'lucide-react';

export function CommunityPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Onglet par défaut : Discussions. Si !admin → l'onglet Modération n'est
  // pas rendu (ni dans la liste ni en contenu).
  const [tab, setTab] = useState<'threads' | 'moderation'>('threads');

  // Garde dure : si le rôle admin retombe (downgrade live), force le retour
  // sur Discussions pour éviter un onglet actif sans contenu.
  useEffect(() => {
    if (!isAdmin && tab === 'moderation') setTab('threads');
  }, [isAdmin, tab]);

  const title = t('community_forum.title');

  return (
    <AppLayout title={title}>
      <PageHero
        meta="Workspace"
        title={title}
        description="Forum interne du tenant : discussions, votes et modération."
      />

      <section
        role="region"
        aria-label={title}
        aria-live="polite"
        data-testid="community-page-root"
      >
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'threads' | 'moderation')}
          aria-label={title}
        >
          <TabsList aria-label={`Sections de ${title}`}>
            <TabsTrigger
              value="threads"
              aria-label={t('community_forum.threads.title')}
              data-testid="community-tab-threads"
            >
              <span className="inline-flex items-center gap-2">
                <MessageSquare className="w-4 h-4" aria-hidden="true" />
                {t('community_forum.threads.title')}
              </span>
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger
                value="moderation"
                aria-label={t('community_forum.moderation.queue')}
                data-testid="community-tab-moderation"
              >
                <span className="inline-flex items-center gap-2">
                  <Shield className="w-4 h-4" aria-hidden="true" />
                  {t('community_forum.moderation.queue')}
                </span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="threads">
            <ErrorBoundary>
              <ThreadsList />
            </ErrorBoundary>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="moderation">
              <ErrorBoundary>
                <CommunityModerationQueue />
              </ErrorBoundary>
            </TabsContent>
          )}
        </Tabs>
      </section>
    </AppLayout>
  );
}
