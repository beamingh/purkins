import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { normalizeIntakeLookup } from '../../../../features/purkins/intakeDesk';

/**
 * Admin-only duplicate hints. The existing middleware gates /api/admin/*.
 * Never expose internal row ids, purchase costs, supplier codes or locations.
 * The query uses instr(), not wildcard-controlled LIKE, and is strictly capped.
 */
export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = normalizeIntakeLookup(url.searchParams.get('q'));
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!q) return new Response(JSON.stringify({ matches: [] }), {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

  const { results } = await env.DB.prepare(
    `SELECT p.public_id AS id, p.name, i.sku, i.status
       FROM products p
       LEFT JOIN purkins_intake i ON i.product_id = p.id
      WHERE instr(lower(p.name), lower(?)) > 0
         OR (i.supplier_barcode = ?)
         OR (i.sku = ?)
      ORDER BY p.id DESC LIMIT 8`,
  ).bind(q, q, q).all<{
    id: string | null;
    name: string;
    sku: string | null;
    status: string | null;
  }>();

  return new Response(JSON.stringify({
    matches: (results ?? []).filter((r) => typeof r.id === 'string' && r.id.startsWith('prod_')),
  }), { headers: { ...headers, 'Content-Type': 'application/json' } });
};
