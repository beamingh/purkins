import type { CartLine } from '../cart/cart';

export const REQUEST_PAYMENT_OPTIONS = {
  pay_on_delivery: 'Pay on delivery (when available)',
  pay_after_instructions: 'Receive payment instructions',
  contact_me: 'Contact me to arrange payment',
} as const;
export const REQUEST_FULFILLMENT_OPTIONS = {
  delivery: 'Delivery',
  pickup: 'Pickup or collection',
  discuss: 'Discuss options with Purkins',
} as const;
export const REQUEST_STATUSES = {
  new: 'New — needs follow-up',
  contacted: 'Customer contacted',
  awaiting_payment: 'Awaiting payment or handover',
  cancelled: 'Cancelled',
} as const;

export type RequestPayment = keyof typeof REQUEST_PAYMENT_OPTIONS;
export type RequestFulfillment = keyof typeof REQUEST_FULFILLMENT_OPTIONS;
export type RequestStatus = keyof typeof REQUEST_STATUSES;

export interface OrderRequestFields {
  requestId: string;
  name: string;
  phone: string;
  email: string | null;
  paymentPreference: RequestPayment;
  fulfillmentPreference: RequestFulfillment;
  area: string | null;
  addressNotes: string | null;
  customerNote: string | null;
}

export type ParsedOrderRequest =
  | { ok: true; fields: OrderRequestFields }
  | { ok: false; error: string };

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseOrderRequestForm(form: FormData): ParsedOrderRequest {
  const field = (key: string) => String(form.get(key) ?? '').trim();
  const requestId = field('request_id').toLowerCase();
  const name = field('customer_name');
  const phone = field('phone').replace(/[\s()\-]/g, '');
  const email = field('email').toLowerCase() || null;
  const payment = field('payment_preference');
  const fulfillment = field('fulfillment_preference');
  const area = field('area') || null;
  const addressNotes = field('address_notes') || null;
  const customerNote = field('customer_note') || null;
  if (!UUID4.test(requestId)) return { ok: false, error: 'Please refresh the form and try again.' };
  // A honeypot is an extra frictionless check, not a replacement for throttling.
  if (field('website')) return { ok: false, error: 'Your request could not be submitted.' };
  if (field('acknowledge') !== 'yes') {
    return { ok: false, error: 'Please acknowledge that this request is not yet a confirmed order.' };
  }
  if (name.length < 2 || name.length > 100) {
    return { ok: false, error: 'Enter your name (2–100 characters).' };
  }
  if (!/^\+?[0-9]{9,15}$/.test(phone)) {
    return { ok: false, error: 'Enter a reachable phone number with 9–15 digits.' };
  }
  if (email && (email.length > 200 || !EMAIL.test(email))) {
    return { ok: false, error: 'Enter a valid email or leave it blank.' };
  }
  if (!(payment in REQUEST_PAYMENT_OPTIONS) || !(fulfillment in REQUEST_FULFILLMENT_OPTIONS)) {
    return { ok: false, error: 'Choose how you would like to pay and receive your items.' };
  }
  if (area && area.length > 120 || addressNotes && addressNotes.length > 500 ||
      customerNote && customerNote.length > 500) {
    return { ok: false, error: 'One of your notes is too long.' };
  }
  if (fulfillment === 'delivery' && (!area || area.length < 2)) {
    return { ok: false, error: 'Enter your area or neighbourhood for delivery.' };
  }
  return { ok: true, fields: {
    requestId, name, phone, email,
    paymentPreference: payment as RequestPayment,
    fulfillmentPreference: fulfillment as RequestFulfillment,
    area, addressNotes, customerNote,
  } };
}

/** Requests are quotes/enquiries, NOT paid orders. All prices and stock come from D1. */
export function validateRequestCart(lines: CartLine[], subtotalCents: number): string | null {
  if (!lines.length || lines.length > 25) return 'Add products to your cart before requesting an order.';
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0) return 'Unable to price this cart.';
  let count = 0;
  let total = 0;
  const targets = new Map<string, { want: number; available: number }>();
  for (const line of lines) {
    if (!line.product.active || line.product.currency.toLowerCase() !== 'zmw' ||
        !Number.isSafeInteger(line.qty) || line.qty < 1 ||
        !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0 ||
        !Number.isSafeInteger(line.availableStock) || line.availableStock < 0 ||
        (line.variant && !line.variant.active)) {
      return 'An item in your cart is unavailable. Review your cart before continuing.';
    }
    count += line.qty;
    total += line.unitPriceCents * line.qty;
    const key = line.variant ? 'v:' + line.variant.id : 'p:' + line.product.id;
    const target = targets.get(key);
    if (target) target.want += line.qty;
    else targets.set(key, { want: line.qty, available: line.availableStock });
  }
  if (count > 50 || !Number.isSafeInteger(total) || total !== subtotalCents) {
    return 'Review the quantities and pricing in your cart.';
  }
  if ([...targets.values()].some(t => t.want > t.available)) {
    return 'An item in your cart is no longer available in the requested quantity.';
  }
  return null;
}
