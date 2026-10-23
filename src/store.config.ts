import type { DeepPartial, SiteConfig } from './config';

/** Purkins overrides. Keep commerce internals upstream-compatible. */
export const storeOverrides: DeepPartial<SiteConfig> = {
  storeName: 'Purkins Baby & Mum Essentials',
  currency: 'zmw',
  timeZone: 'Africa/Lusaka',
};
