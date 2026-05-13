import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { getDocumentTemplates, createDocumentTemplate, deleteDocumentTemplate, type DocumentTemplate } from '@/lib/api';
import { FileText, Plus, Trash2, Edit } from 'lucide-react';

export function DocumentTemplatesPage() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newHtml, setNewHtml] = useState('');

  const loadTemplates = async () => {
    setIsLoading(true);
    try {
      const res = await getDocumentTemplates();
      setTemplates(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  const handleCreate = async () => {
    if (!newTitle || !newHtml) return;
    try {
      await createDocumentTemplate({
        name: newTitle,
        body_html: newHtml,
        category: 'contract',
      });
      setIsCreating(false);
      setNewTitle('');
      setNewHtml('');
      void loadTemplates();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce template ?')) return;
    try {
      await deleteDocumentTemplate(id);
      void loadTemplates();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <AppLayout title="Modèles de Documents">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="text-[var(--brand-primary)]" />
            Modèles de Documents
          </h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">Créez des modèles de contrats et de mandats.</p>
        </div>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)} className="gap-2">
            <Plus size={16} /> Nouveau modèle
          </Button>
        )}
      </div>

      {isCreating && (
        <Card className="p-6 mb-6 animate-fade-in border border-[var(--brand-primary)]">
          <h3 className="text-lg font-bold mb-4">Créer un nouveau modèle</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nom du modèle</label>
              <Input 
                placeholder="Ex: Contrat de prestation de services" 
                value={newTitle} 
                onChange={e => setNewTitle(e.target.value)} 
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Contenu (HTML)</label>
              <textarea 
                className="w-full h-64 p-3 bg-[var(--bg-canvas)] border border-[var(--border-default)] rounded-[var(--radius-md)] text-sm font-mono text-[var(--text-secondary)]"
                placeholder="<h1>Mandat de courtage</h1><p>Entre {{client_company}} et {{lead_name}}...</p>"
                value={newHtml}
                onChange={e => setNewHtml(e.target.value)}
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Variables disponibles: {'{{lead_name}}'}, {'{{lead_email}}'}, {'{{client_name}}'}, {'{{client_company}}'}, {'{{date}}'}
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setIsCreating(false)}>Annuler</Button>
              <Button onClick={() => void handleCreate()}>Sauvegarder le modèle</Button>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? (
        <Card><Skeleton className="h-48 w-full" /></Card>
      ) : templates.length === 0 && !isCreating ? (
        <EmptyState
          icon={<FileText size={48} />}
          title="Aucun modèle pour l'instant"
          description="Créez votre premier modèle de document pour commencer."
          action={<Button onClick={() => setIsCreating(true)}>Créer un modèle</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(tpl => (
            <Card key={tpl.id} className="p-5 flex flex-col">
              <div className="flex justify-between items-start mb-3">
                <Badge color="var(--brand-primary)">Modèle</Badge>
                <div className="flex gap-1">
                  <button className="p-1.5 text-[var(--text-muted)] hover:text-[var(--brand-primary)] rounded hover:bg-[var(--bg-subtle)] transition-colors">
                    <Edit size={14} />
                  </button>
                  <button onClick={() => void handleDelete(tpl.id)} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] rounded hover:bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <h3 className="font-bold text-lg mb-1 line-clamp-1">{tpl.name}</h3>
              <p className="text-xs text-[var(--text-muted)] mb-4 flex-1">
                Créé le {new Date(tpl.created_at).toLocaleDateString('fr-CA')}
              </p>
              <div className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-subtle)] p-2 rounded">
                Variables: {tpl.body_html.match(/\{\{([^}]+)\}\}/g)?.slice(0, 5).join(', ') || 'Aucune'}...
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
