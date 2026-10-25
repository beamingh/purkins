/**
 * Source-of-truth list of every registered Purkins MCP tool. Client permissions
 * are individual tool IDs, not broad scopes. Full access selects the complete
 * list, while a new connection defaults to private/public READ tools only.
 *
 * Permissions are immutable after issuance: revoke and replace an existing
 * credential to change them. The Worker-level emergency and scoped write gates
 * are always additionally required, never overridden by client grants.
 */
export const MCP_TOOL_PERMISSIONS = [
  {name:'browse_products',group:'Storefront reads',label:"Browse Products",safety:'read'},
  {name:'get_product_details',group:'Storefront reads',label:"Get Product Details",safety:'read'},
  {name:'payment_methods',group:'Storefront reads',label:"Payment Methods",safety:'read'},
  {name:'check_order_status',group:'Storefront reads',label:"Check Order Status",safety:'read'},
  {name:'list_products',group:'Private catalog reads',label:"List Products",safety:'read'},
  {name:'get_product',group:'Private catalog reads',label:"Get Product",safety:'read'},
  {name:'list_purkins_stock',group:'Private catalog reads',label:"List Purkins Stock",safety:'read'},
  {name:'search_purkins_stock',group:'Private catalog reads',label:"Search Purkins Stock",safety:'read'},
  {name:'get_purkins_stock',group:'Private catalog reads',label:"Get Purkins Stock",safety:'read'},
  {name:'list_purkins_categories',group:'Private catalog reads',label:"List Purkins Categories",safety:'read'},
  {name:'get_purkins_category',group:'Private catalog reads',label:"Get Purkins Category",safety:'read'},
  {name:'list_orders',group:'Orders and reporting',label:"List Orders",safety:'read'},
  {name:'get_order',group:'Orders and reporting',label:"Get Order",safety:'read'},
  {name:'order_stats',group:'Orders and reporting',label:"Order Stats",safety:'read'},
  {name:'daily_totals',group:'Orders and reporting',label:"Daily Totals",safety:'read'},
  {name:'list_purkins_locations',group:'Locations and media reads',label:"List Purkins Locations",safety:'read'},
  {name:'get_purkins_location',group:'Locations and media reads',label:"Get Purkins Location",safety:'read'},
  {name:'list_purkins_media',group:'Locations and media reads',label:"List Purkins Media",safety:'read'},
  {name:'get_purkins_gallery',group:'Locations and media reads',label:"Get Purkins Gallery",safety:'read'},
  {name:'review_purkins_draft',group:'Locations and media reads',label:"Review Purkins Draft",safety:'read'},
  {name:'create_guarded_purkins_draft',group:'Guarded stock drafts',label:"Create one private draft with idempotency",safety:'guarded'},
  {name:'adjust_guarded_purkins_stock',group:'Guarded stock drafts',label:"Reconcile draft stock with revision check",safety:'guarded'},
  {name:'bulk_create_guarded_clothing_drafts',group:'Guarded stock drafts',label:"Bulk clothing sizes and barcodes",safety:'guarded'},
  {name:'reconcile_guarded_purkins_variant',group:'Guarded stock drafts',label:"Correct clothing variant stock/price/barcode",safety:'guarded'},
  {name:'create_purkins_location',group:'Guarded locations and photos',label:"Create stock location",safety:'guarded'},
  {name:'move_purkins_location',group:'Guarded locations and photos',label:"Move stock location",safety:'guarded'},
  {name:'attach_guarded_purkins_photo',group:'Guarded locations and photos',label:"Attach draft photo",safety:'guarded'},
  {name:'set_guarded_purkins_photo_alt',group:'Guarded locations and photos',label:"Edit draft photo alt text",safety:'guarded'},
  {name:'make_guarded_purkins_photo_primary',group:'Guarded locations and photos',label:"Choose primary draft photo",safety:'guarded'},
  {name:'create_purkins_stock',group:'Legacy stock editing and publishing',label:"Create Purkins Stock",safety:'legacy'},
  {name:'update_purkins_stock',group:'Legacy stock editing and publishing',label:"Update Purkins Stock",safety:'legacy'},
  {name:'set_purkins_variant',group:'Legacy stock editing and publishing',label:"Set Purkins Variant",safety:'legacy'},
  {name:'approve_purkins_stock',group:'Legacy stock editing and publishing',label:"Publish stock (legacy approval gate)",safety:'legacy'},
  {name:'create_product',group:'Legacy stock editing and publishing',label:"Create Product",safety:'legacy'},
  {name:'update_product',group:'Legacy stock editing and publishing',label:"Update Product",safety:'legacy'},
  {name:'attach_purkins_media',group:'Legacy media editing',label:"Attach Purkins Media",safety:'legacy'},
  {name:'import_purkins_image',group:'Legacy media editing',label:"Import a remote image (legacy gate)",safety:'legacy'},
  {name:'set_purkins_photo_alt',group:'Legacy media editing',label:"Set Purkins Photo Alt",safety:'legacy'},
  {name:'create_checkout',group:'Commerce operations',label:"Start a checkout",safety:'commerce'},
  {name:'fulfill_order',group:'Commerce operations',label:"Mark an order fulfilled",safety:'commerce'},
] as const;
export type McpToolName = (typeof MCP_TOOL_PERMISSIONS)[number]['name'];
export const MCP_ALL_TOOLS: readonly McpToolName[] = MCP_TOOL_PERMISSIONS.map(t=>t.name);
export const MCP_OWNER_READ_TOOLS: readonly McpToolName[] =
  MCP_TOOL_PERMISSIONS.filter(t=>t.safety==='read').map(t=>t.name);
export const MCP_WRITABLE_TOOLS: readonly McpToolName[] =
  MCP_TOOL_PERMISSIONS.filter(t=>t.safety!=='read').map(t=>t.name);
const allowed = new Set<string>(MCP_ALL_TOOLS);
const writable = new Set<string>(MCP_WRITABLE_TOOLS);

/** Reject unknown names rather than accidentally granting future tools. */
export function normalizeMcpToolPermissions(
  input: readonly string[],
): McpToolName[] | null {
  if (input.length > MCP_ALL_TOOLS.length) return null;
  if (input.some(name=>!allowed.has(name))) return null;
  const chosen = new Set(input);
  if (chosen.size!==input.length) return null;
  return MCP_ALL_TOOLS.filter(name=>chosen.has(name));
}

/** Existing pre-migration credentials remain confined to the old read set. */
export function parseStoredMcpPermissions(json: string | null): McpToolName[] | null {
  if (json === null) return [...MCP_OWNER_READ_TOOLS];
  try {
    const value:unknown=JSON.parse(json);
    if(!Array.isArray(value)||!value.every(item=>typeof item==='string'))return null;
    return normalizeMcpToolPermissions(value);
  } catch { return null; }
}
export function hasWritePermissions(names:readonly string[]):boolean{
  return names.some(name=>writable.has(name));
}

/** Also used by established legacy bearer and Access auth. */
export function canCreateCheckout(props:{readOnly?:boolean}|null|undefined):boolean{
  return props?.readOnly!==true;
}

/** Owner-issued tokens need explicit global write opt-in even for the public
 * checkout creation tool; legacy shoppers/clients keep existing behavior. */
export function canCreateScopedCheckout(
  props:{readOnly?:boolean;toolPermissions?:readonly string[]}|null|undefined,
  globalWriteFlag:string|undefined,
):boolean{
  return canCreateCheckout(props) && (
    !props?.toolPermissions || globalWriteFlag==='true'
  );
}
export function canWriteAsOperator(
  props:{readOnly?:boolean}|null|undefined, globalWriteFlag:string|undefined,
):boolean{
  return props?.readOnly!==true && globalWriteFlag==='true';
}
