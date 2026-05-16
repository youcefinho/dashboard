// ── EmailBuilder — Éditeur email block-based — Intralys CRM ──

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DesktopOnlyBanner } from '@/components/DesktopOnlyBanner';
import { Button, Input, Select, Textarea, ColorSwatch, Skeleton, useToast, usePrompt, Icon } from '@/components/ui';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getTemplate, updateTemplate, saveTemplateBlocks, sendTestEmail } from '@/lib/api';
import { BLOCK_PALETTE, createDefaultBlock, compileBlocksToHtml, type EmailBlock, type BlockType } from '@/worker/email-blocks';
import { ArrowLeft, Save, Send, Eye, Code, Smartphone, Monitor, GripVertical, Plus, Trash2, Copy } from 'lucide-react';

type PreviewMode = 'desktop' | 'mobile' | 'source';

// ── Block sortable item ─────────────────────────────────────
function SortableBlock({ block, isSelected, onSelect, onDelete }: {
  block: EmailBlock; isSelected: boolean; onSelect: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const blockLabel = BLOCK_PALETTE.find(b => b.type === block.type);

  return (
    <div ref={setNodeRef} style={style} onClick={onSelect} className={`email-block-item list-item-enter ${isSelected ? 'selected' : ''}`}>
      <div className="block-drag-handle" {...attributes} {...listeners}><Icon as={GripVertical} size="sm" /></div>
      <div className="block-label">
        <span className="block-icon">{blockLabel?.icon || '📦'}</span>
        <span>{blockLabel?.label || block.type}</span>
      </div>
      <button className="block-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Supprimer"><Trash2 size={14} /></button>
    </div>
  );
}

// ── Sidebar : propriétés du block sélectionné ────────────────
const BRAND_PRESETS = ['#009DDB', '#0086C0', '#D96E27', '#FF9A00', '#37CA37', '#E93D3D', '#1a1a2e', '#374151', '#9ca3af', '#FFFFFF'];

function BlockProperties({ block, onChange }: { block: EmailBlock | null; onChange: (updated: EmailBlock) => void }) {
  if (!block) return <div className="block-props-empty">Sélectionnez un block pour modifier ses propriétés</div>;

  const updateConfig = (key: string, value: unknown) => {
    onChange({ ...block, config: { ...block.config, [key]: value } });
  };

  return (
    <div className="block-props">
      <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--text-secondary)' }}>
        Propriétés — {BLOCK_PALETTE.find(b => b.type === block.type)?.label}
      </h4>

      {block.type === 'header' && (
        <>
          <label className="prop-label">Texte</label>
          <Input value={(block.config.text as string) || ''} onChange={e => updateConfig('text', e.target.value)} />
          <label className="prop-label">Niveau</label>
          <Select size="sm" value={(block.config.level as number) || 2} onChange={e => updateConfig('level', Number(e.target.value))}>
            <option value={1}>H1 — Grand</option><option value={2}>H2 — Moyen</option><option value={3}>H3 — Petit</option>
          </Select>
          <label className="prop-label">Couleur texte</label>
          <ColorSwatch size="sm" value={(block.config.color as string) || '#1a1a2e'} onChange={v => updateConfig('color', v)} presets={BRAND_PRESETS} />
          <label className="prop-label">Fond</label>
          <ColorSwatch size="sm" value={(block.config.backgroundColor as string) || '#FFFFFF'} onChange={v => updateConfig('backgroundColor', v)} presets={BRAND_PRESETS} />
          <label className="prop-label">Alignement</label>
          <Select size="sm" value={(block.config.align as string) || 'left'} onChange={e => updateConfig('align', e.target.value)}>
            <option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option>
          </Select>
        </>
      )}

      {block.type === 'text' && (
        <>
          <label className="prop-label">Contenu HTML</label>
          <Textarea rows={6} className="font-mono text-xs" value={(block.config.html as string) || ''} onChange={e => updateConfig('html', e.target.value)} />
          <label className="prop-label">Couleur</label>
          <ColorSwatch size="sm" value={(block.config.color as string) || '#374151'} onChange={v => updateConfig('color', v)} presets={BRAND_PRESETS} />
          <label className="prop-label">Taille police</label>
          <Input value={(block.config.fontSize as string) || '15px'} onChange={e => updateConfig('fontSize', e.target.value)} />
        </>
      )}

      {block.type === 'image' && (
        <>
          <label className="prop-label">URL image</label>
          <Input value={(block.config.src as string) || ''} onChange={e => updateConfig('src', e.target.value)} placeholder="https://..." />
          <label className="prop-label">Texte alt</label>
          <Input value={(block.config.alt as string) || ''} onChange={e => updateConfig('alt', e.target.value)} />
          <label className="prop-label">Lien (optionnel)</label>
          <Input value={(block.config.link as string) || ''} onChange={e => updateConfig('link', e.target.value)} placeholder="https://..." />
        </>
      )}

      {block.type === 'button' && (
        <>
          <label className="prop-label">Texte</label>
          <Input value={(block.config.text as string) || ''} onChange={e => updateConfig('text', e.target.value)} />
          <label className="prop-label">URL</label>
          <Input value={(block.config.url as string) || '#'} onChange={e => updateConfig('url', e.target.value)} />
          <label className="prop-label">Couleur fond</label>
          <ColorSwatch size="sm" value={(block.config.backgroundColor as string) || '#009DDB'} onChange={v => updateConfig('backgroundColor', v)} presets={BRAND_PRESETS} />
          <label className="prop-label">Couleur texte</label>
          <ColorSwatch size="sm" value={(block.config.color as string) || '#FFFFFF'} onChange={v => updateConfig('color', v)} presets={BRAND_PRESETS} />
        </>
      )}

      {block.type === 'divider' && (
        <>
          <label className="prop-label">Couleur</label>
          <ColorSwatch size="sm" value={(block.config.color as string) || '#e5e7eb'} onChange={v => updateConfig('color', v)} presets={BRAND_PRESETS} />
        </>
      )}

      {block.type === 'spacer' && (
        <>
          <label className="prop-label">Hauteur</label>
          <Input value={(block.config.height as string) || '20px'} onChange={e => updateConfig('height', e.target.value)} />
        </>
      )}

      {block.type === 'footer' && (
        <>
          <label className="prop-label">Contenu HTML</label>
          <Textarea rows={4} className="font-mono text-xs" value={(block.config.html as string) || ''} onChange={e => updateConfig('html', e.target.value)} />
          <label className="prop-label">Couleur</label>
          <ColorSwatch size="sm" value={(block.config.color as string) || '#9ca3af'} onChange={v => updateConfig('color', v)} presets={BRAND_PRESETS} />
        </>
      )}

      {block.type === 'columns' && (
        <>
          <label className="prop-label">Colonne 1 (HTML)</label>
          <Textarea rows={3} className="font-mono text-xs"
            value={((block.config.columns as Array<{html: string}>)?.[0]?.html) || ''}
            onChange={e => {
              const cols = [...((block.config.columns as Array<{html: string; width: string}>) || [])];
              if (cols[0]) cols[0] = { ...cols[0], html: e.target.value };
              else cols[0] = { html: e.target.value, width: '50%' };
              updateConfig('columns', cols);
            }}
          />
          <label className="prop-label">Colonne 2 (HTML)</label>
          <Textarea rows={3} className="font-mono text-xs"
            value={((block.config.columns as Array<{html: string}>)?.[1]?.html) || ''}
            onChange={e => {
              const cols = [...((block.config.columns as Array<{html: string; width: string}>) || [])];
              if (cols[1]) cols[1] = { ...cols[1], html: e.target.value };
              else cols[1] = { html: e.target.value, width: '50%' };
              updateConfig('columns', cols);
            }}
          />
        </>
      )}
    </div>
  );
}

// ── Page principale ─────────────────────────────────────────

export function EmailBuilderPage() {
  const { templateId } = useParams({ strict: false }) as { templateId: string };
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const prompt = usePrompt();
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
  const [templateName, setTemplateName] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadTemplate = useCallback(async () => {
    if (!templateId) { setIsLoading(false); return; }
    setIsLoading(true);
    const result = await getTemplate(templateId);
    if (result.data) {
      setTemplateName(result.data.name || '');
      setTemplateSubject(result.data.subject || '');
      // preheader et blocks_json sont dynamiques, on cast
      const d = result.data as unknown as Record<string, unknown>;
      setPreheader((d.preheader as string) || '');
      if (d.blocks_json) {
        try { setBlocks(JSON.parse(d.blocks_json as string)); } catch { /* ignore */ }
      }
    }
    setIsLoading(false);
  }, [templateId]);

  useEffect(() => { void loadTemplate(); }, [loadTemplate]);

  const compiledHtml = compileBlocksToHtml(blocks, preheader);

  useEffect(() => {
    if (iframeRef.current && previewMode !== 'source') {
      const doc = iframeRef.current.contentDocument;
      if (doc) { doc.open(); doc.write(compiledHtml); doc.close(); }
    }
  }, [compiledHtml, previewMode]);

  const selectedBlock = blocks.find(b => b.id === selectedBlockId) || null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlocks(arrayMove(blocks, blocks.findIndex(b => b.id === active.id), blocks.findIndex(b => b.id === over.id)));
  };

  const addBlock = (type: BlockType) => {
    const newBlock = createDefaultBlock(type);
    setBlocks(prev => [...prev, newBlock]);
    setSelectedBlockId(newBlock.id);
  };

  const deleteBlock = (id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    await updateTemplate(templateId, { name: templateName, subject: templateSubject });
    const result = await saveTemplateBlocks(templateId, blocks, preheader);
    setIsSaving(false);
    if (result.data) success('Modèle enregistré');
    else toastError('L\'enregistrement a échoué. Réessaie.');
  };

  const handleSendTest = async () => {
    const email = await prompt({
      title: 'Envoyer un email test',
      description: 'À quelle adresse envoyer la version test de ce template ?',
      placeholder: 'toi@exemple.com',
      confirmLabel: 'Envoyer',
    });
    if (!email) return;
    setIsSending(true);
    const res = await sendTestEmail(templateId, email);
    setIsSending(false);
    if (res.error) toastError(`Échec de l'envoi: ${res.error}`);
    else success(`Email test envoyé à ${email}`);
  };

  return (
    <AppLayout title="Email Builder">
      <DesktopOnlyBanner />
      <div className="hidden lg:block">
      <style>{emailBuilderStyles}</style>

      <div className="builder-topbar">
        <div className="builder-topbar-left">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/templates' })}>
            <Icon as={ArrowLeft} size="md" /> Retour
          </Button>
          <div className="builder-meta">
            <Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Nom du template"
              style={{ fontWeight: 600, fontSize: '15px', background: 'transparent', border: 'none', padding: 0 }} />
            <Input value={templateSubject} onChange={e => setTemplateSubject(e.target.value)} placeholder="Sujet de l'email"
              style={{ fontSize: '13px', color: 'var(--text-secondary)', background: 'transparent', border: 'none', padding: 0 }} />
          </div>
        </div>
        <div className="builder-topbar-actions">
          <div className="preview-toggle">
            <button className={previewMode === 'desktop' ? 'active' : ''} onClick={() => setPreviewMode('desktop')} aria-label="Preview desktop"><Icon as={Monitor} size="md" /></button>
            <button className={previewMode === 'mobile' ? 'active' : ''} onClick={() => setPreviewMode('mobile')} aria-label="Preview mobile"><Icon as={Smartphone} size="md" /></button>
            <button className={previewMode === 'source' ? 'active' : ''} onClick={() => setPreviewMode('source')} aria-label="Preview source"><Icon as={Code} size="md" /></button>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSendTest} disabled={isSending}>
            <Icon as={Send} size="sm" /> {isSending ? 'Envoi...' : 'Test'}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
            <Icon as={Save} size="sm" /> {isSaving ? '...' : 'Sauver'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        /* Skeleton matche layout EmailBuilder : palette gauche + canvas centre + props droite */
        <div className="builder-layout">
          <div className="builder-palette">
            <Skeleton className="h-3 w-12 mb-3 ml-1" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md mb-1.5" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
            <div style={{ marginTop: 16, padding: '0 8px' }}>
              <Skeleton className="h-2.5 w-20 mb-1.5" style={{ animationDelay: '320ms' }} />
              <Skeleton className="h-8 w-full rounded-md" style={{ animationDelay: '360ms' }} />
            </div>
          </div>
          <div className="builder-canvas-container">
            <div className="builder-canvas-blocks">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-2.5 mb-1 rounded-xl"
                  style={{ background: 'var(--bg-surface)', border: '1px solid transparent', animationDelay: `${i * 60}ms` }}
                >
                  <Skeleton className="h-3.5 w-3.5 rounded shrink-0" style={{ animationDelay: `${i * 60}ms` }} />
                  <Skeleton className="h-4 w-4 rounded shrink-0" style={{ animationDelay: `${i * 60 + 20}ms` }} />
                  <Skeleton className="h-3 flex-1" style={{ animationDelay: `${i * 60 + 40}ms` }} />
                  <Skeleton className="h-3.5 w-3.5 rounded shrink-0" style={{ animationDelay: `${i * 60 + 60}ms` }} />
                </div>
              ))}
            </div>
            <div className="builder-preview">
              <div className="preview-label">
                <Skeleton className="h-2.5 w-20" />
              </div>
              <div className="preview-frame-wrapper desktop p-2 flex-1 flex">
                <Skeleton className="h-full w-full rounded-md" style={{ animationDelay: '120ms' }} />
              </div>
            </div>
          </div>
          <div className="builder-properties">
            <Skeleton className="h-3 w-32 mb-3" />
            <div className="space-y-2 px-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-1.5" style={{ animationDelay: `${i * 40}ms` }}>
                  <Skeleton className="h-2.5 w-16" style={{ animationDelay: `${i * 40}ms` }} />
                  <Skeleton className="h-8 w-full rounded-md" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
      <div className="builder-layout">
        <div className="builder-palette">
          <h4 className="palette-title">Blocks</h4>
          {BLOCK_PALETTE.map(bp => (
            <button key={bp.type} className="action-chip" onClick={() => addBlock(bp.type)} style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 6 }}>
              <span className="action-chip-icon">{bp.icon}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>{bp.label}</span>
              <Icon as={Plus} size="sm" className="palette-add" />
            </button>
          ))}
          <div style={{ marginTop: '16px', padding: '0 8px' }}>
            <label className="prop-label">Preheader</label>
            <Input value={preheader} onChange={e => setPreheader(e.target.value)} placeholder="Texte preview inbox" />
          </div>
        </div>

        <div className="builder-canvas-container">
          <div className="builder-canvas-blocks">
            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                {blocks.length === 0 ? (
                  <div className="canvas-empty"><Icon as={Eye} size={32} style={{ opacity: 0.3 }} /><p>Ajoutez des blocks depuis la palette</p></div>
                ) : blocks.map(block => (
                  <SortableBlock key={block.id} block={block} isSelected={selectedBlockId === block.id}
                    onSelect={() => setSelectedBlockId(block.id)} onDelete={() => deleteBlock(block.id)} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <div className="builder-preview">
            <div className="preview-label"><Icon as={Eye} size="sm" /> Aperçu {previewMode}</div>
            {previewMode === 'source' ? (
              <pre className="preview-source">{compiledHtml}</pre>
            ) : previewMode === 'mobile' ? (
              <div className="preview-frame-wrapper mobile">
                <div className="phone-bezel">
                  <div className="phone-bezel-speaker" aria-hidden />
                  <div className="phone-bezel-screen">
                    <iframe ref={iframeRef} className="preview-iframe" sandbox="allow-same-origin" title="Email preview" />
                  </div>
                  <div className="phone-bezel-indicator" aria-hidden />
                </div>
              </div>
            ) : (
              <div className="preview-frame-wrapper desktop">
                <div className="browser-chrome">
                  <div className="browser-chrome-bar">
                    <span className="browser-dot red" />
                    <span className="browser-dot amber" />
                    <span className="browser-dot green" />
                    <div className="browser-url">mail · preview · {templateName || 'template'}</div>
                  </div>
                  <iframe ref={iframeRef} className="preview-iframe" sandbox="allow-same-origin" title="Email preview" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="builder-properties">
          <BlockProperties block={selectedBlock} onChange={updated => setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b))} />
          {selectedBlock && (
            <div style={{ marginTop: '16px', padding: '0 12px' }}>
              <Button variant="ghost" size="sm" onClick={() => {
                const dup = { ...selectedBlock, id: crypto.randomUUID(), config: { ...selectedBlock.config } };
                setBlocks(prev => { const next = [...prev]; next.splice(prev.findIndex(b => b.id === selectedBlock.id) + 1, 0, dup); return next; });
                setSelectedBlockId(dup.id);
              }}><Icon as={Copy} size="sm" /> Dupliquer</Button>
            </div>
          )}
        </div>
      </div>
      )}
      </div>
    </AppLayout>
  );
}

const emailBuilderStyles = `
.builder-topbar {
  display:flex; justify-content:space-between; align-items:center;
  padding:14px 20px;
  border-bottom:1px solid var(--border-subtle);
  background: linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(240,250,254,0.85) 100%);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  box-shadow: 0 4px 16px -8px rgba(0,157,219,0.15);
  position: relative;
}
.builder-topbar::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent 0%, rgba(0,157,219,0.5) 30%, rgba(217,110,39,0.5) 70%, transparent 100%);
}
.builder-topbar-left { display:flex; align-items:center; gap:12px; }
.builder-meta { display:flex; flex-direction:column; gap:2px; }
.builder-topbar-actions { display:flex; align-items:center; gap:8px; }
.preview-toggle {
  display:flex;
  background: rgba(255,255,255,0.7);
  border:1px solid var(--border-subtle);
  border-radius:10px;
  overflow:hidden;
  padding: 2px;
}
.preview-toggle button {
  padding:6px 10px;
  border:none;
  background:transparent;
  cursor:pointer;
  color:var(--text-secondary);
  transition:all 0.2s;
  border-radius: 7px;
}
.preview-toggle button:hover { color: var(--primary); }
.preview-toggle button.active {
  background: linear-gradient(135deg, #009DDB 0%, #0086C0 100%);
  color:white;
  box-shadow: 0 2px 8px rgba(0,157,219,0.4);
}
.builder-layout { display:grid; grid-template-columns:200px 1fr 280px; height:calc(100vh - 180px); overflow:hidden; }
.builder-palette { border-right:1px solid var(--border-default); padding:12px 8px; overflow-y:auto; background:var(--bg-surface); }
.palette-title { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin:0 0 8px 4px; font-weight:600; }
.palette-item { display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border:1px solid transparent; border-radius:6px; background:transparent; cursor:pointer; font-size:13px; color:var(--text-primary); transition:all 0.15s; }
.palette-item:hover { background:var(--bg-hover); border-color:var(--border-default); }
.palette-icon { font-size:16px; }
.palette-add { margin-left:auto; opacity:0; transition:opacity 0.15s; }
.palette-item:hover .palette-add { opacity:0.5; }
.builder-canvas-container { display:flex; flex-direction:column; overflow:hidden; }
.builder-canvas-blocks { flex:1; padding:16px; overflow-y:auto; background:var(--bg-canvas); }
.canvas-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px; color:var(--text-muted); gap:8px; }
.email-block-item { position:relative; display:flex; align-items:center; gap:8px; padding:10px 12px 10px 14px; border:1px solid transparent; border-radius:10px; background:var(--bg-surface); margin-bottom:4px; cursor:pointer; transition:all 200ms cubic-bezier(0.4,0,0.2,1); }
.email-block-item:hover { border-color:rgba(0,157,219,0.30); box-shadow: 0 2px 10px -4px rgba(0,157,219,0.22); transform: translateY(-1px); }
.email-block-item.selected { border-color:rgba(0,157,219,0.45); background:linear-gradient(135deg, rgba(0,157,219,0.08) 0%, rgba(217,110,39,0.04) 100%); box-shadow: 0 2px 14px -4px rgba(0,157,219,0.30); }
.email-block-item.selected::before { content:''; position:absolute; left:0; top:8%; bottom:8%; width:3px; border-radius: 0 4px 4px 0; background: linear-gradient(180deg, #00B5F5 0%, #009DDB 55%, #D96E27 100%); box-shadow: 0 0 12px rgba(0,157,219,0.55); }
.block-drag-handle { cursor:grab; color:var(--text-muted); }
.block-label { display:flex; align-items:center; gap:6px; flex:1; font-size:13px; }
.block-icon { font-size:16px; }
.block-delete-btn { border:none; background:transparent; cursor:pointer; color:var(--text-muted); opacity:0; transition:opacity 0.15s; }
.email-block-item:hover .block-delete-btn { opacity:1; }
.builder-preview { border-top:1px solid var(--border-default); background:var(--bg-canvas); height:300px; overflow:hidden; display:flex; flex-direction:column; }
.preview-label { display:flex; align-items:center; gap:6px; padding:8px 16px; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); border-bottom:1px solid var(--border-default); }
.preview-frame-wrapper { flex:1; overflow:auto; display:flex; justify-content:center; padding:8px; }
.preview-frame-wrapper.mobile { max-width:375px; margin:0 auto; }
.preview-iframe { width:100%; height:100%; border:none; border-radius:4px; background:white; }
.preview-source { flex:1; overflow:auto; padding:12px; font-size:11px; font-family:monospace; background:#1a1a2e; color:#a5f3fc; margin:0; white-space:pre-wrap; }
.builder-properties { border-left:1px solid var(--border-default); padding:12px; overflow-y:auto; background:var(--bg-surface); }
.block-props-empty { padding:20px 12px; color:var(--text-muted); font-size:13px; text-align:center; }
.prop-label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin:10px 0 4px; font-weight:600; }
.prop-select { width:100%; padding:6px 8px; border:1px solid var(--border-default); border-radius:6px; font-size:13px; background:var(--bg-canvas); color:var(--text-primary); }
.prop-textarea { width:100%; padding:8px; border:1px solid var(--border-default); border-radius:6px; font-size:13px; font-family:monospace; background:var(--bg-canvas); color:var(--text-primary); resize:vertical; }

/* ── Phone bezel mock (mobile preview) ── */
.phone-bezel { position:relative; width:300px; max-width:100%; aspect-ratio: 300 / 580; background: linear-gradient(135deg, #1f2937 0%, #0f172a 100%); border-radius: 36px; padding: 38px 12px 28px; box-shadow: 0 24px 60px -16px rgba(15,23,42,0.45), 0 0 0 1px rgba(0,157,219,0.18), inset 0 0 0 2px rgba(255,255,255,0.06); display:flex; flex-direction:column; }
.phone-bezel-speaker { position:absolute; top:14px; left:50%; transform: translateX(-50%); width: 56px; height: 5px; border-radius: 999px; background: rgba(255,255,255,0.18); }
.phone-bezel-screen { flex:1; border-radius: 18px; overflow:hidden; background:white; box-shadow: inset 0 0 0 1px rgba(0,157,219,0.10); }
.phone-bezel-screen .preview-iframe { border-radius: 0; }
.phone-bezel-indicator { position:absolute; bottom:10px; left:50%; transform: translateX(-50%); width: 96px; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.40); }

/* ── Browser chrome mock (desktop preview) ── */
.browser-chrome { width: 100%; max-width: 760px; margin: 0 auto; border-radius: 12px; overflow:hidden; background:white; box-shadow: 0 12px 40px -12px rgba(15,23,42,0.25), 0 0 0 1px rgba(0,157,219,0.15); display:flex; flex-direction:column; flex:1; }
.browser-chrome-bar { display:flex; align-items:center; gap:6px; padding: 10px 12px; background: linear-gradient(135deg, rgba(0,157,219,0.06) 0%, rgba(255,255,255,0.85) 100%); border-bottom: 1px solid rgba(0,157,219,0.15); }
.browser-dot { display:inline-block; width:10px; height:10px; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06); }
.browser-dot.red { background: #ff5f57; }
.browser-dot.amber { background: #febc2e; }
.browser-dot.green { background: #28c840; }
.browser-url { flex:1; margin-left: 8px; padding: 4px 12px; border-radius: 999px; background: rgba(0,157,219,0.06); border: 1px solid rgba(0,157,219,0.15); font-size: 11px; color: var(--text-muted); text-align:center; }
.browser-chrome .preview-iframe { flex:1; border-radius: 0; }

/* ── Preview source : tint cyan + line numbering subtil ── */
.preview-source { flex:1; overflow:auto; padding:12px 14px; font-size:11px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; background: linear-gradient(135deg, #0f1c2e 0%, #1a1a2e 100%); color:#a5f3fc; margin:0; white-space:pre-wrap; line-height: 1.55; }
.preview-source::first-line { color: rgba(217,110,39,0.85); }

/* ── List item enter stagger (déjà global) backup local ── */
.email-block-item.list-item-enter { animation: emailItemEnter 240ms cubic-bezier(0.34,1.56,0.64,1) both; }
@keyframes emailItemEnter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .email-block-item.list-item-enter, .email-block-item { animation: none !important; transition: none !important; }
}
`;
