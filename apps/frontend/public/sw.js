/* Service worker for RemitX / AfroPay-Stellar frontend (Next.js).
 *
 * Strategy:
 *   - Precache the app shell on install (JS/CSS chunks + fonts are handled by
 *     Next's own runtime; we cache the critical shell + static assets).
 *   - Network-first for navigations so the app always serves fresh content
 *     when online and falls back to the cached shell when offline.
 *   - Stale-while-revalidate for `/_next/static/*` assets.
 *   - API calls (`/api/*`) are NOT cached — the offline queue handles
 *     business data, we never want stale financial data in a cache.
 *
 * Next.js emits hashed asset URLs, and `self.__NEXT_DATA__`-style URLs are
 * cheap to cache at runtime, so we precache the entry HTML plus a minimal
 * offline fallback and rely on runtime caching for the rest.
 */

const VERSION = 'remitx-sw-v1';
const STATIC_CACHE = `${VERSION}-static`;
const SHELL_CACHE = `${VERSION}-shell`;

const SHELL_URLS = ['/', '/login', '/transactions'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best-effort: pages may not all exist at install time (auth redirects).
      await Promise.allSettled(
        SHELL_URLS.map((url) =>
          fetch(url, { credentials: 'same-origin' })
            .then((res) => {
              if (res.ok) cache.put(url, res.clone());
            })
            .catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Never intercept API calls.
  if (url.pathname.startsWith('/api/')) return;

  // Only same-origin, http(s) requests.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first with offline shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          const cached = await cache.match('/');
          return (
            cached ||
            new Response(
              '<!doctype html><html><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0"><main style="text-align:center;padding:2rem"><h1 style="font-size:1.5rem">You are offline</h1><p>Reconnect to the internet to load RemitX.</p></main></body></html>',
              { headers: { 'content-type': 'text/html; charset=utf-8' } },
            )
          );
        }),
    );
    return;
  }

  // Static assets under /_next/static: stale-while-revalidate.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached || Response.error());
        return cached || network;
      })(),
    );
    return;
  }

  // Other same-origin static (favicon, images, fonts): cache-first.
  if (request.destination === 'image' || request.destination === 'font') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const network = await fetch(request);
        if (network.ok) cache.put(request, network.clone());
        return network;
      })(),
    );
  }
});