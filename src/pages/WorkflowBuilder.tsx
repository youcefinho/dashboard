// ── WorkflowBuilder — Création/édition de workflow avec builder visuel ──

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Modal } from '@/components/ui';
import { createWorkflow } from '@/lib/api';
import type { TriggerType, StepType } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS, STEP_TYPE_LABELS, STEP_TYPE_ICONS, STEP_TYPES, TRIGGER_TYPES } from '@/lib/types';

interface BuilderStep {
  step_order: number;
  step_type: StepType;
  config: Record<string, unknown>;
}

export function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('lead_created');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, string>>({});
  const [steps, setSteps] = useState<BuilderStep[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);

  // Ajouter un step
  const addStep = (stepType: StepType) => {
    const newStep: BuilderStep = {
      step_order: steps.length + 1,
      step_type: stepType,
      config: getDefaultConfig(stepType),
    };
    setSteps([...steps, newStep]);
    setShowAddStep(false);
  };

  const getDefaultConfig = (type: StepType): Record<string, unknown> => {
    switch (type) {
      case 'wait': return { delay_minutes: 1440 };
      case 'send_email': return { template_id: '', delay_minutes: 0 };
      case 'send_sms': return { message: '', delay_minutes: 0 };
      case 'add_tag': return { tag: '' };
      case 'remove_tag': return { tag: '' };
      case 'change_status': return { status: 'contacted' };
      case 'notify': return { message: '' };
      case 'condition': return { field: 'type', operator: 'equals', value: 'buy' };
      case 'webhook': return { url: '', method: 'POST' };
      default: return {};
    }
  };

  const updateStep = (index: number, config: Record<string, unknown>) => {
    const updated = [...steps];
    const existing = updated[index];
    if (existing) {
      updated[index] = { ...existing, config };
    }
    setSteps(updated);
  };

  // Supprimer un step
  const removeStep = (index: number) => {
    const updated = steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i + 1 }));
    setSteps(updated);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === steps.length - 1) return;
    const updated = [...steps];
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    const a = updated[index];
    const b = updated[swapIdx];
    if (a && b) {
      updated[index] = b;
      updated[swapIdx] = a;
    }
    setSteps(updated.map((s, i) => ({ ...s, step_order: i + 1 })));
  };

  // Sauvegarder
  const handleSave = async () => {
    if (!name.trim() || steps.length === 0) return;
    setIsSaving(true);

    const result = await createWorkflow({
      name: name.trim(),
      description: description.trim(),
      trigger_type: triggerType,
      trigger_config: JSON.stringify(triggerConfig),
      steps: steps.map(s => ({
        step_order: s.step_order,
        step_type: s.step_type,
        config: JSON.stringify(s.config),
      })),
    });

    setIsSaving(false);
    if (result.data?.id) {
      void navigate({ to: '/workflows' });
    }
  };

  const formatDelay = (minutes: number): string => {
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
    return `${Math.round(minutes / 1440)} jour(s)`;
  };

  return (
    <AppLayout title="Nouveau workflow">
      <button onClick={() => void navigate({ to: '/workflows' })}
        className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-accent)] mb-4 flex items-center gap-1 cursor-pointer">
        ← Retour aux automations
      </button>

      <div className="max-w-3xl space-y-4">
        {/* ── Infos de base ───────────────────────────── */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3">📝 Informations</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Nom du workflow</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Relance nouveau lead" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Décrivez ce que fait cette automation..."
                rows={2}
                className="w-full px-3 py-2 bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
              />
            </div>
          </div>
        </Card>

        {/* ── Déclencheur ─────────────────────────────── */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3">⚡ Déclencheur</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TRIGGER_TYPES.map((tt) => (
              <button
                key={tt}
                onClick={() => { setTriggerType(tt); setTriggerConfig({}); }}
                className={`p-3 rounded-[var(--radius-md)] border text-left transition-all cursor-pointer ${
                  triggerType === tt
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-border-subtle)] hover:border-[var(--color-accent)]/50'
                }`}
              >
                <p className="text-lg mb-1">{TRIGGER_ICONS[tt]}</p>
                <p className="text-xs font-medium">{TRIGGER_LABELS[tt]}</p>
              </button>
            ))}
          </div>

          {/* Config trigger conditionnelle */}
          {triggerType === 'status_changed' && (
            <div className="mt-3 flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-[var(--color-text-muted)]">Vers le statut</label>
                <select value={triggerConfig.to_status || ''} onChange={(e) => setTriggerConfig({ ...triggerConfig, to_status: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-sm focus:outline-none focus:border-[var(--color-accent)]">
                  <option value="">N'importe quel statut</option>
                  <option value="new">Nouveau</option>
                  <option value="contacted">Contacté</option>
                  <option value="meeting">RDV</option>
                  <option value="signed">Signé</option>
                  <option value="closed">Fermé</option>
                  <option value="lost">Perdu</option>
                </select>
              </div>
            </div>
          )}
          {triggerType === 'score_threshold' && (
            <div className="mt-3">
              <label className="text-xs text-[var(--color-text-muted)]">Score minimum</label>
              <Input type="number" value={triggerConfig.min_score || ''} onChange={(e) => setTriggerConfig({ ...triggerConfig, min_score: e.target.value })} placeholder="70" />
            </div>
          )}
          {triggerType === 'tag_added' && (
            <div className="mt-3">
              <label className="text-xs text-[var(--color-text-muted)]">Tag spécifique</label>
              <Input value={triggerConfig.tag || ''} onChange={(e) => setTriggerConfig({ ...triggerConfig, tag: e.target.value })} placeholder="Ex: chaud" />
            </div>
          )}
        </Card>

        {/* ── Builder de steps ────────────────────────── */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">🔗 Étapes ({steps.length})</h3>
          </div>

          {steps.length === 0 ? (
            <div className="text-center py-6 text-[var(--color-text-muted)]">
              <p className="text-2xl mb-2">🔗</p>
              <p className="text-sm">Aucune étape</p>
              <p className="text-xs mt-1">Ajoutez des étapes pour construire votre automation.</p>
            </div>
          ) : (
            <div className="space-y-0">
              {steps.map((step, i) => {
                const isLast = i === steps.length - 1;

                return (
                  <div key={i}>
                    <div className="flex items-start gap-3">
                      {/* Icône + ligne */}
                      <div className="flex flex-col items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${
                          step.step_type === 'wait' ? 'bg-[var(--color-warning)]/15' : 'bg-[var(--color-accent)]/15'
                        }`}>
                          {STEP_TYPE_ICONS[step.step_type]}
                        </div>
                        {!isLast && <div className="w-0.5 h-full min-h-[2rem] bg-[var(--color-border-subtle)]" />}
                      </div>

                      {/* Contenu du step */}
                      <div className="flex-1 pb-3 bg-[var(--color-bg-tertiary)] rounded-[var(--radius-md)] p-3 mb-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold">
                            #{step.step_order} — {STEP_TYPE_LABELS[step.step_type]}
                          </span>
                          <div className="flex gap-1">
                            <button onClick={() => moveStep(i, 'up')} disabled={i === 0}
                              className="text-xs px-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] cursor-pointer disabled:opacity-30">↑</button>
                            <button onClick={() => moveStep(i, 'down')} disabled={isLast}
                              className="text-xs px-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] cursor-pointer disabled:opacity-30">↓</button>
                            <button onClick={() => removeStep(i)}
                              className="text-xs px-1 text-[var(--color-danger)] hover:underline cursor-pointer">✕</button>
                          </div>
                        </div>

                        {/* Config spécifique au type de step */}
                        {step.step_type === 'wait' && (
                          <div>
                            <label className="text-[10px] text-[var(--color-text-muted)]">Durée d'attente</label>
                            <select value={step.config.delay_minutes as number}
                              onChange={(e) => updateStep(i, { ...step.config, delay_minutes: Number(e.target.value) })}
                              className="w-full mt-1 px-2 py-1.5 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] focus:outline-none">
                              <option value={30}>30 minutes</option>
                              <option value={60}>1 heure</option>
                              <option value={360}>6 heures</option>
                              <option value={720}>12 heures</option>
                              <option value={1440}>1 jour</option>
                              <option value={2880}>2 jours</option>
                              <option value={4320}>3 jours</option>
                              <option value={10080}>7 jours</option>
                              <option value={20160}>14 jours</option>
                            </select>
                            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">= {formatDelay(step.config.delay_minutes as number)}</p>
                          </div>
                        )}

                        {step.step_type === 'send_email' && (
                          <div>
                            <label className="text-[10px] text-[var(--color-text-muted)]">Template ID</label>
                            <Input value={step.config.template_id as string}
                              onChange={(e) => updateStep(i, { ...step.config, template_id: e.target.value })}
                              placeholder="tpl-welcome" />
                          </div>
                        )}

                        {step.step_type === 'send_sms' && (
                          <div>
                            <label className="text-[10px] text-[var(--color-text-muted)]">Message SMS</label>
                            <textarea value={step.config.message as string}
                              onChange={(e) => updateStep(i, { ...step.config, message: e.target.value })}
                              rows={2} maxLength={160} placeholder="Bonjour {{nom}}, ..."
                              className="w-full mt-1 px-2 py-1.5 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] focus:outline-none resize-none" />
                            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{(step.config.message as string || '').length}/160</p>
                          </div>
                        )}

                        {(step.step_type === 'add_tag' || step.step_type === 'remove_tag') && (
                          <div>
                            <label className="text-[10px] text-[var(--color-text-muted)]">Tag</label>
                            <Input value={step.config.tag as string}
                              onChange={(e) => updateStep(i, { ...step.config, tag: e.target.value })}
                              placeholder="Ex: chaud, relancé, vip" />
                          </div>
                        )}

                        {step.step_type === 'change_status' && (
                          <div>
                            <label className="text-[10px] text-[var(--color-text-muted)]">Nouveau statut</label>
                            <select value={step.config.status as string}
                              onChange={(e) => updateStep(i, { ...step.config, status: e.target.value })}
                              className="w-full mt-1 px-2 py-1.5 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] focus:outline-none">
                              <option value="new">Nouveau</option>
                              <option value="contacted">Contacté</option>
                              <option value="meeting">RDV</option>
                              <option value="signed">Signé</option>
                              <option value="closed">Fermé</option>
                              <option value="lost">Perdu</option>
                            </select>
                          </div>
                        )}

                        {step.step_type === 'notify' && (
                          <div>
                            <label className="text-[10px] text-[var(--color-text-muted)]">Message de notification</label>
                            <Input value={step.config.message as string}
                              onChange={(e) => updateStep(i, { ...step.config, message: e.target.value })}
                              placeholder="Alerte : {{nom}} a besoin d'attention !" />
                          </div>
                        )}

                        {step.step_type === 'webhook' && (
                          <div className="space-y-1">
                            <label className="text-[10px] text-[var(--color-text-muted)]">URL du webhook</label>
                            <Input value={step.config.url as string}
                              onChange={(e) => updateStep(i, { ...step.config, url: e.target.value })}
                              placeholder="https://..." />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bouton ajouter step */}
          <button
            onClick={() => setShowAddStep(true)}
            className="w-full mt-3 py-3 border-2 border-dashed border-[var(--color-border-subtle)] rounded-[var(--radius-md)] text-sm text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all cursor-pointer"
          >
            + Ajouter une étape
          </button>
        </Card>

        {/* Boutons sauvegarde */}
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => void navigate({ to: '/workflows' })}>Annuler</Button>
          <Button onClick={() => void handleSave()} disabled={isSaving || !name.trim() || steps.length === 0}>
            {isSaving ? 'Création...' : '⚡ Créer le workflow'}
          </Button>
        </div>
      </div>

      {/* Modal ajout step */}
      <Modal isOpen={showAddStep} onClose={() => setShowAddStep(false)} title="Ajouter une étape">
        <div className="grid grid-cols-2 gap-2">
          {STEP_TYPES.map((st) => (
            <button
              key={st}
              onClick={() => addStep(st)}
              className="p-3 text-left border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 transition-all cursor-pointer"
            >
              <p className="text-lg mb-1">{STEP_TYPE_ICONS[st]}</p>
              <p className="text-xs font-medium">{STEP_TYPE_LABELS[st]}</p>
            </button>
          ))}
        </div>
      </Modal>
    </AppLayout>
  );
}
