// ── FormBuilder — Éditeur de formulaires — Intralys CRM ─────

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DesktopOnlyBanner } from '@/components/DesktopOnlyBanner';
import { Card, Button, Badge, Input } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getForm, updateForm, getFormStats } from '@/lib/api';
import { ArrowLeft, Save, Eye, GripVertical, Plus, Trash2, Settings, BarChart3, Code, Copy } from 'lucide-react';

type FieldType = 'text' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox' | 'radio' | 'textarea' | 'file' | 'hidden';

interface FormField {
  id: string; type: FieldType; name: string; label: string;
  placeholder: string; required: boolean; validation?: string;
  options?: string[]; custom_field_id?: string; weight?: number;
}

interface FormStatsData { total_views: number; total_submissions: number; conversion_rate: string; }

const FIELD_TYPES: Array<{ type: FieldType; label: string; icon: string }> = [
  { type: 'text', label: 'Texte', icon: '📝' }, { type: 'email', label: 'Email', icon: '📧' },
  { type: 'phone', label: 'Téléphone', icon: '📞' }, { type: 'number', label: 'Nombre', icon: '🔢' },
  { type: 'date', label: 'Date', icon: '📅' }, { type: 'select', label: 'Liste déroulante', icon: '📋' },
  { type: 'multiselect', label: 'Multi-sélection', icon: '☑️' }, { type: 'checkbox', label: 'Case à cocher', icon: '✅' },
  { type: 'radio', label: 'Boutons radio', icon: '🔘' }, { type: 'textarea', label: 'Zone de texte', icon: '📄' },
  { type: 'file', label: 'Fichier', icon: '📎' }, { type: 'hidden', label: 'Champ caché', icon: '👁️‍🗨️' },
];

function SortableField({ field, isSelected, onSelect, onDelete }: {
  field: FormField; isSelected: boolean; onSelect: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: field.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const ft = FIELD_TYPES.find(f => f.type === field.type);
  return (
    <div ref={setNodeRef} style={style} onClick={onSelect} className={`form-field-item ${isSelected ? 'selected' : ''}`}>
      <div className="field-drag" {...attributes} {...listeners}><GripVertical size={14} /></div>
      <span className="field-icon">{ft?.icon || '📝'}</span>
      <div className="field-info">
        <span className="field-label-text">{field.label || field.name}</span>
        <span className="field-type-badge">{ft?.label} {field.required ? '•' : ''}</span>
      </div>
      <button className="field-delete" onClick={e => { e.stopPropagation(); onDelete(); }}><Trash2 size={14} /></button>
    </div>
  );
}

export function FormBuilderPage() {
  const { formId } = useParams({ strict: false }) as { formId: string };
  const navigate = useNavigate();
  const [fields, setFields] = useState<FormField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formType, setFormType] = useState<'form' | 'survey' | 'quiz'>('form');
  const [successMessage, setSuccessMessage] = useState('Merci !');
  const [isSaving, setIsSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const [stats, setStats] = useState<FormStatsData | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const loadForm = useCallback(async () => {
    if (!formId) return;
    const result = await getForm(formId);
    if (result.data) {
      const d = result.data;
      setFormName((d.name as string) || '');
      setFormSlug((d.slug as string) || '');
      setFormType(((d.form_type as string) || 'form') as 'form' | 'survey' | 'quiz');
      setSuccessMessage((d.success_message as string) || 'Merci !');
      try { setFields(JSON.parse((d.fields as string) || '[]')); } catch { /* ignore */ }
    }
  }, [formId]);

  useEffect(() => { void loadForm(); }, [loadForm]);

  const selectedField = fields.find(f => f.id === selectedFieldId) || null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFields(arrayMove(fields, fields.findIndex(f => f.id === active.id), fields.findIndex(f => f.id === over.id)));
  };

  const addField = (type: FieldType) => {
    const id = crypto.randomUUID();
    const ft = FIELD_TYPES.find(f => f.type === type);
    const newField: FormField = {
      id, type, name: `field_${Date.now()}`, label: ft?.label || type, placeholder: '', required: false,
      options: ['select', 'multiselect', 'radio'].includes(type) ? ['Option 1', 'Option 2'] : undefined,
    };
    setFields(prev => [...prev, newField]);
    setSelectedFieldId(id);
  };

  const updateField = (updated: FormField) => setFields(prev => prev.map(f => f.id === updated.id ? updated : f));
  const deleteField = (id: string) => { setFields(prev => prev.filter(f => f.id !== id)); if (selectedFieldId === id) setSelectedFieldId(null); };

  const handleSave = async () => {
    setIsSaving(true);
    await updateForm(formId, { name: formName, fields, form_type: formType, success_message: successMessage });
    setIsSaving(false);
  };

  const loadStats = async () => {
    const result = await getFormStats(formId);
    if (result.data) setStats(result.data);
    setShowStats(true);
  };

  const embedCode = `<script src="https://crm.intralys.com/f/${formSlug}.js" async></script>`;

  return (
    <AppLayout title="Form Builder">
      <DesktopOnlyBanner />
      <div className="hidden lg:block">
      <style>{formBuilderStyles}</style>

      <div className="builder-topbar">
        <div className="builder-topbar-left">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/templates' })}>
            <ArrowLeft size={16} /> Retour
          </Button>
          <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Nom du formulaire"
            style={{ fontWeight: 600, fontSize: '15px', background: 'transparent', border: 'none', padding: 0, maxWidth: 300 }} />
          <Badge style={{ background: formType === 'quiz' ? '#a855f7' : formType === 'survey' ? '#f59e0b' : 'var(--brand-primary)', color: 'white' }}>
            {formType.toUpperCase()}
          </Badge>
        </div>
        <div className="builder-topbar-actions">
          <select className="prop-select" style={{ width: 'auto' }} value={formType}
            onChange={e => setFormType(e.target.value as 'form' | 'survey' | 'quiz')}>
            <option value="form">Formulaire</option><option value="survey">Sondage</option><option value="quiz">Quiz</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}><Eye size={14} /> Aperçu</Button>
          <Button variant="ghost" size="sm" onClick={loadStats}><BarChart3 size={14} /> Stats</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowEmbed(true)}><Code size={14} /> Embed</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}><Settings size={14} /></Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
            <Save size={14} /> {isSaving ? '...' : 'Sauver'}
          </Button>
        </div>
      </div>

      <div className="builder-layout">
        <div className="builder-palette">
          <h4 className="palette-title">Champs</h4>
          {FIELD_TYPES.map(ft => (
            <button key={ft.type} className="palette-item" onClick={() => addField(ft.type)}>
              <span className="palette-icon">{ft.icon}</span><span>{ft.label}</span><Plus size={14} className="palette-add" />
            </button>
          ))}
        </div>

        <div className="builder-canvas-container">
          <div className="builder-canvas-blocks" style={{ flex: 1 }}>
            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                {fields.length === 0 ? (
                  <div className="canvas-empty"><Plus size={32} style={{ opacity: 0.3 }} /><p>Ajoutez des champs depuis la palette</p></div>
                ) : fields.map(field => (
                  <SortableField key={field.id} field={field} isSelected={selectedFieldId === field.id}
                    onSelect={() => setSelectedFieldId(field.id)} onDelete={() => deleteField(field.id)} />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          {showPreview && (
            <div className="form-preview-pane">
              <h4 style={{ margin: '0 0 16px', fontSize: '15px' }}>Aperçu</h4>
              <div className="form-preview-card">
                {fields.map(field => (
                  <div key={field.id} style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: 4 }}>
                      {field.label} {field.required && <span style={{ color: 'var(--danger)' }}>*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea rows={3} placeholder={field.placeholder} disabled style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-default)' }} />
                    ) : field.type === 'select' || field.type === 'multiselect' ? (
                      <select disabled style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-default)' }}>
                        {field.options?.map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type={field.type} placeholder={field.placeholder} disabled style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-default)' }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="builder-properties">
          {selectedField ? (
            <div className="block-props">
              <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
                Propriétés
              </h4>
              <label className="prop-label">Label</label>
              <Input value={selectedField.label} onChange={e => updateField({ ...selectedField, label: e.target.value })} />
              <label className="prop-label">Nom (slug)</label>
              <Input value={selectedField.name} onChange={e => updateField({ ...selectedField, name: e.target.value })} />
              <label className="prop-label">Placeholder</label>
              <Input value={selectedField.placeholder} onChange={e => updateField({ ...selectedField, placeholder: e.target.value })} />
              <label className="prop-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={selectedField.required} onChange={e => updateField({ ...selectedField, required: e.target.checked })} /> Obligatoire
              </label>
              {selectedField.options && (
                <>
                  <label className="prop-label">Options (1 par ligne)</label>
                  <textarea className="prop-textarea" rows={4} value={selectedField.options.join('\n')}
                    onChange={e => updateField({ ...selectedField, options: e.target.value.split('\n') })} />
                </>
              )}
              {formType === 'quiz' && selectedField.options && (
                <>
                  <label className="prop-label">Poids (quiz)</label>
                  <Input type="number" value={selectedField.weight || 0} onChange={e => updateField({ ...selectedField, weight: Number(e.target.value) })} />
                </>
              )}
              <label className="prop-label">Custom Field ID</label>
              <Input value={selectedField.custom_field_id || ''} onChange={e => updateField({ ...selectedField, custom_field_id: e.target.value })} placeholder="Optionnel" />
              <div style={{ marginTop: 16 }}>
                <Button variant="ghost" size="sm" onClick={() => {
                  const dup = { ...selectedField, id: crypto.randomUUID(), name: `${selectedField.name}_copy` };
                  setFields(prev => [...prev, dup]); setSelectedFieldId(dup.id);
                }}><Copy size={14} /> Dupliquer</Button>
              </div>
            </div>
          ) : (
            <div className="block-props-empty">Sélectionnez un champ</div>
          )}
        </div>
      </div>

      <Modal open={showStats} onOpenChange={() => setShowStats(false)} title="Statistiques">
        {stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <Card><div style={{ textAlign: 'center', padding: 12 }}><div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--brand-primary)' }}>{stats.total_views}</div><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Vues</div></div></Card>
            <Card><div style={{ textAlign: 'center', padding: 12 }}><div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--success)' }}>{stats.total_submissions}</div><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Soumissions</div></div></Card>
            <Card><div style={{ textAlign: 'center', padding: 12 }}><div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--warning)' }}>{stats.conversion_rate}%</div><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Conversion</div></div></Card>
          </div>
        ) : <p style={{ color: 'var(--text-muted)' }}>Chargement...</p>}
      </Modal>

      <Modal open={showEmbed} onOpenChange={() => setShowEmbed(false)} title="Intégration">
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: 12 }}>
            URL publique : <code style={{ color: 'var(--brand-primary)' }}>https://crm.intralys.com/f/{formSlug}</code>
          </p>
          <label className="prop-label">Code d'intégration</label>
          <textarea className="prop-textarea" rows={3} value={embedCode} readOnly onClick={e => (e.target as HTMLTextAreaElement).select()} />
          <Button variant="primary" size="sm" style={{ marginTop: 8 }} onClick={() => { navigator.clipboard.writeText(embedCode); }}>
            <Copy size={14} /> Copier
          </Button>
        </div>
      </Modal>

      <Modal open={showSettings} onOpenChange={() => setShowSettings(false)} title="Paramètres">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label className="prop-label">Message de succès</label><Input value={successMessage} onChange={e => setSuccessMessage(e.target.value)} /></div>
          <div><label className="prop-label">Slug URL</label><Input value={formSlug} onChange={e => setFormSlug(e.target.value)} /></div>
          {formType === 'quiz' && (
            <Card style={{ padding: 12 }}>
              <h5 style={{ margin: '0 0 8px', fontSize: '13px' }}>Scoring Quiz (3 ranges)</h5>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>0-33 → Score faible<br />34-66 → Bon potentiel<br />67-100 → Excellent profil</p>
            </Card>
          )}
        </div>
      </Modal>
      </div>
    </AppLayout>
  );
}

const formBuilderStyles = `
.form-field-item { display:flex; align-items:center; gap:8px; padding:10px 12px; border:2px solid transparent; border-radius:8px; background:var(--bg-surface); margin-bottom:4px; cursor:pointer; transition:all 0.15s; }
.form-field-item:hover { border-color:rgba(0,157,219,0.2); }
.form-field-item.selected { border-color:var(--brand-primary); background:rgba(0,157,219,0.04); }
.field-drag { cursor:grab; color:var(--text-muted); }
.field-icon { font-size:16px; }
.field-info { flex:1; display:flex; flex-direction:column; gap:2px; }
.field-label-text { font-size:13px; font-weight:500; }
.field-type-badge { font-size:11px; color:var(--text-muted); }
.field-delete { border:none; background:transparent; cursor:pointer; color:var(--text-muted); opacity:0; transition:opacity 0.15s; }
.form-field-item:hover .field-delete { opacity:1; }
.form-preview-pane { border-top:1px solid var(--border-default); padding:16px; overflow-y:auto; max-height:350px; background:var(--bg-canvas); }
.form-preview-card { max-width:400px; margin:0 auto; padding:20px; background:var(--bg-surface); border-radius:12px; border:1px solid var(--border-default); }
`;