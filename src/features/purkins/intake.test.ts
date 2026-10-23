import { describe, expect, it } from 'vitest';
import {
  generateItemSku,
  parseIntakeFields,
  landedCostCents,
  suggestedSellingPriceCents,
} from './intake';

const form = (values: Record<string, string | undefined>): FormData => {
  const f = new FormData();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) f.set(name, value);
  }
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
  it('selects an existing stock location without requiring a new name', () => {
    const parsed = parseIntakeFields(form({
      storage_location_existing: 'Grey Sack / Blue PEP Bag',
      storage_location_new: '',
    }));
    if (!('data' in parsed)) throw new Error(parsed.error);
    expect(parsed.data.storage_location).toBe('Grey Sack / Blue PEP Bag');
  });
  it('creates a new stock location and gives it priority over an old selection', () => {
    const parsed = parseIntakeFields(form({
      storage_location_existing: 'Grey Sack',
      storage_location_new: 'White Bag A / Folded Vests',
    }));
    if (!('data' in parsed)) throw new Error(parsed.error);
    expect(parsed.data.storage_location).toBe('White Bag A / Folded Vests');
  });
  it('leaves new Admin location IDs to the authoritative route instead of fabricating root paths', () => {
    const parsed = parseIntakeFields(form({
      location_id: '',
      storage_location_new: 'Blue PEP Bag',
      storage_location_parent_id: 'loc_1234567890abcdef12345678',
    }));
    if (!('data' in parsed)) throw new Error(parsed.error);
    expect(parsed.data.storage_location).toBeNull();
  });
  it('keeps legacy/MCP storage paths and permits an unspecified location', () => {
    const legacy = parseIntakeFields(form({ storage_location: 'White Sack / Blue Bag' }));
    const empty = parseIntakeFields(form({
      storage_location_existing: '', storage_location_new: '',
    }));
    if (!('data' in legacy)) throw new Error(legacy.error);
    if (!('data' in empty)) throw new Error(empty.error);
    expect(legacy.data.storage_location).toBe('White Sack / Blue Bag');
    expect(empty.data.storage_location).toBeNull();
  });
  it('rejects new storage-location labels longer than 100 characters', () => {
    expect(parseIntakeFields(form({
      storage_location_existing: 'Grey Sack',
      storage_location_new: 'X'.repeat(101),
    }))).toHaveProperty('error');
  });
  it('does not invent purchase cost, markup, or exchange rate', () => {
    const parsed = parseIntakeFields(form({ purchase_currency: 'ZMW' }));
    expect('data' in parsed).toBe(true);
    if ('data' in parsed) {
      expect(landedCostCents(parsed.data)).toBeNull();
      expect(suggestedSellingPriceCents(parsed.data)).toBeNull();
    }
  });
  it('supports direct manual selling price without purchase cost or exchange-rate inputs', () => {
    const parsed = parseIntakeFields(form({ pricing_mode: 'manual', purchase_currency: 'ZAR' }));
    if (!('data' in parsed)) throw new Error(parsed.error);
    expect(parsed.data.pricing_mode).toBe('manual');
    expect(parsed.data.purchase_cost_minor).toBeNull();
    expect(parsed.data.zar_to_zmw).toBeNull();
    expect(landedCostCents(parsed.data)).toBeNull();
    expect(suggestedSellingPriceCents(parsed.data)).toBeNull();
  });
  it('keeps legacy inputs cost-based and rejects invalid pricing modes', () => {
    const parsed = parseIntakeFields(form({}));
    if (!('data' in parsed)) throw new Error(parsed.error);
    expect(parsed.data.pricing_mode).toBe('cost_based');
    expect(parseIntakeFields(form({ pricing_mode: 'free_for_all' }))).toHaveProperty('error');
  });
  it('allows known rand purchase cost to remain recorded during manual pricing without inventing an FX rate', () => {
    const parsed = parseIntakeFields(form({
      pricing_mode: 'manual', purchase_currency: 'ZAR', purchase_cost: '50.00',
    }));
    if (!('data' in parsed)) throw new Error(parsed.error);
    expect(parsed.data.purchase_cost_minor).toBe(5000);
    expect(landedCostCents(parsed.data)).toBeNull();
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
    expect(parseIntakeFields(form(values))).toHaveProperty('error');
  });

  it('does not treat missing markups as zero', () => {
    const parsed = parseIntakeFields(form({purchase_cost:'40', overhead_zwm:'10'}));
    if ('data' in parsed) expect(suggestedSellingPriceCents(parsed.data)).toBeNull();
  });
});
