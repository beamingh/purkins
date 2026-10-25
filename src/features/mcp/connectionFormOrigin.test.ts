import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isForbiddenFormOrigin } from '../auth/formOrigin';

const admin = new URL('https://admin.purkins.ulwimbo.com/admin/mcp');
const pageSource = readFileSync(
  fileURLToPath(new URL('../../pages/admin/mcp.astro', import.meta.url)), 'utf8',
);

const request = (origin: string) => new Request(admin, {
  method: 'POST',
  headers: {
    'Origin': origin,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: '_action=create',
});

describe('Owner MCP connection form origin protection', () => {
  it('uses a referrer policy that does not nullify the Origin of native same-origin form POSTs', () => {
    expect(pageSource).toContain("Astro.response.headers.set('Referrer-Policy','same-origin')");
    expect(pageSource).not.toContain("Astro.response.headers.set('Referrer-Policy','no-referrer')");
    expect(pageSource).toContain('<form method="post" action="/admin/mcp"');
  });

  it('allows only the canonical Admin origin under the existing CSRF middleware', () => {
    expect(isForbiddenFormOrigin(request(admin.origin), admin)).toBe(false);
    expect(isForbiddenFormOrigin(request('null'), admin)).toBe(true);
    expect(isForbiddenFormOrigin(request('https://purkins.ulwimbo.com'), admin)).toBe(true);
    expect(isForbiddenFormOrigin(request('https://attacker.example'), admin)).toBe(true);
  });
});
