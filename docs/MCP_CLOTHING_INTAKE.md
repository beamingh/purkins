# Purkins MCP — guarded bulk clothing intake (PR #15)

Status: draft implementation on `feat/purkins-mcp-clothing-intake`. **Not deployed, not migrated remotely, writes OFF.** This adds to the merged PR #12–14 foundation.

## Scope

The `bulk_create_guarded_clothing_drafts` owner tool accepts 1–8 products per call. Every product has 1–20 size/colour variants and its **own UUIDv4 request_id**. All information is private and draft-only at creation. A single product and *all* of its variants, private source tags, supplier barcodes, and receipt are committed in **one atomic D1 batch**.

**Batch semantics:** a bulk request is **not all-or-nothing across products**. Each product transaction commits independently; a conflicting product is reported without undoing other products. A transient infrastructure failure stops further work and returns `stopped_early=true`; resubmit the same product IDs to reconcile safely. A replay of an already committed request cannot double stock. Never generate a new request ID merely because the transport timed out.

### Example: one grey babygrow listing

| Variant | Quantity | Supplier retail tag | Private supplier barcode |
|---|---:|---:|---|
| Grey / Newborn | 3 | R69.99 | `001234567890` (example) |
| Grey / 0–3 months | 1 | R69.99 | blank |
| Grey / 3–6 months | 7 | R79.99 | blank |

One inactive product holds **11 units** in three `var_` rows; private per-variant details include explicit size, colour, pack count and original tagged price. Retail tags are **not** purchase costs, and are recorded as integer cents (e.g. `6999` for R69.99) with an independent `ZAR` currency. Selling prices are independently recorded in **ZMW cents**.

The product-level `intake` fields reuse the same `parseIntakeFields` validation as the Admin editor: known purchase currency/cost, exchange rate when applicable, overhead, pricing mode, brand, supplier barcode, condition and notes. Costs are product-level; this PR does not pretend to track different *purchase costs* per variant. Size-specific **retail tag prices** and **selling prices** may differ.

An existing `loc_` location ID is accepted. The service refuses invented paths and nonexistent locations. Do not infer bag or sack hierarchy from descriptions. Names must be differentiated enough to get a distinct product slug. The internal `PUR-000001-V01` SKU scheme is generated from the new row ID and is independent of the supplier barcode (including leading zeroes).

## Technical safeguards

Migration `0047_purkins_mcp_clothing_intake.sql` adds:
- `purkins_mcp_clothing_receipts` with a unique per-product request ID, verified owner actor label, SHA-256 of normalized product input, per-attempt nonce, generated public product ID, total units, expected variant and supplier-code counts, and a database-enforced completion marker
- Private `purkins_variant_intake_details` table for size, colour, original retail tag amount/currency and pack count; never exposed in buyer tools

Every INSERT checks the current attempt nonce. Completion verifies the matching private intake row, **all** expected variant records and variant-detail records, and all nonempty variant supplier barcodes. A constraint aborts/rolls back the entire D1 batch if any expected record is missing. An unrelated concurrent request using the same UUID cannot add or duplicate stock. Same actor+UUID+payload replays; changed actor/payload rejects.

The existing MCP stock read tools now show private variant tag and pack metadata for operator inventory reconciliation. The buyer tier still uses separate public storefront APIs.

**Registration requires all of:**
1. Verified owner session, with actor derived from authentication, not user tool arguments
2. `PURKINS_MCP_WRITES_ENABLED=true`
3. `PURKINS_MCP_STOCK_WRITES_ENABLED=true`
4. `PURKINS_MCP_CLOTHING_WRITES_ENABLED=true`

All three write flags default to **false**, including the new clothing switch. Legacy unsafe MCP writes remain separately disabled.

## Out of scope, deliberately

- No direct arbitrary photo bytes via MCP. Chat attachments are not automatically available to the Worker. Use Admin Media to upload photos; a guarded media-association step with R2 and D1 safety is still needed.
- No publication or unpublication; no bulk approval.
- No stock changes to published products, refunds, order fulfillment, or manual sales. Those are separate controlled workflows.
- No mutation of existing product/variant metadata in this tool; it only creates new unpublished clothing product groups. Existing `adjust_guarded_purkins_stock` covers draft quantity corrections under its own scope.
- A bulk call can partially succeed *across products*. Its response explicitly lists each result and whether processing stopped early. Users/operators must review the response.

## Verification and rollout

Safe local checks (no remote database or Cloudflare modifications):

```powershell
git fetch origin
git switch --track origin/feat/purkins-mcp-clothing-intake
npm run check
npx vitest run src/features/mcp/clothingIntake.integration.test.ts mcp/src/clothing-intake.test.ts src/features/mcp/stockGuard.integration.test.ts
npm run mcp:check
npm test
npm run build:workers
```

Tests include Miniflare-backed isolated D1 success, exact idempotency replay, mismatched payload/actor, private tagged pricing and leading-zero supplier barcodes, duplicate labels, invalid quantities, invalid/existing locations, partial bulk success and retry, and a simulated mid-insert failure that must roll back the entire product. **These newly authored tests are not yet verified by a user local run.**

**Migration order:** the permanent D1 must be migrated through `0047_purkins_mcp_clothing_intake.sql` before deploying either revision that queries `purkins_variant_intake_details`. The existing permanent deployment script refuses stale migration checkpoints; do not bypass it. No automatic migration, Worker deploy or write activation is part of this PR. Live read-only owner MCP acceptance and separately approved production write activation are still future release gates.
