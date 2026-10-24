import { describe, expect, it } from 'vitest';
import { parseManualSaleForm, parseSalePrice } from './manualSale';

const first = 'prod_0123456789|';
const second = 'prod_abcdf01234|var_0123456789';
const uuid = 'aa3ed44a-9887-4e35-8bdd-e1fb8d3d91ba';

function form(overrides: Record<string, string> = {}, itemValues = [first, second]): FormData {
  const f = new FormData();
  for (const [key, value] of Object.entries({
    idempotency_key: uuid, channel: 'whatsapp', tender: 'airtel_money',
    customer_name: '', email: '', note: '', fulfillment: 'fulfilled',
    ...overrides,
  })) f.set(key, value);
  itemValues.forEach((value, index) => {
    f.append('item', value);
    f.append('quantity', String(index + 1));
    f.append('unit_price', index === 0 ? '950.00' : '135.25');
  });
  return f;
}

describe('Purkins owner-created sales', () => {
  it('supports multiple SKUs, variants, optional customer and ZMW cents', () => {
    const parsed = parseManualSaleForm(form());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.email).toBeNull();
    expect(parsed.value.customerName).toBeNull();
    expect(parsed.value.items).toEqual([
      { productPublicId: 'prod_0123456789', variantPublicId: null, quantity: 1, unitPriceCents: 95000 },
      { productPublicId: 'prod_abcdf01234', variantPublicId: 'var_0123456789', quantity: 2, unitPriceCents: 13525 },
    ]);
  });

  it('accepts an existing customer email without creating a fake customer record', () => {
    const parsed = parseManualSaleForm(form({ email: ' Buyer@Example.com ', customer_name: 'Buyer' }));
    if (!parsed.ok) throw Error(parsed.error);
    expect(parsed.value.email).toBe('buyer@example.com');
    expect(parsed.value.customerName).toBe('Buyer');
  });

  it('parses amounts exactly in cents, never via floating-point rounding', () => {
    expect(parseSalePrice('135.25')).toBe(13525);
    expect(parseSalePrice('0.9')).toBe(90);
    expect(parseSalePrice('0')).toBe(0);
    expect(parseSalePrice('135.255')).toBeNull();
    expect(parseSalePrice('-20')).toBeNull();
    expect(parseSalePrice('Infinity')).toBeNull();
    expect(parseSalePrice('1e3')).toBeNull();
  });

  it.each([
    [{ idempotency_key: 'bad' }, 'Reload'],
    [{ channel: 'untrusted' }, 'channel'],
    [{ tender: 'stripe' }, 'payment'],
    [{ email: 'bad' }, 'email'],
    [{ fulfillment: 'pending' }, 'handed over'],
    [{ note: 'x'.repeat(1001) }, 'Notes'],
    [{ customer_name: 'x'.repeat(121) }, 'Customer name'],
  ])('rejects invalid or unsafe request fields %j', (override, word) => {
    const parsed = parseManualSaleForm(form(override));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.toLowerCase()).toContain(word.toLowerCase());
  });

  it('rejects incomplete item rows and unknown public IDs', () => {
    const blank = form();
    blank.delete('unit_price');
    expect(parseManualSaleForm(blank).ok).toBe(false);
    expect(parseManualSaleForm(form({}, ['product_1234|'])).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(parseManualSaleForm(form({}, ['prod_0123456789|var_bad'])).toEqual(
      expect.objectContaining({ ok: false }),
    );
  });

  it('rejects quantities outside the positive integer range', () => {
    for (const qty of ['0', '-1', '1.5', '10000', 'abc']) {
      const f = form({}, [first]);
      f.set('quantity', qty);
      expect(parseManualSaleForm(f).ok).toBe(false);
    }
  });

  it('limits the order to 30 lines', () => {
    expect(parseManualSaleForm(form({}, Array(31).fill(first))).toEqual(
      expect.objectContaining({ ok: false }),
    );
  });
});
