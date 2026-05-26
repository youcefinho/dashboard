// ── Agency Master View — SaaS Sous-comptes (Lot 2 §6.9 / §6.11 / §6.12) ──

import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, EmptyState, Skeleton, PageHero, KpiStrip, Icon, useToast, type KpiItem } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import {
  getAgencySubAccounts,
  createClient,
  switchSubAccount,
  getActiveSubAccount,
  setActiveSubAccount,
  type AgencySubAccount,
} from '@/lib/api';
import { Building, Plus, Activity, ListChecks, ShieldAlert } from 'lucide-react';
import { t } from '@/lib/i18n';

const ALL_VALUE = '__all__';

export function AgenciesPage() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [subAccounts, setSubAccounts] = useState<AgencySubAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [active, setActive] = useState<string | null>(() => getActiveSubAccount());
  const [switching, setSwitching] = useState(false);

  // Champs création
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const fetchSubAccounts = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await getAgencySubAccounts();
      if (res.error || !res.data) {
        setLoadError(true);
      } else {
        setSubAccounts(res.data);
      }
    } catch (err) {
      console.error(err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') void fetchSubAccounts();
  }, [user]);

  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState(false);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setCreating(true);
    try {
      const res = await createClient({ name: trimmed, email, phone });
      if (res.error || !res.data) {
        toastError(res.error || t('agencies.create.error'));
        return;
      }
      success(t('agencies.create.success', { name: trimmed }));
      setShowAdd(false);
      setName('');
      setEmail('');
      setPhone('');
      void fetchSubAccounts();
    } catch (err) {
      console.error(err);
      toastError(t('agencies.create.error'));
    } finally {
      setCreating(false);
    }
  };

  // §6.11 : switch délégué au backend (résolveur Lot 1). 200 ⇒ api.ts a
  // déjà persisté la clé localStorage ; ici on reflète l'état + recharge.
  // 403 ⇒ NE PAS persister (api.ts ne persiste pas) ⇒ toast erreur.
  const handleSwitch = async (value: string) => {
    if (value === ALL_VALUE) {
      setActiveSubAccount(null);
      setActive(null);
      void fetchSubAccounts();
      return;
    }
    if (value === active) return;
    setSwitching(true);
    try {
      const res = await switchSubAccount(value);
      if (res.error || !res.data) {
        toastError(t('agencies.switch.error'));
        return;
      }
      setActive(value);
      const acc = subAccounts.find((s) => s.id === value);
      success(t('agencies.switch.success', { name: acc?.name ?? value }));
      void fetchSubAccounts();
    } catch (err) {
      console.error(err);
      toastError(t('agencies.switch.error'));
    } finally {
      setSwitching(false);
    }
  };

  const handleExitSubAccount = () => {
    setActiveSubAccount(null);
    setActive(null);
    void fetchSubAccounts();
  };

  if (user?.role !== 'admin') {
    return (
      <AppLayout title={t('agencies.access.denied')}>
        <EmptyState title={t('agencies.access.denied')} description={t('agencies.access.desc')} />
      </AppLayout>
    );
  }

  // KPI réels agrégés (aucun chiffre inventé : MRR = Lot 3 / abonnements,
  // donc retiré ; on affiche prospects + tâches réels sommés).
  const totals = useMemo(
    () =>
      subAccounts.reduce(
        (acc, s) => {
          acc.leads += s.leadsCount;
          acc.tasks += s.tasksCount;
          return acc;
        },
        { leads: 0, tasks: 0 }
      ),
    [subAccounts]
  );

  const kpiItems: KpiItem[] = [
    { label: t('agencies.kpi.sub_accounts'), value: subAccounts.length, icon: <Building size={11} />, color: 'brand' },
    { label: t('agencies.table.leads'), value: totals.leads, icon: <Activity size={11} />, color: 'info' },
    { label: t('agencies.table.tasks'), value: totals.tasks, icon: <ListChecks size={11} />, color: 'success' },
  ];

  const activeAccount = active ? subAccounts.find((s) => s.id === active) : null;

  return (
    <AppLayout title={t('agencies.page.title')}>
      <PageHero
        meta="Workspace · Master view"
        title={t('agencies.hero.title')}
        highlight={t('agencies.hero.title')}
        description={t('agencies.hero.desc')}
        actions={<Button variant="premium" onClick={() => setShowAdd(true)} leftIcon={<Icon as={Plus} size="sm" />}>{t('agencies.action.create')}</Button>}
      />

      {/* Bandeau Loi 25 — accès sous-compte journalisé */}
      {active && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <Icon as={ShieldAlert} size="md" className="text-[var(--warning)] shrink-0" />
            {t('agencies.law25.banner', { name: activeAccount?.name ?? active })}
          </p>
          <Button variant="secondary" className="text-xs py-1 h-8 shrink-0" onClick={handleExitSubAccount}>
            {t('agencies.law25.exit')}
          </Button>
        </div>
      )}

      <KpiStrip items={kpiItems} />

      {/* Sélecteur de switch sous-compte */}
      {!isLoading && !loadError && subAccounts.length > 0 && (
        <div className="my-4 flex flex-wrap items-center gap-3">
          <label htmlFor="agency-switch" className="text-sm font-medium text-[var(--text-secondary)]">
            {t('agencies.switch.label')}
          </label>
          <select
            id="agency-switch"
            disabled={switching}
            aria-busy={switching}
            aria-label={t('agencies.switch.label')}
            value={active ?? ALL_VALUE}
            onChange={(e) => void handleSwitch(e.target.value)}
            className="min-w-[14rem] px-3 py-2 text-sm border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)] disabled:opacity-60"
          >
            <option value={ALL_VALUE}>{t('agencies.switch.all')}</option>
            {subAccounts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
                <Skeleton className="h-3 w-16 rounded shrink-0" />
                <Skeleton className="h-3 w-20 rounded shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      ) : loadError ? (
        <EmptyState
          title={t('agencies.error.load')}
          description={t('agencies.error.load')}
          action={<Button variant="primary" onClick={() => void fetchSubAccounts()}>{t('agencies.table.filter')}</Button>}
        />
      ) : subAccounts.length === 0 ? (
        <EmptyState
          variant="first-time"
          title={t('agencies.empty.title')}
          description={t('agencies.empty.desc')}
          action={<Button variant="primary" onClick={() => setShowAdd(true)}>{t('agencies.empty.action')}</Button>}
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] flex justify-between items-center">
            <h3 className="font-semibold text-sm flex items-center gap-2"><Icon as={Building} size="md" className="text-[var(--text-muted)]" /> {t('agencies.table.title')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-[var(--text-muted)] uppercase bg-[var(--bg-surface)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-4 py-3 font-semibold">{t('agencies.table.name')}</th>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold text-right">{t('agencies.table.leads')}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t('agencies.table.tasks')}</th>
                  <th className="px-4 py-3 font-semibold">{t('agencies.table.created')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {subAccounts.map((acc, idx) => (
                  <tr
                    key={acc.id}
                    className={`row-premium list-item-enter ${acc.id === active ? 'bg-[var(--warning)]/5' : ''}`}
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-gradient-to-br from-[var(--primary)] to-[var(--brand-tint)] flex items-center justify-center text-white font-bold text-xs">
                          {acc.name.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-[var(--text-primary)]">{acc.name}</p>
                          <p className="text-[10px] text-[var(--text-muted)]">{acc.email || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[11px] font-mono text-[var(--text-muted)]">
                      {acc.id.substring(0, 8)}...
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-[var(--text-secondary)]">
                      {t('agencies.kpi.leads_real', { count: acc.leadsCount })}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-[var(--text-secondary)]">
                      {t('agencies.kpi.tasks_real', { count: acc.tasksCount })}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                      {new Date(acc.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={showAdd} onOpenChange={setShowAdd} title={t('agencies.modal.title')}>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="agency-create-name" className="text-sm font-medium text-[var(--text-secondary)]">
              {t('agencies.modal.name')} <span aria-hidden="true" className="text-[var(--danger)]">*</span>
            </label>
            <Input
              id="agency-create-name"
              value={name}
              onChange={e => { setName(e.target.value); if (nameError) setNameError(false); }}
              placeholder="Ex: Mathis Guimont"
              required
              aria-required="true"
              aria-invalid={nameError || undefined}
              aria-describedby={nameError ? 'agency-create-name-err' : undefined}
            />
            {nameError && (
              <p id="agency-create-name-err" role="alert" className="text-xs text-[var(--danger)]">
                {t('agencies.create.name_required')}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">{t('agencies.modal.email')}</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Ex: mathis@exemple.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-secondary)]">{t('agencies.modal.phone')}</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ex: 819-555-0000" />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-6">
            <Button variant="secondary" type="button" disabled={creating} onClick={() => setShowAdd(false)}>{t('agencies.modal.cancel')}</Button>
            <Button type="submit" disabled={creating} aria-busy={creating}>
              {creating ? t('agencies.modal.submitting') : t('agencies.modal.submit')}
            </Button>
          </div>
        </form>
      </Modal>
    </AppLayout>
  );
}
