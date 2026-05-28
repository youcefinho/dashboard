// ── Agency & Sub-account management (additive) ───────────────
// Surfaces the previously-invisible api.ts endpoints:
//   getAgencies / createAgency  → tenants white-label
//   getSubAccounts / createSubAccount / updateSubAccount → platform sub-accounts
// 100% additif : ce composant est rendu SOUS la master view existante de
// Agencies.tsx, sans rien modifier de son comportement. Role gating: la page
// hôte est déjà admin-only ; on garde cette garde côté hôte.

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import {
  Card,
  Button,
  EmptyState,
  Skeleton,
  Icon,
  useToast,
  useConfirm,
} from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import {
  getAgencies,
  createAgency,
  getSubAccounts,
  createSubAccount,
  updateSubAccount,
} from '@/lib/api';
import { Building2, Plus, Users, Pencil } from 'lucide-react';
import { t } from '@/lib/i18n';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function AgencyManagement() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  // ── Agencies ───────────────────────────────────────────────
  const [agencies, setAgencies] = useState<Row[]>([]);
  const [agLoading, setAgLoading] = useState(true);
  const [agError, setAgError] = useState(false);

  const fetchAgencies = useCallback(async () => {
    setAgLoading(true);
    setAgError(false);
    try {
      const res = await getAgencies();
      if (res.error || !res.data) setAgError(true);
      else setAgencies(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setAgError(true);
    } finally {
      setAgLoading(false);
    }
  }, []);

  // ── Sub-accounts ───────────────────────────────────────────
  const [subs, setSubs] = useState<Row[]>([]);
  const [subLoading, setSubLoading] = useState(true);
  const [subError, setSubError] = useState(false);

  const fetchSubs = useCallback(async () => {
    setSubLoading(true);
    setSubError(false);
    try {
      const res = await getSubAccounts();
      if (res.error || !res.data) setSubError(true);
      else setSubs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setSubError(true);
    } finally {
      setSubLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgencies();
    void fetchSubs();
  }, [fetchAgencies, fetchSubs]);

  // ── Create agency ──────────────────────────────────────────
  const [showAgModal, setShowAgModal] = useState(false);
  const [agName, setAgName] = useState('');
  const [agDomain, setAgDomain] = useState('');
  const [agNameErr, setAgNameErr] = useState(false);
  const [agSaving, setAgSaving] = useState(false);

  const submitAgency = async (e: FormEvent) => {
    e.preventDefault();
    if (agSaving) return;
    const name = agName.trim();
    if (!name) {
      setAgNameErr(true);
      return;
    }
    setAgNameErr(false);
    setAgSaving(true);
    try {
      const domain = agDomain.trim();
      const res = await createAgency({ name, ...(domain ? { custom_domain: domain } : {}) });
      if (res.error || !res.data) {
        toastError(res.error || t('agencies.mgmt.agency.create_error'));
        return;
      }
      success(t('agencies.mgmt.agency.create_success', { name }));
      setShowAgModal(false);
      setAgName('');
      setAgDomain('');
      void fetchAgencies();
    } catch (err) {
      console.error(err);
      toastError(t('agencies.mgmt.agency.create_error'));
    } finally {
      setAgSaving(false);
    }
  };

  // ── Create / edit sub-account ──────────────────────────────
  const [showSubModal, setShowSubModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [sName, setSName] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sPassword, setSPassword] = useState('');
  const [sRole, setSRole] = useState('');
  const [sNameErr, setSNameErr] = useState(false);
  const [sEmailErr, setSEmailErr] = useState(false);
  const [sSaving, setSSaving] = useState(false);

  const openCreateSub = () => {
    setEditId(null);
    setSName('');
    setSEmail('');
    setSPassword('');
    setSRole('');
    setSNameErr(false);
    setSEmailErr(false);
    setShowSubModal(true);
  };

  const openEditSub = (row: Row) => {
    setEditId(str(row.id));
    setSName(str(row.name));
    setSEmail(str(row.email));
    setSPassword('');
    setSRole(str(row.role));
    setSNameErr(false);
    setSEmailErr(false);
    setShowSubModal(true);
  };

  const submitSub = async (e: FormEvent) => {
    e.preventDefault();
    if (sSaving) return;
    const name = sName.trim();
    const email = sEmail.trim();
    const nErr = !name;
    const eErr = !editId && !email; // email requis seulement à la création
    setSNameErr(nErr);
    setSEmailErr(eErr);
    if (nErr || eErr) return;

    setSSaving(true);
    try {
      if (editId) {
        const patch: Record<string, unknown> = { name };
        if (email) patch.email = email;
        if (sRole.trim()) patch.role = sRole.trim();
        const res = await updateSubAccount(editId, patch);
        if (res.error || !res.data) {
          toastError(res.error || t('agencies.mgmt.sub.update_error'));
          return;
        }
        success(t('agencies.mgmt.sub.update_success', { name }));
      } else {
        const res = await createSubAccount({
          name,
          email,
          password: sPassword,
          ...(sRole.trim() ? { role: sRole.trim() } : {}),
        });
        if (res.error || !res.data) {
          toastError(res.error || t('agencies.mgmt.sub.create_error'));
          return;
        }
        success(t('agencies.mgmt.sub.create_success', { name }));
      }
      setShowSubModal(false);
      void fetchSubs();
    } catch (err) {
      console.error(err);
      toastError(editId ? t('agencies.mgmt.sub.update_error') : t('agencies.mgmt.sub.create_error'));
    } finally {
      setSSaving(false);
    }
  };

  const confirmCreateSub = async () => {
    // Garde-fou : la création d'un sous-compte provisionne un accès — confirmer.
    const name = sName.trim();
    if (editId || !name) return true;
    return confirm({
      title: t('agencies.mgmt.sub.confirm_title'),
      description: t('agencies.mgmt.sub.confirm_desc', { name }),
      confirmLabel: t('agencies.mgmt.sub.confirm_ok'),
    });
  };

  const onSubFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await confirmCreateSub();
    if (!ok) return;
    await submitSub(e);
  };

  return (
    <section className="mt-8 space-y-8" aria-label={t('agencies.mgmt.section')}>
      {/* ── Agencies ─────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Icon as={Building2} size="md" className="text-[var(--text-muted)]" />
            {t('agencies.mgmt.agency.title')}
          </h3>
          <Button
            variant="secondary"
            className="h-8 py-1 text-xs"
            onClick={() => {
              setAgName('');
              setAgDomain('');
              setAgNameErr(false);
              setShowAgModal(true);
            }}
            leftIcon={<Icon as={Plus} size="sm" />}
          >
            {t('agencies.mgmt.agency.create')}
          </Button>
        </div>

        {agLoading ? (
          <Card className="p-4" aria-busy="true" role="status" aria-live="polite">
            <span className="sr-only">{t('agencies.mgmt.loading')}</span>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-5 w-full rounded" />
              ))}
            </div>
          </Card>
        ) : agError ? (
          <Card className="p-6" role="alert" aria-live="polite">
            <p className="mb-3 text-sm text-[var(--danger)]">{t('agencies.mgmt.agency.load_error')}</p>
            <Button variant="primary" onClick={() => void fetchAgencies()} disabled={agLoading}>
              {t('agencies.mgmt.retry')}
            </Button>
          </Card>
        ) : agencies.length === 0 ? (
          <EmptyState
            variant="first-time"
            title={t('agencies.mgmt.agency.empty_title')}
            description={t('agencies.mgmt.agency.empty_desc')}
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--bg-surface)] text-xs uppercase text-[var(--text-muted)]">
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="px-4 py-3 font-semibold">{t('agencies.mgmt.agency.col_name')}</th>
                    <th className="px-4 py-3 font-semibold">{t('agencies.mgmt.agency.col_domain')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {agencies.map((a, idx) => (
                    <tr key={str(a.id) || idx}>
                      <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                        {str(a.name) || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        {str(a.custom_domain) || str(a.domain) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* ── Sub-accounts ─────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Icon as={Users} size="md" className="text-[var(--text-muted)]" />
            {t('agencies.mgmt.sub.title')}
          </h3>
          <Button
            variant="secondary"
            className="h-8 py-1 text-xs"
            onClick={openCreateSub}
            leftIcon={<Icon as={Plus} size="sm" />}
          >
            {t('agencies.mgmt.sub.create')}
          </Button>
        </div>

        {subLoading ? (
          <Card className="p-4" aria-busy="true" role="status" aria-live="polite">
            <span className="sr-only">{t('agencies.mgmt.loading')}</span>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-5 w-full rounded" />
              ))}
            </div>
          </Card>
        ) : subError ? (
          <Card className="p-6" role="alert" aria-live="polite">
            <p className="mb-3 text-sm text-[var(--danger)]">{t('agencies.mgmt.sub.load_error')}</p>
            <Button variant="primary" onClick={() => void fetchSubs()} disabled={subLoading}>
              {t('agencies.mgmt.retry')}
            </Button>
          </Card>
        ) : subs.length === 0 ? (
          <EmptyState
            variant="first-time"
            title={t('agencies.mgmt.sub.empty_title')}
            description={t('agencies.mgmt.sub.empty_desc')}
            action={
              <Button variant="primary" onClick={openCreateSub}>
                {t('agencies.mgmt.sub.create')}
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--bg-surface)] text-xs uppercase text-[var(--text-muted)]">
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="px-4 py-3 font-semibold">{t('agencies.mgmt.sub.col_name')}</th>
                    <th className="px-4 py-3 font-semibold">{t('agencies.mgmt.sub.col_email')}</th>
                    <th className="px-4 py-3 font-semibold">{t('agencies.mgmt.sub.col_role')}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t('agencies.mgmt.sub.col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {subs.map((s, idx) => (
                    <tr key={str(s.id) || idx}>
                      <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                        {str(s.name) || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        {str(s.email) || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        {str(s.role) || '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="secondary"
                          className="h-7 py-0.5 text-xs"
                          onClick={() => openEditSub(s)}
                          leftIcon={<Icon as={Pencil} size="sm" />}
                          aria-label={t('agencies.mgmt.sub.edit_aria', { name: str(s.name) })}
                        >
                          {t('agencies.mgmt.sub.edit')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* ── Modal: create agency ─────────────────────────────── */}
      <Modal open={showAgModal} onOpenChange={setShowAgModal} title={t('agencies.mgmt.agency.modal_title')}>
        <form onSubmit={submitAgency} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mgmt-ag-name" className="text-sm font-medium text-[var(--text-secondary)]">
              {t('agencies.mgmt.agency.field_name')}{' '}
              <span aria-hidden="true" className="text-[var(--danger)]">*</span>
            </label>
            <Input
              id="mgmt-ag-name"
              value={agName}
              maxLength={200}
              onChange={(e) => {
                setAgName(e.target.value);
                if (agNameErr) setAgNameErr(false);
              }}
              required
              aria-required="true"
              aria-invalid={agNameErr || undefined}
              aria-describedby={agNameErr ? 'mgmt-ag-name-err' : undefined}
            />
            {agNameErr && (
              <p id="mgmt-ag-name-err" role="alert" className="text-xs text-[var(--danger)]">
                {t('agencies.mgmt.agency.name_required')}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mgmt-ag-domain" className="text-sm font-medium text-[var(--text-secondary)]">
              {t('agencies.mgmt.agency.field_domain')}
            </label>
            <Input
              id="mgmt-ag-domain"
              value={agDomain}
              maxLength={253}
              onChange={(e) => setAgDomain(e.target.value)}
              placeholder="exemple.com"
            />
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t border-[var(--border-subtle)] pt-4">
            <Button variant="secondary" type="button" disabled={agSaving} onClick={() => setShowAgModal(false)}>
              {t('agencies.mgmt.cancel')}
            </Button>
            <Button type="submit" disabled={agSaving} aria-busy={agSaving}>
              {agSaving ? t('agencies.mgmt.saving') : t('agencies.mgmt.save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Modal: create / edit sub-account ─────────────────── */}
      <Modal
        open={showSubModal}
        onOpenChange={setShowSubModal}
        title={editId ? t('agencies.mgmt.sub.edit_title') : t('agencies.mgmt.sub.modal_title')}
      >
        <form onSubmit={onSubFormSubmit} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mgmt-sub-name" className="text-sm font-medium text-[var(--text-secondary)]">
              {t('agencies.mgmt.sub.field_name')}{' '}
              <span aria-hidden="true" className="text-[var(--danger)]">*</span>
            </label>
            <Input
              id="mgmt-sub-name"
              value={sName}
              maxLength={200}
              onChange={(e) => {
                setSName(e.target.value);
                if (sNameErr) setSNameErr(false);
              }}
              required
              aria-required="true"
              aria-invalid={sNameErr || undefined}
              aria-describedby={sNameErr ? 'mgmt-sub-name-err' : undefined}
            />
            {sNameErr && (
              <p id="mgmt-sub-name-err" role="alert" className="text-xs text-[var(--danger)]">
                {t('agencies.mgmt.sub.name_required')}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mgmt-sub-email" className="text-sm font-medium text-[var(--text-secondary)]">
              {t('agencies.mgmt.sub.field_email')}
              {!editId && (
                <>
                  {' '}
                  <span aria-hidden="true" className="text-[var(--danger)]">*</span>
                </>
              )}
            </label>
            <Input
              id="mgmt-sub-email"
              type="email"
              value={sEmail}
              maxLength={320}
              autoComplete="email"
              onChange={(e) => {
                setSEmail(e.target.value);
                if (sEmailErr) setSEmailErr(false);
              }}
              required={!editId}
              aria-required={!editId || undefined}
              aria-invalid={sEmailErr || undefined}
              aria-describedby={sEmailErr ? 'mgmt-sub-email-err' : undefined}
            />
            {sEmailErr && (
              <p id="mgmt-sub-email-err" role="alert" className="text-xs text-[var(--danger)]">
                {t('agencies.mgmt.sub.email_required')}
              </p>
            )}
          </div>
          {!editId && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mgmt-sub-password" className="text-sm font-medium text-[var(--text-secondary)]">
                {t('agencies.mgmt.sub.field_password')}
              </label>
              <Input
                id="mgmt-sub-password"
                type="password"
                value={sPassword}
                maxLength={128}
                onChange={(e) => setSPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mgmt-sub-role" className="text-sm font-medium text-[var(--text-secondary)]">
              {t('agencies.mgmt.sub.field_role')}
            </label>
            <Input
              id="mgmt-sub-role"
              value={sRole}
              maxLength={64}
              onChange={(e) => setSRole(e.target.value)}
              placeholder={t('agencies.mgmt.sub.role_placeholder')}
            />
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t border-[var(--border-subtle)] pt-4">
            <Button variant="secondary" type="button" disabled={sSaving} onClick={() => setShowSubModal(false)}>
              {t('agencies.mgmt.cancel')}
            </Button>
            <Button type="submit" disabled={sSaving} aria-busy={sSaving}>
              {sSaving ? t('agencies.mgmt.saving') : t('agencies.mgmt.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
