import type { D1Database } from '@cloudflare/workers-types';

/**
 * All physically recorded sellable unit groups, including unpublished drafts.
 * A variant-based product contributes ONLY its variant units; never add its
 * parent stock count a second time. Costs are private and supplier tag prices
 * are deliberately excluded (a retailer's tag is not our acquisition cost).
 */
const STOCK_LINES = `
WITH stock_lines AS (
  SELECT p.id AS product_id, p.public_id AS product_public_id, p.name,
    NULL AS variant_label, p.active AS published, p.currency,
    p.stock AS units, p.price_cents AS price_cents,
    i.purchase_cost_minor, i.purchase_currency, i.zar_to_zmw,
    i.overhead_zwm_cents, i.status AS intake_status,
    i.retail_tag_minor AS original_tag_minor, i.retail_tag_currency AS original_tag_currency
  FROM products p LEFT JOIN purkins_intake i ON i.product_id=p.id
  WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
  UNION ALL
  SELECT p.id AS product_id, p.public_id AS product_public_id, p.name,
    v.label AS variant_label, p.active AS published, p.currency,
    v.stock AS units, v.price_cents AS price_cents,
    i.purchase_cost_minor, i.purchase_currency, i.zar_to_zmw,
    i.overhead_zwm_cents, i.status AS intake_status,
    COALESCE(vi.retail_tag_minor,i.retail_tag_minor) AS original_tag_minor,
    CASE WHEN vi.retail_tag_minor IS NOT NULL THEN COALESCE(vi.retail_tag_currency,i.retail_tag_currency)
      ELSE i.retail_tag_currency END AS original_tag_currency
  FROM products p JOIN product_variants v ON v.product_id=p.id
  LEFT JOIN purkins_intake i ON i.product_id=p.id
  LEFT JOIN purkins_variant_intake_details vi ON vi.variant_id=v.id
),
valued AS (
  SELECT *,
    CASE
      WHEN purchase_cost_minor IS NULL THEN NULL
      WHEN purchase_currency='ZMW' THEN purchase_cost_minor + COALESCE(overhead_zwm_cents,0)
      WHEN purchase_currency='ZAR' AND zar_to_zmw>0
        THEN CAST(ROUND(purchase_cost_minor*zar_to_zmw) AS INTEGER)+COALESCE(overhead_zwm_cents,0)
      ELSE NULL END AS landed_unit_cost_cents
  FROM stock_lines
)
`;

export interface ValuationLine {
  product_id:number;
  product_public_id:string|null;
  name:string;
  variant_label:string|null;
  published:number;
  currency:string;
  units:number;
  price_cents:number;
  intake_status:string|null;
  landed_unit_cost_cents:number|null;
  original_tag_minor:number|null;
  original_tag_currency:string|null;
}
export interface StockValuation {
  productCount:number;
  lineCount:number;
  totalUnits:number;
  publishedUnits:number;
  unpricedUnits:number;
  missingCostUnits:number;
  pricedUnits:number;
  costedUnits:number;
  taggedUnits:number;
  untaggedUnits:number;
  taggedProductCount:number;
  taggedValueZarMinor:number;
  taggedValueZmwMinor:number;
  taggedValueUsdMinor:number;
  matchedUnits:number;
  pricedValueCents:number;
  knownCostValueCents:number;
  comparableRevenueCents:number;
  comparableCostCents:number;
  comparableGrossProfitCents:number;
  currencyExceptions:number;
  negativeStockLines:number;
  completePotentialRevenueCents:number|null;
  completeInventoryCostCents:number|null;
  completePotentialGrossProfitCents:number|null;
  lines:ValuationLine[];
  detailTruncated:boolean;
}

interface RawSummary {
  product_count:number; line_count:number; total_units:number; published_units:number;
  unpriced_units:number; missing_cost_units:number; priced_units:number;
  costed_units:number; tagged_units:number; untagged_units:number;
  tagged_product_count:number; tagged_value_zar_minor:number;
  tagged_value_zmw_minor:number; tagged_value_usd_minor:number;
  matched_units:number; priced_value_cents:number;
  known_cost_value_cents:number; comparable_revenue_cents:number;
  comparable_cost_cents:number; currency_exceptions:number; negative_stock_lines:number;
}

const SUMMARY = `
SELECT
  COUNT(DISTINCT product_id) AS product_count,
  COUNT(*) AS line_count,
  COALESCE(SUM(CASE WHEN units>0 THEN units ELSE 0 END),0) AS total_units,
  COALESCE(SUM(CASE WHEN units>0 AND published=1 THEN units ELSE 0 END),0) AS published_units,
  COALESCE(SUM(CASE WHEN units>0 AND price_cents<=0 THEN units ELSE 0 END),0) AS unpriced_units,
  COALESCE(SUM(CASE WHEN units>0 AND landed_unit_cost_cents IS NULL THEN units ELSE 0 END),0) AS missing_cost_units,
  COALESCE(SUM(CASE WHEN units>0 AND price_cents>0 THEN units ELSE 0 END),0) AS priced_units,
  COALESCE(SUM(CASE WHEN units>0 AND landed_unit_cost_cents IS NOT NULL THEN units ELSE 0 END),0) AS costed_units,
  COALESCE(SUM(CASE WHEN units>0 AND original_tag_minor>0 AND UPPER(COALESCE(original_tag_currency,'')) IN ('ZAR','ZMW','USD') THEN units ELSE 0 END),0) AS tagged_units,
  COALESCE(SUM(CASE WHEN units>0 AND (original_tag_minor IS NULL OR original_tag_minor<=0 OR UPPER(COALESCE(original_tag_currency,'')) NOT IN ('ZAR','ZMW','USD')) THEN units ELSE 0 END),0) AS untagged_units,
  COUNT(DISTINCT CASE WHEN units>0 AND original_tag_minor>0 AND UPPER(COALESCE(original_tag_currency,'')) IN ('ZAR','ZMW','USD') THEN product_id ELSE NULL END) AS tagged_product_count,
  COALESCE(SUM(CASE WHEN units>0 AND original_tag_minor>0 AND UPPER(COALESCE(original_tag_currency,''))='ZAR' THEN units*original_tag_minor ELSE 0 END),0) AS tagged_value_zar_minor,
  COALESCE(SUM(CASE WHEN units>0 AND original_tag_minor>0 AND UPPER(COALESCE(original_tag_currency,''))='ZMW' THEN units*original_tag_minor ELSE 0 END),0) AS tagged_value_zmw_minor,
  COALESCE(SUM(CASE WHEN units>0 AND original_tag_minor>0 AND UPPER(COALESCE(original_tag_currency,''))='USD' THEN units*original_tag_minor ELSE 0 END),0) AS tagged_value_usd_minor,
  COALESCE(SUM(CASE WHEN units>0 AND price_cents>0 AND landed_unit_cost_cents IS NOT NULL THEN units ELSE 0 END),0) AS matched_units,
  COALESCE(SUM(CASE WHEN units>0 AND price_cents>0 THEN units*price_cents ELSE 0 END),0) AS priced_value_cents,
  COALESCE(SUM(CASE WHEN units>0 AND landed_unit_cost_cents IS NOT NULL THEN units*landed_unit_cost_cents ELSE 0 END),0) AS known_cost_value_cents,
  COALESCE(SUM(CASE WHEN units>0 AND price_cents>0 AND landed_unit_cost_cents IS NOT NULL THEN units*price_cents ELSE 0 END),0) AS comparable_revenue_cents,
  COALESCE(SUM(CASE WHEN units>0 AND price_cents>0 AND landed_unit_cost_cents IS NOT NULL THEN units*landed_unit_cost_cents ELSE 0 END),0) AS comparable_cost_cents,
  COALESCE(SUM(CASE WHEN units>0 AND LOWER(currency)!='zmw' THEN 1 ELSE 0 END),0) AS currency_exceptions,
  COALESCE(SUM(CASE WHEN units<0 THEN 1 ELSE 0 END),0) AS negative_stock_lines
FROM valued`;

const DETAILS = `
SELECT product_id,product_public_id,name,variant_label,published,currency,
  units,price_cents,intake_status,landed_unit_cost_cents,original_tag_minor,original_tag_currency
FROM valued WHERE units>0
ORDER BY
  CASE WHEN price_cents<=0 OR landed_unit_cost_cents IS NULL THEN 0 ELSE 1 END,
  published ASC,name COLLATE NOCASE,variant_label
LIMIT 151`;

export async function getStockValuation(db:D1Database):Promise<StockValuation> {
  const [sum,detail]=await Promise.all([
    db.prepare(STOCK_LINES+SUMMARY).first<RawSummary>(),
    db.prepare(STOCK_LINES+DETAILS).all<ValuationLine>(),
  ]);
  if(!sum)throw new Error('Inventory valuation could not be read.');
  const moneyOk=sum.currency_exceptions===0 && sum.negative_stock_lines===0;
  const completePrice=moneyOk && sum.unpriced_units===0;
  const completeCost=moneyOk && sum.missing_cost_units===0;
  const comparableGrossProfitCents=sum.comparable_revenue_cents-sum.comparable_cost_cents;
  return {
    productCount:sum.product_count,lineCount:sum.line_count,
    totalUnits:sum.total_units,publishedUnits:sum.published_units,
    unpricedUnits:sum.unpriced_units,missingCostUnits:sum.missing_cost_units,
    pricedUnits:sum.priced_units,costedUnits:sum.costed_units,
    taggedUnits:sum.tagged_units,untaggedUnits:sum.untagged_units,
    taggedProductCount:sum.tagged_product_count,taggedValueZarMinor:sum.tagged_value_zar_minor,
    taggedValueZmwMinor:sum.tagged_value_zmw_minor,taggedValueUsdMinor:sum.tagged_value_usd_minor,
    matchedUnits:sum.matched_units,
    pricedValueCents:sum.priced_value_cents,
    knownCostValueCents:sum.known_cost_value_cents,
    comparableRevenueCents:sum.comparable_revenue_cents,
    comparableCostCents:sum.comparable_cost_cents,
    comparableGrossProfitCents,
    currencyExceptions:sum.currency_exceptions,
    negativeStockLines:sum.negative_stock_lines,
    completePotentialRevenueCents:completePrice?sum.priced_value_cents:null,
    completeInventoryCostCents:completeCost?sum.known_cost_value_cents:null,
    completePotentialGrossProfitCents:completePrice&&completeCost?
      sum.priced_value_cents-sum.known_cost_value_cents:null,
    lines:(detail.results??[]).slice(0,150),
    detailTruncated:(detail.results??[]).length>150,
  };
}
