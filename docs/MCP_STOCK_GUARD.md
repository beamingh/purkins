# Purkins MCP secure product and inventory operations — phase 1

Status: **draft PR #14**, not deployed or merged.

## Purpose

The legacy MCP `create_purkins_stock`, `update_purkins_stock`,
`set_purkins_variant`, and `approve_purkins_stock` tools remain behind
`PURKINS_MCP_LEGACY_WRITES_ENABLED` (OFF by default). Those handlers perform
several independent D1 operations, so retries and concurrent writes can
leave partial or unexpected state. Do not turn that legacy scope on to
make catalogue management available.

This PR introduces a *separate* audited owner-only stock-write scope:
`PURKINS_MCP_WRITES_ENABLED=true` AND
`PURKINS_MCP_STOCK_WRITES_ENABLED=true`. Both are OFF by default.
A valid operator session is independently required; buyers cannot see
the tools.

## New MCP tools

- `create_guarded_purkins_draft`: Creates one **unpublished, non-variant**
  product and private intake record in the same D1 batch. Requires a UUIDv4
  `request_id`, product name, stock count, price in **integer ZMW cents**,
  private intake details, and optionally an existing immutable `loc_` storage
  location. Supports manual/cost-based intake fields validated using the same
  `parseIntakeFields` domain parser as Admin. Does not automatically create
  a new sack, infer a cost, attach media, publish, or send a notification.
  Same request ID and payload return the original result instead of
  duplicating inventory; a different actor or payload is rejected.
- `adjust_guarded_purkins_stock`: Changes an existing draft/unpublished
  product or size variant stock count, using the current `expected_stock`
  and `expected_revision` from `get_purkins_stock`. Requires a new UUIDv4
  request ID for each distinct edit. Refuses stale versions, published items,
  mismatched variant/product ownership, and unversioned requests. Never
  creates a sale or changes a paid order.
- `get_purkins_stock` and private stock listings additionally expose
  `stock_revision` for products and variants.

## Database and invariants

Migration `0046_purkins_mcp_stock_guard.sql` creates a separate restricted
stock write-receipt table and revision/nonce columns for product and variant
stock. Two SQL triggers increment revisions whenever stock actually changes,
**including existing Admin, checkout and manual-sale stock updates**.
This defeats quantity ABA changes (5 → 4 → 5) that checking count alone
would miss.

Operations record actor, action, request ID, SHA-256 of normalized input,
target public ID, original/revised quantity and outcome. No full input,
supplier barcode, personal customer data, bearer token or JWT is stored in
the ledger. The current user's actor is derived from verified MCP session
context, not tool arguments.

Receipt acquisition, guarded product or stock mutation, and outcome logging
occur in **one atomic D1 batch**. Each attempt's server nonce prevents a
concurrent duplicate request from modifying inventory twice.

For simplicity and safety, draft creation does **not** create multiple
variants yet. Existing product/stock updaters remain disabled behind legacy
scope. Price edits, variant creation, media association, product publication,
returns/refunds and paid sales will require separate guard-and-approval
flows. No automatic cache purge is needed for mutations that are refused
for published products; do not extend this to public writes without
cross-Worker cache invalidation.

## Required testing

```powershell
git fetch origin
git switch --track origin/feat/purkins-mcp-stock-guard
npm run check
npx vitest run src/features/mcp/stockGuard.integration.test.ts mcp/src/stock-guard.test.ts src/features/mcp/writeGuard.integration.test.ts
npm run mcp:check
npm test
npm run build:workers
```

All tools remain inactive by default. None of these checks deploys Workers,
applies remote migrations or enables writes. The new test cases are
authored but **not yet run in the user's local checkout**.

## Deployment and migration ordering

Migration 0046 is required before deploying the new code. The existing
`scripts/purkins-permanent.mjs` migration checkpoint from PR #13
requires a separately confirmed migration through the latest
`0046_purkins_mcp_stock_guard.sql` before deploy or write activation.
Do not deploy directly using Wrangler or bypass this checkpoint.

Remote release, Cloudflare Access owner OAuth, live HTTP unauthorized/owner
tests and real stock-change acceptance must be separately approved after
the local checks pass. Keep all MCP write flags false in production.
