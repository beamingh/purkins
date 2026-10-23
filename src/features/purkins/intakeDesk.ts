/**
 * Rapid stock-intake navigation. The operator's storage location is never
 * serialized into a URL; only a public product ID appears in redirects.
 */
export function intakeCreateErrorUrl(message: string, isDesk: boolean): string {
  return `${isDesk ? '/admin/stock-intake' : '/admin/products/new'}?error=${encodeURIComponent(message)}`;
}

export function intakeCreateSuccessUrl(isDesk: boolean, publicId: string | null | undefined): string {
  if (!isDesk) return '/admin/products';
  const params = new URLSearchParams({ saved: '1' });
  if (publicId?.startsWith('prod_')) params.set('created', publicId);
  return `/admin/stock-intake?${params.toString()}`;
}

/** Search string length floor avoids enumerating the whole inventory by a
 * one-character query. We use instr in SQL, not user-controlled LIKE patterns.
 */
export function normalizeIntakeLookup(value: string | null | undefined): string | null {
  const term = (value ?? '').trim().replace(/\s+/g, ' ');
  return term.length >= 3 && term.length <= 100 ? term : null;
}
