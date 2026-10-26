# Purkins — trust-first offline orders and COD operations

**Status:** first implementation slice, 26 October 2026. Not yet merged/deployed.  
**Related:** [Retail blueprint](PURKINS_RETAIL_BLUEPRINT.md), [Payment safety](PURKINS_PAYMENT_SAFETY.md), GitHub issue #40.

## Why this is a separate queue

Purkins has a valid paid order pipeline, plus an Admin-only **manual sale** route for money that has **already been received**. Neither one is suitable for a shopper saying "I want this item, but I'd like to pay on delivery" or "Please send payment instructions".

The new **unpaid order-request queue** records intent without pretending payment has been made, deducting stock, notifying a buyer of a fictitious paid order or inflating reported revenue.

## Customer workflow — implemented in first slice

1. Shopper adds live products/variants to cart and follows **Request order · Pay on delivery or arrange payment**.
2. The request form collects name, reachable phone, optional email, payment preference, fulfillment preference, area and notes. An explicit acknowledgement says the order is **unconfirmed** and **unpaid**.
3. Shopper selects:
   - **Pay on delivery** — cash or mutually agreed tender at handover, **only after operator agrees**;
   - **Receive payment instructions** — operator provides verified merchant details and total after contact;
   - **Contact me** — operator calls/messages to agree on payment/collection.
4. Public product subtotal comes from current D1 prices. Delivery charges are **not** included or promised yet. The final total is confirmed before accepting the order.
5. Store saves a **req_** reference and snapshots every cart line. Cart is cleared on successful submission. The confirmation page displays reference, payment preference and subtotal but **no private phone/email, no paid status**.
6. Public form is request-idempotent, checks variant/product live status and current available stock, rejects silently dropped cart lines, uses a honeypot and a per-phone sliding limit. **The edge still needs real IP rate limiting/bot mitigation if abuse appears.**

## Owner workflow — implemented in first slice

- Admin dashboard and **Orders** link to **Customer order requests** queue.
- Owner can inspect buyer contact, product snapshot, area, payment preference, subtotal, notes and follow-up state.
- Owner can record contact/awaiting-payment/cancelled with guarded status transition and internal note. This is **NOT** a payment-received checkbox.
- Verified money can separately be entered through the existing **Record paid sale** Admin tool. This first slice does **not** automatically convert req_ to canonical ord_ or create a reserved stock hold.

## What must happen before claiming end-to-end offline fulfillment

1. **Operator confirmation & stock allocation.** A request is subject to live inventory. Build an audited confirmed/allocated state that atomically reserves the exact product variants and can release stock on cancellation/expiry, not merely a status dropdown. COD must not result in accidental double-selling.
2. **Final quote.** Agree and record actual delivery/pickup fee, subtotal, discount, total and permitted delivery area. Show the quote to the buyer; require explicit acceptance before dispatch/collection.
3. **Payment instructions.** Add merchant-verified MTN MoMo, Airtel Money and bank account instructions in protected settings, with a safe customer rendering mechanism **after** the quote is confirmed. Do not invent or display payout account numbers or allow arbitrary staff notes to become payment credentials.
4. **Payment evidence & settlement.** Buyer may provide a transaction reference/screenshot as a **claim**, not proof. Operator independently verifies the merchant balance/statement or provider callback, then records amount, tender, reference, verified timestamp and operator. Partial payments and delivery fees need reconciliation.
5. **Order conversion without double decrement.** Convert each allocated `req_` to exactly one canonical `ord_` with accurate `pending`/`paid` states and line snapshots. Use an idempotency key and atomic D1 transaction; never create a second stock decrement at payment settlement.
6. **Cash on delivery.** Restrict to approved areas/methods, confirm phone/address, set delivery appointment, record dispatch/handover and cash receipt as separate events. Failed delivery must release stock and must not be recorded as revenue.
7. **Customer communications.** Confirm via WhatsApp/phone first; add authenticated transactional messaging/email with appropriate privacy, opt-in and retry controls. Never auto-notify without a configured verified sender.
8. **Delivery and returns.** Real charges, pickup points, owner contact, refund policy, no-show fees if applicable and consumer/legal policy pages require real merchant decisions; no fake promises.
9. **Privacy and operations.** Buyer phone and location notes are private; add retention/deletion schedule, safe export and authorized staff access. Admin queue is the first alert; proactive notifications and provider integrations are future work.

## Acceptance for this first release

- No live online payment account required to submit a customer request.
- Multiple items/variants retain correct D1-derived subtotal and identity.
- Identical retries do not duplicate a request or its line items; stale/conflicting retries reject.
- A request is not a paid order or revenue and does not alter production stock.
- Shop Admin can find and follow up, with a status CAS that prevents stale updates.
- No customer phone/email appears in query strings, confirmation URL, page metadata or public catalog.
- Demo opt-in safety PR #44 remains compatible; after both patches, **simulated payment is disabled** but real customers can still place unpaid order requests.

**Never treat either a buyer's order request or a payment screenshot as verified settlement.**
