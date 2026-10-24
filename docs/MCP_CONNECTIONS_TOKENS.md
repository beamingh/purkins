# Purkins MCP Connections & Tokens (PR #18)

## Why this exists

SeeZambia has an accountable MCP service-account panel at
`/admin/security`; Ulwimbo has token issuance, expiry and revocation under
`MCP → Connections & Tokens`. Purkins previously had only one Worker-level
`MCP_TOKEN` and optionally a Cloudflare Access owner identity, with no
Admin UI for issuing client-specific credentials.

This change adds **Admin → MCP connections** at `/admin/mcp`.

## What ships

- Owner-only page: issue named tokens with 30/90/180/365-day expiry; reveal
  each bearer token **once**, copy it, list only metadata, see usage and revoke
  it, review create/revoke audit history.
- A database token ledger with per-credential SHA-256 hashes of 256-bit
  cryptographically random secrets, unique create request IDs, expiry,
  revoked timestamp, usage count and a fenced one-time revoke audit marker.
- The MCP Worker checks token validity **on every HTTP request**; expiry or
  revocation rejects the request before it can reach an existing MCP session.
- New token sessions have `readOnly=true`, excluding buyer
  `create_checkout` and **every** operator write tool, even if global/scoped
  MCP write flags are later enabled. Legacy owner bearer/Access paths retain
  their separately guarded rules unchanged.
- Owner must present an actual Cloudflare Access JWT with valid signature,
  issuer, audience, expiry and email exactly matching
  `PURKINS_MCP_OWNER_EMAIL`. Neither an unsigned header, an Admin password
  session alone, nor an arbitrary valid Access account can issue tokens.
- No raw token appears in D1, audit logs, URLs or MCP result fields.
  Never put one in a GET query parameter: browser history, analytics and
  reverse-proxy access logs can expose it.

## The page and first use

1. **Before deployment**, run the local tests and merge this PR.
2. The live permanent D1 is currently at migration **0048**; migration
   `0049_purkins_mcp_connections.sql` must be reviewed and applied using the
   permanent Purkins D1 migration gate **before** deploying these Workers.
3. Set `PURKINS_MCP_OWNER_EMAIL` securely on `purkins-admin` to the exact
   owner email used by the *existing* Cloudflare Access application. It is
   intentionally **not committed** to the repository. Confirm both
   `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` remain configured.
4. Deploy using the existing confirmed permanent two-Worker workflow.
   Don't create new databases, routes, R2 buckets or Worker scripts.
5. Sign into the existing Admin Access application and visit:
   `https://admin.purkins.ulwimbo.com/admin/mcp`.
6. Generate one read-only test credential, verify `tools/list` against the
   protected remote MCP, confirm no `create_checkout`/write tools, revoke the
   credential and confirm the **next request** gets 401. Confirm owner password
   alone, wrong owner, missing owner email setting and revoked token all deny.
7. Keep all `PURKINS_MCP_*WRITES_ENABLED` flags false during acceptance.

## Important limitation: client bearer != OAuth

**These are plain bearer credentials for clients capable of sending an
`Authorization: Bearer pmcp_…` header.** They do not by themselves create
an OAuth authorization server or bypass an Access policy on the custom domain.
Some remote MCP connectors, including ChatGPT's custom connectors, require
OAuth. Configure/test **Cloudflare Access Managed OAuth separately** for
those clients. Do not expose the Admin Worker or weaken the owner-only Access
policy to make a token URL work.

A valid owner Access login can still use the existing Access JWT auth route.
A fixed legacy `MCP_TOKEN` remains available for approved legacy clients but
is not managed or revealed by the new page.

## Validation

```powershell
git fetch origin
git switch --track origin/feat/purkins-mcp-connections-tokens
npm run check
npx vitest run src/features/mcp/clientTokens.integration.test.ts src/features/mcp/clientScope.test.ts src/features/mcp/ownerGate.test.ts
npm run mcp:check
npm test
npm run build:workers
```

No production data, remote Cloudflare routes, secrets, migrations, or write
flags are changed by this PR. Source files and new tests need the user's
local green run before review/merge.
