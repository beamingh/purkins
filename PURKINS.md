# Purkins — Minshop foundation

**Branch:** `feat/minshop-foundation` (based on `main`).

**Upstream:** [ddyy/minshop](https://github.com/ddyy/minshop), MIT license, imported from commit `c964bf746926ae039a97d69720eee26fb97ba06f` (18 Oct 2026). This branch contains a source import and initial Purkins theme/configuration, **not a validated production release**.

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
git switch feat/minshop-foundation
git pull --ff-only origin feat/minshop-foundation
npm ci
npm run theme:check
npm run test:storefront-contract
```

`npm ci` will download a separate Astro dependency set. Avoid installing the MCP subproject until we are ready to test it.

Local provisioning is now **cross-platform Node.js** and runs directly in PowerShell; Git Bash, WSL and OpenSSL are unnecessary:

```powershell
npm run provision:local -- --seed
npm run preview
```

Open `http://localhost:8787/` and `http://localhost:8787/admin/setup`. Remove `--seed` to start without generic demo products. Do not confuse demonstration data with real Purkins stock. The setup reuses existing `.dev.vars` secrets and affects only local D1.

Never commit `.dev.vars`. The local setup generates its own secrets.

## Production safety

**Nothing on this branch is deployed.** Do not run `npm run deploy`, `npm run provision:cf`, `npm run db:migrate:remote`, or `npm run mcp:deploy` without a separate review and the owner's express approval. Cloudflare bindings/buckets and the domain must be provisioned afresh or deliberately mapped after audit.

GitHub CI remains **workflow_dispatch only**. Nothing runs automatically on push or PR.

## Important gaps before launch

1. Move the existing owner-vs-pricing-partner workflow from the Payload design to Minshop's auth/authorization; never expose cost prices to the partner.
2. Validate product variants (size/colour), photo-first intake, storage locations and per-item identity for one-off baby clothes.
3. Integrate and verify local Zambian payments, pickup/delivery, and stock reservation policies. Minshop's built-in providers do **not** mean Airtel/MTN Money is supported out of the box.
4. Scope MCP token permissions and audit logs, and keep all write capabilities disabled until tested.
5. Confirm import consistency, run local test/build and inspect the storefront in Windows before provisioning any live infrastructure.

Keep the previous `feat/payload-foundation` branch unchanged as a recovery/reference branch. Do not merge or delete it during this evaluation.

## Purkins inventory feature branch

The `feat/purkins-inventory` branch adds an additive D1 migration
(`0040_purkins_intake.sql`) and a private costing table.

- New items start **inactive/unpublished**, with an auto-generated `PUR-000001`-style
  product code. Their size, colour, age range, and physical storage location are
  recorded at intake; per-size/per-colour purchasable variant inventory still
  needs a later phase.
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
git -c http.version=HTTP/1.1 fetch --no-tags origin refs/heads/feat/purkins-inventory:refs/remotes/origin/feat/purkins-inventory
git switch --track -c feat/purkins-inventory origin/feat/purkins-inventory
npx --no-install vitest run src/features/purkins
npm run theme:check
npm run check
npm run build
npm run db:migrate
npm run preview
```

`npm run db:migrate` applies committed migrations to **local D1 only**;
it preserves the existing `.wrangler/state` catalog and Admin setup.
The database migration requires stopping the running local preview first.
No remote migrations, cloud resource changes or production deployments
are included in this branch.

### Deferred work

Before launch: hardened per-user owner/partner authorization, staff-specific
audit logs and approval rights, linked size+colour SKU/variant intake,
bulk/photo intake, real Zambia payment and fulfilment rails, verification
of the full checkout and inventory reservation workflow, and final Purkins
logo/mascot assets. This implementation is not production-ready.
