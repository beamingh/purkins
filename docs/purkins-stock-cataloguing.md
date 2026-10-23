# Purkins stock catalogue: admin + MCP

Purkins stock stays unpublished until an owner explicitly approves it. The generic Minshop
MCP product writes are draft-only in this fork. Buyer MCP tools never receive purchase
costs, supplier barcodes, storage locations or internal condition notes.

## How to encode physically received stock

- **One product** represents one sellable item or bundle design (e.g. *Grey melange babygrow*).
- **Variants** represent sizes and colours with separate on-hand stock and optional private
  supplier barcode (e.g. newborn / 0-3m / 3-6m). Use unique labels including colour if needed.
- **Stock quantity counts packages being sold**, not pieces inside them. A 3-pack of bibs
  with one sealed package in stock has stock=1 and pack_count=3.
- **SKU**: the parent receives a stable `PUR-000001` code. MCP-created variants receive
  `PUR-000001-V01` etc unless given an internal SKU; existing Admin variant SKU inputs can be used.
- **Supplier barcode** is a separate text field, at parent level for single-size items or
  per variant for differently barcoded sizes. Preserve leading zeroes. No EAN/UPC validity
  assumption. A barcode is not a Purkins SKU.
- **Original retail tag** (e.g. R69.99) is a reference, *not* purchase cost. Keep
  retail_tag_minor and purchase_cost_minor separate. Never infer exchange rate, overhead,
  purchase cost, markup or ZMW selling price from the supplier tag.
- **Storage location** is a private free-text path such as
  `Grey Sack / Blue PEP Plastic Bag` or `Pick n Pay White Bag A`.
- **Unknown counts**: use zero stock and condition_status=review, and record
  'Quantity not counted' in notes. Zero here is a safe placeholder, not a confirmed count.
- **Incomplete or questionable packs**: condition_status=incomplete/review, describe
  missing pieces in private notes. Approval is blocked until condition is complete.

## Sample acceptance cases

| Physical stock | Catalogue model |
| --- | --- |
| Grey melange babygrow, R69.99 | One product; 3-6m stock 8 code 111992810002, 0-3m stock 2 code 111992710003, newborn stock 4 code 111992610003; R69.99 stored as retail tag |
| White entry cotton, R69.99 | One product; 3-6m=3, 0-3m=3, 6-12m=1 |
| White body vests, 2-pack R59.99 | One 2-pack product; 0-3m=8, newborn=1. A single 2-pack is stock 1, not 2 |
| White body vests, single R27.99 | Separate product from 2-pack; 0-3m=6 and 3-6m=4 |
| Real Baby Novel Zebra set R99.99 | One product; newborn=1, 0-3m=3, 3-6m=3 |
| Real Baby Apple 2-pack bodyvest | One product; 3-6m, supplier barcode 6009241909039, pack_count=2 |
| Real Baby off-white dress / bloomer set | One product; supplier barcode 6009241665157, R169.99 tag, two-piece bundle |
| Safari Dream 2-pack leggings | One product; supplier barcode 117939910001, 0-3m, R89.99 tag |
| Socks with missing yellow sock | Separate incomplete/review item, never merged with an intact set without inspection |

## MCP write safety

**Private operator access does not automatically grant write permission.**
All Purkins and generic Minshop operator MCP write tools are *not registered*
unless the Worker is configured with `PURKINS_MCP_WRITES_ENABLED=true`;
the checked-in Wrangler template explicitly sets it to `false`.
Keep it false in production until per-user permissions, audit logs, duplicate
request/idempotency protection and concurrent edit handling have been reviewed.
Buyer-facing public tools remain distinct and do not receive private cost data.

## Operator-only MCP tools

- `list_purkins_stock`: paginate draft and approved stock with private metadata.
- `search_purkins_stock`: locate by name, brand, storage location, Purkins SKU,
  supplier parent barcode or supplier size barcode.
- `get_purkins_stock`: retrieve full details by product public ID or slug.
- `create_purkins_stock`: create draft product with optional size variants. Parent
  and variants are never published; missing values remain unknown.
- `update_purkins_stock`: edit product and private metadata, revoking any approval.
- `set_purkins_variant`: add or update a size/colour and its private supplier code.
- `approve_purkins_stock`: intentional publish requiring confirm_publish=true,
  valid landed cost, a photo, full condition and non-loss-making active variant prices.

The generic `create_product` / `update_product` MCP commands must not turn Purkins
stock active or retain approval through edits. New Admin products remain private.

## Deployment and limitations

Apply migrations 0040 and 0041 to the same D1 bound to both Workers before
deploying either updated Worker. Production changes require owner approval:
no inventory was imported by this feature, no live D1 was touched.

The operator MCP Worker currently does not have the public image storage binding
or an admin session; upload/attach photos via the protected admin media workflow
before approval. For the same product stored in *multiple* locations, the current
intake model stores one location path; use notes for overflow stock until a
per-location stock ledger is added. Use variant stock as the authoritative
quantity for sized products, not the legacy parent stock snapshot.

Validation after pulling the feature branch: `npm test`, `npm run check`,
`npm run mcp:check`. The last check is type validation plus a local dry run,
not a production deployment.
