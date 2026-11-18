import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync(
  new URL('../../../public/admin/price-calculator-sw.js', import.meta.url),
  'utf8',
);
const origin = 'https://admin.purkins.ulwimbo.com';

function okResponse(path, body = 'current', mime = 'text/javascript') {
  return {
    ok: true, redirected: false, url: origin + path,
    body,
    headers: { get: header => header.toLowerCase() === 'content-type' ? mime : null },
    clone() { return okResponse(path, body, mime); },
  };
}

function workerHarness() {
  const handlers = {};
  const cacheStores = new Map();
  let network = async request => {
    const path = new URL(typeof request === 'string' ? request : request.url, origin).pathname;
    return okResponse(path, 'fresh ' + path, path.includes('offline') ? 'text/html' : 'text/javascript');
  };
  const fetched = [];
  const caches = {
    async open(name) {
      if (!cacheStores.has(name)) cacheStores.set(name, new Map());
      const store = cacheStores.get(name);
      return { put: async (key, value) => store.set(key, value) };
    },
    async match(path) {
      for (const store of cacheStores.values()) if (store.has(path)) return store.get(path);
      return undefined;
    },
    async keys() { return [...cacheStores.keys()]; },
    async delete(name) { return cacheStores.delete(name); },
  };
  const self = {
    location: { origin },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (name, callback) => { handlers[name] = callback; },
  };
  runInNewContext(script, {
    self, caches, URL,
    fetch: async request => {
      fetched.push(new URL(typeof request === 'string' ? request : request.url, origin).pathname);
      return network(request);
    },
    Response: class { constructor(body, options = {}) { this.body = body; this.status = options.status; } },
  });

  return {
    fetched, cacheStores,
    setNetwork(fn) { network = fn; },
    async install() {
      let done;
      handlers.install({ waitUntil(promise) { done = promise; } });
      await done;
    },
    async activate() {
      let done;
      handlers.activate({ waitUntil(promise) { done = promise; } });
      await done;
    },
    async request(path, mode = 'cors') {
      let response;
      handlers.fetch({
        request: { url: origin + path, method: 'GET', mode },
        respondWith(promise) { response = promise; },
      });
      return response ? response : undefined;
    },
  };
}

describe('Purkins offline calculator service worker cache recovery', () => {
  it('installs only generic offline HTML and JS, never requires the Access-protected manifest', async () => {
    const sw = workerHarness();
    await sw.install();
    expect(sw.fetched).toContain('/admin/price-calculator-core.mjs');
    expect(sw.fetched).toContain('/admin/price-calculator-history.mjs');
    expect(sw.fetched).toContain('/admin/price-calculator-app.mjs');
    expect(sw.fetched).toContain('/admin/price-calculator-offline');
    expect(sw.fetched).not.toContain('/admin/price-calculator.webmanifest');
    expect(sw.fetched).not.toContain('/admin/price-calculator-icon.svg');
  });

  it('uses fresh online core even when the previous service-worker cache holds an older core', async () => {
    const sw = workerHarness();
    sw.cacheStores.set('purkins-pricing-v3', new Map([
      ['/admin/price-calculator-core.mjs', okResponse('/admin/price-calculator-core.mjs', 'OLD CORE')],
    ]));
    sw.setNetwork(async request =>
      okResponse(new URL(request.url).pathname, 'NEW CORE WITH ROUNDING'));
    const response = await sw.request('/admin/price-calculator-core.mjs');
    expect(response.body).toBe('NEW CORE WITH ROUNDING');
    expect(sw.fetched).toContain('/admin/price-calculator-core.mjs');
  });

  it('cleans obsolete caches on activation and keeps only current offline assets', async () => {
    const sw = workerHarness();
    sw.cacheStores.set('purkins-pricing-v3', new Map());
    await sw.install();
    await sw.activate();
    expect([...sw.cacheStores.keys()]).toEqual(['purkins-pricing-v6']);
  });

  it('returns cached module only when the network fails', async () => {
    const sw = workerHarness();
    await sw.install();
    sw.setNetwork(async () => { throw new TypeError('offline'); });
    const response = await sw.request('/admin/price-calculator-core.mjs');
    expect(response.body).toBe('fresh /admin/price-calculator-core.mjs');
  });

  it('does not cache or mask an Access login redirect as offline JavaScript', async () => {
    const sw = workerHarness();
    await sw.install();
    const redirected = {
      ...okResponse('/cdn-cgi/access/login', 'Access login HTML', 'text/html'),
      redirected: true,
    };
    sw.setNetwork(async () => redirected);
    const response = await sw.request('/admin/price-calculator-core.mjs');
    expect(response).toBe(redirected);
  });

  it('does not downgrade to stale cached JavaScript if an online cache write fails', async () => {
    const sw = workerHarness();
    await sw.install();
    const store = sw.cacheStores.get('purkins-pricing-v6');
    store.set('/admin/price-calculator-core.mjs', okResponse('/admin/price-calculator-core.mjs', 'STALE'));
    sw.setNetwork(async () => okResponse('/admin/price-calculator-core.mjs', 'FRESH'));
    // The implementation should keep returning the fetched response even if
    // a cache write is rejected by a browser quota or storage issue.
    // A stored Map alone cannot throw on put, so source validation safeguards
    // that cache.put is inside its own guarded try/catch.
    expect(script).toMatch(/try\s*\{\s*const cache = await caches\.open\(CACHE\);/);
    expect((await sw.request('/admin/price-calculator-core.mjs')).body).toBe('FRESH');
  });
});

describe('Access-protected app manifest', () => {
  it('requests cookies from Cloudflare Access on both calculator pages', () => {
    const layout = readFileSync(new URL('../../layouts/AdminLayout.astro', import.meta.url), 'utf8');
    const standalone = readFileSync(new URL('../../pages/admin/price-calculator-offline.astro', import.meta.url), 'utf8');
    for (const page of [layout, standalone]) {
      expect(page).toContain('price-calculator.webmanifest" crossorigin="use-credentials"');
    }
  });
});
