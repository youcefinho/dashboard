// ── Deep Links — Sprint 44 M1.4 ──────────────────────────────────
// Gère :
//   1. Schemes natifs : `intralys://leads/:id`, `intralys://inbox/:convId`,
//      `intralys://tasks/:id`, `intralys://calendar/:apptId`, etc.
//   2. Universal links : `https://crm.intralys.com/leads/:id` etc.
//      (iOS associated domains + Android intent filters → ouvrent l'app
//      au lieu du navigateur quand l'app est installée).
//
// Architecture :
//   - `initDeepLinks()` à appeler depuis main.tsx (initCapacitorLifecycle)
//     → registre le listener Capacitor App.appUrlOpen + buffer initial URL.
//   - `consumeDeepLink(navigate)` à appeler depuis AppLayout après mount
//     → drain le buffer + route via TanStack. Idempotent.
//
// Le pattern buffer est nécessaire car l'event peut arriver AVANT que
// le RouterProvider soit mounté (cold start app via deep link).

import { Capacitor } from '@capacitor/core';

type NavigateFn = (opts: { to: string; search?: Record<string, unknown> }) => void | Promise<void>;

// ── URL parsing ──────────────────────────────────────────────────────

const SCHEME_NATIVE = 'intralys://';
const HOST_UNIVERSAL = 'crm.intralys.com';

/**
 * Convertit une URL deep-link (native scheme ou universal link) en route
 * TanStack. Retourne `null` si l'URL n'est pas reconnue.
 *
 * Exemples :
 *   intralys://leads/lead_abc123     → { to: '/leads/lead_abc123' }
 *   intralys://inbox/conv_xyz        → { to: '/conversations', search: { conv: 'conv_xyz' } }
 *   intralys://tasks/task_42         → { to: '/tasks', search: { focus: 'task_42' } }
 *   intralys://calendar/appt_99      → { to: '/calendar', search: { focus: 'appt_99' } }
 *   https://crm.intralys.com/leads/x → { to: '/leads/x' }
 */
export function parseDeepLink(rawUrl: string): { to: string; search?: Record<string, unknown> } | null {
  if (!rawUrl) return null;

  // ── Native scheme intralys://path?query ───────────────────────────
  if (rawUrl.startsWith(SCHEME_NATIVE)) {
    const rest = rawUrl.slice(SCHEME_NATIVE.length);
    // Format : `host/path?query` ou `path?query` (Capacitor remonte les deux)
    // On normalise en `/host/path`
    let pathAndQuery = rest;
    if (!pathAndQuery.startsWith('/')) pathAndQuery = '/' + pathAndQuery;

    try {
      // URL constructor requiert un base host — on en fournit un fake
      const u = new URL(pathAndQuery, 'https://internal/');
      return routeFromPath(u.pathname, u.search);
    } catch { return null; }
  }

  // ── Universal link https://crm.intralys.com/path?query ────────────
  try {
    const u = new URL(rawUrl);
    if (u.host === HOST_UNIVERSAL || u.host === `www.${HOST_UNIVERSAL}`) {
      return routeFromPath(u.pathname, u.search);
    }
  } catch { /* not a valid absolute URL — try relative */ }

  // ── Fallback : URL relative (ex: "/leads/x" envoyé directement) ──
  if (rawUrl.startsWith('/')) {
    try {
      const u = new URL(rawUrl, 'https://internal/');
      return routeFromPath(u.pathname, u.search);
    } catch { return null; }
  }

  return null;
}

/**
 * Convertit `pathname` (+ optional querystring) en route TanStack.
 * Gère les patterns Intralys spécifiques (inbox → /conversations + search.conv).
 */
function routeFromPath(pathname: string, search: string = ''): { to: string; search?: Record<string, unknown> } | null {
  if (!pathname || pathname === '/') return { to: '/dashboard' };

  // Normalize trailing slash
  const path = pathname.replace(/\/+$/, '') || '/';
  const params = parseSearch(search);

  // Patterns spéciaux : raccourcis natifs ne matchent pas 1:1 les routes web
  // intralys://inbox/:convId → /conversations?conv=:convId
  const inboxMatch = /^\/inbox\/([^/]+)$/.exec(path);
  if (inboxMatch && inboxMatch[1]) {
    return { to: '/conversations', search: { ...params, conv: inboxMatch[1] } };
  }
  if (path === '/inbox') {
    return { to: '/conversations', search: params };
  }

  // intralys://tasks/:taskId → /tasks?focus=:id
  const taskMatch = /^\/tasks\/([^/]+)$/.exec(path);
  if (taskMatch && taskMatch[1]) {
    return { to: '/tasks', search: { ...params, focus: taskMatch[1] } };
  }

  // intralys://calendar/:apptId → /calendar?focus=:id
  const calMatch = /^\/calendar\/([^/]+)$/.exec(path);
  if (calMatch && calMatch[1]) {
    return { to: '/calendar', search: { ...params, focus: calMatch[1] } };
  }

  // intralys://leads/:id → /leads/:id (route directe)
  // intralys://workflows/:id, /reviews, /reports, etc. → route directe

  // Pour toutes les autres URLs : on suppose que le path web matche le path natif.
  const result: { to: string; search?: Record<string, unknown> } = { to: path };
  if (Object.keys(params).length > 0) result.search = params;
  return result;
}

function parseSearch(searchStr: string): Record<string, unknown> {
  if (!searchStr) return {};
  const out: Record<string, unknown> = {};
  try {
    const sp = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr);
    for (const [k, v] of sp.entries()) out[k] = v;
  } catch { /* ignore */ }
  return out;
}

// ── Buffer + listener init ───────────────────────────────────────────

const _buffer: string[] = [];
let _consumer: NavigateFn | null = null;
let _wired = false;

/**
 * À appeler depuis `initCapacitorLifecycle()` au boot natif.
 * Wire le listener Capacitor App.appUrlOpen + capture l'URL de lancement
 * (deep link cold start). Toutes les URLs sont bufferisées jusqu'à
 * `consumeDeepLink(navigate)` mounté.
 */
export async function initDeepLinks(): Promise<void> {
  if (_wired) return;
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { App: CapApp } = await import('@capacitor/app');

    // 1. Récupérer l'URL qui a lancé l'app (cold start via deep link)
    try {
      const launch = await CapApp.getLaunchUrl();
      if (launch?.url) _enqueue(launch.url);
    } catch { /* getLaunchUrl pas dispo / pas de launch url → ok */ }

    // 2. Listener pour les deep links arrivant pendant que l'app tourne
    await CapApp.addListener('appUrlOpen', (event) => {
      if (event?.url) _enqueue(event.url);
    });

    _wired = true;
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[deepLinks] initDeepLinks skipped:', err);
    }
  }
}

function _enqueue(url: string): void {
  if (_consumer) {
    const route = parseDeepLink(url);
    if (route) void _consumer(route);
  } else {
    _buffer.push(url);
  }
}

/**
 * À appeler depuis AppLayout (ou autre composant avec navigate). Drain le
 * buffer initial + s'enregistre comme consumer pour les futures URLs.
 * Idempotent : appels multiples réécrivent le consumer (toujours le navigate
 * le plus récent, typiquement après auth).
 */
export function consumeDeepLink(navigate: NavigateFn): void {
  _consumer = navigate;
  // Drain le buffer
  while (_buffer.length > 0) {
    const url = _buffer.shift()!;
    const route = parseDeepLink(url);
    if (route) void navigate(route);
  }
}

/**
 * Test helper — reset state interne. Usage tests unitaires uniquement.
 * @internal
 */
export function _resetDeepLinksForTest(): void {
  _buffer.length = 0;
  _consumer = null;
  _wired = false;
}
