import { useState, useEffect, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Tag, Skeleton, EmptyState, useConfirm, KpiStrip, Textarea, PageHero, Icon } from '@/components/ui';
import type { KpiItem } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { getDocumentTemplates, createDocumentTemplate, deleteDocumentTemplate, type DocumentTemplate } from '@/lib/api';
import { FileText, Plus, Trash2, Edit, CheckCircle2 } from 'lucide-react';

export function DocumentTemplatesPage() {
  const confirm = useConfirm();
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
    const ok = await confirm({
      title: 'Supprimer ce template ?',
      description: 'Le template sera retiré définitivement. Les documents déjà envoyés ne sont pas affectés.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDocumentTemplate(id);
      void loadTemplates();
    } catch (e) {
      console.error(e);
    }
  };

  // ── KPI computed (total templates / utilisés ce mois) ──
  const kpis: KpiItem[] = useMemo(() => {
    const total = templates.length;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const recentCount = templates.filter(t => {
      const created = new Date(t.created_at);
      return created >= monthStart;
    }).length;
    return [
      { label: 'Total modèles', value: total, color: 'brand', icon: <Icon as={FileText} size={12} /> },
      { label: 'Créés ce mois', value: recentCount, color: 'success', icon: <Icon as={CheckCircle2} size={12} /> },
    ];
  }, [templates]);

  return (
    <AppLayout title="Modèles de Documents">
      <PageHero
        meta="Insights"
        title="Modèles de Documents"
        highlight="Modèles"
        description="Créez des modèles de contrats et de mandats réutilisables."
        actions={!isCreating && (
          <Button variant="premium" onClick={() => setIsCreating(true)} leftIcon={<Icon as={Plus} size="sm" />}>
            Nouveau modèle
          </Button>
        )}
      />

      {!isLoading && templates.length > 0 && <KpiStrip items={kpis} />}

      {isCreating && (
        <Card className="p-6 mb-6 animate-fade-in border border-[var(--primary)]">
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
              <Textarea
                rows={12}
                className="font-mono text-xs"
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
              <Button onClick={() => void handleCreate()}>Enregistrer le modèle</Button>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {/* KPI strip skeleton */}
          <div className="flex gap-3">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-20 flex-1 rounded-2xl" />)}
          </div>
          {/* Grid 6 cards */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-3/4 mb-4" />
                <div className="flex gap-2 pt-3 border-t border-[var(--border-subtle)]">
                  <Skeleton className="h-7 w-20 rounded-md" />
                  <Skeleton className="h-7 w-7 rounded-md ml-auto" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : templates.length === 0 && !isCreating ? (
        <EmptyState
          variant="first-time"
          icon={<Icon as={FileText} size={48} />}
          title="Aucun modèle encore"
          description="Crée ton premier modèle de document pour gagner du temps sur tes envois."
          action={<Button variant="primary" onClick={() => setIsCreating(true)}>Créer mon premier modèle</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(tpl => (
            <div key={tpl.id} className="card-premium p-5 flex flex-col list-item-enter">
              <div className="flex justify-between items-start mb-3">
                <Tag variant="brand" size="sm">Modèle</Tag>
                <div className="flex gap-1">
                  <button className="p-1.5 text-[var(--text-muted)] hover:text-[var(--primary)] rounded hover:bg-[var(--bg-subtle)] transition-colors">
                    <Icon as={Edit} size="sm" />
                  </button>
                  <button onClick={() => void handleDelete(tpl.id)} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] rounded hover:bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] transition-colors">
                    <Icon as={Trash2} size="sm" />
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
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
