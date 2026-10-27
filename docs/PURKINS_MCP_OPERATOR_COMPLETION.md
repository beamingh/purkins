# Purkins: final owner MCP operations milestone

## Scope

This is a **draft change**, never an instruction to enable production writes before testing. All new tools are PRIVATE authenticated operator tools. Existing buyer checkout, Admin workflows, protected previews, and public storefront remain untouched.

### Added operator READ tools

- `get_purkins_stock_valuation`: read existing complete, variant-safe stock valuation; missing costs/prices stay unknown, original ZAR/ZMW tag subtotals remain separate.
- `get_purkins_private_preview`: URL of the EXISTING authenticated `/admin/products/prod_…/preview` page (no public sharing token), current catalog revision and categories.
- `get_purkins_dispatch_overview`: owner-only read of the existing queue for held/quoted Facebook, Marketplace and Yango deliveries; delivery is not a payment receipt.

### Added guarded WRITE tools

- `edit_guarded_purkins_draft`: private draft name, description, base selling price, actual purchase cost, original currency, historical rand exchange rate, original retailer price tag, condition, brand, notes, and category assignment/clearing. Requires fresh `catalog_revision`, unique UUIDv4, protected private D1 receipt. Does NOT change stock counts or publish. For size-specific prices use `reconcile_guarded_purkins_variant`.
- `upload_guarded_purkins_photo`: accept real image bytes in base64 form, up to 5MB JPEG/PNG/WebP/GIF, store in the PRIVATE Media Library with retryable receipt. **Does not attach or publish**. Then use existing `attach_guarded_purkins_photo` with `med_` ID and current gallery revision; choose primary image separately. For larger files, continue to use Admin Media upload.
- `record_guarded_purkins_paid_sale`: explicit receipt of FULL funds in cash/wallet/bank, verified amount, guarded UUID, same already-tested Admin D1 atomic sale and inventory decrement. **Never record an unpaid order this way.**
- `record_guarded_purkins_dispatch`: append-only manual Yango/courier event using existing quote/held-stock and optimistic dispatch revision checks. **Does not mark paid or deduct inventory again.**
- `settle_guarded_purkins_cod_payment`: existing verified offline settlement into canonical paid order, only for a previously quoted/allocated order request. Cash counted, or actual receiving-account transaction checked. Never treats screenshots or rider delivery as payment.
- `fulfill_guarded_purkins_order`: explicitly confirm handover of an already PAID canonical order via transactional CAS and nonce-matched receipt. No further inventory deduction.

New tools do NOT switch on legacy unsafe writers. There is no automated Yango booking, payment provider verification, or public photo preview bypass.

## Implementation notes

- Migrations `0060` through `0063` introduce private receipts and nonce guards. They must be applied sequentially on the permanent Purkins D1 BEFORE the new MCP write switches are turned on.
- New Admin Worker switches default to `false`: `PURKINS_MCP_DRAFT_EDIT_WRITES_ENABLED`, `PURKINS_MCP_SALES_WRITES_ENABLED`, `PURKINS_MCP_DISPATCH_WRITES_ENABLED`, `PURKINS_MCP_MEDIA_UPLOADS_ENABLED`.
- Existing `mcp-writes-on` confirmation command explicitly enables these guarded scopes in the generated local Admin config. **No other legacy write scope is enabled.** Existing deployed credentials are NOT automatically granted new tool permissions.
- `publish_guarded_purkins_product` and `unpublish_guarded_purkins_product` already exist. They require the SEPARATE `mcp-publication-on` owner switch, the public cache-purge secret and an explicitly selected owner credential. Do not silently enable them as part of this PR.
- The existing `/admin/products/prod_…/preview` is private and purchase-disabled. This PR only adds its discovery via MCP.
- Publishing still requires product condition, a real price (also on active size variants), and a photograph.
- Because the image upload writes a non-transactional R2 file before its D1 receipt completes, a rare interrupted operation may leave an **unattached private Media Library object** for manual cleanup. This never publishes the image or a product. Retry with the SAME request ID and original bytes after checking the library.
- USD original purchase-cost input is intentionally NOT enabled by this PR because existing D1 input constraints only permit ZMW/ZAR. USD migration/conversion must be a separate validated change.
- Selling prices can be edited through MCP **for unpublished drafts**. A published listing must be explicitly unpublished, edited and re-published. Direct unsafe live price edits remain disabled.
- The COD workflow currently starts in Admin's existing Facebook/Marketplace unpaid-request and quote/stock-hold interface. This PR exposes courier status and final settlement, but does **not** yet create those unpaid requests or allocate their stock over MCP.
- Realized per-order margin is not calculated. There are presently no recorded acquisition costs on the live Purkins stock.

## Validate on Windows before merge

```powershell
git fetch origin feat/purkins-mcp-sales-operator-completion
git switch --track origin/feat/purkins-mcp-sales-operator-completion
npx vitest run src/features/mcp/draftEdit.integration.test.ts src/features/mcp/fulfillmentGuard.integration.test.ts src/features/mcp/operatorActions.test.ts test/scripts/purkins-mcp-operator-completion-contract.test.mjs
npm run mcp:check
npm run check
npm run purkins:cloudflare -- build
```

If any command is red, do not merge, migrate or deploy. Review fail-closed tests and Worker bundle partition boundaries. Re-run relevant existing `src/features/purkins` and `src/features/mcp` test suites as appropriate.

## Owner-controlled release sequence AFTER validation

1. Merge PR into `main`; pull exact merged commit.
2. Apply sequential remote D1 migrations using the existing `purkins:cloudflare -- migrate` explicit confirmation. Back up/review data according to the existing operations procedure.
3. Run existing guarded MCP writes opt-in again, with explicit confirmation, to update the locally generated Admin config with the NEW scoped write flags. Do not enable legacy writes.
4. Configure/verify the existing public cache purge secret before separately enabling guarded publication. If missing, keep publication via Admin only.
5. Build/deploy BOTH existing Workers with the existing explicitly confirmed script.
6. Revoke/replace the previous owner-issued MCP client token at `/admin/mcp`. Select newly available tool permissions because old permissions are immutable. Never paste tokens into ChatGPT messages.
7. Test READ tools, one safe DRAFT edit, one photo upload+attach, publication readiness, then a controlled real paid sale and Yango event when genuine business activity occurs.
8. Once proven, freeze development for 30 days and prioritize stock photos, listings and sales.
