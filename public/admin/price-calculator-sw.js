/* Purkins price calculator offline shell. Never cache authenticated Admin HTML,
 * inventory, customer information, or Admin APIs.
 *
 * An earlier service worker served an old cached calculator core alongside new
 * history/app modules, causing "does not provide an export" and a blank app.
 * This version refreshes the module set as a unit at install and goes
 * network-first while online, falling back to the matched offline cache only
 * when the network actually fails.
 */
const CACHE = 'purkins-pricing-v4';
const CALCULATOR = '/admin/price-calculator';
const OFFLINE = '/admin/price-calculator-offline';
const MODULES = [
  '/admin/price-calculator-core.mjs',
  '/admin/price-calculator-history.mjs',
  '/admin/price-calculator-app.mjs',
];
const PRECACHE = [OFFLINE, ...MODULES];

function isSafeAsset(response, path) {
  if (!response || !response.ok || response.redirected) return false;
  if (new URL(response.url).pathname !== path) return false;
  const type = response.headers.get('content-type') || '';
  if (MODULES.includes(path)) {
    return type.includes('javascript') || type.includes('ecmascript');
  }
  return type.includes('html');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Do not precache the manifest or icon. Auth-required manifest fetches can
    // redirect to Cloudflare Access, and must not block an offline core update.
    for (const path of PRECACHE) {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      if (!isSafeAsset(response, path)) throw new Error('Calculator offline asset unavailable: ' + path);
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

  if (MODULES.includes(url.pathname)) {
    // Never cache-first for modules: old core + new history crashes the app.
    // A redirect or HTTP error (including an expired Access session) is not
    // an offline failure and must never be cached or masked.
    event.respondWith((async () => {
      let response;
      try {
        response = await fetch(request);
      } catch {
        return (await caches.match(url.pathname)) ||
          new Response('Offline calculator module is unavailable.', { status: 503 });
      }
      if (isSafeAsset(response, url.pathname)) {
        // A full browser quota must not turn a successful online fetch into
        // a fallback to a stale cached script.
        try {
          const cache = await caches.open(CACHE);
          await cache.put(url.pathname, response.clone());
        } catch { /* Online code still runs when browser storage is full. */ }
      }
      return response;
    })());
    return;
  }

  // Network-first preserves the live Admin login/session gate. Only an
  // actual connection failure allows the generic, non-private offline shell.
  if (request.mode === 'navigate' &&
      [CALCULATOR, CALCULATOR + '/', OFFLINE, OFFLINE + '/'].includes(url.pathname)) {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch {
        return (await caches.match(OFFLINE)) ||
          new Response('Offline calculator is not yet cached on this device.', { status: 503 });
      }
    })());
  }
});
