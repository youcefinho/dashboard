// ── FunnelBuilder — éditeur drag-drop de funnel (LOT FUNNEL, Sprint 1) ─────
//
// Manager-C Phase C. UX CALQUÉE sur src/pages/EmailBuilder.tsx :
//  - DndContext/SortableContext/useSortable/arrayMove           (EmailBuilder:8-10,349-358)
//  - SortableBlock + block-drag-handle                          (EmailBuilder:18-36)
//  - BlockProperties switch-par-type                            (EmailBuilder:41-157)
//  - iframe preview via compileBlocksToHtml (doc.write)         (EmailBuilder:198-203,383)
//  - addBlock/deleteBlock/handleDragEnd/duplicate               (EmailBuilder:207-222,394-399)
// Différence : colonne « Étapes » (funnel = liste ordonnée d'étapes, §6.A),
// chaque étape porte ses propres blocks ; save = saveFunnelPage par étape ;
// publish = publishFunnel. Helpers api FIGÉS Phase A. i18n t('funnel.*')/'fb.*'
// (clés figées Phase A — AUCUNE création).

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
} from 'lucide-react';
import {
  getFunnel,
  saveFunnelPage,
  publishFunnel,
  type Funnel,
  type FunnelStep,
  type FunnelBlock,
} from '@/lib/api';
import {
  BLOCK_PALETTE,
  createDefaultBlock,
  compileBlocksToHtml,
  type BlockType,
} from '@/worker/funnel-blocks';
import { t } from '@/lib/i18n';

// ── Block sortable item — CALQUE EmailBuilder:18-36 ─────────────────────────
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
        title={t('funnel.step.delete')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ── Propriétés du bloc — CALQUE EmailBuilder:41-157 (switch-par-type) ───────
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
        <option value="left">{t('email_builder.align_left')}</option>
        <option value="center">{t('email_builder.align_center')}</option>
        <option value="right">{t('email_builder.align_right')}</option>
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
          <label className="prop-label">{t('funnel_builder.prop.height')}</label>
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
export function FunnelBuilderPage() {
  const { funnelId } = useParams({ strict: false }) as { funnelId: string };
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [blocksByStep, setBlocksByStep] = useState<
    Record<string, FunnelBlock[]>
  >({});
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    if (!funnelId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const res = await getFunnel(funnelId);
    if (res.data) {
      setFunnel(res.data);
      const st = (res.data.steps || []).sort(
        (a, b) => a.position - b.position,
      );
      setSteps(st);
      const map: Record<string, FunnelBlock[]> = {};
      st.forEach((s) => {
        map[s.id] = (s.page?.blocks || []).map((bl) => ({
          ...bl,
          id: bl.id || crypto.randomUUID(),
        }));
      });
      setBlocksByStep(map);
      setActiveStepId(st[0]?.id ?? null);
    } else {
      toastError(res.error || t('funnel.error.not_found'));
    }
    setIsLoading(false);
  }, [funnelId, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const blocks = activeStepId ? blocksByStep[activeStepId] || [] : [];
  const setBlocks = (next: FunnelBlock[]) => {
    if (!activeStepId) return;
    setBlocksByStep((prev) => ({ ...prev, [activeStepId]: next }));
  };

  const compiledHtml = useMemo(
    () => compileBlocksToHtml(blocks, { title: funnel?.name }),
    [blocks, funnel?.name],
  );

  // CALQUE EmailBuilder:198-203 — render dans iframe via doc.write.
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

  const selectedBlock =
    blocks.find((b) => b.id === selectedBlockId) || null;

  // CALQUE EmailBuilder:207-211.
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

  const handleSave = async () => {
    if (!funnelId || !activeStepId) return;
    setIsSaving(true);
    const res = await saveFunnelPage(funnelId, activeStepId, {
      blocks,
      title: steps.find((s) => s.id === activeStepId)?.name,
    });
    setIsSaving(false);
    if (res.data) success(t('funnel.builder.saved'));
    else toastError(res.error || t('funnel.error.save'));
  };

  const handlePublish = async () => {
    if (!funnelId) return;
    const res = await publishFunnel(funnelId);
    if (res.data?.url) {
      success(t('funnel.publish.live'));
      void load();
    } else {
      toastError(res.error || t('funnel.error.publish'));
    }
  };

  const handleDeleteStep = async (id: string) => {
    if (steps.length <= 1) return;
    const ok = await confirm({
      title: t('funnel.step.delete'),
      danger: true,
    });
    if (!ok) return;
    const next = steps.filter((s) => s.id !== id);
    setSteps(next);
    setBlocksByStep((prev) => {
      const m = { ...prev };
      delete m[id];
      return m;
    });
    if (activeStepId === id) setActiveStepId(next[0]?.id ?? null);
  };

  return (
    <AppLayout title={t('funnel.builder.title')}>
      <DesktopOnlyBanner />
      <div className="hidden lg:block">
        <style>{builderStyles}</style>

        <div className="builder-topbar">
          <div className="builder-topbar-left">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ to: '/funnels' })}
            >
              <Icon as={ArrowLeft} size="md" /> {t('fb.back')}
            </Button>
            <div className="builder-meta">
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {funnel?.name || t('funnel.builder.title')}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {funnel ? t(`funnel.status.${funnel.status}`) : ''}
              </span>
            </div>
          </div>
          <div className="builder-topbar-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handlePublish()}
            >
              <Icon as={Send} size="sm" /> {t('funnel.publish.button')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSave()}
              disabled={isSaving}
            >
              <Icon as={Save} size="sm" />{' '}
              {isSaving ? '...' : t('funnel.builder.save')}
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
            {/* Colonne gauche : étapes + palette */}
            <div className="builder-palette">
              <h4 className="palette-title">{t('funnel.builder.steps')}</h4>
              {steps.map((s) => (
                <div
                  key={s.id}
                  className={`fb-step-item ${activeStepId === s.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveStepId(s.id);
                    setSelectedBlockId(null);
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {s.name || t(`funnel.step.${s.step_type}`)}
                  </span>
                  {steps.length > 1 && (
                    <button
                      className="block-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteStep(s.id);
                      }}
                      title={t('funnel.step.delete')}
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
                    title="Funnel preview"
                  />
                </div>
              </div>
            </div>

            {/* Droite : propriétés */}
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
                <div style={{ marginTop: 16, padding: '0 12px' }}>
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
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// Styles réutilisant les classes builder (calque EmailBuilder:409-509) +
// fb-step-item spécifique funnel.
const builderStyles = `
.builder-topbar { display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--border-subtle); background:var(--bg-surface); }
.builder-topbar-left { display:flex; align-items:center; gap:12px; }
.builder-meta { display:flex; flex-direction:column; gap:2px; }
.builder-topbar-actions { display:flex; align-items:center; gap:8px; }
.builder-layout { display:grid; grid-template-columns:220px 1fr 280px; height:calc(100vh - 180px); overflow:hidden; }
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
.prop-textarea { width:100%; padding:8px; border:1px solid var(--border-default); border-radius:6px; font-size:13px; font-family:monospace; background:var(--bg-canvas); color:var(--text-primary); resize:vertical; }
.email-block-item.list-item-enter { animation: fbItemEnter 240ms cubic-bezier(0.34,1.56,0.64,1) both; }
@keyframes fbItemEnter { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@media (prefers-reduced-motion: reduce) { .email-block-item.list-item-enter, .email-block-item { animation:none !important; transition:none !important; } }
`;
