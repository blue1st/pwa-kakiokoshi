const CACHE_NAME = 'kakiokoshi-v1';
const ASSETS = [
  './',
  'index.html',
  'favicon.svg',
  'manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Do not intercept or cache Hugging Face model weights in this Service Worker.
  // Transformers.js handles model caching inside its own indexedDB/Cache Storage.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Do not cache the service worker itself
  if (url.pathname.endsWith('sw.js')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch background update for stale-while-revalidate pattern
        fetch(e.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse));
          }
        }).catch(() => {/* Ignore errors */});
        return cachedResponse;
      }

      // If not in cache, fetch and dynamically cache the asset (like hashed JS/CSS files)
      return fetch(e.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Fallback for offline if fetching fails and no cache exists
      });
    })
  );
});
