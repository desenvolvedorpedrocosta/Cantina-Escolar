/* CANTINA DA ESCOLA — SERVICE WORKER */
const CACHE_PREFIX = 'cantina-da-escola-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v15';

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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Um único recurso ausente não deve impedir a atualização do Service Worker.
    const resultados = await Promise.allSettled(
      SHELL_FILES.map((arquivo) => cache.add(new Request(arquivo, { cache: 'reload' })))
    );

    const falhas = resultados
      .map((resultado, indice) => resultado.status === 'rejected' ? SHELL_FILES[indice] : null)
      .filter(Boolean);

    if (falhas.length) {
      console.warn('Cantina da Escola: alguns recursos não entraram no cache:', falhas);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(
      chaves
        .filter((chave) => chave.startsWith(CACHE_PREFIX) && chave !== CACHE_NAME)
        .map((chave) => caches.delete(chave))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // A API financeira nunca é armazenada no cache do PWA.
  if (
    url.hostname === 'script.google.com' ||
    url.hostname === 'script.googleusercontent.com' ||
    url.hostname.endsWith('.googleusercontent.com')
  ) return;

  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const resposta = await fetch(request);
      if (resposta && resposta.ok) {
        const copia = resposta.clone();
        caches.open(CACHE_NAME)
          .then((cache) => cache.put(request, copia))
          .catch((erro) => console.warn('Não foi possível atualizar o cache da Cantina:', erro));
      }
      return resposta;
    } catch (erroRede) {
      const armazenada = await caches.match(request, { ignoreSearch: true });
      if (armazenada) return armazenada;

      if (request.mode === 'navigate') {
        const inicio = await caches.match('./index.html');
        if (inicio) return inicio;
      }

      return new Response('Recurso indisponível offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'cantina-sync') {
    // A sincronização autenticada é iniciada pelo app quando ele está aberto.
    event.waitUntil(Promise.resolve());
  }
});
