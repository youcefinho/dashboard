// ── TriggerLinks — Page de gestion des liens trackés — Intralys CRM ──

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, Input, EmptyState, Skeleton, useConfirm } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { getTriggerLinks, createTriggerLink, deleteTriggerLink } from '@/lib/api';
import { Link2, Plus, Trash2, Copy, ExternalLink, MousePointerClick } from 'lucide-react';

interface TriggerLink {
  id: string; name: string; target_url: string;
  click_count: number; total_clicks: number; created_at: string;
}

export function TriggerLinksPage() {
  const confirm = useConfirm();
  const [links, setLinks] = useState<TriggerLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newTag, setNewTag] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const loadLinks = useCallback(async () => {
    setIsLoading(true);
    const result = await getTriggerLinks();
    if (result.data) setLinks(result.data);
    setIsLoading(false);
  }, []);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  const handleCreate = async () => {
    if (!newName || !newUrl) return;
    setIsCreating(true);
    await createTriggerLink({ name: newName, target_url: newUrl, tag_to_apply: newTag });
    setNewName(''); setNewUrl(''); setNewTag('');
    setShowCreate(false); setIsCreating(false);
    void loadLinks();
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Supprimer ce trigger link ?',
      description: 'Les clics déjà comptabilisés restent dans les stats. Le lien lui-même ne fonctionnera plus.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    await deleteTriggerLink(id);
    void loadLinks();
  };

  const copyShortUrl = (id: string) => {
    const url = `${window.location.origin}/l/${id}`;
    navigator.clipboard.writeText(url);
  };

  const totalClicks = links.reduce((sum, l) => sum + (l.total_clicks || l.click_count || 0), 0);

  return (
    <AppLayout title="Trigger Links">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '22px', fontWeight: 700, margin: 0 }}>
            <Link2 size={24} style={{ color: 'var(--brand-primary)' }} /> Trigger Links
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: 4 }}>Liens trackés qui déclenchent des workflows au clic</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Nouveau Link</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 24 }}>
        <Card><div style={{ padding: 16, textAlign: 'center' }}><div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--brand-primary)' }}>{links.length}</div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Links actifs</div></div></Card>
        <Card><div style={{ padding: 16, textAlign: 'center' }}><div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--success)' }}>{totalClicks}</div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Clics totaux</div></div></Card>
        <Card><div style={{ padding: 16, textAlign: 'center' }}><div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--warning)' }}>{links.length > 0 ? (totalClicks / links.length).toFixed(1) : '0'}</div><div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Moy. clics/link</div></div></Card>
      </div>

      {isLoading ? (
        <Card><Skeleton className="h-48 w-full" /></Card>
      ) : links.length === 0 ? (
        <EmptyState title="Aucun trigger link pour l'instant" description="Créez un lien tracké pour commencer." action={<Button onClick={() => setShowCreate(true)}>Nouveau Link</Button>} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Nom</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>URL cible</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Clics</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.map(link => (
                <tr key={link.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 500, fontSize: '14px' }}>{link.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>/l/{link.id.slice(0, 8)}</div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <a href={link.target_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '13px', color: 'var(--brand-primary)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                      {link.target_url.length > 50 ? link.target_url.slice(0, 50) + '...' : link.target_url}
                      <ExternalLink size={12} />
                    </a>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <Badge style={{ background: (link.total_clicks || link.click_count) > 0 ? 'var(--success)' : 'var(--bg-hover)', color: (link.total_clicks || link.click_count) > 0 ? 'white' : 'var(--text-muted)' }}>
                      <MousePointerClick size={12} /> {link.total_clicks || link.click_count || 0}
                    </Badge>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <Button variant="ghost" size="sm" onClick={() => copyShortUrl(link.id)} title="Copier URL"><Copy size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(link.id)} title="Supprimer"><Trash2 size={14} style={{ color: 'var(--danger)' }} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      <Modal open={showCreate} onOpenChange={() => setShowCreate(false)} title="Nouveau Trigger Link">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label className="prop-label">Nom</label><Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="ex: Lien guide gratuit" autoFocus /></div>
          <div><label className="prop-label">URL cible</label><Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://..." /></div>
          <div><label className="prop-label">Tag au clic (optionnel)</label><Input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="ex: intéressé_guide" /></div>
          <Button variant="primary" onClick={handleCreate} disabled={isCreating || !newName || !newUrl} style={{ marginTop: 8 }}>
            {isCreating ? 'Création...' : 'Créer le link'}
          </Button>
        </div>
      </Modal>
    </AppLayout>
  );
}