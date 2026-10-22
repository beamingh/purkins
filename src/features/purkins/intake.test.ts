import { describe, expect, it } from 'vitest';
import {
  generateItemSku,
  parseIntakeFields,
  landedCostCents,
  suggestedSellingPriceCents,
} from './intake';

const form = (values: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [name, value] of Object.entries(values)) f.set(name, value);
  return f;
};
describe('Purkins private intake', () => {
  it('generates stable item codes', () => {
    expect(generateItemSku(12)).toBe('PUR-000012');
    expect(() => generateItemSku(0)).toThrow();
  });
  it('converts rand costs at the explicitly entered rate and allocates overhead', () => {
    const parsed = parseIntakeFields(form({
      purchase_currency: 'ZAR', purchase_cost: '100.50', zar_to_zmw: '1.30',
      overhead_zwm: '20', markup_percent: '40', size_label: '6-9 months',
      colour: 'Pink', storage_location: 'Sack A',
    }));
    expect('data' in parsed).toBe(true);
    if ('data' in parsed) {
      expect(landedCostCents(parsed.data)).toBe(15065);
      expect(suggestedSellingPriceCents(parsed.data)).toBe(21091);
      expect(parsed.data.size_label).toBe('6-9 months');
    }
  });
  it('does not invent purchase cost, markup, or exchange rate', () => {
    const parsed = parseIntakeFields(form({ purchase_currency: 'ZMW' }));
    expect('data' in parsed).toBe(true);
    if ('data' in parsed) {
      expect(landedCostCents(parsed.data)).toBeNull();
      expect(suggestedSellingPriceCents(parsed.data)).toBeNull();
    }
  });
  it('rejects rand cost without an exchange rate', () => {
    expect(parseIntakeFields(form({purchase_currency:'ZAR',purchase_cost:'50'})))
      .toMatchObject({error:expect.stringContaining('rate')});
  });
  it.each(['-1', '2.555', 'foo', '1e3'])('rejects invalid monetary input %s', (cost) => {
    expect('error' in parseIntakeFields(form({purchase_cost:cost}))).toBe(true);
  });
  it('rejects markup over the maximum', () => {
    expect('error' in parseIntakeFields(form({markup_percent:'501'}))).toBe(true);
  });
  it('keeps a supplier price tag separate from the actual purchase cost', () => {
    const parsed = parseIntakeFields(form({
      brand: 'Little Castle', supplier_barcode: '000111992810002',
      retail_tag_price: '69.99', retail_tag_currency: 'ZAR',
      pack_count: '3', condition_status: 'complete',
      storage_location: 'Grey Sack / Blue PEP Plastic Bag',
      purchase_currency: 'ZAR',
    }));
    if (!('data' in parsed)) throw new Error(parsed.error);
    expect(parsed.data.supplier_barcode).toBe('000111992810002');
    expect(parsed.data.retail_tag_minor).toBe(6999);
    expect(parsed.data.purchase_cost_minor).toBeNull();
    expect(parsed.data.pack_count).toBe(3);
    expect(landedCostCents(parsed.data)).toBeNull();
  });

  it('holds incomplete stock for review and keeps the explanation private', () => {
    const parsed = parseIntakeFields(form({
      condition_status: 'incomplete',
      internal_notes: 'One yellow sock missing; red and blue pair present',
    }));
    if (!('data' in parsed)) throw new Error(parsed.error);
    expect(parsed.data.condition_status).toBe('incomplete');
    expect(parsed.data.internal_notes).toContain('missing');
  });

  it.each([
    { supplier_barcode: '<invalid>' },
    { pack_count: '0' },
    { pack_count: '2.5' },
    { condition_status: 'published' },
    { retail_tag_price: '59.999' },
  ])('rejects invalid supplier intake fields: %j', (values) => {
    expect(parseIntakeFields(form(values as Record<string, string>))).toHaveProperty('error');
  });

  it('does not treat missing markups as zero', () => {
    const parsed = parseIntakeFields(form({purchase_cost:'40', overhead_zwm:'10'}));
    if ('data' in parsed) expect(suggestedSellingPriceCents(parsed.data)).toBeNull();
  });
});
