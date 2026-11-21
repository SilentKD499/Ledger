// ============================================================
//  sw.js — Service worker for Bhakta Mithai
//  Caches the app shell + CDN libraries so the app opens offline.
//  Never caches Supabase API calls (they must hit the network).
// ============================================================

const CACHE_NAME = 'bhakta-mithai-v4';   // bump this when you deploy changes
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './calculator.js',
  './sync-boot.js',
  // CDN libraries
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  // Google Fonts CSS (font files themselves cache on first use)
  'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,500;9..40,600;9..40,700&display=swap'
];

// ---- Install: pre-cache the app shell ----
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Individual adds so one 404 (e.g. calculator.js missing) doesn't block the rest
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] skip cache', url, err))
        )
      )
    )
  );
});

// ---- Activate: clean old caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ---- Fetch: cache-first, with network fallback ----
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Supabase API traffic — auth, RPC, and REST must be live
  if (url.hostname.endsWith('supabase.co')) return;

  // Don't try to cache blobs or data URIs
  if (url.protocol === 'blob:' || url.protocol === 'data:') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cache successful same/any-origin responses
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => {
        // Offline navigation → serve app shell
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

// ---- Allow app to force-update the SW ----
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
