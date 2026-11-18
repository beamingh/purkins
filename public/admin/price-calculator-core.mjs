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

/** Selling prices can remain exact or round UP to a practical Kwacha step.
 * Calculate in cents to avoid floating-point edge cases around whole steps.
 */
export const ROUNDING_STEPS_ZMW = Object.freeze([0, 5, 10, 50]);
export const DEFAULT_ROUNDING_STEP_ZMW = 5;

export function roundUpKwacha(amount, stepZmw = DEFAULT_ROUNDING_STEP_ZMW) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 ||
      !ROUNDING_STEPS_ZMW.includes(stepZmw)) return null;
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) return null;
  if (stepZmw === 0) return cents / 100;
  const roundedCents = Math.ceil(cents / (stepZmw * 100)) * stepZmw * 100;
  if (!Number.isSafeInteger(roundedCents)) return null;
  return roundedCents / 100;
}

/** Original cost and markup stay visible. The retail price includes only
 * the optional upward rounding, never a downward change to the markup.
 */
export function calculateRetailPrice(costPrice, currency, rate, markup, roundingStepZmw = DEFAULT_ROUNDING_STEP_ZMW, overheadZmw = 0) {
  const base = calculateSellingPrice(costPrice, currency, rate, markup);
  if (!base) return null;
  const overhead = Number(overheadZmw);
  if (overheadZmw === '' || !Number.isFinite(overhead) || overhead < 0 ||
      overhead > Number.MAX_SAFE_INTEGER / 100) return null;
  const cents = Math.round(overhead * 100);
  if (!Number.isSafeInteger(cents)) return null;
  const roundedOverhead = cents / 100;
  let result = base;
  if (roundedOverhead !== 0) {
    const costZmw = Math.round((base.costZmw + roundedOverhead) * 100) / 100;
    const saleZmw = Math.round((costZmw * (1 + Number(markup) / 100) + Number.EPSILON) * 100) / 100;
    if (!Number.isSafeInteger(Math.round(saleZmw * 100))) return null;
    result = {
      costZmw,
      saleZmw,
      markupZmw: Math.round((saleZmw - costZmw) * 100) / 100,
    };
  }
  const roundedSaleZmw = roundUpKwacha(result.saleZmw, roundingStepZmw);
  if (roundedSaleZmw === null) return null;
  const roundingAddedZmw = Math.round((roundedSaleZmw - result.saleZmw) * 100) / 100;
  return {
    ...result,
    overheadZmw: roundedOverhead,
    roundedSaleZmw,
    roundingAddedZmw,
  };
}
