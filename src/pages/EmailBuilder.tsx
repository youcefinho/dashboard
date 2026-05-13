// ── EmailBuilder — Éditeur email block-based — Intralys CRM ──

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DesktopOnlyBanner } from '@/components/DesktopOnlyBanner';
import { Button, Badge, Input, useToast, usePrompt } from '@/components/ui';
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
    <div ref={setNodeRef} style={style} onClick={onSelect} className={`email-block-item ${isSelected ? 'selected' : ''}`}>
      <div className="block-drag-handle" {...attributes} {...listeners}><GripVertical size={14} /></div>
      <div className="block-label">
        <span className="block-icon">{blockLabel?.icon || '📦'}</span>
        <span>{blockLabel?.label || block.type}</span>
      </div>
      <button className="block-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Supprimer"><Trash2 size={14} /></button>
    </div>
  );
}

// ── Sidebar : propriétés du block sélectionné ────────────────
function BlockProperties({ block, onChange }: { block: EmailBlock | null; onChange: (updated: EmailBlock) => void }) {
  if (!block) return <div className="block-props-empty">Sélectionnez un block pour modifier ses propriétés</div>;

  const updateConfig = (key: string, value: unknown) => {
    onChange({ ...block, config: { ...block.config, [key]: value } });
  };

  return (
    <div className="block-props">
      <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
        Propriétés — {BLOCK_PALETTE.find(b => b.type === block.type)?.label}
      </h4>

      {block.type === 'header' && (
        <>
          <label className="prop-label">Texte</label>
          <Input value={(block.config.text as string) || ''} onChange={e => updateConfig('text', e.target.value)} />
          <label className="prop-label">Niveau</label>
          <select className="prop-select" value={(block.config.level as number) || 2} onChange={e => updateConfig('level', Number(e.target.value))}>
            <option value={1}>H1 — Grand</option><option value={2}>H2 — Moyen</option><option value={3}>H3 — Petit</option>
          </select>
          <label className="prop-label">Couleur texte</label>
          <input type="color" value={(block.config.color as string) || '#1a1a2e'} onChange={e => updateConfig('color', e.target.value)} />
          <label className="prop-label">Fond</label>
          <input type="color" value={(block.config.backgroundColor as string) || '#ffffff'} onChange={e => updateConfig('backgroundColor', e.target.value)} />
          <label className="prop-label">Alignement</label>
          <select className="prop-select" value={(block.config.align as string) || 'left'} onChange={e => updateConfig('align', e.target.value)}>
            <option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option>
          </select>
        </>
      )}

      {block.type === 'text' && (
        <>
          <label className="prop-label">Contenu HTML</label>
          <textarea className="prop-textarea" rows={6} value={(block.config.html as string) || ''} onChange={e => updateConfig('html', e.target.value)} />
          <label className="prop-label">Couleur</label>
          <input type="color" value={(block.config.color as string) || '#374151'} onChange={e => updateConfig('color', e.target.value)} />
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
          <input type="color" value={(block.config.backgroundColor as string) || '#009DDB'} onChange={e => updateConfig('backgroundColor', e.target.value)} />
          <label className="prop-label">Couleur texte</label>
          <input type="color" value={(block.config.color as string) || '#ffffff'} onChange={e => updateConfig('color', e.target.value)} />
        </>
      )}

      {block.type === 'divider' && (
        <>
          <label className="prop-label">Couleur</label>
          <input type="color" value={(block.config.color as string) || '#e5e7eb'} onChange={e => updateConfig('color', e.target.value)} />
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
          <textarea className="prop-textarea" rows={4} value={(block.config.html as string) || ''} onChange={e => updateConfig('html', e.target.value)} />
          <label className="prop-label">Couleur</label>
          <input type="color" value={(block.config.color as string) || '#9ca3af'} onChange={e => updateConfig('color', e.target.value)} />
        </>
      )}

      {block.type === 'columns' && (
        <>
          <label className="prop-label">Colonne 1 (HTML)</label>
          <textarea className="prop-textarea" rows={3}
            value={((block.config.columns as Array<{html: string}>)?.[0]?.html) || ''}
            onChange={e => {
              const cols = [...((block.config.columns as Array<{html: string; width: string}>) || [])];
              if (cols[0]) cols[0] = { ...cols[0], html: e.target.value };
              else cols[0] = { html: e.target.value, width: '50%' };
              updateConfig('columns', cols);
            }}
          />
          <label className="prop-label">Colonne 2 (HTML)</label>
          <textarea className="prop-textarea" rows={3}
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
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadTemplate = useCallback(async () => {
    if (!templateId) return;
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
    setIsSaving(true); setSaveStatus(null);
    await updateTemplate(templateId, { name: templateName, subject: templateSubject });
    const result = await saveTemplateBlocks(templateId, blocks, preheader);
    setSaveStatus(result.data ? '✅ Sauvegardé' : '❌ Erreur');
    setIsSaving(false);
    setTimeout(() => setSaveStatus(null), 3000);
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
            <ArrowLeft size={16} /> Retour
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
            <button className={previewMode === 'desktop' ? 'active' : ''} onClick={() => setPreviewMode('desktop')}><Monitor size={16} /></button>
            <button className={previewMode === 'mobile' ? 'active' : ''} onClick={() => setPreviewMode('mobile')}><Smartphone size={16} /></button>
            <button className={previewMode === 'source' ? 'active' : ''} onClick={() => setPreviewMode('source')}><Code size={16} /></button>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSendTest} disabled={isSending}>
            <Send size={14} /> {isSending ? 'Envoi...' : 'Test'}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
            <Save size={14} /> {isSaving ? '...' : 'Sauver'}
          </Button>
          {saveStatus && <Badge>{saveStatus}</Badge>}
        </div>
      </div>

      <div className="builder-layout">
        <div className="builder-palette">
          <h4 className="palette-title">Blocks</h4>
          {BLOCK_PALETTE.map(bp => (
            <button key={bp.type} className="palette-item" onClick={() => addBlock(bp.type)}>
              <span className="palette-icon">{bp.icon}</span><span>{bp.label}</span><Plus size={14} className="palette-add" />
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
                  <div className="canvas-empty"><Eye size={32} style={{ opacity: 0.3 }} /><p>Ajoutez des blocks depuis la palette</p></div>
                ) : blocks.map(block => (
                  <SortableBlock key={block.id} block={block} isSelected={selectedBlockId === block.id}
                    onSelect={() => setSelectedBlockId(block.id)} onDelete={() => deleteBlock(block.id)} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <div className="builder-preview">
            <div className="preview-label"><Eye size={14} /> Aperçu {previewMode}</div>
            {previewMode === 'source' ? (
              <pre className="preview-source">{compiledHtml}</pre>
            ) : (
              <div className={`preview-frame-wrapper ${previewMode}`}>
                <iframe ref={iframeRef} className="preview-iframe" sandbox="allow-same-origin" title="Email preview" />
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
              }}><Copy size={14} /> Dupliquer</Button>
            </div>
          )}
        </div>
      </div>
      </div>
    </AppLayout>
  );
}

const emailBuilderStyles = `
.builder-topbar { display:flex; justify-content:space-between; align-items:center; padding:12px 20px; border-bottom:1px solid var(--border-default); background:var(--bg-surface); }
.builder-topbar-left { display:flex; align-items:center; gap:12px; }
.builder-meta { display:flex; flex-direction:column; gap:2px; }
.builder-topbar-actions { display:flex; align-items:center; gap:8px; }
.preview-toggle { display:flex; border:1px solid var(--border-default); border-radius:6px; overflow:hidden; }
.preview-toggle button { padding:6px 10px; border:none; background:transparent; cursor:pointer; color:var(--text-secondary); transition:all 0.15s; }
.preview-toggle button.active { background:var(--brand-primary); color:white; }
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
.email-block-item { display:flex; align-items:center; gap:8px; padding:10px 12px; border:2px solid transparent; border-radius:8px; background:var(--bg-surface); margin-bottom:4px; cursor:pointer; transition:all 0.15s; }
.email-block-item:hover { border-color:rgba(0,157,219,0.2); }
.email-block-item.selected { border-color:var(--brand-primary); background:rgba(0,157,219,0.04); }
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
`;
