// ── CustomDomainsManager — Sprint 50 (Agent B2) ────────────────────────────
// Liste + CRUD des custom domains du tenant (white-label Cloudflare for SaaS).
// Drawer SlidePanel "Records" qui ouvre <DnsRecordsEditor domainId=... />.
//
// API back FIGÉE (Phase A) :
//   listCustomDomains()              → ApiResponse<CustomDomain[]>
//   addCustomDomainS50({ domain })   → ApiResponse<CustomDomain>
//   verifyDomain(id)                 → ApiResponse<CustomDomain>
//   deleteDomain(id)                 → ApiResponse<{ deleted }>
//
// Layout :
//   1. Header : titre + bouton "Ajouter un domaine"
//   2. Liste cards (grid auto-fit) : domain + status badge + ssl_status
//      + verification_token (copyable) + boutons (Records / Verify / Delete)
//   3. Modal "Add domain" : Input domain → addCustomDomainS50
//   4. SlidePanel "Records" : <DnsRecordsEditor domainId=... />
//
// Style : Stripe-clean (calque VoiceAgentSettings). Imports RELATIFS conformes
// consigne Sprint 50 (Agent B2). aria-labels via t(). Aucun console.log.

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import {
  Plus,
  Trash2,
  ShieldCheck,
  Globe2,
  Settings2,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { SlidePanel } from '../ui/SlidePanel';
import { useToast } from '../ui/Toast';
import { useConfirm } from '../ui/ConfirmDialog';
import { t } from '../../lib/i18n';
import {
  listCustomDomains,
  addCustomDomainS50,
  verifyDomain,
  deleteDomain,
  type CustomDomain,
  type CustomDomainStatus,
  type CustomDomainSslStatus,
} from '../../lib/api';
import { DnsRecordsEditor } from './DnsRecordsEditor';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Mapping status custom_domains.status → Badge intent. */
function statusBadgeIntent(status: CustomDomainStatus | null | undefined): 'neutral' | 'info' | 'success' | 'danger' {
  switch (status) {
    case 'verified':
      return 'info';
    case 'active':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending':
    default:
      return 'neutral';
  }
}

function statusLabel(status: CustomDomainStatus | null | undefined): string {
  switch (status) {
    case 'verified':
      return t('dns.status.verified');
    case 'active':
      return t('dns.status.active');
    case 'failed':
      return t('dns.status.failed');
    case 'pending':
    default:
      return t('dns.status.pending');
  }
}

function sslBadgeIntent(ssl: CustomDomainSslStatus | null | undefined): 'neutral' | 'success' | 'danger' {
  if (ssl === 'provisioned') return 'success';
  if (ssl === 'failed') return 'danger';
  return 'neutral';
}

function sslLabel(ssl: CustomDomainSslStatus | null | undefined): string {
  if (ssl === 'provisioned') return t('dns.ssl.provisioned');
  return t('dns.ssl.pending');
}

// ── Composant ─────────────────────────────────────────────────────────────

export function CustomDomainsManager() {
  const { success, error: toastError } = useToast();
  const confirm = useConfirm();

  // ── État liste ─────────────────────────────────────────────────────────
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── État modal "Add domain" ────────────────────────────────────────────
  const [addModalOpen, setAddModalOpen] = useState<boolean>(false);
  const [addDomain, setAddDomain] = useState<string>('');
  const [submittingAdd, setSubmittingAdd] = useState<boolean>(false);

  // ── État drawer "Records" ──────────────────────────────────────────────
  const [recordsDomainId, setRecordsDomainId] = useState<string | null>(null);
  const [recordsDomainLabel, setRecordsDomainLabel] = useState<string>('');

  // ── État copy verification token (feedback visuel transient) ──────────
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);

  // ── Chargement initial ─────────────────────────────────────────────────
  const loadDomains = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listCustomDomains();
    if (res.error) {
      setLoadError(res.error);
      toastError(res.error);
      setDomains([]);
    } else if (res.data) {
      setDomains(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadDomains();
  }, [loadDomains]);

  // ── Add domain ────────────────────────────────────────────────────────
  const handleOpenAdd = useCallback(() => {
    setAddDomain('');
    setAddModalOpen(true);
  }, []);

  const handleCloseAdd = useCallback((open: boolean) => {
    if (!open) setAddDomain('');
    setAddModalOpen(open);
  }, []);

  const handleSubmitAdd = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const domain = addDomain.trim().toLowerCase();
      if (!domain) {
        toastError(t('dns.add'));
        return;
      }
      setSubmittingAdd(true);
      const res = await addCustomDomainS50({ domain });
      setSubmittingAdd(false);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('dns.add'));
      setAddModalOpen(false);
      setAddDomain('');
      await loadDomains();
    },
    [addDomain, loadDomains, success, toastError],
  );

  // ── Verify ─────────────────────────────────────────────────────────────
  const handleVerify = useCallback(
    async (domain: CustomDomain) => {
      const res = await verifyDomain(domain.id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      const newStatus = res.data?.status;
      if (newStatus === 'verified' || newStatus === 'active') {
        success(statusLabel(newStatus));
      } else {
        // Lookup DNS TXT a échoué côté worker — status reste pending/failed.
        toastError(statusLabel(newStatus ?? 'failed'));
      }
      await loadDomains();
    },
    [loadDomains, success, toastError],
  );

  // ── Delete ─────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (domain: CustomDomain) => {
      const ok = await confirm({
        title: t('action.delete'),
        description: `${t('dns.delete.confirm')} ${domain.domain}`,
        confirmLabel: t('action.delete'),
        cancelLabel: t('action.cancel'),
        danger: true,
      });
      if (!ok) return;
      const res = await deleteDomain(domain.id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('dns.title'));
      // Ferme le drawer si le domain supprimé y était ouvert.
      if (recordsDomainId === domain.id) {
        setRecordsDomainId(null);
        setRecordsDomainLabel('');
      }
      await loadDomains();
    },
    [confirm, loadDomains, recordsDomainId, success, toastError],
  );

  // ── Records drawer ────────────────────────────────────────────────────
  const handleOpenRecords = useCallback((domain: CustomDomain) => {
    setRecordsDomainId(domain.id);
    setRecordsDomainLabel(domain.domain);
  }, []);

  const handleCloseRecords = useCallback((open: boolean) => {
    if (!open) {
      setRecordsDomainId(null);
      setRecordsDomainLabel('');
    }
  }, []);

  // ── Copy verification token ───────────────────────────────────────────
  const handleCopyToken = useCallback(
    async (domain: CustomDomain) => {
      const token = domain.verification_token;
      if (!token) return;
      try {
        await navigator.clipboard.writeText(token);
        setCopiedTokenId(domain.id);
        success(t('dns.verification_token.copied'));
        window.setTimeout(() => setCopiedTokenId((prev) => (prev === domain.id ? null : prev)), 1500);
      } catch {
        toastError(t('dns.verification_token.copy_failed'));
      }
    },
    [success, toastError],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6" data-testid="custom-domains-manager">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('dns.title')}</h2>
          <p className="t-caption text-[var(--gray-500)] mt-1">
            {t('dns.records.title')}
          </p>
        </div>
        <Button
          onClick={handleOpenAdd}
          size="sm"
          leftIcon={<Icon as={Plus} size="sm" />}
          aria-label={t('dns.add')}
          data-testid="custom-domains-btn-add"
        >
          {t('dns.add')}
        </Button>
      </header>

      {/* Liste cards */}
      {loading ? (
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
          data-testid="custom-domains-loading"
          role="status"
          aria-busy="true"
          aria-live="polite"
          aria-label={t('dns.title')}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--danger-soft,#fef2f2)] p-4 text-sm text-[var(--danger-text,#991b1b)]"
          role="alert"
          data-testid="custom-domains-error"
        >
          <p className="font-medium mb-1">{t('dns.loading_error')}</p>
          <p className="text-xs opacity-80">{loadError}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadDomains()}
            className="mt-2"
            aria-label={t('action.retry')}
          >
            {t('action.retry')}
          </Button>
        </div>
      ) : domains.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-[var(--border-subtle)] p-10 text-center"
          data-testid="custom-domains-empty"
        >
          <Icon as={Globe2} size={36} className="mx-auto mb-3 opacity-40 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">{t('dns.empty')}</p>
          <div className="mt-4">
            <Button
              onClick={handleOpenAdd}
              size="sm"
              variant="secondary"
              leftIcon={<Icon as={Plus} size="sm" />}
              aria-label={t('dns.add')}
            >
              {t('dns.add')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {domains.map((domain) => {
            const isCopied = copiedTokenId === domain.id;
            return (
              <article
                key={domain.id}
                data-testid={`custom-domains-card-${domain.id}`}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 flex flex-col gap-4"
              >
                {/* Domain + status row */}
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-[var(--text-primary)] truncate">
                      {domain.domain}
                    </h3>
                    <p className="t-meta mt-1">
                      {domain.created_at ? new Date(domain.created_at).toLocaleDateString('fr-CA') : '—'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Badge intent={statusBadgeIntent(domain.status)} fill="soft" size="sm" dot>
                      {statusLabel(domain.status)}
                    </Badge>
                    <Badge intent={sslBadgeIntent(domain.ssl_status)} fill="soft" size="sm">
                      <Icon as={ShieldCheck} size={12} className="mr-1" />
                      {sslLabel(domain.ssl_status)}
                    </Badge>
                  </div>
                </header>

                {/* Verification token (copyable) — visible si pending/failed */}
                {domain.verification_token && domain.status !== 'active' ? (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--gray-50)] px-3 py-2">
                    <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">
                      _intralys-verify.{domain.domain}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <code
                        className="font-mono text-xs text-[var(--text-primary)] truncate flex-1"
                        data-testid={`custom-domains-token-${domain.id}`}
                      >
                        {domain.verification_token}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleCopyToken(domain)}
                        leftIcon={<Icon as={isCopied ? Check : Copy} size="sm" />}
                        aria-label={isCopied ? t('dns.verification_token.copied') : `${t('dns.verification_token.copy')} — ${domain.domain}`}
                        data-testid={`custom-domains-btn-copy-${domain.id}`}
                      >
                        <span className="sr-only">
                          {isCopied ? t('dns.verification_token.copied') : t('dns.verification_token.copy')}
                        </span>
                      </Button>
                    </div>
                  </div>
                ) : null}

                {/* Actions */}
                <footer className="flex items-center justify-end gap-1.5 pt-1 border-t border-[var(--border-subtle)] -mx-5 -mb-5 px-5 py-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleOpenRecords(domain)}
                    leftIcon={<Icon as={Settings2} size="sm" />}
                    aria-label={`${t('dns.records.title')} — ${domain.domain}`}
                    data-testid={`custom-domains-btn-records-${domain.id}`}
                  >
                    {t('dns.records.title')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleVerify(domain)}
                    leftIcon={<Icon as={ShieldCheck} size="sm" />}
                    aria-label={`${t('dns.verify')} — ${domain.domain}`}
                    data-testid={`custom-domains-btn-verify-${domain.id}`}
                  >
                    {t('dns.verify')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleDelete(domain)}
                    leftIcon={<Icon as={Trash2} size="sm" />}
                    aria-label={`${t('action.delete')} — ${domain.domain}`}
                    data-testid={`custom-domains-btn-delete-${domain.id}`}
                  >
                    <span className="sr-only">{t('action.delete')}</span>
                  </Button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {/* Modal "Add domain" */}
      <Modal
        open={addModalOpen}
        onOpenChange={handleCloseAdd}
        size="sm"
        title={t('dns.add')}
      >
        <form
          onSubmit={(e) => void handleSubmitAdd(e)}
          className="p-5 space-y-4"
          data-testid="custom-domains-form"
        >
          <Input
            label={t('dns.add')}
            value={addDomain}
            onChange={(e) => setAddDomain(e.target.value)}
            placeholder="app.votredomaine.com"
            required
            autoFocus
            aria-label={t('dns.add')}
            data-testid="custom-domains-form-domain"
          />
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleCloseAdd(false)}
              aria-label={t('action.cancel')}
              data-testid="custom-domains-form-cancel"
            >
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              size="sm"
              isLoading={submittingAdd}
              disabled={submittingAdd || !addDomain.trim()}
              aria-label={t('dns.add')}
              data-testid="custom-domains-form-submit"
            >
              {t('dns.add')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* SlidePanel Records */}
      <SlidePanel
        open={!!recordsDomainId}
        onOpenChange={handleCloseRecords}
        title={recordsDomainLabel || t('dns.records.title')}
        description={t('dns.records.title')}
        size="lg"
        closeLabel={t('dns.records.title')}
      >
        {recordsDomainId ? <DnsRecordsEditor domainId={recordsDomainId} /> : null}
      </SlidePanel>
    </div>
  );
}

export default CustomDomainsManager;
