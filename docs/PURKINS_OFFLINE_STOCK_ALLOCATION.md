# Purkins confirmed offline stock allocation — draft phase

## What this provides

After the buyer agrees to a quote and the owner marks the request **contacted**
or **awaiting payment**, the owner may explicitly **Allocate stock** in the
private Admin request screen. The approved products/variants are deducted from
sellable inventory in D1 in one atomic transaction, sharing the exact stock
counts used by online checkout and paid manual sales.

One request gets **one stock allocation lifecycle**:
- **Held**: owner attests buyer's agreement to quote revision; item snapshot
  and operator identity are recorded; available quantities go down.
- **Released**: operator enters a reason and releases the exact held quantities
  back to stock. A second release cannot add them again.
- A released request cannot be reallocated: create a fresh request for a new
  agreement rather than reusing a historic hold.

Migration **0057** is additive. It adds the allocation ledger and database
triggers to stop cancellation, quote-price editing, or product/variant deletion
while a hold is active. It does not alter `orders` or record a payment.

## Important restrictions and next dependencies

1. This is a **manual owner-controlled allocation**; no automatic timeout.
   Cash-on-delivery can be scheduled beyond a generic checkout TTL. Owner must
   review aged holds and release abandoned requests. Automatic expiry can follow
   once confirmed delivery appointment dates and a rescheduling mechanism exist.
2. **Do not record an allocated request as a new ordinary manual paid sale.**
   That sale path decrements stock itself; a held request's inventory has already
   been deducted. The Admin page intentionally hides the separate paid-sale link
   while a hold is active and warns against double-decrementing.
3. **No money is verified or taken here.** We must next implement one-to-one
   `req_` → `ord_` settlement linked to the existing allocated stock, with
   tender, independently verified receipt, timestamp and operator. Only that
   conversion will count as revenue, and it must not decrement stock again.
4. Customer identity is still checked manually over phone/WhatsApp. The
   checkbox records **owner attestation**, not cryptographic proof that a buyer
   accepted terms or that a transaction was paid.
5. Storefront cache invalidation is attempted through the existing signed
   Admin→Public purge on allocation/release; failures are logged after successful
   D1 changes. Do not retry a hold simply because a cache purge warning appeared.
6. No real payment details, recipient account numbers, transport promises or
   actual paid transactions are created by these routes.

## Safety tests

- Concurrent competing requests for 4 sellable units.
- Idempotent hold submission; no second deduction.
- Rejection of invalid quote version and insufficient stock.
- Variant stock kept distinct from product stock.
- Quote changes, cancellations, product/variant deletions blocked while held.
- One-time release and recovery of exact stock; no paid-order side effects.

## Validate on Windows before merge

```powershell
git fetch origin feat/purkins-offline-stock-allocation
git switch --track origin/feat/purkins-offline-stock-allocation

npx vitest run src/features/purkins/offlineStockHold.integration.test.ts test/scripts/purkins-offline-stock-hold-contract.test.mjs src/features/purkins/offlineQuote.integration.test.ts src/features/purkins/orderRequestDb.integration.test.ts

npm run check
npm run purkins:cloudflare -- build
```

**Do not apply migration 0057 or deploy this draft before all tests pass and
the PR is merged.** Live D1 currently has migration 0056.
