// ── MigrationImportSettings — LOT RÉEL Manager C (§6.C.1) ────
// Wizard d'import de leads depuis un export CSV GoHighLevel.
// Réutilise la primitive <Wizard> existante (embedded, NE PAS recréer).
// Endpoints FIGÉS via src/lib/migrationApi.ts (NE PAS toucher api.ts ni le
// backend migration-ghl-csv.ts). Admin-only — sélection client obligatoire.
//
// 4 steps : upload → mapping → preview → confirm.
//   upload  : choisir fichier CSV + client (isValid = les 2 présents)
//   mapping : éditer le field_mapping auto-détecté (sur preview initial)
//   preview : stats rows_valid/skipped + conflits (appel ghlCsvPreview)
//   confirm : lance l'import réel (appel ghlCsvRun) + résultat session

import { useState, useEffect, useMemo, useCallback } from 'react';
import { t } from '@/lib/i18n';
import { Wizard, type WizardStep } from '@/components/ui/Wizard';
import { EmptyState, SmartBanner, Button, Skeleton } from '@/components/ui';
import { getClients } from '@/lib/api';
import type { Client } from '@/lib/types';
import {
  ghlCsvPreview,
  ghlCsvRun,
  type GhlCsvPreviewResult,
  type GhlCsvRunResult,
} from '@/lib/migrationApi';
import { UploadCloud, FileText, Loader2, CheckCircle2 } from 'lucide-react';

const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 Mo (cohérent hint i18n)

export function MigrationImportSettings() {
  const [stepIndex, setStepIndex] = useState(0);

  // Step 1 — upload
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientId, setClientId] = useState('');
  const [csvData, setCsvData] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  // Step 2 — mapping (éditable, dérivé du preview initial)
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Step 3 — preview
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GhlCsvPreviewResult | null>(null);

  // Step 4 — confirm / run
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<GhlCsvRunResult | null>(null);

  // ── Charger la liste des clients (sélecteur obligatoire) ──
  useEffect(() => {
    let cancelled = false;
    getClients().then((res) => {
      if (cancelled) return;
      if (res.data) setClients(res.data);
      setClientsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Lecture fichier CSV ──
  const handleFile = (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      setFileError(t('migration_import.upload.hint'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsvData(String(reader.result || ''));
      setFileName(file.name);
    };
    reader.onerror = () => setFileError(t('migration_import.run.error'));
    reader.readAsText(file);
  };

  // ── Appel preview (entrée step 3) ──
  const loadPreview = useCallback(
    async (withMapping?: Record<string, string>) => {
      if (!clientId || !csvData) return;
      setPreviewLoading(true);
      setPreviewError(null);
      const res = await ghlCsvPreview(
        clientId,
        csvData,
        withMapping && Object.keys(withMapping).length > 0 ? withMapping : undefined,
      );
      if (res.data) {
        setPreview(res.data);
        // Sur le 1er preview (mapping vide) on adopte le mapping auto-détecté.
        setMapping((prev) =>
          Object.keys(prev).length === 0 ? res.data!.mapping_used : prev,
        );
        setPreviewError(null);
      } else {
        setPreviewError(res.error || t('migration_import.run.error'));
        setPreview(null);
      }
      setPreviewLoading(false);
    },
    [clientId, csvData],
  );

  // ── Appel run (entrée step 4) ──
  const runImport = useCallback(async () => {
    if (!clientId || !csvData || Object.keys(mapping).length === 0) return;
    setRunLoading(true);
    setRunError(null);
    const res = await ghlCsvRun(clientId, csvData, mapping);
    if (res.data) {
      setRunResult(res.data);
      setRunError(null);
    } else {
      setRunError(res.error || t('migration_import.run.error'));
      setRunResult(null);
    }
    setRunLoading(false);
  }, [clientId, csvData, mapping]);

  // ── Transitions de step : déclenche les appels API au bon moment ──
  const handleStepChange = (next: number) => {
    // Entrée step preview (index 2) → (re)charger l'aperçu avec le mapping courant
    if (next === 2) {
      void loadPreview(mapping);
    }
    // Entrée step confirm (index 3) → lancer l'import réel
    if (next === 3 && !runResult) {
      void runImport();
    }
    setStepIndex(next);
  };

  const updateMapping = (header: string, value: string) => {
    setMapping((prev) => ({ ...prev, [header]: value }));
  };

  // ── Steps ──
  const steps: WizardStep[] = useMemo(
    () => [
      // 1 — Upload
      {
        id: 'upload',
        label: t('migration_import.step.upload'),
        isValid: () => Boolean(clientId) && Boolean(csvData),
        content: (
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold mb-1.5 text-[var(--text-primary)]">
                {t('migration_import.client_required')}
              </label>
              {clientsLoading ? (
                <Skeleton className="h-9 w-full rounded-md" />
              ) : (
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <option value="">—</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label
                htmlFor="ghl-csv-file"
                className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed border-[var(--border-strong)] cursor-pointer hover:border-[var(--primary)] transition-colors text-center"
              >
                <UploadCloud size={28} className="text-[var(--primary)]" />
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {fileName || t('migration_import.upload.cta')}
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {t('migration_import.upload.hint')}
                </span>
                <input
                  id="ghl-csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </label>
              {fileError && (
                <p className="text-[12px] text-[var(--danger)] mt-2">{fileError}</p>
              )}
            </div>
          </div>
        ),
      },

      // 2 — Mapping
      {
        id: 'mapping',
        label: t('migration_import.step.mapping'),
        content:
          Object.keys(mapping).length === 0 ? (
            <SmartBanner
              variant="tip"
              title={t('migration_import.empty_title')}
              description={t('migration_import.upload.hint')}
            />
          ) : (
            <div className="space-y-2">
              {Object.entries(mapping).map(([header, target]) => (
                <div
                  key={header}
                  className="flex items-center gap-3 p-2.5 rounded-md bg-[var(--bg-subtle)]"
                >
                  <span className="flex-1 text-[13px] font-medium text-[var(--text-primary)] truncate">
                    {header}
                  </span>
                  <span className="text-[var(--text-muted)]">→</span>
                  <input
                    value={target}
                    onChange={(e) => updateMapping(header, e.target.value)}
                    className="flex-1 h-8 px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </div>
              ))}
            </div>
          ),
      },

      // 3 — Preview
      {
        id: 'preview',
        label: t('migration_import.step.preview'),
        content: previewLoading ? (
          <div className="flex flex-col items-center gap-3 py-8 text-[var(--text-muted)]">
            <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
            <span className="text-[13px]">{t('migration_import.step.preview')}…</span>
          </div>
        ) : previewError ? (
          <EmptyState
            icon={<FileText size={32} />}
            title={t('migration_import.error_title')}
            description={previewError}
            action={
              <Button variant="secondary" size="sm" onClick={() => void loadPreview(mapping)}>
                {t('migration_import.next')}
              </Button>
            }
          />
        ) : preview ? (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[var(--bg-subtle)] text-[14px] font-semibold text-[var(--text-primary)]">
              {t('migration_import.preview.rows', {
                valid: preview.rows_valid,
                skipped: preview.rows_skipped,
                total: preview.rows_total,
              })}
            </div>
            {(preview.conflicts.duplicate_emails_in_csv.length > 0 ||
              preview.conflicts.existing_contacts.length > 0) && (
              <SmartBanner
                variant="warning"
                title={t('migration_import.preview.conflicts', {
                  count:
                    preview.conflicts.duplicate_emails_in_csv.length +
                    preview.conflicts.existing_contacts.length,
                })}
              />
            )}
            {preview.sample_first_10.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
                <table className="w-full text-[12px]">
                  <thead className="bg-[var(--bg-subtle)]">
                    <tr>
                      {Object.keys(preview.sample_first_10[0] || {}).map((k) => (
                        <th
                          key={k}
                          className="px-3 py-2 text-left font-semibold text-[var(--text-secondary)] whitespace-nowrap"
                        >
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_first_10.map((row, i) => (
                      <tr key={i} className="border-t border-[var(--border-subtle)]">
                        {Object.keys(preview.sample_first_10[0] || {}).map((k) => (
                          <td key={k} className="px-3 py-1.5 text-[var(--text-primary)] whitespace-nowrap">
                            {row[k] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<FileText size={32} />}
            title={t('migration_import.empty_title')}
          />
        ),
      },

      // 4 — Confirm
      {
        id: 'confirm',
        label: t('migration_import.step.confirm'),
        content: runLoading ? (
          <div className="flex flex-col items-center gap-3 py-8 text-[var(--text-muted)]">
            <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
            <span className="text-[13px]">{t('migration_import.step.confirm')}…</span>
          </div>
        ) : runError ? (
          <EmptyState
            icon={<FileText size={32} />}
            title={t('migration_import.error_title')}
            description={runError}
            action={
              <Button variant="secondary" size="sm" onClick={() => void runImport()}>
                {t('migration_import.next')}
              </Button>
            }
          />
        ) : runResult ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 size={36} className="text-[var(--success)]" />
            <p className="text-[15px] font-semibold text-[var(--text-primary)]">
              {t('migration_import.run.success', {
                imported: runResult.imported,
                skipped: runResult.skipped,
              })}
            </p>
            {runResult.errors > 0 && runResult.log.length > 0 && (
              <details className="w-full mt-2 text-left">
                <summary className="text-[12px] text-[var(--text-muted)] cursor-pointer">
                  {runResult.errors}
                </summary>
                <ul className="mt-2 space-y-1 text-[11px] text-[var(--text-muted)] max-h-40 overflow-y-auto">
                  {runResult.log.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<FileText size={32} />}
            title={t('migration_import.empty_title')}
          />
        ),
      },
    ],
    [
      clientId,
      csvData,
      clients,
      clientsLoading,
      fileName,
      fileError,
      mapping,
      previewLoading,
      previewError,
      preview,
      runLoading,
      runError,
      runResult,
      loadPreview,
      runImport,
    ],
  );

  return (
    <Wizard
      embedded
      open
      onOpenChange={() => {}}
      title={t('migration_import.tab_label')}
      description={t('migration_import.tab_desc')}
      steps={steps}
      currentIndex={stepIndex}
      onStepChange={handleStepChange}
      onComplete={() => {
        // Le run est déclenché à l'entrée du step confirm ; "Terminer" réinitialise
        // pour permettre un nouvel import.
        setStepIndex(0);
        setCsvData('');
        setFileName('');
        setMapping({});
        setPreview(null);
        setRunResult(null);
        setPreviewError(null);
        setRunError(null);
      }}
      completeLabel={t('migration_import.finish')}
    />
  );
}
