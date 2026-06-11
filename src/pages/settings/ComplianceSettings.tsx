// ── ComplianceSettings — Sprint 23 W33 : KpiStrip + Textarea + useToast + Switch + row-premium
import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import { t } from '@/lib/i18n';
import {
  Card,
  Button,
  Textarea,
  Switch,
  Tag,
  KpiStrip,
  EmptyState,
  useToast,
  Icon,
} from '@/components/ui';
import { Shield, Ban, Download, Mail, Smartphone, FileCheck, Trash2, Clock, AlertTriangle, Eye } from 'lucide-react';
import { ConsentManager } from '@/components/compliance/ConsentManager';

interface Unsubscribe {
  id: string;
  email: string;
  phone: string;
  channel: string;
  reason: string;
  unsubscribed_at: string;
}

export function ComplianceSettings() {
  const { success, error: toastError } = useToast();
  const [amfCert, setAmfCert] = useState('');
  const [amfRequired, setAmfRequired] = useState(false);
  const [unsubscribes, setUnsubscribes] = useState<Unsubscribe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setIsLoading(true);

    // Load unsubscribes + settings in parallel ; surface error UI if both fail.
    const pUnsub = apiFetch<Unsubscribe[]>('/unsubscribes')
      .then((res) => ({ ok: true as const, res }))
      .catch(() => ({ ok: false as const, res: null }));

    const pSettings = apiFetch<any>('/settings/compliance')
      .then((res) => ({ ok: true as const, res }))
      .catch(() => ({ ok: false as const, res: null }));

    void Promise.all([pUnsub, pSettings]).then(([u, s]) => {
      if (cancelled) return;
      if (u.ok && u.res) setUnsubscribes(u.res.data || []);
      if (s.ok && s.res && s.res.data) {
        setAmfCert(s.res.data.amf_certificate || '');
        setAmfRequired(s.res.data.amf_disclaimer_required === 1);
      }
      if (!u.ok && !s.ok) {
        setLoadError(true);
        toastError(t('compliance.toast_load_error'));
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [reloadKey, toastError]);

  const handleSaveAmf = async () => {
    setIsSaving(true);
    try {
      await apiFetch('/settings/compliance', {
        method: 'PATCH',
        body: JSON.stringify({
          amf_certificate: amfCert,
          amf_disclaimer_required: amfRequired ? 1 : 0,
        }),
      });
      success(t('compliance.toast_saved'));
    } catch (err: any) {
      toastError(err?.message || t('compliance.toast_save_error'));
    }
    setIsSaving(false);
  };

  const handleExportUnsubscribes = () => {
    if (!unsubscribes || unsubscribes.length === 0) {
      toastError(t('compliance.toast_no_export'));
      return;
    }
    try {
      const csvContent =
        'data:text/csv;charset=utf-8,' +
        'Email,Phone,Channel,Date\n' +
        unsubscribes.map((e) => `${e.email},${e.phone},${e.channel},${e.unsubscribed_at}`).join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', 'unsubscribes.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      success(t('compliance.toast_export_ok'));
    } catch (err: any) {
      toastError(err?.message || t('compliance.toast_export_error'));
    }
  };

  const timeAgo = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 1) return t('compliance.time_now');
    if (diffMin < 60) return t('compliance.time_min').replace('{n}', String(diffMin));
    if (diffH < 24) return t('compliance.time_hour').replace('{n}', String(diffH));
    return t('compliance.time_day').replace('{n}', String(diffD));
  };

  const kpis = useMemo(() => {
    const byEmail = unsubscribes.filter((u) => u.channel === 'email').length;
    const bySms = unsubscribes.filter((u) => u.channel === 'sms').length;
    return [
      { label: t('compliance.kpi_total'), value: unsubscribes.length, color: 'danger' as const, icon: <Ban size={12} /> },
      { label: t('compliance.kpi_email'), value: byEmail, color: 'brand' as const, icon: <Mail size={12} /> },
      { label: t('compliance.kpi_sms'), value: bySms, color: 'warning' as const, icon: <Smartphone size={12} /> },
      { label: t('compliance.kpi_rgpd'), value: 0, color: 'neutral' as const, icon: <FileCheck size={12} /> },
    ];
  }, [unsubscribes]);

  return (
    <div className="space-y-6 animate-fade-in" data-testid="compliance-settings">
      <header className="settings-page-header">
        <div>
          <h2 className="t-h2 flex items-center gap-2">
            <Icon as={Shield} size="lg" className="text-[var(--primary)]" />
            {t('compliance.page_title')}
          </h2>
          <p className="t-caption text-[var(--gray-500)]">
            {t('compliance.page_subtitle')}
          </p>
        </div>
      </header>

      {loadError && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft,rgba(239,68,68,0.08))] p-4 flex items-center justify-between gap-3"
          data-testid="compliance-load-error"
        >
          <p className="text-sm text-[var(--danger)] flex-1">
            {t('compliance.toast_load_error')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            {t('compliance.retry')}
          </Button>
        </div>
      )}

      <KpiStrip items={kpis} />

      <Card className="settings-card p-6">
        <header className="settings-section-header">
          <h3 className="t-h3 flex items-center gap-2">
            <Shield size={16} className="text-[var(--primary)]" /> {t('compliance.legal_title')}
          </h3>
          <p className="t-caption text-[var(--gray-500)]">
            {t('compliance.legal_subtitle')}
          </p>
        </header>
        <div
          className="settings-toggle-row"
          role="group"
          aria-label={t('compliance.disclaimer_aria')}
          data-testid="compliance-amf-toggle"
        >
          <div className="settings-toggle-row__meta">
            <p className="settings-toggle-row__title">{t('compliance.auto_title')}</p>
            <p className="settings-toggle-row__desc">
              {t('compliance.auto_desc')}
            </p>
          </div>
          <Switch checked={amfRequired} onCheckedChange={setAmfRequired} variant="brand" />
        </div>
        {amfRequired && (
          <div className="settings-form-row settings-form-row--full">
            <label className="settings-label">
              {t('compliance.text_label')}
            </label>
            <Textarea
              value={amfCert}
              onChange={(e) => setAmfCert(e.target.value)}
              placeholder={t('compliance.text_placeholder')}
              maxLength={500}
              showCounter
              className="h-[88px]"
            />
            <p className="settings-helper">{t('compliance.text_helper')}</p>
          </div>
        )}
        <div className="settings-actions">
          <Button
            onClick={handleSaveAmf}
            disabled={isSaving || (amfRequired && !amfCert)}
            isLoading={isSaving}
            aria-busy={isSaving}
            data-testid="compliance-save-amf"
          >
            {t('compliance.save')}
          </Button>
        </div>
      </Card>

      <Card className="settings-card p-0 overflow-hidden">
        <header className="settings-section-header settings-section-header--inset settings-section-header--with-action">
          <div>
            <h3 className="t-h3 flex items-center gap-2">
              <Icon as={Ban} size="md" className="text-[var(--danger)]" /> {t('compliance.optout_title')}
            </h3>
            <p className="t-caption text-[var(--gray-500)]">{t('compliance.optout_subtitle')}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportUnsubscribes}
            leftIcon={<Icon as={Download} size="sm" />}
            data-testid="compliance-export-csv"
          >
            {t('compliance.export_csv')}
          </Button>
        </header>

        {isLoading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">{t('compliance.loading')}</div>
        ) : unsubscribes.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Ban size={28} />}
            title={t('compliance.empty_title')}
            description={t('compliance.empty_desc')}
          />
        ) : (
          <div className="p-4 space-y-2.5">
            {unsubscribes.map((unsub, idx) => (
              <div
                key={unsub.id}
                className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {unsub.email || unsub.phone}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">{timeAgo(unsub.unsubscribed_at)}</p>
                </div>
                <Tag variant={unsub.channel === 'sms' ? 'warning' : 'danger'} dot>
                  {unsub.channel}
                </Tag>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Loi 25 — gestion du consentement (journal lead + statut cookies) */}
      <ConsentManager />

      {/* Sprint 93 — Purge RGPD & Loi 25 automatisée */}
      <PurgeSection />
    </div>
  );
}

// ── Sprint 93 — Section Purge RGPD & Loi 25 ──────────────────────────────────────

interface PurgeRule {
  id: string;
  client_id: string;
  inactive_days: number;
  action: string;
  created_at: string;
  updated_at: string;
}

function PurgeSection() {
  const { success, error: toastError } = useToast();
  const [rules, setRules] = useState<PurgeRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Formulaire ajout
  const [newDays, setNewDays] = useState('365');
  const [newAction, setNewAction] = useState('anonymize');
  const [newClientId, setNewClientId] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const loadRules = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch<PurgeRule[]>('/compliance/purge/rules');
      setRules(res.data || []);
    } catch {
      // Table pas encore créée — on affiche vide
      setRules([]);
    }
    setIsLoading(false);
  };

  useEffect(() => { void loadRules(); }, []);

  const handleCreate = async () => {
    if (!newClientId.trim()) {
      toastError('ID client requis');
      return;
    }
    setIsCreating(true);
    try {
      await apiFetch('/compliance/purge/rules', {
        method: 'POST',
        body: JSON.stringify({
          client_id: newClientId.trim(),
          inactive_days: parseInt(newDays) || 365,
          action: newAction,
        }),
      });
      success('Règle de purge créée');
      setNewClientId('');
      setNewDays('365');
      void loadRules();
    } catch (err: unknown) {
      toastError((err as Error)?.message || 'Erreur création règle');
    }
    setIsCreating(false);
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await apiFetch(`/compliance/purge/rules/${ruleId}`, { method: 'DELETE' });
      success('Règle supprimée');
      void loadRules();
    } catch (err: unknown) {
      toastError((err as Error)?.message || 'Erreur suppression');
    }
  };

  const handlePreview = async () => {
    try {
      const clientParam = newClientId.trim() ? `?client_id=${encodeURIComponent(newClientId.trim())}` : '';
      const res = await apiFetch<{ total: number }>(`/compliance/purge/preview${clientParam}`);
      setPreviewCount(res.data?.total ?? 0);
      success(`${res.data?.total ?? 0} lead(s) éligible(s) à la purge`);
    } catch (err: unknown) {
      toastError((err as Error)?.message || 'Erreur prévisualisation');
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    setShowConfirm(false);
    try {
      const res = await apiFetch<{ report: { total_processed: number } }>('/compliance/purge/run', {
        method: 'POST',
        body: JSON.stringify({ client_id: newClientId.trim() || undefined }),
      });
      const total = res.data?.report?.total_processed ?? 0;
      success(`Purge exécutée — ${total} lead(s) traité(s)`);
      setPreviewCount(null);
      void loadRules();
    } catch (err: unknown) {
      toastError((err as Error)?.message || 'Erreur exécution purge');
    }
    setIsRunning(false);
  };

  return (
    <Card className="settings-card p-0 overflow-hidden">
      <header className="settings-section-header settings-section-header--inset">
        <div>
          <h3 className="t-h3 flex items-center gap-2">
            <Icon as={Trash2} size="md" className="text-[var(--danger)]" />
            Purge automatique (Loi 25 / RGPD)
          </h3>
          <p className="t-caption text-[var(--gray-500)]">
            Suppression ou anonymisation automatique des leads inactifs selon la politique de rétention.
          </p>
        </div>
      </header>

      <div className="p-5 space-y-5">
        {/* Formulaire ajout */}
        <div className="flex flex-wrap items-end gap-3 p-4 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
          <div className="flex-1 min-w-[140px]">
            <label className="t-caption block mb-1">ID Client</label>
            <input
              type="text"
              value={newClientId}
              onChange={(e) => setNewClientId(e.target.value)}
              placeholder="client-uuid"
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--bg-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-ring)]"
            />
          </div>
          <div className="w-[100px]">
            <label className="t-caption block mb-1">Jours</label>
            <input
              type="number"
              value={newDays}
              onChange={(e) => setNewDays(e.target.value)}
              min={30}
              max={1825}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--bg-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-ring)]"
            />
          </div>
          <div className="w-[140px]">
            <label className="t-caption block mb-1">Action</label>
            <select
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--bg-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-ring)]"
            >
              <option value="anonymize">Anonymiser</option>
              <option value="delete">Supprimer</option>
            </select>
          </div>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={isCreating || !newClientId.trim()}
            isLoading={isCreating}
          >
            Ajouter
          </Button>
        </div>

        {/* Liste des règles */}
        {isLoading ? (
          <div className="text-center text-sm text-[var(--text-muted)] py-6">Chargement…</div>
        ) : rules.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={<Clock size={28} />}
            title="Aucune règle de purge"
            description="Ajoutez une règle pour définir la politique de rétention des données."
          />
        ) : (
          <div className="space-y-2">
            {rules.map((rule, idx) => (
              <div
                key={rule.id}
                className="row-premium list-item-enter flex items-center gap-3 p-3 rounded-xl"
                style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {rule.client_id}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {rule.inactive_days} jours d'inactivité
                  </p>
                </div>
                <Tag variant={rule.action === 'delete' ? 'danger' : 'warning'} dot>
                  {rule.action === 'anonymize' ? 'Anonymiser' : 'Supprimer'}
                </Tag>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(rule.id)}
                  aria-label="Supprimer la règle"
                  className="text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                >
                  <Icon as={Trash2} size="sm" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border)]">
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePreview}
            leftIcon={<Icon as={Eye} size="sm" />}
          >
            Prévisualiser
          </Button>
          {previewCount !== null && (
            <span className="text-sm text-[var(--text-secondary)]">
              {previewCount} lead(s) éligible(s)
            </span>
          )}
          <div className="flex-1" />
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowConfirm(true)}
            disabled={isRunning || rules.length === 0}
            isLoading={isRunning}
            leftIcon={<Icon as={AlertTriangle} size="sm" />}
          >
            Exécuter la purge
          </Button>
        </div>

        {/* Modale de confirmation */}
        {showConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setShowConfirm(false)}
          >
            <div
              className="bg-[var(--bg-surface)] rounded-xl shadow-lg p-6 max-w-md mx-4 animate-fade-in"
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="t-h3 text-[var(--danger)] flex items-center gap-2 mb-3">
                <AlertTriangle size={20} />
                Confirmer la purge
              </h4>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Cette action va anonymiser ou supprimer définitivement les leads inactifs
                selon les règles configurées. Cette opération est <strong>irréversible</strong>.
              </p>
              <div className="flex items-center gap-3 justify-end">
                <Button variant="secondary" size="sm" onClick={() => setShowConfirm(false)}>
                  Annuler
                </Button>
                <Button variant="danger" size="sm" onClick={handleRun}>
                  Confirmer la purge
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
