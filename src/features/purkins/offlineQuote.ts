import { parseSalePrice } from './manualSale';

export interface OfflineQuoteInput {
  nonce: string;
  expectedRevision: number;
  feeCents: number;
  discountCents: number;
  fulfillmentMethod: 'delivery' | 'pickup';
  deliveryDetails: string | null;
  ownerNote: string | null;
}
export type ParsedOfflineQuote =
  | { ok: true; value: OfflineQuoteInput }
  | { ok: false; error: string };

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOfflineQuote(form: FormData): ParsedOfflineQuote {
  const raw = (key: string) => String(form.get(key) ?? '').trim();
  const nonce = raw('quote_nonce').toLowerCase();
  const revision = raw('quote_revision');
  const fee = parseSalePrice(raw('delivery_fee'));
  const discount = parseSalePrice(raw('discount'));
  const fulfillmentMethod = raw('fulfillment_method');
  const details = raw('delivery_details') || null;
  const note = raw('quote_note') || null;
  if (!UUID4.test(nonce)) return { ok: false, error: 'Reload the quote form before submitting.' };
  if (!/^(?:0|[1-9][0-9]{0,6})$/.test(revision)) {
    return { ok: false, error: 'Invalid quote version. Please reload the page.' };
  }
  if (fee === null || discount === null) {
    return { ok: false, error: 'Enter valid ZMW amounts using no more than two decimal places.' };
  }
  if (fulfillmentMethod !== 'delivery' && fulfillmentMethod !== 'pickup') {
    return { ok: false, error: 'Select delivery or pickup for this quote.' };
  }
  if (fulfillmentMethod === 'pickup' && fee > 0) {
    return { ok: false, error: 'Pickup cannot carry a delivery fee.' };
  }
  if ((details?.length ?? 0) > 500 || (note?.length ?? 0) > 1000) {
    return { ok: false, error: 'Quote notes are too long.' };
  }
  return { ok: true, value: {
    nonce, expectedRevision: Number(revision), feeCents: fee,
    discountCents: discount, fulfillmentMethod,
    deliveryDetails: details, ownerNote: note,
  } };
}

export function quoteTotalCents(
  subtotal: number, fee: number, discount: number,
): number | null {
  if (![subtotal, fee, discount].every(Number.isSafeInteger) ||
      subtotal <= 0 || fee < 0 || discount < 0) return null;
  const total = subtotal + fee - discount;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}
