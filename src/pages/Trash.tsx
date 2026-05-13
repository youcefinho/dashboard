// ── Page Corbeille — Leads supprimés ──────────────────────

import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Badge, EmptyState, Skeleton } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { getTrash, restoreLead, emptyTrash } from '@/lib/api';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';

interface TrashItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  client_id: string;
  deleted_at: string;
}

export function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const fetchTrash = async () => {
    setIsLoading(true);
    try {
      const res = await getTrash();
      if (res.data) setItems(res.data as unknown as TrashItem[]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchTrash();
  }, []);

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    try {
      const res = await restoreLead(id);
      if (!res.error) {
        setItems(prev => prev.filter(i => i.id !== id));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRestoringId(null);
    }
  };

  const handleEmptyTrash = async () => {
    try {
      await emptyTrash();
      setShowConfirm(false);
      void fetchTrash();
    } catch (err) {
      console.error(err);
    }
  };

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffD = Math.floor(diffMs / 86400000);
    if (diffD === 0) return "aujourd'hui";
    if (diffD === 1) return 'hier';
    if (diffD < 7) return `il y a ${diffD} jours`;
    if (diffD < 30) return `il y a ${Math.floor(diffD / 7)} semaines`;
    return `il y a ${diffD} jours`;
  };

  const daysRemaining = (dateStr: string): number => {
    const deletedAt = new Date(dateStr).getTime();
    const thirtyDaysMs = 30 * 86400000;
    const remaining = Math.ceil((deletedAt + thirtyDaysMs - Date.now()) / 86400000);
    return Math.max(0, remaining);
  };

  return (
    <AppLayout title="Corbeille">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <Trash2 size={24} className="text-[var(--text-muted)]" />
            Corbeille
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Les leads supprimés sont conservés 30 jours avant d'être définitivement effacés.
          </p>
        </div>
        {items.length > 0 && (
          <Button variant="destructive" size="sm" leftIcon={<AlertTriangle size={14} />}
            onClick={() => setShowConfirm(true)}>
            Vider la corbeille
          </Button>
        )}
      </div>

      {isLoading ? (
        <Card><Skeleton className="h-64 w-full" /></Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Trash2 size={48} />}
          title="Corbeille vide"
          description="Aucun lead supprimé. Les leads supprimés apparaîtront ici pendant 30 jours."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left px-4 py-3 text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold">Contact</th>
                  <th className="text-left px-4 py-3 text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold">Email</th>
                  <th className="text-left px-4 py-3 text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold">Téléphone</th>
                  <th className="text-left px-4 py-3 text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold">Supprimé</th>
                  <th className="text-left px-4 py-3 text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold">Expire dans</th>
                  <th className="text-right px-4 py-3 text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const days = daysRemaining(item.deleted_at);
                  const urgencyColor = days <= 5 ? 'var(--danger)' : days <= 15 ? 'var(--warning)' : 'var(--text-muted)';
                  return (
                    <tr key={item.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-subtle)] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={item.name} size="sm" />
                          <span className="font-medium text-[var(--text-primary)]">{item.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{item.email}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{item.phone || '—'}</td>
                      <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{timeAgo(item.deleted_at)}</td>
                      <td className="px-4 py-3">
                        <Badge color={urgencyColor}>{days}j restants</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" size="sm" leftIcon={<RotateCcw size={14} />}
                          onClick={() => handleRestore(item.id)}
                          disabled={restoringId === item.id}>
                          {restoringId === item.id ? 'Restauration...' : 'Restaurer'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal confirmation vider */}
      <Modal open={showConfirm} onOpenChange={() => setShowConfirm(false)} title="Vider la corbeille ?">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-[var(--danger)]/8 rounded-xl border border-[var(--danger)]/20">
            <AlertTriangle size={20} className="text-[var(--danger)] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-[var(--text-primary)]">Action irréversible</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Cette action supprimera définitivement <strong>{items.length} lead(s)</strong> et toutes leurs données associées. Cette action ne peut pas être annulée.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowConfirm(false)}>Annuler</Button>
            <Button variant="destructive" onClick={handleEmptyTrash}>Supprimer définitivement</Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}