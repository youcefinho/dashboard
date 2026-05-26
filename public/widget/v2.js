/**
 * Intralys Webchat Widget v2
 * - Pre-fetch config (color, position, welcome, agent_presence) via /api/webchat/widget.js?meta=1
 * - Iframe sandboxée pointant vers frame-v2.html
 * - postMessage strict (origin = apiBase)
 * - Reconnect exponential backoff visible via presence chip
 * - Zéro dep, IIFE, modern browsers
 * - Coexiste avec v1.js (namespace __intralys_webchat_v2)
 */
(function () {
  'use strict';
  if (window.__intralys_webchat_v2) return;
  window.__intralys_webchat_v2 = true;

  // ── 1. Resolve script tag + attributes ────────────────────────────────────
  var scriptTag =
    document.currentScript ||
    document.querySelector('script[src*="v2.js"]');
  if (!scriptTag) {
    console.error('[intralys-v2] script tag introuvable');
    return;
  }
  var clientId = scriptTag.getAttribute('data-client');
  if (!clientId) {
    console.error('[intralys-v2] data-client manquant');
    return;
  }
  var positionAttr = scriptTag.getAttribute('data-position') || 'bottom-right';
  var colorAttr = scriptTag.getAttribute('data-color') || '';

  var srcUrl;
  try {
    srcUrl = new URL(scriptTag.getAttribute('src') || '', window.location.href);
  } catch (_) {
    srcUrl = { origin: window.location.origin };
  }
  var apiBase = srcUrl.origin;

  // ── 2. Defaults / fallback config ─────────────────────────────────────────
  var DEFAULTS = {
    color: '#3b82f6',
    position: 'bottom-right',
    welcome_message: 'Bonjour',
    agent_presence: 'online', // 'online' | 'offline'
    agency_name: 'Support',
    turnstile_enabled: false,
  };

  var POSITIONS = {
    'bottom-right': { bottom: '20px', right: '20px', top: 'auto', left: 'auto' },
    'bottom-left': { bottom: '20px', left: '20px', top: 'auto', right: 'auto' },
    'top-right': { top: '20px', right: '20px', bottom: 'auto', left: 'auto' },
    'top-left': { top: '20px', left: '20px', bottom: 'auto', right: 'auto' },
  };

  // ── 3. Utils ──────────────────────────────────────────────────────────────
  function safeHex(c) {
    return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : null;
  }

  function pickPosition(p) {
    return POSITIONS[p] ? p : 'bottom-right';
  }

  function el(tag, attrs, styles) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (styles) {
      for (var s in styles) {
        if (Object.prototype.hasOwnProperty.call(styles, s)) {
          node.style[s] = styles[s];
        }
      }
    }
    return node;
  }

  // ── 4. Fetch config (best-effort) ─────────────────────────────────────────
  function fetchConfig() {
    var url =
      apiBase +
      '/api/webchat/widget.js?client_id=' +
      encodeURIComponent(clientId) +
      '&meta=1';
    return fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('config ' + r.status);
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('json') === -1) throw new Error('non-json config');
        return r.json();
      })
      .then(function (raw) {
        var d = (raw && (raw.data || raw)) || {};
        return {
          color: safeHex(colorAttr) || safeHex(d.color) || DEFAULTS.color,
          position: pickPosition(positionAttr) === 'bottom-right' && d.position
            ? pickPosition(d.position)
            : pickPosition(positionAttr),
          welcome_message:
            (typeof d.welcome_message === 'string' && d.welcome_message) ||
            DEFAULTS.welcome_message,
          agent_presence:
            d.agent_presence === 'offline' ? 'offline' : 'online',
          agency_name:
            (typeof d.agency_name === 'string' && d.agency_name) ||
            DEFAULTS.agency_name,
          turnstile_enabled: d.turnstile_enabled === true,
        };
      })
      .catch(function () {
        return {
          color: safeHex(colorAttr) || DEFAULTS.color,
          position: pickPosition(positionAttr),
          welcome_message: DEFAULTS.welcome_message,
          agent_presence: DEFAULTS.agent_presence,
          agency_name: DEFAULTS.agency_name,
          turnstile_enabled: false,
        };
      });
  }

  // ── 5. Mount widget once config resolved ──────────────────────────────────
  fetchConfig().then(function (cfg) {
    mount(cfg);
  });

  function mount(cfg) {
    var pos = POSITIONS[cfg.position];

    // Styles scoped (no leak — IDs prefixed __ix2)
    var style = document.createElement('style');
    style.id = '__ix2-style';
    style.textContent =
      '#__ix2-bubble{position:fixed;width:60px;height:60px;border-radius:50%;' +
      'background:' + cfg.color + ';color:#fff;border:none;cursor:pointer;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.18);z-index:2147483647;' +
      'display:flex;align-items:center;justify-content:center;' +
      'transition:transform .2s ease,box-shadow .2s ease}' +
      '#__ix2-bubble:hover{transform:scale(1.08)}' +
      '#__ix2-bubble:focus{outline:2px solid #fff;outline-offset:3px}' +
      '#__ix2-chip{position:fixed;height:22px;padding:0 8px;border-radius:11px;' +
      'background:#fff;color:#0f172a;font:500 11px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:2147483647;' +
      'display:flex;align-items:center;gap:5px;pointer-events:none;' +
      'transform:translateY(-6px);white-space:nowrap}' +
      '#__ix2-chip .dot{width:7px;height:7px;border-radius:50%;display:inline-block}' +
      '#__ix2-chip.online .dot{background:#16a34a;box-shadow:0 0 0 2px rgba(22,163,74,.18)}' +
      '#__ix2-chip.offline .dot{background:#94a3b8}' +
      '#__ix2-chip.reconnecting .dot{background:#f59e0b;animation:__ix2pulse 1s ease-in-out infinite}' +
      '@keyframes __ix2pulse{0%,100%{opacity:1}50%{opacity:.35}}' +
      '#__ix2-iframe{position:fixed;width:380px;height:600px;max-height:calc(100vh - 120px);' +
      'border:0;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.22);' +
      'z-index:2147483647;display:none;background:#fff;' +
      'transition:opacity .25s ease,transform .25s ease;' +
      'opacity:0;transform:translateY(10px);pointer-events:none}' +
      '#__ix2-iframe.open{display:block;opacity:1;transform:translateY(0);pointer-events:auto}' +
      '@media (max-width:480px){#__ix2-iframe{width:calc(100vw - 24px);height:calc(100vh - 100px);' +
      'right:12px!important;left:12px!important;bottom:80px!important;top:auto!important}}';
    document.head.appendChild(style);

    // Bubble
    var bubble = el('button', {
      id: '__ix2-bubble',
      type: 'button',
      'aria-label': 'Ouvrir le chat',
      'aria-expanded': 'false',
    }, pos);
    bubble.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    document.body.appendChild(bubble);

    // Presence chip (positioned next to bubble — above for bottom-*, below for top-*)
    var chip = el('div', { id: '__ix2-chip' });
    chip.className = cfg.agent_presence === 'offline' ? 'offline' : 'online';
    chip.innerHTML =
      '<span class="dot"></span><span class="label">' +
      (cfg.agent_presence === 'offline' ? 'Hors-ligne' : 'En ligne') +
      '</span>';
    positionChip(chip, cfg.position);
    document.body.appendChild(chip);

    // Iframe — lazily created on first open to save bandwidth
    var iframe = null;
    var isOpen = false;

    function ensureIframe() {
      if (iframe) return iframe;
      iframe = el('iframe', {
        id: '__ix2-iframe',
        title: 'Chat en direct',
        sandbox: 'allow-scripts allow-same-origin allow-forms',
        src:
          apiBase +
          '/widget/frame-v2.html?client=' +
          encodeURIComponent(clientId) +
          '&color=' +
          encodeURIComponent(cfg.color) +
          '&welcome=' +
          encodeURIComponent(cfg.welcome_message) +
          '&agency=' +
          encodeURIComponent(cfg.agency_name) +
          '&presence=' +
          encodeURIComponent(cfg.agent_presence) +
          (cfg.turnstile_enabled ? '&turnstile=1' : ''),
      }, pos);
      // Iframe sits above bubble (offset 70px)
      adjustIframePosition(iframe, cfg.position);
      document.body.appendChild(iframe);
      return iframe;
    }

    function toggle(open) {
      isOpen = typeof open === 'boolean' ? open : !isOpen;
      var fr = ensureIframe();
      if (isOpen) {
        fr.classList.add('open');
        bubble.setAttribute('aria-expanded', 'true');
        chip.style.display = 'none';
      } else {
        fr.classList.remove('open');
        bubble.setAttribute('aria-expanded', 'false');
        chip.style.display = 'flex';
      }
    }

    bubble.addEventListener('click', function () { toggle(); });

    // ── postMessage strict ──────────────────────────────────────────────────
    // n'accepter QUE les messages dont event.origin === apiBase
    window.addEventListener('message', function (event) {
      if (event.origin !== apiBase) return;
      var data = event.data;
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'webchat.close':
          toggle(false);
          break;
        case 'webchat.presence':
          updatePresence(data.presence);
          break;
        case 'webchat.ws.state':
          // 'open' | 'reconnecting' | 'closed' — pour visualiser le backoff
          setChipState(data.state);
          break;
        default:
          break;
      }
    });

    function updatePresence(p) {
      var state = p === 'offline' ? 'offline' : 'online';
      chip.className = state;
      var labelEl = chip.querySelector('.label');
      if (labelEl) {
        labelEl.textContent = state === 'offline' ? 'Hors-ligne' : 'En ligne';
      }
    }

    function setChipState(state) {
      if (state === 'reconnecting') {
        chip.className = 'reconnecting';
        var l = chip.querySelector('.label');
        if (l) l.textContent = 'Reconnexion…';
      } else if (state === 'open') {
        updatePresence('online');
      } else if (state === 'closed') {
        updatePresence('offline');
      }
    }
  }

  // ── 6. Position helpers ─────────────────────────────────────────────────────
  function positionChip(chip, position) {
    // Chip floats slightly above (or below) bubble + offset horizontalement
    if (position.indexOf('bottom') === 0) {
      chip.style.bottom = '88px';
    } else {
      chip.style.top = '88px';
    }
    if (position.indexOf('right') !== -1) {
      chip.style.right = '20px';
    } else {
      chip.style.left = '20px';
    }
  }

  function adjustIframePosition(iframe, position) {
    // Iframe ouvre offset 70px du bord (au-dessus du bubble pour bottom-*)
    if (position.indexOf('bottom') === 0) {
      iframe.style.bottom = '90px';
      iframe.style.top = 'auto';
    } else {
      iframe.style.top = '90px';
      iframe.style.bottom = 'auto';
    }
    if (position.indexOf('right') !== -1) {
      iframe.style.right = '20px';
      iframe.style.left = 'auto';
    } else {
      iframe.style.left = '20px';
      iframe.style.right = 'auto';
    }
  }
})();
