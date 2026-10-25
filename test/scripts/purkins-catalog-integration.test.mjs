import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

/**
 * Integration wiring contract for the single release assembled from
 * PRs #29 (preview), #30 (variant correction), #31 (publish/hide).
 * These checks complement, rather than replace, the real D1 integration
 * and Worker build tests for each feature.
 */
describe('Consolidated Purkins catalog workflow wiring', () => {
  it('registers stock corrections and guarded publication together', () => {
    const mcp = source('mcp/src/index.ts');
    const stock = source('mcp/src/purkins.ts');
    const visibility = source('mcp/src/purkins-publication.ts');

    expect(mcp).toContain('registerGuardedVariantReconcileTools(scopedServer');
    expect(mcp).toContain('registerGuardedPublicationTools(scopedServer');
    expect(stock).toContain("server.registerTool('reconcile_guarded_purkins_variant'");
    expect(visibility).toContain("server.registerTool('publish_guarded_purkins_product'");
    expect(visibility).toContain("server.registerTool('unpublish_guarded_purkins_product'");
  });

  it('grants all three actions individually, retaining separate write switches', () => {
    const grants = source('src/features/mcp/clientScope.ts');
    const mcp = source('mcp/src/index.ts');

    for (const tool of [
      'reconcile_guarded_purkins_variant',
      'publish_guarded_purkins_product',
      'unpublish_guarded_purkins_product',
    ]) {
      expect(grants).toContain("name:'" + tool + "'");
    }
    expect(mcp).toContain('PURKINS_MCP_CLOTHING_WRITES_ENABLED');
    expect(mcp).toContain('PURKINS_MCP_PUBLICATION_WRITES_ENABLED');
    expect(mcp).toContain('PURKINS_MCP_LEGACY_WRITES_ENABLED');
  });

  it('keeps owner preview private and makes public draft detail not found', () => {
    const preview = source('src/pages/admin/products/[id]/preview.astro');
    const layout = source('src/layouts/Layout.astro');
    const loader = source('src/features/storefront/productDetail.ts');
    const buyer = source('src/pages/products/[slug].astro');
    const cache = source('src/features/cache/public.ts');

    expect(preview).toContain('adminPreview: true');
    expect(preview).toContain('noIndex');
    expect(preview).toContain('showAddToCart: false');
    expect(preview).toContain('showBuyNow: false');
    expect(layout).toContain('!noIndex && <link rel="canonical"');
    expect(cache).toContain("pathname.startsWith('/admin/')");
    expect(loader).toContain('product.active !== 1 && options.adminPreview !== true');
    expect(buyer).not.toContain('adminPreview: true');
  });

  it('retains preview, publish, hide, and retry in one Admin editor', () => {
    const editor = source('src/pages/admin/products/[id]/edit.astro');
    expect(editor).toContain('Preview listing');
    expect(editor).toContain('product.active === 1');
    expect(editor).toContain('name="confirm_publish"');
    expect(editor).toContain('name="confirm_unpublish"');
    expect(editor).toContain('Hide listing (keep stock and photos)');
    expect(editor).toContain('Retry public cache purge');
  });

  it('requires unpublish confirmation in the core guard and both callers', () => {
    const guard = source('src/features/mcp/publicationGuard.ts');
    const admin = source('src/pages/api/admin/products/[id]/hide.ts');
    const mcp = source('mcp/src/purkins-publication.ts');

    expect(guard).toContain("action==='unpublish' && input.confirm_unpublish!==true");
    expect(admin).toContain('confirm_unpublish:true');
    expect(mcp).toContain('confirm_unpublish:z.literal(true)');
    expect(mcp).toContain("applyGuardedPublication(db,actor,'unpublish',args,purgePublicCache)");
  });

  it('retains ordered additive migrations without affecting prior data', () => {
    const variant = source('migrations/0051_purkins_mcp_variant_reconcile.sql');
    const publication = source('migrations/0052_purkins_mcp_publication.sql');

    expect(variant).toContain('CREATE TABLE IF NOT EXISTS purkins_mcp_variant_reconcile_receipts');
    expect(publication).toContain('CREATE TABLE IF NOT EXISTS purkins_mcp_publication_receipts');
    expect(publication).toContain('ALTER TABLE products ADD COLUMN mcp_catalog_revision');
    for (const script of [variant, publication]) {
      expect(script).not.toMatch(/\bDROP\s+TABLE\b/i);
      expect(script).not.toMatch(/\bDELETE\s+FROM\s+(?:products|product_variants|purkins_intake)\b/i);
    }
  });
});
