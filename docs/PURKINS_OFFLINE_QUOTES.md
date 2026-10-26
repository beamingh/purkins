# Purkins — offline customer quote ledger (PR draft)

This extends the unpaid customer request intake introduced in PR #45. It is
**not** the order confirmation, payment-instructions distribution, stock allocation
or settlement system. Those remain in #46.

## Workflow

1. Buyer submits an unpaid `req_` request, supplying delivery/pickup preference.
2. Owner contacts the buyer to verify the selected items, availability, delivery
   address and actual service coverage.
3. Admin → Orders → Customer order requests → request detail → **Prepare an
   offline quote**. Owner enters:
   - Delivery or pickup;
   - Agreed delivery fee (ZMW);
   - Discount (ZMW);
   - Arrangement details and a private note.
4. Product subtotal is taken from the request's immutable D1 snapshot; total is
   computed using integer cents. No arbitrarily supplied cart or checkout amount
   is trusted.
5. Owner can revise a quote; optimistic revision checks stop a stale Admin page
   from overwriting an updated amount. Every successful revision is saved in a
   separately queryable audit history in the same atomic D1 transaction.
6. This feature **does not contact the buyer**. Owner manually communicates
   the quote, confirms the buyer agrees, and later follows the controlled paid
   conversion process once it exists.

## Safety boundaries

- New migration **0056**, additive only. No changes to paid orders, revenues,
  stock, checkout reservation tables or existing request lines.
- Admin-only mutation route (protected by Admin Worker and its middleware).
- Request must not be cancelled; stale quote revisions are rejected.
- Pickup cannot contain a delivery charge. Discount must leave a positive total.
- Every prepared quote is explicitly labeled as **not confirmed, not paid and
  not allocated**. It does NOT establish the buyer's consent to prices or dates.
- No mobile-money or bank account details are stored in or generated from notes.
- No shopper-facing payment instructions, QR codes, screenshot-based
  verification or webhook settlement are activated.

## Next linked PRs needed for complete issue #46

- Buyer acceptance/acknowledgement of a final quote with authenticated or
  independently verified contact channel.
- Idempotent reservation of exactly the available stock (including variants),
  with release on expiry or cancellation; reconciliation with existing online
  checkout reservations and with existing Manual Sale.
- Payment-instruction distribution from verified merchant configuration.
- Owner/provider confirmed funds and provider reference; support COD handover,
  partial payments, cancellation, refunds and failed deliveries.
- One-to-one `req_` → canonical `ord_` conversion with no double decrement.

## Validation before merge and deploy

```powershell
git fetch origin feat/purkins-offline-order-quotes
git switch --track origin/feat/purkins-offline-order-quotes

npx vitest run src/features/purkins/offlineQuote.integration.test.ts test/scripts/purkins-offline-quote-contract.test.mjs src/features/purkins/orderRequestDb.integration.test.ts

npm run check
npm run purkins:cloudflare -- build
```

Do not apply migration 0056 or deploy until all checks pass and this PR is merged.
