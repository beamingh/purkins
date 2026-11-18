// Shared UI controller for the protected Admin screen and installable offline
// calculator. Everything here is local to this browser and origin.
import {
  DEFAULT_ZAR_TO_ZMW, DEFAULT_MARKUP_PERCENT, calculateSellingPrice, formatKwacha,
} from './price-calculator-core.mjs';
import {
  AUTO_SAVE_MS, HISTORY_KEY, HISTORY_LIMIT, historySignature,
  normalizeHistory, saveHistory, suggestCosts, shouldAutoSave,
} from './price-calculator-history.mjs';

const SETTINGS_KEY = 'purkins-price-calculator-settings-v1';

export function initPriceCalculator(root) {
  if (!root) return;
  const find = (selector) => root.querySelector(selector);
  const amount = find('[data-amount]');
  const rate = find('[data-rate]');
  const markup = find('[data-markup]');
  const symbol = find('[data-symbol]');
  const costLabel = find('[data-cost-label]');
  const sale = find('[data-sale]');
  const cost = find('[data-cost]');
  const added = find('[data-added]');
  const formula = find('[data-formula]');
  const copy = find('[data-copy]');
  const save = find('[data-save]');
  const settingsStatus = find('[data-saved-status]');
  const autoStatus = find('[data-auto-status]');
  const suggestions = find('[data-suggestions]');
  const historyList = find('[data-history-list]');
  const historyCount = find('[data-history-count]');
  const historySearch = find('[data-history-search]');
  const install = find('[data-install]');
  const connection = document.querySelector('[data-connection-status]');
  let currency = 'ZAR';
  let history = [];
  let latest = null;
  let timer = null;
  let pending = null;
  let installPrompt = null;
  let storageAvailable = true;

  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isFinite(settings.rate) && settings.rate > 0) rate.value = String(settings.rate);
    if (Number.isFinite(settings.markup) && settings.markup >= 0) markup.value = String(settings.markup);
    if (settings.currency === 'ZAR' || settings.currency === 'ZMW') currency = settings.currency;
    history = normalizeHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'));
  } catch {
    storageAvailable = false;
    settingsStatus.textContent = 'Local storage is unavailable. Export any important records.';
  }

  function persistSettings() {
    const r = Number(rate.value);
    const m = Number(markup.value);
    if (!rate.value.trim() || !markup.value.trim() || !Number.isFinite(r) || r <= 0 ||
        !Number.isFinite(m) || m < 0) return;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ rate: r, markup: m, currency }));
      settingsStatus.textContent = 'Rate, markup and currency saved on this device.';
    } catch {
      storageAvailable = false;
      settingsStatus.textContent = 'Storage unavailable. Settings may reset when this page closes.';
    }
  }

  function makeEntry(source) {
    if (!latest || !amount.value.trim() || Number(amount.value) <= 0) return null;
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
      amount: Number(amount.value), currency,
      rate: Number(rate.value), markup: Number(markup.value),
      source, savedAt: new Date().toISOString(),
    };
  }

  function persistHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      storageAvailable = true;
      return true;
    } catch {
      storageAvailable = false;
      autoStatus.textContent = 'History could not be saved to device storage. Export important records.';
      return false;
    }
  }

  function clearPending() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  }

  function record(source) {
    const entry = makeEntry(source);
    if (!entry) return;
    const next = saveHistory(history, entry);
    // Write first; an unavailable storage area must not be shown as saved.
    const previous = history;
    history = next;
    if (!persistHistory()) {
      history = previous;
      return;
    }
    clearPending();
    renderSuggestions();
    renderHistory();
    autoStatus.textContent = source === 'manual'
      ? 'Saved to history on this device.'
      : 'Auto-saved after 20 seconds without changes.';
  }

  function queueAutoSave() {
    clearPending();
    const entry = makeEntry('auto');
    if (!entry) {
      autoStatus.textContent = 'Enter a valid cost price to save.';
      return;
    }
    pending = { signature: historySignature(entry), startedAt: Date.now() };
    autoStatus.textContent = 'Will save after 20 seconds without changes.';
    timer = setTimeout(checkPending, AUTO_SAVE_MS);
  }

  function checkPending() {
    if (!pending) return;
    const entry = makeEntry('auto');
    if (shouldAutoSave(pending.signature, entry, Date.now() - pending.startedAt)) {
      record('auto');
    } else if (entry && historySignature(entry) === pending.signature) {
      const remaining = Math.max(1, AUTO_SAVE_MS - (Date.now() - pending.startedAt));
      timer = setTimeout(checkPending, remaining);
    } else {
      clearPending();
    }
  }

  function setCurrency(next) {
    if (!['ZAR', 'ZMW'].includes(next) || next === currency) return;
    currency = next;
    symbol.textContent = next === 'ZAR' ? 'R' : 'K';
    costLabel.textContent = next === 'ZAR' ? 'Enter SA price (R)' : 'Enter cost in Kwacha (K)';
    rate.disabled = next === 'ZMW';
    rate.title = next === 'ZMW' ? 'Exchange rate is not applied to Kwacha costs.' : '';
    for (const button of root.querySelectorAll('[data-currency]')) {
      button.setAttribute('aria-pressed', String(button.dataset.currency === next));
    }
    persistSettings();
    refresh();
  }

  function refresh() {
    latest = calculateSellingPrice(amount.value, currency, rate.value, markup.value);
    for (const button of root.querySelectorAll('[data-preset]')) {
      button.setAttribute('aria-pressed', String(
        markup.value !== '' && Number(button.dataset.preset) === Number(markup.value)));
    }
    if (!latest || !amount.value.trim()) {
      sale.textContent = '—';
      cost.textContent = '—';
      added.textContent = '—';
      formula.textContent = amount.value.trim()
        ? 'Enter a valid cost, exchange rate and markup.'
        : 'Enter a cost price to calculate';
      save.disabled = true;
      copy.disabled = true;
    } else {
      sale.textContent = formatKwacha(latest.saleZmw);
      cost.textContent = formatKwacha(latest.costZmw);
      added.textContent = formatKwacha(latest.markupZmw);
      formula.textContent = currency === 'ZAR'
        ? 'R' + Number(amount.value).toLocaleString('en-ZM') + ' × ' +
          Number(rate.value).toLocaleString('en-ZM', { maximumFractionDigits: 6 }) +
          ' × ' + (1 + Number(markup.value) / 100).toLocaleString('en-ZM', { maximumFractionDigits: 6 })
        : 'K' + Number(amount.value).toLocaleString('en-ZM') +
          ' × ' + (1 + Number(markup.value) / 100).toLocaleString('en-ZM', { maximumFractionDigits: 6 });
      save.disabled = Number(amount.value) <= 0;
      copy.disabled = false;
    }
    renderSuggestions();
    queueAutoSave();
  }

  // Suggest prices from history while typing, without rewriting the user's input.
  function renderSuggestions() {
    suggestions.replaceChildren();
    const values = suggestCosts(history, currency, amount.value, 8);
    for (const row of values) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = (currency === 'ZAR' ? 'R' : 'K') +
        row.amount.toLocaleString('en-ZM', { maximumFractionDigits: 2 });
      button.title = 'Use this previously saved cost price';
      button.addEventListener('click', () => {
        amount.value = String(row.amount);
        refresh();
        amount.focus();
      });
      suggestions.append(button);
    }
    if (!values.length) {
      const empty = document.createElement('span');
      empty.style.fontSize = '.76rem';
      empty.style.color = '#9ca3af';
      empty.textContent = amount.value ? 'No matching past prices' : 'Saved prices will appear here';
      suggestions.append(empty);
    }
  }

  function renderHistory() {
    historyCount.textContent = history.length + ' saved';
    historyList.replaceChildren();
    const query = historySearch.value.trim().toLowerCase();
    const rows = history.filter(item => {
      if (!query) return true;
      const sourceText = (item.currency === 'ZAR' ? 'R' : 'K') + item.amount;
      return (sourceText + ' ' + item.saleZmw + ' ' + item.currency + ' ' + item.markup)
        .toLowerCase().includes(query);
    }).slice(0, 60);
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.textContent = query ? 'No saved calculations match your search.' : 'No saved calculations yet.';
      historyList.append(empty);
      return;
    }
    for (const entry of rows) {
      const row = document.createElement('div');
      row.className = 'pk-pricing__record';
      const summary = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = (entry.currency === 'ZAR' ? 'R' : 'K') +
        entry.amount.toLocaleString('en-ZM', { maximumFractionDigits: 2 }) +
        ' → ' + formatKwacha(entry.saleZmw);
      const details = document.createElement('small');
      const when = new Date(entry.savedAt).toLocaleString('en-ZM', { dateStyle: 'medium', timeStyle: 'short' });
      details.textContent = (entry.currency === 'ZAR' ? 'Rate ' + entry.rate + ' · ' : '') +
        entry.markup + '% markup · ' + (entry.source === 'manual' ? 'Manually saved' : 'Auto-saved') +
        ' · ' + when;
      summary.append(heading, details);
      const buttons = document.createElement('div');
      buttons.className = 'pk-pricing__record-actions';
      const use = document.createElement('button');
      use.type = 'button'; use.textContent = 'Use';
      use.setAttribute('aria-label', 'Restore calculation for ' + heading.textContent);
      use.addEventListener('click', () => {
        currency = entry.currency;
        symbol.textContent = currency === 'ZAR' ? 'R' : 'K';
        costLabel.textContent = currency === 'ZAR' ? 'Enter SA price (R)' : 'Enter cost in Kwacha (K)';
        rate.disabled = currency === 'ZMW';
        rate.title = rate.disabled ? 'Exchange rate is not applied to Kwacha costs.' : '';
        for (const button of root.querySelectorAll('[data-currency]')) {
          button.setAttribute('aria-pressed', String(button.dataset.currency === currency));
        }
        amount.value = String(entry.amount);
        rate.value = String(entry.rate);
        markup.value = String(entry.markup);
        persistSettings();
        refresh();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = 'Delete';
      remove.setAttribute('aria-label', 'Delete calculation for ' + heading.textContent);
      remove.addEventListener('click', () => {
        history = history.filter(item => item.id !== entry.id);
        if (persistHistory()) { renderHistory(); renderSuggestions(); }
      });
      buttons.append(use, remove);
      row.append(summary, buttons);
      historyList.append(row);
    }
  }

  amount.addEventListener('input', refresh);
  for (const field of [rate, markup]) {
    field.addEventListener('input', () => { persistSettings(); refresh(); });
  }
  for (const button of root.querySelectorAll('[data-currency]')) {
    button.addEventListener('click', () => setCurrency(button.dataset.currency));
  }
  for (const button of root.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => { markup.value = button.dataset.preset; persistSettings(); refresh(); });
  }
  find('[data-save]').addEventListener('click', () => record('manual'));
  find('[data-clear]').addEventListener('click', () => {
    amount.value = '';
    refresh();
    amount.focus();
  });
  copy.addEventListener('click', async () => {
    if (!latest) return;
    try {
      await navigator.clipboard.writeText(formatKwacha(latest.saleZmw));
      copy.textContent = 'Copied!';
    } catch {
      copy.textContent = 'Copy unavailable';
    }
    setTimeout(() => { copy.textContent = 'Copy selling price'; }, 1400);
  });
  historySearch.addEventListener('input', renderHistory);
  find('[data-clear-history]').addEventListener('click', () => {
    if (!history.length || !window.confirm('Delete all saved calculator history on this device?')) return;
    history = [];
    if (persistHistory()) { renderHistory(); renderSuggestions(); }
  });
  find('[data-export]').addEventListener('click', () => {
    const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
    const data = [['Saved at', 'Source', 'Currency', 'Cost', 'ZAR to ZMW rate', 'Markup %', 'Converted cost ZMW', 'Selling price ZMW'],
      ...history.map(row => [row.savedAt, row.source, row.currency, row.amount,
        row.rate, row.markup, row.costZmw, row.saleZmw])];
    const csv = '\uFEFF' + data.map(cells => cells.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'purkins-price-history.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const backup = find('[data-backup]');
  const importButton = find('[data-import-button]');
  const importFile = find('[data-import-file]');

  backup.addEventListener('click', () => {
    const payload = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      history,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'purkins-price-history-backup.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  importButton.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Backup file is too large.');
      const payload = JSON.parse(await file.text());
      if (payload?.version !== 1 || !Array.isArray(payload.history))
        throw new Error('Not a Purkins price-history backup.');
      const imported = normalizeHistory(payload.history);
      // Merge rather than overwrite. Retain the newest version of each cost,
      // currency, exchange-rate and markup combination.
      const combined = [...history, ...imported].sort(
        (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
      const previous = history;
      history = normalizeHistory(combined);
      if (!persistHistory()) history = previous;
      else {
        renderHistory();
        renderSuggestions();
        autoStatus.textContent = 'Backup imported. ' + imported.length + ' valid records found.';
      }
    } catch (error) {
      autoStatus.textContent = error instanceof Error ? error.message : 'Unable to import backup.';
    } finally {
      importFile.value = '';
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkPending(); // mobile tabs may throttle timers
  });
  window.addEventListener('storage', event => {
    if (event.key === HISTORY_KEY) {
      try { history = normalizeHistory(JSON.parse(event.newValue || '[]')); } catch { history = []; }
      renderHistory();
      renderSuggestions();
    }
  });

  function updateConnection() {
    if (!connection) return;
    connection.textContent = navigator.onLine
      ? 'Online. Calculations and history are stored locally.'
      : 'Offline. You can calculate, save and manage history on this device.';
  }
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  updateConnection();

  // The offline fallback and all of its code are cached without storing any
  // authenticated Admin HTML or customer/inventory data.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/admin/price-calculator-sw.js', { scope: '/admin/' })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (connection && navigator.onLine)
          connection.textContent = 'Offline edition ready after first online visit. History stays on this device.';
      }).catch(() => {
        if (connection && navigator.onLine)
          connection.textContent = 'Offline reopening is not available in this browser.';
      });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    install.hidden = false;
  });
  install.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    install.hidden = true;
  });
  window.addEventListener('appinstalled', () => { install.hidden = true; });

  symbol.textContent = currency === 'ZAR' ? 'R' : 'K';
  costLabel.textContent = currency === 'ZAR' ? 'Enter SA price (R)' : 'Enter cost in Kwacha (K)';
  rate.disabled = currency === 'ZMW';
  for (const button of root.querySelectorAll('[data-currency]')) {
    button.setAttribute('aria-pressed', String(button.dataset.currency === currency));
  }
  // Preserve previous defaults when a fresh browser has not saved settings.
  if (!rate.value.trim()) rate.value = String(DEFAULT_ZAR_TO_ZMW);
  if (!markup.value.trim()) markup.value = String(DEFAULT_MARKUP_PERCENT);
  renderHistory();
  refresh();
}
