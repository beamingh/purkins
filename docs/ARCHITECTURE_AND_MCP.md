# Purkins architecture and MCP roadmap

This is deliberately a **small, separate Purkins application**. We inspected SeeZambia's AdminWorkspaceShell, page primitives, MCP catalog, RBAC/governance layer and service-account controls as architectural references. No SeeZambia implementation, business data, users, tokens or Cloudflare resources are imported.

## Presentation and admin boundary

- **`/admin` is the single branded Purkins home**, implemented by replacing Payload's dashboard view inside its standard authenticated DefaultTemplate.
- Payload keeps its existing sidebar, login, inventory/media/user editors and permissions. The dashboard links to those editor routes; it does not duplicate navigation.
- `/` and former `/workspace` both redirect to `/admin` for compatibility.
- The workspace authenticates with `GET /api/users/me`; unauthorized visitors are shown a sign-in screen, never catalogue data.
- All workspace reads use the existing same-origin Payload REST API under the logged-in user session; Payload collection/field access remains authoritative. Do not put a client-side role check in place of backend authorization.
- The cards query the latest items with pagination; per-status counts use separate, real server queries. Prices are in ZMW. Cost price is never presented to a partner.
- A shared inventory application-service layer should own validated business operations when we add orders, stock changes and MCP. Neither browser UI nor MCP should implement inventory rules independently.

## What we adapt from SeeZambia

1. A clear workspace shell and compact dashboard primitives, instead of 100 unrelated CMS screens.
2. Separated domain operations from transport (browser, REST, MCP).
3. Service-account authentication, explicit allowlists, expiries and quotas.
4. Roles, risk-based permission controls, a tool-by-tool kill switch and append-only audit events.
5. Idempotency keys, conflict/version checks, confirmations and failures that don't silently swallow errors.

**Do not** copy SeeZambia's election/publication permissions, private audit datasets, tokens, Cloudflare bindings, admin action dispatcher or entire MCP router.

## Proposed MCP tools (not live yet)

| Tool | Category | Allowed actor | Guardrails |
| --- | --- | --- | --- |
| `inventory_list` | read | owner / pricing partner | pagination, no costs for partner |
| `inventory_get` | read | owner / pricing partner | exact SKU, owner-only cost |
| `inventory_summary` | read | owner / pricing partner | bounded aggregate counts |
| `price_suggest` | write | pricing partner / owner | suggested price only, idempotent |
| `inventory_draft_create` | write | owner | validated SKU, idempotency key |
| `stock_adjust` | high-impact write | owner | reason, before/after, confirmation, optimistic lock, audit |
| `price_approve` | high-impact write | owner | confirmation, version check |
| `sale_record` | high-impact write | owner | atomic stock deduction, idempotency, audit |

## Security gates before enabling MCP

- The MCP endpoint is **not implemented/enabled** in this phase. Do not expose it during the first-user bootstrap or before Cloudflare Access is configured.
- Provision separate Purkins service-account identities. Store tokens as hashes and revoke/rotate them. Require expiration, narrow tool scopes, request and daily write limits.
- Resolve effective permissions as: account role **and** scope allowlist **and** enabled risk category **and** per-tool switch.
- Deny all MCP writes by default. Launch read-only tools first only after testing authentication, media security and audit logging.
- Dispatch writes through the same validated application services as the admin, not through a second privileged raw-D1 path.
- Record request ID, actor identity, operation, outcome, timing and relevant resource IDs; never log tokens or personal secrets.
- Confirm all browser and MCP writes are authorized at the server and have idempotency and concurrency safeguards.
- Keep Purkins D1/R2/billing entirely isolated from SeeZambia.

## Testing and deployment policy

GitHub Actions remains manual-only. Local `pnpm check:local` and live deployment are opt-in. This page is additive: the existing inventory schema/migration is untouched.
