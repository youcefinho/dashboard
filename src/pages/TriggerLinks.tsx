// ── TriggerLinks — Page de gestion des liens trackés — Intralys CRM ──

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, EmptyState, Skeleton, useConfirm, PageHero, KpiStrip, Icon, type KpiItem, Tag, useToast } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { getTriggerLinks, createTriggerLink, deleteTriggerLink } from '@/lib/api';
import { Plus, Trash2, Copy, ExternalLink, MousePointerClick, Link as LinkIcon, TrendingUp, Award, Check } from 'lucide-react';
import { t } from '@/lib/i18n';

interface TriggerLink {
  id: string; name: string; target_url: string;
  click_count: number; total_clicks: number; created_at: string;
}

export function TriggerLinksPage() {
  const confirm = useConfirm();
  const { success: toastSuccess, error: toastError } = useToast();
  const [links, setLinks] = useState<TriggerLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newTag, setNewTag] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Renforcement — error state
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await getTriggerLinks();
      if (result.error) {
        setLoadError(result.error);
      } else if (result.data) {
        setLinks(result.data);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('trigger.error.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  const handleCreate = async () => {
    if (!newName || !newUrl) return;
    setIsCreating(true);
    try {
      const res = await createTriggerLink({ name: newName, target_url: newUrl, tag_to_apply: newTag });
      if (res && (res as { error?: string }).error) {
        toastError((res as { error: string }).error);
        setIsCreating(false);
        return;
      }
      setNewName(''); setNewUrl(''); setNewTag('');
      setShowCreate(false);
      void loadLinks();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('trigger.error.create_failed'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('trigger.confirm.title'),
      description: t('trigger.confirm.desc'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await deleteTriggerLink(id);
      if (res && (res as { error?: string }).error) {
        toastError((res as { error: string }).error);
        return;
      }
      void loadLinks();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('trigger.error.delete_failed'));
    }
  };

  const copyShortUrl = (id: string) => {
    const url = `${window.location.origin}/l/${id}`;
    void navigator.clipboard.writeText(url);
    setCopiedId(id);
    toastSuccess('Lien copié !');
    setTimeout(() => setCopiedId(c => (c === id ? null : c)), 1800);
  };

  const totalClicks = links.reduce((sum, l) => sum + (l.total_clicks || l.click_count || 0), 0);
  const bestPerformer = links.reduce<TriggerLink | null>((best, l) => {
    const clicks = l.total_clicks || l.click_count || 0;
    if (!best) return l;
    const bestClicks = best.total_clicks || best.click_count || 0;
    return clicks > bestClicks ? l : best;
  }, null);
  const conversions = links.filter(l => (l.total_clicks || l.click_count || 0) > 0).length;

  const kpiItems: KpiItem[] = [
    { label: t('trigger.kpi.total'), value: links.length, icon: <LinkIcon size={11} />, color: 'brand' },
    { label: t('trigger.kpi.clicks'), value: totalClicks, icon: <MousePointerClick size={11} />, color: 'success' },
    { label: t('trigger.kpi.active'), value: conversions, icon: <TrendingUp size={11} />, color: 'info' },
    { label: t('trigger.kpi.top'), value: bestPerformer ? (bestPerformer.name.length > 14 ? bestPerformer.name.slice(0, 12) + '…' : bestPerformer.name) : '—', icon: <Award size={11} />, color: 'accent' },
  ];

  return (
    <AppLayout title="Trigger Links">
      <PageHero
        meta="Marketing"
        title="Trigger Links"
        highlight="Trigger Links"
        description={t('trigger.hero.desc')}
        actions={<Button variant="premium" onClick={() => setShowCreate(true)} leftIcon={<Icon as={Plus} size="sm" />}>{t('trigger.action.new')}</Button>}
      />

      <KpiStrip items={kpiItems} />

      {/* Renforcement — error state */}
      {loadError && !isLoading && (
        <Card className="p-6" role="alert" aria-live="assertive">
          <p className="text-sm font-semibold text-[var(--danger)] mb-1">
            {t('trigger.error.load_failed')}
          </p>
          <p className="text-xs text-[var(--text-muted)] mb-3 break-all">{loadError}</p>
          <Button variant="secondary" size="sm" onClick={() => { void loadLinks(); }}>
            {t('action.retry')}
          </Button>
        </Card>
      )}

      {isLoading ? (
        <Card className="p-0 overflow-hidden" aria-busy="true" aria-live="polite">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center gap-6">
            {[1,2,3,4].map(i => (
              <Skeleton key={i} className="h-3 w-20 rounded" />
            ))}
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-40 rounded" />
                  <Skeleton className="h-2.5 w-24 rounded" />
                </div>
                <div className="flex-1 max-w-sm">
                  <Skeleton className="h-3 w-full rounded" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full shrink-0" />
                <div className="flex gap-2 shrink-0">
                  <Skeleton className="h-7 w-20 rounded" />
                  <Skeleton className="h-7 w-7 rounded" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : loadError ? null : links.length === 0 ? (
        <EmptyState
          variant="first-time"
          icon={<Icon as={LinkIcon} size={48} />}
          title={t('trigger.empty.title')}
          description={t('trigger.empty.desc')}
          action={<Button variant="primary" onClick={() => setShowCreate(true)}>{t('trigger.empty.action')}</Button>}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>{t('trigger.table.name')}</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>{t('trigger.table.url')}</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>{t('trigger.table.clicks')}</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>{t('trigger.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link, idx) => {
                const clicks = link.total_clicks || link.click_count || 0;
                const isCopied = copiedId === link.id;
                return (
                <tr key={link.id} className="row-premium list-item-enter" style={{ borderBottom: '1px solid var(--border-subtle)', animationDelay: `${idx * 30}ms` }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 500, fontSize: '14px' }}>{link.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>/l/{link.id.slice(0, 8)}</div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <a href={link.target_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '13px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                      {link.target_url.length > 50 ? link.target_url.slice(0, 50) + '...' : link.target_url}
                      <ExternalLink size={12} />
                    </a>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <Tag dot variant={clicks > 0 ? 'success' : 'neutral'} size="xs" leftIcon={<MousePointerClick size={10} />}>{clicks}</Tag>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => copyShortUrl(link.id)}
                        className="action-chip"
                        title={t('trigger.action.copy_url_title')}
                        style={isCopied ? {
                          background: 'linear-gradient(135deg, rgba(55,202,55,0.14) 0%, rgba(0,157,219,0.06) 100%)',
                          borderColor: 'rgba(55,202,55,0.50)',
                          color: '#1f8f1f',
                        } : undefined}
                      >
                        <span className="action-chip-icon">
                          {isCopied ? <Icon as={Check} size="xs" /> : <Icon as={Copy} size="xs" />}
                        </span>
                        <span>{isCopied ? t('trigger.action.copied') : t('trigger.action.copy')}</span>
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(link.id)} title={t('trigger.action.delete_title')}><Icon as={Trash2} size="sm" style={{ color: 'var(--danger)' }} /></Button>
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
          </div>
        </Card>
      )}

      <Modal open={showCreate} onOpenChange={() => setShowCreate(false)} title={t('trigger.modal.title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label className="prop-label">{t('trigger.modal.name')}</label><Input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('trigger.modal.name_placeholder')} autoFocus /></div>
          <div><label className="prop-label">{t('trigger.modal.url')}</label><Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://..." /></div>
          <div><label className="prop-label">{t('trigger.modal.tag')}</label><Input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder={t('trigger.modal.tag_placeholder')} /></div>
          <Button variant="primary" onClick={handleCreate} disabled={isCreating || !newName || !newUrl} aria-busy={isCreating} isLoading={isCreating} style={{ marginTop: 8 }}>
            {isCreating ? t('trigger.modal.creating') : t('trigger.modal.submit')}
          </Button>
        </div>
      </Modal>
    </AppLayout>
  );
}