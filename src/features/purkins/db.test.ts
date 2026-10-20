import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { approveIntake } from './db';
import type { IntakeRecord } from './intake';

const intake: IntakeRecord = {
  product_id: 4, sku: 'PUR-000004', size_label: '3-6 months',
  colour: 'cream', age_range: '3-6 months', storage_location: 'Sack B',
  purchase_currency: 'ZMW', purchase_cost_minor: 9000,
  zar_to_zmw: null, overhead_zwm_cents: 1000, markup_percent: 40,
  status: 'draft', updated_at: '2026-10-20',
};

function stubDb(
  saved: IntakeRecord | null,
  product: { price_cents: number; currency: string; image_key: string | null } | null,
) {
  const batch = vi.fn(async () => []);
  const db = {
    prepare(sql: string) {
      return {
        bind: (..._params: unknown[]) => ({
          first: async () => sql.includes('FROM purkins_intake') ? saved : product,
        }),
      };
    },
    batch,
  } as unknown as D1Database;
  return { db, batch };
}

describe('Purkins approval safeguards', () => {
  it('refuses a price below landed cost without changing visibility', async () => {
    const { db, batch } = stubDb(intake, { price_cents: 9999, currency: 'zmw', image_key: 'img' });
    expect(await approveIntake(db, 4)).toMatch(/below.*landed cost/);
    expect(batch).not.toHaveBeenCalled();
  });
  it('requires a product photo to publish', async () => {
    const { db, batch } = stubDb(intake, { price_cents: 14000, currency: 'zmw', image_key: null });
    expect(await approveIntake(db, 4)).toMatch(/photograph/);
    expect(batch).not.toHaveBeenCalled();
  });
  it('does not approve unknown purchase costs', async () => {
    const { db, batch } = stubDb({ ...intake, purchase_cost_minor: null },
      { price_cents: 14000, currency: 'zmw', image_key: 'img' });
    expect(await approveIntake(db, 4)).toMatch(/purchase cost/);
    expect(batch).not.toHaveBeenCalled();
  });
  it('uses one atomic batch to approve and publish', async () => {
    const { db, batch } = stubDb(intake, { price_cents: 14000, currency: 'zmw', image_key: 'img' });
    await expect(approveIntake(db, 4)).resolves.toBeNull();
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
  });
});
