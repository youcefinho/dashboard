// ── Agency Master View — SaaS Configurator ──────────────────

import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, EmptyState, Skeleton, PageHero, KpiStrip, Icon, type KpiItem, Tag } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { getClients, createClient } from '@/lib/api';
import type { Client } from '@/lib/types';
import { Building, Copy, Plus, Activity, DollarSign, Package } from 'lucide-react';
import { t } from '@/lib/i18n';

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
      <AppLayout title={t('agencies.access.denied')}>
        <EmptyState title={t('agencies.access.denied')} description={t('agencies.access.desc')} />
      </AppLayout>
    );
  }

  // Mock data pour la vue Master
  const mrr = clients.length * 297; // Exemple : 297$/mois par sous-compte
  const totalLeads = clients.length * 145; // Mock

  // KPI strip — Sprint 23 wave 27 (migration depuis cards inline + AnimatedNumber)
  const kpiItems: KpiItem[] = [
    { label: t('agencies.kpi.sub_accounts'), value: clients.length, icon: <Building size={11} />, color: 'brand' },
    { label: t('agencies.kpi.mrr'), value: `${mrr.toLocaleString('fr-CA')} $`, icon: <DollarSign size={11} />, color: 'success' },
    { label: t('agencies.kpi.leads_volume'), value: totalLeads, icon: <Activity size={11} />, color: 'info' },
    { label: t('agencies.kpi.snapshots'), value: 1, icon: <Package size={11} />, color: 'accent' },
  ];

  return (
    <AppLayout title={t('agencies.page.title')}>
      <PageHero
        meta="Workspace · Master view"
        title={t('agencies.hero.title')}
        highlight={t('agencies.hero.title')}
        description={t('agencies.hero.desc')}
        actions={<Button variant="premium" onClick={() => setShowAdd(true)} leftIcon={<Icon as={Plus} size="sm" />}>{t('agencies.action.create')}</Button>}
      />

      <KpiStrip items={kpiItems} />

      {isLoading ? (
        <Card className="p-0 overflow-hidden">
          <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex items-center justify-between">
            <Skeleton className="h-4 w-48 rounded" />
            <Skeleton className="h-8 w-16 rounded" />
          </div>
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center gap-6">
            {[1,2,3,4,5].map(i => (
              <Skeleton key={i} className="h-3 w-20 rounded" />
            ))}
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="flex items-center gap-3 flex-1">
                  <Skeleton className="h-8 w-8 rounded-md shrink-0" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-32 rounded" />
                    <Skeleton className="h-2.5 w-40 rounded" />
                  </div>
                </div>
                <Skeleton className="h-3 w-20 rounded shrink-0" />
                <Skeleton className="h-5 w-12 rounded-full shrink-0" />
                <Skeleton className="h-3 w-20 rounded shrink-0" />
                <Skeleton className="h-7 w-20 rounded shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      ) : clients.length === 0 ? (
        <EmptyState
          variant="first-time"
          title={t('agencies.empty.title')}
          description={t('agencies.empty.desc')}
          action={<Button variant="primary" onClick={() => setShowAdd(true)}>{t('agencies.empty.action')}</Button>}
        />
      ) : (
        <div className="space-y-6">
          <Card className="p-0 overflow-hidden">
            <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex justify-between items-center">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Icon as={Building} size="md" className="text-[var(--text-muted)]" /> {t('agencies.table.title')}</h3>
              <div className="flex gap-2">
                <Button variant="secondary" className="text-xs py-1 h-8">{t('agencies.table.filter')}</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-[var(--text-muted)] uppercase bg-[var(--bg-surface)]">
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="px-4 py-3 font-semibold">{t('agencies.table.name')}</th>
                    <th className="px-4 py-3 font-semibold">ID</th>
                    <th className="px-4 py-3 font-semibold">{t('agencies.table.plan')}</th>
                    <th className="px-4 py-3 font-semibold">{t('agencies.table.created')}</th>
                    <th className="px-4 py-3 font-semibold text-right">{t('agencies.table.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {clients.map((client, idx) => (
                    <tr key={client.id} className="row-premium list-item-enter group" style={{ animationDelay: `${idx * 30}ms` }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-[var(--primary)] to-[var(--brand-tint)] flex items-center justify-center text-white font-bold text-xs">
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
                        <Tag dot variant="success" size="xs">Pro</Tag>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        {new Date(client.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" className="text-xs px-3 py-1.5 h-auto opacity-0 group-hover:opacity-100 transition-opacity">
                          {t('agencies.table.open')}
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
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Icon as={Package} size={18} className="text-[var(--primary)]" /> {t('agencies.snapshots.title')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-5 border-dashed border-2 hover:border-[var(--primary)] cursor-pointer transition-colors flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-[var(--brand-tint)] text-[var(--primary)] rounded-full flex items-center justify-center mb-3">
                  <Copy size={24} />
                </div>
                <h3 className="font-semibold mb-1">{t('agencies.snapshots.create')}</h3>
                <p className="text-xs text-[var(--text-muted)]">Sauvegardez la configuration d'un compte (Pipelines, Custom Fields, Workflows) pour la réutiliser.</p>
              </Card>
              
              <Card className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold flex items-center gap-2"><Package size={16} className="text-[var(--info)]" /> Courtier Immobilier V2</h3>
                  <Tag dot variant="info" size="xs">Standard</Tag>
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-4">Snapshot optimisé pour la génération de leads immobiliers avec 3 workflows inclus.</p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="text-xs flex-1">{t('agencies.snapshots.detail')}</Button>
                  <Button variant="primary" className="text-xs flex-1">{t('agencies.snapshots.push')}</Button>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      <Modal open={showAdd} onOpenChange={setShowAdd} title={t('agencies.modal.title')}>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">{t('agencies.modal.name')}</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Mathis Guimont" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">{t('agencies.modal.email')}</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Ex: mathis@exemple.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">{t('agencies.modal.phone')}</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ex: 819-555-0000" />
          </div>
          
          <div className="pt-2">
            <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">Appliquer un Snapshot</label>
            <select className="w-full px-3 py-2 text-sm border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)]">
              <option value="">{t('agencies.modal.no_snapshot')}</option>
              <option value="immo">Courtier Immobilier V2</option>
              <option value="dentist">Clinique Dentaire</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-6">
            <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>{t('agencies.modal.cancel')}</Button>
            <Button type="submit">{t('agencies.modal.submit')}</Button>
          </div>
        </form>
      </Modal>
    </AppLayout>
  );
}
