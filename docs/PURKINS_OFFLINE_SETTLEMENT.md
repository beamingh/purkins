# Purkins offline full-payment settlement — draft

This is the **paid conversion phase** of [issue #46]. It builds on:
- 0055: unpaid customer requests;
- 0056: owner-prepared quotes;
- 0057: owner-approved inventory allocation.

It adds **migration 0058** and a protected Admin payment form.

## Owner workflow

1. Buyer requests goods and you confirm the exact final quote.
2. You allocate stock against that approved quote. The available inventory goes
   down **once**, at allocation time. No paid order yet.
3. Only **after full payment has actually arrived**, open Admin → Customer order
   requests → request detail → **When payment is actually received**.
4. Select tender (cash, MTN MoMo, Airtel Money, Zamtel, bank, other), sales
   channel and actual handover status.
5. For cash, physically count the money. For transfers, independently check the
   incoming transaction in your own receiving account or wallet and enter its
   reference. Buyer-provided screenshots are **not** sufficient.
6. Provide an internal verification note, attest full funds received and submit.
7. The backend atomically creates **one real paid order**, item identities,
   manual-sale metadata and an immutable request-linked settlement receipt.
   It deliberately does **not** touch stock again. Admin redirects to the
   canonical paid `ord_` record for fulfillment, refunds and reporting.

## Safety invariants

- The posted form never supplies the amount; the server uses the **latest
  approved quote** tied to the active stock hold.
- Only full received payments are recorded; **partial payment / deposit
  tracking is not supported by this initial phase**. Never claim a partial
  payment is a fully paid order.
- One `req_` → at most one `ord_`. A duplicate submit with the same nonce
  returns the existing order; a different attempt must not create a second.
- Unique receiving-account reference per tender, case-insensitive, helps
  catch duplicate transfer records. **This is not an API integration with the
  payment provider**: it records the owner's explicit receipt verification.
- Paid settlement receipts are immutable; the allocated stock cannot be
  manually released or converted again, and the request cannot be cancelled
  through unpaid-request controls. Subsequent refunds and returns belong
  in the paid-order workflow.
- Admin paid orders continue to use the existing `orders`, `order_items`
  and `purkins_manual_sales` tables, so payment reporting is centralized.
- The paid order retains its actual `shipping_cents` (delivery fee),
  `discount_cents` and `amount_total_cents`. Item unit prices are
  preserved from the original stock-hold snapshot.
- No buyer-facing payment instructions are sent and no fake payment rail
  is enabled. Merchant account details are never guessed.

## Validation

Use an **isolated Miniflare D1**, never production for money tests.

```powershell
git fetch origin feat/purkins-offline-settlement-conversion
git switch --track origin/feat/purkins-offline-settlement-conversion

npx vitest run src/features/purkins/offlineSettlement.integration.test.ts test/scripts/purkins-offline-paid-conversion-contract.test.mjs src/features/purkins/offlineStockHold.integration.test.ts src/features/purkins/offlineQuote.integration.test.ts src/features/purkins/orderRequestDb.integration.test.ts

npm run check
npm run purkins:cloudflare -- build
```

PR remains draft, unverified, unmerged and undeployed until these tests
and both Worker builds pass. **Do not apply migration 0058 yet**.

## Outstanding enhancements

- Safely capture partial payments and deposits, reconciliation differences,
  reversed/misdirected transfers, and provider webhooks when available.
- Configured merchant payment instruction delivery and confirmations.
- Confirmed delivery dates, failed-COD/rescheduling/expiry policies for holds.
- Production browser smoke tests and end-to-end sales reporting reconciliation.
