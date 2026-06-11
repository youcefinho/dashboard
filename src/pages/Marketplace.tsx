// ── Marketplace — templates partageables cross-tenant (LOT G7, Phase B) ──────
//
// Corps réel Phase B (Manager-C front exclusif). Export FIGÉ `MarketplacePage`
// (consommé par App.tsx route /marketplace via lazy — gelé Phase A). 4 vues via
// onglets (calque pattern Tabs d'Affiliates.tsx) :
//   1. Catalogue   — grid de cards publiques (getMarketplaceListings) + filtres
//                    catégorie/kind, bouton "Voir" → détail.
//   2. Détail      — getMarketplaceListing(id) : description, aperçu LISIBLE de
//                    la structure (content_json → nb d'étapes, pas le JSON brut),
//                    rating + reviews, bouton Installer, formulaire avis.
//   3. Publier     — sélecteur kind + entité source du tenant (getFunnels /
//                    getWorkflows / getSequences) + titre/description/catégorie
//                    → publishToMarketplace. Note "Gratuit".
//   4. Mes publications — getMyMarketplaceListings : titre/statut/installs/note.
//
// Helpers api.ts FIGÉS Phase A consommés tels quels : getMarketplaceListings /
// getMarketplaceListing / publishToMarketplace / installMarketplaceListing /
// reviewMarketplaceListing / getMyMarketplaceListings. Sélecteur source réutilise
// getFunnels / getWorkflows / getSequences (existants). i18n 100% `marketplace.*`
// + clés communes (`action.*`) — AUCUNE création de clé.
// Discrimination erreur : présence `res.data` / texte `res.error`, JAMAIS code.

import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  Tag,
  Icon,
  Input,
  Textarea,
  Select,
  Skeleton,
  EmptyState,
  FilterChip,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  PageHero,
  useToast,
  useConfirm,
} from '@/components/ui';
import {
  Store,
  Star,
  Download,
  Upload,
  LayoutGrid,
  ArrowLeft,
  PackageCheck,
  GitBranch,
  Workflow as WorkflowIcon,
  Filter,
  Boxes,
} from 'lucide-react';
import {
  getMarketplaceListings,
  getMarketplaceListing,
  publishToMarketplace,
  installMarketplaceListing,
  reviewMarketplaceListing,
  getMyMarketplaceListings,
  getFunnels,
  getWorkflows,
  getSequences,
  getPacks,
  type MarketplaceListing,
  type MarketplaceReview,
  type MarketplaceKind,
  type IndustryPack,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { PackBundleDetail } from '@/components/marketplace/PackBundleDetail';

// Client cible de l'installation des packs métier. Aligné sur Settings.tsx
// (seul appelant existant de installPack) — clientId 'gatineau' par défaut.
const PACK_INSTALL_CLIENT_ID = 'gatineau';

type Tab = 'browse' | 'publish' | 'mine' | 'packs';
type KindFilter = MarketplaceKind | 'all';
type SortKey = 'popular' | 'recent' | 'rating';

const KIND_ORDER: MarketplaceKind[] = ['funnel', 'workflow', 'sequence'];
const SORT_ORDER: SortKey[] = ['popular', 'recent', 'rating'];

const KIND_TAG: Record<MarketplaceKind, 'info' | 'brand' | 'neutral'> = {
  funnel: 'info',
  workflow: 'brand',
  sequence: 'neutral',
};

function kindLabel(kind: MarketplaceKind): string {
  return t(`marketplace.category.${kind}`);
}

function statusLabel(status: MarketplaceListing['status']): string {
  return status === 'published'
    ? t('marketplace.status.published')
    : t('marketplace.status.draft');
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-CA');
}

// Aperçu LISIBLE de la structure d'un snapshot (jamais le JSON brut).
// Défensif : le snapshot vient du backend Manager-B (forme non figée). Accepte un
// objet déjà parsé (détail GET renvoie `content` = objet) OU une string JSON
// (rétro-compat si une version flatten `content_json`). Compte les collections
// plausibles (steps / blocks / pages / nodes) sans planter.
function structureSummary(
  content: unknown,
  kind: MarketplaceKind,
): string | null {
  if (content == null) return null;
  let parsed: unknown = content;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
  }
  const obj =
    parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  if (!obj) return null;

  const countOf = (key: string): number =>
    Array.isArray(obj[key]) ? (obj[key] as unknown[]).length : 0;

  const steps = countOf('steps');
  const blocks = countOf('blocks');
  const pages = countOf('pages');
  const nodes = countOf('nodes');

  const parts: string[] = [];
  if (kind === 'funnel') {
    const n = steps || pages;
    if (n) parts.push(`${n} ${t('marketplace.category.funnel').toLowerCase()} · étapes`);
  } else {
    const n = steps || nodes;
    if (n) parts.push(`${n} ${t('marketplace.category.workflow').toLowerCase()} · étapes`);
  }
  if (blocks) parts.push(`${blocks} blocs`);

  if (parts.length === 0) {
    // Fallback générique : nb total d'étapes détectées.
    const total = steps + blocks + pages + nodes;
    if (total > 0) parts.push(`${total} étapes`);
  }
  return parts.length ? parts.join(' · ') : null;
}

// Étoiles de notation — lecture seule (rating_avg) ou interactive (review form).
function Stars({
  value,
  max = 5,
  onChange,
  size = 16,
  ariaLabel,
}: {
  value: number;
  max?: number;
  onChange?: (v: number) => void;
  size?: number;
  ariaLabel?: string;
}) {
  const interactive = typeof onChange === 'function';
  return (
    <span
      className="mk-stars"
      role={interactive ? 'radiogroup' : undefined}
      aria-label={ariaLabel}
    >
      {Array.from({ length: max }).map((_, i) => {
        const filled = value >= i + 1;
        if (!interactive) {
          return (
            <Icon
              key={i}
              as={Star}
              size={size}
              className={filled ? 'mk-star mk-star--on' : 'mk-star'}
            />
          );
        }
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === i + 1}
            aria-label={`${i + 1} / ${max}`}
            className="mk-star-btn"
            onClick={() => onChange(i + 1)}
          >
            <Icon
              as={Star}
              size={size}
              className={filled ? 'mk-star mk-star--on' : 'mk-star'}
            />
          </button>
        );
      })}
    </span>
  );
}

function RatingInline({ listing }: { listing: MarketplaceListing }) {
  if (!listing.rating_count) {
    return <span className="text-sm text-muted">{t('marketplace.reviews')}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted">
      <Stars value={Math.round(listing.rating_avg)} size={13} />
      <span className="tabular-nums">
        {listing.rating_avg.toFixed(1)} · {listing.rating_count}{' '}
        {t('marketplace.reviews')}
      </span>
    </span>
  );
}

export function MarketplacePage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<Tab>('browse');

  // ── Catalogue ──
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  // Sprint 19 — recherche serveur (Input débouncé) + tri serveur.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('popular');

  // ── Détail (overlay sur l'onglet Catalogue) ──
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MarketplaceListing | null>(null);
  // Structure parsée du snapshot (détail GET renvoie `content` = objet déjà parsé).
  const [detailContent, setDetailContent] = useState<unknown>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);

  // ── Formulaire avis ──
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  // ── Publier ──
  const [pubKind, setPubKind] = useState<MarketplaceKind>('funnel');
  const [pubSourceId, setPubSourceId] = useState<string>('');
  const [pubTitle, setPubTitle] = useState('');
  const [pubDescription, setPubDescription] = useState('');
  const [pubCategory, setPubCategory] = useState('');
  const [pubBusy, setPubBusy] = useState(false);
  const [sources, setSources] = useState<Array<{ id: string; label: string }>>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  // ── Mes publications ──
  const [mine, setMine] = useState<MarketplaceListing[]>([]);
  const [mineLoading, setMineLoading] = useState(true);

  // ── Packs métier (onglet « Packs & bundles ») ──
  // Liste via getPacks() ; détail (snapshot lisible + install) via le composant
  // enfant PackBundleDetail (getPackDetail / installPack).
  const [packs, setPacks] = useState<IndustryPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [packSlug, setPackSlug] = useState<string | null>(null);

  // ── Erreurs de chargement (inline retry, role="alert") ──
  const [listError, setListError] = useState<string | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ── Loaders ──
  // Sprint 19 — filtrage/recherche/tri pilotés SERVEUR (champs vides omis par le
  // helper). RÉUTILISE kindFilter/categoryFilter ('all' → param omis). Best-effort.
  const loadListings = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    const res = await getMarketplaceListings({
      q: debouncedSearch.trim() || undefined,
      kind: kindFilter === 'all' ? undefined : kindFilter,
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      sort,
    });
    if (res.data) setListings(res.data);
    else {
      setListings([]);
      if (res.error) setListError(res.error);
    }
    setListLoading(false);
  }, [debouncedSearch, kindFilter, categoryFilter, sort]);

  const loadMine = useCallback(async () => {
    setMineLoading(true);
    setMineError(null);
    const res = await getMyMarketplaceListings();
    if (res.data) setMine(res.data);
    else if (res.error) setMineError(res.error);
    setMineLoading(false);
  }, []);

  const loadPacks = useCallback(async () => {
    setPacksLoading(true);
    setPacksError(null);
    const res = await getPacks();
    if (res.data) setPacks(res.data);
    else {
      setPacks([]);
      if (res.error) setPacksError(res.error);
    }
    setPacksLoading(false);
  }, []);

  // Débounce de la saisie recherche (~280ms) → debouncedSearch (déclenche le fetch).
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 280);
    return () => clearTimeout(id);
  }, [search]);

  // Recharge le catalogue à chaque changement de query serveur (q/kind/category/sort).
  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  // Charge les packs métier à la 1re visite de l'onglet (lazy, best-effort).
  useEffect(() => {
    if (tab === 'packs') void loadPacks();
  }, [tab, loadPacks]);

  // Charge les entités source du tenant quand le kind change (onglet Publier).
  const loadSources = useCallback(async (kind: MarketplaceKind) => {
    setSourcesLoading(true);
    setSources([]);
    setPubSourceId('');
    if (kind === 'funnel') {
      const res = await getFunnels();
      if (res.data) {
        setSources(res.data.map((f) => ({ id: f.id, label: f.name })));
      }
    } else if (kind === 'workflow') {
      const res = await getWorkflows();
      if (res.data) {
        setSources(res.data.map((w) => ({ id: w.id, label: w.name })));
      }
    } else {
      const res = await getSequences();
      if (res.data) {
        setSources(res.data.map((s) => ({ id: s.id, label: s.name })));
      }
    }
    setSourcesLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'publish') void loadSources(pubKind);
  }, [tab, pubKind, loadSources]);

  // ── Détail : open / close ──
  // Le détail GET renvoie un shape ENVELOPPÉ `{ listing: {...content}, reviews[] }`
  // (worker handleGetMarketplaceListing) — distinct du type plat `MarketplaceListing`
  // déclaré (Phase A figée). On normalise défensivement sans toucher api.ts :
  //   - shape enveloppé → listing + reviews + content parsé.
  //   - shape plat (rétro-compat) → res.data tel quel.
  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailContent(null);
    setDetailLoading(true);
    setDetailError(null);
    setReviewRating(0);
    setReviewComment('');
    const res = await getMarketplaceListing(id);
    if (res.data) {
      const raw = res.data as unknown as Record<string, unknown>;
      const wrapped =
        raw && typeof raw === 'object' && raw.listing && typeof raw.listing === 'object';
      if (wrapped) {
        const inner = raw.listing as Record<string, unknown>;
        const reviews = Array.isArray(raw.reviews)
          ? (raw.reviews as MarketplaceReview[])
          : [];
        setDetail({ ...(inner as unknown as MarketplaceListing), reviews });
        setDetailContent(inner.content ?? null);
      } else {
        setDetail(res.data);
        setDetailContent(res.data.content_json ?? null);
      }
    } else if (res.error) {
      setDetailError(res.error);
    }
    setDetailLoading(false);
  }, []);

  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
    setDetailContent(null);
  };

  // ── Installer ──
  const handleInstall = async (listing: MarketplaceListing) => {
    setInstalling(true);
    const res = await installMarketplaceListing(listing.id);
    setInstalling(false);
    if (res.data) {
      setInstalledIds((prev) => new Set(prev).add(listing.id));
      success(t('marketplace.installed'));
      // Reflète l'incrément d'install_count localement.
      setDetail((prev) =>
        prev && prev.id === listing.id
          ? { ...prev, install_count: prev.install_count + 1 }
          : prev,
      );
    } else {
      toastError(res.error || t('marketplace.install'));
    }
  };

  // ── Avis ──
  const handleSubmitReview = async () => {
    if (!detail || reviewRating < 1) return;
    setReviewBusy(true);
    const res = await reviewMarketplaceListing(detail.id, {
      rating: reviewRating,
      comment: reviewComment.trim() || undefined,
    });
    setReviewBusy(false);
    if (res.data) {
      success(t('marketplace.reviews'));
      setReviewRating(0);
      setReviewComment('');
      // Recharge le détail pour afficher l'avis + la note recalculée.
      void openDetail(detail.id);
    } else {
      toastError(res.error || t('marketplace.reviews'));
    }
  };

  // ── Publier ──
  const handlePublish = async () => {
    if (!pubSourceId || !pubTitle.trim()) return;
    const ok = await confirm({
      title: t('marketplace.publish'),
      description: pubTitle.trim(),
    });
    if (!ok) return;
    setPubBusy(true);
    const res = await publishToMarketplace({
      kind: pubKind,
      source_id: pubSourceId,
      title: pubTitle.trim(),
      description: pubDescription.trim() || undefined,
      category: pubCategory.trim() || undefined,
    });
    setPubBusy(false);
    if (res.data) {
      success(t('marketplace.publish'));
      setPubTitle('');
      setPubDescription('');
      setPubCategory('');
      setPubSourceId('');
      void loadListings();
      void loadMine();
      setTab('mine');
    } else {
      toastError(res.error || t('marketplace.publish'));
    }
  };

  // ── Dérivés ──
  // Sprint 19 — le filtrage kind/category/q/sort est désormais SERVEUR : `filtered`
  // = `listings` tel quel (le helper a déjà appliqué les filtres). On conserve un
  // catalogue de catégories STABLE (accumulé, jamais réduit) pour que le Select ne
  // s'effondre pas quand une catégorie est sélectionnée (le serveur ne renvoie alors
  // que cette catégorie). Best-effort.
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  useEffect(() => {
    setKnownCategories((prev) => {
      const set = new Set(prev);
      for (const l of listings) {
        if (l.category) set.add(l.category);
      }
      return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr-CA'));
    });
  }, [listings]);
  const categories = knownCategories;

  const filtered = listings;

  const kindFilterDefs: Array<{ key: KindFilter; label: string }> = [
    { key: 'all', label: t('marketplace.title') },
    ...KIND_ORDER.map((k) => ({ key: k as KindFilter, label: kindLabel(k) })),
  ];

  return (
    <AppLayout title={t('marketplace.title')}>
      <div className="p-6">
        <PageHero
          meta={t('marketplace.nav')}
          title={t('marketplace.title')}
          description={t('marketplace.subtitle')}
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="browse">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={LayoutGrid} size="sm" />
                {t('marketplace.title')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="publish">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={Upload} size="sm" />
                {t('marketplace.publish')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="mine">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={PackageCheck} size="sm" />
                {t('marketplace.nav')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="packs">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={Boxes} size="sm" />
                {t('mktx.tab')}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* ── Onglet 1 — Catalogue / Détail ── */}
          <TabsContent value="browse">
            {detailId ? (
              <DetailView
                listing={detail}
                content={detailContent}
                loading={detailLoading}
                error={detailError}
                onRetry={() => void openDetail(detailId)}
                installed={installedIds.has(detailId)}
                installing={installing}
                reviewRating={reviewRating}
                reviewComment={reviewComment}
                reviewBusy={reviewBusy}
                onBack={closeDetail}
                onInstall={handleInstall}
                onReviewRating={setReviewRating}
                onReviewComment={setReviewComment}
                onSubmitReview={() => void handleSubmitReview()}
              />
            ) : (
              <>
                {/* Filtres */}
                {/* Sprint 19 — barre recherche débouncée + tri serveur (au-dessus
                    des chips kind / Select catégorie). */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <Input
                    type="search"
                    value={search}
                    placeholder={t('marketplace.search')}
                    aria-label={t('marketplace.search')}
                    onChange={(e) => setSearch(e.target.value)}
                    className="flex-1 min-w-[14rem]"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted whitespace-nowrap">
                      {t('marketplace.sort.label')}
                    </span>
                    <Select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as SortKey)}
                      aria-label={t('marketplace.sort.label')}
                      className="mk-cat-select"
                    >
                      {SORT_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {t(`marketplace.sort.${s}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {kindFilterDefs.map((f) => (
                      <FilterChip
                        key={f.key}
                        label={f.label}
                        variant={kindFilter === f.key ? 'active' : 'available'}
                        onClick={() => setKindFilter(f.key)}
                      />
                    ))}
                  </div>
                  {categories.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Icon as={Filter} size="sm" className="text-muted" />
                      <Select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="mk-cat-select"
                      >
                        <option value="all">{t('marketplace.title')}</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </div>

                {listError && !listLoading ? (
                  <Card
                    role="alert"
                    aria-live="polite"
                    className="p-4 mb-4 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
                  >
                    <span className="text-sm">{listError}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void loadListings()}
                    >
                      {t('action.retry')}
                    </Button>
                  </Card>
                ) : null}
                {listLoading ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Card key={i} className="p-5">
                        <Skeleton className="h-5 w-2/3 mb-3" />
                        <Skeleton className="h-3 w-1/3 mb-4" />
                        <Skeleton className="h-10 w-full rounded-md" />
                      </Card>
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <EmptyState
                    icon={<Icon as={Store} size={40} />}
                    title={t('marketplace.empty')}
                    description={t('marketplace.subtitle')}
                  />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((l) => (
                      <Card
                        key={l.id}
                        className="product-card-s4 p-5 flex flex-col gap-3 mk-card"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold leading-tight">
                            {l.title}
                          </span>
                          <Tag variant={KIND_TAG[l.kind]} size="sm">
                            {kindLabel(l.kind)}
                          </Tag>
                        </div>
                        {l.category ? (
                          <span className="text-xs text-muted">{l.category}</span>
                        ) : null}
                        {l.description ? (
                          <p className="text-sm text-muted mk-clamp-2">
                            {l.description}
                          </p>
                        ) : null}
                        <div className="flex items-center justify-between gap-2 mt-auto pt-2">
                          <RatingInline listing={l} />
                          <span className="inline-flex items-center gap-1 text-xs text-muted tabular-nums">
                            <Icon as={Download} size={13} />
                            {l.install_count}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <Tag variant="success" size="sm">
                            {t('marketplace.free')}
                          </Tag>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void openDetail(l.id)}
                          >
                            {t('action.view')}
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Onglet 2 — Publier ── */}
          <TabsContent value="publish">
            <div className="flex flex-col gap-4 max-w-2xl">
              <Card className="p-6 flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="prop-label">
                      {t('marketplace.category.workflow')}
                    </label>
                    <Select
                      value={pubKind}
                      onChange={(e) =>
                        setPubKind(e.target.value as MarketplaceKind)
                      }
                    >
                      {KIND_ORDER.map((k) => (
                        <option key={k} value={k}>
                          {kindLabel(k)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="prop-label">{t('marketplace.publish')}</label>
                    <Select
                      value={pubSourceId}
                      onChange={(e) => setPubSourceId(e.target.value)}
                      disabled={sourcesLoading || sources.length === 0}
                    >
                      <option value="">
                        {sourcesLoading
                          ? '…'
                          : sources.length === 0
                            ? t('marketplace.empty')
                            : '—'}
                      </option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="prop-label">{t('marketplace.title')}</label>
                  <Input
                    value={pubTitle}
                    placeholder={t('marketplace.title')}
                    onChange={(e) => setPubTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label className="prop-label">{t('marketplace.subtitle')}</label>
                  <Textarea
                    value={pubDescription}
                    rows={3}
                    onChange={(e) => setPubDescription(e.target.value)}
                  />
                </div>

                <div>
                  <label className="prop-label">{t('marketplace.category.funnel')}</label>
                  <Input
                    value={pubCategory}
                    onChange={(e) => setPubCategory(e.target.value)}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 pt-2">
                  <Tag variant="success" size="sm">
                    {t('marketplace.free')}
                  </Tag>
                  <Button
                    variant="primary"
                    isLoading={pubBusy}
                    disabled={!pubSourceId || !pubTitle.trim()}
                    leftIcon={<Icon as={Upload} size="sm" />}
                    onClick={() => void handlePublish()}
                  >
                    {t('marketplace.publish')}
                  </Button>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* ── Onglet 3 — Mes publications ── */}
          <TabsContent value="mine">
            {mineError && !mineLoading ? (
              <Card
                role="alert"
                aria-live="polite"
                className="p-4 mb-4 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
              >
                <span className="text-sm">{mineError}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadMine()}
                >
                  {t('action.retry')}
                </Button>
              </Card>
            ) : null}
            {mineLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            ) : mine.length === 0 ? (
              <EmptyState
                icon={<Icon as={PackageCheck} size={40} />}
                title={t('marketplace.empty')}
                description={t('marketplace.subtitle')}
                action={
                  <Button
                    variant="primary"
                    leftIcon={<Icon as={Upload} size="sm" />}
                    onClick={() => setTab('publish')}
                  >
                    {t('marketplace.publish')}
                  </Button>
                }
              />
            ) : (
              <div className="table-premium-container">
                <table className="table-premium">
                  <thead>
                    <tr>
                      <th>{t('marketplace.title')}</th>
                      <th>{t('marketplace.category.workflow')}</th>
                      <th>{t('marketplace.status.published')}</th>
                      <th>{t('marketplace.install')}</th>
                      <th>{t('marketplace.reviews')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((l) => (
                      <tr key={l.id}>
                        <td className="font-medium">{l.title}</td>
                        <td>
                          <Tag variant={KIND_TAG[l.kind]} size="sm">
                            {kindLabel(l.kind)}
                          </Tag>
                        </td>
                        <td>
                          <Tag
                            variant={
                              l.status === 'published' ? 'success' : 'neutral'
                            }
                            size="sm"
                            statusIcon
                          >
                            {statusLabel(l.status)}
                          </Tag>
                        </td>
                        <td className="tabular-nums">{l.install_count}</td>
                        <td>
                          {l.rating_count > 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                              <Stars
                                value={Math.round(l.rating_avg)}
                                size={13}
                              />
                              <span className="tabular-nums">
                                {l.rating_avg.toFixed(1)} ({l.rating_count})
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ── Onglet 4 — Packs & bundles ── */}
          <TabsContent value="packs">
            {packSlug ? (
              <PackBundleDetail
                mode="pack"
                id={packSlug}
                clientId={PACK_INSTALL_CLIENT_ID}
                onBack={() => setPackSlug(null)}
              />
            ) : (
              <>
                {packsError && !packsLoading ? (
                  <Card
                    role="alert"
                    aria-live="polite"
                    className="p-4 mb-4 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
                  >
                    <span className="text-sm">{packsError}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void loadPacks()}
                    >
                      {t('action.retry')}
                    </Button>
                  </Card>
                ) : null}
                {packsLoading ? (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Card key={i} className="p-5">
                        <Skeleton className="h-5 w-2/3 mb-3" />
                        <Skeleton className="h-3 w-1/3 mb-4" />
                        <Skeleton className="h-10 w-full rounded-md" />
                      </Card>
                    ))}
                  </div>
                ) : packs.length === 0 ? (
                  <EmptyState
                    icon={<Icon as={Boxes} size={40} />}
                    title={t('mktx.empty')}
                    description={t('mktx.subtitle')}
                  />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {packs.map((p) => (
                      <Card key={p.id} className="product-card-s4 p-5 flex flex-col gap-3 mk-card">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold leading-tight">{p.name}</span>
                          <Tag variant="info" size="sm">
                            {t('mktx.pack.tag')}
                          </Tag>
                        </div>
                        {p.industries ? (
                          <span className="text-xs text-muted">{p.industries}</span>
                        ) : null}
                        {p.description ? (
                          <p className="text-sm text-muted mk-clamp-2">{p.description}</p>
                        ) : null}
                        <div className="flex items-center justify-between gap-2 mt-auto pt-2">
                          <Tag variant="success" size="sm">
                            {t('marketplace.free')}
                          </Tag>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setPackSlug(p.slug)}
                          >
                            {t('action.view')}
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

// ── Vue Détail (rendue dans l'onglet Catalogue) ─────────────────────────────
function DetailView({
  listing,
  content,
  loading,
  error,
  onRetry,
  installed,
  installing,
  reviewRating,
  reviewComment,
  reviewBusy,
  onBack,
  onInstall,
  onReviewRating,
  onReviewComment,
  onSubmitReview,
}: {
  listing: MarketplaceListing | null;
  content: unknown;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  installed: boolean;
  installing: boolean;
  reviewRating: number;
  reviewComment: string;
  reviewBusy: boolean;
  onBack: () => void;
  onInstall: (l: MarketplaceListing) => void;
  onReviewRating: (v: number) => void;
  onReviewComment: (v: string) => void;
  onSubmitReview: () => void;
}) {
  const backBtn = (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={<Icon as={ArrowLeft} size="sm" />}
      onClick={onBack}
      aria-label={t('marketplace.title')}
    >
      {t('marketplace.title')}
    </Button>
  );

  if (error && !loading && !listing) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl">
        <div>{backBtn}</div>
        <Card
          role="alert"
          aria-live="polite"
          className="p-4 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
        >
          <span className="text-sm">{error}</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('action.retry')}
          </Button>
        </Card>
      </div>
    );
  }

  if (loading || !listing) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl" aria-busy={loading}>
        <div>{backBtn}</div>
        <Card className="p-6">
          <Skeleton className="h-6 w-1/2 mb-3" />
          <Skeleton className="h-3 w-1/3 mb-4" />
          <Skeleton className="h-20 w-full" />
        </Card>
      </div>
    );
  }

  const summary = structureSummary(content, listing.kind);
  const reviews: MarketplaceReview[] = listing.reviews ?? [];
  const kindIcon = listing.kind === 'funnel' ? GitBranch : WorkflowIcon;

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>{backBtn}</div>

      <Card className="p-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="t-h2">{listing.title}</h2>
              <Tag variant={KIND_TAG[listing.kind]} size="sm">
                {kindLabel(listing.kind)}
              </Tag>
            </div>
            {listing.category ? (
              <span className="text-sm text-muted">{listing.category}</span>
            ) : null}
            <RatingInline listing={listing} />
          </div>
          <Button
            variant={installed ? 'secondary' : 'primary'}
            isLoading={installing}
            disabled={installed}
            leftIcon={<Icon as={installed ? PackageCheck : Download} size="sm" />}
            onClick={() => onInstall(listing)}
          >
            {installed ? t('marketplace.installed') : t('marketplace.install')}
          </Button>
        </div>

        {listing.description ? (
          <p className="text-sm text-muted whitespace-pre-wrap">
            {listing.description}
          </p>
        ) : null}

        {/* Aperçu lisible de la structure (jamais le JSON brut). */}
        {summary ? (
          <div className="mk-structure">
            <Icon as={kindIcon} size="sm" className="text-muted" />
            <span className="text-sm">{summary}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-3 pt-1">
          <Tag variant="success" size="sm">
            {t('marketplace.free')}
          </Tag>
          <span className="inline-flex items-center gap-1 text-xs text-muted tabular-nums">
            <Icon as={Download} size={13} />
            {listing.install_count}
          </span>
          <span className="text-xs text-muted">{fmtDate(listing.created_at)}</span>
        </div>
      </Card>

      {/* Reviews + formulaire avis */}
      <Card className="p-6 flex flex-col gap-4">
        <h3 className="t-h3">{t('marketplace.reviews')}</h3>

        {reviews.length === 0 ? (
          <p className="text-sm text-muted">{t('marketplace.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {reviews.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 mk-review border-b last:border-b-0 pb-3 last:pb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <Stars value={r.rating} size={13} />
                  <span className="text-xs text-muted">
                    {fmtDate(r.created_at)}
                  </span>
                </div>
                {r.comment ? (
                  <p className="text-sm text-muted">{r.comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/* Laisser un avis */}
        <div className="flex flex-col gap-3 pt-2 border-t">
          <label className="prop-label">{t('marketplace.reviews')}</label>
          <Stars
            value={reviewRating}
            onChange={onReviewRating}
            size={22}
            ariaLabel={t('marketplace.reviews')}
          />
          <Textarea
            value={reviewComment}
            rows={2}
            onChange={(e) => onReviewComment(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              isLoading={reviewBusy}
              disabled={reviewRating < 1}
              onClick={onSubmitReview}
            >
              {t('action.save')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
