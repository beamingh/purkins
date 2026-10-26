import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

describe('Purkins optional original-price promotions', () => {
  it('adds an optional higher-price database column and invalidates catalog revision', () => {
    const sql = read('migrations/0053_purkins_compare_at_price.sql');
    expect(sql).toContain('ADD COLUMN compare_at_price_cents INTEGER');
    expect(sql).toContain('compare_at_price_cents > price_cents');
    expect(sql).toContain('CREATE TRIGGER IF NOT EXISTS purkins_catalog_compare_at_update');
    expect(sql).toContain('mcp_catalog_revision=mcp_catalog_revision+1');
  });

  it('keeps a separate current checkout price and optional original price', () => {
    const db = read('src/features/products/db.ts');
    const form = read('src/features/products/form.ts');
    const admin = read('src/features/products/ProductForm.astro');
    expect(db).toContain('compare_at_price_cents = ?');
    expect(form).toContain('compare_at_price_cents <= price_cents');
    expect(form).toContain('compare_at_price_cents, currency');
    expect(admin).toContain('name="compare_at_price"');
    expect(admin).toContain('Leave blank to show only the selling price');
    expect(admin).toContain('This is not the supplier');
  });

  it('renders real reductions only in the Purkins catalog and product detail', () => {
    const card = read('src/themes/purkins/ProductCard.astro');
    const detail = read('src/themes/purkins/ProductDetail.astro');
    const cardBuilder = read('src/features/storefront/productCard.ts');
    const detailBuilder = read('src/features/storefront/productDetail.ts');
    for (const theme of [card, detail]) {
      expect(theme).toContain('formattedCompareAtPrice');
      expect(theme).toContain('<s class=');
    }
    expect(card).toContain('Special offer');
    expect(cardBuilder).toContain('product.compare_at_price_cents > product.price_cents');
    expect(detailBuilder).toContain('!hasVariants && product.compare_at_price_cents != null');
    expect(detail).toContain('data-price-display');
    expect(card).toContain('card.formattedPrice');
  });

  it('shares original-price metadata with buyer and operator MCP reads', () => {
    const publicApi = read('src/features/catalog/serialize.ts');
    const owner = read('mcp/src/purkins.ts');
    expect(publicApi).toContain('compare_at_price?:');
    expect(publicApi).toContain('compare_at_price: money(p.compare_at_price_cents, p.currency)');
    expect(owner).toContain('compare_at_price_cents: product.compare_at_price_cents ?? null');
    expect(publicApi).toContain('price: money(p.price_cents, p.currency)');
  });
});
