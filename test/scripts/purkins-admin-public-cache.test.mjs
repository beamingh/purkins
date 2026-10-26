import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const ADMIN_MUTATIONS = [
  'src/pages/api/admin/categories.ts',
  'src/pages/api/admin/categories/[id].ts',
  'src/pages/api/admin/navigation.ts',
  'src/pages/api/admin/pages/[id].ts',
  'src/pages/api/admin/products.ts',
  'src/pages/api/admin/products/[id].ts',
  'src/pages/api/admin/products/[id]/images.ts',
  'src/pages/api/admin/orders/manual.ts',
  'src/pages/admin/settings.astro',
  'src/pages/admin/shipping.astro',
];

describe('Purkins split-Worker Admin cache invalidation', () => {
  it.each(ADMIN_MUTATIONS)('%s purges the public storefront, not Admin-local cache', path => {
    const file = source(path);
    expect(file).toContain('purgePublicAfterAdminMutation');
    expect(file).not.toMatch(/\bpurgeCacheTags\s*\(/);
    expect(file).not.toContain("from '../../../features/cache/purge'");
  });

  it('only purges shipping caches after successful settings save', () => {
    const shipping = source('src/pages/admin/shipping.astro');
    expect(shipping).toContain('if (result.ok) {');
    expect(shipping).toContain('await purgePublicAfterAdminMutation();');
    expect(shipping).toContain("return Astro.redirect('/admin/shipping?saved=1', 303)");
  });

  it('uses the authenticated public-Worker invalidation endpoint', () => {
    const helper = source('src/features/cache/purgePublicAdmin.ts');
    const signer = source('src/features/mcp/publicCachePurge.ts');
    expect(helper).toContain('publicStorefrontCachePurger(');
    expect(helper).toContain('PURKINS_MCP_CACHE_PURGE_SECRET');
    expect(helper).toContain('STOREFRONT_URL');
    expect(helper).toContain('throw new Error(');
    expect(helper).not.toContain('purgeCacheTags(');
    expect(signer).toContain("new URL('/api/internal/cache-purge',origin)");
    expect(signer).toContain('signDeployPurgeAuthorization(');
    expect(signer).toContain('if(!response.ok)');
  });

  it('keeps the published-item guard and explicit publication purge unchanged', () => {
    const publish = source('src/pages/api/admin/products/[id]/approve.ts');
    const hide = source('src/pages/api/admin/products/[id]/hide.ts');
    expect(publish).toContain('applyGuardedPublication');
    expect(hide).toContain('applyGuardedPublication');
    expect(publish).toContain('publicStorefrontCachePurger');
    expect(hide).toContain('publicStorefrontCachePurger');
  });

  it('documents that a committed write can still have an incomplete cache refresh', () => {
    const helper = source('src/features/cache/purgePublicAdmin.ts');
    expect(helper).toContain('Changes were saved, but the public storefront cache could not be refreshed');
    expect(helper).toContain('Changes may have been saved, but public storefront cache invalidation is not configured');
  });
});
