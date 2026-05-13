import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Skeleton, EmptyState, useToast, PageHero } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { getDocuments, createDocument, sendDocument, getDocumentTemplates, sendSigningSms, apiFetch, type Document, type DocumentTemplate, getLeads } from '@/lib/api';
import { FileSignature, Plus, Mail, Eye, CheckCircle, Clock, MessageSquare } from 'lucide-react';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  return `Il y a ${days} jours`;
}

export function DocumentsPage() {
  const { success, error: toastError, warning } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedLead, setSelectedLead] = useState('');
  const [docTitle, setDocTitle] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [docsRes, tplsRes, leadsRes] = await Promise.all([
        getDocuments(),
        getDocumentTemplates(),
        getLeads()
      ]);
      setDocuments(docsRes.data || []);
      setTemplates(tplsRes.data || []);
      setLeads(leadsRes.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleCreateAndSend = async () => {
    if (!selectedTemplate || !selectedLead || !docTitle) return;
    try {
      // 1. Créer le document
      const docRes = await createDocument({
        template_id: selectedTemplate,
        lead_id: selectedLead,
        title: docTitle
      });
      
      if (docRes.data?.id) {
        // 2. L'envoyer
        await sendDocument(docRes.data.id);
        setIsCreating(false);
        setDocTitle('');
        setSelectedLead('');
        setSelectedTemplate('');
        void loadData();
      }
    } catch (e) {
      console.error(e);
      toastError('Erreur lors de la création ou de l\'envoi');
    }
    setIsCreating(false);
  };

  const [isGeneratingOaciq, setIsGeneratingOaciq] = useState(false);
  const handleGenerateOaciq = async () => {
    if (!selectedLead) {
      warning('Sélectionne un lead avant de générer le mandat.');
      return;
    }
    setIsGeneratingOaciq(true);
    try {
      const res = await apiFetch<any>('/documents/generate-oaciq', {
        method: 'POST',
        body: JSON.stringify({ lead_id: selectedLead })
      });
      if (res.data?.id) {
        success('Mandat OACIQ généré');
        setIsCreating(false);
        setSelectedLead('');
        void loadData();
      }
    } catch (e) {
      console.error(e);
      toastError('Erreur lors de la génération du mandat OACIQ');
    }
    setIsGeneratingOaciq(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'signed': return <Badge color="var(--success)"><span className="flex items-center gap-1"><CheckCircle size={12} /> Signé</span></Badge>;
      case 'viewed': return <Badge color="var(--warning)"><span className="flex items-center gap-1"><Eye size={12} /> Vu</span></Badge>;
      case 'sent': return <Badge color="var(--brand-primary)"><span className="flex items-center gap-1"><Mail size={12} /> Envoyé</span></Badge>;
      case 'expired': return <Badge color="var(--danger)">Expiré</Badge>;
      default: return <Badge color="var(--text-muted)"><span className="flex items-center gap-1"><Clock size={12} /> Brouillon</span></Badge>;
    }
  };

  return (
    <AppLayout title="Documents & E-signature">
      <PageHero
        meta="Insights"
        title="Documents"
        highlight="Documents"
        description="Gérez vos contrats et mandats envoyés pour signature électronique."
        actions={!isCreating && (
          <Button variant="premium" onClick={() => setIsCreating(true)} leftIcon={<Plus size={14} />}>
            Envoyer un document
          </Button>
        )}
      />

      {isCreating && (
        <Card className="p-6 mb-6 animate-fade-in border border-[var(--brand-primary)] max-w-2xl">
          <h3 className="text-lg font-bold mb-4">Envoyer un document pour signature</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Modèle de document</label>
              <select 
                value={selectedTemplate} 
                onChange={e => setSelectedTemplate(e.target.value)}
                className="w-full p-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] text-sm"
              >
                <option value="">Sélectionner un modèle...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Lead destinataire</label>
              <select 
                value={selectedLead} 
                onChange={e => setSelectedLead(e.target.value)}
                className="w-full p-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-md)] text-sm"
              >
                <option value="">Sélectionner un lead...</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.name} ({l.email})</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Titre du document</label>
              <Input 
                placeholder="Ex: Contrat de prestation de services - Jean Dupont" 
                value={docTitle} 
                onChange={e => setDocTitle(e.target.value)} 
              />
            </div>

            <div className="flex flex-col gap-3 pt-2 border-t border-[var(--border-subtle)] mt-2">
              <div className="flex gap-2 justify-between items-center">
                <Button variant="secondary" onClick={() => handleGenerateOaciq()} disabled={!selectedLead || isGeneratingOaciq} className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200">
                  <FileSignature size={16} className="mr-2" /> 
                  {isGeneratingOaciq ? 'Génération...' : 'Générer Mandat OACIQ'}
                </Button>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setIsCreating(false)}>Annuler</Button>
                  <Button onClick={() => void handleCreateAndSend()} disabled={!selectedTemplate || !selectedLead || !docTitle}>
                    <Mail size={16} className="mr-2" /> Créer & Envoyer par email
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? (
        <Card><Skeleton className="h-64 w-full" /></Card>
      ) : documents.length === 0 && !isCreating ? (
        <EmptyState
          icon={<FileSignature size={48} />}
          title="Aucun document pour l'instant"
          description="Envoyez votre premier document pour signature."
          action={<Button onClick={() => setIsCreating(true)}>Envoyer un document</Button>}
        />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)]">
                <th className="py-3 px-4 font-medium">Titre</th>
                <th className="py-3 px-4 font-medium">Destinataire</th>
                <th className="py-3 px-4 font-medium">Statut</th>
                <th className="py-3 px-4 font-medium">Date</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {documents.map(doc => (
                <tr key={doc.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                  <td className="py-3 px-4 font-medium">
                    <div className="flex items-center gap-2">
                      <FileSignature size={16} className="text-[var(--text-muted)]" />
                      {doc.title}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <p className="text-sm">{doc.lead_name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{doc.lead_email}</p>
                  </td>
                  <td className="py-3 px-4">{getStatusBadge(doc.status)}</td>
                  <td className="py-3 px-4 text-[var(--text-secondary)]">
                    {doc.status === 'signed' && doc.signed_at 
                      ? timeAgo(doc.signed_at) 
                      : doc.status === 'sent' && doc.sent_at 
                        ? timeAgo(doc.sent_at) 
                        : timeAgo(doc.created_at)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex gap-1.5 justify-end">
                      <Button variant="secondary" size="sm" onClick={() => window.open(`/sign/${doc.token}`, '_blank')}>
                        Voir
                      </Button>
                      {(doc.status === 'draft' || doc.status === 'sent') && (
                        <Button variant="ghost" size="sm" onClick={async () => {
                          const res = await sendSigningSms(doc.id);
                          if (res.data) success(`SMS envoyé à ${res.data.sms_sent_to}`);
                          else toastError(res.error || 'Échec envoi SMS');
                        }} title="Envoyer par SMS">
                          <MessageSquare size={14} /> SMS
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  );
}
