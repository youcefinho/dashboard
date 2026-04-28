// ── Page Clients — Liste des courtiers ──────────────────────

import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Modal, EmptyState, Skeleton } from '@/components/ui';
import { getClients, createClient } from '@/lib/api';
import type { Client } from '@/lib/types';

// Type étendu pour les clients avec compteurs
interface ClientWithCounts extends Client {
  lead_count: number;
  new_lead_count: number;
}

export function ClientsPage() {
  const [clients, setClients] = useState<ClientWithCounts[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  const loadClients = async () => {
    setIsLoading(true);
    const result = await getClients();
    if (result.data) {
      setClients(result.data as unknown as ClientWithCounts[]);
    }
    setIsLoading(false);
  };

  useEffect(() => { void loadClients(); }, []);

  return (
    <AppLayout title="Clients">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-[var(--color-text-secondary)]">
          {clients.length} courtier{clients.length > 1 ? 's' : ''} actif{clients.length > 1 ? 's' : ''}
        </p>
        <Button onClick={() => setShowModal(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Ajouter un client
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><Skeleton className="h-32 w-full" /></Card>
          ))}
        </div>
      ) : clients.length === 0 ? (
        <EmptyState
          title="Aucun client"
          description="Ajoutez votre premier courtier pour commencer à suivre ses leads."
          action={<Button onClick={() => setShowModal(true)}>Ajouter un client</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((client) => (
            <Card
              key={client.id}
              interactive
              onClick={() => void navigate({ to: '/clients/$clientId', params: { clientId: client.id } })}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center text-sm font-bold text-[var(--color-accent)]">
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{client.name}</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">{client.city || 'Ville non définie'}</p>
                  </div>
                </div>
                {client.is_active ? (
                  <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" title="Actif" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[var(--color-text-muted)]" title="Inactif" />
                )}
              </div>

              {client.banner && (
                <p className="text-xs text-[var(--color-text-muted)] mb-3">{client.banner}</p>
              )}

              <div className="flex items-center gap-4 pt-3 border-t border-[var(--color-border-subtle)]">
                <div>
                  <p className="text-lg font-bold">{client.lead_count || 0}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">leads total</p>
                </div>
                {(client.new_lead_count || 0) > 0 && (
                  <div>
                    <p className="text-lg font-bold text-[var(--color-accent)]">{client.new_lead_count}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">nouveaux</p>
                  </div>
                )}
              </div>
            </Card>
          ))}
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
