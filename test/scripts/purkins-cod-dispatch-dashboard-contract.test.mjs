import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

describe('Purkins courier dispatch dashboard contracts',()=>{
  it('joins only existing private D1 tables and never changes sales/stock',()=>{
    const source=read('src/features/purkins/dispatchOverview.ts');
    expect(source).toContain('purkins_order_request_allocations');
    expect(source).toContain('purkins_request_deliveries');
    expect(source).toContain('purkins_offline_settlements');
    expect(source).toContain('orders o ON o.id=s.order_id');
    expect(source).toContain('LIMIT 251');
    expect(source).not.toContain('INSERT INTO');
    expect(source).not.toContain('UPDATE orders');
    expect(source).not.toContain('SET stock=');
  });
  it('shows customer-facing receipt separate from rider-reported delivery',()=>{
    const source=read('src/features/purkins/dispatchOverview.ts');
    const page=read('src/pages/admin/order-requests/dispatch.astro');
    expect(source).toContain('not recorded verified payment');
    expect(source).not.toContain("UPDATE purkins_offline_settlements");
    expect(page).toContain('Dispatch and delivery are not proof of payment');
    expect(page).toContain('Payment not recorded');
    expect(page).toContain('Courier fee');
    expect(page).toContain('/admin/order-requests/');
  });
  it('links dashboard from authenticated Admin surfaces only',()=>{
    for(const path of [
      'src/pages/admin/index.astro',
      'src/pages/admin/orders/index.astro',
      'src/pages/admin/order-requests/index.astro',
    ]) {
      expect(read(path)).toContain('/admin/order-requests/dispatch');
    }
  });
});
