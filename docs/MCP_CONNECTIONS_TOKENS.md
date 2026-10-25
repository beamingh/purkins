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
flags were changed by PR #18. Source files and new tests need the user's
local green run before review/merge.

## Granular tool permissions (PR #20)

After migration `0050_purkins_mcp_tool_permissions.sql`, connections are no
longer constrained to read-only. The owner creation form offers:

- **Safe default** (selected on first load): all known read tools and no
  mutating tools.
- **Full permissions** checkbox: checks the entire current tool catalog;
  deselecting any individual tool automatically clears the Full checkbox.
- **Individual grants**: toggle one tool at a time, including stock, location,
  clothing intake, guarded gallery, checkout, publication and legacy editing.
  The server validates each exact name. Unknown/duplicate grants fail closed.
- **Restore safe default** button.
- **Replace with different permissions** beside existing connections:
  prefills the new-token form with that token's exact grants. Issue the
  replacement token and revoke the old token once the new client is working.

Grant lists are **immutable for the life of each token**. To drop or add
permissions later, issue a replacement and revoke the original; existing
Durable Object MCP sessions must not retain access to removed tools. Every
request still verifies token revocation and expiry in D1. New tokens remain
256-bit random secrets hashed in D1 and displayed only once.

Migration 0050 adds nullable `tool_permissions_json` without recreating or
clearing any live credential or audit tables. Existing tokens have NULL grants
and continue using the safe read-only preset. The original `scope=read_only`
column is retained strictly for backwards compatibility: effective permissions
come ONLY from the validated allowlist. Never interpret that legacy column as
authority to grant writes.

### Full does not bypass the Worker kill switches

The selected tools constrain each client, **on top of** the existing global
and individually scoped Worker write flags, idempotency, draft/revision rules
and explicit publish confirmation. The protected public `create_checkout`
tool is additionally gated by the global write flag for these owner-issued
tokens; preexisting public-buyer behavior is unchanged.

In particular, the following must be enabled individually before they work:

- `PURKINS_MCP_WRITES_ENABLED=true` (global kill switch)
- `PURKINS_MCP_STOCK_WRITES_ENABLED=true` (guarded drafts and stock)
- `PURKINS_MCP_CLOTHING_WRITES_ENABLED=true` (bulk clothing; also requires stock)
- `PURKINS_MCP_LOCATION_WRITES_ENABLED=true` (locations)
- `PURKINS_MCP_GALLERY_WRITES_ENABLED=true` (guarded photo operations)

Old product/media/order tools also require
`PURKINS_MCP_LEGACY_WRITES_ENABLED=true`. They are still NOT recommended
because some do not have receipt-based replay protection. Checking Full does
not change Worker configuration and never flips this legacy switch.

### Local validation and release order

```powershell
git fetch origin
git switch --track origin/feat/purkins-mcp-granular-permissions
npm run check
npm run mcp:check
npx vitest run src/features/mcp/clientTokens.integration.test.ts mcp/src/tool-filter.test.ts src/features/mcp/clientScope.test.ts
npm test
npm run purkins:cloudflare -- build
```

After all checks pass and PR #20 is merged, apply the guarded permanent D1
migration **0050** before deploying the existing Workers. Do not create or
reset any infrastructure. Confirm owner credentials remain present, global
write flag remains false during the first read-only and token-grant acceptance
tests, and both public/Admin routes still work. Activate scoped guarded
writes deliberately only after owner authentication and end-to-end tests.

Bearer-token credentials are not OAuth. ChatGPT remote MCP authentication
still requires its own Cloudflare Access Managed OAuth setup if the ChatGPT
connection requires OAuth.

## Combined URL token authentication (PR #22)

Purkins supports the Ulwimbo-style MCP connection URL approach without
requiring OAuth discovery. Admin -> MCP Connections now reveals TWO one-time
secrets after issuance: the raw `pmcp_` credential and the combined URL:

```text
https://admin.purkins.ulwimbo.com/mcp?token=pmcp_<one-time-value>
```

The Ulwimbo-compatible alias `?mcp_token=` also works. A URL token is **only**
a hashed, expiring/revocable `pmcp_` client credential, and has exactly the
immutable tool grants chosen in the Admin UI (safe read default, Full, or any
individual selection). Existing `Authorization: Bearer pmcp_...` works
unchanged. The legacy `MCP_TOKEN` Worker secret is deliberately not accepted
in query parameters.

When present, URL authentication is validated by the existing D1 lookup on
**every** request, including SSE GET and MCP POST. Duplicate/conflicting URL
parameters, malformed tokens, and a URL token combined with an Authorization
header are rejected (401). Expiry/revocation applies to an already initialized
MCP session on the next request. The MCP transport receives a reconstructed
request with the token removed from its URL and no-store/no-referrer response
headers; no query token is logged by application code.

### IMPORTANT: existing Cloudflare Access Worker-level protection

The current Purkins Access application `Purkins Admin - Owner Only` protects
the **entire** `purkins-admin` Worker via a Worker destination. Cloudflare
Access may reject non-browser ChatGPT MCP requests before the new URL token
can reach our app. A combined URL by itself does NOT bypass Access.

Before end-to-end token-only testing, **separately** arrange Access protection
that matches only Admin paths (at minimum `/admin`, `/admin/*`,
`/api/admin`, `/api/admin/*`) on the Admin hostname, while letting exactly
`/mcp` and `/mcp/*` reach the Worker for its own token validation. Cloudflare
supports hostname/path scoped Access applications. Do not delete or relax the
existing Worker-level policy until replacement Access protection has been
configured and independently tested; avoid any unprotected Admin transition.
If changing the Access application's audience, update `CF_ACCESS_AUD` before
testing the owner-managed connections page: its JWT verification is
independent. Worker custom domain is intentionally the only reachable
hostname (`workers_dev=false`, previews disabled). Keep the MCP handler's
operator-only, fail-closed gate on every request.

Do NOT configure a broad Allow/Bypass policy on the whole Admin Worker and do
not assume having a URL token implies owner Cloudflare Access authentication.

### URL-token security trade-off

Treat the **complete URL as a password**. A query token can be recorded by
the connecting client, proxies/CDNs, request analytics, log systems, browser
history and shared screenshots **before the request reaches our Worker**.
Removing the query from downstream transport and setting no-store/no-referrer
limits accidental further exposure but cannot prevent the edge or client from
seeing it. Prefer a short-lived, narrowly scoped token; revoke immediately
after any accidental exposure. Do not paste a real combined URL in an issue,
chat, browser or shared logs.

### Validate the PR

```powershell
git fetch origin
git switch --track origin/feat/purkins-mcp-url-token-auth
npx vitest run src/features/mcp/urlToken.test.ts src/features/mcp/clientTokens.integration.test.ts
npm run check
npm run mcp:check
npm test
npm run purkins:cloudflare -- build
```

After green acceptance, merge and deploy through the existing two-Worker
permanent guard. **No D1 migration, Access modification, secret or write
toggle is executed by this PR.** URL-auth HTTP 200/tool registration cannot
be proven end to end while existing Worker-level Access is still in place.
