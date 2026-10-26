import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../../' + path,import.meta.url),'utf8');

describe('Purkins manual COD stock hold source contracts',()=>{
  it('stores held inventory separately from payments and protects cleanup',()=>{
    const sql=read('migrations/0057_purkins_offline_stock_allocations.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS purkins_order_request_allocations');
    expect(sql).toContain("status IN ('held','released')");
    expect(sql).toContain('purkins_block_cancel_held_request');
    expect(sql).toContain('purkins_block_quote_edit_with_hold');
    expect(sql).toContain('purkins_block_delete_product_with_hold');
    expect(sql).toContain('purkins_block_delete_variant_with_hold');
    expect(sql).not.toContain('INSERT INTO orders');
    expect(sql).not.toContain('UPDATE pending_payments');
  });
  it('only changes stock behind the durable hold idempotency guard',()=>{
    const source=read('src/features/purkins/offlineStockHoldDb.ts');
    expect(source).toContain('const result = await db.batch<');
    expect(source).toContain('const results=await db.batch<');
    expect(source).toContain("status='held' AND hold_nonce=?");
    expect(source).toContain('quoteRevision');
    expect(source).toContain('visibleStockChanged');
    expect(source).not.toContain('recordPaidOrder(');
    expect(source).not.toContain('recordManualSale(');
  });
  it('requires owner confirmation and blocks paid-sale double-decrement',()=>{
    const page=read('src/pages/admin/order-requests/[id].astro');
    const route=read('src/pages/api/admin/order-requests/[id].ts');
    expect(page).toContain('buyer_confirmed');
    expect(page).toContain('Allocate stock for this request');
    expect(page).toContain('Release held stock');
    expect(page).toContain('would deduct them a second time');
    expect(route).toContain("form.get('buyer_confirmed') !== 'yes'");
    expect(route).toContain('holdOfflineRequestStock(');
    expect(route).toContain('releaseOfflineRequestStock(');
    expect(route).not.toContain('recordManualSale(');
  });
});
