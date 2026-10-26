import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

describe('Purkins inventory valuation financial safety',()=>{
  it('counts only variant rows when sizes exist, never both parent and variants',()=>{
    const s=read('src/features/purkins/stockValuation.ts');
    expect(s).toContain('NOT EXISTS (SELECT 1 FROM product_variants');
    expect(s).toContain('JOIN product_variants v ON v.product_id=p.id');
    expect(s).toContain('COUNT(DISTINCT product_id)');
    expect(s).toContain('SUM(CASE WHEN units>0 THEN units ELSE 0 END)');
  });
  it('does not call original retailer price tags purchase costs',()=>{
    const s=read('src/features/purkins/stockValuation.ts');
    expect(s).toContain('purchase_cost_minor');
    expect(s).toContain('zar_to_zmw>0');
    expect(s).toContain('overhead_zwm_cents');
    expect(s).not.toContain('retail_tag_minor');
    expect(s).not.toContain('INSERT INTO');
    expect(s).not.toContain('UPDATE products');
    expect(s).not.toContain('UPDATE purkins_intake');
  });
  it('disables complete financial projections when any unit is unpriced or missing cost',()=>{
    const s=read('src/features/purkins/stockValuation.ts');
    const page=read('src/pages/admin/stock-valuation.astro');
    expect(s).toContain('completePrice&&completeCost?');
    expect(s).toContain('sum.unpriced_units===0');
    expect(s).toContain('sum.missing_cost_units===0');
    expect(page).toContain('Not yet calculable');
    expect(page).toContain('Original retailer price tags');
    expect(page).toContain('Selling everything at the listed prices is a scenario');
  });
  it('shows the private report from the Products and Admin navigation',()=>{
    expect(read('src/pages/admin/index.astro')).toContain('/admin/stock-valuation');
    expect(read('src/pages/admin/products/index.astro')).toContain('/admin/stock-valuation');
    expect(read('src/pages/admin/stock-intake.astro')).toContain('/admin/stock-valuation');
  });
});
