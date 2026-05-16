// ── TemplatesPage — Gestion avancée des templates d'emails ──

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Skeleton, EmptyState, Input, useConfirm, PageHero, KpiStrip, Icon, type KpiItem, Tag, EmptyStateIllustration } from '@/components/ui';
// Sprint 44 M3.3 — Pull-to-refresh
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/ui/PullToRefreshIndicator';
import { Modal } from '@/components/ui/Modal';
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '@/lib/api';
import { Wand2, FileText, FolderOpen, Tag as TagIcon, Calendar, ChevronRight } from 'lucide-react';
import type { EmailTemplate, TemplateCategory } from '@/lib/types';
import { TEMPLATE_CATEGORY_LABELS, TEMPLATE_CATEGORIES } from '@/lib/types';

const CATEGORY_COLORS: Record<TemplateCategory, string> = {
  welcome: 'var(--primary)',
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
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | ''>('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  // Sprint 32 vague 32-3A — Expand inline (preview body + usage + last_used)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Formulaire
  const [formName, setFormName] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formCategory, setFormCategory] = useState<TemplateCategory>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
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
    const ok = await confirm({
      title: 'Supprimer ce template ?',
      description: 'Le template sera retiré définitivement. Les emails déjà envoyés ne sont pas affectés.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
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

  // KPI stats — Sprint 23 wave 27
  const totalTemplates = templates.length;
  const marketingCount = templates.filter(t => t.category === 'marketing').length;
  const transactionalCount = templates.filter(t => t.category !== 'marketing').length;
  const lastEdited = templates.reduce<EmailTemplate | null>((latest, t) => {
    if (!latest) return t;
    return new Date(t.updated_at).getTime() > new Date(latest.updated_at).getTime() ? t : latest;
  }, null);
  const kpiItems: KpiItem[] = [
    { label: 'Total', value: totalTemplates, icon: <FileText size={11} />, color: 'brand' },
    { label: 'Marketing', value: marketingCount, icon: <TagIcon size={11} />, color: 'accent' },
    { label: 'Transactionnels', value: transactionalCount, icon: <FolderOpen size={11} />, color: 'info' },
    { label: 'Dernier édité', value: lastEdited ? (lastEdited.name.length > 14 ? lastEdited.name.slice(0, 12) + '…' : lastEdited.name) : '—', icon: <Calendar size={11} />, color: 'neutral' },
  ];

  // Sprint 44 M3.3 — Pull-to-refresh
  const scrollParentRef = useRef<HTMLElement | null>(null);
  useEffect(() => { scrollParentRef.current = document.getElementById('main-content'); }, []);
  const ptr = usePullToRefresh(async () => { await loadTemplates(); }, { scrollParent: scrollParentRef });

  return (
    <AppLayout title="Templates">
      <div ref={ptr.containerRef}>
      <PullToRefreshIndicator distance={ptr.pullDistance} progress={ptr.pullProgress} isRefreshing={ptr.isRefreshing} />
      <PageHero
        meta="Marketing"
        title="Templates d'emails"
        highlight="Templates"
        description={`${templates.length} modèles disponibles pour vos campagnes et relances automatisées.`}
        actions={<Button variant="premium" onClick={openNewTemplate}>+ Nouveau template</Button>}
      />

      <KpiStrip items={kpiItems} />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Tag dot variant="info" size="md">{templates.length} templates</Tag>
        </div>
        <div className="flex items-center gap-2">
          <div className="segmented-control segmented-control--icon">
            <button onClick={() => setViewMode('grid')} className={viewMode === 'grid' ? 'is-active' : ''} aria-label="Vue grille">▦</button>
            <button onClick={() => setViewMode('list')} className={viewMode === 'list' ? 'is-active' : ''} aria-label="Vue liste">☰</button>
          </div>
        </div>
      </div>

      {/* Recherche + Filtres */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <Input placeholder="Rechercher un template..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1" />
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setCategoryFilter('')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-all ${categoryFilter === '' ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}`}>
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full mb-2" />
              <Skeleton className="h-3 w-3/4 mb-4" />
              <div className="flex gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <Skeleton className="h-7 w-16 rounded-md" />
                <Skeleton className="h-7 w-16 rounded-md" />
                <Skeleton className="h-7 w-7 rounded-md ml-auto" />
              </div>
            </Card>
          ))}
        </div>
      ) : filteredTemplates.length === 0 ? (
        templates.length > 0 ? (
          <EmptyState
            variant="filtered"
            icon={<Icon as={FileText} size={48} />}
            title="Aucun résultat"
            description="Aucun template ne correspond à ta recherche."
            action={<Button variant="secondary" onClick={() => { setSearchQuery(''); setCategoryFilter(''); }}>Effacer les filtres</Button>}
          />
        ) : (
          <EmptyState
            variant="first-time"
            illustration={<EmptyStateIllustration kind="inbox" size={160} />}
            title="Aucun template encore"
            description="Crée ton premier template d'email pour accélérer tes communications."
          />
        )
      ) : viewMode === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTemplates.map((tpl, idx) => {
            const vars = extractVariables(tpl.subject + tpl.body_html);
            return (
              <Card key={tpl.id} className="hover:border-[var(--primary)]/30 transition-all group list-item-enter" style={{ animationDelay: `${idx * 30}ms` }}>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{CATEGORY_ICONS[tpl.category]}</span>
                      <div>
                        <h3 className="font-semibold text-sm">{tpl.name}</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">Sujet : {tpl.subject}</p>
                      </div>
                    </div>
                    <Tag dot color={CATEGORY_COLORS[tpl.category]} size="xs" className="shrink-0">
                      {TEMPLATE_CATEGORY_LABELS[tpl.category]}
                    </Tag>
                  </div>

                  {/* Aperçu mini */}
                  <div className="bg-white text-gray-700 rounded-[var(--radius-sm)] p-2 mb-3 text-[10px] line-clamp-3 h-12 overflow-hidden">
                    {tpl.body_html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').slice(0, 150)}
                  </div>

                  {/* Variables */}
                  {vars.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {vars.map(v => (
                        <span key={v} className="text-[9px] px-1.5 py-0.5 bg-[var(--bg-subtle)] rounded font-mono text-[var(--primary)]">
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 opacity-70 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setPreviewId(tpl.id)} className="text-xs text-[var(--info)] hover:underline cursor-pointer">👁️ Aperçu</button>
                    <button onClick={() => openEditTemplate(tpl)} className="text-xs text-[var(--primary)] hover:underline cursor-pointer">✏️ Modifier</button>
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
        /* Vue liste — Sprint 32 vague 32-3A : table-premium-container + frozen col + expand inline */
        <Card className="p-0 overflow-hidden">
          <div className="table-premium-container overflow-x-auto">
            <table className="table-premium w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="col-frozen" style={{ minWidth: 240 }}>Template</th>
                  <th style={{ minWidth: 120 }}>Catégorie</th>
                  <th style={{ minWidth: 200 }}>Sujet</th>
                  <th style={{ minWidth: 140 }}>Variables</th>
                  <th className="text-right" style={{ minWidth: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((tpl, idx) => {
                  const vars = extractVariables(tpl.subject + tpl.body_html);
                  const isExpanded = expandedId === tpl.id;
                  // usage_count / last_used_at potentiellement absents du type — accès défensif
                  const usage = (tpl as unknown as { usage_count?: number }).usage_count ?? 0;
                  const lastUsedRaw = (tpl as unknown as { last_used_at?: string }).last_used_at;
                  const lastUsedLabel = lastUsedRaw ? new Date(lastUsedRaw).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Jamais utilisé';
                  const bodyPreview = tpl.body_html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, ' ').slice(0, 280);
                  return (
                    <React.Fragment key={tpl.id}>
                      <tr className="row-premium list-item-enter" style={{ animationDelay: `${idx * 30}ms` }}>
                        <td className="col-frozen">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              className={`table-expand-trigger ${isExpanded ? 'is-expanded' : ''}`}
                              onClick={() => setExpandedId(isExpanded ? null : tpl.id)}
                              aria-label={isExpanded ? 'Réduire' : 'Afficher les détails'}
                              aria-expanded={isExpanded}
                            >
                              <ChevronRight size={14} />
                            </button>
                            <span className="text-lg leading-none">{CATEGORY_ICONS[tpl.category]}</span>
                            <span className="font-medium text-[var(--text-primary)]">{tpl.name}</span>
                          </div>
                        </td>
                        <td>
                          <Tag dot color={CATEGORY_COLORS[tpl.category]} size="xs">{TEMPLATE_CATEGORY_LABELS[tpl.category]}</Tag>
                        </td>
                        <td className="text-xs text-[var(--text-muted)] truncate max-w-[260px]">{tpl.subject}</td>
                        <td>
                          <div className="flex gap-1 flex-wrap">{vars.slice(0, 4).map(v => <span key={v} className="text-[9px] px-1 py-0.5 bg-[var(--bg-subtle)] rounded font-mono text-[var(--primary)]">{`{{${v}}}`}</span>)}{vars.length > 4 && <span className="text-[9px] text-[var(--text-muted)]">+{vars.length - 4}</span>}</div>
                        </td>
                        <td className="text-right">
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => setPreviewId(tpl.id)} className="text-xs text-[var(--info)] hover:underline cursor-pointer">Aperçu</button>
                            <button onClick={() => openEditTemplate(tpl)} className="text-xs text-[var(--primary)] hover:underline cursor-pointer">Modifier</button>
                            <button onClick={() => duplicateTemplate(tpl)} className="text-xs text-[var(--text-muted)] hover:underline cursor-pointer">Dupliquer</button>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={5} style={{ padding: 0, border: 'none' }}>
                          <div className={`table-expand-content ${isExpanded ? 'is-open' : ''}`}>
                            <div className="table-expand-inner">
                              <div className="table-expand-detail">
                                <div className="table-expand-detail-section" style={{ flex: '1 1 320px' }}>
                                  <span className="table-expand-detail-label">Aperçu du contenu</span>
                                  <span className="table-expand-detail-value text-[12px] leading-relaxed text-[var(--text-secondary)]">{bodyPreview}{tpl.body_html.length > 280 ? '…' : ''}</span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Utilisations</span>
                                  <span className="table-expand-detail-value t-mono-num">{usage}</span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Dernière utilisation</span>
                                  <span className="table-expand-detail-value text-[12px]">{lastUsedLabel}</span>
                                </div>
                                <div className="table-expand-detail-section">
                                  <span className="table-expand-detail-label">Modifié</span>
                                  <span className="table-expand-detail-value text-[12px]">{new Date(tpl.updated_at).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal éditeur avec preview live */}
      <Modal open={showEditor} onOpenChange={() => { setShowEditor(false); resetForm(); }} title={editingId ? 'Modifier le template' : 'Nouveau template'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Nom</label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Bienvenue nouveau lead" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Catégorie</label>
              <select value={formCategory} onChange={(e) => setFormCategory(e.target.value as TemplateCategory)}
                className="w-full px-3 py-2 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-sm focus:outline-none focus:border-[var(--primary)]">
                {TEMPLATE_CATEGORIES.map(cat => <option key={cat} value={cat}>{CATEGORY_ICONS[cat]} {TEMPLATE_CATEGORY_LABELS[cat]}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Sujet <span className="text-[var(--text-muted)]">(variables : {`{{nom}}, {{user_name}}`})</span>
            </label>
            <Input value={formSubject} onChange={(e) => setFormSubject(e.target.value)} placeholder="Merci {{nom}} !" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Contenu</label>
              <div className="flex items-center gap-2">
                <div className="relative group/ai">
                  <Button variant="ghost" size="sm" onClick={async () => {
                    setIsGenerating(true);
                    try {
                      // Choisir l'action selon la catégorie du template
                      const actionMap: Record<string, string> = {
                        welcome: 'email_welcome',
                        followup: 'email_followup',
                        reminder: 'meeting_agenda',
                        notification: 'recap_call',
                        marketing: 'social_post',
                        general: 'email_followup',
                      };
                      const action = actionMap[formCategory] || 'email_followup';
                      const res = await fetch('/api/ai/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action, context: formName || formSubject || 'Template email professionnel' }),
                      });
                      const data = await res.json() as { data?: { content: string } };
                      if (data?.data?.content) setFormBody(data.data.content);
                    } catch { /* silencieux */ }
                    setIsGenerating(false);
                  }} isLoading={isGenerating} leftIcon={<Icon as={Wand2} size="xs" className="text-[#A855F7]" />} className="h-[24px] text-[10px] px-2 py-0 border border-[var(--border-subtle)] bg-white hover:bg-purple-50">
                    ✨ Générer avec IA
                  </Button>
                </div>
                <div className="flex bg-[var(--bg-subtle)] rounded p-0.5">
                  <button onClick={() => setEditorTab('code')} className={`px-2 py-0.5 text-[10px] rounded cursor-pointer ${editorTab === 'code' ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)]'}`}>{'</>'}Code</button>
                  <button onClick={() => setEditorTab('preview')} className={`px-2 py-0.5 text-[10px] rounded cursor-pointer ${editorTab === 'preview' ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)]'}`}>👁️ Aperçu</button>
                </div>
              </div>
            </div>
            {editorTab === 'code' ? (
              <textarea value={formBody} onChange={(e) => setFormBody(e.target.value)} rows={10}
                placeholder="<h2>Bonjour {{nom}},</h2><p>Merci pour votre intérêt...</p>"
                className="w-full px-3 py-2 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)] resize-none font-mono text-xs" />
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
                <span key={v} className="text-[10px] px-1.5 py-0.5 bg-[var(--primary)]/10 text-[var(--primary)] rounded font-mono">{`{{${v}}}`}</span>
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
      <Modal open={!!previewId} onOpenChange={() => setPreviewId(null)} title={previewTemplate ? `Aperçu : ${previewTemplate.name}` : 'Aperçu'}>
        {previewTemplate && (
          <div className="space-y-4">
            {/* En-tête email simulé */}
            <div className="bg-[var(--bg-subtle)] rounded-[var(--radius-md)] p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-muted)] w-8">De :</span>
                <span className="font-medium">contact@intralys.com</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-muted)] w-8">À :</span>
                <span className="font-medium text-[var(--primary)]">{'{{email}}'}</span>
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
      </div>
    </AppLayout>
  );
}