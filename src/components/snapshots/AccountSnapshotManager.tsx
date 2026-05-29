import { useCallback, useEffect, useState } from 'react';
import { Camera, Play, Trash2, Calendar } from 'lucide-react';
import {
  getAccountSnapshots,
  createAccountSnapshot,
  applyAccountSnapshot,
  deleteAccountSnapshot,
  getAgencySubAccounts,
  type AccountSnapshot,
  type AgencySubAccount,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

export function AccountSnapshotManager() {
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [subAccounts, setSubAccounts] = useState<AgencySubAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toast = useToast();

  // Modals et actions
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);

  const [applyModalOpen, setApplyModalOpen] = useState<boolean>(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<AccountSnapshot | null>(null);
  const [selectedSubAccount, setSelectedSubAccount] = useState<string>('');
  const [applying, setApplying] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [snapRes, subRes] = await Promise.all([
        getAccountSnapshots(),
        getAgencySubAccounts(),
      ]);

      if (snapRes.error) {
        setErrorMsg(snapRes.error);
      } else if (snapRes.data) {
        setSnapshots(snapRes.data);
      }

      if (subRes.data) {
        setSubAccounts(subRes.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t('api.unavailable'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setCreating(true);
    const res = await createAccountSnapshot(newName, newDescription || undefined);
    setCreating(false);

    if (res.error) {
      toast.error(res.error);
    } else if (res.data) {
      toast.success(t('account_snapshots.success_create'));
      setNewName('');
      setNewDescription('');
      setCreateModalOpen(false);
      void loadData();
    }
  };

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSnapshot || !selectedSubAccount) return;

    setApplying(true);
    const res = await applyAccountSnapshot(selectedSnapshot.id, selectedSubAccount);
    setApplying(false);

    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(t('account_snapshots.success_apply'));
      setSelectedSubAccount('');
      setSelectedSnapshot(null);
      setApplyModalOpen(false);
    }
  };

  const handleDelete = async (snapshotId: string) => {
    if (!confirm(t('account_snapshots.delete_confirm_desc'))) {
      return;
    }

    const res = await deleteAccountSnapshot(snapshotId);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(t('account_snapshots.success_delete'));
      void loadData();
    }
  };

  return (
    <div className="space-y-6" data-testid="account-snapshot-manager">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="t-h2">{t('account_snapshots.title')}</h2>
          <p className="t-caption text-[var(--gray-500)] mt-1">
            {t('account_snapshots.desc')}
          </p>
        </div>
        <Button
          variant="premium"
          onClick={() => setCreateModalOpen(true)}
          leftIcon={<Icon as={Camera} size="sm" />}
          aria-label={t('account_snapshots.create_btn')}
        >
          {t('account_snapshots.create_btn')}
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border border-[var(--border)] rounded-xl p-4 space-y-3">
              <Skeleton className="h-6 w-3/4 rounded-md" />
              <Skeleton className="h-4 w-1/2 rounded-md" />
              <div className="flex gap-2 pt-2">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : errorMsg ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          {errorMsg}
        </div>
      ) : snapshots.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-sm text-[var(--text-muted)] italic">
            {t('account_snapshots.empty')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow"
            >
              <div>
                <h3 className="font-semibold text-[var(--text-primary)] text-base">{snap.name}</h3>
                {snap.description && (
                  <p className="text-sm text-[var(--text-muted)] mt-1 line-clamp-2">
                    {snap.description}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <Icon as={Calendar} size={12} />
                  <span>{new Date(snap.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="flex gap-2 mt-4 pt-3 border-t border-[var(--border)]">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setSelectedSnapshot(snap);
                    setApplyModalOpen(true);
                  }}
                  leftIcon={<Icon as={Play} size="sm" />}
                >
                  {t('agencies.mgmt.sub.confirm_ok')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleDelete(snap.id)}
                  leftIcon={<Icon as={Trash2} size="sm" />}
                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-100"
                >
                  {t('smartlists.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Créer */}
      <Modal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        title={t('account_snapshots.create_title')}
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label={t('account_snapshots.name_label')}
            placeholder={t('account_snapshots.name_ph')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            disabled={creating}
          />
          <Textarea
            label={t('account_snapshots.desc_label')}
            placeholder={t('account_snapshots.desc_ph')}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            disabled={creating}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setCreateModalOpen(false)}
              disabled={creating}
            >
              {t('agencies.mgmt.cancel')}
            </Button>
            <Button type="submit" variant="primary" isLoading={creating}>
              {t('account_snapshots.submit_create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Appliquer */}
      <Modal
        open={applyModalOpen}
        onOpenChange={setApplyModalOpen}
        title={t('account_snapshots.apply_title')}
        description={t('account_snapshots.apply_desc')}
      >
        <form onSubmit={handleApply} className="space-y-4">
          <Select
            label={t('account_snapshots.target_label')}
            value={selectedSubAccount}
            onChange={(e) => setSelectedSubAccount(e.target.value)}
            required
            disabled={applying}
          >
            <option value="" disabled>
              {t('account_snapshots.target_select_ph')}
            </option>
            {subAccounts.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </Select>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setApplyModalOpen(false);
                setSelectedSubAccount('');
              }}
              disabled={applying}
            >
              {t('agencies.mgmt.cancel')}
            </Button>
            <Button type="submit" variant="primary" isLoading={applying}>
              {t('account_snapshots.submit_apply')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
