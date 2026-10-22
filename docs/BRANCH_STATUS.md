# Purkins branch status and integration policy

**Updated: 23 October 2026.** Purkins' chosen implementation is **Minshop on Astro,
Cloudflare Workers, D1 and R2**. **Payload CMS and Next.js are discontinued.**
The GitHub `main` branch is the intended integration source of truth, **not yet**
the operational storefront. Current development is on
`feat/purkins-stock-cataloguing`.

| Branch | Status | Direction |
| --- | --- | --- |
| `main` | INTEGRATION TARGET | Currently a minimal repository baseline; accept reviewed, tested Minshop changes via PR |
| `feat/purkins-stock-cataloguing` | ACTIVE / REVIEW REQUIRED | Contains Minshop foundation + private stock intake + barcode, sizes and MCP changes; candidate for integration into `main` |
| `feat/purkins-inventory` | SUPERSEDED (ancestor) | Its commits are included in the active branch; do not develop or merge separately |
| `feat/minshop-foundation` | SUPERSEDED (ancestor) | Its commits are included in the active branch; do not develop or merge separately |
| `feat/payload-foundation` | DISCONTINUED / HISTORICAL | Separate Next.js/Payload implementation; do not merge, deploy or continue development; PR #1 closed unmerged |

**Do not delete history or blindly merge old branches.** Old branch pointers are
retained until the active branch has been reviewed, validated, and integrated.
Status-only documentation commits on superseded branches must not be used as a
reason to cherry-pick old implementation files into the active branch.

## What must happen before the active code is merged

- [x] Local developer reported `npm test`: 87 files, 954 tests passed on the earlier `0c1851b` checkout; subsequent tooling changes need validation.
- [x] Local developer reported `npm run check`: zero errors, zero warnings (two harmless hints).
- [x] Local developer reported `npm run build`: Astro production build succeeded.
- [x] Local developer reported `npm run theme:check`: `storefront boundary: ok`.
- [x] Local developer reported `npm run mcp:check`: TypeScript passed and Wrangler 4.118.0 dry run succeeded (2,775.19 KiB upload / 517.89 KiB gzip), with `PURKINS_MCP_WRITES_ENABLED=false`; no Worker deployed.
- [ ] Clear or explicitly assess **high/critical production dependency advisories** for the storefront and MCP. Local storefront `npm audit --omit=dev`: **14 findings (13 high, 1 critical)**. Local MCP `npm audit --prefix mcp --omit=dev`: **9 findings (3 moderate, 5 high, 1 critical)**. The manual-only GitHub checks now fail on high/critical findings. Prefer `npm audit fix --package-lock-only` within existing semver ranges, then reinstall, re-audit and retest; do not blindly use `--force` or merge unreviewed major upgrades.
- [ ] Apply migrations 0040 and 0041 to **isolated local D1** and confirm clean and upgrade paths, not remote D1.
- [ ] Verify stock workflow through Admin, including sizes, per-size barcodes, draft state, incomplete stock, and accurate pack counts.
- [ ] Exercise private operator MCP tools against a local test DB, including auth denial, cost privacy, data validation, repeated/concurrent writes, and approval revocation.
- [ ] Review the generic Minshop MCP tools for any bypass of Purkins publication/costing rules.
- [ ] Confirm MCP authentication, narrowly scoped operator rights, audit logging, idempotency, and race safety for high-impact stock writes. **Do not deploy MCP writes while these gates remain incomplete.**
- [ ] Explicitly confirm all GitHub Actions workflows remain manual-only; no CI step performs production deployment.
- [ ] Review requested changes and merge through the feature PR when validation is complete.

## Project boundary

The retired Payload branch is **not** an alternate implementation to merge or
a backlog of features to port. Future Purkins functionality belongs in the chosen
Minshop architecture. Never reuse any Payload-era D1/R2 or SeeZambia resources
without a separate inventory and explicit approval.

This registry is a coordination aid. It does not itself run tests, migrate D1,
publish inventory, deploy workers, or authorize a merge.
