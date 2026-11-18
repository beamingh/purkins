/* Purkins offline pricing is deliberately isolated from the admin dashboard.
 * Never cache a response to an authenticated /admin page, customer information,
 * product inventory, or any other Admin API. Only this generic offline shell
 * and the pure calculator module are stored for offline reopening.
 */
const CACHE = 'purkins-pricing-v1';
const CALCULATOR = '/admin/price-calculator';
const OFFLINE = '/admin/price-calculator-offline';
const CORE = '/admin/price-calculator-core.mjs';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of [OFFLINE, CORE]) {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok || new URL(response.url).pathname !== path) {
        throw new Error('Purkins offline asset was not available: ' + path);
      }
      await cache.put(path, response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('purkins-pricing-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === CORE) {
    event.respondWith(caches.match(CORE).then((cached) => cached || fetch(request)));
    return;
  }

  // Network-first preserves the normal admin session/login gate when online.
  // Only a failed network request, never an HTTP 401/redirect, enables fallback.
  if (request.mode === 'navigate' &&
      (url.pathname === CALCULATOR || url.pathname === CALCULATOR + '/' ||
        url.pathname === OFFLINE || url.pathname === OFFLINE + '/')) {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match(OFFLINE)) ||
          new Response('Price calculator is not cached yet.', { status: 503 });
      }
    })());
  }
});
