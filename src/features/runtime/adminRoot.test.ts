import { describe, expect, it } from 'vitest';
import { redirectAdminRoot } from './adminRoot';

const adminUrl = 'https://admin.purkins.ulwimbo.com';

describe('Purkins Admin hostname root', () => {
  it('redirects the bare Admin hostname to the authenticated dashboard', () => {
    for (const method of ['GET', 'HEAD']) {
      const result = redirectAdminRoot(new Request(adminUrl + '/', { method }));
      expect(result?.status).toBe(302);
      expect(result?.headers.get('Location')).toBe('/admin');
      expect(result?.headers.get('Cache-Control')).toBe('no-store');
      expect(result?.body).toBeNull();
    }
  });

  it('does not expose query parameters or redirect to external hosts', () => {
    const result = redirectAdminRoot(new Request(adminUrl + '/?next=https://example.org&token=secret'));
    expect(result?.headers.get('Location')).toBe('/admin');
  });

  it('leaves Admin login, APIs, MCP and unrelated URLs with their existing handlers', () => {
    for (const path of [
      '/admin', '/admin/', '/admin/login', '/admin/price-calculator',
      '/api/admin/products', '/mcp', '/not-a-real-route',
    ]) expect(redirectAdminRoot(new Request(adminUrl + path))).toBeNull();
  });

  it('does not redirect mutation requests at root', () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect(redirectAdminRoot(new Request(adminUrl + '/', { method }))).toBeNull();
    }
  });
});
