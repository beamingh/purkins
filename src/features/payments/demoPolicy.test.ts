import { describe, expect, it } from 'vitest';
import type { StoreSettings } from '../settings/db';
import {
  enabledMethods, isMethodAvailable, offeredMethods,
} from './index';
import { isDemoCheckoutEnabledFlag } from './demoPolicy';

const settings = (disabled: string[] = []): StoreSettings => ({
  paymentProvider: 'stripe',
  disabledPaymentMethods: disabled,
  configuredSecrets: [],
  lightningBackend: 'phoenixd',
  lnbitsUrl: null,
  phoenixdUrl: null,
} as unknown as StoreSettings);

describe('Purkins demo checkout explicit deployment opt-in', () => {
  it('defaults OFF and only recognizes exact true, not truthy-looking strings', () => {
    for (const value of [undefined, null, '', '1', 'yes', 'TRUE', 'false', ' true ']) {
      expect(isDemoCheckoutEnabledFlag(value)).toBe(false);
    }
    expect(isDemoCheckoutEnabledFlag('true')).toBe(true);
  });

  it('does not present or accept demo without the owner opt-in', () => {
    const store = settings();
    expect(isMethodAvailable('demo', store, false, false)).toBe(false);
    expect(enabledMethods(store, false, false)).toEqual([]);
    expect(offeredMethods(store, false, false)).not.toContain('demo');
  });

  it('keeps demo available only when expressly opted in and not disabled by Admin', () => {
    expect(isMethodAvailable('demo', settings(), false, true)).toBe(true);
    expect(enabledMethods(settings(), false, true)).toEqual(['demo']);
    expect(offeredMethods(settings(), false, true)).toContain('demo');
    expect(enabledMethods(settings(['demo']), false, true)).toEqual([]);
    expect(offeredMethods(settings(['demo']), false, true)).not.toContain('demo');
  });

  it('does not misrepresent unconfigured providers as available', () => {
    const store = settings();
    expect(isMethodAvailable('stripe', store, false, false)).toBe(false);
    expect(isMethodAvailable('lightning', store, false, false)).toBe(false);
    expect(isMethodAvailable('opennode', store, false, false)).toBe(false);
    expect(enabledMethods(store, false, false)).toEqual([]);
  });
});
