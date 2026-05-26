// ── ChatBotSettings — Sprint 42 (Agent B1) ─────────────────────────────────
// CRUD config bot AI Chat + Knowledge Base + console de test inline.
//
// API back FIGÉE (Phase A) :
//   getChatBotConfig()                              → ApiResponse<ChatBotConfig>
//   updateChatBotConfig(input)                      → ApiResponse<ChatBotConfig>
//   listChatKnowledge()                             → ApiResponse<ChatKnowledgeBaseEntry[]>
//   createChatKnowledge(input)                      → ApiResponse<ChatKnowledgeBaseEntry>
//   updateChatKnowledge(id, input)                  → ApiResponse<ChatKnowledgeBaseEntry>
//   deleteChatKnowledge(id)                         → ApiResponse<{ success }>
//   testChatBot({ message })                        → ApiResponse<ChatBotTestResult>
//
// Layout : 3 sections empilées
//   1. Config bot (system_prompt + threshold + escalation_message + enabled + max_messages)
//   2. Knowledge base (liste + Modal CRUD : title / content / source manual|url|faq)
//   3. Test bot inline (Input message + Run + résultat avec response + badges)
//
// Style : Stripe-clean (calque VoiceAgentSettings Sprint 41 B1), flat surfaces,
// focus ring purple, badges color-coded. Imports RELATIFS (consigne Sprint 42).
// Toutes les chaînes passent par t(). aria-labels i18n. Aucun console.log.

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
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  Save,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import {
  listChatKnowledge,
  createChatKnowledge,
  updateChatKnowledge,
  deleteChatKnowledge,
  getChatBotConfig,
  updateChatBotConfig,
  testChatBot,
  type ChatKnowledgeBaseEntry,
  type ChatKnowledgeBaseInput,
  type ChatKnowledgeSource,
  type ChatBotConfig,
  type ChatBotConfigInput,
  type ChatBotTestResult,
} from '../../lib/api';

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_MAX_MESSAGES = 20;

/** Classes badge pour la confidence selon le seuil configuré. */
function confidenceBadgeClass(confidence: number, threshold: number): string {
  if (confidence >= threshold) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (confidence >= threshold * 0.6) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

/** Libellé localisé pour la source d'une KB entry. */
function sourceLabel(source: ChatKnowledgeSource): string {
  switch (source) {
    case 'manual':
      return t('chat_bot.knowledge.source_manual');
    case 'url':
      return t('chat_bot.knowledge.source_url');
    case 'faq':
      return t('chat_bot.knowledge.source_faq');
    default:
      return source;
  }
}

// ── Composant ──────────────────────────────────────────────────────────────

export function ChatBotSettings() {
  const { success, error: toastError } = useToast();

  // ── État section 1 — Config bot ─────────────────────────────────────────
  const [config, setConfig] = useState<ChatBotConfig | null>(null);
  const [configLoading, setConfigLoading] = useState<boolean>(true);
  const [configSaving, setConfigSaving] = useState<boolean>(false);
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(
    DEFAULT_THRESHOLD,
  );
  const [escalationMessage, setEscalationMessage] = useState<string>('');
  const [enabled, setEnabled] = useState<boolean>(false);
  const [maxMessages, setMaxMessages] = useState<number>(DEFAULT_MAX_MESSAGES);

  // ── État section 2 — Knowledge base ─────────────────────────────────────
  const [kbEntries, setKbEntries] = useState<ChatKnowledgeBaseEntry[]>([]);
  const [kbLoading, setKbLoading] = useState<boolean>(true);

  // Modal CRUD KB
  const [kbModalOpen, setKbModalOpen] = useState<boolean>(false);
  const [kbEditId, setKbEditId] = useState<string | null>(null);
  const [kbFormTitle, setKbFormTitle] = useState<string>('');
  const [kbFormContent, setKbFormContent] = useState<string>('');
  const [kbFormSource, setKbFormSource] = useState<ChatKnowledgeSource>('manual');
  const [kbSubmitting, setKbSubmitting] = useState<boolean>(false);

  // ── État section 3 — Test bot ───────────────────────────────────────────
  const [testMessage, setTestMessage] = useState<string>('');
  const [testResult, setTestResult] = useState<ChatBotTestResult | null>(null);
  const [testing, setTesting] = useState<boolean>(false);

  // ── Chargement initial : config + KB en parallèle ──────────────────────
  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    const res = await getChatBotConfig();
    if (res.error) {
      toastError(res.error);
      setConfig(null);
    } else if (res.data) {
      setConfig(res.data);
      setSystemPrompt(res.data.system_prompt);
      setConfidenceThreshold(res.data.confidence_threshold);
      setEscalationMessage(res.data.escalation_message);
      setEnabled(res.data.enabled);
      setMaxMessages(res.data.max_messages_per_session);
    }
    setConfigLoading(false);
  }, [toastError]);

  const loadKb = useCallback(async () => {
    setKbLoading(true);
    const res = await listChatKnowledge();
    if (res.error) {
      toastError(res.error);
      setKbEntries([]);
    } else if (res.data) {
      setKbEntries(res.data);
    }
    setKbLoading(false);
  }, [toastError]);

  useEffect(() => {
    void loadConfig();
    void loadKb();
  }, [loadConfig, loadKb]);

  // ── Section 1 — Submit config ───────────────────────────────────────────
  const handleSubmitConfig = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const prompt = systemPrompt.trim();
      const escalation = escalationMessage.trim();
      if (!prompt) {
        toastError(t('chat_bot.config.system_prompt'));
        return;
      }
      const threshold = Number.isFinite(confidenceThreshold)
        ? Math.min(1, Math.max(0, confidenceThreshold))
        : DEFAULT_THRESHOLD;
      const max = Number.isFinite(maxMessages)
        ? Math.max(1, Math.floor(maxMessages))
        : DEFAULT_MAX_MESSAGES;

      const input: ChatBotConfigInput = {
        system_prompt: prompt,
        confidence_threshold: threshold,
        escalation_message: escalation,
        enabled,
        max_messages_per_session: max,
      };

      setConfigSaving(true);
      const res = await updateChatBotConfig(input);
      setConfigSaving(false);

      if (res.error) {
        toastError(res.error);
        return;
      }
      if (res.data) {
        setConfig(res.data);
      }
      success(t('chat_bot.config.title'));
    },
    [
      systemPrompt,
      escalationMessage,
      confidenceThreshold,
      enabled,
      maxMessages,
      success,
      toastError,
    ],
  );

  // ── Section 2 — Modal KB helpers ────────────────────────────────────────
  const resetKbForm = useCallback(() => {
    setKbEditId(null);
    setKbFormTitle('');
    setKbFormContent('');
    setKbFormSource('manual');
  }, []);

  const handleOpenKbCreate = useCallback(() => {
    resetKbForm();
    setKbModalOpen(true);
  }, [resetKbForm]);

  const handleOpenKbEdit = useCallback((entry: ChatKnowledgeBaseEntry) => {
    setKbEditId(entry.id);
    setKbFormTitle(entry.title);
    setKbFormContent(entry.content);
    setKbFormSource(entry.source);
    setKbModalOpen(true);
  }, []);

  const handleCloseKbModal = useCallback(
    (open: boolean) => {
      if (!open) {
        resetKbForm();
      }
      setKbModalOpen(open);
    },
    [resetKbForm],
  );

  const handleSubmitKb = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const title = kbFormTitle.trim();
      const content = kbFormContent.trim();
      if (!title || !content) {
        toastError(t('chat_bot.knowledge.title'));
        return;
      }
      const input: ChatKnowledgeBaseInput = {
        title,
        content,
        source: kbFormSource,
      };

      setKbSubmitting(true);
      const res = kbEditId
        ? await updateChatKnowledge(kbEditId, input)
        : await createChatKnowledge(input);
      setKbSubmitting(false);

      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('chat_bot.knowledge.title'));
      setKbModalOpen(false);
      resetKbForm();
      await loadKb();
    },
    [
      kbFormTitle,
      kbFormContent,
      kbFormSource,
      kbEditId,
      loadKb,
      resetKbForm,
      success,
      toastError,
    ],
  );

  const handleDeleteKb = useCallback(
    async (entry: ChatKnowledgeBaseEntry) => {
      const res = await deleteChatKnowledge(entry.id);
      if (res.error) {
        toastError(res.error);
        return;
      }
      success(t('chat_bot.knowledge.title'));
      await loadKb();
    },
    [loadKb, success, toastError],
  );

  // ── Section 3 — Test bot ────────────────────────────────────────────────
  const handleRunTest = useCallback(async () => {
    const message = testMessage.trim();
    if (!message) {
      toastError(t('chat_bot.test.input_placeholder'));
      return;
    }
    setTesting(true);
    const res = await testChatBot({ message });
    setTesting(false);
    if (res.error) {
      toastError(res.error);
      return;
    }
    if (res.data) {
      setTestResult(res.data);
    }
  }, [testMessage, toastError]);

  const activeKbCount = useMemo(
    () => kbEntries.filter((e) => e.is_active).length,
    [kbEntries],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-10" data-testid="chat-bot-settings">
      {/* Header global */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="t-h2">{t('chat_bot.title')}</h2>
          <p className="t-caption text-[var(--gray-500)] mt-1">
            {t('chat_bot.config.title')}
          </p>
        </div>
      </header>

      {/* ── Section 1 — Config bot ─────────────────────────────────────── */}
      <section
        aria-labelledby="chat-bot-config-heading"
        data-testid="chat-bot-section-config"
        className="rounded-xl border border-[var(--border-subtle)] bg-white p-5"
      >
        <header className="mb-4 flex items-center gap-2">
          <Icon as={MessageSquare} size="sm" className="text-[var(--text-muted)]" />
          <h3 id="chat-bot-config-heading" className="t-h3">
            {t('chat_bot.config.title')}
          </h3>
        </header>

        {configLoading ? (
          <div className="space-y-3" data-testid="chat-bot-config-loading">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
            <Skeleton className="h-9 w-1/2 rounded-md" />
            <Skeleton className="h-9 w-1/3 rounded-md" />
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSubmitConfig(e)}
            className="space-y-5"
            aria-label={t('chat_bot.config.title')}
            data-testid="chat-bot-config-form"
          >
            {/* System prompt */}
            <div>
              <label
                htmlFor="chat-bot-system-prompt"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('chat_bot.config.system_prompt')}
              </label>
              <Textarea
                id="chat-bot-system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={5}
                required
                placeholder="You are a helpful assistant for {{tenant_name}}…"
                aria-label={t('chat_bot.config.system_prompt')}
                data-testid="chat-bot-system-prompt"
              />
            </div>

            {/* Threshold + max messages */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="chat-bot-confidence-threshold"
                  className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                >
                  {t('chat_bot.config.confidence_threshold')}
                </label>
                <Input
                  id="chat-bot-confidence-threshold"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  inputMode="decimal"
                  value={
                    Number.isFinite(confidenceThreshold)
                      ? confidenceThreshold
                      : ''
                  }
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    setConfidenceThreshold(
                      Number.isFinite(v) ? v : DEFAULT_THRESHOLD,
                    );
                  }}
                  aria-label={t('chat_bot.config.confidence_threshold')}
                  data-testid="chat-bot-confidence-threshold"
                />
              </div>
              <div>
                <label
                  htmlFor="chat-bot-max-messages"
                  className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
                >
                  {t('chat_bot.config.max_messages')}
                </label>
                <Input
                  id="chat-bot-max-messages"
                  type="number"
                  step="1"
                  min="1"
                  inputMode="numeric"
                  value={Number.isFinite(maxMessages) ? maxMessages : ''}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    setMaxMessages(Number.isFinite(v) ? v : DEFAULT_MAX_MESSAGES);
                  }}
                  aria-label={t('chat_bot.config.max_messages')}
                  data-testid="chat-bot-max-messages"
                />
              </div>
            </div>

            {/* Escalation message */}
            <div>
              <label
                htmlFor="chat-bot-escalation-message"
                className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
              >
                {t('chat_bot.config.escalation_message')}
              </label>
              <Textarea
                id="chat-bot-escalation-message"
                value={escalationMessage}
                onChange={(e) => setEscalationMessage(e.target.value)}
                rows={3}
                placeholder="Je vous redirige vers un agent humain…"
                aria-label={t('chat_bot.config.escalation_message')}
                data-testid="chat-bot-escalation-message"
              />
            </div>

            {/* Enabled + Submit */}
            <div className="flex items-end justify-between gap-4 flex-wrap pt-1">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                label={t('chat_bot.config.enabled')}
                id="chat-bot-enabled"
                data-testid="chat-bot-enabled"
              />
              <Button
                type="submit"
                isLoading={configSaving}
                disabled={configSaving || !systemPrompt.trim()}
                leftIcon={<Icon as={Save} size="sm" />}
                aria-label={t('chat_bot.config.title')}
                data-testid="chat-bot-config-submit"
              >
                {t('chat_bot.config.title')}
              </Button>
            </div>

            {config?.client_id ? (
              <p className="text-xs text-[var(--text-muted)] pt-1">
                <span className="font-mono">{config.client_id}</span>
              </p>
            ) : null}
          </form>
        )}
      </section>

      {/* ── Section 2 — Knowledge base ─────────────────────────────────── */}
      <section
        aria-labelledby="chat-bot-kb-heading"
        data-testid="chat-bot-section-kb"
      >
        <header className="flex items-start justify-between gap-4 flex-wrap mb-3">
          <div className="min-w-0 flex items-center gap-2">
            <Icon as={BookOpen} size="sm" className="text-[var(--text-muted)]" />
            <h3 id="chat-bot-kb-heading" className="t-h3">
              {t('chat_bot.knowledge.title')}
            </h3>
            {!kbLoading && kbEntries.length > 0 ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--gray-100)] text-[var(--gray-700)] border border-[var(--border-subtle)]">
                {activeKbCount} / {kbEntries.length}
              </span>
            ) : null}
          </div>
          <Button
            onClick={handleOpenKbCreate}
            size="sm"
            leftIcon={<Icon as={Plus} size="sm" />}
            aria-label={t('chat_bot.knowledge.create')}
            data-testid="chat-bot-kb-btn-create"
          >
            {t('chat_bot.knowledge.create')}
          </Button>
        </header>

        {kbLoading ? (
          <div className="space-y-2" data-testid="chat-bot-kb-loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : kbEntries.length === 0 ? (
          <div
            className="rounded-xl border border-dashed border-[var(--border-subtle)] p-8 text-center text-sm text-[var(--text-muted)]"
            data-testid="chat-bot-kb-empty"
          >
            <Icon as={BookOpen} size={32} className="mx-auto mb-2 opacity-50" />
            <p>{t('chat_bot.knowledge.empty')}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-white overflow-hidden">
            <table
              className="w-full text-sm"
              aria-label={t('chat_bot.knowledge.title')}
              data-testid="chat-bot-kb-table"
            >
              <thead className="bg-[var(--gray-50)] text-[var(--text-muted)] text-xs uppercase tracking-wide">
                <tr>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    {t('chat_bot.knowledge.title')}
                  </th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">
                    {t('chat_bot.knowledge.source_manual')}
                  </th>
                  <th scope="col" className="text-right px-4 py-2 font-medium">
                    <span className="sr-only">{t('chat_bot.knowledge.title')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {kbEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    data-testid={`chat-bot-kb-row-${entry.id}`}
                    className="border-t border-[var(--border-subtle)]"
                  >
                    <td className="px-4 py-2 align-top">
                      <div className="font-medium text-[var(--text-primary)]">
                        {entry.title}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] line-clamp-2 max-w-xl mt-0.5">
                        {entry.content}
                      </div>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--gray-100)] text-[var(--gray-700)] border border-[var(--border-subtle)]">
                        {sourceLabel(entry.source)}
                      </span>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenKbEdit(entry)}
                          leftIcon={<Icon as={Pencil} size="sm" />}
                          aria-label={`${t('chat_bot.knowledge.title')} — ${entry.title}`}
                          data-testid={`chat-bot-kb-btn-edit-${entry.id}`}
                        >
                          {t('chat_bot.knowledge.title')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDeleteKb(entry)}
                          leftIcon={<Icon as={Trash2} size="sm" />}
                          aria-label={`${t('chat_bot.knowledge.title')} — ${entry.title}`}
                          data-testid={`chat-bot-kb-btn-delete-${entry.id}`}
                        >
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

      {/* ── Section 3 — Test bot ───────────────────────────────────────── */}
      <section
        aria-labelledby="chat-bot-test-heading"
        data-testid="chat-bot-section-test"
        className="rounded-xl border border-[var(--border-subtle)] bg-white p-5"
      >
        <header className="mb-4 flex items-center gap-2">
          <Icon as={PlayCircle} size="sm" className="text-[var(--text-muted)]" />
          <h3 id="chat-bot-test-heading" className="t-h3">
            {t('chat_bot.test.cta')}
          </h3>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor="chat-bot-test-input"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('chat_bot.test.input_placeholder')}
            </label>
            <Input
              id="chat-bot-test-input"
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder={t('chat_bot.test.input_placeholder')}
              aria-label={t('chat_bot.test.input_placeholder')}
              data-testid="chat-bot-test-input"
            />
          </div>
          <Button
            type="button"
            onClick={() => void handleRunTest()}
            isLoading={testing}
            disabled={testing || !testMessage.trim()}
            leftIcon={<Icon as={PlayCircle} size="sm" />}
            aria-label={t('chat_bot.test.cta')}
            data-testid="chat-bot-test-run"
          >
            {t('chat_bot.test.cta')}
          </Button>
        </div>

        {kbEntries.length === 0 && !kbLoading ? (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {t('chat_bot.errors.kb_empty')}
          </p>
        ) : null}

        {testResult ? (
          <div
            className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--gray-50)] p-4 space-y-3"
            data-testid="chat-bot-test-result"
          >
            <header className="flex items-center justify-between gap-3 flex-wrap">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('chat_bot.test.cta')}
              </h4>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  data-testid="chat-bot-test-confidence"
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${confidenceBadgeClass(
                    testResult.confidence,
                    confidenceThreshold,
                  )}`}
                >
                  {t('chat_bot.config.confidence_threshold')}{' '}
                  {(testResult.confidence * 100).toFixed(0)}%
                </span>
                <span
                  data-testid="chat-bot-test-escalate"
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
                    ? t('chat_bot.config.escalation_message')
                    : t('chat_bot.config.enabled')}
                </span>
                <span
                  data-testid="chat-bot-test-kb-matched"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--gray-100)] text-[var(--gray-700)] border-[var(--border-subtle)]"
                >
                  <Icon as={BookOpen} size={12} />
                  {testResult.matched_kb_entries}
                </span>
              </div>
            </header>
            <div
              className="rounded-md border border-[var(--border-subtle)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] whitespace-pre-wrap"
              data-testid="chat-bot-test-response"
            >
              {testResult.response ?? (
                <span className="text-[var(--text-muted)]">—</span>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Modal CRUD KB ────────────────────────────────────────────── */}
      <Modal
        open={kbModalOpen}
        onOpenChange={handleCloseKbModal}
        size="lg"
        title={
          kbEditId
            ? `${t('chat_bot.knowledge.title')} — ${kbFormTitle || ''}`
            : t('chat_bot.knowledge.create')
        }
        description={t('chat_bot.knowledge.empty')}
      >
        <form
          onSubmit={(e) => void handleSubmitKb(e)}
          className="space-y-5"
          aria-label={t('chat_bot.knowledge.create')}
          data-testid="chat-bot-kb-form"
        >
          {/* Title */}
          <div>
            <label
              htmlFor="chat-bot-kb-form-title"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('chat_bot.knowledge.title')}
            </label>
            <Input
              id="chat-bot-kb-form-title"
              value={kbFormTitle}
              onChange={(e) => setKbFormTitle(e.target.value)}
              required
              aria-label={t('chat_bot.knowledge.title')}
              data-testid="chat-bot-kb-form-title"
            />
          </div>

          {/* Content */}
          <div>
            <label
              htmlFor="chat-bot-kb-form-content"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('chat_bot.knowledge.title')}
            </label>
            <Textarea
              id="chat-bot-kb-form-content"
              value={kbFormContent}
              onChange={(e) => setKbFormContent(e.target.value)}
              rows={6}
              required
              aria-label={t('chat_bot.knowledge.title')}
              data-testid="chat-bot-kb-form-content"
            />
          </div>

          {/* Source */}
          <div>
            <label
              htmlFor="chat-bot-kb-form-source"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('chat_bot.knowledge.source_manual')}
            </label>
            <Select
              id="chat-bot-kb-form-source"
              value={kbFormSource}
              onChange={(e) =>
                setKbFormSource(e.target.value as ChatKnowledgeSource)
              }
              aria-label={t('chat_bot.knowledge.source_manual')}
              data-testid="chat-bot-kb-form-source"
            >
              <option value="manual">
                {t('chat_bot.knowledge.source_manual')}
              </option>
              <option value="url">{t('chat_bot.knowledge.source_url')}</option>
              <option value="faq">{t('chat_bot.knowledge.source_faq')}</option>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleCloseKbModal(false)}
              disabled={kbSubmitting}
              aria-label={t('chat_bot.knowledge.create')}
              data-testid="chat-bot-kb-form-cancel"
            >
              ×
            </Button>
            <Button
              type="submit"
              isLoading={kbSubmitting}
              disabled={
                kbSubmitting || !kbFormTitle.trim() || !kbFormContent.trim()
              }
              aria-label={t('chat_bot.knowledge.create')}
              data-testid="chat-bot-kb-form-submit"
            >
              {kbEditId
                ? t('chat_bot.knowledge.title')
                : t('chat_bot.knowledge.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default ChatBotSettings;
