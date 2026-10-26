import { env } from 'cloudflare:workers';

/**
 * The demo provider creates real pending payments, reserves real inventory and
 * can write a demo-tagged order. Its public availability must therefore be an
 * intentional deployment decision rather than the default fallback.
 *
 * This is NOT an Admin authorization control. When enabled, any public shopper
 * can perform a simulated checkout; leave it disabled on the live store.
 */
export function isDemoCheckoutEnabledFlag(value: string | null | undefined): boolean {
  return value === 'true';
}

export function isDemoCheckoutEnabled(): boolean {
  const bindings = env as typeof env & { PURKINS_DEMO_CHECKOUT_ENABLED?: string };
  return isDemoCheckoutEnabledFlag(bindings.PURKINS_DEMO_CHECKOUT_ENABLED);
}
