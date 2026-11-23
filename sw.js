const CACHE_NAME = 'cantina-da-escola-shell-v8';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/styles.css',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './js/config.js',
  './js/api.js',
  './js/storage.js',
  './js/auth.js',
  './js/offline.js',
  './js/install-bridge.js',
  './js/install.js',
  './js/cash.js',
  './js/admin.js',
  './js/reports.js',
  './js/pdf-report.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Nunca armazenar chamadas da API nem respostas financeiras em cache.
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('.googleusercontent.com')) {
    return;
  }

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return caches.match('./index.html');
      }
      return new Response('Recurso indisponível offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'cantina-sync') {
    // A sincronização autenticada é iniciada pelo app quando ele está aberto.
    event.waitUntil(Promise.resolve());
  }
});
