# Purkins Facebook / Marketplace → Yango Bike COD workflow

## Background

The owner may negotiate stock and pricing in Facebook messages or Marketplace,
send a baby product by Yango Bike, and let the recipient inspect/receive it
before transferring the product payment. The customer also pays for delivery.

**This is not an e-commerce pay-now flow.** Parcel dispatch, arrival and
customer promises are not themselves income. The system must record what
actually happened separately.

## Owner steps

1. **Admin → Customer order requests → Enter Facebook / Marketplace enquiry**:
   select catalog product(s)/sizes/quantities, source, customer's name and
   reachable phone, delivery area and notes. Admin uses current catalog prices
   and available units from D1. It creates a new **unpaid** `req_`.
   Products must be active/published in the store at this stage; unlisted sack
   stock must be listed before it can be selected.
2. **Contacted → Prepare quote**: agree any product discount, the amount
   payable to Purkins and courier arrangements. If the customer pays Yango
   directly, set the quote's Purkins delivery fee to **K0**. If Purkins
   collects the delivery charge, it belongs in the quote and eventual paid order.
3. **Allocate stock** only after the customer agrees to the quote. This
   deducts sellable inventory one time (existing migration 0057).
4. **Dispatch and delivery log**: plan delivery with pickup/drop-off addresses,
   recipient name/phone, Yango booking, rider contact, actual courier fare,
   who will pay that fare, whether the buyer reports paying the rider or
   Purkins has paid the courier, and a private note. Progress through
   planned → dispatched → delivered / delivery failed → returned.
   The log uses guarded revisions and keeps an event history.
5. **Payment on receipt**: confirm the product payment directly in Purkins'
   receiving MTN/Airtel/bank account **before recording it as paid**.
   For cash, count the money actually received. A rider's message or buyer
   screenshot is not enough. Use the full-payment settlement form added in
   PR #50 (migration 0058) to convert the hold into one paid `ord_`.
6. **Failed delivery or refusal**: record the actual outcome. Stock cannot be
   returned to availability while marked with rider, delivered or failed;
   first confirm the physical parcel has returned to Purkins, record
   status **returned** with a clear note, then release the held stock.
   For already paid orders, use the paid-order returns/refund workflow and do
   not release the stock hold directly.

## Important accounting and operational boundaries

- The logged Yango fare is **not automatically sales revenue**.
  - Buyer pays rider directly: courier cost and any customer-reported fee payment are tracked, Purkins delivery fee in
    quote **K0**. Total paid to Purkins excludes that fare.
  - Purkins pays rider: the fare is a business cost with a manually recorded payment status. Any delivery amount
    charged to the buyer must be agreed and included in the quote.
- An order may be **delivered but not paid** (failed receipt), or **paid but
  not yet delivered**. Delivery status never silently changes paid state.
- The delivery form and source ledger store personal delivery details in
  private Admin/D1 only. Do not post them on public pages.
- **No Yango API integration** or rider tracking feed. The owner types the
  known details manually. Yango cash-on-delivery collection must not be
  presumed supported; agree courier responsibilities separately.
- No customer payment is collected automatically by a third party through
  this software.
- This release does **not** implement deposit handling or partial payment.
  Do not confirm a partial amount as a fully paid sale.
- If the customer pays the rider for the *products*, the money is not yet
  received by Purkins unless the courier actually remits it. The operator
  should wait to record the paid order until Purkins has the funds.

## Migration and rollout dependency

This draft adds **migration 0059**, after the **0058 verified full-payment
conversion migration** in PR #50. Apply 0058 before 0059, and do not deploy this
draft until merged, tested and approved.

## Validate on Windows

```powershell
git fetch origin feat/purkins-yango-cod-dispatch-log
git switch --track origin/feat/purkins-yango-cod-dispatch-log

npx vitest run src/features/purkins/courierDelivery.integration.test.ts test/scripts/purkins-yango-cod-workflow-contract.test.mjs src/features/purkins/offlineSettlement.integration.test.ts src/features/purkins/offlineStockHold.integration.test.ts

npm run check
npm run purkins:cloudflare -- build
```

All D1 test cases use an isolated Miniflare test database, never production.
