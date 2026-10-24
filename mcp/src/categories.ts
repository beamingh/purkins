import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import { getCategoryByPublicId, listCategories, productCounts } from '../../src/features/categories/db';
import { parsePublicId } from '../../src/features/ids/publicId';

/** Private operator category tools. Internal integer row IDs never leave MCP. */
export function registerCategoryTools(server: McpServer, db: D1Database): void {
  server.registerTool('list_purkins_categories', {
    description: 'Operator-only category hierarchy with public cat_ IDs, parent references and direct product counts.',
    inputSchema: {},
  }, async () => {
    const [categories, counts] = await Promise.all([listCategories(db), productCounts(db)]);
    const byId = new Map(categories.map(category => [category.id, category]));
    const rows = categories.map(category => {
      if (!category.public_id) throw new Error('Category public ID backfill required.');
      const parent = category.parent_id == null ? null : byId.get(category.parent_id);
      if (category.parent_id != null && !parent?.public_id) throw new Error('Broken category hierarchy.');
      return {
        id: category.public_id,
        name: category.name,
        slug: category.slug,
        parent_id: parent?.public_id ?? null,
        product_count: counts.get(category.id) ?? 0,
      };
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify({ categories: rows }) }] };
  });

  server.registerTool('get_purkins_category', {
    description: 'Operator-only category details by its cat_ public ID. Numeric row IDs are not accepted.',
    inputSchema: { id: z.string().min(1) },
  }, async ({ id }) => {
    const publicId = parsePublicId(id, 'category');
    if (!publicId) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Pass a valid cat_ category ID.' }) }] };
    const category = await getCategoryByPublicId(db, publicId);
    if (!category) return { content: [{ type: 'text' as const, text: JSON.stringify({ category: null }) }] };
    const all = await listCategories(db);
    const parent = category.parent_id == null ? null : all.find(c => c.id === category.parent_id);
    return { content: [{ type: 'text' as const, text: JSON.stringify({
      category: {
        id: publicId, name: category.name, slug: category.slug,
        parent_id: parent?.public_id ?? null, created_at: category.created_at,
      },
    }) }] };
  });
}
