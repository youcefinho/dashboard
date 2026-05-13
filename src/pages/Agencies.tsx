// ── Agency Master View — SaaS Configurator ──────────────────

import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, EmptyState, Skeleton, Badge } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { getClients, createClient } from '@/lib/api';
import type { Client } from '@/lib/types';
import { Building, Copy, Plus, Activity, DollarSign, Package } from 'lucide-react';

export function AgenciesPage() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  
  // Nouveaux états
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const fetchSubAccounts = async () => {
    try {
      const res = await getClients();
      if (res.data) setClients(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') void fetchSubAccounts();
  }, [user]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name) return;
    try {
      const res = await createClient({ name, email, phone });
      if (!res.error) {
        setShowAdd(false);
        setName('');
        setEmail('');
        setPhone('');
        void fetchSubAccounts();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <AppLayout title="Accès refusé">
        <EmptyState title="Non autorisé" description="Seuls les administrateurs d'agence peuvent accéder à la vue globale." />
      </AppLayout>
    );
  }

  // Mock data pour la vue Master
  const mrr = clients.length * 297; // Exemple : 297$/mois par sous-compte
  const totalLeads = clients.length * 145; // Mock

  return (
    <AppLayout title="Vue Agence (Master View)">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Vue Agence (Sous-comptes)</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Gérez tous vos sous-comptes clients depuis un seul endroit.</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gap-2">
          <Plus size={16} /> Créer un sous-compte
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-2 text-[var(--text-muted)]">
            <Building size={16} /> <h3 className="text-sm font-semibold">Sous-comptes Actifs</h3>
          </div>
          <p className="text-3xl font-bold text-[var(--text-primary)]">{clients.length}</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-2 text-[var(--success)]">
            <DollarSign size={16} /> <h3 className="text-sm font-semibold">MRR Estimé</h3>
          </div>
          <p className="text-3xl font-bold text-[var(--text-primary)]">{mrr.toLocaleString('fr-CA')} $</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-2 text-[var(--brand-primary)]">
            <Activity size={16} /> <h3 className="text-sm font-semibold">Volume Global (Leads)</h3>
          </div>
          <p className="text-3xl font-bold text-[var(--text-primary)]">{totalLeads.toLocaleString('fr-CA')}</p>
        </Card>
      </div>

      {isLoading ? (
        <Card><Skeleton className="h-40 w-full" /></Card>
      ) : clients.length === 0 ? (
        <EmptyState
          title="Aucun sous-compte"
          description="Créez votre premier sous-compte client pour commencer."
          action={<Button onClick={() => setShowAdd(true)}>Créer un sous-compte</Button>}
        />
      ) : (
        <div className="space-y-6">
          <Card className="p-0 overflow-hidden">
            <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex justify-between items-center">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Building size={16} className="text-[var(--text-muted)]" /> Liste des Sous-comptes</h3>
              <div className="flex gap-2">
                <Button variant="secondary" className="text-xs py-1 h-8">Filtrer</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-[var(--text-muted)] uppercase bg-[var(--bg-surface)]">
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="px-4 py-3 font-semibold">Nom du compte</th>
                    <th className="px-4 py-3 font-semibold">ID</th>
                    <th className="px-4 py-3 font-semibold">Plan</th>
                    <th className="px-4 py-3 font-semibold">Créé le</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {clients.map(client => (
                    <tr key={client.id} className="hover:bg-[var(--bg-subtle)] group">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-[var(--brand-primary)] to-[var(--brand-tint)] flex items-center justify-center text-white font-bold text-xs">
                            {client.name.substring(0,2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-[var(--text-primary)]">{client.name}</p>
                            <p className="text-[10px] text-[var(--text-muted)]">{client.email || 'Aucun email'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] font-mono text-[var(--text-muted)]">
                        {client.id.substring(0, 8)}...
                      </td>
                      <td className="px-4 py-3">
                        <Badge color="var(--success)">Pro</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        {new Date(client.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" className="text-xs px-3 py-1.5 h-auto opacity-0 group-hover:opacity-100 transition-opacity">
                          Ouvrir →
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Section Snapshots */}
          <div className="mt-8">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Package size={18} className="text-[var(--brand-primary)]" /> Gestion des Snapshots</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-5 border-dashed border-2 hover:border-[var(--brand-primary)] cursor-pointer transition-colors flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-[var(--brand-tint)] text-[var(--brand-primary)] rounded-full flex items-center justify-center mb-3">
                  <Copy size={24} />
                </div>
                <h3 className="font-semibold mb-1">Créer un nouveau Snapshot</h3>
                <p className="text-xs text-[var(--text-muted)]">Sauvegardez la configuration d'un compte (Pipelines, Custom Fields, Workflows) pour la réutiliser.</p>
              </Card>
              
              <Card className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold flex items-center gap-2"><Package size={16} className="text-[var(--info)]" /> Courtier Immobilier V2</h3>
                  <Badge color="var(--info)">Standard</Badge>
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-4">Snapshot optimisé pour la génération de leads immobiliers avec 3 workflows inclus.</p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="text-xs flex-1">Voir détail</Button>
                  <Button variant="primary" className="text-xs flex-1">Pousser MAJ</Button>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      <Modal open={showAdd} onOpenChange={setShowAdd} title="Créer un sous-compte">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">Nom du sous-compte / Client</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Mathis Guimont" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">Email de contact</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Ex: mathis@exemple.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">Téléphone</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ex: 819-555-0000" />
          </div>
          
          <div className="pt-2">
            <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">Appliquer un Snapshot</label>
            <select className="w-full px-3 py-2 text-sm border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)]">
              <option value="">Aucun (Compte vierge)</option>
              <option value="immo">Courtier Immobilier V2</option>
              <option value="dentist">Clinique Dentaire</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-6">
            <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Annuler</Button>
            <Button type="submit">Créer le sous-compte</Button>
          </div>
        </form>
      </Modal>
    </AppLayout>
  );
}
