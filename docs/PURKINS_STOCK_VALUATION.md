# Purkins stock valuation and potential gross revenue report

## Purpose

View the current value of recorded remaining stock without conflating
three different metrics:

- **Inventory acquisition value / landed cost:** original paid purchase price
  plus any per-unit allocated overhead. Converted to ZMW using an **explicit,
  recorded** ZAR→ZMW rate where relevant. This does not use an assumed FX rate.
- **Original retailer tag reference:** tag values on remaining stock are grouped
  by original currency (ZAR, ZMW and eventually USD), never added across
  currencies or converted with an assumed exchange rate. They are not actual
  purchase expenditure, and they must not be used to calculate gross profit.
  The existing database accepts ZAR and ZMW tags only. Saving USD amounts
  requires a separate schema, API and inventory form update.
- **Potential gross revenue / retail value:** remaining stock quantity times
  the current intended selling price. This is only a hypothetical sell-out
  scenario, not actual revenue and not a guarantee the stock will sell.
- **Potential gross profit:** hypothetical retail revenue less the recorded
  landed acquisition cost for the same units. Actual net profit may be much
  lower after courier costs, payment fees, ads, refunds, discounts, other
  overhead and taxes.

The report lives at **Admin → Stock valuation**, linked from Admin home,
Products and Rapid Stock Intake. Private purchase cost information is not
available to shoppers. No migration is required.

## Correct treatment of stock and missing information

1. Only stock in the D1 product inventory appears; clothes or bulk items
   physically held but not entered in the system are **not** included.
2. For a product with size variants, **sum only the variants**; don't also
   count the product's mirrored stock total. A sellable 3-pack is one stock
   unit if sold as a pack.
3. Include unpublished draft products as owned stock, but label them as
   drafts. Draft stock with 0 selling price is **unpriced**, not free goods
   with a forecast of K0 revenue.
4. A supplier/retailer's ZAR price tag is not Purkins purchase cost. The
   report separately totals only tagged units, using variant-specific tags
   from `purkins_variant_intake_details` where available and falling back to the product-level tag. Tagged and
   untagged unit counts always cover the whole entered inventory.
   Purchase costs must come from the real acquisition invoice/record.
5. For ZAR costs, convert using `purchase_currency=ZAR` and the item's
   `zar_to_zmw` rate recorded at intake; without a saved rate the cost
   remains unknown.
6. Keep **known** retail-cost subtotals separately from fully calculable
   totals. If any remaining unit lacks a selling price, do not display a
   final total potential revenue; if a unit lacks cost, do not display total
   inventory cost or all-stock gross profit.
7. A fully priced and costed inventory can show full projected value.
   Product or variant rows with zero remaining stock do not add forecast
   revenue.
8. Two D1 read-only SQL queries are used: a whole-inventory aggregate and
   up to 150 prioritized detail lines. Detailed row display may be capped,
   but aggregate totals and coverage always include all recorded inventory.

## Current live-data verification before release

The report's SQL was executed read-only against the connected production D1
on 27 Oct 2026 without changing any resources.

- **31 products**, **42 stock/size lines**, **80 recorded remaining units**.
- **4 published units**; the other **76 units** are unpublished drafts.
- **4 priced units** at K950 (TY-899 warmers) = **K3,800 known retail value**.
- **76 units are unpriced**.
- **0 units have entered and convertible acquisition costs**.
- **66 of 80 units**, across **20 product types**, have original ZAR retailer
  tags: **R5,207.35** summed reference value. The other **14 units** lack
  tags. This is not confirmed original purchase expenditure.
- Gross revenue for all 80 units and all-stock potential gross profit cannot
  yet be computed. Also, many physical stock items are not yet entered.

## Validate

```powershell
git fetch origin feat/purkins-inventory-valuation-report
git switch --track origin/feat/purkins-inventory-valuation-report

npx vitest run src/features/purkins/stockValuation.integration.test.ts test/scripts/purkins-stock-valuation-contract.test.mjs
npm run check
npm run purkins:cloudflare -- build
```

This feature is a draft, **not yet deployed or merged**. It does not
apply migrations, modify prices, or change existing stock or sales.
