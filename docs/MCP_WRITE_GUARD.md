# Purkins owner MCP writes — guarded location pilot

Status: draft, source-only implementation. Branch: `feat/purkins-mcp-write-guard`.
This milestone does **not** authorize deployment, production D1 migrations, or turning on live MCP mutations.

## Why start with locations?

Manual sales already call `recordManualSale`: it uses a client request key
(`manual:<UUIDv4>`), conditional paid-order insertion and stock decrements in
an atomic D1 batch. Reimplementing that accounting in MCP would create a
second, potentially inconsistent sales path. Existing MCP product, stock,
media and order writers still lack a unified replay/audit guard.

Locations are private and lower risk. Their write service now illustrates the
reusable pattern for later stock, sales and catalog mutations.

## What is implemented

- Migration `0045_purkins_mcp_write_guard.sql` creates
  `purkins_mcp_mutations` and adds `mcp_version` and `last_mcp_request`
  to `purkins_locations`. The mutation ledger records a stable request ID,
  verified actor label, operation, SHA-256 of normalized input, internal nonce,
  target and outcome. It stores no bearer tokens, signed JWTs, customer details,
  or raw payloads.
- `createGuardedLocation` uses an atomic D1 batch: insert a unique receipt;
  insert the location *only* when the receipt's nonce belongs to this attempt;
  set the durable receipt outcome based on the written row. Retry with the same
  UUIDv4 + payload + actor returns the prior result without a second insert.
  A reused UUID with different actor/payload/action is rejected.
- `moveGuardedLocation` requires the previously-read parent and
  `mcp_version`, then updates only if **both** still match. The same batch
  fences the writer by request nonce and records the outcome. Stale revisions
  are refused; sibling uniqueness and cycle prevention remain enforced by
  existing SQLite indexes/triggers.
- The existing Admin `moveLocation` increments `mcp_version` too, so a
  pending MCP change cannot silently overwrite an Admin move.
- Owner authentication is still checked before private tool registration.
  Owner actor identity is derived from a verified Cloudflare Access email or
  the separately provisioned owner bearer credential; a caller cannot supply
  `actor` via MCP tool arguments.
- A global write switch no longer activates older unsafe mutators alone.
  `PURKINS_MCP_LEGACY_WRITES_ENABLED` must also be explicitly enabled for
  old product, stock, media, order writers. **Leave this false in production.**
  Guarded location writes require the global switch, the separate
  `PURKINS_MCP_LOCATION_WRITES_ENABLED` switch, and verified actor context.
  All three flags default to false.
- Real D1 integration tests cover create/replay, mismatched payload/actor,
  compare-and-swap moves, Admin/multi-writer staleness, ancestry cycles,
  sibling constraints and receipt rollback. Tool-registration tests cover
  access gates.

## Deployment order and limitations

1. Run `npm test`, `npm run check`, `npm run mcp:check`,
   `npm run build:workers` on the new branch. Do **not** merge merely because
   compilation succeeds; inspect the new D1 integration test result.
2. Verify the migration on isolated local D1, and explicitly plan remote
   migration **before** any Worker release containing the new location queries.
   The new read helpers select `mcp_version`: deploying them before migration
   would break private location inspection.
3. After a separately approved release, establish the live owner identity flow
   and exercise read-only MCP tooling first. Keep all write flags false.
4. Enable only guarded, audited location writes under a controlled acceptance
   session once authorization, retries, concurrent writes and operational
   rollback are checked live. Never enable legacy write scope as a shortcut.

This is the **first guarded write slice**, not complete Admin↔MCP parity.
Category writes remain unregistered until cross-Worker catalog-cache
invalidation is durable. Stock draft changes, price changes, media, approvals,
refunds, order fulfillment and sales need explicit scoped controls, auditable
D1 transactions and safe retry behavior before general MCP write activation.
The write receipt does not itself guarantee an independent human confirmation;
sensitive operations must receive a separate approval gate.

## Safe developer checks

```powershell
git switch feat/purkins-mcp-write-guard
npm run check
npx vitest run src/features/mcp/writeGuard.integration.test.ts mcp/src/locations.test.ts src/features/purkins/workflow.integration.test.ts src/features/purkins/location-migration.integration.test.ts
npm run mcp:check
npm test
npm run build:workers
```

The new tests and build are local-only; none of these commands migrates remote
D1, deploys Workers or enables MCP mutations.
