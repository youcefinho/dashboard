// ── CertificatesList — Sprint 43 (Agent B2) ─────────────────────────────────
// Member-facing : grille de cartes certificats émis pour un customer.
// Téléchargement → downloadCertificate(id) (worker renvoie { url }) →
// anchor click pour ouvrir/télécharger le PDF.
//
// API back FIGÉE (Phase A) :
//   getCustomerCertificates(customerId) → ApiResponse<CourseCertificate[]>
//   downloadCertificate(id)             → ApiResponse<{ url: string }>
//
// Style Stripe-clean. Imports RELATIFS. Aucun console.log. aria-labels i18n.

import { useCallback, useEffect, useState } from 'react';
import { Award, Download, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { t, getLocale } from '../../lib/i18n';
import { formatRelativeTime, formatDate } from '../../lib/i18n/datetime';
import {
  getCustomerCertificates,
  downloadCertificate,
  type CourseCertificate,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Déclenche l'ouverture du certificat (PDF) via anchor click. */
function triggerDownload(url: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

interface CertificatesListProps {
  customerId: string;
}

// ── Composant ──────────────────────────────────────────────────────────────

export function CertificatesList({ customerId }: CertificatesListProps) {
  const { error: toastError } = useToast();
  const [certificates, setCertificates] = useState<CourseCertificate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const locale = getLocale();

  // ── Chargement ──────────────────────────────────────────────────────────
  const loadCertificates = useCallback(async () => {
    if (!customerId) {
      setCertificates([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const res = await getCustomerCertificates(customerId);
    if (res.error) {
      toastError(res.error);
      setCertificates([]);
      setLoadError(res.error);
    } else if (res.data) {
      setCertificates(res.data);
    }
    setLoading(false);
  }, [customerId, toastError]);

  useEffect(() => {
    void loadCertificates();
  }, [loadCertificates]);

  // ── Download ────────────────────────────────────────────────────────────
  const handleDownload = useCallback(
    async (cert: CourseCertificate) => {
      setBusyId(cert.id);
      const res = await downloadCertificate(cert.id);
      setBusyId(null);
      if (res.error) {
        toastError(res.error);
        return;
      }
      const url = res.data?.url;
      if (!url) {
        toastError(t('lms.certificates.download'));
        return;
      }
      const filename = cert.certificate_number
        ? `certificate-${cert.certificate_number}.pdf`
        : `certificate-${cert.id}.pdf`;
      triggerDownload(url, filename);
    },
    [toastError],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="certificates-loading"
        aria-busy="true"
        aria-live="polite"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        role="alert"
        data-testid="certificates-error"
        className="p-5 rounded-xl border border-[var(--danger-soft,var(--border-subtle))] bg-[var(--danger-soft,var(--bg-subtle))] flex flex-col items-center gap-3 text-center"
      >
        <p className="text-sm font-medium text-[var(--danger,var(--text-primary))]">
          {t('common.error.title')}
        </p>
        <p className="text-xs text-[var(--text-secondary)] max-w-md break-words">
          {loadError}
        </p>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Icon as={RefreshCw} size="sm" aria-hidden="true" />}
          onClick={() => void loadCertificates()}
          aria-label={t('common.retry')}
          data-testid="certificates-retry"
        >
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (certificates.length === 0) {
    return (
      <EmptyState
        icon={<Icon as={Award} size={40} />}
        title={t('lms.certificates.empty')}
      />
    );
  }

  return (
    <ul
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0"
      data-testid="certificates-list"
      aria-label={t('lms.certificates.title')}
    >
      {certificates.map((cert) => {
        const isBusy = busyId === cert.id;
        const issuedRel = formatRelativeTime(cert.issued_at, locale);
        const issuedAbs = formatDate(cert.issued_at, locale);
        return (
          <li
            key={cert.id}
            data-testid={`certificate-card-${cert.id}`}
            className="p-5 rounded-xl border border-[var(--border-subtle)] bg-white flex flex-col gap-3 transition-shadow hover:shadow-sm"
          >
            <div className="flex items-start gap-3">
              <span
                className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] shrink-0"
                aria-hidden="true"
              >
                <Icon as={Award} size="md" />
              </span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <h3 className="font-semibold text-[var(--text-primary)] truncate">
                  {t('lms.certificates.title')}
                </h3>
                <p
                  className="text-xs text-[var(--text-muted)]"
                  title={issuedAbs}
                >
                  {t('lms.certificates.issued_at')} {issuedRel}
                </p>
              </div>
            </div>

            {cert.certificate_number ? (
              <p
                className="font-mono text-xs text-[var(--text-secondary)] bg-[var(--gray-50)] border border-[var(--border-subtle)] rounded-md px-2 py-1.5 break-all"
                data-testid={`certificate-number-${cert.id}`}
                aria-label={`${t('lms.certificates.title')} #${cert.certificate_number}`}
              >
                #{cert.certificate_number}
              </p>
            ) : null}

            <div className="mt-auto flex justify-end pt-1">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Icon as={Download} size="sm" />}
                onClick={() => void handleDownload(cert)}
                isLoading={isBusy}
                disabled={isBusy || !cert.certificate_url}
                aria-label={`${t('lms.certificates.download')} — ${cert.certificate_number ?? cert.id}`}
              >
                {t('lms.certificates.download')}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default CertificatesList;
