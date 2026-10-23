# Purkins delivery roadmap — stock to first sale

**Updated 23 October 2026.** Source of truth: Minshop/Astro Workers + D1/R2.
Owner is the only operator for now. Prioritize first usable retail sales and rapid
stock cataloguing; avoid expanding generic Minshop features that do not support
that goal.

## Branch and rollout gates

- **main** — PR #3 Rapid Stock Intake and PR #4 Hierarchical Locations are
  **merged**. User locally verified 984 passing tests, 0 Astro errors,
  successful production build, theme checks and MCP dry run.
- **Prelaunch → production is a single environment** — no separate staging
  Worker, database, R2 or subsequent inventory migration. See
  [Purkins single-environment rollout](./purkins-prelaunch-to-production.md).
- **PRELAUNCH_NOINDEX=true** during prelaunch. Promotion changes it to
  `false` on the **same storefront**, together with the real domain,
  checkout/security and search-readiness checks.
- Database migrations in order: **0040 → 0041 → 0042 → 0043**.
  Fresh and upgrade-path D1 checks are release requirements.

## Delivery milestones

| Priority | Feature | Deliverable / acceptance gate | Current status |
| --- | --- | --- | --- |
| P0 | Rapid Stock Intake | Photo-first draft, Save & Next, manual ZMW price, duplicate hints, variant/pack awareness | PR #3 merged; local checks green; UI smoke test pending |
| P0 | Hierarchical locations | Stable `loc_...` IDs; rooms/sacks/bags; add child, move container, no ancestry cycles; moving parent updates private stock path | PR #4 merged; local checks green; UI smoke test pending |
| P0 | **Single-environment Cloudflare prelaunch** | One permanent Worker + D1 + R2, Windows-safe provisioning, prelaunch noindex, secured Admin, promotion without data movement | Prelaunch indexing branch prepared; no remote mutations |
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
5. No remote Worker, D1/R2 creation, domain routing, payment or migration until
   provisioning and access controls are explicitly reviewed. Launch one durable
   Purkins environment, initially with noindex. No staging-to-production copy.
6. Whenever possible, test using **actual Purkins stock examples**: Grey Sack,
   Blue PEP Bag, newborn / 0–3m / 3–6m garments, incomplete packs and supplier
   barcode references, not only arbitrary sample catalogues.

## Next concrete checkpoints

1. Review and merge the prelaunch indexing branch, then verify local
   `npm test`, `npm run check`, `npm run build`, `npm run theme:check` and
   `npm run mcp:check`.
2. Local Admin browser smoke test of actual intake and parent-child location
   movement. Confirm initial setup and session protections.
3. Implement a PowerShell-friendly, Node-based first deployment that checks
   for existing Cloudflare resource names, provisions the **permanent** store
   D1/R2/Worker exactly once, sets secrets and guards first-run Admin.
4. Validate live noindex responses, migrate the D1 through 0043, add a small
   batch of actual products and test media and drafts on the permanent store.
5. Connect MCP read-only to the same D1. Only later enable audited writes.
   Prioritize batch size intake, location stock ledger, costing and Zambia
   checkout so the storefront can start making sales.
