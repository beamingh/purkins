# Purkins: one live environment, prelaunch → production

**Decision (23 October 2026): do not create separate staging/development and
production Cloudflare stacks.** Deploy a single durable Purkins storefront in
prelaunch mode, then promote *that same* Worker and its database/storage.

## One permanent resource set

| Component | Permanent target name | Notes |
| --- | --- | --- |
| Storefront Worker | `purkins-storefront` | Same Worker after production launch |
| D1 database | `purkins-storefront-db` | Stock, settings, orders; never reset to launch |
| Product images | `purkins-storefront-images` | R2, same objects and binding |
| Private files | `purkins-storefront-files` | R2, never enable public r2.dev |
| MCP Worker | `purkins-storefront-mcp` | Separate Worker by architecture, same D1; writes off initially |

Existing account resources `purkins` (D1) and `purkins-media` (R2)
have unverified origins. **Do not attach to, migrate, overwrite or delete
them.** Never change SeeZambia/Ulwimbo resources. Verify target names are
available again before creating them. These names are proposed, not yet created.

## Prelaunch: index suppression, not access control

`PRELAUNCH_NOINDEX=true` in the Wrangler configuration is the one
reversible indexing switch. While enabled:

- Dynamic responses carry `X-Robots-Tag: noindex, nofollow, noarchive`;
  storefront HTML also has the corresponding robots meta tag.
- `robots.txt` allows crawling of public paths **so engines can see
  noindex**. It continues to disallow Admin and API paths but does not
  advertise the sitemap.
- `/sitemap.xml` and `/llms.txt` return 404, `private, no-store`;
  they do not advertise products, pages or agent endpoints.
- Do **not** confuse noindex with privacy. The prelaunch site is accessible
  by anyone with its URL unless separately protected. Keep the whole prelaunch
  Worker behind Cloudflare Access until we are ready for public previews or
  configure the built-in Admin password securely before adding real stock.
  Verify both `/admin/*` and `/api/admin/*` reject anonymous users.
- Do not enable live payment keys merely to test inventory; start with demo
  checkout, private draft stock and no live promotions.

Cloudflare's own guidance allows adding Access to a Worker. Google's noindex
guidance requires crawlers to see the tag; `robots.txt: Disallow: /` is not
a substitute. Use both indexing controls and authorization for their
separate purposes.

## First deployment workflow (no separate staging)

1. From Windows PowerShell, use `main` after merging and verifying the
   prelaunch change. `npm test`, `npm run check`, `npm run build`,
   `npm run theme:check`, `npm run mcp:check`.
2. Smoke test local D1 migration 0043: child bag, parent move, correct dynamic
   location paths and Admin stock form.
3. Use/implement a **Windows-safe Node.js** provisioning command that checks
   for name collisions, then creates only the chosen permanent D1/R2 resources
   and renders instance-specific Wrangler config. The generic
   `scripts/provision-cf.sh` requires Bash/OpenSSL and automatically deploys;
   do **not** run it from PowerShell. Never commit generated configs/secrets.
4. Ensure safe, owner-only access before exposing Admin's first-run setup
   wizard. Configure fresh `AUTH_SECRET` and `SECRETS_KEK`. Validate
   unauthenticated Admin pages and mutation API endpoints are blocked.
5. Apply migrations to the single new D1 **in order including 0043**, then
   deploy the Worker once. Validate real Worker request headers and
   `/robots.txt`, `/sitemap.xml`, `/llms.txt` while noindex is enabled.
6. Add a few actual Purkins stock items as private drafts and test images,
   variants, bulk/pack count, price review and location movements. No demo
   inventory seeding into long-lived stock unless intentionally requested.
7. If/when needed, deploy the separate MCP Worker connected to this SAME D1,
   use a dedicated MCP bearer token, test private/public boundaries and retain
   `PURKINS_MCP_WRITES_ENABLED=false` until audited write controls ship.

These steps have **not** been run on remote Cloudflare infrastructure.

## Promotion to public production

No new D1, no copied R2 bucket, and no replacing the Worker. Instead:

1. Finish actual payment, shipping/pickup, checkout, inventory and security
   verification. Resolve prelaunch test/dummy stock and orders explicitly in
   the existing database without resetting real inventory.
2. Point the intended Purkins domain to the existing storefront Worker and
   configure canonical HTTPS origin, email settings and product-image delivery.
   Revisit Cloudflare Access: an all-Worker policy must be adjusted/removed for
   the shopper-visible routes while owner Admin stays authenticated.
3. Change **`PRELAUNCH_NOINDEX` from `true` to `false`** in that same
   Worker's config and redeploy. Verify the robots meta/header are absent,
   `/robots.txt` advertises the sitemap, and `/sitemap.xml` returns valid
   public product URLs. Check `/llms.txt` only when agent exposure is intended.
4. Check Cloudflare and browser caches for stale noindex responses; wait for
   caches to expire or purge them before submitting the sitemap to Search
   Console. Check both workers.dev and custom-domain behavior to avoid
   duplicate search indexing; disable alternative public ingress as appropriate.
5. Monitor search indexing and orders after launch. Noindex removal allows
   indexing but does not guarantee immediate Google indexing.

The larger plan remains: secure MCP writes, fast bulk intake, supplier barcode
capture, per-location stock placements, South Africa trip landed-cost
allocation, Admin inventory dashboard and Zambia-ready checkout.
