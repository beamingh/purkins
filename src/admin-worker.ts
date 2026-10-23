import { handle } from '@astrojs/cloudflare/handler';
import mcpHandler, { StoreMcp } from '../mcp/src/index';

/**
 * Private Admin + operator MCP Worker. The Astro build for this Worker excludes
 * every storefront/checkout/webhook route at source. Shared image delivery is
 * kept for Admin media thumbnails; all public browsing/payment API traffic
 * remains with the storefront Worker.
 *
 * The existing DO-backed MCP handler is reused during the route split, without
 * changing protocol sessions. It will be migrated to Cloudflare's stateless
 * createMcpHandler separately after these two bundles are proven.
 */
export { StoreMcp };

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      // This Worker is operator-only: never expose the legacy anonymous buyer
      // MCP tier here. Authenticated operator calls also undergo the MCP
      // handler's constant-time bearer token verification.
      if (!request.headers.get('Authorization')) {
        return new Response('Operator MCP authorization required.', {
          status: 401, headers: { 'cache-control': 'no-store' },
        });
      }
      return mcpHandler.fetch(request, env as never, ctx);
    }

    const allowed = pathname === '/admin' || pathname.startsWith('/admin/') ||
      pathname === '/api/admin' || pathname.startsWith('/api/admin/') ||
      pathname === '/images' || pathname.startsWith('/images/') ||
      pathname === '/api/health' ||
      pathname === '/_astro' || pathname.startsWith('/_astro/');

    if (!allowed) return new Response('Not found.', { status: 404 });
    return handle(request, env, ctx);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
