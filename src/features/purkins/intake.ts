import { toMinorUnits } from '../../money';

/**
 * Purkins costing is admin-only. Costs live outside the public product table.
 * Use an entered conversion rate, never a guessed/external exchange rate.
 */
export type IntakeStatus = 'draft' | 'approved';
export type PurchaseCurrency = 'ZMW' | 'ZAR';

export interface IntakeFields {
  size_label: string | null;
  colour: string | null;
  age_range: string | null;
  storage_location: string | null;
  purchase_currency: PurchaseCurrency;
  purchase_cost_minor: number | null;
  zar_to_zmw: number | null;
  overhead_zwm_cents: number;
  markup_percent: number | null;
}

export interface IntakeRecord extends IntakeFields {
  product_id: number;
  sku: string;
  status: IntakeStatus;
  updated_at: string;
}

export function generateItemSku(productId: number): string {
  if (!Number.isSafeInteger(productId) || productId < 1) throw new Error('Invalid product ID');
  return `PUR-${String(productId).padStart(6, '0')}`;
}

const read = (form: FormData, field: string): string =>
  String(form.get(field) ?? '').trim();

function optionalText(form: FormData, name: string, maxLength: number): string | null {
  const value = read(form, name);
  if (value.length > maxLength) throw new Error(`${name.replaceAll('_', ' ')} is too long.`);
  return value || null;
}

function currencyAmount(value: string, field: string): number | null {
  if (!value) return null;
  // Exactly two decimals for both ZMW and ZAR. Reject scientific notation.
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)) {
    throw new Error(`${field} must be a non-negative amount with at most two decimals.`);
  }
  return toMinorUnits(Number(value), 'ZMW');
}

export function parseIntakeFields(form: FormData): { data: IntakeFields } | { error: string } {
  try {
    const purchase_currency = (read(form, 'purchase_currency') || 'ZMW').toUpperCase();
    if (purchase_currency !== 'ZMW' && purchase_currency !== 'ZAR') {
      throw new Error('Purchase currency must be ZMW or ZAR.');
    }
    const purchase_cost_minor = currencyAmount(read(form, 'purchase_cost'), 'Purchase cost');
    const overhead_zwm_cents = currencyAmount(read(form, 'overhead_zwm'), 'Allocated overhead') ?? 0;
    const rateRaw = read(form, 'zar_to_zmw');
    let zar_to_zmw: number | null = null;
    if (rateRaw) {
      if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(rateRaw)) {
        throw new Error('Enter a valid ZMW-per-rand exchange rate.');
      }
      zar_to_zmw = Number(rateRaw);
      if (zar_to_zmw <= 0) throw new Error('Exchange rate must be above zero.');
    }
    if (purchase_currency === 'ZAR' && purchase_cost_minor !== null && zar_to_zmw === null) {
      throw new Error('Enter the ZMW-per-rand rate for a rand purchase cost.');
    }
    const markupRaw = read(form, 'markup_percent');
    let markup_percent: number | null = null;
    if (markupRaw) {
      if (!/^(?:0|[1-9]\d{0,2}|[1-4]\d{2}|500)$/.test(markupRaw) ||
          Number(markupRaw) > 500) {
        throw new Error('Markup must be a whole percentage between 0 and 500.');
      }
      markup_percent = Number(markupRaw);
    }

    return { data: {
      size_label: optionalText(form, 'size_label', 60),
      colour: optionalText(form, 'colour', 60),
      age_range: optionalText(form, 'age_range', 60),
      storage_location: optionalText(form, 'storage_location', 100),
      purchase_currency,
      purchase_cost_minor,
      zar_to_zmw,
      overhead_zwm_cents,
      markup_percent,
    } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid Purkins intake details.' };
  }
}

export function landedCostCents(fields: IntakeFields): number | null {
  if (fields.purchase_cost_minor === null) return null;
  if (fields.purchase_currency === 'ZAR' && fields.zar_to_zmw === null) return null;
  const converted = fields.purchase_currency === 'ZAR'
    ? Math.round(fields.purchase_cost_minor * fields.zar_to_zmw!)
    : fields.purchase_cost_minor;
  return converted + fields.overhead_zwm_cents;
}

/** Markup, NOT gross margin: selling = landed cost × (1 + markup% / 100). */
export function suggestedSellingPriceCents(fields: IntakeFields): number | null {
  const landed = landedCostCents(fields);
  if (landed === null || fields.markup_percent === null) return null;
  return Math.ceil(landed * (100 + fields.markup_percent) / 100);
}
