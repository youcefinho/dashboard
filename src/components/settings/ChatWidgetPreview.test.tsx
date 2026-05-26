// @vitest-environment jsdom
// ── Sprint 36 — Live chat ChatWidgetPreview (Agent B3) tests ──────────────
// Couvre :
//   1. Render avec widget mock → iframe rendered avec bon src
//   2. Dimensions iframe 380×600
//   3. sandbox attribute "allow-scripts allow-same-origin allow-forms"
//   4. Query params encodés (color #, welcome avec espaces/accents, position)
//   5. Switch v2 → src bascule de frame.html à frame-v2.html
//   6. Mode widgetId (lazy fetch) → mock api.getChatWidgets → iframe rendered
//   7. Mode widgetId widget introuvable → message d'erreur
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { t } from '../../lib/i18n';
import type { ChatWidget } from '../../lib/api';

// ── Mock API (mode widgetId lazy fetch) ─────────────────────────────────────
// Mock complet : on évite vi.importActual() pour ne pas tirer toute la lib/api
// (et ses parse errors préexistantes hors scope Sprint 36). Le composant
// importe uniquement `getChatWidgets` et le type `ChatWidget` (type-only,
// stripé au build), donc un mock minimal suffit.
const getChatWidgetsMock = vi.fn();
vi.mock('../../lib/api', () => ({
  getChatWidgets: (...args: unknown[]) => getChatWidgetsMock(...args),
}));

// Import APRÈS le mock pour que le composant utilise la version mockée.
import { ChatWidgetPreview } from './ChatWidgetPreview';

const WIDGET_MOCK: ChatWidget = {
  id: 'cw_abc123',
  client_id: 'cli_xyz789',
  agency_id: null,
  name: 'Widget principal',
  primary_color: '#FF6600',
  welcome_message: 'Bonjour & bienvenue !',
  offline_message: 'Nous sommes hors ligne.',
  position: 'bottom-left',
  allowed_origins: null,
  avatar_url: null,
  show_powered_by: 1,
  business_hours_json: null,
  bot_initial_replies_json: null,
  turnstile_enabled: 0,
  is_active: 1,
  created_at: '2026-05-24T00:00:00Z',
  updated_at: null,
};

function getIframe(): HTMLIFrameElement {
  return screen.getByTestId('chat-widget-preview-iframe') as HTMLIFrameElement;
}

describe('ChatWidgetPreview', () => {
  beforeEach(() => {
    getChatWidgetsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('rend une iframe avec le bon src (mode widget direct)', () => {
    render(<ChatWidgetPreview widget={WIDGET_MOCK} />);
    const iframe = getIframe();
    expect(iframe).toBeInTheDocument();

    const src = iframe.getAttribute('src') ?? '';
    expect(src.startsWith('/widget/frame.html?')).toBe(true);
    expect(src).not.toContain('frame-v2.html');
  });

  it('affiche le titre i18n chat_widget.preview_title', () => {
    render(<ChatWidgetPreview widget={WIDGET_MOCK} />);
    const expected = t('chat_widget.preview_title');
    expect(screen.getByRole('heading', { name: expected })).toBeInTheDocument();
  });

  it('iframe a les dimensions fixes 380×600', () => {
    render(<ChatWidgetPreview widget={WIDGET_MOCK} />);
    const iframe = getIframe();
    expect(iframe.getAttribute('width')).toBe('380');
    expect(iframe.getAttribute('height')).toBe('600');
  });

  it('iframe a le sandbox restrictif attendu', () => {
    render(<ChatWidgetPreview widget={WIDGET_MOCK} />);
    const iframe = getIframe();
    expect(iframe.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-forms',
    );
  });

  it('encode correctement color, welcome (avec espaces/accents) et position', () => {
    render(<ChatWidgetPreview widget={WIDGET_MOCK} />);
    const src = getIframe().getAttribute('src') ?? '';
    const url = new URL(src, 'http://localhost');
    expect(url.searchParams.get('preview')).toBe('1');
    expect(url.searchParams.get('client')).toBe('cli_xyz789');
    expect(url.searchParams.get('color')).toBe('#FF6600');
    expect(url.searchParams.get('welcome')).toBe('Bonjour & bienvenue !');
    expect(url.searchParams.get('position')).toBe('bottom-left');

    // Le raw src DOIT contenir les versions encodées (pas les valeurs brutes).
    expect(src).toContain('color=%23FF6600');
    expect(src).toContain('welcome=Bonjour+%26+bienvenue+%21');
    expect(src).toContain('position=bottom-left');
  });

  it('switch v2 bascule src vers frame-v2.html', () => {
    render(<ChatWidgetPreview widget={WIDGET_MOCK} />);
    const iframeBefore = getIframe();
    expect(iframeBefore.getAttribute('src') ?? '').toContain('/widget/frame.html?');

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    const iframeAfter = getIframe();
    const src = iframeAfter.getAttribute('src') ?? '';
    expect(src.startsWith('/widget/frame-v2.html?')).toBe(true);
    // Les query params doivent toujours être présents.
    expect(src).toContain('client=cli_xyz789');
    expect(src).toContain('position=bottom-left');
  });

  it('mode widgetId → lazy fetch via getChatWidgets puis rend iframe', async () => {
    getChatWidgetsMock.mockResolvedValueOnce({ data: [WIDGET_MOCK] });

    render(<ChatWidgetPreview widgetId="cw_abc123" />);

    await waitFor(() => {
      expect(getChatWidgetsMock).toHaveBeenCalledTimes(1);
    });

    const iframe = await waitFor(() => getIframe());
    const src = iframe.getAttribute('src') ?? '';
    expect(src).toContain('client=cli_xyz789');
  });

  it('mode widgetId → widget introuvable → message d’erreur', async () => {
    getChatWidgetsMock.mockResolvedValueOnce({ data: [] });

    render(<ChatWidgetPreview widgetId="cw_unknown" />);

    await waitFor(() => {
      expect(
        screen.getByTestId('chat-widget-preview-error'),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId('chat-widget-preview-iframe')).toBeNull();
  });
});
