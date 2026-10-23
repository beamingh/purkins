import { describe, expect, it } from 'vitest';
import { isPrelaunchNoindex, publicRobotsTxt, PRELAUNCH_ROBOTS_HEADER } from './prelaunch';

describe('Purkins single-environment prelaunch indexing', () => {
  it('requires an explicit true flag and can be switched off for production', () => {
    expect(isPrelaunchNoindex('true')).toBe(true);
    expect(isPrelaunchNoindex(' TRUE ')).toBe(true);
    for (const value of [undefined, null, '', 'false', '0', 'production']) {
      expect(isPrelaunchNoindex(value)).toBe(false);
    }
  });

  it('allows public pages to be crawled for noindex headers, but hides the sitemap', () => {
    const robots = publicRobotsTxt('https://purkins.example', true);
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).not.toContain('Disallow: /\n');
    expect(robots).not.toContain('Sitemap:');
    expect(PRELAUNCH_ROBOTS_HEADER).toContain('noindex');
  });

  it('promotes the same site to an indexable storefront by turning off the flag', () => {
    const robots = publicRobotsTxt('https://purkins.example', false);
    expect(robots).toContain('Sitemap: https://purkins.example/sitemap.xml');
    expect(robots).toContain('Disallow: /admin');
  });
});
