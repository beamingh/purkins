# Purkins production architecture: two Workers, one environment

**Decision — 23 October 2026.** One permanent set of Cloudflare resources, initially
noindexed, then promoted without copying product or order data. Two Workers are
**security/deployment boundaries**, NOT separate staging and production stacks.

## Workers

| Worker | Initial name | Allowed routes | Sensitive capability |
| --- | --- | --- | --- |
| Public storefront | `purkins-storefront` | Product/category pages, search, cart, checkout, public APIs, order-status/download, payment webhooks, images, robots/sitemap | Order writes, stock reservations, provider secrets |
| Admin + operator MCP | `purkins-admin` | `/admin/*`, `/api/admin/*`, `/images/*`, `/api/health`, authenticated `/mcp` | Draft stock, internal locations, purchase costs, inventory approval, order management, owner MCP reads |

Both Workers bind the **same** permanent `purkins-storefront-db` D1,
`purkins-storefront-images` R2 and private
`purkins-storefront-files` R2. No staging database or stock transfer.
Read/write boundaries are enforced at the endpoint and capability level;
a shared D1 binding is not a read-only database permission.

The public Worker has a route-level 404 guard for `/admin*`,
`/api/admin*` and `/mcp*`. More importantly, its generated Astro
`srcDir` excludes all Admin route files. The Admin build excludes public
catalog, cart, checkout, payment webhooks and order status. Both retain the
`/images/*` route so Admin product thumbnails load.

The split builder also checks Astro's **resolved route manifest** and fails
if a forbidden path appears. It saves audit-readable route lists as:
`.instances/split-build/public/routes.json` and
`.instances/split-build/admin/routes.json`. Build output is separate:
`dist/public/` and `dist/admin/`.

## Initial MCP compatibility

The Admin Worker embeds the existing `mcp/src/index.ts` handler and exports
the existing `StoreMcp` Durable Object. **No third MCP Worker** is deployed.
The Admin entrypoint requires an Authorization header on `/mcp`, and the MCP
handler itself verifies the bearer token. MCP writes remain disabled via
`PURKINS_MCP_WRITES_ENABLED=false`.

**Anonymous buyer MCP is intentionally unavailable on the Admin Worker.**
Buyer integrations can use public JSON APIs; a public MCP facade is a later,
separate decision. Cloudflare now deprecates `McpAgent` and recommends
stateless `createMcpHandler`. Migrating the existing MCP protocol sessions is
a distinct release gate after the route split passes; do not conflate it with
the public/Admin isolation.

## Local verification on Windows PowerShell

```powershell
git fetch origin
git switch --track origin/feat/purkins-public-admin-mcp-workers
npm ci # root npm workspace also installs MCP
npx vitest run test/scripts/purkins-route-split.test.mjs test/scripts/purkins-permanent.test.mjs
npm test
npm run check
npm run build
npm run theme:check
npm run mcp:check
npm run build:workers
Get-Content .instances/split-build/public/routes.json
Get-Content .instances/split-build/admin/routes.json
```

`npm run build` is a generic local monolithic build (kept for developer
compatibility). It MUST NOT be deployed. The old generic `npm run deploy`
is blocked for the Purkins theme. `npm run build:workers` is the
**two-Worker build gate**, running without remote resource creation.

`npm run mcp:check` still checks the generic standalone MCP template;
`npm run build:workers` is needed to verify MCP is also bundled with Admin.

## Permanent provisioning (after local build verified)

The read-only plan is:
```powershell
git switch main
git pull --ff-only origin main
npm run purkins:cloudflare
```
Its collision checks include both `purkins-storefront` and
`purkins-admin`. Provisioning the single permanent D1 and R2 buckets
requires its explicit confirmation; so do remote migrations and the
deployment of both **unrouted** Workers. No remote resource changes have
been performed for this architecture branch.

Generated (gitignored) files are
`wrangler.purkins.permanent.jsonc` for the public Worker and
`wrangler.admin.permanent.jsonc` for Admin+MCP. They use the same new D1
UUID and R2 names. The Workers initially set
`workers_dev=false`, `preview_urls=false` and
`PRELAUNCH_NOINDEX=true`.

## Security before external routing

- Set **`AUTH_SECRET`** on each Worker with an appropriate stable key.
- Set **the exact same `SECRETS_KEK`** on *both* Workers, because the Admin
  writes encrypted D1 secrets that the public Worker must decrypt at checkout.
  Back it up securely; rotating it without re-encryption can strand keys.
- Set **`MCP_TOKEN`** only on the Admin Worker. Keep
  `PURKINS_MCP_WRITES_ENABLED=false` until permission, audit,
  idempotency and concurrency tests pass.
- Protect the **entire Admin hostname** with Cloudflare Access and verify
  Admin's first-run bootstrap, browser session, API mutation and MCP token
  gates. MCP clients may require Access-compatible service authorization
  in addition to the MCP bearer token.
- Restrict alternate Admin ingress hostnames. Keep the public Worker in
  noindex mode until launch, then turn off noindex on the *same* Worker.
  Noindex never substitutes for Admin authentication.
- Do not add real payment keys until owner authentication, order safety and
  Zambia payment/shipping requirements have been verified.
- `/mcp` inside Admin requires independent token-based authorization;
  an Admin browser session alone does not grant MCP access.

## Promotion

Attach the public shopper domain to `purkins-storefront`, and a separately
protected Admin host to `purkins-admin`. Verify images, canonical origins,
auth cookies/CSRF and shared secrets across the two origins. Eventually set
`PRELAUNCH_NOINDEX=false` for the public Worker, rebuild/redeploy the SAME
resources and confirm sitemap availability. Do not create or transfer to a
second D1 at launch.

The root `package.json` declares `mcp/` as an npm workspace, with a single
root `package-lock.json`. Run only `npm ci` from the repository root; the
Admin+MCP bundle resolves the workspace dependencies without a second install.
The old `mcp/wrangler.template.jsonc` remains for generic Minshop's
standalone-MCP tooling but is **not** the Purkins permanent deployment path.
