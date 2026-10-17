# Purkins | Baby & Mum Essentials

Private inventory and pricing workspace for **Purkins**, built with **Next.js + Payload CMS**.

**Status:** feature branch, not deployed. Proposed address: `purkins.igoola.com`. No production Cloudflare resources, secrets, DNS or custom domains have been modified.

## Architecture

This code is based on the [official Payload Cloudflare D1 starter](https://github.com/payloadcms/payload/tree/main/templates/with-cloudflare-d1), rather than its full MongoDB/Stripe commerce starter, because Purkins needs inventory first. Existing Payload admin, authentication, Next.js routes and Cloudflare D1/R2 adapters are retained.

- Payload admin at `/admin`, homepage redirects to admin.
- A private inventory collection with SKU, quantity, location, product photographs, category, size, price and status.
- All prices are entered in **ZMW**, no payments or currency conversions yet.
- `owner` and `partner` roles. A partner sees inventory and can suggest a selling price, but cannot view cost prices, change stock, approve prices or manage accounts.
- Private R2-backed media, not public product URLs.

## Do before deployment

1. Check runtime compatibility with the official starter's Node requirement (`>=24.15.0`).
2. Set the untracked Payload authentication secret and configure the Cloudflare local development bindings.
3. Create a **separate** Purkins D1 database and R2 bucket, then replace the D1 placeholder ID in `wrangler.jsonc`. Never use SeeZambia databases or buckets.
4. Generate Cloudflare and Payload types and check the application locally. There is no validated production build yet.
5. The initial D1 migration is committed in `src/migrations/` and has been successfully applied in CI to local D1. Review before production application.
6. Test the initial owner flow at `/admin/create-first-user`, all role restrictions, photo uploads, direct API reads, and whether an unauthenticated request is denied. Confirm the first-user bootstrap is compatible with the custom user access policy.
7. Protect the entire application with **Cloudflare Access before first public exposure**, not just `robots.txt`. An unclaimed first-user endpoint is a takeover risk.
8. Confirm Cloudflare Workers bundle size, paid plan coverage, migrations and actual deployment compatibility before attaching `purkins.igoola.com`.

**Do not deploy this scaffold until the migrations and private-access checks have passed.**

## Permissions

| Action | Owner | Pricing partner | Anonymous |
| --- | --- | --- | --- |
| View inventory and photos | Yes | Yes | No |
| Create/change stock | Yes | No | No |
| See item cost | Yes | No | No |
| Suggest a selling price | Yes | Yes | No |
| Approve selling price | Yes | No | No |
| Create/manage team accounts | Yes | No | No |

The first account uses Payload's bootstrap flow and receives the owner role by default. Later accounts created by the owner are forced to start as partners; owner promotion requires the owner to edit their role.

## Future phases

Bulk entry and photo linking, sales receipts and atomic inventory deductions, stock change history, copy-to-Facebook product descriptions, and finally a public storefront/checkout.

This repository **does not yet implement** a working cash register, Facebook sync, payment collection, public product pages, automated inventory deductions or verified production migrations.

## CI validation

Manually triggered GitHub Actions on Node 24 validates unit permissions, lint, Cloudflare bindings, typecheck, a full production Next.js build, and applies the committed D1 migration against the local emulator. It does not deploy to Cloudflare.

### Running checks deliberately

The GitHub Actions workflow is **manual only**, using `workflow_dispatch`. Pushes and pull requests must not trigger tests automatically. To run tests, open **Actions → Purkins checks → Run workflow**, select `feat/payload-foundation`, and start the run. The workflow is also registered on `main` solely so GitHub offers its manual trigger before the application branch is merged. Run it against a branch containing the application, not the README-only `main` branch.
