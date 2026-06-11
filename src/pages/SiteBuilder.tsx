// ── SiteBuilder — éditeur de site multi-pages (LOT SITE BUILDER, Sprint 10) ──
//
// Manager-C Phase B (frontend) — fichier NOUVEAU (§6.G/§6.H), export
// `SiteBuilderPage`. CALQUE le pattern dnd-kit de src/pages/FunnelBuilder.tsx
// (les composants internes SortableBlock/BlockProperties NE SONT PAS exportés
// → on RECOPIE le pattern, on n'importe PAS — §6.G/§6.I.10). IMPORTÉ de
// @/worker/funnel-blocks : BLOCK_PALETTE / createDefaultBlock /
// compileBlocksToHtml / type BlockType. Helpers api FIGÉS Phase A :
// getSite/getSitePages/createSitePage/saveSitePage/deleteSitePage/updateSite/
// publishSite. i18n t('site.*') (clés figées Phase A — AUCUNE création ; on
// réutilise les clés génériques action.* / funnel.builder.* neutres pour le
// chrome non couvert par site.*).
//
// Multi-pages : sélecteur de pages (getSitePages) + ajout (createSitePage) +
// page d'accueil (is_home) + suppression (deleteSitePage). Blocs par page :
// palette + drag-sort + propriétés (calque FunnelBuilder). Navigation/menu :
// éditeur de SiteNavItem[] → nav_json via updateSite. SEO par page :
// seo_title / seo_description / seo_image (saveSitePage). Publier : publishSite.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DesktopOnlyBanner } from '@/components/DesktopOnlyBanner';
import {
  Button,
  Input,
  Select,
  Skeleton,
  useToast,
  useConfirm,
  Icon,
} from '@/components/ui';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  Save,
  Eye,
  GripVertical,
  Plus,
  Trash2,
  Copy,
  Send,
  Home,
} from 'lucide-react';
import {
  getSite,
  getSitePages,
  createSitePage,
  saveSitePage,
  deleteSitePage,
  updateSite,
  publishSite,
  type Site,
  type SitePage,
  type SiteNavItem,
  type FunnelBlock,
} from '@/lib/api';
import {
  BLOCK_PALETTE,
  createDefaultBlock,
  compileBlocksToHtml,
  type BlockType,
} from '@/worker/funnel-blocks';
import { t } from '@/lib/i18n';

// ── Block sortable item — CALQUE FunnelBuilder.tsx:66-107 (NON importable) ──
function SortableBlock({
  block,
  isSelected,
  onSelect,
  onDelete,
}: {
  block: FunnelBlock;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const meta = BLOCK_PALETTE.find((b) => b.type === block.type);

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`email-block-item list-item-enter ${isSelected ? 'selected' : ''}`}
    >
      <div className="block-drag-handle" {...attributes} {...listeners}>
        <Icon as={GripVertical} size="sm" />
      </div>
      <div className="block-label">
        <span>{meta ? t(meta.labelKey) : block.type}</span>
      </div>
      <button
        className="block-delete-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={t('action.delete')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ── Propriétés du bloc — CALQUE FunnelBuilder.tsx:110-340 (switch-par-type) ──
function BlockProperties({
  block,
  onChange,
}: {
  block: FunnelBlock | null;
  onChange: (updated: FunnelBlock) => void;
}) {
  if (!block)
    return (
      <div className="block-props-empty">{t('funnel.builder.properties')}</div>
    );

  const cfg = block.config as Record<string, unknown>;
  const set = (key: string, value: unknown) =>
    onChange({ ...block, config: { ...block.config, [key]: value } });

  const alignSelect = (
    <>
      <label className="prop-label">{t('funnel.prop.align')}</label>
      <Select
        size="sm"
        value={(cfg.align as string) || 'left'}
        onChange={(e) => set('align', e.target.value)}
      >
        <option value="left">Gauche</option>
        <option value="center">Centre</option>
        <option value="right">Droite</option>
      </Select>
    </>
  );

  return (
    <div className="block-props">
      <h4
        style={{
          margin: '0 0 12px',
          fontSize: '13px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: 'var(--text-secondary)',
        }}
      >
        {t('funnel.builder.properties')} —{' '}
        {t(BLOCK_PALETTE.find((b) => b.type === block.type)?.labelKey || '')}
      </h4>

      {block.type === 'hero' && (
        <>
          <label className="prop-label">{t('funnel.prop.headline')}</label>
          <Input
            value={(cfg.headline as string) || ''}
            onChange={(e) => set('headline', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.subheadline')}</label>
          <Input
            value={(cfg.subheadline as string) || ''}
            onChange={(e) => set('subheadline', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.background')}</label>
          <Input
            value={(cfg.backgroundColor as string) || ''}
            onChange={(e) => set('backgroundColor', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.color')}</label>
          <Input
            value={(cfg.textColor as string) || ''}
            onChange={(e) => set('textColor', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.image_url')}</label>
          <Input
            value={(cfg.backgroundImage as string) || ''}
            onChange={(e) => set('backgroundImage', e.target.value)}
            placeholder="https://..."
          />
          {alignSelect}
        </>
      )}

      {block.type === 'text' && (
        <>
          <label className="prop-label">{t('funnel.prop.text')}</label>
          <textarea
            className="prop-textarea"
            rows={5}
            value={(cfg.html as string) || ''}
            onChange={(e) => set('html', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.color')}</label>
          <Input
            value={(cfg.color as string) || ''}
            onChange={(e) => set('color', e.target.value)}
          />
          {alignSelect}
        </>
      )}

      {block.type === 'image' && (
        <>
          <label className="prop-label">{t('funnel.prop.image_url')}</label>
          <Input
            value={(cfg.src as string) || ''}
            onChange={(e) => set('src', e.target.value)}
            placeholder="https://..."
          />
          <label className="prop-label">Alt</label>
          <Input
            value={(cfg.alt as string) || ''}
            onChange={(e) => set('alt', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.button_url')}</label>
          <Input
            value={(cfg.link as string) || ''}
            onChange={(e) => set('link', e.target.value)}
            placeholder="https://..."
          />
          {alignSelect}
        </>
      )}

      {block.type === 'video' && (
        <>
          <label className="prop-label">{t('funnel.prop.video_url')}</label>
          <Input
            value={(cfg.url as string) || ''}
            onChange={(e) => set('url', e.target.value)}
            placeholder="YouTube / Vimeo / .mp4"
          />
          {alignSelect}
        </>
      )}

      {block.type === 'form' && (
        <>
          <label className="prop-label">{t('funnel.prop.submit_label')}</label>
          <Input
            value={(cfg.submitLabel as string) || ''}
            onChange={(e) => set('submitLabel', e.target.value)}
          />
          <label className="prop-label">
            {t('funnel.prop.success_message')}
          </label>
          <Input
            value={(cfg.successMessage as string) || ''}
            onChange={(e) => set('successMessage', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.redirect_url')}</label>
          <Input
            value={(cfg.redirectUrl as string) || ''}
            onChange={(e) => set('redirectUrl', e.target.value)}
            placeholder="https://... (optionnel)"
          />
          <p
            className="text-muted"
            style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}
          >
            {t('funnel.prop.field_label')} : nom · email · phone · message
            (mappés au CRM).
          </p>
        </>
      )}

      {block.type === 'button' && (
        <>
          <label className="prop-label">{t('funnel.prop.button_text')}</label>
          <Input
            value={(cfg.text as string) || ''}
            onChange={(e) => set('text', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.button_url')}</label>
          <Input
            value={(cfg.url as string) || ''}
            onChange={(e) => set('url', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.background')}</label>
          <Input
            value={(cfg.backgroundColor as string) || ''}
            onChange={(e) => set('backgroundColor', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.color')}</label>
          <Input
            value={(cfg.color as string) || ''}
            onChange={(e) => set('color', e.target.value)}
          />
          {alignSelect}
        </>
      )}

      {block.type === 'cta' && (
        <>
          <label className="prop-label">{t('funnel.prop.headline')}</label>
          <Input
            value={(cfg.headline as string) || ''}
            onChange={(e) => set('headline', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.text')}</label>
          <Input
            value={(cfg.text as string) || ''}
            onChange={(e) => set('text', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.button_text')}</label>
          <Input
            value={(cfg.buttonText as string) || ''}
            onChange={(e) => set('buttonText', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.button_url')}</label>
          <Input
            value={(cfg.buttonUrl as string) || ''}
            onChange={(e) => set('buttonUrl', e.target.value)}
          />
          <label className="prop-label">{t('funnel.prop.background')}</label>
          <Input
            value={(cfg.backgroundColor as string) || ''}
            onChange={(e) => set('backgroundColor', e.target.value)}
          />
          {alignSelect}
        </>
      )}

      {block.type === 'spacer' && (
        <>
          <label className="prop-label">Hauteur</label>
          <Input
            value={(cfg.height as string) || '40px'}
            onChange={(e) => set('height', e.target.value)}
          />
        </>
      )}
    </div>
  );
}

// ── Page principale ─────────────────────────────────────────────────────────
export function SiteBuilderPage() {
  const { siteId } = useParams({ strict: false }) as { siteId: string };
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [site, setSite] = useState<Site | null>(null);
  const [pages, setPages] = useState<SitePage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [blocksByPage, setBlocksByPage] = useState<
    Record<string, FunnelBlock[]>
  >({});
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [nav, setNav] = useState<SiteNavItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [popupEnabled, setPopupEnabled] = useState(false);
  const [popupTitle, setPopupTitle] = useState('');
  const [popupDesc, setPopupDesc] = useState('');
  const [popupExitIntent, setPopupExitIntent] = useState(true);
  const [popupDelay, setPopupDelay] = useState(5);
  const [popupFormId, setPopupFormId] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    if (!siteId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const [siteRes, pagesRes] = await Promise.all([
      getSite(siteId),
      getSitePages(siteId),
    ]);
    if (siteRes.data) {
      setSite(siteRes.data);
      try {
        const parsed = siteRes.data.nav_json
          ? (JSON.parse(siteRes.data.nav_json) as SiteNavItem[])
          : [];
        setNav(Array.isArray(parsed) ? parsed : []);
      } catch {
        setNav([]);
      }
      try {
        const theme = siteRes.data.theme_json ? JSON.parse(siteRes.data.theme_json) : {};
        const pConf = theme.popup || {};
        setPopupEnabled(!!pConf.enabled);
        setPopupTitle(pConf.title || '');
        setPopupDesc(pConf.description || '');
        setPopupExitIntent(pConf.exit_intent !== false);
        setPopupDelay(pConf.delay || 5);
        setPopupFormId(pConf.form_id || '');
      } catch { /* ignore */ }
    } else {
      toastError(siteRes.error || t('site.error.save'));
    }
    const pgs = (pagesRes.data || []).sort((a, b) => a.position - b.position);
    setPages(pgs);
    const map: Record<string, FunnelBlock[]> = {};
    pgs.forEach((p) => {
      map[p.id] = (p.blocks || []).map((bl) => ({
        ...bl,
        id: bl.id || crypto.randomUUID(),
      }));
    });
    setBlocksByPage(map);
    setActivePageId((prev) =>
      prev && pgs.some((p) => p.id === prev) ? prev : pgs[0]?.id ?? null,
    );
    setIsLoading(false);
  }, [siteId, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const activePage = pages.find((p) => p.id === activePageId) || null;
  const blocks = activePageId ? blocksByPage[activePageId] || [] : [];
  const setBlocks = (next: FunnelBlock[]) => {
    if (!activePageId) return;
    setBlocksByPage((prev) => ({ ...prev, [activePageId]: next }));
  };

  const compiledHtml = useMemo(
    () => compileBlocksToHtml(blocks, { title: activePage?.title || site?.name }),
    [blocks, activePage?.title, site?.name],
  );

  // CALQUE FunnelBuilder.tsx:404-413 — render dans iframe via doc.write.
  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(compiledHtml);
        doc.close();
      }
    }
  }, [compiledHtml]);

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;

  // CALQUE FunnelBuilder.tsx:419-429.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlocks(
      arrayMove(
        blocks,
        blocks.findIndex((b) => b.id === active.id),
        blocks.findIndex((b) => b.id === over.id),
      ),
    );
  };

  const addBlock = (type: BlockType) => {
    const nb = createDefaultBlock(type) as FunnelBlock;
    setBlocks([...blocks, nb]);
    setSelectedBlockId(nb.id);
  };

  const deleteBlock = (id: string) => {
    setBlocks(blocks.filter((b) => b.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
  };

  // ── Pages ────────────────────────────────────────────────────────────────
  const handleAddPage = async () => {
    if (!siteId) return;
    const slug = `page-${pages.length + 1}`;
    const res = await createSitePage(siteId, {
      slug,
      title: t('site.builder.add_page'),
      position: pages.length,
      is_home: pages.length === 0 ? 1 : 0,
      in_nav: 1,
      blocks: [],
    });
    if (res.data?.id) {
      setActivePageId(res.data.id);
      await load();
    } else {
      toastError(res.error || t('site.error.save'));
    }
  };

  const handleDeletePage = async (id: string) => {
    if (!siteId || pages.length <= 1) return;
    const ok = await confirm({ title: t('site.page.delete'), danger: true });
    if (!ok) return;
    const res = await deleteSitePage(siteId, id);
    if (res.data) {
      const next = pages.filter((p) => p.id !== id);
      setPages(next);
      setBlocksByPage((prev) => {
        const m = { ...prev };
        delete m[id];
        return m;
      });
      if (activePageId === id) setActivePageId(next[0]?.id ?? null);
      success(t('site.builder.saved'));
    } else {
      toastError(res.error || t('site.error.save'));
    }
  };

  const updateActivePage = (patch: Partial<SitePage>) => {
    if (!activePageId) return;
    setPages((prev) =>
      prev.map((p) => (p.id === activePageId ? { ...p, ...patch } : p)),
    );
  };

  const setHomePage = (id: string) => {
    setPages((prev) =>
      prev.map((p) => ({ ...p, is_home: p.id === id ? 1 : 0 })),
    );
  };

  // ── Navigation / menu ──────────────────────────────────────────────────────
  const addNavItem = () => {
    setNav((prev) => [
      ...prev,
      { label: '', page_slug: activePage?.slug ?? pages[0]?.slug ?? '', url: '' },
    ]);
  };

  const updateNavItem = (idx: number, patch: Partial<SiteNavItem>) => {
    setNav((prev) => prev.map((n, i) => (i === idx ? { ...n, ...patch } : n)));
  };

  const removeNavItem = (idx: number) => {
    setNav((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Save : page active (blocs + SEO + meta) PUIS site (nav_json) ───────────
  const handleSave = async () => {
    if (!siteId || !activePageId) return;
    setIsSaving(true);
    const p = pages.find((x) => x.id === activePageId);
    const pageRes = await saveSitePage(siteId, activePageId, {
      blocks,
      title: p?.title || undefined,
      slug: p?.slug || undefined,
      seo_title: p?.seo_title || undefined,
      seo_description: p?.seo_description || undefined,
      seo_image: p?.seo_image || undefined,
      position: p?.position,
      is_home: p?.is_home,
      in_nav: p?.in_nav,
    });
    // nav_json sérialisé via updateSite (SiteNavItem[], §6.B).
    const currentTheme = site?.theme_json ? JSON.parse(site.theme_json) : {};
    const updatedTheme = {
      ...currentTheme,
      popup: {
        enabled: popupEnabled,
        title: popupTitle,
        description: popupDesc,
        exit_intent: popupExitIntent,
        delay: popupDelay,
        form_id: popupFormId,
      }
    };
    const siteRes = await updateSite(siteId, {
      theme_json: JSON.stringify(updatedTheme),
      nav_json: JSON.stringify(
        nav
          .filter((n) => n.label.trim())
          .map((n) => ({
            label: n.label.trim(),
            page_slug: n.page_slug || null,
            url: n.page_slug ? null : n.url || null,
          })),
      ),
    });
    setIsSaving(false);
    if (pageRes.data && siteRes.data) {
      success(t('site.builder.saved'));
      // Mettre à jour l'état local du site avec le nouveau theme_json
      setSite(prev => prev ? { ...prev, theme_json: JSON.stringify(updatedTheme) } : null);
    } else {
      toastError(pageRes.error || siteRes.error || t('site.error.save'));
    }
  };

  const handlePublish = async () => {
    if (!siteId) return;
    const res = await publishSite(siteId);
    if (res.data?.url) {
      success(t('site.publish.button'));
      void load();
    } else {
      toastError(res.error || t('site.error.publish'));
    }
  };

  return (
    <AppLayout title={t('site.builder.title')}>
      <DesktopOnlyBanner />
      <div className="hidden lg:block animate-stagger">
        <style>{builderStyles}</style>

        <div className="builder-topbar">
          <div className="builder-topbar-left">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ to: '/sites' })}
            >
              <Icon as={ArrowLeft} size="md" /> {t('action.back')}
            </Button>
            <div className="builder-meta">
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {site?.name || t('site.builder.title')}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {site ? t(`site.status.${site.status}`) : ''}
              </span>
            </div>
          </div>
          <div className="builder-topbar-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handlePublish()}
            >
              <Icon as={Send} size="sm" /> {t('site.publish.button')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSave()}
              disabled={isSaving}
            >
              <Icon as={Save} size="sm" />{' '}
              {isSaving ? '...' : t('site.builder.save')}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="builder-layout">
            <div className="builder-palette">
              <Skeleton className="h-3 w-12 mb-3 ml-1" />
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-9 w-full rounded-md mb-1.5"
                  style={{ animationDelay: `${i * 40}ms` }}
                />
              ))}
            </div>
            <div className="builder-canvas-container">
              <Skeleton className="h-full w-full rounded-md" />
            </div>
            <div className="builder-properties">
              <Skeleton className="h-3 w-32 mb-3" />
            </div>
          </div>
        ) : (
          <div className="builder-layout">
            {/* Colonne gauche : pages + palette */}
            <div className="builder-palette">
              <div className="flex items-center justify-between mb-1 pr-1">
                <h4 className="palette-title">{t('site.builder.pages')}</h4>
                <button
                  className="block-delete-btn"
                  style={{ opacity: 1 }}
                  onClick={() => void handleAddPage()}
                  title={t('site.builder.add_page')}
                >
                  <Plus size={15} />
                </button>
              </div>
              {pages.map((p) => (
                <div
                  key={p.id}
                  className={`fb-step-item ${activePageId === p.id ? 'active' : ''}`}
                  onClick={() => {
                    setActivePageId(p.id);
                    setSelectedBlockId(null);
                  }}
                >
                  {p.is_home ? (
                    <Icon as={Home} size="sm" />
                  ) : null}
                  <span style={{ flex: 1 }}>{p.title || p.slug}</span>
                  {pages.length > 1 && (
                    <button
                      className="block-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeletePage(p.id);
                      }}
                      title={t('site.page.delete')}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}

              <h4 className="palette-title" style={{ marginTop: 16 }}>
                {t('funnel.builder.palette')}
              </h4>
              {BLOCK_PALETTE.map((bp) => (
                <button
                  key={bp.type}
                  className="action-chip"
                  onClick={() => addBlock(bp.type)}
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    marginBottom: 6,
                  }}
                >
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    {t(bp.labelKey)}
                  </span>
                  <Icon as={Plus} size="sm" className="palette-add" />
                </button>
              ))}
            </div>

            {/* Centre : canvas blocs + preview */}
            <div className="builder-canvas-container">
              <div className="builder-canvas-blocks">
                <DndContext
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={blocks.map((b) => b.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {blocks.length === 0 ? (
                      <div className="canvas-empty">
                        <Icon as={Eye} size={32} style={{ opacity: 0.3 }} />
                        <p>{t('funnel.builder.empty_canvas')}</p>
                      </div>
                    ) : (
                      blocks.map((block) => (
                        <SortableBlock
                          key={block.id}
                          block={block}
                          isSelected={selectedBlockId === block.id}
                          onSelect={() => setSelectedBlockId(block.id)}
                          onDelete={() => deleteBlock(block.id)}
                        />
                      ))
                    )}
                  </SortableContext>
                </DndContext>
              </div>
              <div className="builder-preview">
                <div className="preview-label">
                  <Icon as={Eye} size="sm" /> {t('funnel.builder.preview')}
                </div>
                <div className="preview-frame-wrapper desktop">
                  <iframe
                    ref={iframeRef}
                    className="preview-iframe"
                    sandbox="allow-same-origin"
                    title="Site preview"
                  />
                </div>
              </div>
            </div>

            {/* Droite : propriétés du bloc + page (SEO) + navigation */}
            <div className="builder-properties">
              <BlockProperties
                block={selectedBlock}
                onChange={(updated) =>
                  setBlocks(
                    blocks.map((b) => (b.id === updated.id ? updated : b)),
                  )
                }
              />
              {selectedBlock && (
                <div style={{ marginTop: 12, padding: '0 12px' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const dup: FunnelBlock = {
                        ...selectedBlock,
                        id: crypto.randomUUID(),
                        config: { ...selectedBlock.config },
                      };
                      const next = [...blocks];
                      next.splice(
                        blocks.findIndex((b) => b.id === selectedBlock.id) + 1,
                        0,
                        dup,
                      );
                      setBlocks(next);
                      setSelectedBlockId(dup.id);
                    }}
                  >
                    <Icon as={Copy} size="sm" /> {t('fb.props.duplicate')}
                  </Button>
                </div>
              )}

              {/* ── Réglages de la page active (slug + SEO) ── */}
              {activePage && (
                <div className="site-section">
                  <h4 className="palette-title">{t('site.builder.pages')}</h4>
                  <label className="prop-label">{t('site.page.slug')}</label>
                  <Input
                    size="sm"
                    value={activePage.slug}
                    onChange={(e) =>
                      updateActivePage({ slug: e.target.value })
                    }
                  />
                  <label className="prop-label">SEO — title</label>
                  <Input
                    size="sm"
                    value={activePage.seo_title || ''}
                    onChange={(e) =>
                      updateActivePage({ seo_title: e.target.value })
                    }
                  />
                  <label className="prop-label">SEO — description</label>
                  <textarea
                    className="prop-textarea"
                    rows={3}
                    value={activePage.seo_description || ''}
                    onChange={(e) =>
                      updateActivePage({ seo_description: e.target.value })
                    }
                  />
                  <label className="prop-label">SEO — image (URL)</label>
                  <Input
                    size="sm"
                    value={activePage.seo_image || ''}
                    onChange={(e) =>
                      updateActivePage({ seo_image: e.target.value })
                    }
                    placeholder="https://..."
                  />
                  <label className="site-check">
                    <input
                      type="checkbox"
                      checked={!!activePage.is_home}
                      onChange={() => setHomePage(activePage.id)}
                    />
                    {t('site.builder.home_page')}
                  </label>
                  <label className="site-check">
                    <input
                      type="checkbox"
                      checked={!!activePage.in_nav}
                      onChange={(e) =>
                        updateActivePage({ in_nav: e.target.checked ? 1 : 0 })
                      }
                    />
                    {t('site.builder.in_nav')}
                  </label>
                </div>
              )}

              {/* ── Navigation / menu du site (nav_json) ── */}
              <div className="site-section">
                <div className="flex items-center justify-between pr-1">
                  <h4 className="palette-title">
                    {t('site.builder.navigation')}
                  </h4>
                  <button
                    className="block-delete-btn"
                    style={{ opacity: 1 }}
                    onClick={addNavItem}
                    title={t('site.builder.add_nav_item')}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {nav.length === 0 ? (
                  <p
                    className="text-muted"
                    style={{ fontSize: 12, padding: '4px 2px' }}
                  >
                    {t('site.builder.add_nav_item')}
                  </p>
                ) : (
                  nav.map((item, idx) => (
                    <div key={idx} className="site-nav-row">
                      <Input
                        size="sm"
                        value={item.label}
                        placeholder={t('site.builder.navigation')}
                        onChange={(e) =>
                          updateNavItem(idx, { label: e.target.value })
                        }
                      />
                      <Select
                        size="sm"
                        value={item.page_slug || ''}
                        onChange={(e) =>
                          updateNavItem(idx, {
                            page_slug: e.target.value || null,
                            url: e.target.value ? null : item.url,
                          })
                        }
                      >
                        <option value="">—</option>
                        {pages.map((p) => (
                          <option key={p.id} value={p.slug}>
                            {p.title || p.slug}
                          </option>
                        ))}
                      </Select>
                      {!item.page_slug && (
                        <Input
                          size="sm"
                          value={item.url || ''}
                          placeholder="https://..."
                          onChange={(e) =>
                            updateNavItem(idx, { url: e.target.value })
                          }
                        />
                      )}
                      <button
                        className="block-delete-btn"
                        style={{ opacity: 1 }}
                        onClick={() => removeNavItem(idx)}
                        title={t('action.delete')}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* ── Popups & Exit-Intent ── */}
              <div className="site-section">
                <h4 className="palette-title">Popups & Exit-Intent</h4>
                <label className="site-check" style={{ fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={popupEnabled}
                    onChange={(e) => setPopupEnabled(e.target.checked)}
                  />
                  Activer le popup d'opt-in
                </label>
                
                {popupEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                    <label className="prop-label">Titre du popup</label>
                    <Input
                      size="sm"
                      value={popupTitle}
                      onChange={(e) => setPopupTitle(e.target.value)}
                      placeholder="Ex: Offre exclusive !"
                    />
                    
                    <label className="prop-label">Description</label>
                    <textarea
                      className="prop-textarea"
                      rows={2}
                      value={popupDesc}
                      onChange={(e) => setPopupDesc(e.target.value)}
                      placeholder="Ex: Laissez vos coordonnées pour..."
                    />

                    <label className="site-check">
                      <input
                        type="checkbox"
                        checked={popupExitIntent}
                        onChange={(e) => setPopupExitIntent(e.target.checked)}
                      />
                      Déclenchement sur Exit-Intent
                    </label>

                    {!popupExitIntent && (
                      <>
                        <label className="prop-label">Délai (secondes)</label>
                        <Input
                          size="sm"
                          type="number"
                          min={1}
                          value={popupDelay}
                          onChange={(e) => setPopupDelay(Number(e.target.value) || 5)}
                        />
                      </>
                    )}

                    <label className="prop-label">ID Formulaire CRM</label>
                    <Input
                      size="sm"
                      value={popupFormId}
                      onChange={(e) => setPopupFormId(e.target.value)}
                      placeholder="Identifiant du formulaire (ex: field_...)"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// Styles réutilisant les classes builder (CALQUE FunnelBuilder.tsx:689-723) +
// site-section / site-nav-row / site-check spécifiques au site builder. AUCUN
// CSS global (scopé via <style> local, comme FunnelBuilder).
const builderStyles = `
.builder-topbar { display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--border-subtle); background:var(--bg-surface); }
.builder-topbar-left { display:flex; align-items:center; gap:12px; }
.builder-meta { display:flex; flex-direction:column; gap:2px; }
.builder-topbar-actions { display:flex; align-items:center; gap:8px; }
.builder-layout { display:grid; grid-template-columns:220px 1fr 300px; height:calc(100vh - 180px); overflow:hidden; }
.builder-palette { border-right:1px solid var(--border-default); padding:12px 8px; overflow-y:auto; background:var(--bg-surface); }
.palette-title { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin:0 0 8px 4px; font-weight:600; }
.palette-add { margin-left:auto; opacity:0; transition:opacity 0.15s; }
.action-chip:hover .palette-add { opacity:0.5; }
.fb-step-item { display:flex; align-items:center; gap:6px; padding:8px 10px; border:1px solid transparent; border-radius:8px; cursor:pointer; font-size:13px; color:var(--text-primary); margin-bottom:4px; transition:all 0.15s; }
.fb-step-item:hover { background:var(--bg-hover); }
.fb-step-item.active { background:rgba(0,157,219,0.08); border-color:rgba(0,157,219,0.30); font-weight:600; }
.builder-canvas-container { display:flex; flex-direction:column; overflow:hidden; }
.builder-canvas-blocks { flex:1; padding:16px; overflow-y:auto; background:var(--bg-canvas); }
.canvas-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px; color:var(--text-muted); gap:8px; }
.email-block-item { position:relative; display:flex; align-items:center; gap:8px; padding:10px 12px; border:1px solid transparent; border-radius:10px; background:var(--bg-surface); margin-bottom:4px; cursor:pointer; transition:all 200ms cubic-bezier(0.4,0,0.2,1); }
.email-block-item:hover { border-color:rgba(0,157,219,0.30); }
.email-block-item.selected { border-color:rgba(0,157,219,0.45); background:rgba(0,157,219,0.06); }
.block-drag-handle { cursor:grab; color:var(--text-muted); }
.block-label { display:flex; align-items:center; gap:6px; flex:1; font-size:13px; }
.block-delete-btn { border:none; background:transparent; cursor:pointer; color:var(--text-muted); opacity:0; transition:opacity 0.15s; }
.email-block-item:hover .block-delete-btn, .fb-step-item:hover .block-delete-btn { opacity:1; }
.builder-preview { border-top:1px solid var(--border-default); background:var(--bg-canvas); height:340px; overflow:hidden; display:flex; flex-direction:column; }
.preview-label { display:flex; align-items:center; gap:6px; padding:8px 16px; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); border-bottom:1px solid var(--border-default); }
.preview-frame-wrapper { flex:1; overflow:auto; display:flex; justify-content:center; padding:8px; }
.preview-iframe { width:100%; height:100%; border:none; border-radius:4px; background:white; }
.builder-properties { border-left:1px solid var(--border-default); padding:12px; overflow-y:auto; background:var(--bg-surface); }
.block-props-empty { padding:20px 12px; color:var(--text-muted); font-size:13px; text-align:center; }
.prop-label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin:10px 0 4px; font-weight:600; }
.prop-textarea { width:100%; padding:8px; border:1px solid var(--border-default); border-radius:6px; font-size:13px; font-family:inherit; background:var(--bg-canvas); color:var(--text-primary); resize:vertical; }
.site-section { margin-top:18px; padding-top:14px; border-top:1px solid var(--border-default); }
.site-check { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-primary); margin-top:10px; cursor:pointer; }
.site-nav-row { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
.site-nav-row > * { min-width:0; }
.email-block-item.list-item-enter { animation: fbItemEnter 240ms cubic-bezier(0.34,1.56,0.64,1) both; }
@keyframes fbItemEnter { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@media (prefers-reduced-motion: reduce) { .email-block-item.list-item-enter, .email-block-item { animation:none !important; transition:none !important; } }
`;
