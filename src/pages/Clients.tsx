// ── Page Clients — Liste des sous-comptes ──────────────────────

import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, EmptyState, Skeleton } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { getClients, createClient, getLeads } from '@/lib/api';
import type { Client, Lead } from '@/lib/types';

// Type étendu pour les clients avec compteurs
interface ClientWithCounts extends Client {
  lead_count: number;
  new_lead_count: number;
}

interface ClientMetrics { won: number; total: number; pipelineValue: number; convRate: number };

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
    <AppLayout title="Clients">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--brand-primary)]">{clients.length}</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Sous-comptes</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--info)]">{totalLeads}</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Leads total</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--success)]">{totalWon}</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Gagnés</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-[var(--warning)]">{totalPipeline.toLocaleString('fr-CA')} $</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Pipeline total</p>
        </Card>
      </div>

      {/* Actions bar */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Rechercher un compte..."
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <p className="text-xs text-[var(--text-muted)] hidden sm:block">
            {filteredClients.length} compte{filteredClients.length > 1 ? 's' : ''}
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
          description={searchQuery ? `Aucun compte ne correspond à « ${searchQuery} »` : 'Ajoutez votre premier compte pour commencer.'}
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
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[var(--brand-primary)] to-[var(--info)] flex items-center justify-center text-base font-bold text-white shadow-md">
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{client.name}</h3>
                      <p className="text-xs text-[var(--text-muted)]">{client.city || 'Ville non définie'}</p>
                    </div>
                  </div>
                  {client.is_active ? (
                    <span className="flex items-center gap-1 text-[10px] text-[var(--success)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" /> Actif
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--text-muted)]">Inactif</span>
                  )}
                </div>

                {client.banner && (
                  <p className="text-xs text-[var(--text-muted)] mb-3 bg-[var(--bg-subtle)] px-2 py-1 rounded-[var(--radius-sm)] inline-block">🏢 {client.banner}</p>
                )}

                {/* Métriques */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[var(--border-subtle)]">
                  <div className="text-center">
                    <p className="text-lg font-bold">{client.lead_count || 0}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">Leads</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-[var(--success)]">{m?.convRate || 0}%</p>
                    <p className="text-[10px] text-[var(--text-muted)]">Conv.</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-[var(--brand-primary)]">{(m?.pipelineValue || 0).toLocaleString('fr-CA')} $</p>
                    <p className="text-[10px] text-[var(--text-muted)]">Pipeline</p>
                  </div>
                </div>

                {/* Barre de conversion */}
                {m && m.total > 0 && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-[var(--brand-primary)] to-[var(--success)] transition-all" style={{ width: `${Math.max(m.convRate, 5)}%` }} />
                    </div>
                  </div>
                )}

                {/* Liens rapides */}
                {(client.email || client.site_url) && (
                  <div className="flex items-center gap-3 mt-2.5 text-[10px] text-[var(--text-muted)]">
                    {client.email && <span className="truncate">📧 {client.email}</span>}
                    {client.site_url && <a href={client.site_url} target="_blank" rel="noreferrer" className="hover:text-[var(--brand-primary)] transition-colors" onClick={e => e.stopPropagation()}>🌐 Site</a>}
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
    <Modal open={open} onOpenChange={(v) => { if (!v) onClose(); }} title="Ajouter un client">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-name" className="text-sm font-medium text-[var(--text-secondary)]">Nom de l'entreprise / client</label>
          <Input id="client-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Lumière Nettoyage Pro" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-email" className="text-sm font-medium text-[var(--text-secondary)]">Email</label>
          <Input id="client-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contact@entreprise.com" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-phone" className="text-sm font-medium text-[var(--text-secondary)]">Téléphone</label>
          <Input id="client-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="514-555-1234" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-city" className="text-sm font-medium text-[var(--text-secondary)]">Ville</label>
          <Input id="client-city" value={city} onChange={e => setCity(e.target.value)} placeholder="Montréal" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-banner" className="text-sm font-medium text-[var(--text-secondary)]">Bannière / Industrie</label>
          <Input id="client-banner" value={banner} onChange={e => setBanner(e.target.value)} placeholder="Ex: Nettoyage" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-site" className="text-sm font-medium text-[var(--text-secondary)]">URL du site</label>
          <Input id="client-site" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="https://lumiere-nettoyage.com" />
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" isLoading={isSubmitting}>Ajouter</Button>
        </div>
      </form>
    </Modal>
  );
}