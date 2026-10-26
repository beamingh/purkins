# Purkins payment safety: demo mode and the first real-payment release

Updated: 26 October 2026.

## Why demo is OFF by default

The existing demo rail is **not harmless fake data**. The same checkout engine:
- reserves real product/variant quantities in `checkout_reservations`;
- writes a real pending payment tagged `backend='demo'`;
- permits a visitor to self-approve a simulated payment and create a real `orders` row tagged `payment_method='demo'`.

Demo-tagged orders are excluded from financial reports, but while reservations are active they still reduce stock available for genuine sales. This is unsuitable as the only publicly available payment method for Purkins.

## Behavior introduced by this change

- `PURKINS_DEMO_CHECKOUT_ENABLED` is **opt-in**, parsed strictly as the string `true`. Missing, `false`, `1`, `yes` and other values disable demo.
- The checkout method-discovery API, cart, product Buy now and programmatic JSON checkout respect this flag and the Admin disabled-method list.
- The POST form checkout refuses a requested unavailable method rather than silently changing it into another payment rail.
- The direct in-app shipping-checkout route and the `/pay/:token` self-rendered settlement route reject disabled demo requests; the settlement service validates again.
- Any existing demo reservation still follows its established expiration/release path. Do not discard or reset D1 inventory. Before toggling modes, inspect active reservations.
- The shop stays browseable and customers can add to cart; checkout is unavailable until a real payment method is configured. No new method, mock money or order is invented.

## Controlled testing

This is a **public** opt-in, NOT staff-only authentication. Setting `PURKINS_DEMO_CHECKOUT_ENABLED=true` allows anyone who can reach the storefront to test orders. **Keep it unset/false on the production domain**; run end-to-end checkout exercises against an isolated test database/Worker instead.

The Purkins permanent deploy script does not manage or set this flag. Merely merging this PR does not enable demo; the intended production default is disabled.

## Production acceptance

1. With no real payment rail configured and no demo opt-in, `GET /api/checkout` reports zero available methods; cart explains checkout is unavailable.
2. A crafted form or JSON `method=demo` checkout refuses to create a reservation or pending payment. Neither stock nor orders changes.
3. An old unpaid `/pay/:token` demo URL cannot settle while disabled.
4. Existing published products and catalog prices remain unchanged.
5. When a real eligible merchant payment provider is configured, only its properly verified webhook/settlement can mark a genuine order paid.
6. Tests confirm demo-only opt-in and the Admin disable list both gate entry points.

## Real payments still to implement (issue #40)

The required next design decision is a merchant-supported Zambian settlement path:
- verified account and service-provider eligibility; precise fees/currencies and payout timeline;
- mobile money (MTN/Airtel) through an eligible aggregator or direct merchant API, or an approved alternative;
- signed callback verification, idempotent confirmation, trusted amount/reference/currency check;
- accurate delivery/pickup selection and fee display before order placement;
- stock reserve/expiry/release, truthful order status, receipts, cancellation/refunds and reconciliation.

Do NOT mark any order paid solely from a screenshot or unverified mobile-money notification, and do not collect real customer funds in a simulated checkout.
