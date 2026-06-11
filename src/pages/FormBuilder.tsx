// ── FormBuilder — Éditeur de formulaires — Intralys CRM ─────

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DesktopOnlyBanner } from '@/components/DesktopOnlyBanner';
import { Card, Button, Tag, Input, Skeleton, Select, Textarea, Switch, KpiStrip, Icon } from '@/components/ui';
import type { KpiItem } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getForm, updateForm, getFormStats, getFormFieldAnalytics } from '@/lib/api';
import type { FormFieldCondition, FormFieldConditionOperator, FormFieldAnalyticsRow } from '@/lib/types';
import { ArrowLeft, Save, Eye, GripVertical, Plus, Trash2, Settings, BarChart3, Code, Copy } from 'lucide-react';
import { t } from '@/lib/i18n';

type FieldType = 'text' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox' | 'radio' | 'textarea' | 'file' | 'hidden';

interface FormField {
  id: string; type: FieldType; name: string; label: string;
  placeholder: string; required: boolean; validation?: string;
  options?: string[]; custom_field_id?: string; weight?: number;
  // ── LOT FORMS XL (Sprint 5) — attributs additifs OPTIONNELS (§6.B-bis) ──
  conditional?: FormFieldCondition;   // show-if. Absent = toujours visible.
  step?: number;                      // multi-étapes. Absent/0 = étape 1.
}

const COND_OPERATORS: FormFieldConditionOperator[] = ['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty'];

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
      <div className="field-drag" {...attributes} {...listeners}><Icon as={GripVertical} size="sm" /></div>
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
  // Sprint 51 M3.1 — Consentement Loi 25 (back-compat : défaut désactivé)
  const [requireConsent, setRequireConsent] = useState(false);
  const [consentText, setConsentText] = useState(
    "J'accepte d'être recontacté(e) par courriel ou téléphone, conformément à la Loi 25."
  );
  const [redirectUrl, setRedirectUrl] = useState('');
  // Sprint 51 M3.1 — settings_json brut conservé pour merge non destructif (ex: quiz_results)
  const [rawSettings, setRawSettings] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const [stats, setStats] = useState<FormStatsData | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // ── LOT FORMS XL — onglet analytics drop-off par champ ──
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analytics, setAnalytics] = useState<FormFieldAnalyticsRow[] | null>(null);

  const loadForm = useCallback(async () => {
    if (!formId) { setIsLoading(false); return; }
    setIsLoading(true);
    const result = await getForm(formId);
    if (result.data) {
      const d = result.data;
      setFormName((d.name as string) || '');
      setFormSlug((d.slug as string) || '');
      setFormType(((d.form_type as string) || 'form') as 'form' | 'survey' | 'quiz');
      setSuccessMessage((d.success_message as string) || 'Merci !');
      setRedirectUrl((d.redirect_url as string) || '');
      try { setFields(JSON.parse((d.fields as string) || '[]')); } catch { /* ignore */ }
      // Sprint 51 M3.1 — relire le bloc consentement depuis settings_json
      try {
        const s = JSON.parse((d.settings_json as string) || '{}') as Record<string, unknown> & {
          require_consent?: boolean; consent_text?: string;
        };
        setRawSettings(s);
        if (typeof s.require_consent === 'boolean') setRequireConsent(s.require_consent);
        if (s.consent_text) setConsentText(s.consent_text as string);
      } catch { /* ignore */ }
    }
    setIsLoading(false);
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
    // Sprint 51 M3.1 — merge non destructif : conserve quiz_results & autres clés existantes
    const mergedSettings = {
      ...rawSettings,
      require_consent: requireConsent,
      consent_text: consentText,
    };
    await updateForm(formId, {
      name: formName, fields, form_type: formType,
      success_message: successMessage, settings_json: mergedSettings,
      redirect_url: redirectUrl,
    });
    setRawSettings(mergedSettings);
    setIsSaving(false);
  };

  const loadStats = async () => {
    const result = await getFormStats(formId);
    if (result.data) setStats(result.data);
    setShowStats(true);
  };

  // ── LOT FORMS XL — drop-off par champ (getFormFieldAnalytics, best-effort) ──
  const loadAnalytics = async () => {
    setShowAnalytics(true);
    setAnalytics(null);
    const result = await getFormFieldAnalytics(formId);
    setAnalytics(result.data ?? []);
  };

  const embedCode = `<script src="https://crm.intralys.com/f/${formSlug}.js" async></script>`;

  return (
    <AppLayout title="Form Builder">
      <DesktopOnlyBanner />
      <div className="hidden lg:block animate-stagger">
      <style>{formBuilderStyles}</style>

      <div className="builder-topbar">
        <div className="builder-topbar-left">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/forms' })}>
            <Icon as={ArrowLeft} size="md" /> {t('fb.back')}
          </Button>
          <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t('fb.form_name_ph')}
            style={{ fontWeight: 600, fontSize: '15px', background: 'transparent', border: 'none', padding: 0, maxWidth: 300 }} />
          <Tag solid size="sm" color={formType === 'quiz' ? '#a855f7' : formType === 'survey' ? '#f59e0b' : '#635BFF'}>
            {formType.toUpperCase()}
          </Tag>
        </div>
        <div className="builder-topbar-actions">
          <Select size="sm" style={{ width: 'auto', minWidth: 140 }} value={formType}
            onChange={e => setFormType(e.target.value as 'form' | 'survey' | 'quiz')}>
            <option value="form">{t('fb.type.form')}</option><option value="survey">{t('fb.type.survey')}</option><option value="quiz">{t('fb.type.quiz')}</option>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}><Icon as={Eye} size="sm" /> {t('fb.preview')}</Button>
          <Button variant="ghost" size="sm" onClick={loadStats}><BarChart3 size={14} /> Stats</Button>
          <Button variant="ghost" size="sm" onClick={loadAnalytics}><BarChart3 size={14} /> {t('fb.analytics.title')}</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowEmbed(true)}><Icon as={Code} size="sm" /> Embed</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)} aria-label={t('formbuilder.action.settings_aria')}><Icon as={Settings} size="sm" /></Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
            <Icon as={Save} size="sm" /> {isSaving ? '...' : t('fb.save')}
          </Button>
        </div>
      </div>

      <div className="builder-layout">
        <div className="builder-palette">
          <h4 className="palette-title">{t('fb.palette.title')}</h4>
          {FIELD_TYPES.map(ft => (
            <button key={ft.type} className="action-chip" onClick={() => addField(ft.type)} style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 6 }}>
              <span className="action-chip-icon">{ft.icon}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>{ft.label}</span>
              <Icon as={Plus} size="sm" className="palette-add" />
            </button>
          ))}
        </div>

        <div className="builder-canvas-container">
          <div className="builder-canvas-blocks" style={{ flex: 1 }}>
            {isLoading ? (
              /* Skeleton field rows : handle drag + label + input + actions (staggered) */
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', animationDelay: `${i * 40}ms` }}
                  >
                    <Skeleton className="h-4 w-4 rounded shrink-0" style={{ animationDelay: `${i * 40}ms` }} />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-2.5 w-24" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                      <Skeleton className="h-9 w-full rounded-md" style={{ animationDelay: `${i * 40 + 40}ms` }} />
                    </div>
                    <Skeleton className="h-6 w-6 rounded shrink-0" style={{ animationDelay: `${i * 40 + 60}ms` }} />
                    <Skeleton className="h-6 w-6 rounded shrink-0" style={{ animationDelay: `${i * 40 + 80}ms` }} />
                  </div>
                ))}
              </div>
            ) : (
              <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                  {fields.length === 0 ? (
                    <div className="canvas-empty"><Icon as={Plus} size={32} style={{ opacity: 0.3 }} /><p>{t('fb.canvas.empty')}</p></div>
                  ) : fields.map(field => (
                    <SortableField key={field.id} field={field} isSelected={selectedFieldId === field.id}
                      onSelect={() => setSelectedFieldId(field.id)} onDelete={() => deleteField(field.id)} />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </div>

          {showPreview && (
            <div className="form-preview-pane">
              <h4 style={{ margin: '0 0 16px', fontSize: '15px' }}>{t('fb.preview')}</h4>
              <div className="form-preview-card">
                {fields.map(field => (
                  <div key={field.id} style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: 4 }}>
                      {field.label} {field.required && <span style={{ color: 'var(--danger)' }}>*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <Textarea rows={3} placeholder={field.placeholder} disabled />
                    ) : field.type === 'select' || field.type === 'multiselect' ? (
                      <Select disabled size="sm">
                        {field.options?.map(o => <option key={o}>{o}</option>)}
                      </Select>
                    ) : field.type === 'checkbox' ? (
                      <Switch checked={false} onCheckedChange={() => {}} disabled size="sm" />
                    ) : (
                      <Input type={field.type === 'phone' ? 'tel' : field.type} placeholder={field.placeholder} disabled />
                    )}
                  </div>
                ))}
                {/* Sprint 51 M3.1 — aperçu du consentement obligatoire */}
                {requireConsent && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <input type="checkbox" disabled style={{ marginTop: 3 }} aria-hidden="true" />
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {consentText} <span style={{ color: 'var(--danger)' }}>*</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="builder-properties">
          {selectedField ? (
            <div className="block-props">
              <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>
                {t('fb.props.title')}
              </h4>
              <label className="prop-label">Label</label>
              <Input value={selectedField.label} onChange={e => updateField({ ...selectedField, label: e.target.value })} />
              <label className="prop-label">Nom (slug)</label>
              <Input value={selectedField.name} onChange={e => updateField({ ...selectedField, name: e.target.value })} />
              <label className="prop-label">Placeholder</label>
              <Input value={selectedField.placeholder} onChange={e => updateField({ ...selectedField, placeholder: e.target.value })} />
              <div style={{ marginTop: 10, marginBottom: 6 }}>
                <Switch
                  checked={selectedField.required}
                  onCheckedChange={(v) => updateField({ ...selectedField, required: v })}
                  size="sm"
                  variant="brand"
                  label={t('fb.props.required')}
                />
              </div>
              {selectedField.options && (
                <>
                  <label className="prop-label">{t('fb.props.options')}</label>
                  <Textarea rows={4} value={selectedField.options.join('\n')}
                    onChange={e => updateField({ ...selectedField, options: e.target.value.split('\n') })} />
                </>
              )}
              {formType === 'quiz' && selectedField.options && (
                <>
                  <label className="prop-label">{t('fb.props.weight')}</label>
                  <Input type="number" value={selectedField.weight || 0} onChange={e => updateField({ ...selectedField, weight: Number(e.target.value) })} />
                </>
              )}
              <label className="prop-label">Custom Field ID</label>
              <Input value={selectedField.custom_field_id || ''} onChange={e => updateField({ ...selectedField, custom_field_id: e.target.value })} placeholder="Optionnel" />

              {/* ── LOT FORMS XL — Multi-étapes : numéro d'étape (clé `step`) ── */}
              <label className="prop-label" style={{ marginTop: 12 }}>{t('fb.step.title')}</label>
              <Input
                type="number"
                min={1}
                value={selectedField.step && selectedField.step > 0 ? selectedField.step : 1}
                onChange={e => {
                  const n = Math.max(1, Number(e.target.value) || 1);
                  updateField({ ...selectedField, step: n });
                }}
              />

              {/* ── LOT FORMS XL — Logique conditionnelle (clé `conditional`) ── */}
              <label className="prop-label" style={{ marginTop: 12 }}>{t('fb.cond.title')}</label>
              <Select
                value={selectedField.conditional?.field_name || ''}
                onChange={e => {
                  const fieldName = e.target.value;
                  if (!fieldName) {
                    // conditional absent ⇒ champ toujours visible (§6.B-bis).
                    // undefined est omis par JSON.stringify à la sauvegarde.
                    updateField({ ...selectedField, conditional: undefined });
                  } else {
                    updateField({
                      ...selectedField,
                      conditional: {
                        field_name: fieldName,
                        operator: selectedField.conditional?.operator || 'equals',
                        value: selectedField.conditional?.value,
                      },
                    });
                  }
                }}
              >
                <option value="">{t('fb.cond.none')}</option>
                {fields.filter(f => f.id !== selectedField.id).map(f => (
                  <option key={f.id} value={f.name}>{f.label || f.name}</option>
                ))}
              </Select>
              {selectedField.conditional && (
                <>
                  <label className="prop-label" style={{ marginTop: 8 }}>{t('fb.cond.operator')}</label>
                  <Select
                    value={selectedField.conditional.operator}
                    onChange={e => updateField({
                      ...selectedField,
                      conditional: { ...selectedField.conditional!, operator: e.target.value as FormFieldConditionOperator },
                    })}
                  >
                    {COND_OPERATORS.map(op => (
                      <option key={op} value={op}>{t(`fb.cond.op.${op}`)}</option>
                    ))}
                  </Select>
                  {selectedField.conditional.operator !== 'is_empty' && selectedField.conditional.operator !== 'is_not_empty' && (
                    <>
                      <label className="prop-label" style={{ marginTop: 8 }}>{t('fb.cond.value')}</label>
                      <Input
                        value={selectedField.conditional.value || ''}
                        onChange={e => updateField({
                          ...selectedField,
                          conditional: { ...selectedField.conditional!, value: e.target.value },
                        })}
                      />
                    </>
                  )}
                </>
              )}

              <div style={{ marginTop: 16 }}>
                <Button variant="ghost" size="sm" onClick={() => {
                  const dup = { ...selectedField, id: crypto.randomUUID(), name: `${selectedField.name}_copy` };
                  setFields(prev => [...prev, dup]); setSelectedFieldId(dup.id);
                }}><Icon as={Copy} size="sm" /> {t('fb.props.duplicate')}</Button>
              </div>
            </div>
          ) : (
            <div className="block-props-empty">{t('fb.props.select_field')}</div>
          )}
        </div>
      </div>

      <Modal open={showStats} onOpenChange={() => setShowStats(false)} title={t('fb.stats.title')}>
        {stats ? (
          (() => {
            const statsKpis: KpiItem[] = [
              { label: t('fb.stats.views'), value: stats.total_views, color: 'brand' },
              { label: t('fb.stats.subs'), value: stats.total_submissions, color: 'success' },
              { label: t('fb.stats.conversion'), value: `${stats.conversion_rate}%`, color: 'warning' },
            ];
            return <KpiStrip items={statsKpis} className="!mb-0" />;
          })()
        ) : <p style={{ color: 'var(--text-muted)' }}>{t('fb.stats.loading')}</p>}
      </Modal>

      <Modal open={showAnalytics} onOpenChange={() => setShowAnalytics(false)} title={t('fb.analytics.title')}>
        {analytics === null ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('fb.stats.loading')}</p>
        ) : analytics.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('fb.analytics.empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {analytics.map(row => {
              const completionPct = Math.round((1 - (row.dropoff_rate || 0)) * 100);
              const dropoffPct = Math.round((row.dropoff_rate || 0) * 100);
              const label = fields.find(f => f.name === row.field_name)?.label || row.field_name;
              return (
                <div key={row.field_name} style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{label}</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {t('fb.analytics.reached')}: {row.reached} · {t('fb.analytics.completion')}: {completionPct}%
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-canvas)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${completionPct}%`, background: 'var(--primary, #635BFF)' }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('fb.analytics.dropoff')}: {dropoffPct}%
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal open={showEmbed} onOpenChange={() => setShowEmbed(false)} title={t('fb.embed.title')}>
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: 12 }}>
            URL publique : <code style={{ color: 'var(--primary)' }}>https://crm.intralys.com/f/{formSlug}</code>
          </p>
          <label className="prop-label">{t('formbuilder.embed.code_label')}</label>
          <Textarea rows={3} value={embedCode} readOnly className="font-mono text-xs" onClick={e => (e.target as HTMLTextAreaElement).select()} />
          <Button variant="primary" size="sm" style={{ marginTop: 8 }} onClick={() => { navigator.clipboard.writeText(embedCode); }}>
            <Icon as={Copy} size="sm" /> {t('fb.embed.copy')}
          </Button>
        </div>
      </Modal>

      <Modal open={showSettings} onOpenChange={() => setShowSettings(false)} title={t('fb.settings.title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label className="prop-label">{t('fb.settings.success_msg')}</label><Input value={successMessage} onChange={e => setSuccessMessage(e.target.value)} /></div>
          <div>
            <label className="prop-label">{t('fb.settings.redirect')}</label>
            <Input value={redirectUrl} onChange={e => setRedirectUrl(e.target.value)} placeholder="https://votresite.com/merci" />
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 4 }}>
              Si renseignée, le widget redirige le visiteur ici après une soumission réussie.
            </p>
          </div>
          <div><label className="prop-label">Slug URL</label><Input value={formSlug} onChange={e => setFormSlug(e.target.value)} /></div>

          {/* Sprint 51 M3.1 — Consentement Loi 25 */}
          <Card style={{ padding: 12 }}>
            <Switch
              checked={requireConsent}
              onCheckedChange={setRequireConsent}
              size="sm"
              variant="brand"
              label="Champ de consentement obligatoire (Loi 25)"
            />
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Ajoute une case à cocher obligatoire au formulaire publié. La soumission
              est bloquée tant que le visiteur n'a pas consenti, et le consentement
              est journalisé avec le lead.
            </p>
            {requireConsent && (
              <div style={{ marginTop: 10 }}>
                <label className="prop-label">Texte du consentement</label>
                <Textarea
                  rows={2}
                  value={consentText}
                  onChange={e => setConsentText(e.target.value)}
                  placeholder={t('formbuilder.field.consent_placeholder')}
                />
              </div>
            )}
          </Card>

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
.form-field-item:hover { border-color:rgba(99,91,255,0.2); }
.form-field-item.selected { border-color:var(--primary); background:rgba(99,91,255,0.04); }
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