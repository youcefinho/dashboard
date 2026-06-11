// ── VoiceAgentSettings — Sprint 41 (Agent B1) ──────────────────────────────
// CRUD scripts AI voice agent + test console inline.
//
// API back FIGÉE (Phase A) :
//   listVoiceAgentScripts()                       → ApiResponse<VoiceAgentScript[]>
//   createVoiceAgentScript(input)                 → ApiResponse<VoiceAgentScript>
//   updateVoiceAgentScript(id, input)             → ApiResponse<VoiceAgentScript>
//   deleteVoiceAgentScript(id)                    → ApiResponse<{ success }>
//   testVoiceAgentScript(scriptId, sampleInput)   → ApiResponse<VoiceAgentTestResult>
//
// Layout : 3 sections
//   1. Liste scripts (table actions Edit / Test / Delete / Toggle active)
//   2. Modal CRUD (create / edit)
//   3. Test console inline (visible quand un script est sélectionné en mode test)
//
// Style : Stripe-clean (calque CurrencySettings + ChatWidgetSettings),
// flat surfaces, focus ring purple, badges color-coded. Toutes les chaînes
// passent via t(). aria-labels i18n. Aucun console.log (CLAUDE.md). Imports
// RELATIFS conformes consigne Sprint 41.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  Pencil,
  Trash2,
  PlayCircle,
  Plus,
  Bot,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import {
  listVoiceAgentScripts,
  createVoiceAgentScript,
  updateVoiceAgentScript,
  deleteVoiceAgentScript,
  testVoiceAgentScript,
  type VoiceAgentScript,
  type VoiceAgentScriptInput,
  type VoiceAgentTestResult,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 0.7;

/** Parse une chaîne CSV en array de keywords trimés / dédupliqués / non-vides. */
function parseKeywordsCsv(csv: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of csv.split(',')) {
    const k = raw.trim();
    if (k && !seen.has(k.toLowerCase())) {
      seen.add(k.toLowerCase());
      out.push(k);
    }
  }
  return out;
}

/** Format keywords[] → CSV pour input. */
function formatKeywordsCsv(keywords: string[]): string {
  return keywords.join(', ');
}

/** Classes badge pour la confidence. */
function confidenceBadgeClass(confidence: number, threshold: number): string {
  if (confidence >= threshold) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (confidence >= threshold * 0.6) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

// ── Composant ──────────────────────────────────────────────────────────────

export function VoiceAgentSettings() {
  const { success, error: toastError } = useToast();

  // ── État liste ─────────────────────────────────────────────────────────
  const [scripts, setScripts] = useState<VoiceAgentScript[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // ── État modal CRUD ────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formKeywords, setFormKeywords] = useState<string>('');
  const [formResponseTemplate, setFormResponseTemplate] = useState<string>('');
  const [formThreshold, setFormThreshold] = useState<number>(DEFAULT_THRESHOLD);
  const [formIsActive, setFormIsActive] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // ── État test console inline ──────────────────────────────────────────
  const [testScriptId, setTestScriptId] = useState<string | null>(null);
  const [testInput, setTestInput] = useState<string>('');
  const [testResult, setTestResult] = useState<VoiceAgentTestResult | null>(
    null,
  );
  const [testing, setTesting] = useState<boolean>(false);

  // ── Chargement initial ─────────────────────────────────────────────────
  const loadScripts = useCallback(async () => {
    setLoading(true);
    const res = await listVoiceAgentScripts();
    if (res.error) {
      toastError(res.error);
      setScripts([]);
    } else if (res.data) {
      setScripts(res.data);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  // ── Modal helpers ──────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setEditId(null);
    setFormName('');
    setFormKeywords('');
    setFormResponseTemplate('');
    setFormThreshold(DEFAULT_THRESHOLD);
    setFormIsActive(true);
  }, []);

  const handleOpenCreate = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const handleOpenEdit = useCallback((script: VoiceAgentScript) => {
    setEditId(script.id);
    setFormName(script.name);
    setFormKeywords(formatKeywordsCsv(script.intent_keywords));
    setFormResponseTemplate(script.response_template);
    setFormThreshold(script.escalation_threshold);
    setFormIsActive(script.is_active);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(
    (open: boolean) => {
      if (!open) {
        resetForm();
      }
      setModalOpen(open);
    },
    [resetForm],
  );

  // ── Submit CRUD ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const name = formName.trim();
      const template = formResponseTemplate.trim();
      const keywords = parseKeywordsCsv(formKeywords);
      if (!name || !template) {
        toastError(t('voice_agent.scripts.name'));
        return;
      }
      const threshold = Number.isFinite(formThreshold)
        ? Math.min(1, Math.max(0, formThreshold))
        : DEFAULT_THRESHOLD;

      const input: VoiceAgentScriptInput = {
        name,
        intent_keywords: keywords,
        response_template: template,
        escalation_threshold: threshold,
        is_active: formIsActive,
      };

      setSubmitting(true);
      const res = editId
        ? await updateVoiceAgentScript(editId, input)
        : await createVoiceAgentScript(input);
      setSubmitting(false);

      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('voice_agent.title'));
      setModalOpen(false);
      resetForm();
      await loadScripts();
    },
    [
      formName,
      formResponseTemplate,
      formKeywords,
      formThreshold,
      formIsActive,
      editId,
      loadScripts,
      resetForm,
      success,
      toastError,
    ],
  );

  // ── Delete ─────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (script: VoiceAgentScript) => {
      const res = await deleteVoiceAgentScript(script.id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('voice_agent.title'));
      if (testScriptId === script.id) {
        setTestScriptId(null);
        setTestInput('');
        setTestResult(null);
      }
      await loadScripts();
    },
    [loadScripts, success, testScriptId, toastError],
  );

  // ── Toggle active ──────────────────────────────────────────────────────
  const handleToggleActive = useCallback(
    async (script: VoiceAgentScript) => {
      const res = await updateVoiceAgentScript(script.id, {
        is_active: !script.is_active,
      });
      if (res.error) {
        toastError(res.error);
        return;
      }
      // Mise à jour locale optimiste sans re-fetch complet.
      setScripts((prev) =>
        prev.map((s) =>
          s.id === script.id ? { ...s, is_active: !s.is_active } : s,
        ),
      );
    },
    [toastError],
  );

  // ── Test console ───────────────────────────────────────────────────────
  const handleOpenTest = useCallback((script: VoiceAgentScript) => {
    setTestScriptId(script.id);
    setTestInput('');
    setTestResult(null);
  }, []);

  const handleCloseTest = useCallback(() => {
    setTestScriptId(null);
    setTestInput('');
    setTestResult(null);
  }, []);

  const handleRunTest = useCallback(async () => {
    if (!testScriptId) return;
    const input = testInput.trim();
    if (!input) {
      toastError(t('voice_agent.scripts.test_input_placeholder'));
      return;
    }
    setTesting(true);
    const res = await testVoiceAgentScript(testScriptId, input);
    setTesting(false);
    if (res.error) {
      toastError(res.error);
      return;
    }
    if (res.data) {
      setTestResult(res.data);
    }
  }, [testScriptId, testInput, toastError]);

  // ── Memo : script sélectionné pour test (pour afficher son seuil + nom) ─
  const testScript = useMemo<VoiceAgentScript | null>(() => {
    if (!testScriptId) return null;
    return scripts.find((s) => s.id === testScriptId) ?? null;
  }, [testScriptId, scripts]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8" data-testid="voice-agent-settings">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('voice_agent.title')}</h2>
          <p className="t-caption text-[var(--gray-500)] mt-1">
            {t('voice_agent.calls.title')}
          </p>
        </div>
        <Button
          onClick={handleOpenCreate}
          size="sm"
          leftIcon={<Icon as={Plus} size="sm" />}
          aria-label={t('voice_agent.scripts.create')}
          data-testid="voice-agent-btn-create"
        >
          {t('voice_agent.scripts.create')}
        </Button>
      </header>

      {/* Section 1 — Liste des scripts */}
      <section
        aria-labelledby="voice-agent-list-heading"
        data-testid="voice-agent-section-list"
      >
        <h3 id="voice-agent-list-heading" className="t-h3 mb-3">
          {t('voice_agent.title')}
        </h3>

        {loading ? (
          <div className="space-y-2" data-testid="voice-agent-list-loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : scripts.length === 0 ? (
          <div
            className="rounded-xl border border-dashed border-[var(--border-subtle)] p-8 text-center text-sm text-[var(--text-muted)]"
            data-testid="voice-agent-list-empty"
          >
            <Icon as={Bot} size={32} className="mx-auto mb-2 opacity-50" />
            <p>{t('voice_agent.scripts.empty')}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
            <table
              className="w-full text-sm"
              aria-label={t('voice_agent.title')}
              data-testid="voice-agent-table"
            >
              <thead className="bg-[var(--gray-50)] text-[var(--text-muted)] text-xs uppercase tracking-wide">
                <tr>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    {t('voice_agent.scripts.name')}
                  </th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    {t('voice_agent.scripts.intent_keywords')}
                  </th>
                  <th scope="col" className="text-right px-4 py-2 font-medium">
                    {t('voice_agent.scripts.escalation_threshold')}
                  </th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    {/* Active toggle */}
                    <span aria-hidden="true">●</span>
                  </th>
                  <th scope="col" className="text-right px-4 py-2 font-medium">
                    {/* Actions */}
                    <span className="sr-only">{t('voice_agent.title')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scripts.map((script) => (
                  <tr
                    key={script.id}
                    data-testid={`voice-agent-row-${script.id}`}
                    className="border-t border-[var(--border-subtle)]"
                  >
                    <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                      {script.name}
                    </td>
                    <td className="px-4 py-2 text-[var(--text-secondary)]">
                      <div
                        className="flex flex-wrap gap-1 max-w-md"
                        data-testid={`voice-agent-keywords-${script.id}`}
                      >
                        {script.intent_keywords.length === 0 ? (
                          <span className="text-[var(--text-muted)]">—</span>
                        ) : (
                          script.intent_keywords.slice(0, 4).map((kw) => (
                            <span
                              key={kw}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--gray-100)] text-[var(--gray-700)] border border-[var(--border-subtle)]"
                            >
                              {kw}
                            </span>
                          ))
                        )}
                        {script.intent_keywords.length > 4 ? (
                          <span className="text-xs text-[var(--text-muted)]">
                            +{script.intent_keywords.length - 4}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[var(--text-primary)]">
                      {script.escalation_threshold.toFixed(2)}
                    </td>
                    <td className="px-4 py-2">
                      <Switch
                        checked={script.is_active}
                        onCheckedChange={() => void handleToggleActive(script)}
                        size="sm"
                        aria-label={`${script.name} — ${t('voice_agent.title')}`}
                        data-testid={`voice-agent-toggle-${script.id}`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenTest(script)}
                          leftIcon={<Icon as={PlayCircle} size="sm" />}
                          aria-label={`${t('voice_agent.scripts.test_cta')} — ${script.name}`}
                          data-testid={`voice-agent-btn-test-${script.id}`}
                        >
                          {t('voice_agent.scripts.test_cta')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenEdit(script)}
                          leftIcon={<Icon as={Pencil} size="sm" />}
                          aria-label={`${t('voice_agent.scripts.name')} — ${script.name}`}
                          data-testid={`voice-agent-btn-edit-${script.id}`}
                        >
                          {t('voice_agent.scripts.name')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDelete(script)}
                          leftIcon={<Icon as={Trash2} size="sm" />}
                          aria-label={`${t('voice_agent.scripts.name')} — ${script.name}`}
                          data-testid={`voice-agent-btn-delete-${script.id}`}
                        >
                          {/* Pas de clé i18n dédiée "delete" dans voice_agent.* :
                              on garde un libellé court basé sur l'icône. */}
                          <span aria-hidden="true">×</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 3 — Test console inline (visible si un script est sélectionné) */}
      {testScript ? (
        <section
          aria-labelledby="voice-agent-test-heading"
          data-testid="voice-agent-section-test"
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
        >
          <header className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h3 id="voice-agent-test-heading" className="t-h3">
                {t('voice_agent.scripts.test_cta')} — {testScript.name}
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {t('voice_agent.scripts.test_input_placeholder')}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCloseTest}
              aria-label={t('voice_agent.scripts.test_cta')}
              data-testid="voice-agent-test-close"
            >
              ×
            </Button>
          </header>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="voice-agent-test-input"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('voice_agent.scripts.test_input_placeholder')}
              </label>
              <Input
                id="voice-agent-test-input"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder={t('voice_agent.scripts.test_input_placeholder')}
                aria-label={t('voice_agent.scripts.test_input_placeholder')}
                data-testid="voice-agent-test-input"
              />
            </div>
            <Button
              type="button"
              onClick={() => void handleRunTest()}
              isLoading={testing}
              disabled={testing || !testInput.trim()}
              leftIcon={<Icon as={PlayCircle} size="sm" />}
              aria-label={t('voice_agent.scripts.test_cta')}
              data-testid="voice-agent-test-run"
            >
              {t('voice_agent.scripts.test_cta')}
            </Button>
          </div>

          {testResult ? (
            <div
              className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--gray-50)] p-4 space-y-3"
              data-testid="voice-agent-test-result"
            >
              <header className="flex items-center justify-between gap-3 flex-wrap">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                  {t('voice_agent.scripts.test_result')}
                </h4>
                <div className="flex items-center gap-2">
                  <span
                    data-testid="voice-agent-test-confidence"
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${confidenceBadgeClass(
                      testResult.confidence,
                      testScript.escalation_threshold,
                    )}`}
                  >
                    {t('voice_agent.calls.confidence_label')}{' '}
                    {(testResult.confidence * 100).toFixed(0)}%
                  </span>
                  <span
                    data-testid="voice-agent-test-escalate"
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                      testResult.would_escalate
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}
                  >
                    <Icon
                      as={testResult.would_escalate ? AlertTriangle : CheckCircle2}
                      size={12}
                    />
                    {testResult.would_escalate
                      ? t('voice_agent.calls.escalated_badge')
                      : t('voice_agent.calls.confidence_label')}
                  </span>
                </div>
              </header>
              {testResult.intent ? (
                <p className="text-xs text-[var(--text-muted)]">
                  <span className="font-mono">{testResult.intent}</span>
                </p>
              ) : null}
              <div
                className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] whitespace-pre-wrap"
                data-testid="voice-agent-test-response"
              >
                {testResult.response_preview ?? (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </div>
              {testResult.would_escalate && testResult.escalation_reason ? (
                <p className="text-xs text-rose-700">
                  {testResult.escalation_reason === 'low_confidence'
                    ? t('voice_agent.errors.script_inactive')
                    : t('voice_agent.errors.no_match')}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Section 2 — Modal CRUD */}
      <Modal
        open={modalOpen}
        onOpenChange={handleCloseModal}
        size="lg"
        title={
          editId
            ? `${t('voice_agent.scripts.name')} — ${formName || ''}`
            : t('voice_agent.scripts.create')
        }
        description={t('voice_agent.scripts.empty')}
      >
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-5"
          aria-label={t('voice_agent.scripts.create')}
          data-testid="voice-agent-form"
        >
          {/* Name */}
          <div>
            <label
              htmlFor="voice-agent-form-name"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('voice_agent.scripts.name')}
            </label>
            <Input
              id="voice-agent-form-name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
              aria-label={t('voice_agent.scripts.name')}
              data-testid="voice-agent-form-name"
            />
          </div>

          {/* Intent keywords (CSV) */}
          <div>
            <label
              htmlFor="voice-agent-form-keywords"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('voice_agent.scripts.intent_keywords')}
            </label>
            <Textarea
              id="voice-agent-form-keywords"
              value={formKeywords}
              onChange={(e) => setFormKeywords(e.target.value)}
              rows={2}
              placeholder="hours, opening, schedule"
              aria-label={t('voice_agent.scripts.intent_keywords')}
              data-testid="voice-agent-form-keywords"
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {/* Hint format CSV (séparés par virgule). */}
              <span className="font-mono">keyword1, keyword2, …</span>
            </p>
          </div>

          {/* Response template */}
          <div>
            <label
              htmlFor="voice-agent-form-template"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('voice_agent.scripts.response_template')}
            </label>
            <Textarea
              id="voice-agent-form-template"
              value={formResponseTemplate}
              onChange={(e) => setFormResponseTemplate(e.target.value)}
              rows={4}
              required
              placeholder="Bonjour {{visitor_name}}, merci pour votre appel concernant {{intent}}."
              aria-label={t('voice_agent.scripts.response_template')}
              data-testid="voice-agent-form-template"
            />
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              <span className="font-mono">{'{{visitor_name}}'}</span> +{' '}
              <span className="font-mono">{'{{intent}}'}</span>
            </p>
          </div>

          {/* Escalation threshold + active */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="voice-agent-form-threshold"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('voice_agent.scripts.escalation_threshold')}
              </label>
              <Input
                id="voice-agent-form-threshold"
                type="number"
                step="0.05"
                min="0"
                max="1"
                inputMode="decimal"
                value={Number.isFinite(formThreshold) ? formThreshold : ''}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value);
                  setFormThreshold(Number.isFinite(v) ? v : DEFAULT_THRESHOLD);
                }}
                aria-label={t('voice_agent.scripts.escalation_threshold')}
                data-testid="voice-agent-form-threshold"
              />
            </div>
            <div className="flex items-end">
              <Switch
                checked={formIsActive}
                onCheckedChange={setFormIsActive}
                label={t('voice_agent.title')}
                description={t('voice_agent.calls.title')}
                id="voice-agent-form-active"
                data-testid="voice-agent-form-active"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleCloseModal(false)}
              disabled={submitting}
              aria-label={t('voice_agent.scripts.create')}
              data-testid="voice-agent-form-cancel"
            >
              ×
            </Button>
            <Button
              type="submit"
              isLoading={submitting}
              disabled={
                submitting ||
                !formName.trim() ||
                !formResponseTemplate.trim()
              }
              aria-label={t('voice_agent.scripts.create')}
              data-testid="voice-agent-form-submit"
            >
              {editId
                ? t('voice_agent.scripts.name')
                : t('voice_agent.scripts.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default VoiceAgentSettings;
