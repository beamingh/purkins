# Purkins source integration and release status

**Updated: 23 October 2026.** The selected implementation is **Minshop on Astro,
Cloudflare Workers, D1 and R2**. Payload CMS / Next.js is discontinued.

**PR [#2](https://github.com/beamingh/purkins/pull/2) merged into `main`**
at commit `22474c9e47a40f4e9244bfa673daec7c61354688`.
**Source integration is complete; production rollout is not approved.**
No remote migrations, deployments, live stock publication or inventory imports
were performed as part of the merge.

## Branch register

| Branch | Current status | Policy |
| --- | --- | --- |
| `main` | **ACTIVE / INTEGRATED SOURCE** | Only active development base going forward; not a production-approved release |
| `feat/purkins-stock-cataloguing` | **MERGED / HISTORICAL** | PR #2 was merged into `main`; do not maintain or merge it again |
| `feat/purkins-inventory` | **SUPERSEDED / HISTORICAL** | Ancestor already included in merged work; do not merge separately |
| `feat/minshop-foundation` | **SUPERSEDED / HISTORICAL** | Ancestor already included in merged work; do not merge separately |
| `feat/payload-foundation` | **DISCONTINUED / HISTORICAL** | Abandoned Next.js/Payload implementation; PR #1 closed unmerged; never deploy or merge |

Branch pointers remain intact as references. Do not cherry-pick obsolete
implementations back into `main`. New work should branch from `main`.

## Source integration verification

- [x] Local `npm test` after dependency upgrade and test-fixture cleanup:
  **87 files / 954 tests passed**, including stock workflow D1 integration tests
- [x] Local `npm run check`: **0 errors, 0 warnings**, two unused-variable hints
- [x] Local `npm run build`: Astro Worker build completed
- [x] Local `npm run theme:check`: storefront boundary OK
- [x] Local `npm run mcp:check` after dependency upgrade: TypeScript and
  Wrangler **4.152.0 dry run** passed, **no deployment**, write flag `false`
- [x] Local `npm audit --omit=dev` and `npm audit --prefix mcp --omit=dev`:
  **0 reported production vulnerabilities** after dependency updates
- [x] Dependency manifests and lockfiles committed and pushed as `2f6c2ca`
- [x] Checked GitHub workflow `.github/workflows/checks.yml` is
  **manual `workflow_dispatch` only**, with no deployment steps
- [x] PR #2 merged into `main` (no production-side effects)

These are recorded *local test results*, not a claim of complete production
acceptance. The manual GitHub Actions workflow has not been reported as run.

## Release blockers / next operational work

- [ ] Apply migrations `0040_purkins_intake.sql` and
  `0041_purkins_cataloguing.sql` to an **isolated local D1 database**,
  validating both clean setup and upgrade scenarios; don't touch remote D1
- [ ] Smoke-test actual Admin workflow and UI: photo-first intake,
  unique item and variant identity, sizes/colours, supplier barcodes, original
  retail tags, package counts, incomplete garments, private storage locations,
  suggested pricing and explicit owner publication approval
- [ ] Test private MCP operator authentication/denial, redaction of purchase
  cost and internal location, generic tool bypass prevention, approval revocation
  and draft-only creation against a disposable local D1 fixture
- [ ] Implement and verify narrowly scoped MCP write authorization, audit logs,
  idempotency, retry safety and concurrent stock-edit controls
- [ ] Validate local payment methods, shipping/pickup, image delivery, inventory
  reservations, order email and the actual checkout journey
- [ ] Review production Cloudflare resource binding, credentials, domain and
  release plan. Only deploy or run remote migrations with separate approval

**MCP write tools must stay disabled:** the tracked template defaults to
`PURKINS_MCP_WRITES_ENABLED=false`. Do not enable until the write-security
items above are proved.

## Architectural boundary

The abandoned Payload branch is reference history, not an alternative
implementation or a feature backlog to port. Do not reuse any Payload-era
or SeeZambia Cloudflare database/bucket/resources for Purkins without explicit
resource review and approval.
