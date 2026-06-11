import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DesktopOnlyBanner } from '@/components/DesktopOnlyBanner';
import { Card, Button, Input, Select, Textarea, Skeleton, Icon, Tag } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { createWorkflow, updateWorkflow, getWorkflow, getPipelines, getTemplates, getWorkflows, simulateWorkflow } from '@/lib/api';
import type { TriggerType, StepType, Pipeline, EmailTemplate, Workflow, WorkflowSimulationResult } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS, STEP_TYPE_LABELS, STEP_TYPE_ICONS, STEP_TYPES, TRIGGER_TYPES } from '@/lib/types';
import { ReactFlow, Background, applyNodeChanges, applyEdgeChanges, addEdge, Handle, Position, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { Node, Edge, Connection, NodeTypes, NodeChange, EdgeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ZoomIn, ZoomOut, Maximize2, Lock } from 'lucide-react';
import { t } from '@/lib/i18n';

// ── Custom Nodes (Sprint 23 wave 34 — premium type-coded) ────

const HANDLE_BASE_CLS = 'wf-handle';
const NODE_CARD_BASE: React.CSSProperties = {
  width: 200,
  borderRadius: 14,
  overflow: 'visible',
  boxShadow: '0 8px 24px -8px rgba(15,23,42,0.18), 0 2px 8px -4px rgba(99,91,255,0.12)',
  transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1), box-shadow 200ms cubic-bezier(0.4,0,0.2,1)',
};

const TriggerNode = ({ data, selected }: any) => {
  return (
    <div
      className={`wf-node wf-node-trigger ${selected ? 'wf-node-selected' : ''}`}
      style={{
        ...NODE_CARD_BASE,
        background: 'linear-gradient(135deg, rgba(99,91,255,0.96) 0%, rgba(88,81,229,0.95) 55%, rgba(88,81,229,0.92) 100%)',
        color: 'white',
        border: '1px solid rgba(88,81,229,0.55)',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.92)',
          borderBottom: '1px solid rgba(255,255,255,0.18)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 100%)',
        }}
      >
        {t('wb.trigger')}
      </div>
      <div className="flex items-center gap-3 p-3">
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.40) 0%, rgba(255,255,255,0.10) 60%, transparent 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            boxShadow: '0 0 16px rgba(255,255,255,0.35), inset 0 0 0 1px rgba(255,255,255,0.20)',
          }}
        >
          {TRIGGER_ICONS[data.triggerType as TriggerType] || '⚡'}
        </div>
        <p className="text-[11px] font-bold leading-tight" style={{ color: 'white' }}>
          {TRIGGER_LABELS[data.triggerType as TriggerType] || 'Trigger'}
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={HANDLE_BASE_CLS}
        style={{
          width: 14,
          height: 14,
          background: 'var(--bg-surface)',
          border: '2px solid #635BFF',
          boxShadow: '0 0 0 4px rgba(99,91,255,0.30), 0 0 12px rgba(99,91,255,0.55)',
        }}
      />
    </div>
  );
};

const ActionNode = ({ data, selected }: any) => {
  return (
    <div
      className={`wf-node wf-node-action ${selected ? 'wf-node-selected' : ''}`}
      style={{
        ...NODE_CARD_BASE,
        background: 'linear-gradient(180deg, #FFFFFF 0%, #FAFBFC 100%)',
        border: '1px solid rgba(99,91,255,0.20)',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={HANDLE_BASE_CLS}
        style={{
          width: 12,
          height: 12,
          background: 'var(--bg-surface)',
          border: '2px solid #635BFF',
          boxShadow: '0 0 0 3px rgba(99,91,255,0.20)',
        }}
      />
      <div
        aria-hidden
        style={{
          height: 2,
          background: 'linear-gradient(90deg, rgba(99,91,255,0.30) 0%, rgba(139,92,246,0.30) 100%)',
          borderRadius: '14px 14px 0 0',
        }}
      />
      <div className="flex items-center gap-3 p-3">
        <span
          className="chip-btn chip-btn--sm"
          style={{
            width: 32,
            height: 32,
            padding: 0,
            justifyContent: 'center',
            fontSize: 16,
            pointerEvents: 'none',
          }}
        >
          {STEP_TYPE_ICONS[data.stepType as StepType] || '⚙️'}
        </span>
        <p className="text-[11px] font-bold leading-tight text-[var(--text-primary)]">
          {STEP_TYPE_LABELS[data.stepType as StepType] || 'Action'}
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={HANDLE_BASE_CLS}
        style={{
          width: 12,
          height: 12,
          background: 'var(--bg-surface)',
          border: '2px solid #635BFF',
          boxShadow: '0 0 0 3px rgba(99,91,255,0.20)',
        }}
      />
    </div>
  );
};

const ConditionNode = ({ selected }: any) => {
  return (
    <div
      className={`wf-node wf-node-condition ${selected ? 'wf-node-selected' : ''}`}
      style={{
        ...NODE_CARD_BASE,
        background: 'linear-gradient(135deg, rgba(255,154,0,0.92) 0%, rgba(217,110,39,0.92) 100%)',
        color: 'white',
        border: '1px solid rgba(217,110,39,0.55)',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={HANDLE_BASE_CLS}
        style={{
          width: 12,
          height: 12,
          background: 'var(--bg-surface)',
          border: '2px solid #FF9A00',
          boxShadow: '0 0 0 3px rgba(255,154,0,0.30)',
        }}
      />
      <div
        style={{
          padding: '8px 12px',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.92)',
          borderBottom: '1px solid rgba(255,255,255,0.20)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 100%)',
        }}
      >
        Condition
      </div>
      <div className="flex items-center gap-3 p-3">
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.40) 0%, rgba(255,255,255,0.10) 60%, transparent 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            boxShadow: '0 0 16px rgba(255,255,255,0.35), inset 0 0 0 1px rgba(255,255,255,0.20)',
          }}
        >
          🔀
        </div>
        <p className="text-[11px] font-bold leading-tight" style={{ color: 'white' }}>
          Si / Sinon
        </p>
      </div>

      {/* OUI handle (left) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{
          left: '25%',
          width: 12,
          height: 12,
          background: 'var(--bg-surface)',
          border: '2px solid #37CA37',
          boxShadow: '0 0 0 3px rgba(55,202,55,0.30)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: -20,
          left: '15%',
          padding: '1px 6px',
          borderRadius: 8,
          fontSize: 9,
          fontWeight: 700,
          background: 'rgba(55,202,55,0.95)',
          color: 'white',
          letterSpacing: '0.10em',
          boxShadow: '0 2px 6px rgba(55,202,55,0.45)',
        }}
      >
        OUI
      </div>

      {/* NON handle (right) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{
          left: '75%',
          width: 12,
          height: 12,
          background: 'var(--bg-surface)',
          border: '2px solid #E93D3D',
          boxShadow: '0 0 0 3px rgba(233,61,61,0.30)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: -20,
          left: '65%',
          padding: '1px 6px',
          borderRadius: 8,
          fontSize: 9,
          fontWeight: 700,
          background: 'rgba(233,61,61,0.95)',
          color: 'white',
          letterSpacing: '0.10em',
          boxShadow: '0 2px 6px rgba(233,61,61,0.45)',
        }}
      >
        NON
      </div>
    </div>
  );
};

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
};

// ── Per-step-type config forms (LOT AUTOMATION BUILDER §6.D) ─────────────────
// Chaque formulaire produit EXACTEMENT les clés step.config lues par executeStep
// (workflows.ts). NE PAS renommer/retirer de clé (rétro-compat moteur).

type Cfg = Record<string, any>;

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{children}</label>
);

const FieldRow = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

// Statuts de lead lus par change_status (§6.D : new|contacted|qualified|won|closed|lost).
const CHANGE_STATUS_VALUES = ['new', 'contacted', 'qualified', 'won', 'closed', 'lost'] as const;
// Opérateurs de condition (§6.D).
const CONDITION_OPERATORS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than'] as const;
const WAIT_TYPES = ['delay', 'until_date', 'until_time', 'for_event'] as const;
const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

function StepConfigForm({
  stepType,
  config,
  patch,
  emailTemplates,
  pipelines,
  workflows,
}: {
  stepType: StepType;
  config: Cfg;
  patch: (next: Cfg) => void;
  emailTemplates: EmailTemplate[];
  pipelines: Pipeline[];
  workflows: Workflow[];
}) {
  const set = (key: string, value: unknown) => patch({ ...config, [key]: value });
  const v = (key: string): string => (config[key] != null ? String(config[key]) : '');

  switch (stepType) {
    case 'wait':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.delay')}</FieldLabel>
            <Select size="sm" value={v('wait_type') || 'delay'} onChange={(e) => set('wait_type', e.target.value)}>
              {WAIT_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
            </Select>
          </FieldRow>
          {(config.wait_type || 'delay') === 'delay' && (
            <FieldRow>
              <FieldLabel>{t('wb.cfg.delay')}</FieldLabel>
              <Input type="number" min={0} value={v('delay_minutes')} onChange={(e) => set('delay_minutes', e.target.value === '' ? '' : Number(e.target.value))} />
            </FieldRow>
          )}
          {config.wait_type === 'until_date' && (
            <FieldRow>
              <FieldLabel>Date</FieldLabel>
              <Input type="date" value={v('wait_date')} onChange={(e) => set('wait_date', e.target.value)} />
            </FieldRow>
          )}
          {config.wait_type === 'until_time' && (
            <FieldRow>
              <FieldLabel>Heure (HH:MM)</FieldLabel>
              <Input type="time" value={v('wait_time')} onChange={(e) => set('wait_time', e.target.value)} />
            </FieldRow>
          )}
        </div>
      );

    case 'condition':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.field')}</FieldLabel>
            <Input placeholder="status" value={v('field')} onChange={(e) => set('field', e.target.value)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('wb.cfg.operator')}</FieldLabel>
            <Select size="sm" value={v('operator') || 'equals'} onChange={(e) => set('operator', e.target.value)}>
              {CONDITION_OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('wb.cfg.value')}</FieldLabel>
            <Input placeholder="qualified" value={v('value')} onChange={(e) => set('value', e.target.value)} />
          </FieldRow>
        </div>
      );

    case 'send_email':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.template')}</FieldLabel>
            <Select size="sm" value={v('template_id')} onChange={(e) => set('template_id', e.target.value)}>
              <option value="">—</option>
              {emailTemplates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
            </Select>
          </FieldRow>
        </div>
      );

    case 'send_internal_email':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.to_email')}</FieldLabel>
            <Input placeholder="admin@intralys.com" value={v('to_email')} onChange={(e) => set('to_email', e.target.value)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('wb.cfg.subject')}</FieldLabel>
            <Input placeholder="Nouveau lead : {{name}}" value={v('subject')} onChange={(e) => set('subject', e.target.value)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('wb.cfg.message')}</FieldLabel>
            <Textarea rows={5} placeholder={t('wf_builder.node.message_placeholder')} value={v('body')} onChange={(e) => set('body', e.target.value)} />
          </FieldRow>
        </div>
      );

    case 'send_sms':
    case 'notify':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.message')}</FieldLabel>
            <Textarea rows={4} placeholder={t('wf_builder.node.message_placeholder')} value={v('message')} onChange={(e) => set('message', e.target.value)} />
          </FieldRow>
        </div>
      );

    case 'add_tag':
    case 'remove_tag':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.tag')}</FieldLabel>
            <Input value={v('tag')} onChange={(e) => set('tag', e.target.value)} />
          </FieldRow>
        </div>
      );

    case 'change_status':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.status')}</FieldLabel>
            <Select size="sm" value={v('status') || 'new'} onChange={(e) => set('status', e.target.value)}>
              {CHANGE_STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </FieldRow>
        </div>
      );

    case 'webhook':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.url')}</FieldLabel>
            <Input placeholder="https://..." value={v('url')} onChange={(e) => set('url', e.target.value)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('workflow_builder.field.method')}</FieldLabel>
            <Select size="sm" value={v('method') || 'POST'} onChange={(e) => set('method', e.target.value)}>
              {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </FieldRow>
        </div>
      );

    case 'update_pipeline':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('workflow_builder.field.pipeline')}</FieldLabel>
            <Select size="sm" value={v('pipeline_id')} onChange={(e) => set('pipeline_id', e.target.value)}>
              <option value="">—</option>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </FieldRow>
        </div>
      );

    case 'update_stage':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wf_builder.trigger.stage_label')}</FieldLabel>
            <Select size="sm" value={v('stage_id')} onChange={(e) => set('stage_id', e.target.value)}>
              <option value="">—</option>
              {pipelines.flatMap((p) => p.stages || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </FieldRow>
        </div>
      );

    case 'create_task':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>Titre</FieldLabel>
            <Input value={v('title')} onChange={(e) => set('title', e.target.value)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('workflow_builder.field.description')}</FieldLabel>
            <Textarea rows={3} value={v('description')} onChange={(e) => set('description', e.target.value)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('workflow_builder.field.priority')}</FieldLabel>
            <Select size="sm" value={v('priority') || 'medium'} onChange={(e) => set('priority', e.target.value)}>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('workflow_builder.field.assigned_to')}</FieldLabel>
            <Input placeholder="user_id" value={v('assigned_to')} onChange={(e) => set('assigned_to', e.target.value)} />
          </FieldRow>
        </div>
      );

    case 'create_appointment':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>Titre</FieldLabel>
            <Input value={v('title')} onChange={(e) => set('title', e.target.value)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel>Dans (jours)</FieldLabel>
            <Input type="number" min={0} value={v('days_from_now')} onChange={(e) => set('days_from_now', e.target.value === '' ? '' : Number(e.target.value))} />
          </FieldRow>
          <FieldRow>
            <FieldLabel>Type</FieldLabel>
            <Input placeholder="meeting" value={v('type')} onChange={(e) => set('type', e.target.value)} />
          </FieldRow>
        </div>
      );

    case 'create_opportunity':
    case 'update_opportunity':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.value')}</FieldLabel>
            <Input type="number" min={0} value={v('deal_value')} onChange={(e) => set('deal_value', e.target.value === '' ? '' : Number(e.target.value))} />
          </FieldRow>
        </div>
      );

    case 'update_custom_field':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('wb.cfg.field')}</FieldLabel>
            <Input placeholder="field_id" value={v('field_id')} onChange={(e) => set('field_id', e.target.value)} />
          </FieldRow>
          <FieldRow>
            <FieldLabel>{t('wb.cfg.value')}</FieldLabel>
            <Input value={v('value')} onChange={(e) => set('value', e.target.value)} />
          </FieldRow>
        </div>
      );

    case 'trigger_another_workflow':
    case 'end_other_workflow':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('workflow_builder.field.workflow')}</FieldLabel>
            <Select size="sm" value={v('workflow_id')} onChange={(e) => set('workflow_id', e.target.value)}>
              <option value="">—</option>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </FieldRow>
        </div>
      );

    case 'assign':
      return (
        <div className="mt-4 space-y-3">
          <FieldRow>
            <FieldLabel>{t('workflow_builder.field.assigned_to')}</FieldLabel>
            <Input placeholder="user_id" value={v('assigned_to')} onChange={(e) => set('assigned_to', e.target.value)} />
          </FieldRow>
        </div>
      );

    case 'goal_reached':
      return (
        <p className="mt-4 text-xs text-[var(--text-muted)]">
          {STEP_TYPE_LABELS[stepType]} — aucune configuration requise.
        </p>
      );

    default:
      // ai_action / math_operation / add_to_smart_list : clés définies par
      // Manager-B (mocks). Pas de formulaire dédié (config libre).
      return (
        <p className="mt-4 text-xs text-[var(--text-muted)]">
          {STEP_TYPE_LABELS[stepType]} — configuration non requise dans ce panneau.
        </p>
      );
  }
}

// ── Config de trigger (autres que pipeline_stage_changed) — trigger_config ───
function TriggerConfigForm({ triggerType, config, patch }: { triggerType: TriggerType; config: Cfg; patch: (next: Cfg) => void }) {
  const set = (key: string, value: unknown) => patch({ ...config, [key]: value });
  const v = (key: string): string => (config[key] != null ? String(config[key]) : '');
  if (triggerType === 'score_threshold' || triggerType === 'lead_score_changed') {
    return (
      <div>
        <FieldLabel>{t('workflow_builder.field.min_score')}</FieldLabel>
        <Input type="number" min={0} value={v('min_score')} onChange={(e) => set('min_score', e.target.value === '' ? '' : Number(e.target.value))} />
      </div>
    );
  }
  if (triggerType === 'inactivity_threshold') {
    return (
      <div>
        <FieldLabel>Inactivité (jours)</FieldLabel>
        <Input type="number" min={0} value={v('days')} onChange={(e) => set('days', e.target.value === '' ? '' : Number(e.target.value))} />
      </div>
    );
  }
  if (triggerType === 'tag_added') {
    return (
      <div>
        <FieldLabel>{t('wb.cfg.tag')}</FieldLabel>
        <Input value={v('tag')} onChange={(e) => set('tag', e.target.value)} />
      </div>
    );
  }
  return null;
}

// ── Custom chip-btn Controls (Sprint 23 wave 34) ─────────────
function PremiumControls({ locked, setLocked }: { locked: boolean; setLocked: (v: boolean) => void }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div
      className="absolute bottom-4 left-4 z-10 flex items-center gap-1 p-1 rounded-xl"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(240,250,254,0.92) 100%)',
        backdropFilter: 'blur(12px) saturate(160%)',
        WebkitBackdropFilter: 'blur(12px) saturate(160%)',
        border: '1px solid rgba(99,91,255,0.20)',
        boxShadow: '0 8px 24px -8px rgba(99,91,255,0.22)',
      }}
    >
      <button type="button" onClick={() => zoomIn()} className="chip-btn chip-btn--sm" title="Zoom +" aria-label="Zoom avant">
        <Icon as={ZoomIn} size="sm" />
      </button>
      <button type="button" onClick={() => zoomOut()} className="chip-btn chip-btn--sm" title="Zoom -" aria-label="Zoom arrière">
        <Icon as={ZoomOut} size="sm" />
      </button>
      <button type="button" onClick={() => fitView({ duration: 300 })} className="chip-btn chip-btn--sm" title="Ajuster" aria-label="Ajuster la vue">
        <Icon as={Maximize2} size="sm" />
      </button>
      <button
        type="button"
        onClick={() => setLocked(!locked)}
        className={`chip-btn chip-btn--sm ${locked ? 'is-active' : ''}`}
        title={locked ? 'Déverrouiller' : 'Verrouiller'}
        aria-label={locked ? 'Déverrouiller la vue' : 'Verrouiller la vue'}
      >
        <Icon as={Lock} size="sm" />
      </button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────

const initialNodes: Node[] = [
  { id: 'trigger_1', type: 'trigger', position: { x: 250, y: 50 }, data: { triggerType: 'lead_created' } }
];

// ── Mode édition : reconstruit nodes + edges depuis les steps persistés ──────
// (parent_step_id + branch ; sentinel 'trigger_1' = premier step rattaché au
// trigger). Inverse exact de la sérialisation handleSave (§6.D). On positionne
// les nodes en grille verticale simple (l'utilisateur peut les déplacer).
function reconstructGraph(
  triggerType: TriggerType,
  steps: Array<{ id: string; step_order: number; step_type: StepType; config: string; parent_step_id?: string | null; branch?: string | null }>,
): { nodes: Node[]; edges: Edge[] } {
  const triggerNode: Node = { id: 'trigger_1', type: 'trigger', position: { x: 250, y: 50 }, data: { triggerType } };
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const stepNodes: Node[] = ordered.map((s, i) => {
    let config: Record<string, unknown> = {};
    try { config = s.config ? JSON.parse(s.config) : {}; } catch { config = {}; }
    return {
      id: s.id,
      type: s.step_type === 'condition' ? 'condition' : 'action',
      position: { x: 250, y: 200 + i * 150 },
      data: { stepType: s.step_type, config },
    };
  });
  // Edges : parent_step_id pointe vers 'trigger_1' (sentinel) ou un autre step.
  // sourceHandle = branch ('true'/'false') ; 'main' → handle par défaut.
  const edges: Edge[] = ordered
    .filter((s) => s.parent_step_id)
    .map((s) => {
      const branch = s.branch || 'main';
      const edge: Edge = {
        id: `e_${s.parent_step_id}_${s.id}`,
        source: s.parent_step_id as string,
        target: s.id,
        type: 'smoothstep',
      };
      if (branch === 'true' || branch === 'false') edge.sourceHandle = branch;
      return edge;
    });
  return { nodes: [triggerNode, ...stepNodes], edges };
}

export function WorkflowBuilderPage() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderInner />
    </ReactFlowProvider>
  );
}

function WorkflowBuilderInner() {
  const navigate = useNavigate();
  // Mode édition : la route /workflows/$workflowId/edit fournit le param.
  // En création (/workflows/new) le param est absent (strict:false → undefined).
  const params = useParams({ strict: false }) as { workflowId?: string };
  const editId = params.workflowId;
  const isEdit = !!editId;

  const [name, setName] = useState('');
  const [description, _setDescription] = useState('');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, any>>({});

  // States for pipeline trigger + lookups (email templates, workflows cibles)
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [allWorkflows, setAllWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // React Flow state
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [canvasLocked, setCanvasLocked] = useState(false);

  // Simulation (LOT §6 — wf_sim.*)
  const [simResult, setSimResult] = useState<WorkflowSimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const [pRes, tRes, wRes] = await Promise.all([getPipelines(), getTemplates(), getWorkflows()]);
      if (cancelled) return;
      if (pRes.data) setPipelines(pRes.data);
      if (tRes.data) setEmailTemplates(tRes.data);
      if (wRes.data) setAllWorkflows(wRes.data);

      if (isEdit && editId) {
        const wf = await getWorkflow(editId);
        if (cancelled) return;
        if (wf.data) {
          setName(wf.data.name || '');
          _setDescription(wf.data.description || '');
          try { setTriggerConfig(wf.data.trigger_config ? JSON.parse(wf.data.trigger_config) : {}); }
          catch { setTriggerConfig({}); }
          const { nodes: loadedNodes, edges: loadedEdges } = reconstructGraph(
            wf.data.trigger_type as TriggerType,
            (wf.data.steps || []) as Array<{ id: string; step_order: number; step_type: StepType; config: string; parent_step_id?: string | null; branch?: string | null }>,
          );
          setNodes(loadedNodes);
          setEdges(loadedEdges);
        }
      }
      setIsLoading(false);
    }
    void bootstrap();
    return () => { cancelled = true; };
  }, [isEdit, editId]);

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge({ ...params, type: 'smoothstep' }, eds)), []);

  const addStep = (stepType: StepType) => {
    const id = `step_${Date.now()}`;
    const isCondition = stepType === 'condition';
    
    // Find bottom-most node to attach below
    let maxY = 0;
    nodes.forEach(n => { if (n.position.y > maxY) maxY = n.position.y; });
    
    const newNode: Node = {
      id,
      type: isCondition ? 'condition' : 'action',
      position: { x: 250, y: maxY + 150 },
      data: { stepType, config: {} }
    };
    
    setNodes((nds) => [...nds, newNode]);
    setShowAddStep(false);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);

    const triggerNode = nodes.find(n => n.type === 'trigger');
    const actionNodes = nodes.filter(n => n.type !== 'trigger');

    // Serialize to standard DB format
    // This is a simplified serialization for demonstration
    const stepsData = actionNodes.map((n, index) => {
      // Find parent edge
      const incomingEdges = edges.filter(e => e.target === n.id);
      let branch = 'main';
      let parent_step_id = null;

      if (incomingEdges.length > 0) {
        parent_step_id = incomingEdges[0]?.source || null;
        if (incomingEdges[0]?.sourceHandle === 'true') branch = 'true';
        if (incomingEdges[0]?.sourceHandle === 'false') branch = 'false';
      }

      return {
        id: n.id,
        step_order: index + 1,
        step_type: n.data.stepType as StepType,
        config: JSON.stringify(n.data.config || {}),
        parent_step_id,
        branch
      };
    });

    const payload = {
      name: name.trim(),
      description: description.trim(),
      trigger_type: (triggerNode?.data.triggerType as TriggerType) || 'lead_created',
      trigger_config: JSON.stringify(triggerConfig),
      steps: stepsData,
    };

    // Mode édition → updateWorkflow (DELETE+réINSERT des steps) ; sinon create.
    const result = isEdit && editId
      ? await updateWorkflow(editId, payload)
      : await createWorkflow(payload);

    setIsSaving(false);
    if (result.data) {
      void navigate({ to: '/workflows' });
    }
  };

  // Simulation read-only (§6.E POST /workflows/:id/simulate) — disponible en
  // mode édition (workflow déjà persisté). Aucun effet de bord serveur.
  const handleSimulate = async () => {
    if (!editId) return;
    setIsSimulating(true);
    setSimResult(null);
    const res = await simulateWorkflow(editId, {});
    if (res.data) setSimResult(res.data);
    setIsSimulating(false);
  };

  if (isLoading) {
    /* Skeleton matche WorkflowBuilder : topbar premium + sidebar settings + canvas ReactFlow placeholder */
    return (
      <AppLayout title="Nouveau workflow (2D Canvas)">
        <DesktopOnlyBanner />
        <div className="hidden lg:block animate-stagger">
          <div className="flex flex-col h-[calc(100vh-100px)]">
            {/* Topbar */}
            <div
              className="relative flex items-center justify-between mb-4 p-3 rounded-xl"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(240,250,254,0.85) 100%)',
                backdropFilter: 'blur(12px) saturate(160%)',
                border: '1px solid var(--border-subtle)',
                boxShadow: '0 4px 16px -8px rgba(0,157,219,0.18)',
              }}
            >
              <div
                aria-hidden
                className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl"
                style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(0,157,219,0.5) 30%, rgba(217,110,39,0.5) 70%, transparent 100%)' }}
              />
              <Skeleton className="h-4 w-20" />
              <div className="flex gap-2">
                <Skeleton className="h-9 w-32 rounded-lg" style={{ animationDelay: '40ms' }} />
                <Skeleton className="h-9 w-36 rounded-lg" style={{ animationDelay: '80ms' }} />
              </div>
            </div>

            <div className="flex gap-4 flex-1 overflow-hidden">
              {/* Sidebar settings */}
              <div className="w-64 flex flex-col gap-4 overflow-y-auto pr-2">
                <Card className="p-4 card-premium">
                  <Skeleton className="h-3 w-20 mb-3" />
                  <div className="space-y-3">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="space-y-1.5" style={{ animationDelay: `${i * 40}ms` }}>
                        <Skeleton className="h-2.5 w-16" style={{ animationDelay: `${i * 40}ms` }} />
                        <Skeleton className="h-8 w-full rounded-md" style={{ animationDelay: `${i * 40 + 20}ms` }} />
                      </div>
                    ))}
                  </div>
                </Card>
                <Card className="p-4 flex-1 card-premium">
                  <Skeleton className="h-3 w-24 mb-3" />
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-8 w-full rounded-md" style={{ animationDelay: `${i * 40}ms` }} />
                    ))}
                  </div>
                </Card>
              </div>

              {/* Canvas placeholder */}
              <div
                className="flex-1 relative rounded-xl overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 50%, #F0FAFE 100%)',
                  border: '1px solid var(--border-subtle)',
                  backgroundImage: 'radial-gradient(circle, rgba(0,157,219,0.08) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              >
                {/* Faux trigger node centré */}
                <div className="absolute" style={{ left: '50%', top: 40, transform: 'translateX(-50%)' }}>
                  <Skeleton className="h-16 w-52 rounded-xl" />
                </div>
                {/* Faux ligne + node */}
                <div className="absolute" style={{ left: '50%', top: 130, transform: 'translateX(-50%)' }}>
                  <Skeleton className="h-12 w-px" style={{ animationDelay: '80ms' }} />
                </div>
                <div className="absolute" style={{ left: '50%', top: 200, transform: 'translateX(-50%)' }}>
                  <Skeleton className="h-16 w-52 rounded-xl" style={{ animationDelay: '120ms' }} />
                </div>
                <div className="absolute" style={{ left: '50%', top: 290, transform: 'translateX(-50%)' }}>
                  <Skeleton className="h-12 w-px" style={{ animationDelay: '160ms' }} />
                </div>
                <div className="absolute" style={{ left: '50%', top: 360, transform: 'translateX(-50%)' }}>
                  <Skeleton className="h-16 w-52 rounded-xl" style={{ animationDelay: '200ms' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={isEdit ? name || t('wf_detail.edit') : 'Nouveau workflow (2D Canvas)'}>
      <DesktopOnlyBanner />
      <div className="print-builder-snapshot hidden lg:block">
      <div className="flex flex-col h-[calc(100vh-100px)]">
        {/* Sprint 23 — builder header premium */}
        <div className="relative flex items-center justify-between mb-4 p-3 rounded-xl"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(240,250,254,0.85) 100%)',
            backdropFilter: 'blur(12px) saturate(160%)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 4px 16px -8px rgba(0,157,219,0.18)',
          }}>
          <div aria-hidden className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl"
            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(0,157,219,0.5) 30%, rgba(217,110,39,0.5) 70%, transparent 100%)' }} />
          <button onClick={() => void navigate({ to: '/workflows' })}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--primary)] flex items-center gap-1 cursor-pointer font-medium">
            ← {t('wb.back')}
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowAddStep(true)}>+ {t('wb.add_step')}</Button>
            <Button variant="premium" onClick={() => void handleSave()} disabled={isSaving || !name.trim()}>
              {isSaving ? '...' : '⚡ ' + t('wb.save')}
            </Button>
          </div>
        </div>

        <div className="flex gap-4 flex-1 overflow-hidden">
          {/* Settings Sidebar — Sprint 23 wave 34 premium */}
          <div className="w-64 flex flex-col gap-4 overflow-y-auto pr-2">
            <Card className="p-4 card-premium">
              <h3 className="heading-premium text-[11px] mb-3" style={{ letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                <span className="text-gradient-brand">Workflow</span>
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{t('tpl.modal.name')}</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du workflow" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{t('workflow_builder.label.global_trigger')}</label>
                  <Select
                    size="sm"
                    value={(nodes.find(n => n.type === 'trigger')?.data.triggerType as string) || 'lead_created'}
                    onChange={(e) => {
                      setNodes(nds => nds.map(n => n.type === 'trigger' ? { ...n, data: { ...n.data, triggerType: e.target.value } } : n));
                      setTriggerConfig({});
                    }}
                  >
                    {TRIGGER_TYPES.map(tt => <option key={tt} value={tt}>{TRIGGER_LABELS[tt]}</option>)}
                  </Select>

                  {(nodes.find(n => n.type === 'trigger')?.data.triggerType === 'pipeline_stage_changed') && (
                    <div
                      className="mt-3 p-3 rounded-lg space-y-3"
                      style={{
                        background: 'linear-gradient(135deg, rgba(0,157,219,0.08) 0%, rgba(217,110,39,0.04) 100%)',
                        border: '1px solid rgba(0,157,219,0.20)',
                      }}
                    >
                      <div>
                        <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1 uppercase" style={{ letterSpacing: '0.18em' }}>{t('workflow_builder.field.pipeline')}</label>
                        <Select
                          size="sm"
                          value={triggerConfig.pipeline_id || ''}
                          onChange={e => setTriggerConfig(prev => ({ ...prev, pipeline_id: e.target.value, stage_id: '' }))}
                        >
                          <option value="">N'importe quel pipeline</option>
                          {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Select>
                      </div>
                      {triggerConfig.pipeline_id && (
                        <div>
                          <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1 uppercase" style={{ letterSpacing: '0.18em' }}>{t('wf_builder.trigger.stage_label')}</label>
                          <Select
                            size="sm"
                            value={triggerConfig.stage_id || ''}
                            onChange={e => setTriggerConfig(prev => ({ ...prev, stage_id: e.target.value }))}
                          >
                            <option value="">{t('wf_builder.trigger.stage_any')}</option>
                            {pipelines.find(p => p.id === triggerConfig.pipeline_id)?.stages?.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </Select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Config trigger pour les AUTRES triggers (§6 trigger_config) */}
                  {(() => {
                    const tt = (nodes.find(n => n.type === 'trigger')?.data.triggerType as TriggerType) || 'lead_created';
                    if (tt === 'pipeline_stage_changed') return null;
                    const form = (
                      <TriggerConfigForm
                        triggerType={tt}
                        config={triggerConfig}
                        patch={(next) => setTriggerConfig(next)}
                      />
                    );
                    // null si le trigger n'expose pas de config dédiée
                    return form && (tt === 'score_threshold' || tt === 'lead_score_changed' || tt === 'inactivity_threshold' || tt === 'tag_added') ? (
                      <div
                        className="mt-3 p-3 rounded-lg space-y-3"
                        style={{
                          background: 'linear-gradient(135deg, rgba(0,157,219,0.08) 0%, rgba(217,110,39,0.04) 100%)',
                          border: '1px solid rgba(0,157,219,0.20)',
                        }}
                      >
                        {form}
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            </Card>

            <Card className="p-4 flex-1 card-premium">
              <h3 className="heading-premium text-[11px] mb-3" style={{ letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                <span className="text-gradient-brand">{t('wb.cfg.title')}</span>
              </h3>
              {!selectedNodeId ? (
                <p className="text-xs text-[var(--text-muted)]">{t('wb.select_step')}</p>
              ) : (() => {
                const selNode = nodes.find(n => n.id === selectedNodeId);
                const stepType = selNode?.data?.stepType as StepType | undefined;
                if (!selNode || selNode.type === 'trigger' || !stepType) {
                  return <p className="text-xs text-[var(--text-muted)]">{t('wb.select_step')}</p>;
                }
                const cfg = (selNode.data?.config as Cfg) || {};
                return (
                  <div className="text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base leading-none">{STEP_TYPE_ICONS[stepType]}</span>
                      <span className="font-semibold text-[var(--text-primary)]">{STEP_TYPE_LABELS[stepType]}</span>
                    </div>
                    <StepConfigForm
                      stepType={stepType}
                      config={cfg}
                      patch={(next) => setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, config: next } } : n))}
                      emailTemplates={emailTemplates}
                      pipelines={pipelines}
                      workflows={allWorkflows}
                    />
                  </div>
                );
              })()}
            </Card>

            {/* Panneau Simulation (mode édition uniquement) — wf_sim.* */}
            {isEdit && (
              <Card className="p-4 card-premium">
                <h3 className="heading-premium text-[11px] mb-3" style={{ letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                  <span className="text-gradient-brand">{t('wf_sim.title')}</span>
                </h3>
                <Button variant="secondary" size="sm" className="w-full" onClick={() => void handleSimulate()} disabled={isSimulating}>
                  {isSimulating ? '...' : t('wf_sim.run')}
                </Button>
                {simResult && (
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">{t('wf_sim.path')}</p>
                    <ol className="space-y-1">
                      {simResult.path.map((p, i) => (
                        <li key={`${p.step_id}_${i}`} className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                          <span className="w-5 h-5 rounded-full bg-[var(--brand-tint)] text-[var(--primary)] text-[9px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                          <span className="flex-1">{STEP_TYPE_LABELS[p.step_type as StepType] || p.step_type}</span>
                          {p.branch && p.branch !== 'main' && (
                            <Tag size="xs" variant={p.branch === 'true' ? 'success' : 'neutral'}>{p.branch}</Tag>
                          )}
                        </li>
                      ))}
                    </ol>
                    <Tag size="sm" variant={simResult.reached_goal ? 'success' : 'neutral'}>
                      {simResult.reached_goal ? t('wf_sim.reached_goal') : t('wf_sim.no_goal')}
                    </Tag>
                  </div>
                )}
              </Card>
            )}
          </div>

          {/* Canvas React Flow — Sprint 23 wave 34 premium */}
          <Card className="flex-1 p-0 overflow-hidden relative">
            {/* Décor orbs */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(0,157,219,0.20) 0%, rgba(217,110,39,0.08) 50%, transparent 80%)',
                filter: 'blur(40px)',
                zIndex: 0,
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 -left-24 w-72 h-72 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(217,110,39,0.15) 0%, rgba(0,157,219,0.06) 50%, transparent 80%)',
                filter: 'blur(40px)',
                zIndex: 0,
              }}
            />
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              nodeTypes={nodeTypes}
              fitView
              nodesDraggable={!canvasLocked}
              nodesConnectable={!canvasLocked}
              elementsSelectable={!canvasLocked}
              defaultEdgeOptions={{
                type: 'smoothstep',
                animated: false,
                style: { stroke: 'url(#wf-edge-gradient)', strokeWidth: 2 },
              }}
              proOptions={{ hideAttribution: true }}
              className="bg-[var(--bg-canvas)]"
              style={{ position: 'relative', zIndex: 1 }}
            >
              {/* Edge gradient defs */}
              <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
                <defs>
                  <linearGradient id="wf-edge-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#635BFF" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.85" />
                  </linearGradient>
                </defs>
              </svg>
              <Background gap={24} size={1.5} color="rgba(99,91,255,0.15)" />
              <PremiumControls locked={canvasLocked} setLocked={setCanvasLocked} />
            </ReactFlow>
          </Card>
        </div>
      </div>

      {/* Modal ajout nœud — grid 3 cols action-chip categories */}
      <Modal open={showAddStep} onOpenChange={() => setShowAddStep(false)} title={t('wb.add_step')}>
        <div className="grid grid-cols-3 gap-2">
          {STEP_TYPES.map((st) => {
            // Catégorisation simple pour gradient tint
            const isComm = (st as string) === 'send_email' || (st as string) === 'send_sms' || (st as string) === 'send_internal_email' || (st as string) === 'notify';
            const isLogic = (st as string) === 'condition' || (st as string) === 'wait';
            const catGradient = isComm
              ? 'linear-gradient(135deg, rgba(0,157,219,0.18) 0%, rgba(0,157,219,0.06) 100%)'
              : isLogic
                ? 'linear-gradient(135deg, rgba(255,154,0,0.18) 0%, rgba(217,110,39,0.06) 100%)'
                : 'linear-gradient(135deg, rgba(138,147,164,0.16) 0%, rgba(138,147,164,0.04) 100%)';
            const catBorder = isComm
              ? 'rgba(0,157,219,0.35)'
              : isLogic
                ? 'rgba(217,110,39,0.35)'
                : 'rgba(138,147,164,0.30)';
            return (
              <button
                key={st}
                type="button"
                onClick={() => addStep(st as StepType)}
                className="action-chip action-chip--accent flex flex-col items-start text-left list-item-enter"
                style={{
                  padding: '12px 14px',
                  height: 'auto',
                  gap: 6,
                  background: catGradient,
                  border: `1px solid ${catBorder}`,
                }}
              >
                <span className="action-chip-icon" style={{ fontSize: 18 }}>{STEP_TYPE_ICONS[st as StepType]}</span>
                <span className="text-xs font-semibold text-[var(--text-primary)]">{STEP_TYPE_LABELS[st as StepType]}</span>
              </button>
            );
          })}
        </div>
      </Modal>

      {/* Styles locaux pour selected node ring (Sprint 23 wave 34) */}
      <style>{wfBuilderStyles}</style>
      </div>
    </AppLayout>
  );
}

const wfBuilderStyles = `
.wf-node { position: relative; }
.wf-node-selected {
  outline: 3px solid rgba(0,157,219,0.55);
  outline-offset: 2px;
  box-shadow: 0 0 0 6px rgba(0,157,219,0.18), 0 0 28px rgba(0,157,219,0.40), 0 12px 28px -10px rgba(15,23,42,0.25) !important;
  animation: wfNodeSelectedPulse 1800ms cubic-bezier(0.4,0,0.2,1) infinite;
}
@keyframes wfNodeSelectedPulse {
  0%, 100% { box-shadow: 0 0 0 6px rgba(0,157,219,0.18), 0 0 28px rgba(0,157,219,0.40), 0 12px 28px -10px rgba(15,23,42,0.25); }
  50%      { box-shadow: 0 0 0 8px rgba(0,157,219,0.25), 0 0 38px rgba(217,110,39,0.40), 0 12px 28px -10px rgba(15,23,42,0.25); }
}
.wf-handle { transition: box-shadow 200ms cubic-bezier(0.4,0,0.2,1); }
.wf-node:hover .wf-handle { box-shadow: 0 0 0 5px rgba(0,157,219,0.30), 0 0 16px rgba(0,157,219,0.60) !important; }
@media (prefers-reduced-motion: reduce) {
  .wf-node-selected { animation: none !important; }
  .wf-node, .wf-handle { transition: none !important; }
}
`;
