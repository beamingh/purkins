import { describe, expect, it } from 'vitest';
import { generateItemSku, parseIntakeFields, landedCostCents, suggestedSellingPriceCents } from './intake';

const form = (values: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [name, value] of Object.entries(values)) f.set(name, value);
  return f;
};
describe('Purkins inventory pricing', () => {
  it('never guesses exchange rates', () => {
    expect(parseIntakeFields(form({purchase_currency:'ZAR',purchase_cost:'50'})))
      .toMatchObject({error:expect.stringContaining('rate')});
  });
  it('preserves fractional-kwacha precision through rand conversion', () => {
    const parsed=parseIntakeFields(form({
      purchase_currency:'ZAR',purchase_cost:'199.99',zar_to_zmw:'1.55',
      overhead_zwm:'15.00',markup_percent:'25',
    }));
    expect('data' in parsed).toBe(true);
    if('data' in parsed){
      expect(landedCostCents(parsed.data)).toBe(32498);
      expect(suggestedSellingPriceCents(parsed.data)).toBe(40623);
    }
  });
  it('generates unique readable item codes', () => {
    expect(generateItemSku(1)).toBe('PUR-000001');
    expect(generateItemSku(99)).toBe('PUR-000099');
  });
});
