import { describe, expect, it } from 'vitest';
import {
  calculateZmwSalePrice,
  formatKwacha,
  DEFAULT_ZAR_TO_ZMW,
  DEFAULT_MARKUP_PERCENT,
} from '../../../public/admin/price-calculator-core.mjs';

describe('Purkins offline price calculator', () => {
  it('converts rand and applies markup on the converted cost', () => {
    expect(calculateZmwSalePrice(100, 1.21, 60)).toEqual({
      costZmw: 121, markupZmw: 72.6, saleZmw: 193.6,
    });
  });
  it('defaults to the agreed rate and markup', () => {
    expect(DEFAULT_ZAR_TO_ZMW).toBe(1.21);
    expect(DEFAULT_MARKUP_PERCENT).toBe(60);
  });
  it('supports zero and noninteger markup', () => {
    expect(calculateZmwSalePrice(200, 1.21, 0)?.saleZmw).toBe(242);
    expect(calculateZmwSalePrice(10, 1.21, 75)?.saleZmw).toBe(21.18);
  });
  it('rejects missing, negative, zero rate or nonfinite inputs', () => {
    for (const values of [
      ['', 1.21, 60], [10, '', 60], [10, 1.21, ''],
      [-1, 1.21, 60], [10, 0, 60], [10, 1.21, -1],
      [Infinity, 1.21, 60], [10, 'oops', 60],
    ]) expect(calculateZmwSalePrice(...values)).toBeNull();
  });
  it('formats kwacha clearly', () => {
    expect(formatKwacha(193.6)).toBe('K193.60');
  });
});
