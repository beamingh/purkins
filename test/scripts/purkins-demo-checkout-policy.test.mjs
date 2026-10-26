import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

describe('Purkins demo checkout server-side isolation', () => {
  it('requires explicit deployment opt-in (not the default rail)', () => {
    const policy = read('src/features/payments/demoPolicy.ts');
    const providers = read('src/features/payments/index.ts');
    expect(policy).toContain("value === 'true'");
    expect(policy).toContain('PURKINS_DEMO_CHECKOUT_ENABLED');
    expect(providers).toContain('demoEnabled = isDemoCheckoutEnabled()');
    expect(providers).toContain("if (off.has('demo') || !demoEnabled) return real");
    expect(providers).toContain("throw new Error('Public demo checkout is disabled.')");
  });

  it('never silently turns an explicit disabled demo attempt into a real charge', () => {
    const checkout = read('src/pages/api/checkout.ts');
    const direct = read('src/pages/checkout.astro');
    expect(checkout).toContain('if (requestedRaw && !available.includes(requested))');
    expect(checkout).toContain('Checkout is not available yet. No payment has been taken.');
    expect(checkout).toContain('if (requested && !available.includes(requested))');
    expect(direct).toContain('enabledMethods(Astro.locals.settings).includes(rail)');
  });

  it('rejects stale demo capability links before rendering or settlement', () => {
    const page = read('src/pages/pay/[publicId].astro');
    const settle = read('src/features/payments/checkout/settle.ts');
    expect(page).toContain('if (isDemo && (!isDemoCheckoutEnabled()');
    expect(page).toContain('status: 410');
    expect(settle).toContain('if (!isDemoCheckoutEnabled()');
    expect(settle).toContain('Demo checkout is disabled. No payment was taken.');
  });

  it('makes the Admin deployment lock explicit rather than showing a misleading enable switch', () => {
    const admin = read('src/pages/admin/settings.astro');
    expect(admin).toContain('isDemoCheckoutEnabled()');
    expect(admin).toContain('Deployment disabled');
    expect(admin).toContain('because it can reserve real stock');
  });

  it('keeps old snapshot tests isolated from live stock', () => {
    const baseline = read('test/integration/storefront-baselines.sh');
    expect(baseline).toContain('--var PURKINS_DEMO_CHECKOUT_ENABLED:true');
    expect(baseline).toContain('throwaway local D1');
  });

  it('still distinguishes simulated orders from real money', () => {
    const demo = read('src/features/payments/demo.ts');
    const cart = read('src/pages/cart.astro');
    expect(demo).toContain("backend: 'demo'");
    expect(demo).toContain("reservationId: params.metadata?.reservation_id ?? null");
    // The cart now offers genuine unpaid order requests while online payment is unavailable.
    // This replaced the older blanket "Checkout is currently unavailable" message.
    expect(cart).toContain('Online payment is not available yet. You can still submit an order request above.');
    expect(cart).toContain('href="/request-order"');
    expect(cart).not.toContain('always-on demo');
  });
});
