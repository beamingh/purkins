import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parsePublicId } from '../../src/features/ids/publicId';
import { registerCategoryTools } from './categories';

const ROOT = 'cat_aaaaaaaaaa';
const CHILD = 'cat_bbbbbbbbbb';

function fixture() {
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<{content: Array<{text: string}>}>>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: (input: Record<string, unknown>) => Promise<{content: Array<{text: string}>}>) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  const allCategories = [
    { id: 10, public_id: ROOT, name: 'Baby clothes', slug: 'baby-clothes', parent_id: null, created_at: '2026-10-24' },
    { id: 20, public_id: CHILD, name: 'Bodysuits', slug: 'bodysuits', parent_id: 10, created_at: '2026-10-24' },
  ];
  const db = {
    prepare: vi.fn((sql: string) => ({
      all: vi.fn(async () => ({
        results: sql.includes('GROUP BY category_id') ? [{ category_id: 20, n: 3 }] : allCategories,
      })),
      bind: vi.fn((publicId: string) => ({
        first: vi.fn(async () => allCategories.find(c => c.public_id === publicId) ?? null),
      })),
    })),
  };
  registerCategoryTools(server, db as never);
  return { handlers, db };
}

describe('operator category tools', () => {
  it('uses actual public-ID shape and registers two read-only tools', () => {
    expect(parsePublicId(ROOT, 'category')).toBe(ROOT);
    expect(parsePublicId(CHILD, 'category')).toBe(CHILD);
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual(['list_purkins_categories', 'get_purkins_category']);
  });

  it('returns parent public IDs and counts without leaking internal row IDs', async () => {
    const { handlers } = fixture();
    const reply = await handlers.get('list_purkins_categories')!({});
    const data = JSON.parse(reply.content[0]!.text);
    expect(data.categories[1]).toEqual({
      id: CHILD, name: 'Bodysuits', slug: 'bodysuits',
      parent_id: ROOT, product_count: 3,
    });
    for (const row of data.categories) {
      expect(typeof row.id).toBe('string');
      expect('row_id' in row).toBe(false);
    }
  });

  it('looks up a real valid public ID and projects its public parent ID', async () => {
    const { handlers } = fixture();
    const reply = await handlers.get('get_purkins_category')!({ id: CHILD });
    expect(JSON.parse(reply.content[0]!.text).category).toEqual({
      id: CHILD, name: 'Bodysuits', slug: 'bodysuits',
      parent_id: ROOT, created_at: '2026-10-24',
    });
  });

  it('rejects numeric or malformed identifiers without touching D1', async () => {
    const { handlers, db } = fixture();
    for (const id of ['20', 'cat_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'prod_aaaaaaaaaa']) {
      const reply = await handlers.get('get_purkins_category')!({ id });
      expect(JSON.parse(reply.content[0]!.text)).toHaveProperty('error');
    }
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('returns null for a well-formed missing category', async () => {
    const { handlers } = fixture();
    const reply = await handlers.get('get_purkins_category')!({ id: 'cat_cccccccccc' });
    expect(JSON.parse(reply.content[0]!.text)).toEqual({ category: null });
  });
});
