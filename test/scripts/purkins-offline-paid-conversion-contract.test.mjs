import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
describe('Purkins paid conversion does not double count inventory or payments',()=>{
  it('links one immutable received-funds receipt to exactly one canonical order',()=>{
    const sql=read('migrations/0058_purkins_offline_settlements.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS purkins_offline_settlements');
    expect(sql).toContain('order_id INTEGER NOT NULL UNIQUE');
    expect(sql).toContain('purkins_block_release_paid_allocation');
    expect(sql).toContain('purkins_block_modify_offline_settlement');
    expect(sql).toContain('purkins_block_cancel_paid_request');
    expect(sql).toContain('purkins_guard_offline_settlement');
  });
  it('performs paid order, item, manual-sales metadata and receipt in one guarded transaction',()=>{
    const src=read('src/features/purkins/offlineSettlementDb.ts');
    expect(src).toContain('const results=await db.batch<');
    expect(src).toContain('INSERT INTO orders');
    expect(src).toContain('INSERT INTO order_items');
    expect(src).toContain('INSERT INTO order_item_ids');
    expect(src).toContain('INSERT INTO purkins_manual_sales');
    expect(src).toContain('INSERT INTO purkins_offline_settlements');
    expect(src).toContain('hold.quote_revision!==quote.revision');
    expect(src).not.toContain('SET stock=');
    expect(src).not.toContain('reserveInventory(');
    expect(src).not.toContain('recordManualSale(');
  });
  it('only permits owner-verified received money from Admin request screen',()=>{
    const page=read('src/pages/admin/order-requests/[id].astro');
    const endpoint=read('src/pages/api/admin/order-requests/[id].ts');
    expect(page).toContain('record_received_payment');
    expect(page).toContain('verified_received');
    expect(page).toContain('recipient_verified');
    expect(page).toContain('cash_counted');
    expect(page).toContain('isHeld && quote');
    expect(endpoint).toContain('parseOfflineSettlement(form)');
    expect(endpoint).toContain('settleHeldOfflineOrder(');
  });
});
