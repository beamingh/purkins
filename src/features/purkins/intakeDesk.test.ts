import { describe, expect, it } from 'vitest';
import { intakeCreateErrorUrl, intakeCreateSuccessUrl, normalizeIntakeLookup } from './intakeDesk';

describe('rapid stock intake', () => {
  it('keeps standard product creation on the old listing route', () => {
    expect(intakeCreateSuccessUrl(false, 'prod_abc')).toBe('/admin/products');
    expect(intakeCreateErrorUrl('bad cost', false)).toBe('/admin/products/new?error=bad%20cost');
  });

  it('returns to a clean next-item form without serializing location or costing', () => {
    const url = intakeCreateSuccessUrl(true, 'prod_abc');
    expect(url).toBe('/admin/stock-intake?saved=1&created=prod_abc');
    expect(url).not.toMatch(/location|cost|barcode/);
    expect(intakeCreateSuccessUrl(true, null)).toBe('/admin/stock-intake?saved=1');
    expect(intakeCreateErrorUrl('Missing K/R conversion', true))
      .toBe('/admin/stock-intake?error=Missing%20K%2FR%20conversion');
  });

  it('bounds the duplicate lookup without allowing one-character enumeration', () => {
    expect(normalizeIntakeLookup('  Baby    vest  ')).toBe('Baby vest');
    expect(normalizeIntakeLookup('ab')).toBeNull();
    expect(normalizeIntakeLookup('x'.repeat(101))).toBeNull();
    expect(normalizeIntakeLookup('0006009241909039')).toBe('0006009241909039');
  });

  it('guards draft-only creation and admin-only duplicate route wiring', async () => {
    const { readFileSync } = await import('node:fs');
    const create = readFileSync(new URL('../../pages/api/admin/products.ts', import.meta.url), 'utf8');
    const duplicates = readFileSync(new URL('../../pages/api/admin/stock-intake/duplicates.ts', import.meta.url), 'utf8');
    expect(create).toContain('active: 0, image_key: null');
    expect(create).toContain('intakeCreateSuccessUrl(isIntakeDesk, created?.public_id)');
    expect(duplicates).toContain('normalizeIntakeLookup(');
    expect(duplicates).toContain('private, no-store');
    expect(duplicates).toContain('LIMIT 8');
    expect(duplicates).not.toContain('purchase_cost_minor');
    expect(duplicates).not.toContain('storage_location');
  });
});
