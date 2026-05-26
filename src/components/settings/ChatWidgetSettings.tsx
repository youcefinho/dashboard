// ── ChatWidgetSettings — Sprint 36 (Agent B1) ───────────────────────────────
// Formulaire de configuration d'un widget de chat live (création ou édition).
//
// API back FIGÉE (Phase A) :
//   getChatWidgets()                  → ApiResponse<ChatWidget[]>
//   createChatWidget(input)           → ApiResponse<ChatWidget>
//   updateChatWidget(id, input)       → ApiResponse<ChatWidget>
//   deleteChatWidget(id)              → ApiResponse<{ ok: true }>
//
// Props :
//   widgetId? — si fourni, mode édition (load via getChatWidgets() + find).
//   onSaved?  — callback post-create / post-update.
//
// Champs : name, primary_color (color picker), position (dropdown 4 valeurs),
//   welcome_message (textarea), offline_message (textarea), allowed_origins
//   (tag input — array d'URLs), avatar_url, show_powered_by (toggle),
//   turnstile_enabled (toggle), business_hours_json (textarea JSON optionnel).
//
// Embed snippet copyable (v1 par défaut, v2 si checkbox).
// Toggle "Preview" → <ChatWidgetPreview widgetId={...} /> (B3, signature assumée).
//
// Style : Stripe-clean, flat surfaces, focus ring purple. Toutes chaînes via t().
// Aucun console.log (CLAUDE.md). aria-labels i18n. Imports RELATIFS.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Copy, Eye, EyeOff, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { t } from '../../lib/i18n';
import {
  getChatWidgets,
  createChatWidget,
  updateChatWidget,
  type ChatWidget,
  type ChatWidgetInput,
  type ChatWidgetPosition,
} from '../../lib/api';

// ── Lazy peer component (B3) — signature assumée ───────────────────────────
// On évite un import dur pour ne pas casser le build si B3 n'est pas encore
// merge ; tant que l'utilisateur n'ouvre pas le preview, l'import ne s'exécute
// pas.
type ChatWidgetPreviewProps = { widgetId?: string };
type LazyPreview = (p: ChatWidgetPreviewProps) => JSX.Element | null;

// ── Helpers ────────────────────────────────────────────────────────────────

const POSITIONS: ChatWidgetPosition[] = [
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
];

const DEFAULT_COLOR = '#00B5F5';

/** Format URL pour l'embed snippet. */
function buildSnippet(clientId: string, useV2: boolean, origin: string): string {
  const version = useV2 ? '&v=2' : '';
  return `<script src="${origin}/api/webchat/widget.js?client_id=${clientId}${version}" defer></script>`;
}

/** Normalise une origin saisie (trim, retire trailing slash). */
function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Validation faible côté UI : non-vide + commence par http(s):// OU *. */
function isValidOrigin(o: string): boolean {
  if (!o) return false;
  return /^(https?:\/\/|\*\.?)/.test(o);
}

// ── Composant ──────────────────────────────────────────────────────────────

export interface ChatWidgetSettingsProps {
  widgetId?: string;
  onSaved?: () => void;
}

export function ChatWidgetSettings({
  widgetId,
  onSaved,
}: ChatWidgetSettingsProps) {
  const { success, error: toastError } = useToast();

  // ── État formulaire ────────────────────────────────────────────────────
  const [name, setName] = useState<string>('');
  const [primaryColor, setPrimaryColor] = useState<string>(DEFAULT_COLOR);
  const [position, setPosition] = useState<ChatWidgetPosition>('bottom-right');
  const [welcomeMessage, setWelcomeMessage] = useState<string>('');
  const [offlineMessage, setOfflineMessage] = useState<string>('');
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([]);
  const [originDraft, setOriginDraft] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [showPoweredBy, setShowPoweredBy] = useState<boolean>(true);
  const [turnstileEnabled, setTurnstileEnabled] = useState<boolean>(false);
  const [businessHoursJson, setBusinessHoursJson] = useState<string>('');
  const [useV2, setUseV2] = useState<boolean>(false);

  // Meta widget (clientId pour snippet)
  const [loadedWidget, setLoadedWidget] = useState<ChatWidget | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(widgetId));
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [previewComponent, setPreviewComponent] =
    useState<LazyPreview | null>(null);

  // Validation
  const [nameError, setNameError] = useState<string | null>(null);
  const [originError, setOriginError] = useState<string | null>(null);
  const [businessHoursError, setBusinessHoursError] = useState<string | null>(
    null,
  );

  // ── Chargement initial (édition) ───────────────────────────────────────
  useEffect(() => {
    if (!widgetId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const res = await getChatWidgets();
      if (cancelled) return;
      if (res.error) {
        toastError(res.error);
        setLoading(false);
        return;
      }
      const found = (res.data ?? []).find((w) => w.id === widgetId) ?? null;
      if (!found) {
        toastError(t('toast.error_generic'));
        setLoading(false);
        return;
      }
      setLoadedWidget(found);
      setName(found.name ?? '');
      setPrimaryColor(found.primary_color ?? DEFAULT_COLOR);
      setPosition(found.position);
      setWelcomeMessage(found.welcome_message ?? '');
      setOfflineMessage(found.offline_message ?? '');
      setAllowedOrigins(found.allowed_origins ?? []);
      setAvatarUrl(found.avatar_url ?? '');
      setShowPoweredBy(found.show_powered_by === 1);
      setTurnstileEnabled(found.turnstile_enabled === 1);
      setBusinessHoursJson(found.business_hours_json ?? '');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [widgetId, toastError]);

  // ── Lazy preview loader ────────────────────────────────────────────────
  const handleTogglePreview = useCallback(async () => {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    if (!previewComponent) {
      try {
        const mod = (await import(
          /* @vite-ignore */ './ChatWidgetPreview'
        )) as { ChatWidgetPreview: LazyPreview };
        setPreviewComponent(() => mod.ChatWidgetPreview);
      } catch {
        toastError(t('toast.error_generic'));
        return;
      }
    }
    setShowPreview(true);
  }, [showPreview, previewComponent, toastError]);

  // ── Tag input allowed_origins ─────────────────────────────────────────
  const addOrigin = useCallback(() => {
    const raw = normalizeOrigin(originDraft);
    if (!raw) return;
    if (!isValidOrigin(raw)) {
      setOriginError(t('chat_widgets.allowed_origins'));
      return;
    }
    if (allowedOrigins.includes(raw)) {
      setOriginDraft('');
      return;
    }
    setAllowedOrigins((prev) => [...prev, raw]);
    setOriginDraft('');
    setOriginError(null);
  }, [originDraft, allowedOrigins]);

  const removeOrigin = useCallback((o: string) => {
    setAllowedOrigins((prev) => prev.filter((x) => x !== o));
  }, []);

  const handleOriginKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addOrigin();
      } else if (e.key === 'Backspace' && originDraft === '' && allowedOrigins.length > 0) {
        // Backspace sur draft vide retire le dernier tag.
        const last = allowedOrigins[allowedOrigins.length - 1];
        if (last !== undefined) removeOrigin(last);
      }
    },
    [addOrigin, originDraft, allowedOrigins, removeOrigin],
  );

  // ── Snippet copy ───────────────────────────────────────────────────────
  const origin = useMemo(() => {
    if (typeof window === 'undefined') return 'https://app.intralys.com';
    return window.location.origin;
  }, []);

  const snippet = useMemo(() => {
    if (!loadedWidget) return '';
    return buildSnippet(loadedWidget.client_id, useV2, origin);
  }, [loadedWidget, useV2, origin]);

  const handleCopySnippet = useCallback(async () => {
    if (!snippet) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(snippet);
      } else {
        // Fallback DOM-only.
        const ta = document.createElement('textarea');
        ta.value = snippet;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      success(t('toast.copied'));
    } catch {
      toastError(t('toast.error_generic'));
    }
  }, [snippet, success, toastError]);

  // ── Submit ─────────────────────────────────────────────────────────────
  const validate = useCallback((): boolean => {
    let ok = true;
    if (!name.trim()) {
      setNameError(t('chat_widgets.name'));
      ok = false;
    } else {
      setNameError(null);
    }
    if (businessHoursJson.trim()) {
      try {
        JSON.parse(businessHoursJson);
        setBusinessHoursError(null);
      } catch {
        setBusinessHoursError(t('chat_widgets.business_hours'));
        ok = false;
      }
    } else {
      setBusinessHoursError(null);
    }
    return ok;
  }, [name, businessHoursJson]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!validate()) return;

      const input: ChatWidgetInput = {
        name: name.trim(),
        primary_color: primaryColor,
        position,
        welcome_message: welcomeMessage.trim() || undefined,
        offline_message: offlineMessage.trim() || undefined,
        allowed_origins: allowedOrigins.length > 0 ? allowedOrigins : [],
        avatar_url: avatarUrl.trim() || undefined,
        show_powered_by: showPoweredBy,
        turnstile_enabled: turnstileEnabled,
        business_hours_json: businessHoursJson.trim() || undefined,
      };

      setSubmitting(true);
      const res = widgetId
        ? await updateChatWidget(widgetId, input)
        : await createChatWidget(input);
      setSubmitting(false);

      if (res.error) {
        toastError(res.error);
        return;
      }
      if (res.data) {
        setLoadedWidget(res.data);
      }
      success(t('toast.saved'));
      onSaved?.();
    },
    [
      validate,
      name,
      primaryColor,
      position,
      welcomeMessage,
      offlineMessage,
      allowedOrigins,
      avatarUrl,
      showPoweredBy,
      turnstileEnabled,
      businessHoursJson,
      widgetId,
      success,
      toastError,
      onSaved,
    ],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="space-y-4 p-6"
        data-testid="chat-widget-settings-loading"
        aria-busy="true"
      >
        <div className="h-4 w-48 bg-[var(--gray-100)] rounded animate-pulse" />
        <div className="h-9 w-full bg-[var(--gray-100)] rounded animate-pulse" />
        <div className="h-9 w-full bg-[var(--gray-100)] rounded animate-pulse" />
        <div className="h-20 w-full bg-[var(--gray-100)] rounded animate-pulse" />
      </div>
    );
  }

  const PreviewCmp = previewComponent;

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6"
      data-testid="chat-widget-settings"
    >
      {/* ── Form ─────────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6"
        aria-label={t('chat_widgets.title')}
      >
        {/* Name */}
        <div>
          <label
            htmlFor="cw-name"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('chat_widgets.name')}
          </label>
          <Input
            id="cw-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            aria-label={t('chat_widgets.name')}
            error={nameError ?? undefined}
            data-testid="cw-input-name"
          />
        </div>

        {/* Primary color + position */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="cw-color"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('chat_widgets.primary_color')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="cw-color"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                aria-label={t('chat_widgets.primary_color')}
                className="h-9 w-12 rounded border border-[var(--border)] bg-white cursor-pointer"
                data-testid="cw-input-color"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                aria-label={t('chat_widgets.primary_color')}
                className="font-mono"
                data-testid="cw-input-color-hex"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="cw-position"
              className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
            >
              {t('chat_widgets.position')}
            </label>
            <select
              id="cw-position"
              value={position}
              onChange={(e) =>
                setPosition(e.target.value as ChatWidgetPosition)
              }
              aria-label={t('chat_widgets.position')}
              className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-white px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-purple)] focus:ring-3 focus:ring-[var(--primary-ring)]"
              data-testid="cw-input-position"
            >
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Welcome message */}
        <div>
          <label
            htmlFor="cw-welcome"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('chat_widgets.welcome_message')}
          </label>
          <Textarea
            id="cw-welcome"
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            rows={2}
            maxLength={280}
            aria-label={t('chat_widgets.welcome_message')}
            data-testid="cw-input-welcome"
          />
        </div>

        {/* Offline message */}
        <div>
          <label
            htmlFor="cw-offline"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('chat_widgets.offline_message')}
          </label>
          <Textarea
            id="cw-offline"
            value={offlineMessage}
            onChange={(e) => setOfflineMessage(e.target.value)}
            rows={2}
            maxLength={280}
            aria-label={t('chat_widgets.offline_message')}
            data-testid="cw-input-offline"
          />
        </div>

        {/* Allowed origins — tag input */}
        <div>
          <label
            htmlFor="cw-origin-input"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('chat_widgets.allowed_origins')}
          </label>
          <div
            className="flex flex-wrap items-center gap-2 p-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-white min-h-[2.5rem] focus-within:border-[var(--brand-purple)] focus-within:ring-3 focus-within:ring-[var(--primary-ring)]"
            data-testid="cw-origins-container"
          >
            {allowedOrigins.map((o) => (
              <span
                key={o}
                data-testid={`cw-origin-tag-${o}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--gray-100)] text-[var(--gray-700)] border border-[var(--border-subtle)]"
              >
                <span className="font-mono">{o}</span>
                <button
                  type="button"
                  onClick={() => removeOrigin(o)}
                  aria-label={`${t('action.delete')} — ${o}`}
                  className="ml-1 text-[var(--gray-500)] hover:text-[var(--danger)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)] rounded-full"
                >
                  <Icon as={X} size={12} />
                </button>
              </span>
            ))}
            <input
              id="cw-origin-input"
              type="text"
              value={originDraft}
              onChange={(e) => setOriginDraft(e.target.value)}
              onKeyDown={handleOriginKeyDown}
              onBlur={() => {
                if (originDraft.trim()) addOrigin();
              }}
              placeholder="https://example.com"
              aria-label={t('chat_widgets.allowed_origins')}
              className="flex-1 min-w-[160px] text-sm bg-transparent border-0 focus:outline-none focus:ring-0 text-[var(--text-primary)]"
              data-testid="cw-input-origin"
            />
          </div>
          {originError ? (
            <p
              className="mt-1 text-xs text-[var(--danger)]"
              data-testid="cw-origin-error"
            >
              {originError}
            </p>
          ) : null}
        </div>

        {/* Avatar URL */}
        <div>
          <label
            htmlFor="cw-avatar"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('chat_widgets.name')} — avatar URL
          </label>
          <Input
            id="cw-avatar"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…/avatar.png"
            aria-label="avatar URL"
            data-testid="cw-input-avatar"
          />
        </div>

        {/* Toggles */}
        <div className="space-y-4">
          <Switch
            checked={showPoweredBy}
            onCheckedChange={setShowPoweredBy}
            label={t('chat_widgets.title')}
            description="Powered by Intralys"
            id="cw-powered-by"
            data-testid="cw-switch-powered-by"
          />
          <Switch
            checked={turnstileEnabled}
            onCheckedChange={setTurnstileEnabled}
            label={t('chat_widgets.turnstile_enable')}
            id="cw-turnstile"
            data-testid="cw-switch-turnstile"
          />
        </div>

        {/* Business hours JSON */}
        <div>
          <label
            htmlFor="cw-hours"
            className="text-sm font-medium text-[var(--text-secondary)] block mb-1.5"
          >
            {t('chat_widgets.business_hours')} (JSON)
          </label>
          <Textarea
            id="cw-hours"
            value={businessHoursJson}
            onChange={(e) => setBusinessHoursJson(e.target.value)}
            rows={4}
            placeholder='{"mon":["09:00","17:00"]}'
            aria-label={t('chat_widgets.business_hours')}
            className="font-mono text-xs"
            error={businessHoursError ?? undefined}
            data-testid="cw-input-hours"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {widgetId ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleTogglePreview()}
              leftIcon={
                <Icon as={showPreview ? EyeOff : Eye} size="sm" />
              }
              aria-label={t('action.preview')}
              data-testid="cw-btn-preview"
            >
              {t('action.preview')}
            </Button>
          ) : null}
          <Button
            type="submit"
            isLoading={submitting}
            disabled={submitting || !name.trim()}
            aria-label={t('action.save')}
            data-testid="cw-btn-submit"
          >
            {t('action.save')}
          </Button>
        </div>
      </form>

      {/* ── Side panel : snippet + preview ───────────────────────────── */}
      <aside className="space-y-4">
        {loadedWidget ? (
          <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
              {t('chat_widgets.snippet_copy')}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              {t('chat_widgets.snippet_help')}
            </p>
            <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useV2}
                onChange={(e) => setUseV2(e.target.checked)}
                data-testid="cw-input-v2"
                aria-label="widget v2"
              />
              widget.js v2
            </label>
            <pre
              data-testid="cw-snippet-pre"
              className="text-xs font-mono p-3 rounded-md bg-[var(--gray-50)] border border-[var(--border-subtle)] text-[var(--text-primary)] overflow-x-auto whitespace-pre-wrap break-all"
            >
              {snippet}
            </pre>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Icon as={Copy} size="sm" />}
              onClick={() => void handleCopySnippet()}
              aria-label={t('chat_widgets.snippet_copy')}
              className="mt-3"
              data-testid="cw-btn-copy"
            >
              {t('chat_widgets.snippet_copy')}
            </Button>
          </div>
        ) : null}

        {showPreview && PreviewCmp ? (
          <div
            className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white"
            data-testid="cw-preview-panel"
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
              {t('action.preview')}
            </h3>
            <PreviewCmp widgetId={widgetId} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
