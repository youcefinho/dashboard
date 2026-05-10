// ── Page Clients — Liste des courtiers ──────────────────────

import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Modal, EmptyState, Skeleton } from '@/components/ui';
import { getClients, createClient, getLeads } from '@/lib/api';
import type { Client, Lead } from '@/lib/types';

// Type étendu pour les clients avec compteurs
interface ClientWithCounts extends Client {
  lead_count: number;
  new_lead_count: number;
}

interface ClientMetrics {
  signed: number;
  total: number;
  pipelineValue: number;
  convRate: number;
}

export function ClientsPage() {
  const [clients, setClients] = useState<ClientWithCounts[]>([]);
  const [clientMetrics, setClientMetrics] = useState<Record<string, ClientMetrics>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const loadClients = async () => {
    setIsLoading(true);
    const [clientsRes, leadsRes] = await Promise.all([getClients(), getLeads()]);
    if (clientsRes.data) {
      setClients(clientsRes.data as unknown as ClientWithCounts[]);
    }
    // Calculer les métriques par client
    if (leadsRes.data) {
      const metrics: Record<string, ClientMetrics> = {};
      leadsRes.data.forEach((l: Lead) => {
        if (!metrics[l.client_id]) metrics[l.client_id] = { signed: 0, total: 0, pipelineValue: 0, convRate: 0 };
        const m = metrics[l.client_id]!;
        m.total++;
        if (l.status === 'signed') m.signed++;
        m.pipelineValue += l.deal_value || 0;
      });
      Object.values(metrics).forEach(m => {
        m.convRate = m.total > 0 ? Math.round((m.signed / m.total) * 100) : 0;
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
  const totalSigned = Object.values(clientMetrics).reduce((s, m) => s + m.signed, 0);
  const totalPipeline = Object.values(clientMetrics).reduce((s, m) => s + m.pipelineValue, 0);
  const avgConv = totalLeads > 0 ? Math.round((totalSigned / totalLeads) * 100) : 0;

  return (
    <AppLayout title="Clients">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--color-accent)]">{clients.length}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Courtiers</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--color-info)]">{totalLeads}</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Leads total</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--color-success)]">{avgConv}%</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Conversion moy.</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--color-warning)]">{totalPipeline.toLocaleString('fr-CA')} $</p>
          <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Pipeline total</p>
        </Card>
      </div>

      {/* Actions bar */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Rechercher un courtier..."
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <p className="text-xs text-[var(--color-text-muted)] hidden sm:block">
            {filteredClients.length} courtier{filteredClients.length > 1 ? 's' : ''}
          </p>
          <Button onClick={() => setShowModal(true)}>+ Nouveau client</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><Skeleton className="h-40 w-full" /></Card>
          ))}
        </div>
      ) : filteredClients.length === 0 ? (
        <EmptyState
          title={searchQuery ? 'Aucun résultat' : 'Aucun client'}
          description={searchQuery ? `Aucun courtier ne correspond à « ${searchQuery} »` : 'Ajoutez votre premier courtier pour commencer.'}
          action={!searchQuery ? <Button onClick={() => setShowModal(true)}>Ajouter un client</Button> : undefined}
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
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-info)] flex items-center justify-center text-base font-bold text-white shadow-md">
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{client.name}</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">{client.city || 'Ville non définie'}</p>
                    </div>
                  </div>
                  {client.is_active ? (
                    <span className="flex items-center gap-1 text-[10px] text-[var(--color-success)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" /> Actif
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--color-text-muted)]">Inactif</span>
                  )}
                </div>

                {client.banner && (
                  <p className="text-xs text-[var(--color-text-muted)] mb-3 bg-[var(--color-bg-tertiary)] px-2 py-1 rounded-[var(--radius-sm)] inline-block">🏢 {client.banner}</p>
                )}

                {/* Métriques */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[var(--color-border-subtle)]">
                  <div className="text-center">
                    <p className="text-lg font-bold">{client.lead_count || 0}</p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">Leads</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-[var(--color-success)]">{m?.convRate || 0}%</p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">Conv.</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-[var(--color-accent)]">{(m?.pipelineValue || 0).toLocaleString('fr-CA')} $</p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">Pipeline</p>
                  </div>
                </div>

                {/* Barre de conversion */}
                {m && m.total > 0 && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full bg-[var(--color-bg-hover)] overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-success)] transition-all" style={{ width: `${Math.max(m.convRate, 5)}%` }} />
                    </div>
                  </div>
                )}

                {/* Liens rapides */}
                {(client.email || client.site_url) && (
                  <div className="flex items-center gap-3 mt-2.5 text-[10px] text-[var(--color-text-muted)]">
                    {client.email && <span className="truncate">📧 {client.email}</span>}
                    {client.site_url && <a href={client.site_url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-accent)] transition-colors" onClick={e => e.stopPropagation()}>🌐 Site</a>}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal ajout client */}
      <AddClientModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onCreated={() => { setShowModal(false); void loadClients(); }}
      />
    </AppLayout>
  );
}

// ── Modal Ajout Client ──────────────────────────────────────

function AddClientModal({
  isOpen, onClose, onCreated,
}: { isOpen: boolean; onClose: () => void; onCreated: () => void }) {
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
    <Modal isOpen={isOpen} onClose={onClose} title="Ajouter un client">
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input label="Nom du courtier" id="client-name" value={name} onChange={e => setName(e.target.value)} placeholder="Mathis Guimont" required />
        <Input label="Email" id="client-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="courtier@email.com" required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Téléphone" id="client-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="819-555-0123" />
          <Input label="Ville" id="client-city" value={city} onChange={e => setCity(e.target.value)} placeholder="Gatineau" />
        </div>
        <Input label="Bannière" id="client-banner" value={banner} onChange={e => setBanner(e.target.value)} placeholder="Royal LePage" />
        <Input label="URL du site" id="client-site" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="https://mathis-guimont.com" />

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" isLoading={isSubmitting}>Ajouter</Button>
        </div>
      </form>
    </Modal>
  );
}
