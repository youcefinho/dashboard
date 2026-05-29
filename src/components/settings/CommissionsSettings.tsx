import { useState, useEffect } from 'react';
import { Card, Button, Tag, useToast, useConfirm, Skeleton, Input, Icon } from '@/components/ui';
import { CheckCircle, XCircle, Clock, Award } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { t } from '@/lib/i18n';

interface Commission {
  id: string;
  client_id: string;
  user_id: string;
  lead_id: string;
  commission_cents: number;
  status: 'pending' | 'paid' | 'cancelled';
  created_at: string;
  agent_name?: string;
  agent_email?: string;
  lead_name?: string;
  lead_deal_value?: number;
}

export function CommissionsSettings() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadCommissions = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: Commission[] }>('/api/agent-commissions');
      if (res.data && res.data.data) {
        setCommissions(res.data.data);
      } else if (res.error) {
        toastError(res.error);
      }
    } catch (e: any) {
      toastError(e.message || 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCommissions();
  }, []);

  const handleUpdateStatus = async (id: string, newStatus: 'paid' | 'cancelled') => {
    const ok = await confirm({
      title: newStatus === 'paid' ? t('commissions.action.mark_paid') : t('commissions.action.cancel'),
      description: 'Es-tu sûr de vouloir modifier le statut de cette commission ? Cette action est irréversible.',
      confirmLabel: t('action.confirm'),
      cancelLabel: t('action.cancel'),
    });
    if (!ok) return;

    setUpdatingId(id);
    try {
      const res = await apiFetch(`/api/agent-commissions/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.data) {
        success('Statut de la commission mis à jour avec succès.');
        setCommissions(prev =>
          prev.map(c => (c.id === id ? { ...c, status: newStatus } : c))
        );
      } else if (res.error) {
        toastError(res.error);
      }
    } catch (e: any) {
      toastError(e.message || 'Erreur lors de la mise à jour');
    } finally {
      setUpdatingId(null);
    }
  };

  // Filtrer les commissions
  const filteredCommissions = commissions.filter(c => {
    const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
    const matchesSearch =
      searchQuery === '' ||
      c.agent_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.lead_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.agent_email?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // Calculs statistiques
  const stats = filteredCommissions.reduce(
    (acc, curr) => {
      const amount = curr.commission_cents / 100;
      if (curr.status === 'paid') acc.paid += amount;
      else if (curr.status === 'pending') acc.pending += amount;
      else if (curr.status === 'cancelled') acc.cancelled += amount;
      return acc;
    },
    { paid: 0, pending: 0, cancelled: 0 }
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(amount);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-96" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">{t('commissions.title')}</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{t('commissions.subtitle')}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 border-l-4 border-emerald-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-[var(--text-muted)] uppercase">{t('commissions.status.paid')}</p>
              <p className="text-2xl font-bold mt-1 text-emerald-600">{formatCurrency(stats.paid)}</p>
            </div>
            <Icon as={CheckCircle} className="text-emerald-500" size={24} />
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-amber-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-[var(--text-muted)] uppercase">{t('commissions.status.pending')}</p>
              <p className="text-2xl font-bold mt-1 text-amber-600">{formatCurrency(stats.pending)}</p>
            </div>
            <Icon as={Clock} className="text-amber-500" size={24} />
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-rose-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-[var(--text-muted)] uppercase">{t('commissions.status.cancelled')}</p>
              <p className="text-2xl font-bold mt-1 text-rose-600">{formatCurrency(stats.cancelled)}</p>
            </div>
            <Icon as={XCircle} className="text-rose-500" size={24} />
          </div>
        </Card>
      </div>

      {/* Filtres & Recherche */}
      <Card className="p-4 flex flex-col md:flex-row gap-4 items-center">
        <div className="flex-1 w-full">
          <Input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Rechercher par agent ou lead..."
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          {['all', 'pending', 'paid', 'cancelled'].map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`action-chip ${filterStatus === status ? 'is-active' : ''}`}
            >
              {status === 'all'
                ? 'Tous'
                : status === 'pending'
                ? t('commissions.status.pending')
                : status === 'paid'
                ? t('commissions.status.paid')
                : t('commissions.status.cancelled')}
            </button>
          ))}
        </div>
      </Card>

      {/* Tableau des commissions */}
      <Card className="overflow-hidden">
        {filteredCommissions.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-muted)] border-dashed">
            <Icon as={Award} size={36} className="mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-sm font-semibold">{t('commissions.empty')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] font-semibold">
                  <th className="p-3">{t('commissions.agent_name')}</th>
                  <th className="p-3">{t('commissions.lead_name')}</th>
                  <th className="p-3">{t('commissions.deal_value')}</th>
                  <th className="p-3">{t('commissions.amount')}</th>
                  <th className="p-3">{t('commissions.status')}</th>
                  <th className="p-3">{t('commissions.created_at')}</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCommissions.map(c => (
                  <tr key={c.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]/40 transition-colors">
                    <td className="p-3">
                      <div>
                        <p className="font-semibold text-[var(--text-primary)]">{c.agent_name || 'Agent inconnu'}</p>
                        <p className="text-xs text-[var(--text-secondary)]">{c.agent_email}</p>
                      </div>
                    </td>
                    <td className="p-3 font-medium text-[var(--text-primary)]">{c.lead_name || 'Lead inconnu'}</td>
                    <td className="p-3 tabular-nums">{c.lead_deal_value ? formatCurrency(c.lead_deal_value) : '-'}</td>
                    <td className="p-3 font-semibold text-[var(--primary)] tabular-nums">{formatCurrency(c.commission_cents / 100)}</td>
                    <td className="p-3">
                      <Tag
                        variant={
                          c.status === 'paid'
                            ? 'success'
                            : c.status === 'pending'
                            ? 'warning'
                            : 'danger'
                        }
                        size="sm"
                      >
                        {c.status === 'paid'
                          ? t('commissions.status.paid')
                          : c.status === 'pending'
                          ? t('commissions.status.pending')
                          : t('commissions.status.cancelled')}
                      </Tag>
                    </td>
                    <td className="p-3 text-xs text-[var(--text-secondary)]">
                      {new Date(c.created_at).toLocaleDateString('fr-CA', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="p-3 text-right">
                      {c.status === 'pending' && (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => handleUpdateStatus(c.id, 'paid')}
                            disabled={updatingId === c.id}
                          >
                            Payée
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleUpdateStatus(c.id, 'cancelled')}
                            disabled={updatingId === c.id}
                          >
                            Annuler
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
