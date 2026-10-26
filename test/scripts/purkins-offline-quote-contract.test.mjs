import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path,import.meta.url),'utf8');

describe('Purkins offline quote is a NON-payment document',()=>{
  it('stores owner revisions in a separate audited ledger',()=>{
    const sql=read('migrations/0056_purkins_offline_quotes.sql');
    expect(sql).toContain('purkins_order_request_quotes');
    expect(sql).toContain('purkins_order_request_quote_events');
    expect(sql).toContain('UNIQUE(request_id, revision)');
    expect(sql).not.toContain('UPDATE products');
    expect(sql).not.toContain('INSERT INTO orders');
  });
  it('requires guarded quote revisions and disallows stock/payment side effects',()=>{
    const source=read('src/features/purkins/offlineQuoteDb.ts');
    expect(source).toContain('quoteTotalCents(');
    expect(source).toContain('input.expectedRevision');
    expect(source).toContain('db.batch<');
    expect(source).toContain('change_nonce');
    expect(source).not.toContain('recordManualSale(');
    expect(source).not.toContain('recordPaidOrder(');
    expect(source).not.toContain('SET stock');
  });
  it('uses the protected Admin route, not a public settlement endpoint',()=>{
    const admin=read('src/pages/admin/order-requests/[id].astro');
    const endpoint=read('src/pages/api/admin/order-requests/[id].ts');
    expect(admin).toContain('quote_nonce');
    expect(admin).toContain('quote_revision');
    expect(admin).toContain('save_quote');
    expect(admin).toContain('no stock is held');
    expect(endpoint).toContain('parseOfflineQuote(form)');
    expect(endpoint).toContain('saveOfflineQuote(');
    expect(endpoint).not.toContain('getPaymentProvider(');
  });
});
