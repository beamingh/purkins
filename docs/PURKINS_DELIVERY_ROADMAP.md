# Purkins delivery roadmap — stock to first sale

**Updated 23 October 2026.** Source of truth: Minshop/Astro Workers + D1/R2.
Owner is the only operator for now. Prioritize first usable retail sales and rapid
stock cataloguing; avoid expanding generic Minshop features that do not support
that goal.

## Branch and rollout gates

- **main** — last consolidated baseline; not production-approved.
- **PR #3: feat/rapid-stock-intake-desk → main** — photo-first
  Save & Next, manual/cost pricing, duplicate hints and reusable legacy
  storage selector. Await final checks and merge.
- **PR #4: feat/purkins-hierarchical-locations → feat/rapid-stock-intake-desk** —
  stacked branch with location tree, backfill, Admin location manager and
  location-id stock intake. Merge PR #3 first; retarget/rebase the location
  PR onto `main` when #3 is merged. Do **not** ship or apply migrations
  against existing remote Purkins or SeeZambia resources.
- Database migrations in order: **0040 → 0041 → 0042 → 0043**.
  Fresh and upgrade-path D1 checks are release requirements.

## Delivery milestones

| Priority | Feature | Deliverable / acceptance gate | Current status |
| --- | --- | --- | --- |
| P0 | Rapid Stock Intake | Photo-first draft, Save & Next, manual ZMW price, duplicate hints, variant/pack awareness | PR #3 draft; user smoke-tested initial form |
| P0 | Hierarchical locations | Stable `loc_...` IDs; rooms/sacks/bags; add child, move container, no ancestry cycles; moving parent updates private stock path | Stacked branch in progress |
| P0 | **Cloudflare staging** | Separate Worker + D1 + image/private R2 buckets; PowerShell/Node provisioning, isolated migration & secrets, Access-protected Admin | Planned; no remote mutations |
| P0 | **MCP read-only integration** | Deployed separate Durable Object-backed MCP Worker; reject invalid token; distinguish operator-private vs buyer-public tools; writes OFF | Source implemented; live verification pending |
| P1 | **MCP controlled writes** | Scoped operator permissions, audit log, idempotent draft creates, concurrency checks, revocation and read/write boundary tests before enabling | Not implemented / writes OFF |
| P1 | **Batch stock intake** | Add multiple sizes and quantities/photo groups at once, camera barcode scanning + manual fallback, validation/recovery on interrupted sessions, CSV import/export | Not implemented |
| P1 | **Multi-location stock ledger** | Allocate SKU/variant quantity to several containers, transfers and stocktake adjustments, prevent double-counting during checkout | Not implemented; location tree is prerequisite |
| P1 | **Trip landed-cost and pricing** | ZAR costs and exchange rate, allocated South Africa transport/lodging, minimum cost recovery and gross profit, retain optional manual pricing | Basic per-item pricing present; batch allocation missing |
| P1 | **Store operations dashboard** | Unpriced items, no-photo drafts, incomplete packs, low stock, recent orders, inventory cost and next actions | Not implemented |
| P1 | **Checkout and first-sale readiness** | Zambia payment acceptance strategy (MTN/Airtel), pickup/delivery rules, order notifications, demo-to-real payment and oversell protection | Generic store foundation only; local launch checks pending |
| P2 | **Labels & stocktaking tools** | Print Purkins internal SKUs, scan supplier barcodes, label shelves/bags, reconcile physical counts | Planned |

## Operational constraints

1. Each storage location has one parent (or none), may have many children and a
   stable ID. A product has **one primary location** in this first version. A
   future per-variant **stock placement ledger** must supersede that assumption.
2. Legacy `storage_location` strings migrate into independent root nodes,
   **not** guessed slash-delimited hierarchies. Operators can rehome those
   nodes. Display paths must always be dynamically resolved through parents.
3. Location/cost/barcode information is private; public product and buyer MCP
   responses must not contain it. This is unchanged by the location UI.
4. Draft and review state is mandatory on creation; owner approval is distinct
   from saving. Never enable `PURKINS_MCP_WRITES_ENABLED` until security gates.
5. No production Worker, domain, payment, or remote D1 migration until a
   separately approved launch plan. Cloudflare *staging* is the earlier goal,
   but must use isolated resources, protected Admin and demo payments.
6. Whenever possible, test using **actual Purkins stock examples**: Grey Sack,
   Blue PEP Bag, newborn / 0–3m / 3–6m garments, incomplete packs and supplier
   barcode references, not only arbitrary sample catalogues.

## Next concrete checkpoints

1. On stacked branch: verify `npm test`, `npm run check`, `npm run build`,
   `npm run theme:check`, `npm run mcp:check`.
2. Local D1 migration 0043 upgrade from existing PR #3 data; test creating a
   House / Bedroom / Grey Sack / Blue PEP Bag hierarchy; assign a draft, move
   the sack to Storeroom, and ensure product's private full path changes
   without changing its `location_id`.
3. Finish PR #3 tests and merge it; retarget stacked location PR to main, re-run
   checks and merge after review.
4. Implement Windows-safe isolated Cloudflare staging provisioning, then deploy
   storefront first and MCP read-only second. No need to finish every roadmap
   item before staging.
5. Use hosted Admin intake to enter a small real batch, then prioritize
   batch variants, stock placement ledger and first-sale capabilities.
