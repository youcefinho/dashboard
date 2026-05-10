// ── Page Documents — Gestion documents & e-sign ─────────────

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button, Card, Badge, Modal, Input, EmptyState } from '@/components/ui';
import { apiFetch } from '@/lib/api';

interface DocTemplate {
  id: string;
  name: string;
  body_html: string;
  fields: string;
  created_at: string;
}

interface Document {
  id: string;
  template_id: string;
  lead_id: string;
  lead_name?: string;
  lead_email?: string;
  template_name?: string;
  status: string;
  sign_token?: string;
  signed_at?: string;
  created_at: string;
}

interface FileItem {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_by: string;
  created_at: string;
}

type Tab = 'documents' | 'templates' | 'files';

export function DocumentsPage() {
  const [tab, setTab] = useState<Tab>('documents');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateBody, setNewTemplateBody] = useState('');
  const [newDocTemplateId, setNewDocTemplateId] = useState('');
  const [newDocLeadId, setNewDocLeadId] = useState('');

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, tplRes, filesRes] = await Promise.all([
        apiFetch('/api/documents'),
        apiFetch('/api/document-templates'),
        apiFetch('/api/files'),
      ]);
      if (docsRes.data) setDocuments(docsRes.data as Document[]);
      if (tplRes.data) setTemplates(tplRes.data as DocTemplate[]);
      if (filesRes.data) setFiles(filesRes.data as FileItem[]);
    } catch { /* silencieux */ }
    setLoading(false);
  }, []);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  const createTemplate = async () => {
    if (!newTemplateName) return;
    await apiFetch('/api/document-templates', {
      method: 'POST',
      body: JSON.stringify({ name: newTemplateName, body_html: newTemplateBody || '<p>Contenu du document</p>', fields: '[]' }),
    });
    setShowNewTemplate(false);
    setNewTemplateName('');
    setNewTemplateBody('');
    void loadDocuments();
  };

  const createDocument = async () => {
    if (!newDocTemplateId || !newDocLeadId) return;
    await apiFetch('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ template_id: newDocTemplateId, lead_id: newDocLeadId }),
    });
    setShowNewDoc(false);
    setNewDocTemplateId('');
    setNewDocLeadId('');
    void loadDocuments();
  };

  const sendDocument = async (docId: string) => {
    await apiFetch(`/api/documents/${docId}/send`, { method: 'POST', body: JSON.stringify({}) });
    void loadDocuments();
  };

  const deleteTemplate = async (id: string) => {
    await apiFetch(`/api/document-templates/${id}`, { method: 'DELETE' });
    void loadDocuments();
  };

  const deleteFile = async (id: string) => {
    await apiFetch(`/api/files/${id}`, { method: 'DELETE' });
    void loadDocuments();
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    await fetch('/api/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      body: formData,
    });
    void loadDocuments();
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'var(--color-muted)',
      sent: 'var(--color-info)',
      signed: 'var(--color-success)',
      expired: 'var(--color-danger)',
    };
    const labels: Record<string, string> = {
      draft: 'Brouillon',
      sent: 'Envoyé',
      signed: 'Signé',
      expired: 'Expiré',
    };
    return <Badge color={colors[status]}>{labels[status] || status}</Badge>;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'documents', label: 'Documents', count: documents.length },
    { key: 'templates', label: 'Templates', count: templates.length },
    { key: 'files', label: 'Fichiers', count: files.length },
  ];

  return (
    <AppLayout title="Documents">
      {/* En-tête avec onglets */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex gap-1 bg-[var(--color-bg-tertiary)] p-1 rounded-[var(--radius-lg)]">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] transition-all cursor-pointer ${
                tab === t.key
                  ? 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)] shadow-[var(--shadow-xs)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {t.label}
              <span className="ml-2 text-xs opacity-60">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {tab === 'documents' && (
            <Button onClick={() => setShowNewDoc(true)} size="sm">
              + Nouveau document
            </Button>
          )}
          {tab === 'templates' && (
            <Button onClick={() => setShowNewTemplate(true)} size="sm">
              + Nouveau template
            </Button>
          )}
          {tab === 'files' && (
            <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-white rounded-[var(--radius-md)] cursor-pointer hover:bg-[var(--color-accent-hover)] transition-all">
              📎 Upload
              <input type="file" className="hidden" onChange={uploadFile} />
            </label>
          )}
        </div>
      </div>

      {/* Contenu selon l'onglet */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="skeleton h-40 rounded-[var(--radius-lg)]" />
          ))}
        </div>
      ) : (
        <>
          {/* Documents */}
          {tab === 'documents' && (
            documents.length === 0 ? (
              <EmptyState
                icon={<span className="text-4xl">📄</span>}
                title="Aucun document"
                description="Créez un document à partir d'un template pour l'envoyer à un lead."
                action={<Button onClick={() => setShowNewDoc(true)} size="sm">+ Nouveau document</Button>}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {documents.map(doc => (
                  <Card key={doc.id} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{doc.template_name || 'Document'}</p>
                        <p className="text-xs text-[var(--color-text-muted)] truncate">{doc.lead_name || doc.lead_id}</p>
                      </div>
                      {statusBadge(doc.status)}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      Créé le {new Date(doc.created_at).toLocaleDateString('fr-CA')}
                      {doc.signed_at && (
                        <span className="ml-2 text-[var(--color-success)]">
                          ✅ Signé le {new Date(doc.signed_at).toLocaleDateString('fr-CA')}
                        </span>
                      )}
                    </div>
                    {doc.status === 'draft' && (
                      <Button size="sm" variant="secondary" onClick={() => void sendDocument(doc.id)}>
                        ✉️ Envoyer pour signature
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            )
          )}

          {/* Templates */}
          {tab === 'templates' && (
            templates.length === 0 ? (
              <EmptyState
                icon={<span className="text-4xl">📋</span>}
                title="Aucun template"
                description="Les templates définissent la structure de vos documents."
                action={<Button onClick={() => setShowNewTemplate(true)} size="sm">+ Nouveau template</Button>}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {templates.map(tpl => (
                  <Card key={tpl.id} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-semibold">{tpl.name}</p>
                      <button
                        onClick={() => void deleteTemplate(tpl.id)}
                        className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors cursor-pointer"
                        title="Supprimer"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Créé le {new Date(tpl.created_at).toLocaleDateString('fr-CA')}
                    </p>
                  </Card>
                ))}
              </div>
            )
          )}

          {/* Fichiers */}
          {tab === 'files' && (
            files.length === 0 ? (
              <EmptyState
                icon={<span className="text-4xl">📁</span>}
                title="Aucun fichier"
                description="Uploadez des fichiers pour les associer à vos leads."
                action={
                  <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-white rounded-[var(--radius-md)] cursor-pointer hover:bg-[var(--color-accent-hover)] transition-all">
                    📎 Upload
                    <input type="file" className="hidden" onChange={uploadFile} />
                  </label>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)]">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Nom</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Type</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Taille</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Date</th>
                      <th className="text-right py-3 px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map(file => (
                      <tr key={file.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] transition-colors">
                        <td className="py-3 px-4 font-medium">{file.filename}</td>
                        <td className="py-3 px-4 text-[var(--color-text-secondary)]">{file.content_type}</td>
                        <td className="py-3 px-4 text-[var(--color-text-secondary)]">{formatSize(file.size)}</td>
                        <td className="py-3 px-4 text-[var(--color-text-muted)]">{new Date(file.created_at).toLocaleDateString('fr-CA')}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => void deleteFile(file.id)}
                            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors cursor-pointer"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}

      {/* Modal — Nouveau template */}
      <Modal isOpen={showNewTemplate} onClose={() => setShowNewTemplate(false)} title="Nouveau template">
        <div className="space-y-4">
          <Input label="Nom du template" value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} placeholder="Ex: Promesse d'achat" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">Contenu HTML</label>
            <textarea
              value={newTemplateBody}
              onChange={e => setNewTemplateBody(e.target.value)}
              placeholder="<p>Contenu du document...</p>"
              rows={6}
              className="w-full px-3 py-2.5 text-sm bg-[var(--color-bg-input)] text-[var(--color-text-primary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] focus:outline-none font-mono"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowNewTemplate(false)}>Annuler</Button>
            <Button onClick={() => void createTemplate()}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Modal — Nouveau document */}
      <Modal isOpen={showNewDoc} onClose={() => setShowNewDoc(false)} title="Nouveau document">
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">Template</label>
            <select
              value={newDocTemplateId}
              onChange={e => setNewDocTemplateId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-[var(--color-bg-input)] text-[var(--color-text-primary)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="">Sélectionner un template...</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <Input label="ID du lead" value={newDocLeadId} onChange={e => setNewDocLeadId(e.target.value)} placeholder="ID du lead destinataire" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowNewDoc(false)}>Annuler</Button>
            <Button onClick={() => void createDocument()}>Créer</Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
