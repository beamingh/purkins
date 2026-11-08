# Purkins catalogue edit parity

Development branch: `feat/purkins-catalogue-edit-parity`.

**This branch is not deployed.** The new private fields require `0064_purkins_supplier_provenance.sql` on the permanent D1 before an eventual release. Do not apply remote migrations or enable new write scopes until CI and owner validation pass.

## 1. Supplier provenance

The original label on packaging is now recorded separately from the customer-facing selling name:

- `purkins_intake.original_supplier_name` (private, up to 200 characters).
- `purkins_intake.supplier_reference` (private, up to 250 characters).

There is intentionally **no auto-backfill**. Existing customer-facing names may already have been changed and must not be treated as authoritative supplier labels. Original brand, supplier barcode, retailer price tag, original cost and internal notes remain separate as before. Inputs are available in Admin product intake and guarded MCP draft intake/editing; private stock reads include them. Public catalog and buyer MCP continue to read public product fields only.

## 2. Published listing rename

`rename_guarded_purkins_live_product` edits only the name of an **approved, published** listing. Its existing slug/URL, description, compare-at price, actual price, variants, stock, categories, media and publication status remain untouched.

The existing `purkins_live_edit_receipts` table tracks the change. The tool requires a fresh catalog revision, unique UUIDv4, `confirm_rename=true`, authorized owner and functioning cross-Worker public cache purge. Same-ID replay is supported. If the cache refresh fails after the DB commit, replay the **same** request ID; do not issue a new change until the public view is refreshed.

Separately gated by `PURKINS_MCP_LIVE_EDIT_WRITES_ENABLED=true` (template default `false`). Enabling ordinary draft writes does **not** enable live renames.

## 3. Reviewed draft bulk edits

1. Read current `get_purkins_stock` results for IDs and `catalog_revision`.
2. Prepare up to 8 distinct **unpublished** products, with distinct UUIDv4 request IDs. Allowed bulk fields: `name`, `description`, `original_supplier_name`, `supplier_reference`. No price or stock operations.
3. Call `preview_guarded_purkins_bulk_edit` to inspect the exact before/after diff and copy its `review_hash`.
4. Once the owner approves the diff, call `apply_guarded_purkins_bulk_edit` with the **same items**, same hash, and `confirm_apply=true`.
5. Check every returned item. Transactions are intentionally per-item, **not all-or-none**. A same-payload/same-UUID retry replays completed items and returns conflicts for stale or failed ones.

The preview is a read-only comparison, not a signed approval record. The hash binds the exact proposed payload, but the operator must actually inspect it before confirming.

## Release gates (before any deployment)

- CI tests/typechecks green, including live rename, private supplier fields, batch review/replay and owner permission tests.
- Run fresh-install and upgrade D1 migrations locally, then back up permanent D1 before migration.
- Verify new fields never appear in buyer-facing endpoints.
- Keep the new live-rename Worker flag **off** until cache purge and owner authorization are confirmed.
- Issue a **new** owner MCP token selecting the required tools after deployment; existing token permissions are immutable. Reconnect and revoke stale tokens. Never paste credentials into chat.
- Test a private draft edit first, then an explicit approved-product rename with the existing public URL; check the storefront and purge receipt.
- No inventory import, publication, payment, live product change, migration, or deployment is part of this development PR.
