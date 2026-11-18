// Browser-safe bridge between the instant calculator and Purkins' existing
// private stock-intake form. No inventory writes, access tokens, or API calls.
import { calculateRetailPrice, ROUNDING_STEPS_ZMW } from './price-calculator-core.mjs';

export function productDraftPrice(values) {
  const { amount, currency, rate, markup, overhead, roundingStep, manual, manualPrice } = values;
  if (!['ZAR', 'ZMW'].includes(currency)) return { error: 'Choose a purchase currency.' };
  const money = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
  if (!money.test(String(amount)) || Number(amount) <= 0)
    return { error: 'Enter an actual purchase cost with at most two decimals.' };
  if (!money.test(String(overhead)))
    return { error: 'Allocated overhead must have at most two decimals.' };
  if (!/^(?:0|[1-9]\d{0,2}|[1-4]\d{2}|500)$/.test(String(markup)) || Number(markup) > 500)
    return { error: 'To save an intake draft, markup must be a whole percent from 0 to 500.' };
  if (currency === 'ZAR' && (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(String(rate)) || Number(rate) <= 0))
    return { error: 'Enter a valid Rand-to-Kwacha rate (up to six decimals).' };
  if (!ROUNDING_STEPS_ZMW.includes(Number(roundingStep)))
    return { error: 'Choose a valid rounding setting.' };
  const r = currency === 'ZAR' ? Number(rate) : 1;
  const calculated = calculateRetailPrice(
    Number(amount), currency, r, Number(markup), Number(roundingStep), Number(overhead),
  );
  if (!calculated) return { error: 'Enter valid pricing values.' };
  let priceZmw = calculated.roundedSaleZmw;
  if (manual) {
    if (!money.test(String(manualPrice)) || Number(manualPrice) <= 0)
      return { error: 'Enter a valid manual selling price with at most two decimals.' };
    priceZmw = Number(manualPrice);
  }
  return {
    data: {
      purchase_currency: currency,
      purchase_cost: Number(amount).toFixed(2),
      zar_to_zmw: currency === 'ZAR' ? String(rate) : '',
      overhead_zwm: Number(overhead).toFixed(2),
      markup_percent: String(Number(markup)),
      price: priceZmw.toFixed(2),
      currency: 'ZMW',
      pricing_mode: 'cost_based',
      suggestedPriceZmw: calculated.roundedSaleZmw,
      landedCostZmw: calculated.costZmw,
      salePriceZmw: priceZmw,
      roundingStepZmw: Number(roundingStep),
      manual: Boolean(manual),
    },
  };
}
