# Purkins: Admin-paid manual sales (phase 1)

## Operator workflow

From **Admin → Orders → Record paid sale**, add 1–30 catalog SKUs
(including private stock-intake drafts), their variants, quantities and actual
selling prices. Optionally add a customer name/email. Existing customers are
identified by email (there is currently no separately stored customer account
record). Choose a sales channel (walk-in, WhatsApp, Facebook, phone, other),
**received** tender (cash, Airtel Money, MTN MoMo, Zamtel Money, bank transfer,
other), delivery/pickup and fulfillment state.

**Do not use this form for unpaid deposits or unpaid orders.** This release
records immediately *paid* sales only. It calculates revenue using existing
`orders` analytics and writes canonical `order_items`. Because the online
order/guest-access protocol is distinct, manual orders have **no** guest token,
no automated buyer email, and are visible under Admin Orders. Customer account
history may show the summary as plain text, not a buyer-facing order link.

## Inventory and safety

The D1 transaction inserts a paid order only if the aggregated stock for **all**
selected items is sufficient. In the same batch, it deducts stock from the exact
products/variants and creates order line IDs and a `purkins_manual_sales` row.
An idempotency key in the form becomes the unique `provider_session_id`:
repeated requests cannot deduct stock twice. A failed batch rolls back every
change. Manual sales can sell unpublished drafts; none are automatically
published on the storefront.

This feature uses the original Purkins D1 database. There is **no new staging**
DB or R2 bucket. The migration `0044_purkins_manual_sales.sql` only adds
a metadata table and one index.

## Verification gates (Windows PowerShell)

On the feature branch, before merging:

```powershell
npm run check
npx vitest run src/features/purkins/manualSale.test.ts src/features/email/orderPolicy.test.ts
node --experimental-strip-types test/integration/manual-sales.mjs
npm run purkins:cloudflare -- build
```

Once all pass, merge and pull `main`. Before deploying the **new code**,
apply migration 0044 to the existing production D1 using the existing
permanent migration gate:

```powershell
npm run purkins:cloudflare -- migrate --confirm=MIGRATE-PURKINS-FOREVER
npm run purkins:cloudflare -- deploy --confirm=DEPLOY-UNROUTED-PURKINS
```

Do not deploy the new manual-sale route before its table exists. Do not seed or
reset the permanent database.

## Phase 2 (not yet implemented)

- Draft orders and quotes without received revenue
- Confirmed unpaid orders with explicit expiration/release of inventory holds
- Partial payments and an append-only payment ledger
- Conversion into a paid sale only after full settlement
- Delivery addresses, printable invoices/receipts, cancellations and returns
- Search-backed catalog picker beyond the first 1,500 stock options
- Cross-Worker cache invalidation if public caching is enabled later

These need a separate order/payment state-machine design. Treating an unpaid
order as paid, or decrementing stock without an expiration/release policy,
would distort Purkins revenue and inventory.
