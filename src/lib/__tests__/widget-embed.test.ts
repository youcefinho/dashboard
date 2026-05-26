// @vitest-environment jsdom
//
// ── widget-embed.test.ts — Sprint 36 (Agent C2) ──────────────────────────────
//
// Couvre public/widget/v2.js : injection bubble + chip + iframe lazy,
// fallback config (fetch 500), validation origin postMessage, sandboxage iframe.
//
// Le script est un IIFE auto-launch. On le charge via readFileSync + eval()
// (Function constructor pour éviter d'invoquer le strict mode partagé).
//
// jsdom env explicite — vitest.config.ts est en 'node' par défaut.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const V2_PATH = resolve(__dirname, '../../../public/widget/v2.js');
const V2_SOURCE = readFileSync(V2_PATH, 'utf8');

// ── Helpers ─────────────────────────────────────────────────────────────────
const API_BASE = 'https://app.intralys.test';
const V2_SRC = `${API_BASE}/widget/v2.js`;

/**
 * Installe le tag <script src="...v2.js" data-client="..."> dans le DOM
 * et évalue le code v2.js en simulant document.currentScript.
 */
function installWidget(attrs: Record<string, string>): HTMLScriptElement {
  const script = document.createElement('script');
  script.setAttribute('src', V2_SRC);
  for (const [k, v] of Object.entries(attrs)) {
    script.setAttribute(k, v);
  }
  document.head.appendChild(script);

  // jsdom ne définit pas document.currentScript pour les scripts injectés
  // programmatiquement, donc on patch temporairement getter le temps de l'eval.
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'currentScript',
  );
  Object.defineProperty(document, 'currentScript', {
    value: script,
    configurable: true,
  });

  try {
    // Function constructor — exécute le code dans le scope global de jsdom
    // sans hériter du strict mode de ce fichier.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function(V2_SOURCE)();
  } finally {
    // Restaure currentScript
    if (originalDescriptor) {
      Object.defineProperty(document, 'currentScript', originalDescriptor);
    } else {
      // @ts-expect-error — cleanup test-only
      delete (document as any).currentScript;
    }
  }

  return script;
}

/** Reset complet entre tests : DOM + flag IIFE + fetch mock. */
function resetEnv(): void {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  // Le flag namespace qui empêche le double-mount
  delete (window as any).__intralys_webchat_v2;
  vi.restoreAllMocks();
}

/** Attend que toutes les microtâches + setTimeout(0) en attente soient flushées.
 *  fetch().then().then().then() + json() async = chaîne plus longue que
 *  4 microtâches. On mixe macro+micro tasks pour être sûr. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
  await new Promise((r) => setTimeout(r, 0));
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('widget v2.js embed', () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it('1) injects bubble + chip with client config (color, position) on successful fetch', async () => {
    const mockConfig = {
      data: {
        color: '#00ff00',
        position: 'bottom-right',
        welcome_message: 'Salut',
        agent_presence: 'online',
        agency_name: 'TestAgency',
        turnstile_enabled: false,
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => mockConfig,
    });
    (globalThis as any).fetch = fetchMock;

    installWidget({
      'data-client': 'cli_test_001',
      'data-position': 'bottom-right',
      'data-color': '#FF0000', // attr-color override le config
    });

    await flush();

    const bubble = document.getElementById('__ix2-bubble');
    const chip = document.getElementById('__ix2-chip');
    const style = document.getElementById('__ix2-style');

    expect(bubble).not.toBeNull();
    expect(chip).not.toBeNull();
    expect(style).not.toBeNull();

    // L'attribut data-color (#FF0000) prime sur la couleur du config (#00ff00)
    expect(style!.textContent).toContain('#FF0000');

    // Position bottom-right appliquée en inline-style sur le bubble
    expect((bubble as HTMLElement).style.bottom).toBe('20px');
    expect((bubble as HTMLElement).style.right).toBe('20px');
    expect((bubble as HTMLElement).style.top).toBe('auto');
    expect((bubble as HTMLElement).style.left).toBe('auto');

    // Chip présence : online par défaut
    expect(chip!.className).toBe('online');
    expect(chip!.textContent).toContain('En ligne');

    // Le fetch a bien tapé l'endpoint config
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/api/webchat/widget.js?client_id=cli_test_001&meta=1',
    );

    // ARIA accessibility
    expect(bubble!.getAttribute('aria-label')).toBe('Ouvrir le chat');
    expect(bubble!.getAttribute('aria-expanded')).toBe('false');
  });

  it('2) fetch returns 500 → fallback to defaults (no crash, bubble still rendered)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'text/plain' },
      json: async () => ({}),
    });
    (globalThis as any).fetch = fetchMock;

    installWidget({
      'data-client': 'cli_test_500',
      // pas de data-color → doit retomber sur DEFAULTS.color (#3b82f6)
    });

    await flush();

    const bubble = document.getElementById('__ix2-bubble');
    const style = document.getElementById('__ix2-style');
    const chip = document.getElementById('__ix2-chip');

    // Pas de crash : bubble bien injecté malgré le 500
    expect(bubble).not.toBeNull();
    expect(chip).not.toBeNull();

    // Fallback color = DEFAULTS.color (#3b82f6)
    expect(style!.textContent).toContain('#3b82f6');

    // Chip retombe sur DEFAULTS.agent_presence === 'online'
    expect(chip!.className).toBe('online');
  });

  it('2b) fetch rejects (network throw) → fallback path same as 500', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'));
    (globalThis as any).fetch = fetchMock;

    installWidget({
      'data-client': 'cli_test_reject',
      'data-color': '#abcdef',
    });

    await flush();

    const bubble = document.getElementById('__ix2-bubble');
    const style = document.getElementById('__ix2-style');

    expect(bubble).not.toBeNull();
    // data-color attr est conservé même en fallback
    expect(style!.textContent).toContain('#abcdef');
  });

  it('3) postMessage from wrong origin → ignored (no state change)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        data: {
          color: '#3b82f6',
          position: 'bottom-right',
          agent_presence: 'online',
          agency_name: 'Test',
        },
      }),
    });
    (globalThis as any).fetch = fetchMock;

    installWidget({ 'data-client': 'cli_test_origin' });
    await flush();

    const chip = document.getElementById('__ix2-chip')!;
    expect(chip.className).toBe('online');

    // Envoie un message depuis un origin malveillant — doit être ignoré
    const evilEvent = new MessageEvent('message', {
      data: { type: 'webchat.presence', presence: 'offline' },
      origin: 'https://evil.example.com',
    });
    window.dispatchEvent(evilEvent);

    // Aucune mutation : chip reste online
    expect(chip.className).toBe('online');

    // Envoie un message depuis le bon origin (apiBase = origin du script src)
    const validEvent = new MessageEvent('message', {
      data: { type: 'webchat.presence', presence: 'offline' },
      origin: API_BASE,
    });
    window.dispatchEvent(validEvent);

    // Cette fois le chip doit refléter l'état offline
    expect(chip.className).toBe('offline');
    expect(chip.textContent).toContain('Hors-ligne');
  });

  it('4) honeypot — v2.js ne fait AUCUN POST réseau pour prechat (delegated to iframe)', async () => {
    // Le honeypot est géré côté frame-v2.html (iframe), pas côté v2.js.
    // v2.js doit donc ne JAMAIS faire de POST réseau, peu importe les
    // messages postMessage qu'il reçoit. Cette assertion documente le
    // contract sécurité : v2.js parent = passive listener, pas d'I/O.

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        data: { color: '#3b82f6', position: 'bottom-right', agent_presence: 'online' },
      }),
    });
    (globalThis as any).fetch = fetchMock;

    installWidget({ 'data-client': 'cli_test_hp' });
    await flush();

    // Reset compteur : on ne compte QUE les fetch après mount
    const initialCalls = fetchMock.mock.calls.length;

    // Simule iframe envoyant un faux prechat avec honeypot rempli (spam)
    const evt = new MessageEvent('message', {
      data: {
        type: 'webchat.prechat',
        _hp: 'spam_content',
        visitor_name: 'BotAttacker',
      },
      origin: API_BASE,
    });
    window.dispatchEvent(evt);

    // v2.js (parent) ne doit faire AUCUN POST réseau en réponse —
    // il ne gère que close/presence/ws.state via postMessage
    expect(fetchMock.mock.calls.length).toBe(initialCalls);

    // Vérifie aussi qu'aucun POST n'a été fait (assertion défensive : si un
    // POST existait il aurait method: 'POST' dans init)
    const postCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit)?.method === 'POST',
    );
    expect(postCalls.length).toBe(0);
  });

  it('bonus — clicking the bubble lazily creates an iframe with sandbox attrs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        data: {
          color: '#3b82f6',
          position: 'bottom-right',
          welcome_message: 'Hello',
          agency_name: 'TestAgency',
          agent_presence: 'online',
        },
      }),
    });
    (globalThis as any).fetch = fetchMock;

    installWidget({ 'data-client': 'cli_test_iframe' });
    await flush();

    // Avant click : pas d'iframe
    expect(document.getElementById('__ix2-iframe')).toBeNull();

    const bubble = document.getElementById('__ix2-bubble') as HTMLButtonElement;
    bubble.click();

    const iframe = document.getElementById('__ix2-iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
    expect(iframe.getAttribute('sandbox')).toContain('allow-same-origin');
    expect(iframe.getAttribute('sandbox')).toContain('allow-forms');
    expect(iframe.getAttribute('src')).toContain('/widget/frame-v2.html');
    expect(iframe.getAttribute('src')).toContain('client=cli_test_iframe');
    expect(iframe.classList.contains('open')).toBe(true);
    expect(bubble.getAttribute('aria-expanded')).toBe('true');
  });
});
