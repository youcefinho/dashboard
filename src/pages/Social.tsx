// ── Page Social — Planificateur social (composer + posts + connexions) ──────
// LOT SOCIAL PLANNER (Sprint 9) — Manager-C (front). Export nommé FIGÉ
// `SocialPage` (route /social, App.tsx FIGÉ Phase A).
//
// Contenu :
//   • Composer multi-réseau (texte + médias + réseaux cibles + planification)
//     avec bouton « Générer avec l'IA » + prévisualisation par réseau.
//   • Liste des posts existants (getSocialPosts) avec statut + actions
//     éditer (updateSocialPost) / supprimer (deleteSocialPost) /
//     planifier (scheduleSocialPost).
//   • Section « Connexions » (getSocialAccounts) avec connecter
//     (connectSocialAccount — flag INACTIF géré, message clair, PAS de crash) /
//     déconnecter (disconnectSocialAccount).
//
// Helpers FIGÉS consommés tels quels (§6.A). Discrimination res.error / !res.data
// (JAMAIS de champ `code`). Libellés via t('social.*'). AUCUN CSS global.

import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Card, EmptyState, Modal, PageHero, useToast, useConfirm, usePrompt } from '@/components/ui';
import { Building2, CalendarDays } from 'lucide-react';
import {
  getSocialPosts,
  createSocialPost,
  updateSocialPost,
  deleteSocialPost,
  scheduleSocialPost,
  getSocialAccounts,
  connectSocialAccount,
  disconnectSocialAccount,
  // Sprint 32 — Google Business Profile (helper FIGÉ Manager-C / C1).
  getGbpLocations,
  createGbpPost,
} from '@/lib/api';
import type { GbpLocation, SocialAccount, SocialPost, SocialProvider } from '@/lib/types';
import { PostComposer, SocialPostCard, AccountConnectCard, type ComposerDraft } from '@/components/social';
import { GbpPostComposer } from '@/components/gbp/GbpPostComposer';
import { t } from '@/lib/i18n';

const ALL_NETWORKS: SocialProvider[] = ['facebook', 'instagram', 'linkedin', 'google_business'];

export function SocialPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<SocialProvider | null>(null);
  // ── Sprint 32 — État GBP : modal composer + cache locations pour fan-out ──
  const [gbpModalOpen, setGbpModalOpen] = useState(false);
  const [gbpModalSummary, setGbpModalSummary] = useState<string>('');
  const [gbpLocations, setGbpLocations] = useState<GbpLocation[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // Sprint 32 — On charge aussi les locations GBP (best-effort, silent si l'API
      // n'est pas configurée ou si aucune connexion n'existe).
      const [postsRes, accountsRes, gbpLocsRes] = await Promise.all([
        getSocialPosts(),
        getSocialAccounts(),
        getGbpLocations().catch(() => ({ data: undefined as GbpLocation[] | undefined, error: undefined })),
      ]);
      // Critique : si BOTH posts ET accounts échouent → bandeau erreur (état rare,
      // p.ex. déconnexion totale). Sinon on garde l'affichage partiel.
      if ((postsRes.error || !postsRes.data) && (accountsRes.error || !accountsRes.data)) {
        setLoadError(true);
      }
      if (postsRes.data) setPosts(postsRes.data);
      if (accountsRes.data) setAccounts(accountsRes.data);
      if (gbpLocsRes.data) setGbpLocations(gbpLocsRes.data);
    } catch (err) {
      console.error(err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Composer : créer ou mettre à jour ────────────────────────────────────
  const handleSave = async (draft: ComposerDraft) => {
    if (saving) return;
    setSaving(true);
    try {
      if (editing) {
        const res = await updateSocialPost(editing.id, {
          content: draft.content,
          media: draft.media,
          networks: draft.networks,
          scheduled_at: draft.scheduled_at,
        });
        if (res.data) {
          toast.success(t('social.saved'));
          setEditing(null);
          await loadData();
        } else {
          toast.error(res.error ?? t('social.not_configured'));
        }
      } else {
        const res = await createSocialPost({
          content: draft.content,
          media: draft.media,
          networks: draft.networks,
          scheduled_at: draft.scheduled_at,
        });
        if (res.data) {
          toast.success(t('social.saved'));
          // ── Sprint 32 — Fan-out GBP : si `google_business` est ciblé ET qu'au moins
          // une location GBP est connectée ET qu'aucune planification n'est posée,
          // on tente une publication GBP immédiate (best-effort, non-bloquant pour
          // le reste du flux Facebook/Instagram/LinkedIn).
          const wantsGbp = draft.networks.includes('google_business');
          const isImmediate = !draft.scheduled_at;
          if (wantsGbp && isImmediate && gbpLocations.length > 0) {
            const def = gbpLocations.find((l) => l.isDefault) ?? gbpLocations[0];
            if (def) {
              const gbpRes = await createGbpPost({
                locationId: def.id,
                summary: draft.content,
                topicType: 'STANDARD',
                ...(draft.media[0] ? { mediaUrl: draft.media[0] } : {}),
              });
              if (gbpRes.error || !gbpRes.data) {
                toast.error(gbpRes.error ?? t('social.not_configured'));
              } else {
                toast.success(t('social.saved'));
              }
            }
          } else if (wantsGbp && gbpLocations.length === 0) {
            // Pas d'établissement connecté → message clair, pas de crash.
            toast.info(t('social.not_configured'));
          }
          await loadData();
        } else {
          toast.error(res.error ?? t('social.not_configured'));
        }
      }
    } catch {
      toast.error(t('social.not_configured'));
    } finally {
      setSaving(false);
    }
  };

  // ── Actions sur un post existant ─────────────────────────────────────────
  const handleEdit = (post: SocialPost) => {
    setEditing(post);
    document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (post: SocialPost) => {
    const ok = await confirm({ title: t('social.delete'), danger: true });
    if (!ok) return;
    const res = await deleteSocialPost(post.id);
    if (res.data?.deleted) {
      if (editing?.id === post.id) setEditing(null);
      await loadData();
    } else {
      toast.error(res.error ?? t('social.not_configured'));
    }
  };

  const handleSchedule = async (post: SocialPost) => {
    const value = await prompt({
      title: t('social.schedule'),
      description: t('social.schedule_at'),
      placeholder: 'YYYY-MM-DDTHH:mm',
      defaultValue: post.scheduled_at ? new Date(post.scheduled_at).toISOString().slice(0, 16) : '',
    });
    if (!value) return;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      toast.error(t('social.schedule_at'));
      return;
    }
    // Refus planification dans le passé (anti-erreur user, marge 1 min).
    if (parsed.getTime() < Date.now() - 60_000) {
      toast.error(t('social.schedule_past'));
      return;
    }
    const iso = parsed.toISOString();
    const res = await scheduleSocialPost(post.id, iso);
    if (res.data) {
      toast.success(t('social.saved'));
      await loadData();
    } else {
      toast.error(res.error ?? t('social.not_configured'));
    }
  };

  // ── Connexions sociales (flag INACTIF géré proprement) ───────────────────
  const handleConnect = async (provider: SocialProvider) => {
    setConnectingProvider(provider);
    try {
      const res = await connectSocialAccount(provider);
      if (res.data?.url) {
        // OAuth actif (credentials posés) → redirection vers l'autorisation.
        window.location.href = res.data.url;
      } else {
        // Flag INACTIF (credentials absents) : le worker renvoie { error } 400
        // (calque oauth.ts) → message clair, AUCUN crash.
        toast.info(res.error ?? t('social.not_configured'));
      }
    } catch {
      toast.info(t('social.not_configured'));
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleDisconnect = async (account: SocialAccount) => {
    const ok = await confirm({ title: t('social.disconnect'), danger: true });
    if (!ok) return;
    const res = await disconnectSocialAccount(account.id);
    if (res.data?.deleted) {
      await loadData();
    } else {
      toast.error(res.error ?? t('social.not_configured'));
    }
  };

  const accountByProvider = (provider: SocialProvider): SocialAccount | null =>
    accounts.find((a) => a.provider === provider) ?? null;

  return (
    <AppLayout title={t('social.title')}>
      <PageHero
        meta="Social"
        title={t('social.title')}
        highlight={t('social.composer')}
        description={t('social.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              leftIcon={<Building2 size={14} />}
              onClick={() => { setGbpModalSummary(''); setGbpModalOpen(true); }}
            >
              {t('social.network.google_business')}
            </Button>
            <Link to="/social/calendar">
              <Button variant="secondary" leftIcon={<CalendarDays size={14} />}>{t('social.calendar')}</Button>
            </Link>
          </div>
        }
      />

      {/* ── Composer ── */}
      <section className="mb-8 animate-stagger stagger-1">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('social.composer')}</h2>
        <PostComposer
          key={editing?.id ?? 'new'}
          editing={editing}
          initial={editing ? {
            content: editing.content,
            media: editing.media ?? [],
            networks: editing.networks ?? [],
            scheduled_at: editing.scheduled_at ?? null,
          } : undefined}
          saving={saving}
          onSave={handleSave}
          onCancelEdit={() => setEditing(null)}
        />
      </section>

      {/* ── Liste des posts ── */}
      <section className="mb-8 animate-stagger stagger-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('social.title')}</h2>
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-live="polite">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-[var(--radius-lg)]" />)}
          </div>
        ) : loadError ? (
          <EmptyState
            icon={<span className="text-4xl" aria-hidden="true">⚠️</span>}
            title={t('social.load_error')}
            description={t('social.load_error_desc')}
            action={
              <Button variant="primary" onClick={() => void loadData()}>
                {t('social.retry')}
              </Button>
            }
          />
        ) : posts.length === 0 ? (
          <EmptyState
            variant="first-time"
            icon={<span className="text-4xl" aria-hidden="true">📣</span>}
            title={t('social.empty')}
            description={t('social.subtitle')}
          />
        ) : (
          <div className="space-y-3 animate-stagger stagger-3">
            {posts.map((post) => (
              <SocialPostCard
                key={post.id}
                post={post}
                onEdit={handleEdit}
                onDelete={(p) => void handleDelete(p)}
                onSchedule={(p) => void handleSchedule(p)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Connexions sociales ── */}
      <section className="animate-stagger stagger-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('social.connections')}</h2>
        <Card className="stripe-card">
          <div className="space-y-2.5">
            {ALL_NETWORKS.map((provider) => (
              <AccountConnectCard
                key={provider}
                provider={provider}
                account={accountByProvider(provider)}
                connecting={connectingProvider === provider}
                onConnect={(p) => void handleConnect(p)}
                onDisconnect={(a) => void handleDisconnect(a)}
              />
            ))}
          </div>
        </Card>
      </section>

      {/* ── Sprint 32 — Modal composer Google Business Profile ── */}
      <Modal
        open={gbpModalOpen}
        onOpenChange={setGbpModalOpen}
        title={t('social.network.google_business')}
        size="md"
      >
        <GbpPostComposer
          initialSummary={gbpModalSummary}
          onPublished={() => {
            setGbpModalOpen(false);
            void loadData();
          }}
        />
      </Modal>
    </AppLayout>
  );
}
