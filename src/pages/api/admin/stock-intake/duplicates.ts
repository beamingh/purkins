import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { normalizeIntakeLookup } from '../../../../features/purkins/intakeDesk';

/**
 * Admin-only duplicate hints. The existing middleware gates /api/admin/*.
 * Never expose internal row ids, purchase costs, supplier codes or locations.
 * The query uses instr(), not wildcard-controlled LIKE, and is strictly capped.
 */
export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // Supplier barcodes are private references: accept them in the request body,
  // never as URLs that get copied into access logs and shared browser history.
  const headers = { 'Cache-Control': 'private, no-store' };
  if (Number(request.headers.get('content-length') ?? 0) > 2048) {
    return new Response('Request too large', { status: 413, headers });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400, headers });
  }
  const q = normalizeIntakeLookup(
    raw && typeof raw === 'object' && 'q' in raw && typeof raw.q === 'string' ? raw.q : null,
  );
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
         OR EXISTS (
           SELECT 1 FROM product_variants v
           JOIN purkins_variant_identifiers vi ON vi.variant_id = v.id
           WHERE v.product_id = p.id AND vi.supplier_barcode = ?
         )
      ORDER BY p.id DESC LIMIT 8`,
  ).bind(q, q, q, q).all<{
    id: string | null;
    name: string;
    sku: string | null;
    status: string | null;
  }>();

  return new Response(JSON.stringify({
    matches: (results ?? []).filter((r) => typeof r.id === 'string' && r.id.startsWith('prod_')),
  }), { headers: { ...headers, 'Content-Type': 'application/json' } });
};
