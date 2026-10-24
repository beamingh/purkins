# Purkins PR #16 — Guarded photography, draft review and MCP launch gates

Status: draft branch `feat/purkins-mcp-gallery-review`; no production DB
migration, deployment, live OAuth change or write enablement has occurred.

## Operator workflow now supported in code

1. Create a product draft with `create_guarded_purkins_draft` or
   `bulk_create_guarded_clothing_drafts`. Both are unpublished.
2. Upload the real photo bytes through the existing protected **Admin Media**
   UI and obtain a `med_` media ID. ChatGPT attachments are **not**
   automatically transferred into an MCP Worker's R2 bucket. The legacy
   URL-import/media-write tools remain OFF.
3. Call `get_purkins_gallery(prod_...)` to obtain
   `gallery_revision` and existing `pimg_` gallery IDs.
4. Call `attach_guarded_purkins_photo` with `prod_`, existing `med_`,
   `expected_revision` and a new UUIDv4 `request_id`. Optional
   descriptive alt text is supported at initial association.
5. Optionally call `set_guarded_purkins_photo_alt` and
   `make_guarded_purkins_photo_primary` with the latest gallery revision
   and distinct UUIDv4 IDs for each operation. An already-primary image or
   unchanged alt is a no-op conflict; first refresh rather than guessing.
6. Call `review_purkins_draft(prod_...)` for a **read-only** pre-publication
   checklist. It identifies condition, price, landed-cost, photo and
   active variant-price blockers; it notes potential missing shipping weight.
   This does NOT authorize or perform publication. The existing authoritative
   approval rules must be rechecked at commit time.
7. Future, separate reviewed owner approval will publish and synchronize the
   public Worker cache. It is intentionally not implemented here.

No gallery operation removes R2 objects, changes published products,
alters inventory, modifies purchase cost or records sales. Primary-image
selection updates the denormalized product thumbnail in the same D1 batch.

## Gallery concurrency and audit

Migration `0048_purkins_mcp_gallery_guard.sql` adds:
- `products.mcp_gallery_revision` (default 0), incremented by SQL triggers
  on gallery row insert, delete, and meaningful image/alt/order updates,
  **including existing Admin actions**
- `product_images.last_mcp_gallery_nonce` to fence each write attempt
- `purkins_mcp_gallery_receipts` with unique UUIDv4 request ID,
  server-verified owner actor label, operation, SHA-256 of the normalized
  input, nonce, product/image public ID, expected revision and a database
  CHECK-constrained completion state

A mutation submits one D1 batch: receipt acquisition, conditional gallery
change, product thumbnail sync, and a completion assertion. Every write
checks `products.active=0`, `purkins_intake.status='draft'`,
the exact expected gallery revision and this request's database nonce.
For attachments, the media record must still exist at association time.
An incomplete attempt triggers a constraint failure that rolls the whole
transaction back, including the receipt. A repeated request with the same
UUID, owner and payload returns the committed historical result instead
of adding another image.

These checks are supported by newly authored isolated real-D1 tests; they
have **not yet been run in the user's checkout**.

### Authorization

- `get_purkins_gallery`, media-library reads and
  `review_purkins_draft`: authenticated operator tier only
- New guarded gallery mutations: operator + verified owner actor +
  `PURKINS_MCP_WRITES_ENABLED=true` +
  `PURKINS_MCP_GALLERY_WRITES_ENABLED=true`
- The new gallery flag defaults to **false**.
- `PURKINS_MCP_LEGACY_WRITES_ENABLED` stays **false**; turning on
  the gallery flag never enables older non-idempotent media imports.

### Local acceptance tests

```powershell
git fetch origin
git switch --track origin/feat/purkins-mcp-gallery-review
npm run check
npx vitest run src/features/mcp/galleryGuard.integration.test.ts mcp/src/purkins-gallery.test.ts mcp/src/purkins-media.test.ts
npm run mcp:check
npm test
npm run build:workers
```

## Activation plan after local green tests and merge

1. Take a read-only Cloudflare resource/configuration inventory; identify
   which **permanent** Worker and D1 instance is currently serving Purkins.
   The host `admin.purkins.ulwimbo.com` is not proof that `/mcp` is
   reachable or protected, nor is an example subdomain a live route.
2. Review the migration ledger and D1 backup/recovery procedure. Explicitly
   approve and apply migrations **0045 → 0046 → 0047 → 0048** in order to
   the verified Purkins database, using the permanent instance's safety
   script and its migration checkpoint. No new revision-aware Worker can
   go live before its corresponding schema exists. Never point at the
   old or ambiguous `purkins` D1 names.
3. Prepare Admin+MCP deployment separately from public storefront rollout.
   Secure the actual `/mcp` hostname/path behind an owner-only Cloudflare
   Access application. Configure owner email allowlist, dedicated MCP
   audience, team domain, secret/JWT validation and login policy. Verify
   HTTP request behavior for missing/invalid JWT, wrong owner and buyer
   tier, including direct Worker endpoint/bypass resistance.
4. Establish a ChatGPT remote-MCP connection through supported Access
   Managed OAuth. Verify discovery, transport and owner login in **read-only**
   mode before enabling any write flags. Cloudflare guidance:
   https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/
5. After owner-authenticated acceptance, enable only one audited capability
   at a time (location, stock, clothing, gallery), verifying retries, stale
   conflicts, explicit review and the first single real **unpublished**
   intake. Keep legacy writers OFF. Publishing, refunds, settings,
   category mutation and public cache purge require separate guarded paths.

This is a **release plan**, not an authorization to deploy, migrate,
configure OAuth, or change permanent resources.

## Remaining capabilities worth building after live MCP connectivity

- Guarded metadata/price edits of existing private drafts, including
  inventory/variant-level corrections
- Guarded gallery detach/order and photo replacement
- Shared, explicit owner-confirmed publication with reliable public Worker
  cache invalidation across Worker boundaries
- Controlled counter/WhatsApp/Facebook manual sales via the existing
  canonical `recordManualSale` settlement path
- Read-only stock value/revenue summaries, category assignment and
  category write parity after cache invalidation is solved
