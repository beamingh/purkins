import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

describe('Purkins live approved listing edit wiring', () => {
  it('ships an additive receipt migration with no product deletion', () => {
    const sql = read('migrations/0054_purkins_live_edit_receipts.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS purkins_live_edit_receipts');
    expect(sql).toContain('last_purkins_live_edit_nonce');
    expect(sql).toContain('cache_purged INTEGER');
    expect(sql).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM products\b/i);
  });

  it('only writes description and compare-at original price under live approval and CAS', () => {
    const guard = read('src/features/purkins/liveCopyGuard.ts');
    expect(guard).toContain('SET description=?, compare_at_price_cents=?,');
    expect(guard).toContain('mcp_catalog_revision=?');
    expect(guard).toContain("i.status=\\'approved\\'");
    expect(guard).toContain("i.condition_status=\\'complete\\'");
    expect(guard).toContain('price_cents');
    expect(guard).not.toMatch(/SET active=|SET stock=|SET price_cents=/);
    expect(guard).toContain('db.batch([');
    expect(guard).toContain('completed=CASE WHEN EXISTS(');
    expect(guard).toContain('ELSE -1 END');
    expect(guard).toContain('retryLiveCopyPurge');
  });

  it('does not permit customer-controlled owner credentials or general product mutation fields', () => {
    const route = read('src/pages/api/admin/products/[id]/live-copy.ts');
    expect(route).toContain('locals.adminEmail');
    expect(route).toContain('parseLiveCopyFields(');
    expect(route).toContain('publicStorefrontCachePurger(');
    expect(route).toContain('expected_catalog_revision');
    expect(route).not.toContain("form.get('active')");
    expect(route).not.toContain("form.get('stock')");
    expect(route).not.toContain("form.get('price')");
    expect(route).not.toContain('updateProduct(');
  });

  it('makes the safe edit distinct from the approval-revoking full editor', () => {
    const editor = read('src/pages/admin/products/[id]/edit.astro');
    const fullUpdate = read('src/pages/api/admin/products/[id].ts');
    expect(editor).toContain('Live listing updates');
    expect(editor).toContain('Save live changes');
    expect(editor).toContain('name="expected_catalog_revision"');
    expect(editor).toContain('Retry public cache refresh — do not resave the listing');
    expect(editor).toContain("intake?.status === 'approved' && product.active === 1");
    expect(fullUpdate).toContain('active: intake ? 0 : parsed.data.active');
    expect(fullUpdate).toContain('saveIntakeDraft');
  });

  it('enforces live price validation in both source and D1', () => {
    const parser = read('src/features/purkins/liveCopy.ts');
    const guard = read('src/features/purkins/liveCopyGuard.ts');
    expect(parser).toContain('compare_at_price_cents <= currentSellingMinor');
    expect(guard).toContain('input.compare_at_price_cents <= row.price_cents');
    expect(guard).toContain('AND (? IS NULL OR ? > price_cents)');
  });
});
