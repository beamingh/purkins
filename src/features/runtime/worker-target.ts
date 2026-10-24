/**
 * Monolithic builds have a local /admin/setup route for the first-run funnel.
 * The Purkins public split build replaces this marker at build time because
 * its Admin UI is hosted by the separate Access-protected Admin Worker.
 */
export const HAS_LOCAL_ADMIN_ROUTES = true;
