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

## Verified local validation — 24 October 2026

User supplied a complete Windows terminal transcript on the initial guarded-write
implementation: `npm run check` passed with **419 files and 0 errors**;
four targeted test files passed **25/25 tests**; `npm run mcp:check` passed
TypeScript and Wrangler dry run; the full `npm test` suite passed
**102 files / 1,060 tests**; `npm run build:workers` built both isolated
Workers. No production Cloudflare resources were modified.

A subsequent release-safety fix adds a strict local migration checkpoint to
`scripts/purkins-permanent.mjs`: the old state value
`migrationsApplied=true` is insufficient when new migration files exist.
The confirmed `migrate` command must record `migratedThrough` for the
current latest SQL script, and both `deploy` and `mcp-writes-on`
refuse outdated records. **The new checkpoint change has not yet been
executed by the user**, so rerun the full suite before merging.

## Deployment order and limitations

1. Run `npm test`, `npm run check`, `npm run mcp:check`,
   `npm run build:workers` on the branch. Review the isolated D1 integration
   test result rather than accepting compilation alone.
2. Verify migration 0045 in isolated D1, then explicitly plan the separately
   authorized permanent remote migration **before** deploying any Worker
   that reads `mcp_version`. Otherwise private location inspection fails.
3. After a confirmed permanent migration, ensure its private state records
   `migratedThrough: "0045_purkins_mcp_write_guard.sql"`. Both deployment
   and write activation fail closed when the checkpoint is absent or old;
   the older `migrationsApplied` boolean alone no longer suffices.
4. After a separately approved release, test live owner identity and
   read-only MCP tools first. Keep all write flags false.
5. Enable only audited location writes during a controlled acceptance session
   after reviewing authorization, retry, concurrency, and rollback results.
   Never enable the legacy write scope as a shortcut.

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
