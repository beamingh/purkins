// Persistent, device-local pricing history shared by Admin and the offline app.
// Never store customer, product, or inventory records in this history.
import { calculateSellingPrice } from './price-calculator-core.mjs';

export const HISTORY_KEY = 'purkins-price-calculator-history-v1';
export const AUTO_SAVE_MS = 20_000;
export const HISTORY_LIMIT = 200;

export function historySignature(entry) {
  return [entry.currency, Number(entry.amount), Number(entry.rate), Number(entry.markup)].join('|');
}

export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || !['ZAR', 'ZMW'].includes(raw.currency)) return null;
  const amount = Number(raw.amount);
  const rate = Number(raw.rate);
  const markup = Number(raw.markup);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(markup) || markup < 0) return null;
  const result = calculateSellingPrice(amount, raw.currency, rate, markup);
  if (!result || amount <= 0) return null;
  const when = Date.parse(raw.savedAt);
  if (!Number.isFinite(when)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id.length <= 100 && raw.id.length > 0 ? raw.id : String(when),
    currency: raw.currency,
    amount, rate, markup,
    costZmw: result.costZmw,
    saleZmw: result.saleZmw,
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

export function shouldAutoSave(pendingSignature, currentEntry, elapsedMs) {
  return Boolean(currentEntry && pendingSignature === historySignature(currentEntry) &&
    elapsedMs >= AUTO_SAVE_MS);
}
