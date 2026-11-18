import { describe, expect, it } from 'vitest';
import {
  calculateZmwSalePrice, calculateSellingPrice, calculateRetailPrice,
  roundUpKwacha, DEFAULT_ROUNDING_STEP_ZMW, ROUNDING_STEPS_ZMW,
  formatKwacha,
  DEFAULT_ZAR_TO_ZMW,
  DEFAULT_MARKUP_PERCENT,
} from '../../../public/admin/price-calculator-core.mjs';
import {
  AUTO_SAVE_MS, HISTORY_LIMIT, historySignature, normalizeHistory,
  saveHistory, suggestCosts, shouldAutoSave,
} from '../../../public/admin/price-calculator-history.mjs';

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

describe('currency modes and device-local history', () => {
  const sample = (amount, currency = 'ZAR', extras = {}) => ({
    id: String(amount) + currency, amount, currency, rate: 1.21, markup: 60,
    source: 'auto', savedAt: '2026-11-18T12:00:00.000Z', ...extras,
  });

  it('calculates a Kwacha cost without converting it again', () => {
    expect(calculateSellingPrice(100, 'ZMW', 1.21, 60)).toEqual({
      costZmw: 100, markupZmw: 60, saleZmw: 160,
    });
    expect(calculateSellingPrice(100, 'ZAR', 1.21, 60)?.saleZmw).toBe(193.6);
    expect(calculateSellingPrice(100, 'USD', 1.21, 60)).toBeNull();
  });

  it('matches previously saved amounts by typed prefix, not intermediate keystrokes', () => {
    const history = normalizeHistory([sample(2050), sample(205), sample(2050, 'ZMW')]);
    expect(suggestCosts(history, 'ZAR', '205').map(r => r.amount)).toEqual([2050, 205]);
    expect(suggestCosts(history, 'ZMW', '205').map(r => r.amount)).toEqual([2050]);
  });

  it('auto-saves only once the unchanged signature reaches twenty seconds', () => {
    const completed = sample(2050);
    const pending = historySignature(completed);
    expect(AUTO_SAVE_MS).toBe(20_000);
    expect(shouldAutoSave(pending, completed, 19_999)).toBe(false);
    expect(shouldAutoSave(pending, completed, 20_000)).toBe(true);
    expect(shouldAutoSave(pending, sample(205), 20_000)).toBe(false);
    expect(shouldAutoSave(pending, sample(2050, 'ZMW'), 20_000)).toBe(false);
    expect(shouldAutoSave(pending, sample(2050, 'ZAR', { markup: 80 }), 20_000)).toBe(false);
  });

  it('deduplicates identical calculations and keeps changing rates separate', () => {
    const first = sample(2050);
    const revised = sample(2050, 'ZAR', {
      id: 'manual', source: 'manual', savedAt: '2026-11-18T13:00:00.000Z',
    });
    const distinct = sample(2050, 'ZAR', { rate: 1.25 });
    const result = saveHistory(saveHistory([first], revised), distinct);
    expect(result).toHaveLength(2);
    expect(result[0].rate).toBe(1.25);
    expect(result[1].source).toBe('manual');
    expect(result[1].id).toBe('manual');
  });

  it('rejects invalid and corrupt stored entries, keeping history bounded', () => {
    const entries = [null, {}, { ...sample(-2) },
      ...Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) =>
        sample(i + 1, 'ZAR', { id: String(i) })),
    ];
    const normalized = normalizeHistory(entries);
    expect(normalized).toHaveLength(HISTORY_LIMIT);
    expect(normalized.every(r => r.saleZmw > 0)).toBe(true);
    expect(normalizeHistory('not an array')).toEqual([]);
  });
});

describe('practical upward rounding of retail prices', () => {
  it('offers exact, K5, K10 and K50 increments with K5 as default', () => {
    expect(DEFAULT_ROUNDING_STEP_ZMW).toBe(5);
    expect(ROUNDING_STEPS_ZMW).toEqual([0, 5, 10, 50]);
    expect(roundUpKwacha(132.47, 0)).toBe(132.47);
    expect(roundUpKwacha(132.47, 5)).toBe(135);
    expect(roundUpKwacha(132.47, 10)).toBe(140);
    expect(roundUpKwacha(132.47, 50)).toBe(150);
  });

  it('never reduces the original retail price and leaves exact steps alone', () => {
    expect(roundUpKwacha(130, 5)).toBe(130);
    expect(roundUpKwacha(130.01, 5)).toBe(135);
    expect(roundUpKwacha(134.99, 5)).toBe(135);
    expect(roundUpKwacha(135, 5)).toBe(135);
    expect(roundUpKwacha(0.01, 5)).toBe(5);
    expect(roundUpKwacha(193.6, 10)).toBe(200);
    expect(roundUpKwacha(193.6, 5)).toBe(195);
  });

  it('retains the original markup calculation separately from rounding', () => {
    expect(calculateRetailPrice(132.47, 'ZMW', 1.21, 0, 5)).toEqual({
      costZmw: 132.47,
      markupZmw: 0,
      saleZmw: 132.47,
      roundedSaleZmw: 135,
      roundingAddedZmw: 2.53,
    });
    expect(calculateRetailPrice(100, 'ZAR', 1.21, 60, 10)).toEqual({
      costZmw: 121, markupZmw: 72.6, saleZmw: 193.6,
      roundedSaleZmw: 200, roundingAddedZmw: 6.4,
    });
    expect(calculateRetailPrice(100, 'ZAR', 1.21, 60, 0)?.roundedSaleZmw).toBe(193.6);
  });

  it('rejects invalid rounding steps and unsafe or negative numbers', () => {
    expect(roundUpKwacha(132.47, 7)).toBeNull();
    expect(roundUpKwacha(-2, 5)).toBeNull();
    expect(roundUpKwacha(Infinity, 5)).toBeNull();
    expect(roundUpKwacha(Number.MAX_SAFE_INTEGER, 5)).toBeNull();
    expect(calculateRetailPrice(10, 'ZMW', 1.21, 60, 3)).toBeNull();
  });

  it('stores each rounding choice separately and keeps old history exact', () => {
    const raw = {
      id: 'old', amount: 132.47, currency: 'ZMW', rate: 1.21, markup: 0,
      source: 'manual', savedAt: '2026-11-18T12:00:00.000Z',
    };
    const old = normalizeHistory([raw]);
    expect(old[0].roundingStepZmw).toBe(0);
    expect(old[0].saleZmw).toBe(132.47);
    const withFive = saveHistory(old, { ...raw, id: 'rounded', roundingStepZmw: 5 });
    expect(withFive).toHaveLength(2);
    expect(withFive[0].saleZmw).toBe(135);
    expect(withFive[0].rawSaleZmw).toBe(132.47);
    expect(historySignature(withFive[0])).not.toBe(historySignature(old[0]));
    expect(shouldAutoSave(historySignature(old[0]), withFive[0], 20_000)).toBe(false);
    expect(normalizeHistory([{ ...raw, roundingStepZmw: 7 }])).toEqual([]);
  });
});
