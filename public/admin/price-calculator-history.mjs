// Persistent, device-local pricing history shared by Admin and the offline app.
// Never store customer, product, or inventory records in this history.
import { calculateRetailPrice, ROUNDING_STEPS_ZMW } from './price-calculator-core.mjs';

export const HISTORY_KEY = 'purkins-price-calculator-history-v1';
export const AUTO_SAVE_MS = 7_000;
export const HISTORY_INITIAL_VISIBLE = 3;
export const HISTORY_PAGE_SIZE = 10;
export const HISTORY_LIMIT = 200;

export function historySignature(entry) {
  return [entry.currency, Number(entry.amount), Number(entry.rate), Number(entry.markup), Number(entry.roundingStepZmw ?? 0), Number(entry.overheadZmw ?? 0)].join('|');
}

export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || !['ZAR', 'ZMW'].includes(raw.currency)) return null;
  const amount = Number(raw.amount);
  const rate = Number(raw.rate);
  const markup = Number(raw.markup);
  const overheadZmw = raw.overheadZmw === undefined ? 0 : Number(raw.overheadZmw);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(markup) || markup < 0 ||
      !Number.isFinite(overheadZmw) || overheadZmw < 0) return null;
  // Entries created before rounding existed retain their original exact prices.
  const roundingStepZmw = raw.roundingStepZmw === undefined ? 0 : Number(raw.roundingStepZmw);
  if (!ROUNDING_STEPS_ZMW.includes(roundingStepZmw)) return null;
  const result = calculateRetailPrice(amount, raw.currency, rate, markup, roundingStepZmw, overheadZmw);
  if (!result || amount <= 0) return null;
  const when = Date.parse(raw.savedAt);
  if (!Number.isFinite(when)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id.length <= 100 && raw.id.length > 0 ? raw.id : String(when),
    currency: raw.currency,
    amount, rate, markup, roundingStepZmw, overheadZmw,
    costZmw: result.costZmw,
    rawSaleZmw: result.saleZmw,
    saleZmw: result.roundedSaleZmw,
    source: raw.source === 'manual' ? 'manual' : 'auto',
    savedAt: new Date(when).toISOString(),
  };
}

export function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const output = [];
  const seen = new Set();
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (!entry) continue;
    const key = historySignature(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
    if (output.length >= HISTORY_LIMIT) break;
  }
  return output;
}

export function saveHistory(history, candidate) {
  const entry = normalizeEntry(candidate);
  if (!entry) return normalizeHistory(history);
  const key = historySignature(entry);
  return [entry, ...normalizeHistory(history).filter(row => historySignature(row) !== key)]
    .slice(0, HISTORY_LIMIT);
}

export function suggestCosts(history, currency, typed = '', limit = 8) {
  const prefix = String(typed).trim();
  const entries = normalizeHistory(history);
  const amounts = new Set();
  const output = [];
  for (const item of entries) {
    if (item.currency !== currency) continue;
    const str = String(item.amount);
    if (prefix && !str.startsWith(prefix)) continue;
    if (amounts.has(str)) continue;
    amounts.add(str);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

/** Search across every stored record, but return only the requested page.
 * Browsers keep a max of HISTORY_LIMIT entries locally; the UI renders the
 * three newest initially, then ten more per explicit Load more action.
 */
export function visibleHistoryPage(history, query = '', visibleCount = HISTORY_INITIAL_VISIBLE) {
  const term = String(query).trim().toLowerCase();
  const matching = Array.isArray(history) ? history.filter(item => {
    if (!term) return true;
    const sourceText = (item.currency === 'ZAR' ? 'R' : 'K') + item.amount;
    return (sourceText + ' ' + item.saleZmw + ' ' + item.currency + ' ' + item.markup)
      .toLowerCase().includes(term);
  }) : [];
  const take = Number.isSafeInteger(visibleCount) && visibleCount > 0
    ? visibleCount : HISTORY_INITIAL_VISIBLE;
  const rows = matching.slice(0, take);
  return { rows, total: matching.length, remaining: matching.length - rows.length };
}

export function shouldAutoSave(pendingSignature, currentEntry, elapsedMs) {
  return Boolean(currentEntry && pendingSignature === historySignature(currentEntry) &&
    elapsedMs >= AUTO_SAVE_MS);
}
