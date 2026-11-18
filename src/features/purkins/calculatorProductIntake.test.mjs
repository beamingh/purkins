import { describe, expect, it } from 'vitest';
import { productDraftPrice } from '../../../public/admin/price-calculator-intake-core.mjs';
import { calculateRetailPrice } from '../../../public/admin/price-calculator-core.mjs';
import { parseProductForm } from '../products/form.ts';
import { parseIntakeFields, landedCostCents } from './intake.ts';

const values = overrides => ({
  amount: '100', currency: 'ZAR', rate: '1.21', overhead: '15',
  markup: '60', roundingStep: 5, manual: false, manualPrice: '',
  ...overrides,
});

describe('calculator-to-private-inventory price bridge', () => {
  it('calculates with currency, markup, overhead and roundup, and retains the original cost', () => {
    const result = productDraftPrice(values());
    expect(result).toHaveProperty('data');
    if (!('data' in result)) return;
    expect(result.data).toMatchObject({
      purchase_currency: 'ZAR', purchase_cost: '100.00', zar_to_zmw: '1.21',
      overhead_zwm: '15.00', markup_percent: '60',
      currency: 'ZMW', pricing_mode: 'cost_based',
      price: '220.00', suggestedPriceZmw: 220, landedCostZmw: 136,
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(result.data)) {
      if (['suggestedPriceZmw', 'landedCostZmw', 'salePriceZmw', 'roundingStepZmw', 'manual'].includes(key)) continue;
      form.set(key, String(value));
    }
    form.set('name', 'Baby Bottle Warmer');
    form.set('stock', '4');
    form.set('requires_shipping', 'on');
    const parsedProduct = parseProductForm(form);
    const parsedIntake = parseIntakeFields(form);
    expect(parsedProduct).toHaveProperty('data');
    expect(parsedIntake).toHaveProperty('data');
    if ('data' in parsedProduct && 'data' in parsedIntake) {
      expect(parsedProduct.data.active).toBe(0); // cannot auto-publish
      expect(parsedProduct.data.currency).toBe('zmw');
      expect(parsedProduct.data.price_cents).toBe(22000);
      expect(parsedIntake.data.purchase_cost_minor).toBe(10000);
      expect(parsedIntake.data.overhead_zwm_cents).toBe(1500);
      expect(landedCostCents(parsedIntake.data)).toBe(13600);
    }
  });

  it('does not convert a directly entered Kwacha cost twice', () => {
    const result = productDraftPrice(values({
      currency: 'ZMW', amount: '132.47', overhead: '0',
      markup: '0', roundingStep: 5,
    }));
    if (!('data' in result)) throw Error(result.error);
    expect(result.data.zar_to_zmw).toBe('');
    expect(result.data.purchase_cost).toBe('132.47');
    expect(result.data.suggestedPriceZmw).toBe(135);
    expect(result.data.price).toBe('135.00');
  });

  it('supports owner price override while keeping purchase cost intact', () => {
    const result = productDraftPrice(values({
      manual: true, manualPrice: '219', roundingStep: 10,
    }));
    if (!('data' in result)) throw Error(result.error);
    expect(result.data.price).toBe('219.00');
    expect(result.data.suggestedPriceZmw).toBe(220);
    expect(result.data.purchase_cost).toBe('100.00');
    expect(result.data.pricing_mode).toBe('cost_based');
  });

  it('keeps live calculations flexible but refuses unsupported intake values', () => {
    expect(calculateRetailPrice(100, 'ZAR', 1.21, 65.5, 5)?.roundedSaleZmw).toBe(205);
    expect(productDraftPrice(values({ markup: '65.5' }))).toHaveProperty('error');
    expect(productDraftPrice(values({ amount: '1.999' }))).toHaveProperty('error');
    expect(productDraftPrice(values({ overhead: '3.333' }))).toHaveProperty('error');
    expect(productDraftPrice(values({ currency: 'ZAR', rate: '' }))).toHaveProperty('error');
    expect(productDraftPrice(values({ manual: true, manualPrice: '' }))).toHaveProperty('error');
    expect(productDraftPrice(values({ roundingStep: 7 }))).toHaveProperty('error');
    expect(productDraftPrice(values({ amount: '0' }))).toHaveProperty('error');
  });
});
