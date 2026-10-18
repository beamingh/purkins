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

The upstream local provisioning script is **Bash** and uses `openssl`. Launch **Git Bash** (not plain PowerShell) in the same repository:

```bash
npm run provision:local
npm run dev
```

Then open `http://localhost:4321/` and `http://localhost:4321/admin`. The provisioning script also prints a production-like local preview command (`npm run preview`, usually port 8787). If you want generic demo products, `npm run provision:local -- --seed` instead; do not confuse seeded example data with real Purkins stock.

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
