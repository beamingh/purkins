# Purkins — full owner MCP for ChatGPT

This is the same *governed* architecture used with SeeZambia:
ChatGPT/plugin → authenticated MCP → existing business logic → **one permanent Purkins D1/R2**.
No duplicated inventory, no public shopper access to costs/barcodes, and no automatic publication.

## Already deployed before this PR

- Admin Worker: `purkins-admin`
- Owner-only Admin hostname: `https://admin.purkins.ulwimbo.com`
- MCP transport on that Worker: `/mcp` (the homepage `/` is not an MCP route)
- `MCP_TOKEN` secret, Cloudflare Access, and permanent D1 + R2 bindings
- Operator **reads** for products, prices, revenue, orders and private Purkins stock
- Operator **writes** for draft products, variants, and explicit publication, disabled by `PURKINS_MCP_WRITES_ENABLED=false`

## New tools in this PR

| Tool | Allowed without write switch | Effect |
| --- | --- | --- |
| `list_purkins_media` | Yes, operator identity required | Paginated `med_` media IDs |
| `get_purkins_gallery` | Yes, operator identity required | Product photos, `pimg_` IDs, primary image, alt text |
| `attach_purkins_media` | No | Attaches existing library image to an unpublished draft |
| `import_purkins_image` | No | Fetches supported public HTTPS photo, enforces max 5 MB, stores it in R2/media and attaches to draft |
| `set_purkins_photo_alt` | No | Edits draft gallery image alt text |

These complement existing `list_purkins_stock`, `search_purkins_stock`,
`get_purkins_stock`, `create_purkins_stock`, `update_purkins_stock`,
`set_purkins_variant` and `approve_purkins_stock`.

`import_purkins_image` requires an externally accessible HTTPS image URL **whose exact hostname is explicitly listed** in the Admin MCP Worker's `PURKINS_MCP_IMAGE_IMPORT_HOSTS` configuration (comma-separated trusted hostnames, no wildcards). The default empty list rejects all URL imports. This is separate from the global MCP write switch. Use controlled image sources only; adding an untrusted hostname defeats the outbound-fetch restriction.
Chat message attachments are **not automatically available as image bytes** to
an MCP server. For photos uploaded directly from the user's device, use the
existing Admin Media upload page, then `list_purkins_media` and
`attach_purkins_media`. Never upload private intake documents via the photo
tool. SVG, credentials in URLs, private IPs, localhost, redirects and files
over 5 MB are rejected.

Editing an approved/published product's photos via MCP is intentionally
refused: first move it back into draft through an explicit Admin edit. The
normal cost/price/photo/condition checks still apply before publishing.

## Authentication: connect *as the owner*, not as a shopper

The Admin Worker retains both:
- Legacy secret for existing MCP clients: `Authorization: Bearer <MCP_TOKEN>`.
- Cloudflare Access-signed identity for an **OAuth-backed** ChatGPT connection:
  `Cf-Access-Jwt-Assertion` must be signed by the configured Access team,
  have the correct audience and an email exactly matching the separately
  configured `PURKINS_MCP_OWNER_EMAIL`. Missing owner configuration fails
  closed. An unsigned/forged header cannot authorize the operator tier. `PURKINS_MCP_ACCESS_AUD` may be
  configured for a separate owner-only MCP Access application; otherwise the
  current `CF_ACCESS_AUD` is used.

**A fixed MCP_TOKEN is not a substitute for ChatGPT OAuth.** As of October
2026, ChatGPT custom MCP plugin documentation calls for OAuth 2.1 for private,
write-enabled integrations. Cloudflare Access Managed OAuth is a candidate
front door; configure a dedicated **owner-only** MCP Access application for
the `/mcp` endpoint on a controlled hostname (for example,
`https://mcp.purkins.ulwimbo.com/mcp`, *only after actually binding that
hostname*). Do not remove Access from the Admin dashboard, expose MCP
unauthenticated, or make the Admin Worker public to make tool discovery pass.

### Manual Cloudflare setup / checks (after this PR is verified)

1. Choose a dedicated MCP hostname and bind it to the existing
   `purkins-admin` Worker, **not** the public storefront Worker. Ensure the
   existing owner-only Admin hostname and Access policy are unchanged.
2. Set up Cloudflare Access Managed OAuth for the MCP endpoint with an
   owner-only identity policy (Zero Trust → Access controls → AI controls).
   Check that the protected MCP resource metadata, OAuth discovery and
   authorization flow are accessible to ChatGPT without a browser-only
   redirect on `POST /mcp`. Verify what signed Access JWT reaches the Worker.
3. Confirm the MCP Access application's AUD and set
   `PURKINS_MCP_ACCESS_AUD` as a Worker **secret** if it differs from the
   dashboard's `CF_ACCESS_AUD`. **Also configure `PURKINS_MCP_OWNER_EMAIL`
   securely with the one authorized owner's Access identity email.** Without
   it, an Access-authenticated MCP session cannot become an operator. Keep
   the Access policy restricted to the owner as an independent protection.
   Never log JWTs, bearer tokens or secret values.
4. Test: no identity → rejected; forged Access header → rejected;
   valid Access token for a non-owner → rejected; missing owner email config → rejected;
   owner OAuth token → successful `initialize`
   and `tools/list`, including the private stock read tools.
5. In an eligible ChatGPT Business/Enterprise/Edu workspace, Plugins →
   Add custom MCP server → paste the **actual** HTTPS `/mcp` URL →
   OAuth sign-in → create/install the plugin → scan tools. App controls
   may require explicitly enabling newly discovered write actions.
6. First inspect stock without writes. Verify results match the current
   permanent Purkins D1. Then enable operator writes with the gate below.

A successful OAuth setup must be tested before connecting. The code change
alone is **not** an OAuth issuer or a complete live ChatGPT connection.
Cloudflare's Access Managed OAuth handles the external authorization flow.

## New owner write-safety scope

See [MCP_WRITE_GUARD.md](MCP_WRITE_GUARD.md). Global
`PURKINS_MCP_WRITES_ENABLED=true` alone does **not** expose legacy product,
stock, media, fulfilment, and order mutation tools anymore. Those older paths
also require `PURKINS_MCP_LEGACY_WRITES_ENABLED=true`, which must remain
**false in production** until they are audited and replay-safe. Guarded location
mutations separately require `PURKINS_MCP_LOCATION_WRITES_ENABLED=true` and
verified owner identity in addition to the global gate. Both scoped flags
default to false.

Migration `0045_purkins_mcp_write_guard.sql` is required **before** deploying
Workers with revision-aware location reads. Do not deploy this branch or
turn on any write flag until isolated D1, local build and owner-authenticated
runtime acceptance checks pass.

## Durable, deliberate write activation

The permanent Admin configuration is gitignored and currently defaults to
`PURKINS_MCP_WRITES_ENABLED=false`. **Do not change a tracked template to
true or patch the production Worker ad hoc.** Only after all applicable scoped-write audit, idempotency, migration,
replay and approval tests are green (the generic switch alone keeps the older
mutators hidden):

```powershell
npm run purkins:cloudflare -- mcp-writes-on --confirm=ENABLE-PURKINS-MCP-WRITES
npm run purkins:cloudflare -- build
npm run purkins:cloudflare -- deploy --confirm=DEPLOY-PURKINS-WORKERS
```

The first command changes ONLY the local generated Admin Worker configuration
and records the choice in the gitignored permanent-instance state. Only the
separately confirmed deploy changes the live Worker. The public Worker stays
configured identically. The switch persists across future builds.

Emergency rollback to read-only mode:

```powershell
npm run purkins:cloudflare -- mcp-writes-off --confirm=DISABLE-PURKINS-MCP-WRITES
npm run purkins:cloudflare -- deploy --confirm=DEPLOY-PURKINS-WORKERS
```

Do not reset D1/R2, recreate the instance, or seed real stock.

## Verification before merging

On the PR branch, from `C:\GitHub\purkins`:

```powershell
npm run check
npx vitest run mcp/src/purkins-media.test.ts
npm run mcp:check
npm run purkins:cloudflare -- build
```

No production Worker is changed by those four commands. We need the actual
PowerShell output before merging, enabling writes, and exposing a connector.

## First accepted end-to-end task

1. `search_purkins_stock` for a known product/SKU/location — confirm no duplicates.
2. `create_purkins_stock` one **private draft** with stock, price in integer
   minor ZMW units, size/colour variants and storage location.
3. Attach or import a photo and set useful alt text.
4. `get_purkins_stock` and `get_purkins_gallery` — review product data.
5. Publish **only on explicit owner approval** with
   `approve_purkins_stock(confirm_publish=true)`.
6. Verify storefront visibility and D1 inventory. Never create a fake paid
   order merely to test listings.

The existing `fulfill_order` action affects real orders. New app permissions
should require owner confirmation for this and every publication/mutation.
