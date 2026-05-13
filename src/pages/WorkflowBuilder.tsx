import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DesktopOnlyBanner } from '@/components/DesktopOnlyBanner';
import { Card, Button, Input } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { createWorkflow, getPipelines } from '@/lib/api';
import type { TriggerType, StepType, Pipeline } from '@/lib/types';
import { TRIGGER_LABELS, TRIGGER_ICONS, STEP_TYPE_LABELS, STEP_TYPE_ICONS, STEP_TYPES, TRIGGER_TYPES } from '@/lib/types';
import { ReactFlow, Controls, Background, applyNodeChanges, applyEdgeChanges, addEdge, Handle, Position } from '@xyflow/react';
import type { Node, Edge, Connection, NodeTypes, NodeChange, EdgeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ── Custom Nodes ──────────────────────────────────────────

const TriggerNode = ({ data }: any) => {
  return (
    <div className="bg-[var(--bg-surface)] border-2 border-[var(--brand-primary)] rounded-lg shadow-sm w-48 text-center">
      <div className="bg-[var(--brand-primary)] text-white text-[10px] font-bold uppercase tracking-wider py-1 rounded-t-sm">
        Déclencheur
      </div>
      <div className="p-3">
        <p className="text-2xl mb-1">{TRIGGER_ICONS[data.triggerType as TriggerType] || '⚡'}</p>
        <p className="text-xs font-semibold">{TRIGGER_LABELS[data.triggerType as TriggerType] || 'Trigger'}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-[var(--brand-primary)]" />
    </div>
  );
};

const ActionNode = ({ data }: any) => {
  return (
    <div className="bg-[var(--bg-surface)] border-2 border-[var(--border-strong)] rounded-lg shadow-sm w-48 text-center">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-[var(--border-strong)]" />
      <div className="bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-wider py-1 rounded-t-sm border-b border-[var(--border-subtle)]">
        Action
      </div>
      <div className="p-3 flex items-center justify-center gap-2">
        <span className="text-lg">{STEP_TYPE_ICONS[data.stepType as StepType] || '⚙️'}</span>
        <p className="text-xs font-semibold text-left">{STEP_TYPE_LABELS[data.stepType as StepType] || 'Action'}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-[var(--border-strong)]" />
    </div>
  );
};

const ConditionNode = () => {
  return (
    <div className="bg-[var(--bg-surface)] border-2 border-[var(--warning)] rounded-lg shadow-sm w-48 text-center">
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-[var(--warning)]" />
      <div className="bg-[var(--warning)] text-white text-[10px] font-bold uppercase tracking-wider py-1 rounded-t-sm">
        Condition
      </div>
      <div className="p-3">
        <p className="text-lg mb-1">🔀</p>
        <p className="text-xs font-semibold">Si / Sinon</p>
      </div>
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: '25%' }} className="w-3 h-3 bg-[var(--success)]" />
      <div className="absolute bottom-[-16px] left-[20%] text-[8px] font-bold text-[var(--success)]">OUI</div>
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: '75%' }} className="w-3 h-3 bg-[var(--danger)]" />
      <div className="absolute bottom-[-16px] left-[70%] text-[8px] font-bold text-[var(--danger)]">NON</div>
    </div>
  );
};

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
};

// ── Main Component ────────────────────────────────────────

const initialNodes: Node[] = [
  { id: 'trigger_1', type: 'trigger', position: { x: 250, y: 50 }, data: { triggerType: 'lead_created' } }
];

export function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, _setDescription] = useState('');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, any>>({});
  
  // States for pipeline trigger
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  useEffect(() => {
    getPipelines().then(res => { if (res.data) setPipelines(res.data); });
  }, []);
  
  // React Flow state
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  return (
    <AppLayout title="Nouveau workflow (2D Canvas)">
      <DesktopOnlyBanner />
      <div className="hidden lg:block">
      <div className="flex flex-col h-[calc(100vh-100px)]">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => void navigate({ to: '/workflows' })}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--brand-primary)] flex items-center gap-1 cursor-pointer">
            ← Retour
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowAddStep(true)}>+ Ajouter Nœud</Button>
            <Button onClick={() => void handleSave()} disabled={isSaving || !name.trim()}>
              {isSaving ? 'Enregistrement...' : '⚡ Sauvegarder'}
            </Button>
          </div>
        </div>

        <div className="flex gap-4 flex-1 overflow-hidden">
          {/* Settings Sidebar */}
          <div className="w-64 flex flex-col gap-4 overflow-y-auto pr-2">
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">📝 Workflow</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Nom</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du workflow" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Trigger global</label>
                  <select 
                    value={(nodes.find(n => n.type === 'trigger')?.data.triggerType as string) || 'lead_created'}
                    onChange={(e) => {
                      setNodes(nds => nds.map(n => n.type === 'trigger' ? { ...n, data: { ...n.data, triggerType: e.target.value } } : n));
                      setTriggerConfig({});
                    }}
                    className="w-full px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded focus:outline-none mb-3"
                  >
                    {TRIGGER_TYPES.map(tt => <option key={tt} value={tt}>{TRIGGER_LABELS[tt]}</option>)}
                  </select>

                  {(nodes.find(n => n.type === 'trigger')?.data.triggerType === 'pipeline_stage_changed') && (
                    <div className="p-3 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-lg space-y-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Pipeline</label>
                        <select 
                          value={triggerConfig.pipeline_id || ''} 
                          onChange={e => setTriggerConfig(prev => ({ ...prev, pipeline_id: e.target.value, stage_id: '' }))}
                          className="w-full px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded focus:outline-none"
                        >
                          <option value="">N'importe quel pipeline</option>
                          {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      {triggerConfig.pipeline_id && (
                        <div>
                          <label className="block text-[10px] font-semibold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">Étape (Stage)</label>
                          <select 
                            value={triggerConfig.stage_id || ''} 
                            onChange={e => setTriggerConfig(prev => ({ ...prev, stage_id: e.target.value }))}
                            className="w-full px-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded focus:outline-none"
                          >
                            <option value="">N'importe quelle étape</option>
                            {pipelines.find(p => p.id === triggerConfig.pipeline_id)?.stages?.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card className="p-4 flex-1">
              <h3 className="text-sm font-semibold mb-3">⚙️ Config Nœud</h3>
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
                        <textarea 
                          className="w-full min-h-[100px] p-2 text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg focus:outline-none focus:border-[var(--brand-primary)]"
                          placeholder="Le lead {{name}} a été gagné !"
                          value={(nodes.find(n => n.id === selectedNodeId)?.data?.config as any)?.body || ''}
                          onChange={(e) => setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, config: { ...(n.data.config as any), body: e.target.value } } } : n))}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 p-3 bg-[var(--bg-subtle)] rounded border border-dashed border-[var(--border-subtle)] text-center">
                      Settings Panel (Mock) pour {(nodes.find(n => n.id === selectedNodeId)?.data?.stepType as string) || 'déclencheur'}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* Canvas React Flow */}
          <Card className="flex-1 p-0 overflow-hidden relative">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              nodeTypes={nodeTypes}
              fitView
              className="bg-[var(--bg-canvas)]"
            >
              <Background gap={16} size={1} color="var(--border-subtle)" />
              <Controls />
            </ReactFlow>
          </Card>
        </div>
      </div>

      {/* Modal ajout step */}
      <Modal open={showAddStep} onOpenChange={() => setShowAddStep(false)} title="Ajouter un nœud">
        <div className="grid grid-cols-2 gap-2">
          {STEP_TYPES.map((st) => (
            <button
              key={st}
              onClick={() => addStep(st as StepType)}
              className="p-3 text-left border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:border-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/5 transition-all cursor-pointer"
            >
              <p className="text-lg mb-1">{STEP_TYPE_ICONS[st as StepType]}</p>
              <p className="text-xs font-medium">{STEP_TYPE_LABELS[st as StepType]}</p>
            </button>
          ))}
        </div>
      </Modal>
      </div>
    </AppLayout>
  );
}