import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Source-level guardrails complement the D1 workflow test.
// They intentionally do not pretend to execute an Astro HTTP request.
const source = (url: string) => readFileSync(new URL(url, import.meta.url), 'utf8');

describe('Purkins inventory route and form safety wiring', () => {
  it('always creates private drafts and saves private intake details', () => {
    const create = source('../../pages/api/admin/products.ts');
    expect(create).toContain('parseIntakeFields(form)');
    expect(create).toContain('active: 0, image_key: null');
    expect(create).toContain('await insertIntake(env.DB, productId, intake.data)');
  });

  it('revokes visibility and approval on any edit to a Purkins item', () => {
    const edit = source('../../pages/api/admin/products/[id].ts');
    expect(edit).toContain('active: intake ? 0 : parsed.data.active');
    expect(edit).toContain('await saveIntakeDraft(env.DB, id, parsedIntake.data)');
  });

  it('uses explicit guarded Admin publish and hide, not a direct visibility flip', () => {
    const publish = source('../../pages/api/admin/products/[id]/approve.ts');
    const hide = source('../../pages/api/admin/products/[id]/hide.ts');
    const create = source('../../pages/api/admin/products.ts');
    for (const route of [publish, hide]) {
      expect(route).toContain('applyGuardedPublication(env.DB');
      expect(route).toContain('publicStorefrontCachePurger(');
      expect(route).not.toContain('approveIntake(');
      expect(route).not.toContain('UPDATE products SET active');
    }
    expect(publish).toContain("String(form.get('confirm_publish')) !== 'true'");
    expect(hide).toContain("String(form.get('confirm_unpublish'))!=='true'");
    expect(create).not.toContain('approveIntake(');
  });

  it('keeps the photograph first in the intake form and prevents self-publication', () => {
    const form = source('../products/ProductForm.astro');
    const photo = form.indexOf('name="image"');
    const name = form.indexOf('name="name"');
    expect(photo).toBeGreaterThan(0);
    expect(name).toBeGreaterThan(photo);
    expect(form).toContain('disabled={intakeEnabled}');
    expect(form).toContain('data-intake-use-price');
  });

  it('offers saved locations and creates new paths in authenticated Admin forms only', () => {
    const form = source('../products/ProductForm.astro');
    const desk = source('../../pages/admin/stock-intake.astro');
    const fresh = source('../../pages/admin/products/new.astro');
    const edit = source('../../pages/admin/products/[id]/edit.astro');
    const locations = source('./db.ts');
    expect(form).toContain('name="location_id"');
    expect(form).toContain('name="storage_location_new"');
    expect(form).toContain('name="storage_location_parent_id"');
    expect(form).toContain('data-intake-new-location');
    for (const page of [desk, fresh, edit]) {
      expect(page).toContain('listLocationTree(');
      expect(page).toContain('locationOptions={locationOptions}');
    }
    expect(locations).toContain('FROM purkins_intake');
    const tree = source('./locations.ts');
    const migration = source('../../../migrations/0043_purkins_location_tree.sql');
    expect(tree).toContain('assignIntakeLocation(');
    expect(tree).toContain('Cannot move a location inside its descendant.');
    expect(migration).toContain('purkins_locations_no_cycle');
  });

  it('keeps the private intake table out of customer-facing listing queries', () => {
    const productDb = source('../products/db.ts');
    const catalog = source('../storefront/catalog.ts');
    expect(productDb).not.toContain('purkins_intake');
    expect(catalog).not.toContain('purkins_intake');
  });
});
