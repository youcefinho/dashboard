// ── SubAccountsSettings — LOT TEAM C (2026-05-19) ──────────────────────────
//
// Composant RÉEL Phase B Manager-C (remplace le STUB Phase A).
//   - Liste des sous-comptes via getClients() (helper tenant-scoped existant —
//     apiFetch borne déjà côté worker via X-Sub-Account / contexte tenant).
//   - Édition (updateClient) + désactivation soft (deleteClient → is_active=0
//     côté worker, JAMAIS de suppression dure).
//   - Aperçu rapports agence via getAgencyReports() (agrégat borné
//     accessibleClientIds côté worker).
//
// ⚠ LIMITE ASSUMÉE — « membres par sous-compte » : il n'existe PAS d'endpoint
//   simple listant les membres filtrés par sous-compte (l'API team
//   /team/users retourne le périmètre tenant entier, sans filtre client_id
//   exploitable côté front). On affiche donc liste + édition + désactivation
//   + aperçu rapports ; la gestion fine membres↔sous-compte se fait via
//   l'onglet Équipe (scope d'invitation). Documenté ici, pas d'endpoint
//   inventé (CODE > brief).
//
// i18n : préfixes `subacct.*` / `agrep.*` (catalogues figés Phase A, §6.G).
// Discrimination erreur = absence `data` / string-match (apiFetch GELÉ, §6.A).

import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Button,
  Input,
  Badge,
  Skeleton,
  EmptyState,
  useToast,
  useConfirm,
  Icon,
} from '@/components/ui';
import { Building, Pencil, Power, BarChart3, Check, X } from 'lucide-react';
import {
  getClients,
  updateClient,
  deleteClient,
  getAgencyReports,
} from '@/lib/api';
import type { Client } from '@/lib/types';
import { t } from '@/lib/i18n';

interface AgencyReportRow {
  client_id: string;
  client_name: string;
  lead_count: number;
  won_count: number;
  conversion: number;
}

export function SubAccountsSettings() {
  const { success, error } = useToast();
  const confirm = useConfirm();

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Édition inline d'un sous-compte.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // Aperçu rapports agence (best-effort, optionnel).
  const [reports, setReports] = useState<AgencyReportRow[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const res = await getClients();
    if (res.error || !res.data) {
      setLoadError(true);
      setClients([]);
    } else {
      setClients(res.data);
    }
    setLoading(false);
  }, []);

  const fetchReports = useCallback(async () => {
    setReportsLoading(true);
    const res = await getAgencyReports();
    // getAgencyReports figé renvoie ApiResponse<Record<string,unknown>> ;
    // le worker LOT C renvoie { data: AgencyReportRow[] } → cast souple.
    const rows = (res.data as unknown as AgencyReportRow[] | undefined) || [];
    setReports(Array.isArray(rows) ? rows : []);
    setReportsLoading(false);
  }, []);

  useEffect(() => {
    void fetchClients();
    void fetchReports();
  }, [fetchClients, fetchReports]);

  const startEdit = (c: Client) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditEmail(c.email);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditEmail('');
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    const res = await updateClient(id, { name: editName, email: editEmail });
    setSaving(false);
    if (res.error || !res.data) {
      error(t('subacct.error'));
      return;
    }
    success(t('subacct.updated'));
    cancelEdit();
    void fetchClients();
  };

  const handleDeactivate = async (c: Client) => {
    const ok = await confirm({
      title: t('subacct.action_delete'),
      description: t('subacct.confirm_delete'),
      confirmLabel: t('subacct.action_delete'),
      cancelLabel: t('subacct.cancel'),
      danger: true,
    });
    if (!ok) return;
    const res = await deleteClient(c.id);
    if (res.error || !res.data) {
      error(t('subacct.error'));
      return;
    }
    success(t('subacct.deleted'));
    void fetchClients();
  };

  return (
    <div className="space-y-6">
      {/* ── Liste des sous-comptes ── */}
      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Building} size="md" className="text-[var(--primary)]" />{' '}
              {t('subacct.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">{t('subacct.subtitle')}</p>
          </div>
        </header>

        {loading ? (
          <div className="space-y-2 mt-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : loadError ? (
          <p className="text-sm text-[var(--danger)] py-6 text-center">
            {t('subacct.error')}
          </p>
        ) : clients.length === 0 ? (
          <EmptyState
            icon={<Building size={28} />}
            title={t('subacct.empty')}
            description={t('subacct.subtitle')}
          />
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <th className="py-2 pr-4 font-medium">{t('subacct.col_name')}</th>
                  <th className="py-2 pr-4 font-medium">{t('subacct.col_email')}</th>
                  <th className="py-2 pr-4 font-medium">{t('subacct.col_status')}</th>
                  <th className="py-2 font-medium text-right">{t('subacct.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const isEditing = editingId === c.id;
                  const isActive = c.is_active !== 0;
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-[var(--border-subtle)] last:border-0"
                    >
                      <td className="py-2.5 pr-4">
                        {isEditing ? (
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8"
                          />
                        ) : (
                          <span className="font-medium text-[var(--text-primary)]">
                            {c.name}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        {isEditing ? (
                          <Input
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            className="h-8"
                          />
                        ) : (
                          <span className="text-[var(--text-secondary)]">{c.email}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge intent={isActive ? 'success' : 'neutral'}>
                          {isActive
                            ? t('subacct.status_active')
                            : t('subacct.status_inactive')}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex gap-1.5">
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={saving}
                              onClick={() => void saveEdit(c.id)}
                              leftIcon={<Icon as={Check} size="sm" />}
                            >
                              {t('subacct.save')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelEdit}
                              leftIcon={<Icon as={X} size="sm" />}
                            >
                              {t('subacct.cancel')}
                            </Button>
                          </div>
                        ) : (
                          <div className="inline-flex gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(c)}
                              leftIcon={<Icon as={Pencil} size="sm" />}
                            >
                              {t('subacct.action_edit')}
                            </Button>
                            {isActive && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void handleDeactivate(c)}
                                leftIcon={<Icon as={Power} size="sm" />}
                              >
                                {t('subacct.action_delete')}
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Aperçu rapports agence (agrégat borné côté worker) ── */}
      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={BarChart3} size="md" className="text-[var(--primary)]" />{' '}
              {t('agrep.title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">{t('agrep.subtitle')}</p>
          </div>
        </header>

        {reportsLoading ? (
          <div className="space-y-2 mt-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : reports.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center">
            {t('agrep.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <th className="py-2 pr-4 font-medium">{t('agrep.col_subaccount')}</th>
                  <th className="py-2 pr-4 font-medium text-right">
                    {t('agrep.col_leads')}
                  </th>
                  <th className="py-2 font-medium text-right">
                    {t('agrep.col_conversion')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr
                    key={r.client_id}
                    className="border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <td className="py-2.5 pr-4 font-medium text-[var(--text-primary)]">
                      {r.client_name || r.client_id}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-[var(--text-secondary)]">
                      {r.lead_count}
                    </td>
                    <td className="py-2.5 text-right text-[var(--text-secondary)]">
                      {r.conversion}%
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
