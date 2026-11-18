const CACHE_NAME = 'grimoire-shell-v3';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/text-utils.js',
  '/js/analysis.js',
  '/js/db.js',
  '/js/parsers.js',
  '/js/pwa.js',
  '/js/app.js',
  '/vendor/jszip.min.js',
  '/vendor/epub.min.js',
  '/vendor/pdf.min.js',
  '/vendor/pdf.worker.min.js',
  '/icons/icon.svg',
  '/icons/pwa-192x192.png',
  '/icons/pwa-512x512.png',
  '/icons/pwa-maskable-512x512.png',
  '/icons/apple-touch-icon.png'
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

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then((cached) => {
        const networkPromise = fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/index.html', copy));
          }
          return res;
        }).catch(() => cached);
        return cached || networkPromise;
      })
    );
    return;
  }

  if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/')) {
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
