// ── SnapshotImportWizard — Sprint 35 (Agent B2) ─────────────────────────────
// Wizard 3 steps state machine pour importer un snapshot GHL-style sur un
// tenant de destination. Pattern :
//   1. Upload — drag-drop / file picker, parse JSON, validation locale.
//   2. Preview — dry_run API → SnapshotPreview (composant B3).
//   3. Commit — commit API → toast success → onClose.
//
// API back FIGÉE (Phase A) :
//   importSnapshot({ bundle?, target_client_id, mode: 'dry_run' | 'commit' })
//     → ApiResponse<SnapshotImportResult>
//
// Style : Stripe-clean. Aucun gradient/glass. Toutes les chaînes via t().
// Aucun console.log (CLAUDE.md).

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload, Loader2, AlertCircle, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import { importSnapshot, type SnapshotImportResult } from '../../lib/api';
import { SnapshotPreview } from './SnapshotPreview';

// ── Types locaux ────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3;

interface SnapshotImportWizardProps {
  open: boolean;
  onClose: () => void;
  targetClientId: string;
}

// Détecte si une erreur back est une signature mismatch. La forme exacte
// du payload n'étant pas figée côté worker, on regarde :
//   - le message string contient "signature" ou "tamper"
// (Le back peut aussi renvoyer un objet meta avec expected/received hashes :
// on l'extrait via une regex best-effort pour affichage.)
interface SignatureMismatchMeta {
  expected?: string;
  received?: string;
}

function parseSignatureMismatch(errMsg: string): SignatureMismatchMeta | null {
  const lower = errMsg.toLowerCase();
  if (!lower.includes('signature') && !lower.includes('tamper')) return null;
  // Best-effort : back format "... expected=<hash> received=<hash>"
  const expectedMatch = errMsg.match(/expected[=:\s]+([a-f0-9]{8,})/i);
  const receivedMatch = errMsg.match(/received[=:\s]+([a-f0-9]{8,})/i);
  return {
    expected: expectedMatch?.[1],
    received: receivedMatch?.[1],
  };
}

// ── Composant ───────────────────────────────────────────────────────────────

export function SnapshotImportWizard({
  open,
  onClose,
  targetClientId,
}: SnapshotImportWizardProps) {
  const { success, error: toastError } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<WizardStep>(1);
  const [bundle, setBundle] = useState<unknown>(null);
  const [fileName, setFileName] = useState<string>('');
  const [previewResult, setPreviewResult] = useState<SnapshotImportResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [committing, setCommitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [signatureMeta, setSignatureMeta] = useState<SignatureMismatchMeta | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // ── Reset complet (au close) ─────────────────────────────────────────────
  const resetState = useCallback(() => {
    setStep(1);
    setBundle(null);
    setFileName('');
    setPreviewResult(null);
    setLoading(false);
    setCommitting(false);
    setError(null);
    setSignatureMeta(null);
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // ── Parse fichier (commun file picker + drag drop) ───────────────────────
  const handleFile = useCallback((file: File) => {
    setError(null);
    setSignatureMeta(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onerror = () => {
      setError(t('snapshots.error.invalid_schema'));
      setBundle(null);
    };
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const parsed = JSON.parse(text);
        setBundle(parsed);
        setError(null);
      } catch {
        setError(t('snapshots.error.invalid_schema'));
        setBundle(null);
      }
    };
    reader.readAsText(file);
  }, []);

  const onFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // ── Step 1 → 2 : dry_run preview ─────────────────────────────────────────
  const onNextToPreview = useCallback(async () => {
    if (!bundle) return;
    setLoading(true);
    setError(null);
    setSignatureMeta(null);

    const res = await importSnapshot({
      bundle,
      target_client_id: targetClientId,
      mode: 'dry_run',
    });

    setLoading(false);

    if (res.error) {
      const sigMeta = parseSignatureMismatch(res.error);
      if (sigMeta) {
        setSignatureMeta(sigMeta);
        setError(t('snapshots.error.signature_mismatch'));
      } else {
        setError(res.error);
      }
      return;
    }

    setPreviewResult(res.data ?? null);
    setStep(2);
  }, [bundle, targetClientId]);

  // ── Step 2 → 3 : commit ──────────────────────────────────────────────────
  const onConfirmCommit = useCallback(async () => {
    if (!bundle) return;
    setStep(3);
    setCommitting(true);
    setError(null);

    const res = await importSnapshot({
      bundle,
      target_client_id: targetClientId,
      mode: 'commit',
    });

    setCommitting(false);

    if (res.error) {
      setError(res.error);
      toastError(res.error);
      return;
    }

    success(t('snapshots.toast.imported'));
    handleClose();
  }, [bundle, targetClientId, success, toastError, handleClose]);

  const onRetryCommit = useCallback(() => {
    setError(null);
    void onConfirmCommit();
  }, [onConfirmCommit]);

  const onBackToUpload = useCallback(() => {
    setStep(1);
    setError(null);
    setPreviewResult(null);
  }, []);

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderStepper = () => {
    const steps: Array<{ index: WizardStep; label: string }> = [
      { index: 1, label: t('snapshots.import.step_upload') },
      { index: 2, label: t('snapshots.import.step_preview') },
      { index: 3, label: t('snapshots.import.step_commit') },
    ];
    return (
      <ol
        className="flex items-center gap-2 mb-6"
        aria-label={t('snapshots.import.wizard_title')}
      >
        {steps.map((s, i) => {
          const active = step === s.index;
          const done = step > s.index;
          return (
            <li key={s.index} className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-semibold"
                style={{
                  background: done
                    ? 'var(--success-bg, #ecfdf5)'
                    : active
                      ? 'var(--primary)'
                      : 'var(--bg-muted)',
                  color: done
                    ? 'var(--success-fg, #047857)'
                    : active
                      ? '#FFFFFF'
                      : 'var(--text-muted)',
                  border:
                    !done && !active
                      ? '1px solid var(--border)'
                      : 'none',
                }}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <Icon as={CheckCircle2} size={14} /> : s.index}
              </span>
              <span
                className="text-[13px]"
                style={{
                  color: active
                    ? 'var(--text-primary)'
                    : 'var(--text-muted)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <span
                  className="mx-1 h-px w-6"
                  style={{ background: 'var(--border)' }}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    );
  };

  const renderStepUpload = () => (
    <div className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={0}
        aria-label={t('snapshots.import.step_upload')}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] cursor-pointer transition-colors"
        style={{
          border: `2px dashed ${
            isDragging ? 'var(--primary)' : 'var(--border)'
          }`,
          background: isDragging ? 'var(--primary-soft, #f5f3ff)' : 'var(--bg-muted)',
          padding: '32px 24px',
          minHeight: 160,
          outline: 'none',
        }}
      >
        <Icon as={Upload} size={28} className="text-[var(--text-muted)]" />
        <p
          className="text-[14px] text-center"
          style={{ color: 'var(--text-primary)' }}
        >
          {fileName
            ? fileName
            : t('snapshots.import.target_client_label')}
        </p>
        <p
          className="text-[12px] text-center"
          style={{ color: 'var(--text-muted)' }}
        >
          .json / .intralys.json
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.intralys.json,application/json"
          onChange={onFileChange}
          className="hidden"
          aria-label={t('snapshots.import.step_upload')}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-md)] p-3"
          style={{
            background: 'var(--danger-bg, #fef2f2)',
            border: '1px solid var(--danger-border, #fecaca)',
            color: 'var(--danger-fg, #b91c1c)',
          }}
        >
          <Icon as={AlertCircle} size={16} className="mt-px shrink-0" />
          <div className="flex flex-col gap-1 text-[13px]">
            <span>{error}</span>
            {signatureMeta && (signatureMeta.expected || signatureMeta.received) && (
              <span className="font-mono text-[11px] opacity-80">
                {signatureMeta.expected && (
                  <>expected: {signatureMeta.expected}<br /></>
                )}
                {signatureMeta.received && <>received: {signatureMeta.received}</>}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-2">
        <Button variant="ghost" onClick={handleClose}>
          {t('action.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={() => { void onNextToPreview(); }}
          disabled={!bundle || loading}
          isLoading={loading}
          rightIcon={<Icon as={ArrowRight} size={14} />}
        >
          {t('snapshots.import.dry_run_button')}
        </Button>
      </div>
    </div>
  );

  const renderStepPreview = () => (
    <div className="flex flex-col gap-4">
      {previewResult && (
        <SnapshotPreview
          summary={previewResult.summary}
          log={previewResult.log}
        />
      )}

      <div className="flex justify-between gap-2 mt-2">
        <Button
          variant="ghost"
          onClick={onBackToUpload}
          leftIcon={<Icon as={ArrowLeft} size={14} />}
        >
          {t('action.back')}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handleClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => { void onConfirmCommit(); }}
          >
            {t('snapshots.import.commit_button')}
          </Button>
        </div>
      </div>
    </div>
  );

  const renderStepCommit = () => (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      {committing && (
        <>
          <Icon
            as={Loader2}
            size={28}
            className="animate-spin text-[var(--primary)]"
          />
          <p
            className="text-[14px]"
            style={{ color: 'var(--text-primary)' }}
            aria-live="polite"
          >
            {t('snapshots.import.commit_button')}…
          </p>
        </>
      )}

      {!committing && error && (
        <>
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-md)] p-3 w-full"
            style={{
              background: 'var(--danger-bg, #fef2f2)',
              border: '1px solid var(--danger-border, #fecaca)',
              color: 'var(--danger-fg, #b91c1c)',
            }}
          >
            <Icon as={AlertCircle} size={16} className="mt-px shrink-0" />
            <span className="text-[13px]">{error}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" onClick={onRetryCommit}>
              {t('action.retry')}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) handleClose(); }}
      title={t('snapshots.import.wizard_title')}
      size="lg"
      closeOnOverlay={!committing}
      closeLabel={t('action.cancel')}
    >
      <div className="flex flex-col">
        {renderStepper()}
        {step === 1 && renderStepUpload()}
        {step === 2 && renderStepPreview()}
        {step === 3 && renderStepCommit()}
      </div>
    </Modal>
  );
}
