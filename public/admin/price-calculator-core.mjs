// Purkins pricing calculator: pure, dependency-free functions shared by the
// online admin and the offline fallback. Markup is on converted cost, not margin.
export const DEFAULT_ZAR_TO_ZMW = 1.21;
export const DEFAULT_MARKUP_PERCENT = 60;

export function calculateZmwSalePrice(randPrice, kwachaPerRand, markupPercent) {
  const fields = [randPrice, kwachaPerRand, markupPercent];
  if (fields.some((value) => value === '' || value === null || value === undefined ||
    (typeof value === 'string' && !value.trim()))) return null;
  const [rand, rate, markup] = fields.map(Number);
  if (![rand, rate, markup].every(Number.isFinite) ||
    rand < 0 || rate <= 0 || markup < 0) return null;

  const cost = rand * rate;
  const selling = cost * (1 + markup / 100);
  if (!Number.isFinite(selling) || selling > Number.MAX_SAFE_INTEGER / 100) return null;

  const round = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;
  const costZmw = round(cost);
  const saleZmw = round(selling);
  return {
    costZmw,
    markupZmw: round(saleZmw - costZmw),
    saleZmw,
  };
}

export function formatKwacha(amount) {
  return 'K' + amount.toLocaleString('en-ZM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Accept Rand or direct Kwacha cost while keeping one selling-price formula.
 * An exchange rate is required for ZAR only; for ZMW it is retained for history
 * and later switching back, but must not affect the computed selling price.
 */
export function calculateSellingPrice(costPrice, currency, kwachaPerRand, markupPercent) {
  if (currency !== 'ZAR' && currency !== 'ZMW') return null;
  if (currency === 'ZAR') return calculateZmwSalePrice(costPrice, kwachaPerRand, markupPercent);
  return calculateZmwSalePrice(costPrice, 1, markupPercent);
}
