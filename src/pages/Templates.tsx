// ── TemplatesPage — Gestion avancée des templates d'emails ──

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState, Input, Modal } from '@/components/ui';
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '@/lib/api';
import type { EmailTemplate, TemplateCategory } from '@/lib/types';
import { TEMPLATE_CATEGORY_LABELS, TEMPLATE_CATEGORIES } from '@/lib/types';

const CATEGORY_COLORS: Record<TemplateCategory, string> = {
  welcome: 'var(--brand-primary)',
  followup: 'var(--warning)',
  reminder: 'var(--info)',
  notification: 'var(--success)',
  marketing: '#a855f7',
  general: 'var(--text-muted)',
};

const CATEGORY_ICONS: Record<TemplateCategory, string> = {
  welcome: '👋',
  followup: '🔄',
  reminder: '⏰',
  notification: '🔔',
  marketing: '📣',
  general: '📄',
};

type ViewMode = 'grid' | 'list';

export function TemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | ''>('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  // Formulaire
  const [formName, setFormName] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formCategory, setFormCategory] = useState<TemplateCategory>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [editorTab, setEditorTab] = useState<'code' | 'preview'>('code');

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    const result = await getTemplates(categoryFilter || undefined);
    if (result.data) setTemplates(result.data);
    setIsLoading(false);
  }, [categoryFilter]);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const resetForm = () => {
    setFormName(''); setFormSubject(''); setFormBody(''); setFormCategory('general'); setEditingId(null); setEditorTab('code');
  };

  const openNewTemplate = () => { resetForm(); setShowEditor(true); };

  const openEditTemplate = (tpl: EmailTemplate) => {
    setFormName(tpl.name); setFormSubject(tpl.subject); setFormBody(tpl.body_html); setFormCategory(tpl.category); setEditingId(tpl.id); setShowEditor(true);
  };

  const duplicateTemplate = (tpl: EmailTemplate) => {
    setFormName(`${tpl.name} (copie)`); setFormSubject(tpl.subject); setFormBody(tpl.body_html); setFormCategory(tpl.category); setEditingId(null); setShowEditor(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formSubject.trim() || !formBody.trim()) return;
    setIsSaving(true);
    if (editingId) {
      await updateTemplate(editingId, { name: formName.trim(), subject: formSubject.trim(), body_html: formBody.trim(), category: formCategory });
    } else {
      await createTemplate({ name: formName.trim(), subject: formSubject.trim(), body_html: formBody.trim(), category: formCategory });
    }
    setIsSaving(false); setShowEditor(false); resetForm(); void loadTemplates();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce template ?')) return;
    await deleteTemplate(id);
    void loadTemplates();
  };

  // Filtrage
  const filteredTemplates = templates.filter(t => {
    if (categoryFilter && t.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q);
    }
    return true;
  });

  const previewTemplate = templates.find(t => t.id === previewId);

  // Extraire les variables
  const extractVariables = (text: string): string[] => {
    const matches = text.match(/\{\{([^}]+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
  };

  // Stats par catégorie
  const categoryCounts: Record<string, number> = {};
  templates.forEach(t => { categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1; });

  return (
    <AppLayout title="Templates">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">📧 Templates d'emails</h1>
          <Badge color="var(--info)">{templates.length} templates</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-[var(--bg-subtle)] rounded-[var(--radius-md)] p-0.5">
            <button onClick={() => setViewMode('grid')}
              className={`px-2 py-1 text-xs rounded cursor-pointer transition-colors ${viewMode === 'grid' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)]'}`}>▦</button>
            <button onClick={() => setViewMode('list')}
              className={`px-2 py-1 text-xs rounded cursor-pointer transition-colors ${viewMode === 'list' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)]'}`}>☰</button>
          </div>
          <Button onClick={openNewTemplate}>+ Nouveau template</Button>
        </div>
      </div>

      {/* Recherche + Filtres */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <Input placeholder="Rechercher un template..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1" />
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setCategoryFilter('')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-all ${categoryFilter === '' ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
            Tous ({templates.length})
          </button>
          {TEMPLATE_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-all ${categoryFilter === cat ? 'text-white border-transparent' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}
              style={categoryFilter === cat ? { backgroundColor: CATEGORY_COLORS[cat] } : undefined}>
              {CATEGORY_ICONS[cat]} {TEMPLATE_CATEGORY_LABELS[cat]} ({categoryCounts[cat] || 0})
            </button>
          ))}
        </div>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : filteredTemplates.length === 0 ? (
        <EmptyState icon="📄" title="Aucun template" description="Créez votre premier template d'email pour accélérer vos communications." />
      ) : viewMode === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTemplates.map((tpl) => {
            const vars = extractVariables(tpl.subject + tpl.body_html);
            return (
              <Card key={tpl.id} className="hover:border-[var(--brand-primary)]/30 transition-all group">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{CATEGORY_ICONS[tpl.category]}</span>
                      <div>
                        <h3 className="font-semibold text-sm">{tpl.name}</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">Sujet : {tpl.subject}</p>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full text-white font-medium shrink-0" style={{ backgroundColor: CATEGORY_COLORS[tpl.category] }}>
                      {TEMPLATE_CATEGORY_LABELS[tpl.category]}
                    </span>
                  </div>

                  {/* Aperçu mini */}
                  <div className="bg-white text-gray-700 rounded-[var(--radius-sm)] p-2 mb-3 text-[10px] line-clamp-3 h-12 overflow-hidden">
                    {tpl.body_html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').slice(0, 150)}
                  </div>

                  {/* Variables */}
                  {vars.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {vars.map(v => (
                        <span key={v} className="text-[9px] px-1.5 py-0.5 bg-[var(--bg-subtle)] rounded font-mono text-[var(--brand-primary)]">
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 opacity-70 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setPreviewId(tpl.id)} className="text-xs text-[var(--info)] hover:underline cursor-pointer">👁️ Aperçu</button>
                    <button onClick={() => openEditTemplate(tpl)} className="text-xs text-[var(--brand-primary)] hover:underline cursor-pointer">✏️ Modifier</button>
                    <button onClick={() => duplicateTemplate(tpl)} className="text-xs text-[var(--text-muted)] hover:underline cursor-pointer">📋 Dupliquer</button>
                    {!tpl.id.startsWith('tpl-') && (
                      <button onClick={() => void handleDelete(tpl.id)} className="text-xs text-[var(--danger)] hover:underline cursor-pointer ml-auto">🗑️</button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        /* Vue liste */
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase">Template</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase">Catégorie</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase">Sujet</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase">Variables</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-muted)] uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.map(tpl => {
                const vars = extractVariables(tpl.subject + tpl.body_html);
                return (
                  <tr key={tpl.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span>{CATEGORY_ICONS[tpl.category]}</span>
                        <span className="font-medium">{tpl.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: CATEGORY_COLORS[tpl.category] }}>{TEMPLATE_CATEGORY_LABELS[tpl.category]}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{tpl.subject}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">{vars.map(v => <span key={v} className="text-[9px] px-1 py-0.5 bg-[var(--bg-subtle)] rounded font-mono">{`{{${v}}}`}</span>)}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setPreviewId(tpl.id)} className="text-xs text-[var(--info)] hover:underline cursor-pointer">Aperçu</button>
                        <button onClick={() => openEditTemplate(tpl)} className="text-xs text-[var(--brand-primary)] hover:underline cursor-pointer">Modifier</button>
                        <button onClick={() => duplicateTemplate(tpl)} className="text-xs text-[var(--text-muted)] hover:underline cursor-pointer">Dupliquer</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Modal éditeur avec preview live */}
      <Modal isOpen={showEditor} onClose={() => { setShowEditor(false); resetForm(); }} title={editingId ? 'Modifier le template' : 'Nouveau template'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Nom</label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Bienvenue nouveau lead" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Catégorie</label>
              <select value={formCategory} onChange={(e) => setFormCategory(e.target.value as TemplateCategory)}
                className="w-full px-3 py-2 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-sm focus:outline-none focus:border-[var(--brand-primary)]">
                {TEMPLATE_CATEGORIES.map(cat => <option key={cat} value={cat}>{CATEGORY_ICONS[cat]} {TEMPLATE_CATEGORY_LABELS[cat]}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Sujet <span className="text-[var(--text-muted)]">(variables : {`{{nom}}, {{courtier}}`})</span>
            </label>
            <Input value={formSubject} onChange={(e) => setFormSubject(e.target.value)} placeholder="Merci {{nom}} !" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Contenu</label>
              <div className="flex bg-[var(--bg-subtle)] rounded p-0.5">
                <button onClick={() => setEditorTab('code')} className={`px-2 py-0.5 text-[10px] rounded cursor-pointer ${editorTab === 'code' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)]'}`}>{'</>'}Code</button>
                <button onClick={() => setEditorTab('preview')} className={`px-2 py-0.5 text-[10px] rounded cursor-pointer ${editorTab === 'preview' ? 'bg-[var(--brand-primary)] text-white' : 'text-[var(--text-muted)]'}`}>👁️ Aperçu</button>
              </div>
            </div>
            {editorTab === 'code' ? (
              <textarea value={formBody} onChange={(e) => setFormBody(e.target.value)} rows={10}
                placeholder="<h2>Bonjour {{nom}},</h2><p>Merci pour votre intérêt...</p>"
                className="w-full px-3 py-2 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-primary)] resize-none font-mono text-xs" />
            ) : (
              <div className="bg-white text-gray-900 p-4 rounded-[var(--radius-md)] text-sm min-h-[200px] border border-[var(--border-subtle)]"
                dangerouslySetInnerHTML={{ __html: formBody || '<p style="color:#999">Aperçu du contenu...</p>' }} />
            )}
          </div>

          {/* Variables détectées */}
          {formBody && extractVariables(formSubject + formBody).length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-[var(--text-muted)]">Variables :</span>
              {extractVariables(formSubject + formBody).map(v => (
                <span key={v} className="text-[10px] px-1.5 py-0.5 bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] rounded font-mono">{`{{${v}}}`}</span>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => { setShowEditor(false); resetForm(); }}>Annuler</Button>
            <Button onClick={() => void handleSave()} disabled={isSaving || !formName.trim() || !formSubject.trim() || !formBody.trim()}>
              {isSaving ? 'Enregistrement...' : editingId ? 'Mettre à jour' : 'Créer le template'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal aperçu enrichi */}
      <Modal isOpen={!!previewId} onClose={() => setPreviewId(null)} title={previewTemplate ? `Aperçu : ${previewTemplate.name}` : 'Aperçu'}>
        {previewTemplate && (
          <div className="space-y-4">
            {/* En-tête email simulé */}
            <div className="bg-[var(--bg-subtle)] rounded-[var(--radius-md)] p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-muted)] w-8">De :</span>
                <span className="font-medium">courtier@intralys.com</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-muted)] w-8">À :</span>
                <span className="font-medium text-[var(--brand-primary)]">{'{{email}}'}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-muted)] w-8">Obj :</span>
                <span className="font-semibold">{previewTemplate.subject}</span>
              </div>
            </div>
            {/* Corps */}
            <div className="bg-white text-gray-900 p-5 rounded-[var(--radius-md)] text-sm shadow-sm" dangerouslySetInnerHTML={{ __html: previewTemplate.body_html }} />
            {/* Infos */}
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span>{CATEGORY_ICONS[previewTemplate.category]} {TEMPLATE_CATEGORY_LABELS[previewTemplate.category]}</span>
              <span>{extractVariables(previewTemplate.subject + previewTemplate.body_html).length} variables</span>
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}
