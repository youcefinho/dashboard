// ── Page Affiliates — Programme d'affiliation natif (LOT G2) ────────────────
//
// Corps réel Phase B (Manager-C front exclusif). Export FIGÉ `AffiliatesPage`
// (consommé par App.tsx route /affiliates via lazy — gelé Phase A). 3 onglets :
//   1. Programme  — config commission (type/valeur/cookie/url/statut) + explication
//                   du lien d'affiliation public /r/:code.
//   2. Affiliés   — liste CRUD (nom/email/code/lien copiable/statut).
//   3. Commissions — table filtrable par statut + actions par ligne (approuver/
//                    rejeter/marquer payée) + export CSV.
//
// Helpers api.ts FIGÉS Phase A consommés tels quels : getAffiliateProgram /
// updateAffiliateProgram / getAffiliates / createAffiliate / updateAffiliate /
// deleteAffiliate / getAffiliateCommissions / updateCommissionStatus /
// exportCommissionsCsv. i18n 100% `t('affiliate.*')` + clés communes
// (`action.*`, `common.*`) déjà présentes — AUCUNE création de clé.
// Discrimination erreur : présence de `res.data` / texte `res.error`,
// JAMAIS `res.code` (§6.A apiFetch gelé).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  Button,
  Card,
  Tag,
  Icon,
  Modal,
  Input,
  Select,
  Switch,
  Skeleton,
  EmptyState,
  FilterChip,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  PageHero,
  useToast,
  useConfirm,
} from '@/components/ui';
import {
  Plus,
  Trash2,
  Pencil,
  Copy,
  Check,
  Download,
  Users,
  Share2,
  DollarSign,
  Link2,
} from 'lucide-react';
import {
  getAffiliateProgram,
  updateAffiliateProgram,
  getAffiliates,
  createAffiliate,
  updateAffiliate,
  deleteAffiliate,
  getAffiliateCommissions,
  updateCommissionStatus,
  exportCommissionsCsv,
} from '@/lib/api';
import type {
  Affiliate,
  AffiliateProgram,
  AffiliateCommission,
} from '@/lib/api';
import { t } from '@/lib/i18n';

type CommissionStatus = 'pending' | 'approved' | 'paid' | 'rejected';
type ProgramType = 'fixed' | 'percent';
type ActiveStatus = 'active' | 'inactive';

// Mapping statut commission → variant Tag (Stripe-sober color-code).
const COMMISSION_TAG: Record<CommissionStatus, 'warning' | 'info' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'info',
  paid: 'success',
  rejected: 'danger',
};

const COMMISSION_LABEL: Record<CommissionStatus, string> = {
  pending: t('affiliate.commission.status.pending'),
  approved: t('affiliate.commission.status.approved'),
  paid: t('affiliate.commission.status.paid'),
  rejected: t('affiliate.commission.status.rejected'),
};

function affiliateLink(code: string | null | undefined): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  return `${origin}/r/${code ?? ''}`;
}

function fmtAmount(amount?: number | null, currency?: string | null): string {
  const n = typeof amount === 'number' ? amount : 0;
  const cur = (currency || 'CAD').toUpperCase();
  try {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: cur,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-CA');
}

export function AffiliatesPage() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<'program' | 'affiliates' | 'commissions'>(
    'program',
  );

  // ── Onglet Programme ──
  const [, setProgram] = useState<AffiliateProgram | null>(null);
  const [progLoading, setProgLoading] = useState(true);
  const [progBusy, setProgBusy] = useState(false);
  const [commType, setCommType] = useState<ProgramType>('percent');
  const [commValue, setCommValue] = useState<string>('10');
  const [cookieDays, setCookieDays] = useState<string>('30');
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [progActive, setProgActive] = useState(true);

  // ── Onglet Affiliés ──
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [affLoading, setAffLoading] = useState(true);
  const [affModalOpen, setAffModalOpen] = useState(false);
  const [affEditingId, setAffEditingId] = useState<string | null>(null);
  const [affName, setAffName] = useState('');
  const [affEmail, setAffEmail] = useState('');
  const [affStatus, setAffStatus] = useState<ActiveStatus>('active');
  const [affBusy, setAffBusy] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // ── Onglet Commissions ──
  const [commissions, setCommissions] = useState<AffiliateCommission[]>([]);
  const [commLoading, setCommLoading] = useState(true);
  const [commFilter, setCommFilter] = useState<CommissionStatus | 'all'>('all');
  const [exporting, setExporting] = useState(false);

  // ── Erreurs de chargement (inline retry, role="alert") ──
  const [progError, setProgError] = useState<string | null>(null);
  const [affError, setAffError] = useState<string | null>(null);
  const [commError, setCommError] = useState<string | null>(null);

  // ── Loaders ──
  const loadProgram = useCallback(async () => {
    setProgLoading(true);
    setProgError(null);
    const res = await getAffiliateProgram();
    if (res.data) {
      setProgram(res.data);
      setCommType((res.data.commission_type as ProgramType) || 'percent');
      setCommValue(String(res.data.commission_value ?? 10));
      setCookieDays(String(res.data.cookie_window_days ?? 30));
      setTargetUrl(res.data.target_url || '');
      setProgActive((res.data.status ?? 'active') === 'active');
    } else if (res.error) {
      setProgError(res.error);
    }
    setProgLoading(false);
  }, []);

  const loadAffiliates = useCallback(async () => {
    setAffLoading(true);
    setAffError(null);
    const res = await getAffiliates();
    if (res.data) setAffiliates(res.data);
    else if (res.error) setAffError(res.error);
    setAffLoading(false);
  }, []);

  const loadCommissions = useCallback(async () => {
    setCommLoading(true);
    setCommError(null);
    const params =
      commFilter === 'all' ? undefined : { status: commFilter };
    const res = await getAffiliateCommissions(params);
    if (res.data) setCommissions(res.data);
    else if (res.error) setCommError(res.error);
    setCommLoading(false);
  }, [commFilter]);

  useEffect(() => {
    void loadProgram();
    void loadAffiliates();
  }, [loadProgram, loadAffiliates]);

  useEffect(() => {
    void loadCommissions();
  }, [loadCommissions]);

  // ── Programme : save ──
  const handleSaveProgram = async () => {
    setProgBusy(true);
    const value = Number(commValue);
    const cookie = Number(cookieDays);
    const res = await updateAffiliateProgram({
      commission_type: commType,
      commission_value: Number.isFinite(value) ? value : 0,
      cookie_window_days: Number.isFinite(cookie) ? cookie : 30,
      target_url: targetUrl.trim() || null,
      status: progActive ? 'active' : 'inactive',
    });
    setProgBusy(false);
    if (res.data) {
      success(t('affiliate.program.save'));
      void loadProgram();
    } else {
      toastError(res.error || t('affiliate.program.save'));
    }
  };

  // ── Affiliés : CRUD ──
  const openCreateAff = () => {
    setAffEditingId(null);
    setAffName('');
    setAffEmail('');
    setAffStatus('active');
    setAffModalOpen(true);
  };

  const openEditAff = (a: Affiliate) => {
    setAffEditingId(a.id);
    setAffName(a.name || '');
    setAffEmail(a.email || '');
    setAffStatus((a.status as ActiveStatus) || 'active');
    setAffModalOpen(true);
  };

  const handleSaveAff = async () => {
    if (!affName.trim()) return;
    setAffBusy(true);
    const payload: Partial<Affiliate> = {
      name: affName.trim(),
      email: affEmail.trim() || null,
      status: affStatus,
    };
    const res = affEditingId
      ? await updateAffiliate(affEditingId, payload)
      : await createAffiliate(payload);
    setAffBusy(false);
    if (res.data) {
      setAffModalOpen(false);
      success(t('action.save'));
      void loadAffiliates();
    } else {
      toastError(res.error || t('action.save'));
    }
  };

  const handleDeleteAff = async (a: Affiliate) => {
    const ok = await confirm({
      title: t('action.delete'),
      description: `${a.name || a.email || a.code || ''}`,
      danger: true,
    });
    if (!ok) return;
    const res = await deleteAffiliate(a.id);
    if (res.data) {
      setAffiliates((prev) => prev.filter((x) => x.id !== a.id));
      success(t('action.delete'));
    } else {
      toastError(res.error || t('action.delete'));
    }
  };

  const copyLink = async (code: string | null | undefined) => {
    if (!code) return;
    const link = affiliateLink(code);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedCode(code);
      success(t('affiliate.list.link'));
      window.setTimeout(() => setCopiedCode(null), 1800);
    } catch {
      toastError(link);
    }
  };

  // ── Commissions : actions + export ──
  const handleCommissionStatus = async (
    c: AffiliateCommission,
    status: CommissionStatus,
  ) => {
    const res = await updateCommissionStatus(c.id, status);
    if (res.data) {
      setCommissions((prev) =>
        prev
          .map((x) => (x.id === c.id ? { ...x, status } : x))
          // Si un filtre est actif, retire les lignes qui n'y correspondent plus.
          .filter((x) =>
            commFilter === 'all' ? true : x.status === commFilter,
          ),
      );
      success(COMMISSION_LABEL[status]);
    } else {
      toastError(res.error || COMMISSION_LABEL[status]);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    const res = await exportCommissionsCsv();
    setExporting(false);
    if (res.data) {
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `commissions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      success(t('affiliate.action.export'));
    } else {
      toastError(res.error || t('affiliate.action.export'));
    }
  };

  const affiliateNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of affiliates) {
      map.set(a.id, a.name || a.email || a.code || a.id);
    }
    return map;
  }, [affiliates]);

  const filterDefs: Array<{ key: CommissionStatus | 'all'; label: string }> = [
    { key: 'all', label: t('affiliate.commission.title') },
    { key: 'pending', label: COMMISSION_LABEL.pending },
    { key: 'approved', label: COMMISSION_LABEL.approved },
    { key: 'paid', label: COMMISSION_LABEL.paid },
    { key: 'rejected', label: COMMISSION_LABEL.rejected },
  ];

  return (
    <AppLayout title={t('affiliate.title')}>
      <div className="p-6">
        <PageHero
          meta={t('affiliate.program.title')}
          title={t('affiliate.title')}
          description={
            affLoading
              ? t('affiliate.program.title')
              : `${affiliates.length} ${t('affiliate.list.title')}`
          }
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="program">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={Share2} size="sm" />
                {t('affiliate.program.title')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="affiliates">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={Users} size="sm" />
                {t('affiliate.list.title')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="commissions">
              <span className="inline-flex items-center gap-1.5">
                <Icon as={DollarSign} size="sm" />
                {t('affiliate.commission.title')}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* ── Onglet 1 — Programme ── */}
          <TabsContent value="program">
            {progError && !progLoading ? (
              <Card
                role="alert"
                aria-live="polite"
                className="p-4 mb-4 max-w-2xl border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
              >
                <span className="text-sm">{progError}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadProgram()}
                >
                  {t('action.retry')}
                </Button>
              </Card>
            ) : null}
            {progLoading ? (
              <Card className="p-6 max-w-2xl">
                <Skeleton className="h-4 w-1/3 mb-4" />
                <Skeleton className="h-10 w-full mb-3" />
                <Skeleton className="h-10 w-full mb-3" />
                <Skeleton className="h-10 w-full" />
              </Card>
            ) : (
              <div className="flex flex-col gap-4 max-w-2xl">
                <Card className="p-6 flex flex-col gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="prop-label">
                        {t('affiliate.program.type')}
                      </label>
                      <Select
                        value={commType}
                        onChange={(e) =>
                          setCommType(e.target.value as ProgramType)
                        }
                      >
                        <option value="percent">
                          {t('affiliate.program.type.percent')}
                        </option>
                        <option value="fixed">
                          {t('affiliate.program.type.fixed')}
                        </option>
                      </Select>
                    </div>
                    <div>
                      <label className="prop-label">
                        {t('affiliate.program.value')}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={commValue}
                        onChange={(e) => setCommValue(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="prop-label">
                        {t('affiliate.program.cookie_window')}
                      </label>
                      <Input
                        type="number"
                        min={1}
                        value={cookieDays}
                        onChange={(e) => setCookieDays(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="prop-label">
                        {t('affiliate.program.target_url')}
                      </label>
                      <Input
                        type="url"
                        placeholder="https://"
                        value={targetUrl}
                        onChange={(e) => setTargetUrl(e.target.value)}
                      />
                    </div>
                  </div>

                  <Switch
                    checked={progActive}
                    onCheckedChange={setProgActive}
                    variant="success"
                    label={t('affiliate.program.status')}
                  />

                  <div className="flex justify-end pt-2">
                    <Button
                      variant="primary"
                      isLoading={progBusy}
                      onClick={() => void handleSaveProgram()}
                    >
                      {t('affiliate.program.save')}
                    </Button>
                  </div>
                </Card>

                {/* Explication du lien d'affiliation public */}
                <Card className="p-5 flex items-start gap-3">
                  <Icon as={Link2} size="md" className="text-muted mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium mb-1">
                      {t('affiliate.list.link')}
                    </p>
                    <p className="text-muted mb-2">
                      {t('affiliate.public.landing.title')}
                    </p>
                    <code className="affiliate-link-code">
                      {affiliateLink('')}
                      <span className="affiliate-link-code__var">code</span>
                    </code>
                  </div>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ── Onglet 2 — Affiliés ── */}
          <TabsContent value="affiliates">
            <div className="flex justify-end mb-4">
              <Button
                variant="primary"
                leftIcon={<Icon as={Plus} size="sm" />}
                onClick={openCreateAff}
              >
                {t('affiliate.list.add')}
              </Button>
            </div>

            {affError && !affLoading ? (
              <Card
                role="alert"
                aria-live="polite"
                className="p-4 mb-4 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
              >
                <span className="text-sm">{affError}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadAffiliates()}
                >
                  {t('action.retry')}
                </Button>
              </Card>
            ) : null}

            {affLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            ) : affiliates.length === 0 ? (
              <EmptyState
                icon={<Icon as={Users} size={40} />}
                title={t('affiliate.list.title')}
                description={t('affiliate.list.empty')}
                action={
                  <Button
                    variant="primary"
                    leftIcon={<Icon as={Plus} size="sm" />}
                    onClick={openCreateAff}
                  >
                    {t('affiliate.list.add')}
                  </Button>
                }
                tips={[t('affiliate.list.link'), t('affiliate.program.title')]}
              />
            ) : (
              <div className="table-premium-container affiliate-table-wrap" aria-busy={affLoading}>
                <table className="table-premium">
                  <thead>
                    <tr>
                      <th>{t('affiliate.list.name')}</th>
                      <th>{t('affiliate.list.email')}</th>
                      <th>{t('affiliate.list.code')}</th>
                      <th>{t('affiliate.list.link')}</th>
                      <th>{t('affiliate.program.status')}</th>
                      <th aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {affiliates.map((a) => (
                      <tr
                        key={a.id}
                        className="affiliate-row"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') openEditAff(a);
                        }}
                      >
                        <td className="font-medium">{a.name || '—'}</td>
                        <td className="text-muted">{a.email || '—'}</td>
                        <td className="font-mono text-xs">{a.code || '—'}</td>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={
                              <Icon
                                as={copiedCode === a.code ? Check : Copy}
                                size="sm"
                              />
                            }
                            onClick={() => void copyLink(a.code)}
                            disabled={!a.code}
                          >
                            {t('affiliate.list.link')}
                          </Button>
                        </td>
                        <td>
                          <Tag
                            variant={
                              (a.status || 'active') === 'active'
                                ? 'success'
                                : 'neutral'
                            }
                            size="sm"
                            statusIcon
                          >
                            {(a.status || 'active') === 'active'
                              ? t('affiliate.status.active')
                              : t('affiliate.status.inactive')}
                          </Tag>
                        </td>
                        <td>
                          <div className="row-quick-actions flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<Icon as={Pencil} size="sm" />}
                              onClick={() => openEditAff(a)}
                              aria-label={t('action.edit')}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<Icon as={Trash2} size="sm" />}
                              onClick={() => void handleDeleteAff(a)}
                              aria-label={t('action.delete')}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ── Onglet 3 — Commissions ── */}
          <TabsContent value="commissions">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap items-center gap-2">
                {filterDefs.map((f) => (
                  <FilterChip
                    key={f.key}
                    label={f.label}
                    variant={commFilter === f.key ? 'active' : 'available'}
                    onClick={() => setCommFilter(f.key)}
                  />
                ))}
              </div>
              <Button
                variant="secondary"
                leftIcon={<Icon as={Download} size="sm" />}
                isLoading={exporting}
                onClick={() => void handleExport()}
                disabled={commissions.length === 0}
              >
                {t('affiliate.action.export')}
              </Button>
            </div>

            {commError && !commLoading ? (
              <Card
                role="alert"
                aria-live="polite"
                className="p-4 mb-4 border border-[var(--danger)]/40 bg-[var(--danger)]/5 flex items-center justify-between gap-3"
              >
                <span className="text-sm">{commError}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadCommissions()}
                >
                  {t('action.retry')}
                </Button>
              </Card>
            ) : null}

            {commLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            ) : commissions.length === 0 ? (
              <EmptyState
                icon={<Icon as={DollarSign} size={40} />}
                title={t('affiliate.commission.title')}
                description={t('affiliate.list.empty')}
                tips={[
                  t('affiliate.program.title'),
                  t('affiliate.list.link'),
                ]}
              />
            ) : (
              <div className="table-premium-container affiliate-table-wrap" aria-busy={commLoading}>
                <table className="table-premium">
                  <thead>
                    <tr>
                      <th>{t('affiliate.list.title')}</th>
                      <th>{t('common.lead')}</th>
                      <th>{t('affiliate.commission.amount')}</th>
                      <th>{t('affiliate.program.status')}</th>
                      <th>{t('common.enrolled_on')}</th>
                      <th aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {commissions.map((c) => {
                      const status =
                        (c.status as CommissionStatus) || 'pending';
                      return (
                        <tr key={c.id} className="affiliate-row">
                          <td className="font-medium">
                            {c.affiliate_id
                              ? affiliateNameById.get(c.affiliate_id) ||
                                c.affiliate_id
                              : '—'}
                          </td>
                          <td className="text-muted">{c.lead_id || '—'}</td>
                          <td className="tabular-nums">
                            {fmtAmount(c.amount, c.currency)}
                          </td>
                          <td>
                            <Tag
                              variant={COMMISSION_TAG[status]}
                              size="sm"
                              statusIcon
                            >
                              {COMMISSION_LABEL[status]}
                            </Tag>
                          </td>
                          <td className="text-muted">
                            {fmtDate(c.created_at)}
                          </td>
                          <td>
                            <div className="row-quick-actions flex items-center justify-end gap-1">
                              {status === 'pending' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      void handleCommissionStatus(
                                        c,
                                        'approved',
                                      )
                                    }
                                  >
                                    {t('affiliate.action.approve')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      void handleCommissionStatus(
                                        c,
                                        'rejected',
                                      )
                                    }
                                  >
                                    {t('affiliate.action.reject')}
                                  </Button>
                                </>
                              )}
                              {status === 'approved' && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    void handleCommissionStatus(c, 'paid')
                                  }
                                >
                                  {t('affiliate.action.mark_paid')}
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Modal création / édition affilié ── */}
      <Modal
        open={affModalOpen}
        onOpenChange={setAffModalOpen}
        title={affEditingId ? t('action.edit') : t('affiliate.list.add')}
        size="sm"
      >
        <div className="flex flex-col gap-4 p-1">
          <div>
            <label className="prop-label">{t('affiliate.list.name')}</label>
            <Input
              value={affName}
              autoFocus
              onChange={(e) => setAffName(e.target.value)}
            />
          </div>
          <div>
            <label className="prop-label">{t('affiliate.list.email')}</label>
            <Input
              type="email"
              value={affEmail}
              onChange={(e) => setAffEmail(e.target.value)}
            />
          </div>
          <Switch
            checked={affStatus === 'active'}
            onCheckedChange={(c) => setAffStatus(c ? 'active' : 'inactive')}
            variant="success"
            label={t('affiliate.program.status')}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setAffModalOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              isLoading={affBusy}
              disabled={!affName.trim()}
              onClick={() => void handleSaveAff()}
            >
              {t('action.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
