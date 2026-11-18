/* Price calculator offline shell only. Never cache private Admin pages,
 * inventory, customers, authentication responses, or other Admin APIs. */
const CACHE = 'purkins-pricing-v3';
const CALCULATOR = '/admin/price-calculator';
const OFFLINE = '/admin/price-calculator-offline';
const SHELL_ASSETS = [
  OFFLINE,
  '/admin/price-calculator-core.mjs',
  '/admin/price-calculator-history.mjs',
  '/admin/price-calculator-app.mjs',
  '/admin/price-calculator.webmanifest',
  '/admin/price-calculator-icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of SHELL_ASSETS) {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      // A login redirect or HTTP error is never safe to persist in the app shell.
      if (!response.ok || new URL(response.url).pathname !== path) {
        throw new Error('Offline asset unavailable: ' + path);
      }
      await cache.put(path, response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('purkins-pricing-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (SHELL_ASSETS.includes(url.pathname) && url.pathname !== OFFLINE) {
    event.respondWith(caches.match(url.pathname).then(cached => cached || fetch(request)));
    return;
  }

  // Network-first keeps online Admin login/session policies authoritative.
  // Only a network failure, not an HTTP error or redirect, permits offline shell.
  if (request.mode === 'navigate' &&
      [CALCULATOR, CALCULATOR + '/', OFFLINE, OFFLINE + '/'].includes(url.pathname)) {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch {
        return (await caches.match(OFFLINE)) ||
          new Response('Offline calculator has not yet been saved on this device.', { status: 503 });
      }
    })());
  }
});
