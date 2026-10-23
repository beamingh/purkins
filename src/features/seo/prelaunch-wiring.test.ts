import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Purkins single-deployment prelaunch wiring', () => {
  it('marks HTML and dynamic HTTP responses as noindex while suppressing public discovery routes', () => {
    const middleware = source('../../middleware.ts');
    const layout = source('../../layouts/Layout.astro');
    const robots = source('../../pages/robots.txt.ts');
    const sitemap = source('../../pages/sitemap.xml.ts');
    const agents = source('../../pages/llms.txt.ts');

    expect(middleware).toContain("'x-robots-tag': PRELAUNCH_ROBOTS_HEADER");
    expect(middleware).toContain("target.set('cache-control', 'private, no-store')");
    expect(middleware).toContain("target.delete('x-robots-tag')");
    expect(layout).toContain('<meta name="robots" content={PRELAUNCH_ROBOTS_HEADER} />');
    expect(robots).toContain('publicRobotsTxt(origin, isPrelaunchNoindex(env.PRELAUNCH_NOINDEX))');
    expect(sitemap).toContain('if (isPrelaunchNoindex(env.PRELAUNCH_NOINDEX))');
    expect(agents).toContain('if (isPrelaunchNoindex(env.PRELAUNCH_NOINDEX))');
  });

  it('enables the reversible prelaunch switch in both Cloudflare Worker config variants', () => {
    const committed = source('../../../wrangler.jsonc');
    const template = source('../../../wrangler.template.jsonc');
    for (const config of [committed, template]) {
      expect(config).toMatch(/"PRELAUNCH_NOINDEX"\s*:\s*"true"/);
    }
  });

  it('leaves the live MCP write opt-in unrelated to indexing', () => {
    const mcp = source('../../../mcp/wrangler.template.jsonc');
    expect(mcp).toContain('"PURKINS_MCP_WRITES_ENABLED": "false"');
  });
});
