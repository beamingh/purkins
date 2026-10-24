# Purkins Admin ↔ MCP parity implementation

Status: implementation in progress. Branch: `feat/purkins-mcp-admin-parity`.
Source baseline: `main`, 24 October 2026. This is a **source-code inventory**, not a production acceptance report.

## Contract

1. Every protected Admin action should have an equivalent operator MCP capability, barring interactive login/setup flows whose secure equivalent is identity or credential management.
2. Both interfaces invoke the same domain services, validation, status transitions and permission checks. Do not proxy browser forms as a shortcut.
3. Buyer MCP tools never access private supplier codes, internal locations, costs or customers.
4. Private operator reads require operator authentication. Writes additionally require scoped authorization, audit trail, idempotency, collision/concurrency protection and explicit confirmation for publication, refunds, destructive changes and sensitive settings.
5. Production `PURKINS_MCP_WRITES_ENABLED` stays **false** until tested and separately approved. No remote D1 changes, release or stock import is authorized by this branch.
6. Every new feature ships with a positive/negative authorization test, domain parity test and error/retry tests.

## Existing MCP inventory (verified in code)

Public: `browse_products`, `get_product_details`, `payment_methods`, `create_checkout`, `check_order_status`.

Operator reads: `list_products`, `get_product`, `list_orders`, `get_order`, `order_stats`, `daily_totals`, `list_purkins_stock`, `search_purkins_stock`, `get_purkins_stock`.

Operator writes behind the existing global switch: `create_product`, `update_product`, `fulfill_order`, `create_purkins_stock`, `update_purkins_stock`, `set_purkins_variant`, `approve_purkins_stock`. Existing switch alone is **not** sufficient authorization for production launch.

New on this branch: `list_purkins_locations`, `get_purkins_location`. Both operator-only and read-only, backed by `src/features/purkins/locations.ts`.

## Admin surface requiring parity review

| Surface verified in source tree | Work still needed |
| --- | --- |
| Products and stock intake | Complete variant, stock adjustment, media association, review, archive and batch operations; safeguard retries |
| Hierarchical locations | Read tools added; create/move still missing; verify duplicate-name and cycle protections |
| Categories | List, create, edit, hierarchy, remove |
| Media | Upload and attach, order, detach/delete with R2 safety |
| Orders | Manual sale, detailed status/fulfilment updates, cancellation and safe adjustments |
| Refunds | Read plus explicit owner-confirmed, reconciled refund actions |
| Customers | Read/search/update and privacy-aware handling |
| Shipping | Rates, zones, pickup and fulfilment configuration |
| Pages | Draft/edit/publish/retire and SEO fields |
| Navigation | Menu item ordering and hierarchy operations |
| Settings | Typed, permission-scoped configuration; protect credentials and auth boundary |
| Email | Read status and retry where supported; never unrestricted blast sending |
| Search | Admin search/filter and stock locator parity |
| Reporting | Revenue, cost/landed value, margins, counts, aged stock, low stock and exports |

The source-tree inventory alone does not prove every action listed is currently implemented in Admin. Audit each actual route and POST/API handler before adding its MCP counterpart.

## Release gates

- Unit/typecheck, D1 integration, representative UI↔MCP parity and local Worker HTTP tests.
- Unauthorized buyer and operator-denied tests; redaction of private fields.
- Repeated requests cannot duplicate product, sale, stock movement, refund or external notification.
- Stale concurrent updates fail predictably, not last-write-wins.
- Media changes are verified across D1 and R2, including orphan cleanup.
- Explicit owner approval for dangerous operations; dry-run/preview for bulk actions.
- Document and validate the compatible ChatGPT connection flow before production enablement.
