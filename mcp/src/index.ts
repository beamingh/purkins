import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import { registerPurkinsTools, registerGuardedPurkinsStockTools, registerGuardedClothingIntakeTools } from './purkins';
import { registerPurkinsMediaTools } from './purkins-media';
import { registerGuardedPurkinsGalleryTools } from './purkins-gallery';
import { registerLocationTools } from './locations';
import { registerCategoryTools } from './categories';
import { isApprovedMcpOwner } from './operator-access';
import { authenticateMcpClientToken } from '../../src/features/mcp/clientTokens';
import { canCreateCheckout, canWriteAsOperator } from '../../src/features/mcp/clientScope';
import type { createR2Storage } from '../../src/features/storage/r2';
import { getIntake, insertIntake, saveIntakeDraft } from '../../src/features/purkins/db';
import { parseIntakeFields } from '../../src/features/purkins/intake';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { verifyAccessJwt } from '../../src/features/auth/access';

// Reuse the storefront's query logic (the db modules import only TYPES from
// workers-types, so they're clean to share across Workers — no duplication).
import {
  listAllProducts,
  countAllProducts,
  getProduct,
  getProductByPublicId,
  getProductBySlug,
  createProduct,
  updateProduct,
  type Product,
  type AdminProduct,
  type ProductInput,
} from '../../src/features/products/db';
import { slugify, uniqueSlug } from '../../src/features/products/slug';
import {
  listOrders,
  countOrders,
  getOrderByPublicId,
  orderStats,
  dailyOrderTotals,
  fulfillOrder,
  listOrderItems,
  type Order,
  type OrderItem,
  type ShippingAddress,
} from '../../src/features/orders/db';
import { listRefunds, type Refund } from '../../src/features/refunds/db';
import {
  parsePublicId,
  parseOrderOrLegacyPublicId,
  publicIdToken,
} from '../../src/features/ids/publicId';
import type { D1Database } from '@cloudflare/workers-types';

async function secureEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(providedHash), new Uint8Array(expectedHash));
}

/** Wrap any value as an MCP text result. */
function result(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Projected DTOs — every tool result goes through one of these so a numeric
// row ID, foreign key, or internal snapshot can never leak into MCP output.
// External `id` is always the prefixed public ID (prod_/ord_/rfnd_…).
// ---------------------------------------------------------------------------

/**
 * A row reaching MCP output without its public ID is a deploy-order bug (the
 * backfill must run before cutover) — fail loudly rather than leak the row ID.
 */
function requirePublicId(publicId: string | null, rowId: number, kind: string): string {
  // The error string is boundary output too — never include the numeric row id.
  void rowId;
  if (!publicId) throw new Error(`a ${kind} row has no public_id — run the backfill`);
  return publicId;
}

function productDto(p: Product) {
  return {
    id: requirePublicId(p.public_id, p.id, 'product'),
    slug: p.slug,
    name: p.name,
    description: p.description,
    price_cents: p.price_cents,
    currency: p.currency,
    stock: p.stock,
    active: p.active === 1,
    variant_label: p.variant_label,
    weight_grams: p.weight_grams,
    requires_shipping: p.requires_shipping === 1,
    created_at: p.created_at,
  };
}

function adminProductDto(p: AdminProduct) {
  return { ...productDto(p), sold: p.sold };
}

/**
 * The displayed order reference: the token portion of `ord_<token>`. Legacy
 * orders (pre-prefix hex32/UUID public IDs) show the public ID itself.
 */
function orderReference(publicId: string): string {
  return publicIdToken(publicId, 'order') ?? publicId;
}

function orderDto(o: Order) {
  const id = requirePublicId(o.public_id, o.id, 'order');
  let shipAddress: ShippingAddress | null = null;
  if (o.ship_address) {
    try {
      shipAddress = JSON.parse(o.ship_address) as ShippingAddress;
    } catch {
      shipAddress = null;
    }
  }
  return {
    id,
    reference: orderReference(id),
    email: o.email,
    amount_total_cents: o.amount_total_cents,
    shipping_cents: o.shipping_cents,
    shipping_label: o.shipping_label,
    discount_cents: o.discount_cents,
    tax_cents: o.tax_cents,
    currency: o.currency,
    status: o.status,
    payment_method: o.payment_method,
    provider_refunded_cents: o.provider_refunded_cents,
    external_refunded_cents: o.external_refunded_cents,
    refunded_cents: o.refunded_cents,
    refund_review_reason: o.refund_review_reason,
    fulfillment_status: o.fulfillment_status,
    tracking_carrier: o.tracking_carrier,
    tracking_number: o.tracking_number,
    fulfilled_at: o.fulfilled_at,
    ship_address: shipAddress,
    created_at: o.created_at,
  };
}

function orderItemDto(i: OrderItem) {
  return { name: i.name, quantity: i.quantity, price_cents: i.price_cents };
}

function refundDto(r: Refund) {
  return {
    id: r.public_id, // preserved legacy UUID or rfnd_… — never the row ID
    amount_cents: r.amount_cents,
    status: r.status,
    kind: r.kind,
    reason: r.reason,
    note: r.note,
    created_at: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Boundary resolution — public-ID (or slug) input → internal row, with clear
// errors. Numeric row IDs are rejected outright, never resolved.
// ---------------------------------------------------------------------------

/** Resolve a `prod_…` public ID or slug (convenience) to a product row. */
async function resolveProduct(db: D1Database, id: string): Promise<Product | null | 'numeric'> {
  const trimmed = id.trim();
  if (/^\d+$/.test(trimmed)) return 'numeric';
  const publicId = parsePublicId(trimmed, 'product');
  if (publicId) return getProductByPublicId(db, publicId);
  return getProductBySlug(db, trimmed);
}

const NUMERIC_PRODUCT_ERROR =
  'Numeric row IDs are not accepted. Pass the prod_… public ID (or the slug).';
const NUMERIC_ORDER_ERROR =
  'Numeric row IDs are not accepted. Pass the ord_… public ID (or a legacy order public ID).';

/**
 * minshop MCP server — lets an assistant operate the store (read orders/products,
 * create/update products, fulfill orders) over the same D1 the storefront uses.
 * Stateless tools; the McpAgent Durable Object only holds the MCP session.
 *
 * Version 2.0.0: breaking identifier change — all tools take and return
 * prefixed public IDs (prod_/ord_/rfnd_…); numeric row IDs are rejected.
 */
/**
 * Which tool tier a session was opened in. Decided once by the fetch handler
 * and carried into the Durable Object as props, so it cannot change mid-session:
 * a buyer session stays a buyer session for its lifetime.
 */
export interface SessionProps extends Record<string, unknown> {
  operator: boolean;
  actor?: string;
  // New dashboard-issued credentials are read-only, even if a global write
  // scope is later enabled for the legacy bearer or verified Access owner.
  readOnly?: boolean;
}

export class StoreMcp extends McpAgent<Env, Record<string, never>, SessionProps> {
  server = new McpServer({ name: 'minshop', version: '2.0.0' });
  initialState = {};

  /**
   * Buyer tools proxy the storefront's PUBLIC JSON API rather than querying D1.
   * That is deliberate: checkout needs reservations, provider adapters, and the
   * secret vault, none of which this Worker has — and routing every buyer tool
   * through the public API bounds the tier's blast radius by construction. A
   * buyer tool cannot leak admin data because it can only reach public URLs.
   */
  private async storefront(path: string, init?: RequestInit): Promise<unknown> {
    const base = this.env.STOREFRONT_URL?.replace(/\/+$/, '');
    if (!base) throw new Error('STOREFRONT_URL is not configured for this Worker.');
    const response = await fetch(`${base}${path}`, init);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: `Storefront returned ${response.status}`, body: text.slice(0, 500) };
    }
  }

  async init() {
    const db = this.env.DB;

    // --- buyer tier: always registered, no token required ---
    this.server.registerTool(
      'browse_products',
      {
        description:
          'Search or list products a shopper can buy. Active, in-stock-aware public ' +
          'catalog with prod_… public IDs, prices, and absolute URLs.',
        inputSchema: {
          q: z.string().optional().describe('Search query; omit to list'),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        },
      },
      async ({ q, limit, offset }) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (limit != null) params.set('limit', String(limit));
        if (offset != null) params.set('offset', String(offset));
        const qs = params.toString();
        return result(await this.storefront(`/api/products${qs ? `?${qs}` : ''}`));
      },
    );

    this.server.registerTool(
      'get_product_details',
      {
        description: 'Full public detail for one product, by its storefront slug.',
        inputSchema: { slug: z.string().min(1).describe('Product slug from browse_products') },
      },
      async ({ slug }) =>
        result(await this.storefront(`/api/products/${encodeURIComponent(slug)}`)),
    );

    this.server.registerTool(
      'payment_methods',
      {
        description: 'Which payment rails this store accepts, and its default.',
        inputSchema: {},
      },
      async () => result(await this.storefront('/api/checkout')),
    );

    // A read-only owner credential must not inherit the buyer checkout writer.
    if (canCreateCheckout(this.props)) this.server.registerTool(
      'create_checkout',
      {
        description:
          'Start a purchase. Returns checkout_url, order_status_url, and — on the ' +
          'lightning rail — a payable BOLT11 invoice an agent can settle with no human. ' +
          'Poll order_status_url until it reports paid.',
        inputSchema: {
          items: z
            .array(
              z.object({
                product_id: z.string().optional().describe('prod_… public ID'),
                slug: z.string().optional(),
                variant_id: z.string().optional().describe('var_… public ID'),
                quantity: z.number().int().min(1).default(1),
              }),
            )
            .min(1),
          method: z.string().optional().describe('One of payment_methods; omit for the default'),
          discount_code: z.string().optional(),
          ship_to: z.record(z.string(), z.string()).optional().describe('Required for physical goods'),
        },
      },
      async (args) =>
        result(
          await this.storefront('/api/checkout', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(args),
          }),
        ),
    );

    this.server.registerTool(
      'check_order_status',
      {
        description:
          'Poll a checkout using the order_status_url token from create_checkout. ' +
          'Reports confirming/paid/refunded and any download URLs for digital goods.',
        inputSchema: { token: z.string().min(1).describe('The otk_… token from order_status_url') },
      },
      async ({ token }) =>
        result(await this.storefront(`/order/${encodeURIComponent(token)}/status`)),
    );

    // --- operator tier: only when a valid MCP_TOKEN was presented ---
    if (!this.props?.operator) return;

    // A valid operator token enables sensitive reads, NOT automatic write access.
    // All operator writes require this explicit config switch; default is off.
    const writeEnv = this.env as Env & {
      PURKINS_MCP_WRITES_ENABLED?: string;
      PURKINS_MCP_LEGACY_WRITES_ENABLED?: string;
      PURKINS_MCP_LOCATION_WRITES_ENABLED?: string;
      PURKINS_MCP_STOCK_WRITES_ENABLED?: string;
      PURKINS_MCP_CLOTHING_WRITES_ENABLED?: string;
      PURKINS_MCP_GALLERY_WRITES_ENABLED?: string;
    };
    const allowWrites = canWriteAsOperator(this.props, writeEnv.PURKINS_MCP_WRITES_ENABLED);
    // Old stock/product/order/image mutators do not yet have durable per-request
    // receipts. A general write switch alone must NEVER expose them.
    const allowLegacyWrites = allowWrites &&
      writeEnv.PURKINS_MCP_LEGACY_WRITES_ENABLED === 'true';
    registerPurkinsTools(this.server, db, allowLegacyWrites);
    const allowStockWrites = allowWrites &&
      writeEnv.PURKINS_MCP_STOCK_WRITES_ENABLED === 'true' &&
      Boolean(this.props.actor);
    registerGuardedPurkinsStockTools(this.server, db, allowStockWrites, this.props.actor);
    const allowClothingWrites = allowStockWrites &&
      writeEnv.PURKINS_MCP_CLOTHING_WRITES_ENABLED === 'true';
    registerGuardedClothingIntakeTools(this.server, db, allowClothingWrites, this.props.actor);
    const mediaEnv = this.env as Env & {
      BUCKET?: Parameters<typeof createR2Storage>[0];
      PURKINS_MCP_IMAGE_IMPORT_HOSTS?: string;
    };
    const imageImportAllowedHosts = (mediaEnv.PURKINS_MCP_IMAGE_IMPORT_HOSTS ?? '')
      .split(',').map(host => host.trim()).filter(Boolean);
    registerPurkinsMediaTools(
      this.server, db, mediaEnv.BUCKET, allowLegacyWrites, imageImportAllowedHosts,
    );
    // Gallery writes use a separate, receipt-backed D1 scope. They do NOT
    // activate the older media import/attach/alt writers.
    const allowGalleryWrites = allowWrites &&
      writeEnv.PURKINS_MCP_GALLERY_WRITES_ENABLED === 'true' &&
      Boolean(this.props.actor);
    registerGuardedPurkinsGalleryTools(
      this.server, db, allowGalleryWrites, this.props.actor,
    );
    const allowLocationWrites = allowWrites &&
      writeEnv.PURKINS_MCP_LOCATION_WRITES_ENABLED === 'true' &&
      Boolean(this.props.actor);
    registerLocationTools(this.server, db, allowLocationWrites, this.props.actor);
    registerCategoryTools(this.server, db);

    // --- reads ---
    this.server.registerTool(
      'list_products',
      {
        description:
          'List products (admin view: includes inactive + units sold), one page at a time. ' +
          'Each product id is its prod_… public ID.',
        inputSchema: {
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().nonnegative().default(0),
        },
      },
      async ({ limit, offset }) =>
        result({
          products: (await listAllProducts(db, limit, offset)).map(adminProductDto),
          total: await countAllProducts(db),
          limit,
          offset,
        }),
    );

    this.server.registerTool(
      'get_product',
      {
        description: 'Get one product by its prod_… public ID, or by slug as a convenience.',
        inputSchema: { id: z.string().min(1).describe('prod_… public ID, or a slug') },
      },
      async ({ id }) => {
        const p = await resolveProduct(db, id);
        if (p === 'numeric') return result(NUMERIC_PRODUCT_ERROR);
        return p ? result(productDto(p)) : result(`No product with id ${id}.`);
      },
    );

    this.server.registerTool(
      'list_orders',
      {
        description:
          'List orders, newest first, one page at a time. Each order id is its ord_… public ID ' +
          '(or a preserved legacy public ID); reference is the customer-facing order reference.',
        inputSchema: {
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().nonnegative().default(0),
        },
      },
      async ({ limit, offset }) =>
        result({
          orders: (await listOrders(db, limit, 'created_at DESC', offset)).map(orderDto),
          total: await countOrders(db),
          limit,
          offset,
        }),
    );

    this.server.registerTool(
      'get_order',
      {
        description:
          'Get an order plus its line items and refund history, by its ord_… public ID (legacy ' +
          'public IDs are also accepted). Refunds are read-only: order.provider_refunded_cents ' +
          'is the total the payment provider confirmed and order.external_refunded_cents is ' +
          'what was recorded by hand; order.refunded_cents is their sum, capped at the order ' +
          'total. Each refund amount_cents is a delta, not a running total, and is negative ' +
          'for a correction.',
        inputSchema: { id: z.string().min(1).describe('ord_… public ID (or legacy public ID)') },
      },
      async ({ id }) => {
        if (/^\d+$/.test(id.trim())) return result(NUMERIC_ORDER_ERROR);
        const publicId = parseOrderOrLegacyPublicId(id, 'order');
        if (!publicId) return result(`Invalid order id ${id} — expected an ord_… public ID.`);
        const order = await getOrderByPublicId(db, publicId);
        if (!order) return result(`No order with id ${id}.`);
        return result({
          order: orderDto(order),
          items: (await listOrderItems(db, order.id)).map(orderItemDto),
          refunds: (await listRefunds(db, order.id)).map(refundDto),
        });
      },
    );

    this.server.registerTool(
      'order_stats',
      { description: 'Store totals: order count, net revenue (cents), refunded (cents).', inputSchema: {} },
      async () => result(await orderStats(db)),
    );

    this.server.registerTool(
      'daily_totals',
      {
        description: 'Orders + net revenue per day for the last N days (UTC).',
        inputSchema: { days: z.number().int().min(1).max(90).default(14) },
      },
      async ({ days }) => result(await dailyOrderTotals(db, days)),
    );

    // --- writes: token AND explicit instance-level enablement required ---
    if (!allowLegacyWrites) return;
    this.server.registerTool(
      'create_product',
      {
        description:
          'Create a product. price_cents is integer cents; slug is auto-generated from the ' +
          'name. Returns the new prod_… public ID and slug.',
        inputSchema: {
          name: z.string().min(1),
          price_cents: z.number().int().nonnegative(),
          description: z.string().optional(),
          stock: z.number().int().nonnegative().default(0),
          currency: z.string().default('usd'),
          active: z.boolean().default(false),
        },
      },
      async ({ name, price_cents, description, stock, currency, active }) => {
        if (active) return result({error: 'Purkins stock cannot be published on creation. Use create_purkins_stock, then explicit approval.'});
        const slug = await uniqueSlug(db, slugify(name));
        const input: ProductInput = {
          name,
          slug,
          description: description ?? null,
          price_cents,
          currency,
          image_key: null,
          stock,
          active: 0,
          // Weight is set in Admin (it needs the store's display unit); a new
          // product starts shippable with an unknown weight, which is harmless
          // until a weight-priced rate exists.
          weight_grams: null,
          requires_shipping: 1,
        };
        const rowId = await createProduct(db, input);
        // Compatibility tool stays safe: every Purkins item needs private intake.
        const blank = parseIntakeFields(new FormData());
        if ('error' in blank) throw new Error(blank.error);
        try {
          await insertIntake(db, rowId, {...blank.data, condition_status: 'review'});
        } catch (error) {
          await db.prepare('DELETE FROM products WHERE id=?').bind(rowId).run();
          throw error;
        }
        const created = await getProduct(db, rowId);
        return result({ id: requirePublicId(created?.public_id ?? null, rowId, 'product'), slug });
      },
    );

    this.server.registerTool(
      'update_product',
      {
        description:
          'Update an existing product by its prod_… public ID (or slug). Only the fields you ' +
          'pass change; the rest are kept.',
        inputSchema: {
          id: z.string().min(1).describe('prod_… public ID, or a slug'),
          name: z.string().min(1).optional(),
          price_cents: z.number().int().nonnegative().optional(),
          description: z.string().nullable().optional(),
          stock: z.number().int().nonnegative().optional(),
          currency: z.string().optional(),
          active: z.boolean().optional(),
        },
      },
      async ({ id, name, price_cents, description, stock, currency, active }) => {
        const cur = await resolveProduct(db, id);
        if (cur === 'numeric') return result(NUMERIC_PRODUCT_ERROR);
        if (!cur) return result(`No product with id ${id}.`);
        if (active === true) return result({error: 'Direct publication through update_product is blocked. Use approve_purkins_stock.'});
        const input: ProductInput = {
          name: name ?? cur.name,
          slug: cur.slug,
          description: description !== undefined ? description : cur.description,
          price_cents: price_cents ?? cur.price_cents,
          currency: currency ?? cur.currency,
          image_key: cur.image_key,
          stock: stock ?? cur.stock,
          active: 0,
          // Not editable here, but must be carried: updateProduct writes every
          // column, so omitting these would silently clear them.
          weight_grams: cur.weight_grams,
          requires_shipping: cur.requires_shipping,
        };
        await updateProduct(db, cur.id, input);
        // A generic edit must never preserve an old stock approval.
        const currentIntake = await getIntake(db, cur.id);
        if (currentIntake) {
          await saveIntakeDraft(db, cur.id, currentIntake);
        } else {
          const blank = parseIntakeFields(new FormData());
          if ('error' in blank) throw new Error(blank.error);
          await insertIntake(db, cur.id, {...blank.data, condition_status: 'review'});
        }
        return result({ id: requirePublicId(cur.public_id, cur.id, 'product'), slug: cur.slug, active: false, status: 'draft' });
      },
    );

    this.server.registerTool(
      'fulfill_order',
      {
        description:
          'Mark an order fulfilled (shipped) by its ord_… public ID (legacy public IDs are ' +
          'also accepted), with optional carrier + tracking number.',
        inputSchema: {
          id: z.string().min(1).describe('ord_… public ID (or legacy public ID)'),
          carrier: z.string().optional(),
          tracking_number: z.string().optional(),
        },
      },
      async ({ id, carrier, tracking_number }) => {
        if (/^\d+$/.test(id.trim())) return result(NUMERIC_ORDER_ERROR);
        const publicId = parseOrderOrLegacyPublicId(id, 'order');
        if (!publicId) return result(`Invalid order id ${id} — expected an ord_… public ID.`);
        const order = await getOrderByPublicId(db, publicId);
        if (!order) return result(`No order with id ${id}.`);
        await fulfillOrder(db, order.id, carrier ?? null, tracking_number ?? null);
        return result({ fulfilled: publicId, reference: orderReference(publicId) });
      },
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/mcp')) {
      // Two tiers, decided here and carried into the session as props.
      //
      // No Authorization header  -> buyer tier: browse + checkout, public data only.
      // Valid Bearer MCP_TOKEN   -> operator tier: adds order/revenue reads and writes.
      // Invalid Bearer           -> 401, NOT a silent downgrade. A client that meant
      //                             to authenticate must not quietly get fewer tools
      //                             and discover it as "tool not found" three calls later.
      //
      // MCP_TOKEN unset means the operator tier is unavailable — the store can still
      // sell to agents. That is a deliberate change from failing the whole server
      // closed: the buyer tier exposes nothing the public JSON API does not.
      const auth = request.headers.get('Authorization');
      const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion');
      const accessEnv = env as Env & {
        CF_ACCESS_TEAM_DOMAIN?: string;
        CF_ACCESS_AUD?: string;
        PURKINS_MCP_ACCESS_AUD?: string;
        PURKINS_MCP_OWNER_EMAIL?: string;
      };
      let operator = false;
      let actor: string | undefined;
      let readOnly = false;
      // Legacy MCP clients with a separately provisioned operator secret.
      if (auth && env.MCP_TOKEN && await secureEqual(auth, `Bearer ${env.MCP_TOKEN}`)) {
        operator = true;
        actor = 'owner:bearer';
      }
      // Individually revocable read-only credentials take precedence over any
      // Access identity forwarded by the edge. An expired/revoked/invalid pmcp_
      // token MUST NOT fall through into a more privileged Access owner session.
      if (!operator && auth?.startsWith('Bearer pmcp_')) {
        try {
          const client = await authenticateMcpClientToken(
            env.DB, auth, accessEnv.PURKINS_MCP_OWNER_EMAIL,
          );
          if (!client) {
            return new Response('Revoked, expired or invalid MCP client token.', {
              status: 401, headers: { 'cache-control': 'no-store' },
            });
          }
          operator = true;
          actor = client.actor;
          readOnly = true;
        } catch {
          return new Response('MCP credential verification unavailable.', {
            status: 503, headers: { 'cache-control': 'no-store' },
          });
        }
      }
      // Cloudflare Access Managed OAuth clients. Do NOT trust a bare header:
      // independently verify signature, issuer, audience, lifetime and owner
      // identity, even when the normal Cloudflare Access edge is bypassed.
      if (!operator && accessJwt && accessEnv.CF_ACCESS_TEAM_DOMAIN) {
        const aud = accessEnv.PURKINS_MCP_ACCESS_AUD || accessEnv.CF_ACCESS_AUD;
        if (aud) {
          try {
            const identity = await verifyAccessJwt(accessJwt, {
              teamDomain: accessEnv.CF_ACCESS_TEAM_DOMAIN, aud,
            });
            // An application-scoped signature proves the Access application,
            // not that this person is the Purkins owner. Fail closed without
            // an explicit owner email allowlist value.
            operator = isApprovedMcpOwner(identity?.email, accessEnv.PURKINS_MCP_OWNER_EMAIL);
            if (operator) actor = 'owner:access:' + identity!.email.trim().toLowerCase();
          } catch {
            operator = false; // no JWKS → fail closed
          }
        }
      }
      if (!operator && (auth || accessJwt)) {
        return new Response('Unauthorized operator MCP connection.', {
          status: 401, headers: {'cache-control': 'no-store'},
        });
      }

      // Throttle the buyer tier. This Worker is the ONLY component that sees the
      // real client: buyer tools proxy the storefront over public HTTPS without
      // forwarding cf-connecting-ip, so the storefront's per-IP limiter collapses
      // every MCP buyer into one bucket — which both fails to throttle any single
      // caller and lets one of them 429 all the others. Limit here, where the
      // address is real. Operator sessions hold a secret and are not throttled.
      if (!operator && env.MCP_RATE_LIMITER) {
        const client = request.headers.get('cf-connecting-ip')?.trim() || 'unknown-client';
        try {
          const { success } = await env.MCP_RATE_LIMITER.limit({ key: `mcp:${client}` });
          if (!success) {
            return new Response('Too many requests. Try again shortly.', {
              status: 429,
              headers: { 'retry-after': '60', 'cache-control': 'no-store' },
            });
          }
        } catch {
          // A limiter outage must not take the store offline; the storefront's
          // own checkout limiter is still downstream of every buyer purchase.
        }
      }

      // The SDK reads session props off the ExecutionContext (the same channel the
      // Workers OAuth Provider uses). Cloudflare's types declare `props` readonly,
      // so assign through Object.assign rather than casting the readonly away.
      Object.assign(ctx, { props: { operator, actor, readOnly } satisfies SessionProps });
      return StoreMcp.serve('/mcp', { binding: 'STORE_MCP' }).fetch(request, env, ctx);
    }

    return new Response(
      'minshop MCP server — POST /mcp (streamable HTTP). Browse and checkout need no ' +
        'auth; operator tools need Authorization: Bearer <MCP_TOKEN>.',
      { status: 404 },
    );
  },
} satisfies ExportedHandler<Env>;
