# Purkins COD dispatch dashboard — read-only Admin overview

Adds `/admin/order-requests/dispatch`, reachable from the Admin dashboard,
Orders, and Customer Order Requests.

## Purpose
The owner currently handles Facebook Page and Marketplace conversations,
Yango Bike delivery, and payment on arrival. Each request has separate
facts: approved product quote, held stock, courier progress, and real funds.

A rider reporting `delivered` is **not a paid order**. The dashboard
prioritizes:
- **Needs attention**: failed deliveries, parcels reported delivered but
  without verified payment, paid/delivered parcels not yet marked fulfilled
  in the canonical order, and physically returned parcels awaiting stock
  release.
- **With rider**: dispatched parcels not yet resolved.
- **Awaiting dispatch**: allocated delivery orders without a booking or
  with a planned booking.
- **Delivered and paid**: courier-delivered with a linked canonical paid
  order and confirmed fulfillment.
- **Returned / closed**: parcel returned and hold released, or a paid
  return that must be reconciled in the paid order.

## Safe scope
- Reads existing migration 0055–0059 tables; **no schema migration**.
- Displays private recipient contacts and route details only inside
  authenticated Admin; no new public endpoint.
- Read-only: no stock decrement, payment creation, courier booking, refunds
  or automated customer notifications.
- Product quotes and courier fares appear separately; fees directly paid
  to Yango are never assumed to be Purkins revenue.
- Prioritizes urgent issues in SQL before taking the latest 250 matching
  records. Counts show **only these displayed records**, and a warning
  appears if the source is truncated.
- All operational changes are done in the existing request detail page.

## Validation on Windows
```powershell
git fetch origin feat/purkins-cod-dispatch-dashboard
git switch --track origin/feat/purkins-cod-dispatch-dashboard

npx vitest run src/features/purkins/dispatchOverview.integration.test.ts test/scripts/purkins-cod-dispatch-dashboard-contract.test.mjs src/features/purkins/courierDelivery.integration.test.ts src/features/purkins/offlineSettlement.integration.test.ts

npm run check
npm run purkins:cloudflare -- build
```

**Draft PR, not yet locally validated, merged or deployed.** After local tests
and builds pass, merge and deploy both Workers as usual. No migration
necessary.
