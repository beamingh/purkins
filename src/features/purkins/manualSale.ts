import { parsePublicId } from '../ids/publicId.ts';

export const MANUAL_CHANNELS = {
  walk_in: 'Walk-in / in person',
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  phone: 'Phone',
  other: 'Other',
} as const;

export const MANUAL_TENDERS = {
  cash: 'Cash',
  airtel_money: 'Airtel Money',
  mtn_momo: 'MTN Mobile Money',
  zamtel_money: 'Zamtel Money',
  bank_transfer: 'Bank transfer',
  other: 'Other (received)',
} as const;

export interface RequestedSaleItem {
  productPublicId: string;
  variantPublicId: string | null;
  quantity: number;
  unitPriceCents: number;
}

export interface ManualSaleForm {
  idempotencyKey: string;
  channel: keyof typeof MANUAL_CHANNELS;
  tender: keyof typeof MANUAL_TENDERS;
  customerName: string | null;
  email: string | null;
  note: string | null;
  fulfillment: 'fulfilled' | 'unfulfilled';
  deliveryMethod: 'pickup' | 'shipping';
  items: RequestedSaleItem[];
}

export type ParseSaleResult =
  | { ok: true; value: ManualSaleForm }
  | { ok: false; error: string };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AMOUNT = /^(?:0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/;

export function parseSalePrice(value: string): number | null {
  const raw = value.trim();
  const match = AMOUNT.exec(raw);
  if (!match) return null;
  const [major, fraction = ''] = raw.split('.');
  const minor = Number(major) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}

/** Parse plain form data. IDs/stock/prices must be rechecked against D1 by the caller. */
export function parseManualSaleForm(form: FormData): ParseSaleResult {
  const get = (name: string): string => String(form.get(name) ?? '').trim();
  const idempotencyKey = get('idempotency_key');
  if (!UUID_V4.test(idempotencyKey)) return { ok: false, error: 'Reload the form to get a fresh order request.' };

  const channel = get('channel');
  if (!(channel in MANUAL_CHANNELS)) return { ok: false, error: 'Choose a valid sales channel.' };
  const tender = get('tender');
  if (!(tender in MANUAL_TENDERS)) return { ok: false, error: 'Choose a valid received-payment method.' };

  const customerName = get('customer_name') || null;
  const email = get('email').toLowerCase() || null;
  const note = get('note') || null;
  if (customerName && customerName.length > 120) return { ok: false, error: 'Customer name is too long.' };
  if (email && (email.length > 254 || !EMAIL.test(email))) {
    return { ok: false, error: 'Enter a valid customer email, or leave it blank.' };
  }
  if (note && note.length > 1000) return { ok: false, error: 'Notes must be at most 1,000 characters.' };
  const fulfillment = get('fulfillment');
  if (fulfillment !== 'fulfilled' && fulfillment !== 'unfulfilled') {
    return { ok: false, error: 'Choose whether the sale has been handed over.' };
  }
  const deliveryMethod = get('delivery_method');
  if (deliveryMethod !== 'pickup' && deliveryMethod !== 'shipping') {
    return { ok: false, error: 'Choose pickup or delivery.' };
  }

  const choices = form.getAll('item').map(String);
  const quantities = form.getAll('quantity').map(String);
  const prices = form.getAll('unit_price').map(String);
  if (choices.length === 0 || choices.length > 30 ||
      choices.length !== quantities.length || choices.length !== prices.length) {
    return { ok: false, error: 'A sale needs 1–30 complete order lines.' };
  }

  const items: RequestedSaleItem[] = [];
  for (let index = 0; index < choices.length; index++) {
    const parts = choices[index].split('|');
    if (parts.length !== 2) return { ok: false, error: 'Select an existing product for every line.' };
    const productPublicId = parsePublicId(parts[0], 'product');
    const variantPublicId = parts[1] ? parsePublicId(parts[1], 'variant') : null;
    if (!productPublicId || (parts[1] && !variantPublicId)) {
      return { ok: false, error: 'Select an existing product and variant.' };
    }
    if (!/^[1-9][0-9]{0,3}$/.test(quantities[index])) {
      return { ok: false, error: 'Quantities must be whole numbers between 1 and 9999.' };
    }
    const quantity = Number(quantities[index]);
    if (quantity > 9999) return { ok: false, error: 'Maximum quantity is 9999 per line.' };
    const unitPriceCents = parseSalePrice(prices[index]);
    if (unitPriceCents === null) return { ok: false, error: 'Enter a valid nonnegative selling price in ZMW (2 decimal places maximum).' };
    items.push({ productPublicId, variantPublicId, quantity, unitPriceCents });
  }

  return {
    ok: true,
    value: {
      idempotencyKey,
      channel: channel as ManualSaleForm['channel'],
      tender: tender as ManualSaleForm['tender'],
      customerName,
      email,
      note,
      fulfillment,
      deliveryMethod,
      items:
    },
  };
}
