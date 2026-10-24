/** Permission decisions shared by MCP registration and isolation tests.
 * An owner-issued dashboard client token is always read-only in v1, even when
 * the global operator flag (for separately verified identities) is enabled. */
export function canCreateCheckout(props: {readOnly?: boolean}|undefined|null):boolean {
  return props?.readOnly !== true;
}
export function canWriteAsOperator(
  props:{readOnly?:boolean}|undefined|null,globalWriteFlag:string|undefined,
):boolean {
  return props?.readOnly !== true && globalWriteFlag==='true';
}

export const MCP_OWNER_READ_TOOLS=[
  'browse_products',
  'get_product_details',
  'payment_methods',
  'check_order_status',
  'list_products',
  'get_product',
  'list_orders',
  'get_order',
  'order_stats',
  'daily_totals',
  'list_purkins_stock',
  'search_purkins_stock',
  'get_purkins_stock',
  'list_purkins_locations',
  'get_purkins_location',
  'list_purkins_categories',
  'get_purkins_category',
  'list_purkins_media',
  'get_purkins_gallery',
  'review_purkins_draft',
] as const;
