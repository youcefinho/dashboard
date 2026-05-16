// ── Service Worker — Intralys CRM ──
// Sprint 23 wave 14 (2026-05-13) — bump v2 + skip dev + skip JS/CSS/HTML pour HMR
// Sprint 44 M2.4 (2026-05-15) — bump v3 + SKIP_WAITING handler (live update prompt)
//
// Stratégie :
//   - JS / CSS / HTML : network-first (jamais cache-first) — sinon les déploiements
//     prennent jusqu'à 24h à se propager et HMR dev est cassé
//   - Images / fonts / icons : cache-first (assets immuables versionnés par Vite hash)
//   - API : pas du tout interceptée

const CACHE_NAME = 'intralys-crm-v3';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/favicon.svg',
];

// Extensions où on évite cache-first (sinon CSS/JS ne refresh jamais)
const NEVER_CACHE_FIRST = /\.(html|css|js|mjs|json|map)(\?.*)?$/i;
// Extensions où cache-first est OK (immuables, versionnées par hash Vite)
const CACHEABLE_ASSETS = /\.(png|jpg|jpeg|svg|webp|gif|ico|woff|woff2|ttf|eot)(\?.*)?$/i;

// Installation : pré-cache des assets statiques
// Sprint 44 M2.4 — NE PAS appeler self.skipWaiting() automatiquement : on veut
// que l'app demande à l'user de recharger via le SwUpdatePrompt. Le skip se fait
// désormais via message SKIP_WAITING (ci-dessous).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// Sprint 44 M2.4 — Handler SKIP_WAITING : déclenché par useSwUpdate() côté app
// quand l'user clique "Recharger" sur le toast "Mise à jour disponible".
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activation : nettoyage de TOUS les anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API : toujours réseau (pas d'interception)
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;

  // JS/CSS/HTML/JSON → network-first (fallback cache si offline uniquement)
  if (NEVER_CACHE_FIRST.test(url.pathname) || url.pathname === '/' || !url.pathname.includes('.')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((c) => c || caches.match('/')))
    );
    return;
  }

  // Images / fonts → cache-first (immuables)
  if (CACHEABLE_ASSETS.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
