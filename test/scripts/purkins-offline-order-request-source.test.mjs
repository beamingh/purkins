import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../../' + path,import.meta.url),'utf8');

describe('Purkins trust-first COD and pay-later request source boundaries',()=>{
  it('stores unpaid requests separately from canonical paid orders',()=>{
    const sql=read('migrations/0055_purkins_order_requests.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS purkins_order_requests');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS purkins_order_request_items');
    expect(sql).toContain('payload_sha256');
    expect(sql).toContain('status IN (');
    expect(sql).not.toContain('INSERT INTO orders');
    const backend=read('src/features/purkins/orderRequestDb.ts');
    expect(backend).toContain('validateRequestCart(lines, subtotalCents)');
    expect(backend).toContain('ON CONFLICT(request_id) DO NOTHING');
    expect(backend).toContain('db.batch<');
    expect(backend).not.toMatch(/UPDATE products SET stock|UPDATE product_variants SET stock/);
    expect(backend).not.toMatch(/recordPaidOrder\(|recordManualSale\(/);
  });
  it('provides manual order requests from cart even when hosted payment is unavailable',()=>{
    const cart=read('src/pages/cart.astro');
    const request=read('src/pages/request-order.astro');
    const thanks=read('src/pages/request-order/thanks.astro');
    expect(cart).toContain('href="/request-order"');
    expect(request).toContain('parseOrderRequestForm(');
    expect(request).toContain('createOrderRequest(');
    expect(request).toContain('No payment is taken by this form.');
    expect(request).toContain('Delivery charges, if applicable, are NOT included.');
    expect(request).toContain('acknowledge');
    expect(thanks).toContain('not yet a confirmed purchase or paid order');
  });
  it('shows private follow-up work without creating fake paid transactions',()=>{
    const admin=read('src/pages/admin/order-requests/index.astro');
    const detail=read('src/pages/admin/order-requests/[id].astro');
    const endpoint=read('src/pages/api/admin/order-requests/[id].ts');
    const dashboard=read('src/pages/admin/index.astro');
    expect(admin).toContain('unpaid enquiries');
    expect(detail).toContain('No inventory has been reserved or deducted.');
    expect(detail).toContain('Record a verified paid manual sale');
    expect(endpoint).toContain('updateOrderRequestStatus(');
    expect(endpoint).not.toContain('recordManualSale(');
    expect(dashboard).toContain('openRequestCount');
  });
});
