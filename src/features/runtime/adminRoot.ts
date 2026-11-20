/**
 * The private Admin Worker deliberately does not bundle the public storefront
 * homepage. Its bare hostname still needs a useful entrypoint instead of
 * returning "Not found." The target stays on this origin so the existing
 * /admin authentication middleware handles the redirected request.
 */
export function redirectAdminRoot(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (new URL(request.url).pathname !== '/') return null;

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin',
      'Cache-Control': 'no-store',
    },
  });
}
