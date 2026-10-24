import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCategoryTools } from './categories';

function fixture() {
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<{content: Array<{text: string}>}>>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: (input: Record<string, unknown>) => Promise<{content: Array<{text: string}>}>) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  const allCategories = [
    { id: 10, public_id: 'cat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Baby clothes', slug: 'baby-clothes', parent_id: null, created_at: '2026-10-24' },
    { id: 20, public_id: 'cat_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'Bodysuits', slug: 'bodysuits', parent_id: 10, created_at: '2026-10-24' },
  ];
  const db = {
    prepare: vi.fn((sql: string) => ({
      all: vi.fn(async () => ({ results: sql.includes('GROUP BY category_id') ? [{category_id: 20, n: 3}] : allCategories })),
      bind: vi.fn(() => ({
        first: vi.fn(async () => allCategories.find(c => c.public_id === 'cat_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
      })),
    })),
  };
  registerCategoryTools(server, db as never);
  return { handlers, db };
}

describe('operator category tools', () => {
  it('exposes list and detail tools only via explicit operator registration', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual(['list_purkins_categories', 'get_purkins_category']);
  });

  it('returns parent public IDs and counts without internal row IDs', async () => {
    const { handlers } = fixture();
    const reply = await handlers.get('list_purkins_categories')!({});
    const data = JSON.parse(reply.content[0]!.text);
    expect(data.categories[1]).toEqual({
      id: 'cat_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      name: 'Bodysuits', slug: 'bodysuits',
      parent_id: 'cat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', product_count: 3,
    });
    expect(JSON.stringify(data)).not.toMatch(/"id":(?:10|20)(?:,|})/);
  });

  it('rejects numeric identifiers at the boundary', async () => {
    const { handlers, db } = fixture();
    const reply = await handlers.get('get_purkins_category')!({ id: '20' });
    expect(JSON.parse(reply.content[0]!.text)).toHaveProperty('error');
    expect(db.prepare).not.toHaveBeenCalled();
  });
});
