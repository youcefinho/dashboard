// ── Page Clients — Liste des sous-comptes ──────────────────────

import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, EmptyState, Skeleton, PageHero } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { getClients, createClient, getLeads } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Client, Lead } from '@/lib/types';
// LOT renforcement — surface inline error pour getClients / getLeads (silent fail avant)

// Type étendu pour les clients avec compteurs
interface ClientWithCounts extends Client {
  lead_count: number;
  new_lead_count: number;
}

interface ClientMetrics { won: number; total: number; pipelineValue: number; convRate: number }

export function ClientsPage() {
  const [clients, setClients] = useState<ClientWithCounts[]>([]);
  const [clientMetrics, setClientMetrics] = useState<Record<string, ClientMetrics>>({});
  const [isLoading, setIsLoading] = useState(true);
  // LOT renforcement — error inline + retry
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const loadClients = async () => {
    setIsLoading(true);
    setLoadError(null);
    const [clientsRes, leadsRes] = await Promise.all([getClients(), getLeads()]);
    if (clientsRes.data) {
      setClients(clientsRes.data as unknown as ClientWithCounts[]);
    } else if (clientsRes.error) {
      setLoadError(clientsRes.error);
    } else if (leadsRes.error) {
      setLoadError(leadsRes.error);
    }
    // Calculer les métriques par client
    if (leadsRes.data) {
      const metrics: Record<string, ClientMetrics> = {};
      leadsRes.data.forEach((l: Lead) => {
        if (!metrics[l.client_id]) metrics[l.client_id] = { won: 0, total: 0, pipelineValue: 0, convRate: 0 };
        const m = metrics[l.client_id]!;
        m.total++;
        if (l.status === 'won') m.won++;
        m.pipelineValue += l.deal_value || 0;
      });
      Object.values(metrics).forEach(m => {
        m.convRate = m.total > 0 ? Math.round((m.won / m.total) * 100) : 0;
      });
      setClientMetrics(metrics);
    }
    setIsLoading(false);
  };

  useEffect(() => { void loadClients(); }, []);

  // Filtrer par recherche
  const filteredClients = clients.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.city || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q);
  });

  // KPIs globaux
  const totalLeads = Object.values(clientMetrics).reduce((s, m) => s + m.total, 0);
  const totalWon = Object.values(clientMetrics).reduce((s, m) => s + m.won, 0);
  const totalPipeline = Object.values(clientMetrics).reduce((s, m) => s + m.pipelineValue, 0);


  return (
    <AppLayout title={t('clients.page.title')}>
      <PageHero
        meta={t('clients.page.meta')}
        title={t('clients.page.title')}
        highlight={t('clients.page.title')}
        description={t('clients.page.description')}
      />
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--primary)]">{clients.length}</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{t('clients.kpi.sub_accounts')}</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--info)]">{totalLeads}</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{t('clients.kpi.total_leads')}</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--success)]">{totalWon}</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{t('clients.kpi.won')}</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--warning)]">{totalPipeline.toLocaleString('fr-CA')} $</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{t('clients.kpi.pipeline_total')}</p>
        </Card>
      </div>

      {/* Actions bar */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('clients.search.placeholder')}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <p className="text-xs text-[var(--text-muted)] hidden sm:block">
            {filteredClients.length > 1
              ? t('clients.count_plural', { count: filteredClients.length })
              : t('clients.count', { count: filteredClients.length })}
          </p>
          <Button onClick={() => setShowModal(true)}>{t('clients.action.new')}</Button>
        </div>
      </div>

      {/* LOT renforcement — inline error banner (role=alert + retry) */}
      {loadError && !isLoading && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 p-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[var(--danger)]">{t('common.error.title')}</p>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{t('common.error.load_failed')}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void loadClients()}>{t('common.retry')}</Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-live="polite" aria-label={t('a11y.loading_sr')}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><Skeleton className="h-40 w-full" /></Card>
          ))}
        </div>
      ) : filteredClients.length === 0 ? (
        <EmptyState
          title={searchQuery ? t('clients.empty.no_result_title') : t('clients.empty.no_client_title')}
          description={searchQuery ? t('clients.empty.no_result_desc', { query: searchQuery }) : t('clients.empty.no_client_desc')}
          action={!searchQuery ? <Button onClick={() => setShowModal(true)}>{t('clients.empty.add_client')}</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClients.map((client) => {
            const m = clientMetrics[client.id];
            return (
              <Card
                key={client.id}
                interactive
                onClick={() => void navigate({ to: '/clients/$clientId', params: { clientId: client.id } })}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--info)] flex items-center justify-center text-base font-bold text-white shadow-md">
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{client.name}</h3>
                      <p className="text-xs text-[var(--text-muted)]">{client.city || t('clients.card.city_undefined')}</p>
                    </div>
                  </div>
                  {client.is_active ? (
                    <span className="flex items-center gap-1 text-[10px] text-[var(--success)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" /> {t('clients.card.active')}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--text-muted)]">{t('clients.card.inactive')}</span>
                  )}
                </div>

                {client.banner && (
                  <p className="text-xs text-[var(--text-muted)] mb-3 bg-[var(--bg-subtle)] px-2 py-1 rounded-[var(--radius-sm)] inline-block">🏢 {client.banner}</p>
                )}

                {/* Métriques */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[var(--border-subtle)]">
                  <div className="text-center">
                    <p className="text-lg font-bold">{client.lead_count || 0}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{t('clients.card.leads')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-[var(--success)]">{m?.convRate || 0}%</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{t('clients.card.conv')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-[var(--primary)]">{(m?.pipelineValue || 0).toLocaleString('fr-CA')} $</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{t('clients.card.pipeline')}</p>
                  </div>
                </div>

                {/* Barre de conversion */}
                {m && m.total > 0 && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--success)] transition-all" style={{ width: `${Math.max(m.convRate, 5)}%` }} />
                    </div>
                  </div>
                )}

                {/* Liens rapides */}
                {(client.email || client.site_url) && (
                  <div className="flex items-center gap-3 mt-2.5 text-[10px] text-[var(--text-muted)]">
                    {client.email && <span className="truncate">📧 {client.email}</span>}
                    {client.site_url && <a href={client.site_url} target="_blank" rel="noreferrer" className="hover:text-[var(--primary)] transition-colors" onClick={e => e.stopPropagation()}>🌐 {t('clients.card.site')}</a>}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal ajout client */}
      <AddClientModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={() => { setShowModal(false); void loadClients(); }}
      />
    </AppLayout>
  );
}

// ── Modal Ajout Client ──────────────────────────────────────

function AddClientModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [banner, setBanner] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    const result = await createClient({ name, email, phone, city, banner, site_url: siteUrl });

    if (result.error) {
      setError(result.error);
      setIsSubmitting(false);
    } else {
      // Reset
      setName(''); setEmail(''); setPhone(''); setCity(''); setBanner(''); setSiteUrl('');
      setIsSubmitting(false);
      onCreated();
    }
  };

  return (
    <Modal open={open} onOpenChange={(v) => { if (!v) onClose(); }} title={t('clients.modal.title')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-name" className="text-sm font-medium text-[var(--text-secondary)]">{t('clients.modal.name_label')}</label>
          <Input id="client-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('clients.modal.name_placeholder')} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-email" className="text-sm font-medium text-[var(--text-secondary)]">{t('clients.modal.email_label')}</label>
          <Input id="client-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('clients.modal.email_placeholder')} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-phone" className="text-sm font-medium text-[var(--text-secondary)]">{t('clients.modal.phone_label')}</label>
          <Input id="client-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('clients.modal.phone_placeholder')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-city" className="text-sm font-medium text-[var(--text-secondary)]">{t('clients.modal.city_label')}</label>
          <Input id="client-city" value={city} onChange={e => setCity(e.target.value)} placeholder={t('clients.modal.city_placeholder')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-banner" className="text-sm font-medium text-[var(--text-secondary)]">{t('clients.modal.banner_label')}</label>
          <Input id="client-banner" value={banner} onChange={e => setBanner(e.target.value)} placeholder={t('clients.modal.banner_placeholder')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-site" className="text-sm font-medium text-[var(--text-secondary)]">{t('clients.modal.site_label')}</label>
          <Input id="client-site" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder={t('clients.modal.site_placeholder')} />
        </div>

        {error && <p role="alert" aria-live="assertive" className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>{t('clients.modal.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('clients.modal.submit')}</Button>
        </div>
      </form>
    </Modal>
  );
}