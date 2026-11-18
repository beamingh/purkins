// Private, online-only bridge into the EXISTING /api/admin/products intake.
// The offline calculator has no draft form and never creates inventory.
import { formatKwacha } from './price-calculator-core.mjs';
import { productDraftPrice } from './price-calculator-intake-core.mjs';

export function initCalculatorProductDraft(section, calculator) {
  if (!section || !calculator) return;
  const form = section.querySelector('[data-calculator-product-form]');
  if (!form) return;
  const calc = selector => calculator.querySelector(selector);
  const find = selector => form.querySelector(selector);
  const amount = calc('[data-amount]');
  const rate = calc('[data-rate]');
  const markup = calc('[data-markup]');
  const overhead = calc('[data-overhead]');
  const manual = find('[data-draft-override]');
  const manualInput = find('[data-draft-manual]');
  const manualWrap = find('[data-draft-manual-wrap]');
  const name = find('[data-draft-name]');
  const barcode = find('[data-draft-barcode]');
  const saveButton = find('[data-draft-save]');
  const status = find('[data-draft-status]');
  const matchingBox = find('[data-draft-matches]');
  const matchingList = find('[data-draft-match-list]');
  const finalOutput = find('[data-draft-final]');
  const suggestionOutput = find('[data-draft-suggested]');
  const landedOutput = find('[data-draft-landed]');
  let pendingLookup = null;
  let lookupTimer = null;
  let submitting = false;

  const value = field => field?.value?.trim() ?? '';
  function currentSnapshot() {
    const currency = calc('[data-currency][aria-pressed="true"]')?.dataset.currency || 'ZAR';
    const roundingStep = Number(calc('[data-rounding-step][aria-pressed="true"]')?.dataset.roundingStep ?? 5);
    return productDraftPrice({
      amount: value(amount), currency, rate: value(rate), markup: value(markup),
      overhead: value(overhead), roundingStep,
      manual: manual.checked, manualPrice: value(manualInput),
    });
  }

  function update() {
    const snapshot = currentSnapshot();
    manualWrap.hidden = !manual.checked;
    if ('error' in snapshot) {
      saveButton.disabled = true;
      suggestionOutput.textContent = '—';
      landedOutput.textContent = '—';
      finalOutput.textContent = '—';
      status.textContent = snapshot.error;
      return;
    }
    const data = snapshot.data;
    for (const fieldName of [
      'currency', 'purchase_currency', 'purchase_cost', 'zar_to_zmw',
      'overhead_zwm', 'markup_percent', 'pricing_mode', 'price',
    ]) {
      const input = form.elements.namedItem(fieldName);
      if (input) input.value = data[fieldName];
    }
    suggestionOutput.textContent = formatKwacha(data.suggestedPriceZmw);
    landedOutput.textContent = formatKwacha(data.landedCostZmw);
    finalOutput.textContent = formatKwacha(data.salePriceZmw);
    const nameValid = value(name).length > 0;
    saveButton.disabled = !nameValid || !navigator.onLine || submitting;
    status.textContent = !navigator.onLine
      ? 'Offline: calculations still work; connect to save product drafts.'
      : !nameValid
        ? 'Enter a product name to enable saving this as a private draft.'
        : data.salePriceZmw < data.landedCostZmw
          ? 'Selling price is below landed cost. The draft can be saved but cannot be approved until reviewed.'
          : 'Ready to save a private draft. Similar products will be checked first.';
  }

  // Any calculator change immediately refreshes the new-product price preview.
  calculator.addEventListener('purkins:pricing-updated', update);
  calculator.addEventListener('input', update);
  calculator.addEventListener('change', update);
  calculator.addEventListener('click', () => queueMicrotask(update));
  name.addEventListener('input', () => { update(); scheduleLookup(); });
  barcode.addEventListener('input', scheduleLookup);
  manual.addEventListener('change', () => {
    if (manual.checked && !value(manualInput)) {
      const previousChecked = manual.checked;
      manual.checked = false;
      const suggestion = currentSnapshot();
      manual.checked = previousChecked;
      if ('data' in suggestion) manualInput.value = suggestion.data.price;
    }
    update();
  });
  manualInput.addEventListener('input', update);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);

  function renderMatches(matches) {
    matchingList.replaceChildren();
    for (const item of matches) {
      const li = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = '/admin/products/' + encodeURIComponent(item.id) + '/edit';
      anchor.textContent = item.sku ? item.name + ' (' + item.sku + ')' : item.name;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      li.append(anchor);
      matchingList.append(li);
    }
    matchingBox.hidden = matches.length === 0;
  }

  async function checkDuplicates() {
    pendingLookup?.abort();
    const terms = [...new Set([value(barcode), value(name)])]
      .filter(term => term.length >= 3 && term.length <= 100);
    if (!terms.length) {
      renderMatches([]);
      return [];
    }
    const controller = new AbortController();
    pendingLookup = controller;
    const matches = await Promise.all(terms.map(async term => {
      const response = await fetch('/api/admin/stock-intake/duplicates', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ q: term }),
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok || response.redirected) throw new Error('Duplicate check requires an authenticated online Admin session.');
      const data = await response.json();
      return Array.isArray(data.matches) ? data.matches : [];
    }));
    if (controller.signal.aborted) return null;
    const unique = new Map();
    for (const item of matches.flat()) {
      if (typeof item?.id === 'string' && item.id.startsWith('prod_') &&
          typeof item.name === 'string' && !unique.has(item.id)) unique.set(item.id, item);
    }
    const matchesFound = [...unique.values()];
    renderMatches(matchesFound);
    return matchesFound;
  }

  function scheduleLookup() {
    if (lookupTimer) clearTimeout(lookupTimer);
    pendingLookup?.abort();
    lookupTimer = setTimeout(async () => {
      try { await checkDuplicates(); }
      catch (error) {
        if (error?.name === 'AbortError') return;
        matchingBox.hidden = true;
        status.textContent = 'Duplicate suggestions unavailable. Product saving will check again.';
      }
    }, 450);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;
    update();
    if (saveButton.disabled) return;
    const snapshot = currentSnapshot();
    if ('error' in snapshot) return;
    if (!navigator.onLine) {
      status.textContent = 'Connect to the internet to save this product draft.';
      return;
    }
    const checkedName = value(name);
    const checkedBarcode = value(barcode);
    submitting = true;
    let handedOff = false;
    saveButton.disabled = true;
    status.textContent = 'Checking for similar products before saving…';
    if (lookupTimer) clearTimeout(lookupTimer);
    try {
      const matches = await checkDuplicates();
      if (matches === null) throw new Error('Duplicate lookup was interrupted. Please retry.');
      // A name, cost or markup may change during an async duplicate search.
      const stillValid = currentSnapshot();
      if ('error' in stillValid || value(name) !== checkedName || value(barcode) !== checkedBarcode ||
          JSON.stringify(stillValid.data) !== JSON.stringify(snapshot.data)) {
        throw new Error('Product or price changed during duplicate check. Review and save again.');
      }
      if (matches.length) {
        const choices = matches.slice(0, 3).map(m => m.name).join(', ');
        if (!window.confirm('Possible existing stock: ' + choices +
            '.\n\nCreate a SEPARATE unpublished product anyway? Cancel to open an existing product.')) {
          status.textContent = 'No new product created. Review the possible matches above.';
          return;
        }
      }
      // The authoritative Admin product route validates and creates the
      // public product + private intake together. No automatic publication.
      status.textContent = 'Saving your unpublished Purkins product…';
      handedOff = true;
      HTMLFormElement.prototype.submit.call(form);
    } catch (error) {
      status.textContent = error?.message || 'Unable to check duplicates; nothing was saved.';
    } finally {
      if (!handedOff) {
        submitting = false;
        update();
      }
    }
  });
  update();
}
