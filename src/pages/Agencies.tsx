// ── Agencies — Super Admin SaaS Configurator ──────────────────

import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Modal, Input, EmptyState, Skeleton } from '@/components/ui';
import { getAgencies as fetchAgenciesApi, createAgency } from '@/lib/api';

interface Agency {
  id: string;
  name: string;
  owner_id: string | null;
  custom_domain: string | null;
  created_at: string;
}

export function AgenciesPage() {
  const { user } = useAuth();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  
  const [name, setName] = useState('');
  const [customDomain, setCustomDomain] = useState('');

  const fetchAgencies = async () => {
    try {
      const res = await fetchAgenciesApi();
      if (res.data) setAgencies(res.data as unknown as Agency[]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') void fetchAgencies();
  }, [user]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name) return;
    try {
      const res = await createAgency({ name, custom_domain: customDomain || undefined });
      if (!res.error) {
        setShowAdd(false);
        setName('');
        setCustomDomain('');
        void fetchAgencies();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <AppLayout title="Accès refusé">
        <EmptyState title="Non autorisé" description="Seuls les super administrateurs peuvent accéder au configurateur SaaS." />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="SaaS Configurator (Agences)">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Agences (Multi-tenant)</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Gérez les agences qui utilisent la plateforme en marque blanche.</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>+ Nouvelle agence</Button>
      </div>

      {isLoading ? (
        <Card><Skeleton className="h-40 w-full" /></Card>
      ) : agencies.length === 0 ? (
        <EmptyState
          title="Aucune agence"
          description="Créez votre première agence pour commencer à revendre le CRM."
          action={<Button onClick={() => setShowAdd(true)}>Ajouter une agence</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agencies.map(agency => (
            <Card key={agency.id} interactive>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] flex items-center justify-center text-xl font-bold shadow-sm border border-[var(--brand-primary)]/20">
                    🏢
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{agency.name}</h3>
                    <p className="text-xs text-[var(--text-muted)]">ID: {agency.id.substring(0, 8)}...</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] space-y-1">
                <p><strong>Domaine:</strong> {agency.custom_domain || 'Par défaut'}</p>
                <p><strong>Créée le:</strong> {new Date(agency.created_at).toLocaleDateString()}</p>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
                <Button variant="ghost" className="w-full text-xs">Gérer l'agence →</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Ajouter une agence">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Nom de l'agence" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Agence Immo Pro" required />
          <Input label="Domaine personnalisé (Optionnel)" value={customDomain} onChange={e => setCustomDomain(e.target.value)} placeholder="Ex: crm.agencepro.com" />
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-6">
            <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Annuler</Button>
            <Button type="submit">Créer l'agence</Button>
          </div>
        </form>
      </Modal>
    </AppLayout>
  );
}
