import { toMinorUnits } from '../../money';

export interface LiveCopyFields {
  description: string | null;
  compare_at_price_cents: number | null;
}

/** Safe, narrowly scoped edits on an already approved live listing.
 * Never accept a new selling price, stock quantity, shipping weight or status.
 */
export function parseLiveCopyFields(
  descriptionRaw: string,
  originalPriceRaw: string,
  currentSellingMinor: number,
  currency: string,
): { data: LiveCopyFields } | { error: string } {
  const description = descriptionRaw.trim();
  if (description.length > 8000) {
    return { error: 'Product description must be 8,000 characters or shorter.' };
  }
  if (currency.toLowerCase() !== 'zmw') {
    return { error: 'Purkins live price promotions require a ZMW product.' };
  }
  const old = originalPriceRaw.trim();
  let compare_at_price_cents: number | null = null;
  if (old !== '') {
    if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(old)) {
      return { error: 'Enter a valid original price in kwacha, or leave it blank.' };
    }
    compare_at_price_cents = toMinorUnits(Number(old), currency);
    if (!Number.isSafeInteger(compare_at_price_cents) ||
        compare_at_price_cents <= currentSellingMinor) {
      return { error: 'Original price must be higher than the current selling price.' };
    }
  }
  return {
    data: {
      description: description || null,
      compare_at_price_cents,
    },
  };
}
