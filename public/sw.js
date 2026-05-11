// ── Service Worker — Intralys CRM (Cache-first pour assets, Network-first pour API) ──

const CACHE_NAME = 'intralys-crm-v1';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/favicon.svg',
];

// Installation : pré-cache des assets statiques
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activation : nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie : Network-first pour API, Cache-first pour assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API : toujours réseau
  if (url.pathname.startsWith('/api/')) return;

  // Assets statiques : cache-first
  if (event.request.method === 'GET') {
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
      }).catch(() => caches.match('/'))
    );
  }
});
