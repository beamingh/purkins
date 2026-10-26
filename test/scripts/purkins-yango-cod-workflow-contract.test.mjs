import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

describe('Purkins Facebook/Marketplace COD logistics contracts',()=>{
  it('uses the same D1-priced unpaid request builder for Admin social orders',()=>{
    const api=read('src/pages/api/admin/order-requests/new.ts');
    const page=read('src/pages/admin/order-requests/new.astro');
    expect(api).toContain('resolveCart(env.DB,cart)');
    expect(api).toContain('createOrderRequest(env.DB,fields,lines,subtotalCents)');
    expect(api).toContain('customer_contacted');
    expect(api).not.toContain('recordManualSale(');
    expect(api).not.toContain('recordPaidOrder(');
    expect(page).toContain('source_channel');
    expect(page).toContain('facebook_page');
    expect(page).toContain('Create unpaid request');
  });
  it('keeps courier tracking and separate-to-Yango fees outside paid accounting',()=>{
    const sql=read('migrations/0059_purkins_cod_delivery_log.sql');
    const core=read('src/features/purkins/courierDeliveryDb.ts');
    expect(sql).toContain('purkins_request_deliveries');
    expect(sql).toContain('purkins_request_delivery_events');
    expect(sql).toContain('purkins_guard_release_dispatched_stock');
    expect(core).toContain('courierFeePayer');
    expect(core).toContain('quote.delivery_fee_cents!==0');
    expect(core).toContain('db.batch<');
    expect(core).not.toContain('INSERT INTO orders');
    expect(core).not.toContain('SET stock=');
    expect(core).not.toContain('INSERT INTO purkins_offline_settlements');
  });
  it('tracks booking, pickup and recipient within the protected Admin route',()=>{
    const page=read('src/pages/admin/order-requests/[id].astro');
    const api=read('src/pages/api/admin/order-requests/[id].ts');
    expect(page).toContain('save_courier_delivery');
    expect(page).toContain('pickup_location');
    expect(page).toContain('dropoff_location');
    expect(page).toContain('booking_reference');
    expect(page).toContain('courier_fee_payer');
    expect(page).toContain('deliveryEvents');
    expect(api).toContain('saveCourierDelivery(');
    expect(api).toContain('parseCourierDelivery(form)');
  });
});
