import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

describe('Purkins guided product editing', () => {
  it('presents five focused steps without replacing established Admin routes', () => {
    const edit = source('src/pages/admin/products/[id]/edit.astro');
    const form = source('src/features/products/ProductForm.astro');
    for (const step of ['details', 'inventory', 'photos', 'variants', 'review']) {
      expect(edit).toContain("'"+step+"'");
    }
    for (const pane of ['details', 'inventory']) {
      expect(form).toContain('data-editor-pane="'+pane+'"');
    }
    for (const pane of ['photos', 'variants', 'review']) {
      expect(edit).toContain('data-editor-pane="'+pane+'"');
    }
    expect(edit).toContain('data-editor-tab={step}');
    expect(edit).toContain('aria-controls={`editor-pane-${step}`}');
    expect(edit).toContain('role="tablist"');
    expect(edit).toContain('Preview listing');
  });

  it('does not break existing product or variant saving semantics', () => {
    const form = source('src/features/products/ProductForm.astro');
    const edit = source('src/pages/admin/products/[id]/edit.astro');
    const post = source('src/pages/api/admin/products/[id].ts');
    expect(form).toContain('id={formId}');
    expect(form).toContain('name="_editor_step"');
    expect(form).toContain('data-editor-save');
    expect(edit).toContain('form="product-form"');
    expect(edit).toContain('data-editor-pane="variants"');
    expect(post).toContain('const editUrl =');
    expect(post).toContain('return redirect(editUrl, 303)');
    expect(post).toContain('const editStep =');
    expect(edit).toContain("editor.addEventListener('invalid'");
  });

  it('supports one-selection uploads with a no-JavaScript fallback and existing library picker', () => {
    const edit = source('src/pages/admin/products/[id]/edit.astro');
    const images = source('src/pages/api/admin/products/[id]/images.ts');
    expect(edit).toContain('data-photo-quick-upload');
    expect(edit).toContain('data-photo-dropzone');
    expect(edit).toContain('name="photo_alt"');
    expect(edit).toContain('photoForm.requestSubmit()');
    expect(edit).toContain('data-photo-upload-fallback');
    expect(edit).toContain('Choose from Media');
    expect(images).toContain('const requestedAlt');
    expect(images).toContain('UPDATE product_images SET alt=?');
    expect(images).toContain('await syncPrimaryImage(env.DB, id)');
    expect(images).toContain('const media = await uploadMedia');
  });

  it('preserves guarded publication and media permissions', () => {
    const edit = source('src/pages/admin/products/[id]/edit.astro');
    const registry = source('mcp/src/purkins-gallery.ts');
    expect(edit).toContain('name="confirm_publish"');
    expect(edit).toContain('name="confirm_unpublish"');
    expect(edit).toContain('Retry public cache purge');
    for (const tool of ['attach_guarded_purkins_photo', 'set_guarded_purkins_photo_alt', 'make_guarded_purkins_photo_primary']) {
      expect(registry).toContain("server.registerTool('"+tool+"'");
    }
  });
});
