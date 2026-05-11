// ── Invoices — Gestion de la facturation ──────────────────

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Modal, Input } from '@/components/ui';

interface Invoice {
  id: string;
  client_id: string;
  lead_id: string | null;
  lead_name: string | null;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'cancelled';
  payment_url: string | null;
  description: string | null;
  created_at: string;
}

import { getInvoices as fetchInvoicesApi, createInvoice, updateInvoiceStatus } from '@/lib/api';

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  
  // New invoice state
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const fetchInvoices = async () => {
    try {
      const res = await fetchInvoicesApi();
      if (res.data) setInvoices(res.data as unknown as Invoice[]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchInvoices();
  }, []);

  const handleCreate = async () => {
    if (!amount || isNaN(Number(amount))) return;
    try {
      const res = await createInvoice({
        amount: Number(amount),
        description,
        client_id: 'default_client_for_demo'
      });
      if (!res.error) {
        setShowAdd(false);
        setAmount('');
        setDescription('');
        void fetchInvoices();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await updateInvoiceStatus(id, status);
      void fetchInvoices();
    } catch (err) {
      console.error(err);
    }
  };

  const getStatusBadge = (status: Invoice['status']) => {
    const map = {
      draft: { label: 'Brouillon', color: 'bg-gray-100 text-gray-800 border-gray-200' },
      sent: { label: 'Envoyée', color: 'bg-blue-100 text-blue-800 border-blue-200' },
      paid: { label: 'Payée', color: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30' },
      cancelled: { label: 'Annulée', color: 'bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30' }
    };
    const config = map[status] || map.draft;
    return (
      <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full border ${config.color}`}>
        {config.label}
      </span>
    );
  };

  return (
    <AppLayout title="Factures & Paiements">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Facturation</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Gérez vos paiements et encaissements Stripe</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>+ Nouvelle facture</Button>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-[var(--text-muted)] animate-pulse">Chargement des factures...</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
            <div className="w-16 h-16 bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] rounded-full flex items-center justify-center mb-4">
              💳
            </div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Aucune facture</h3>
            <p className="text-sm text-[var(--text-muted)] mt-2 max-w-sm">Vous n'avez pas encore émis de facture ou reçu de paiement.</p>
            <Button className="mt-6" onClick={() => setShowAdd(true)}>Créer une facture</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
                  <th className="p-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">ID</th>
                  <th className="p-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Date</th>
                  <th className="p-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Description</th>
                  <th className="p-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Montant</th>
                  <th className="p-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Statut</th>
                  <th className="p-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-[var(--bg-subtle)] transition-colors">
                    <td className="p-4 text-sm font-medium text-[var(--brand-primary)]">
                      {inv.id.substring(0, 12)}...
                    </td>
                    <td className="p-4 text-sm text-[var(--text-secondary)]">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-sm font-medium text-[var(--text-primary)]">
                      {inv.description || 'Sans description'}
                      {inv.lead_name && <span className="block text-xs text-[var(--text-muted)] font-normal mt-0.5">Pour: {inv.lead_name}</span>}
                    </td>
                    <td className="p-4 text-sm font-bold text-[var(--text-primary)]">
                      {inv.amount.toLocaleString('fr-CA', { style: 'currency', currency: inv.currency || 'CAD' })}
                    </td>
                    <td className="p-4">
                      {getStatusBadge(inv.status)}
                    </td>
                    <td className="p-4 text-right">
                      {inv.status === 'draft' && (
                        <button onClick={() => void updateStatus(inv.id, 'sent')} className="text-xs font-semibold text-[var(--brand-primary)] hover:underline mr-3 cursor-pointer">
                          Envoyer
                        </button>
                      )}
                      {inv.status !== 'paid' && inv.payment_url && (
                        <a href={inv.payment_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-500 hover:underline cursor-pointer">
                          Lien paiement
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Nouvelle facture (Lien de paiement)">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Montant (CAD)</label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Description (Optionnel)</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Frais de démarrage..." />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-6">
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Annuler</Button>
            <Button onClick={() => void handleCreate()}>Générer le lien</Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
