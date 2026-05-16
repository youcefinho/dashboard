import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DesktopOnlyBanner } from '@/components/DesktopOnlyBanner';
import { Card, Button, Input, Select, Textarea, Skeleton, Icon } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { createWorkflow, getPipelines } from '@/lib/api';
import type { TriggerType, StepType, Pipeline } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS, STEP_TYPE_LABELS, STEP_TYPE_ICONS, STEP_TYPES, TRIGGER_TYPES } from '@/lib/types';
import { ReactFlow, Background, applyNodeChanges, applyEdgeChanges, addEdge, Handle, Position, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { Node, Edge, Connection, NodeTypes, NodeChange, EdgeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ZoomIn, ZoomOut, Maximize2, Lock } from 'lucide-react';

// ── Custom Nodes (Sprint 23 wave 34 — premium type-coded) ────

const HANDLE_BASE_CLS = 'wf-handle';
const NODE_CARD_BASE: React.CSSProperties = {
  width: 200,
  borderRadius: 14,
  overflow: 'visible',
  boxShadow: '0 8px 24px -8px rgba(15,23,42,0.18), 0 2px 8px -4px rgba(0,157,219,0.12)',
  transition: 'transform 200ms cubic-bezier(0.4,0,0.2,1), box-shadow 200ms cubic-bezier(0.4,0,0.2,1)',
};

const TriggerNode = ({ data, selected }: any) => {
  return (
    <div
      className={`wf-node wf-node-trigger ${selected ? 'wf-node-selected' : ''}`}
      style={{
        ...NODE_CARD_BASE,
        background: 'linear-gradient(135deg, rgba(0,181,245,0.96) 0%, rgba(0,157,219,0.95) 55%, rgba(0,134,192,0.92) 100%)',
        color: 'white',
        border: '1px solid rgba(0,134,192,0.55)',
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
        Déclencheur
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
          background: '#FFFFFF',
          border: '2px solid #009DDB',
          boxShadow: '0 0 0 4px rgba(0,157,219,0.30), 0 0 12px rgba(0,157,219,0.55)',
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
        border: '1px solid rgba(0,157,219,0.20)',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className={HANDLE_BASE_CLS}
        style={{
          width: 12,
          height: 12,
          background: '#FFFFFF',
          border: '2px solid #009DDB',
          boxShadow: '0 0 0 3px rgba(0,157,219,0.20)',
        }}
      />
      <div
        aria-hidden
        style={{
          height: 2,
          background: 'linear-gradient(90deg, rgba(0,157,219,0.30) 0%, rgba(217,110,39,0.30) 100%)',
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
          background: '#FFFFFF',
          border: '2px solid #009DDB',
          boxShadow: '0 0 0 3px rgba(0,157,219,0.20)',
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
          background: '#FFFFFF',
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
          background: '#FFFFFF',
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
          background: '#FFFFFF',
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
        border: '1px solid rgba(0,157,219,0.20)',
        boxShadow: '0 8px 24px -8px rgba(0,157,219,0.22)',
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

export function WorkflowBuilderPage() {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderInner />
    </ReactFlowProvider>
  );
}

function WorkflowBuilderInner() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, _setDescription] = useState('');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, any>>({});
  
  // States for pipeline trigger
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    getPipelines().then(res => {
      if (res.data) setPipelines(res.data);
      setIsLoading(false);
    });
  }, []);
  
  // React Flow state
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [canvasLocked, setCanvasLocked] = useState(false);

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

    const result = await createWorkflow({
      name: name.trim(),
      description: description.trim(),
      trigger_type: (triggerNode?.data.triggerType as TriggerType) || 'lead_created',
      trigger_config: JSON.stringify(triggerConfig),
      steps: stepsData, // Extended API required here in real backend
    });

    setIsSaving(false);
    if (result.data?.id) {
      void navigate({ to: '/workflows' });
    }
  };

  if (isLoading) {
    /* Skeleton matche WorkflowBuilder : topbar premium + sidebar settings + canvas ReactFlow placeholder */
    return (
      <AppLayout title="Nouveau workflow (2D Canvas)">
        <DesktopOnlyBanner />
        <div className="hidden lg:block">
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
    <AppLayout title="Nouveau workflow (2D Canvas)">
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
            ← Retour
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowAddStep(true)}>+ Ajouter Nœud</Button>
            <Button variant="premium" onClick={() => void handleSave()} disabled={isSaving || !name.trim()}>
              {isSaving ? 'Enregistrement…' : '⚡ Enregistrer'}
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
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Nom</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du workflow" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Trigger global</label>
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
                        <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1 uppercase" style={{ letterSpacing: '0.18em' }}>Pipeline</label>
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
                          <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1 uppercase" style={{ letterSpacing: '0.18em' }}>Étape (Stage)</label>
                          <Select
                            size="sm"
                            value={triggerConfig.stage_id || ''}
                            onChange={e => setTriggerConfig(prev => ({ ...prev, stage_id: e.target.value }))}
                          >
                            <option value="">N'importe quelle étape</option>
                            {pipelines.find(p => p.id === triggerConfig.pipeline_id)?.stages?.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </Select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card className="p-4 flex-1 card-premium">
              <h3 className="heading-premium text-[11px] mb-3" style={{ letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                <span className="text-gradient-brand">Config Nœud</span>
              </h3>
              {!selectedNodeId ? (
                <p className="text-xs text-[var(--text-muted)]">Sélectionnez un nœud dans le canvas pour le configurer.</p>
              ) : (
                <div className="text-xs text-[var(--text-muted)]">
                  Configuration détaillée pour le nœud : {selectedNodeId}

                  {nodes.find(n => n.id === selectedNodeId)?.data?.stepType === 'send_internal_email' ? (
                    <div className="mt-4 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Destinataire (Email)</label>
                        <Input
                          placeholder="admin@intralys.com"
                          value={(nodes.find(n => n.id === selectedNodeId)?.data?.config as any)?.to_email || ''}
                          onChange={(e) => setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, config: { ...(n.data.config as any), to_email: e.target.value } } } : n))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Sujet</label>
                        <Input
                          placeholder="Nouveau lead : {{name}}"
                          value={(nodes.find(n => n.id === selectedNodeId)?.data?.config as any)?.subject || ''}
                          onChange={(e) => setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, config: { ...(n.data.config as any), subject: e.target.value } } } : n))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Message</label>
                        <Textarea
                          rows={5}
                          placeholder="Le lead {{name}} a été gagné !"
                          value={(nodes.find(n => n.id === selectedNodeId)?.data?.config as any)?.body || ''}
                          onChange={(e) => setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, config: { ...(n.data.config as any), body: e.target.value } } } : n))}
                        />
                      </div>
                    </div>
                  ) : (
                    <div
                      className="mt-4 p-3 rounded text-center"
                      style={{
                        background: 'linear-gradient(135deg, rgba(0,157,219,0.06) 0%, rgba(217,110,39,0.04) 100%)',
                        border: '1px dashed rgba(0,157,219,0.30)',
                      }}
                    >
                      Settings Panel (Mock) pour {(nodes.find(n => n.id === selectedNodeId)?.data?.stepType as string) || 'déclencheur'}
                    </div>
                  )}
                </div>
              )}
            </Card>
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
                    <stop offset="0%" stopColor="#009DDB" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="#D96E27" stopOpacity="0.85" />
                  </linearGradient>
                </defs>
              </svg>
              <Background gap={24} size={1.5} color="rgba(0,157,219,0.15)" />
              <PremiumControls locked={canvasLocked} setLocked={setCanvasLocked} />
            </ReactFlow>
          </Card>
        </div>
      </div>

      {/* Modal ajout nœud — grid 3 cols action-chip categories */}
      <Modal open={showAddStep} onOpenChange={() => setShowAddStep(false)} title="Ajouter un nœud">
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
