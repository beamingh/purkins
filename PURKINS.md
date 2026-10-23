# Purkins — Minshop foundation

> **Branch status (23 October 2026): INTEGRATED INTO `main` / NOT PRODUCTION-READY.** Minshop/Astro, private stock/catalogue and MCP changes were merged through [PR #2](https://github.com/beamingh/purkins/pull/2). Use `main` for new work. See `docs/BRANCH_STATUS.md` for outstanding local testing and release gates; no production deployment is authorized.
> **Architecture:** Minshop + Astro/Cloudflare Workers/D1/R2. Payload CMS is discontinued.

**Historical origin:** `feat/purkins-stock-cataloguing` was merged into `main`. Its ancestors `feat/purkins-inventory` and `feat/minshop-foundation` are superseded.

**Upstream:** [ddyy/minshop](https://github.com/ddyy/minshop), MIT license, imported from commit `c964bf746926ae039a97d69720eee26fb97ba06f` (18 Oct 2026). The Minshop import is now followed by the Purkins inventory and catalogue changes. **The result is not yet a validated production release**.

See [the definitive branch and merge status](docs/BRANCH_STATUS.md) and [stock/MCP catalogue model](docs/purkins-stock-cataloguing.md).

## Why we're doing this

- Cloudflare-native Astro / Workers with D1 and R2.
- Full storefront, carts, inventory, orders, shipping, media and separate MCP app.
- One public storefront at `/`; one operational administration at `/admin`.
- Our private inventory and price-approval requirements will be added and verified before real stock is migrated or sold.

## Initial Purkins customisation

- `theme.config.json` selects `purkins`.
- `src/themes/purkins/` copies the upstream `default` presentation templates. All stock/cart/checkout controls are left untouched.
- `src/themes/purkins/tokens.css` introduces warm cream, subtle peach and plum brand colours. The approved Purkins logo, mascot and real product photos still need to be added; do not invent substitutes.
- `src/store.config.ts`: defaults to `Purkins Baby & Mum Essentials`, `zmw`, `Africa/Lusaka`. First-run Admin settings may override display name/timezone.
- `wrangler.jsonc` defaults use reserved **Purkins-storefront-only** names; do not attach SeeZambia or the previous Payload D1/R2 resources.

## Local Windows checkout

In PowerShell, from your existing repository `C:\GitHub\purkins`:

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
npm ci
npm run theme:check
npm run test:storefront-contract
```

`npm ci` will download a separate Astro dependency set. For the separate MCP Worker, install its locked dependencies with `npm ci --prefix mcp`, then run `npm run mcp:check` (local-only typecheck and Wrangler dry run; no deployment).

Local provisioning is now **cross-platform Node.js** and runs directly in PowerShell; Git Bash, WSL and OpenSSL are unnecessary:

```powershell
npm run provision:local -- --seed
npm run preview
```

Open `http://localhost:8787/` and `http://localhost:8787/admin/setup`. Remove `--seed` to start without generic demo products. Do not confuse demonstration data with real Purkins stock. The setup reuses existing `.dev.vars` secrets and affects only local D1.

Never commit `.dev.vars`. The local setup generates its own secrets.

## Production safety

**Merging into `main` did not deploy any Worker or migrate any database.** Do not run `npm run deploy`, `npm run provision:cf`, `npm run db:migrate:remote`, or `npm run mcp:deploy` without a separate review and the owner's express approval. Cloudflare bindings/buckets and the domain must be provisioned afresh or deliberately mapped after audit.

GitHub CI remains **workflow_dispatch only**. Nothing runs automatically on push or PR.

## Important gaps before launch

1. Design proper owner/partner authorization and private cost-field access within Minshop before sharing Admin or granting MCP write access; the discontinued Payload implementation is not a feature source.
2. Validate product variants (size/colour), photo-first intake, storage locations and per-item identity for one-off baby clothes.
3. Integrate and verify local Zambian payments, pickup/delivery, and stock reservation policies. Minshop's built-in providers do **not** mean Airtel/MTN Money is supported out of the box.
4. Scope MCP token permissions and audit logs, and keep all write capabilities disabled until tested.
5. Confirm import consistency, run local test/build and inspect the storefront in Windows before provisioning any live infrastructure.

Keep `feat/payload-foundation` as discontinued history only. It must not be merged, deployed, or used to reintroduce the retired stack.

## Purkins private inventory (integrated into `main`)

The superseded `feat/purkins-inventory` branch originally introduced the additive D1 migration
(`0040_purkins_intake.sql`) and a private costing table.

- New items start **inactive/unpublished**, with an auto-generated `PUR-000001`-style
  product code. Their size, colour, age range, and physical storage location are
  recorded at intake. The catalogue includes linked variants and supplier
  barcodes; these still require manual Admin smoke tests before launch.
- Enter purchase cost in ZMW or ZAR. If ZAR, **enter the actual exchange rate
  in kwacha per rand** used for costing; no rate is guessed. A per-item overhead
  allocation covers travel/transport/lodging. The suggested selling price uses
  **markup on landed cost**, not gross margin, and the owner must explicitly
  accept the selling price. Unspecified cost or markup is not silently replaced
  by an invented value.
- Costs and approvals live in `purkins_intake`, not the public `products`
  table. The existing single-admin Minshop password is currently the only
  access boundary: **do not share Admin access with a partner**. Genuine
  owner/partner roles, route-level role guards, audit history and field
  redaction are required before enabling additional accounts or MCP write access.
- Saving any product edit revokes prior approval and hides the product until
  re-approved. An explicit **Approve selling price & publish** action requires
  positive ZMW selling price, a photo, a recorded purchase cost and a selling
  price at least equal to estimated landed cost.
- Previous sample/legacy products are preserved and do not automatically get
  intake metadata. They can be removed deliberately once the real catalog is
  ready; never overwrite them as part of the additive migration.

### Local test in Windows PowerShell

Starting with a working local Minshop checkout and dependencies:

```powershell
git switch main
git pull --ff-only origin main
npm run test:purkins
npm run theme:check
npm run check
npm run build
npm run db:migrate
npm run preview
```

`npm run db:migrate` applies committed migrations to **local D1 only**;
it preserves the existing `.wrangler/state` catalog and Admin setup.
The database migration requires stopping the running local preview first.
Do not run remote migrations or Cloudflare deployments as part of local
verification. These require a separate release review.

### Deferred work

Before launch: hardened per-user owner/partner authorization, staff-specific
audit logs and approval rights, linked size+colour SKU/variant intake,
bulk/photo intake, real Zambia payment and fulfilment rails, verification
of the full checkout and inventory reservation workflow, and final Purkins
logo/mascot assets. This implementation is not production-ready.

### Automated intake → sale test coverage

Run `npm run test:purkins` to check:
- draft creation, item-code uniqueness, private costing and unpublished catalog;
- explicit approval rules, cost recovery and required photos;
- variant cost floors and parent-product visibility guards;
- automatic revocation of approval on edits;
- actual Miniflare D1 demo reservation and paid-order settlement, including
  no overselling and no double stock decrement on repeated settlement;
- static route/form wiring guardrails.

The D1 workflow suite uses **ephemeral in-memory Miniflare state** and applies
`0040_purkins_intake.sql` to an isolated fixture; it cannot change
`.wrangler/state` or the remote store. The image test models a successfully
uploaded image key; it does not test R2 upload, browser controls, or the
entire checkout HTTP flow. Those remain separate launch-blocking checks.

The full local suite passed **954 tests in 87 files** after the dependency
upgrades; MCP typecheck/dry run also passed. This does **not** replace
browser-based Admin checks or release validation. The GitHub workflow remains
manual-only and does not deploy.
