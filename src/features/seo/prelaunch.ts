/**
 * Single-environment store lifecycle:
 * prelaunch (robots noindex) -> production (normal indexing).
 * Toggling PRELAUNCH_NOINDEX does NOT clone/reset D1, R2 or the Worker.
 *
 * The default is public/indexable for generic Minshop instances. Purkins
 * explicitly opts into prelaunch with its Wrangler configuration.
 */
export function isPrelaunchNoindex(value: string | undefined | null): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/**
 * Allow public pages to be crawled so search engines can actually SEE the
 * X-Robots-Tag: noindex. Disallow: / is NOT safe for deindexing, because it
 * hides that header. Keep private paths disallowed in either lifecycle phase.
 */
export function publicRobotsTxt(origin: string, noindex: boolean): string {
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
${noindex ? '' : `Sitemap: ${origin}/sitemap.xml\n`}`;
}

export const PRELAUNCH_ROBOTS_HEADER = 'noindex, nofollow, noarchive';
