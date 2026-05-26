// ── DataPrivacyPanel — Sprint 23 Sécurité / conformité ──────────────────────
// 3 cartes Loi 25 + RGPD :
//   1. Export de mes données (JSON download, rate-limit gracieux)
//   2. Suppression de compte (modal confirm_email + reason + statut + cancel)
//   3. Contact DPO (mailto)
// Best-effort : si une API échoue, on affiche un message i18n. Pas de toast
// agressif — l'utilisateur voit le statut localement dans la carte.

import { useEffect, useState } from 'react';
import {
  getMyDataExport,
  getMyDeletionRequest,
  requestAccountDeletion,
  cancelAccountDeletion,
} from '@/lib/api';
import type { AccountDeletionRequest } from '@/lib/types';
import { Card, Button, Input, Modal, Textarea } from '@/components/ui';
import { t } from '@/lib/i18n';
import { Download, Trash2, Mail } from 'lucide-react';

export function DataPrivacyPanel() {
  const [pending, setPending] = useState<AccountDeletionRequest | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [reason, setReason] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyDeletionRequest()
      .then((res) => {
        if (cancelled) return;
        if (res.data && res.data.status === 'pending') {
          setPending(res.data);
        } else {
          setPending(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPendingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleExport() {
    setExportLoading(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const res = await getMyDataExport();
      if (res.error || !res.data) {
        const msg = (res.error || '').toLowerCase();
        if (msg.includes('rate') || msg.includes('429') || msg.includes('limit')) {
          setExportError(t('privacy.export.rate_limited'));
        } else {
          setExportError(t('privacy.export.error'));
        }
        return;
      }
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `intralys-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportSuccess(t('privacy.export.success'));
    } catch {
      setExportError(t('privacy.export.error'));
    } finally {
      setExportLoading(false);
    }
  }

  async function handleRequestDelete() {
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      const res = await requestAccountDeletion(reason || undefined, confirmEmail);
      if (res.error || !res.data) {
        const msg = (res.error || '').toLowerCase();
        if (msg.includes('pending') || msg.includes('already')) {
          setDeleteError(t('privacy.delete.already_pending'));
        } else {
          setDeleteError(res.error || t('privacy.export.error'));
        }
        return;
      }
      setPending(res.data);
      setDeleteOpen(false);
      setConfirmEmail('');
      setReason('');
    } catch {
      setDeleteError(t('privacy.export.error'));
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function handleCancelDelete() {
    const res = await cancelAccountDeletion();
    if (!res.error) {
      setPending(null);
    }
  }

  function openDeleteModal() {
    setConfirmEmail('');
    setReason('');
    setDeleteError(null);
    setDeleteOpen(true);
  }

  return (
    <div className="space-y-5">
      {/* Header section */}
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          {t('privacy.title')}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {t('privacy.subtitle')}
        </p>
      </div>

      {/* Carte 1 — Export */}
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-subtle)] text-[var(--primary)]">
            <Download size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              {t('privacy.export.title')}
            </h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {t('privacy.export.help')}
            </p>
            <div className="mt-4">
              <Button
                data-testid="data-privacy-export-btn"
                onClick={() => void handleExport()}
                disabled={exportLoading}
                isLoading={exportLoading}
                leftIcon={<Download size={14} />}
              >
                {t('privacy.export.cta')}
              </Button>
            </div>
            {exportError && (
              <p
                role="alert"
                className="mt-3 text-sm text-[var(--danger)]"
              >
                {exportError}
              </p>
            )}
            {exportSuccess && (
              <p className="mt-3 text-sm text-[var(--success,#059669)]">
                {exportSuccess}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Carte 2 — Suppression */}
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--danger)]/10 text-[var(--danger)]">
            <Trash2 size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              {t('privacy.delete.title')}
            </h3>
            {pendingLoading ? (
              <p className="mt-1 text-sm text-[var(--text-muted)]">…</p>
            ) : pending ? (
              <div className="mt-2">
                <p className="text-sm text-[var(--text-secondary)]">
                  <strong>{t('privacy.delete.scheduled_for')} : </strong>
                  {new Date(pending.scheduled_for).toLocaleDateString()}
                </p>
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    onClick={() => void handleCancelDelete()}
                  >
                    {t('privacy.delete.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-sm text-[var(--text-secondary)]">
                  {t('privacy.delete.warning')}
                </p>
                <div className="mt-3">
                  <Button
                    variant="danger"
                    onClick={openDeleteModal}
                    leftIcon={<Trash2 size={14} />}
                  >
                    {t('privacy.delete.cta')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Carte 3 — DPO */}
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
            <Mail size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              DPO / Délégué à la protection des données
            </h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Pour toute question relative à tes données personnelles, contacte
              notre DPO.
            </p>
            <a
              href="mailto:dpo@intralys.com"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary)] hover:underline"
            >
              <Mail size={14} />
              dpo@intralys.com
            </a>
          </div>
        </div>
      </Card>

      {/* Modal confirmation suppression */}
      <Modal
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!deleteSubmitting) setDeleteOpen(o);
        }}
        title={t('privacy.delete.title')}
        description={t('privacy.delete.warning')}
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3 text-sm text-[var(--text-primary)]">
            {t('privacy.delete.warning')}
          </div>

          <Input
            label={t('privacy.delete.confirm_email')}
            type="email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="off"
          />

          <Textarea
            label={t('privacy.delete.reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />

          {deleteError && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {deleteError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteSubmitting}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleRequestDelete()}
              disabled={deleteSubmitting || !confirmEmail.trim()}
              isLoading={deleteSubmitting}
            >
              {t('privacy.delete.cta')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
