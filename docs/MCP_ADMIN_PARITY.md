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

Additional operator-only category reads: `list_purkins_categories` and `get_purkins_category`, with public-ID-only projections and focused source tests. Category mutations still require scoped write/auth/audit/retry guards and cache invalidation parity.

New on this branch: `list_purkins_locations`, `get_purkins_location` (operator-only reads), plus `create_purkins_location`, `move_purkins_location` (development-only writes). All reuse `src/features/purkins/locations.ts`. Location mutations register only when **both** `PURKINS_MCP_WRITES_ENABLED=true` and `PURKINS_MCP_LOCATION_WRITES_ENABLED=true`. These flags alone do not satisfy audit, scoped authorization, or safe retries; keep both disabled in production.

## Admin surface requiring parity review

| Surface verified in source tree | Work still needed |
| --- | --- |
| Products and stock intake | Complete variant, stock adjustment, media association, review, archive and batch operations; safeguard retries |
| Hierarchical locations | Read/create/move tools added in source; writes doubly gated and not production-ready; verify duplicate-name, cycle, audit, replay and concurrency protections |
| Categories | MCP list/get reads added; create/edit/delete validation extracted into shared category commands used by Admin. MCP mutations intentionally unregistered until cross-Worker storefront cache invalidation, audit and idempotency are implemented |
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

## Category parity refactor (24 October 2026)

`src/features/categories/commands.ts` now encapsulates category creation, editing, deletion, public-ID resolution, slug uniqueness and cycle checks. Existing Admin POST handlers invoke these shared commands, then their existing catalogue-cache purge. The shared commands themselves do not purge the cache. **Do not register MCP category mutations yet:** the independent Admin Worker must invalidate the *public storefront* cache reliably and record auditable, replay-safe operations. Existing MCP category list/detail tools remain read-only.

Check Admin error/redirect parity and TypeScript build locally. No local tests were run in this chat; commit is not production validated.

## Security and regression re-audit (24 October 2026)

Additional source review after the initial implementation identified and corrected:

1. **Operator authorization:** An Access-signed identity with any nonempty email previously qualified as operator. Now the independently verified Access identity must match `PURKINS_MCP_OWNER_EMAIL`; missing config denies. Legacy fixed `MCP_TOKEN` is a separate owner credential and requires its own key-management review.
2. **Token expiry:** Access JWT validation previously accepted signed tokens without an expiry claim. It now requires a finite, unexpired `exp`, and a missing/malformed-expiry regression test has been added.
3. **Admin write/result ambiguity:** The category POST refactor accidentally caught cache-purge failures as input errors, making a committed write appear to have failed. Expected validation errors use `CategoryValidationError`; DB/cache failures now propagate, preserving the original failure semantics.
4. **Hierarchy validation:** Invalid/missing parents and circular moves are again reported as validation errors to the Admin editor rather than generic server failures.
5. **Test coverage:** Replaced fake 32-character category IDs with actual 10-character Crockford public IDs and added positive lookup tests, negative ID tests, command cycle/parent validation, and infrastructure-failure tests.
6. **Untrusted image sources:** The imported URL validator blocked common internal/IP URLs but did not restrict arbitrary public-looking hostnames. The media importer now requires an exact hostname on `PURKINS_MCP_IMAGE_IMPORT_HOSTS`. Empty list denies all URL imports. Owner access and the existing draft-only/write flags are still required.

**Verification still outstanding:** no local checkout was available in the review environment and no GitHub Actions workflow had been run on this branch. All newly authored tests are committed but **not passed/verified**. Local tests/typechecks, built Worker route tests, signed-JWT/owner integration tests, media/R2 flow, cache invalidation across Workers, mutation audit/idempotency/concurrency and full Admin-to-MCP parity remain release blockers. Neither new category mutations nor live production MCP writes are activated.

### Safe verification commands (from an existing development checkout)

```powershell
npm run check
npx vitest run mcp/src/categories.test.ts mcp/src/operator-access.test.ts mcp/src/purkins-media.test.ts src/features/categories/commands.test.ts
npx vitest run src/features/auth/access.test.ts
npm run mcp:check
npm run build:workers
```

No migration, deployment or remote inventory mutation is part of these checks.

## Local TypeScript and test-discovery diagnostics (24 October 2026)

User executed `npm run check` on the draft branch: **417 files, 0 errors, 0 warnings, 2 hints**. Explicit `npx vitest run` was given 5 paths but executed only 2 root `src/` test files (14 passing tests): root `vitest.config.ts` excluded the MCP test folder. `npm run mcp:check` failed with **3 errors**: mismatched R2 bucket definitions between MCP and root `@cloudflare/workers-types` dependencies, and unresolved `Env.BUCKET` / `Env.FILES` while following the type-only storage barrel from `upload.ts`.

The follow-up code fix is intentionally **type-safe**, not `as any` or `@ts-ignore`:
- MCP media R2 binding is typed using `Parameters<typeof createR2Storage>[0]`, identical to the root storage adapter.
- `src/features/media/upload.ts` now imports its `StorageProvider` interface directly from `../storage/provider`; a type-only import must not pull in `../storage/index.ts` with storefront runtime env bindings.
- Root Vitest `include` now covers `mcp/src/**/*.test.ts`, so explicitly requested MCP test files can actually execute.

**Status:** code fixes committed but **not yet tested** after these changes. Root and MCP currently declare different versions of the Cloudflare types dependency; this remains dependency-alignment technical debt even though the shared adapter uses a single public type contract. Do not claim `mcp:check` passes until the user reruns it successfully.

Safe local verification after pulling the branch:
```powershell
npm run mcp:check
npx vitest run mcp/src/categories.test.ts mcp/src/operator-access.test.ts mcp/src/purkins-media.test.ts src/features/categories/commands.test.ts src/features/auth/access.test.ts
npm run check
```
