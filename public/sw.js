const CACHE_NAME = 'grimoire-shell-v5';
const INDEX_URL = new URL('./index.html', self.location.href).href;
const SCOPE_PATH = new URL('./', self.location.href).pathname;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/text-utils.js',
  './js/analysis.js',
  './js/db.js',
  './js/parsers.js',
  './js/pwa.js',
  './js/app.js',
  './vendor/jszip.min.js',
  './vendor/epub.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './icons/icon.svg',
  './icons/pwa-192x192.png',
  './icons/pwa-512x512.png',
  './icons/pwa-maskable-512x512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(INDEX_URL, copy));
        }
        return res;
      }).catch(() => caches.match(INDEX_URL))
    );
    return;
  }

  if (
    url.pathname.startsWith(SCOPE_PATH + 'vendor/') ||
    url.pathname.startsWith(SCOPE_PATH + 'icons/')
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
