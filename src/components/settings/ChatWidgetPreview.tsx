// ── Sprint 36 — Live chat ChatWidgetPreview (Agent B3) ────────────────────
// Aperçu iframe statique du widget de chat live (mode preview=1, pas de WS).
// Charge frame.html OU frame-v2.html selon le toggle interne `use_v2`.
// Dimensions fixes 380×600 (mobile-like). Sandbox restrictif.
//
// Modes d'usage :
//   <ChatWidgetPreview widget={chatWidget} />
//   <ChatWidgetPreview widgetId="cw_abc123" />  (lazy fetch via getChatWidgets)
//
// Pas de side effects (zéro WS, zéro persistence). Imports relatifs.
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { ChatWidget } from '../../lib/api';
import { getChatWidgets } from '../../lib/api';
import { t } from '../../lib/i18n';
import { Card } from '../ui/Card';
import { Switch } from '../ui/Switch';

// Dimensions iframe figées — mobile-like, identiques aux widgets embarqués.
const IFRAME_WIDTH = 380;
const IFRAME_HEIGHT = 600;

// Fallbacks visuels si le widget n'a pas encore de valeurs côté API.
const DEFAULT_COLOR = '#009DDB';
const DEFAULT_WELCOME = '';
const DEFAULT_POSITION = 'bottom-right';

type ChatWidgetPreviewProps =
  | { widget: ChatWidget; widgetId?: never }
  | { widgetId: string; widget?: never };

/**
 * Construit l'URL src de l'iframe preview pour un widget donné.
 * mode static : `preview=1` (le frame.html lit ce flag et ne tente pas de WS).
 */
function buildPreviewSrc(widget: ChatWidget, useV2: boolean): string {
  const base = useV2 ? '/widget/frame-v2.html' : '/widget/frame.html';
  const params = new URLSearchParams({
    preview: '1',
    client: widget.client_id,
    color: widget.primary_color ?? DEFAULT_COLOR,
    welcome: widget.welcome_message ?? DEFAULT_WELCOME,
    position: widget.position ?? DEFAULT_POSITION,
  });
  return `${base}?${params.toString()}`;
}

export function ChatWidgetPreview(props: ChatWidgetPreviewProps): JSX.Element {
  const [fetchedWidget, setFetchedWidget] = useState<ChatWidget | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [useV2, setUseV2] = useState<boolean>(false);

  // Lazy fetch — uniquement si on a reçu un id sans widget.
  useEffect(() => {
    if (props.widget || !props.widgetId) return;
    let cancelled = false;
    void getChatWidgets().then((res) => {
      if (cancelled) return;
      if (res.error || !res.data) {
        setLoadError(res.error ?? 'load_failed');
        return;
      }
      const found = res.data.find((w) => w.id === props.widgetId) ?? null;
      if (!found) {
        setLoadError('widget_not_found');
        return;
      }
      setFetchedWidget(found);
    });
    return () => {
      cancelled = true;
    };
  }, [props.widget, props.widgetId]);

  const widget: ChatWidget | null = props.widget ?? fetchedWidget;
  const title = t('chat_widget.preview_title');

  const src = useMemo<string | null>(() => {
    if (!widget) return null;
    return buildPreviewSrc(widget, useV2);
  }, [widget, useV2]);

  return (
    <Card
      className="flex flex-col items-center gap-4"
      aria-label={title}
      role="region"
    >
      <div className="flex w-full items-center justify-between gap-4">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        <Switch
          checked={useV2}
          onCheckedChange={setUseV2}
          size="sm"
          label="v2"
          aria-label={title}
        />
      </div>

      {loadError && (
        <p
          role="status"
          className="text-sm text-[var(--text-muted)]"
          data-testid="chat-widget-preview-error"
        >
          {loadError}
        </p>
      )}

      {src && widget && (
        <div
          className="overflow-hidden rounded-2xl border border-[var(--border)] shadow-[var(--shadow-md,0_8px_24px_rgba(15,23,42,0.10))] bg-white"
          style={{ width: IFRAME_WIDTH, height: IFRAME_HEIGHT }}
        >
          <iframe
            data-testid="chat-widget-preview-iframe"
            title={title}
            aria-label={title}
            src={src}
            width={IFRAME_WIDTH}
            height={IFRAME_HEIGHT}
            sandbox="allow-scripts allow-same-origin allow-forms"
            style={{ width: IFRAME_WIDTH, height: IFRAME_HEIGHT, border: 0, display: 'block' }}
          />
        </div>
      )}
    </Card>
  );
}

export default ChatWidgetPreview;
