# Purkins — source integration and live release register

**Updated:** 26 October 2026. **Active base:** `main`.

**Architecture:** Astro/Minshop storefront, Cloudflare public and protected Admin+MCP Workers, a single permanent D1 database, R2 media. Payload CMS/Next.js branch is discontinued.

## Source status — verified against GitHub

At the 26 October integration audit, no open PRs remained after PR #37. The next backend cache-coherence fix is PR #38 (open pending tests). There are many old source branches; an `ahead_by` count on a branch that was **squash-merged** does not mean its changes are missing from `main`. Compare PR integration history, current content and behavior before reviving a branch.

| Workstream | Integration result |
| --- | --- |
| Minshop + Purkins inventory | PR #2 merged; `feat/minshop-foundation` and `feat/purkins-inventory` are superseded ancestors |
| Hierarchical locations, stock intake, manual sales, split Cloudflare Workers | PRs #3–10 merged |
| Full operator MCP media/tools (former PR #11) | PR #11 closed unmerged, **explicitly superseded by merged PR #12**; PR #12 included its full commit history |
| MCP guarded writes, draft intake, media, permissions, connections and token auth | PRs #12–25 merged (excluding obsolete PR #11) |
| Private preview, variant reconciliation and guarded publication | PRs #29–31 closed unmerged and **integrated together through merged PR #32** |
| Guided five-step editor including copy/paste and drag/drop images | PR #33 merged |
| Gallery save-feedback fixes | PR #34 merged |
| Optional genuine compare-at prices | PR #35 merged into `main`; **live migration 0053 and Worker deployment complete** |
| Complete storefront/backend retail blueprint | PR #36 merged; see [PURKINS_RETAIL_BLUEPRINT.md](PURKINS_RETAIL_BLUEPRINT.md) |
| Payload CMS foundation | PR #1 deliberately closed **without merge**; archive only, never merge or deploy |

**Old branches:** Most are behind main or contain equivalent work via previous squash merges. No remaining open PR was found that needs merging. Do **not** merge all old branches merely because they have commits ahead. Reopen work from a fresh branch off current `main` if a **specific missing feature** is demonstrated.

**Scope limit:** This GitHub audit does not inspect uncommitted files or unpushed commits in the Windows checkout. Those are not reflected in GitHub branch/PR lists.

## Actual remaining release work

1. **Compare-at pricing released (verified 26 October).** Production D1 has migration `0053_purkins_compare_at_price.sql`; the new Admin+public Workers are deployed, and the TY-899 has a genuine optional compare-at value of K1,100 with the actual K950 checkout price, approved state and four units preserved. Both public detail and catalog APIs were checked. **Remaining backend issue:** general Admin product edits still revoke publication; see issue #39.
2. **Media optimization and gallery.** Verify live network bytes: R2 originals are cached, but responsive width candidates require explicit image-delivery configuration and eligible image base URL. Define transforms, thumbnails, object-contain hero and zoom/multi-image behavior.
3. **Real trading readiness.** Existing checkout reports demo-only; confirm supported Zambian real-payment and reconciliation path, actual pickup/delivery coverage and rate calculation, and test the complete paid-to-fulfilled order process.
4. **Storefront content and IA.** The live D1 audit found no content pages and no header/footer menu entries. Publish factual support, delivery, returns, privacy and terms pages; then build menus, branded homepage, stronger product details, search and category filtering.
5. **Cross-Worker cache coherence.** Admin routes previously purged the separate Admin Worker's cache instead of the public Worker's content. PR #38 implements authenticated cross-Worker invalidation for content, product, image, shipping, settings and manual-sales mutations. Test and deploy before relying on instant buyer-facing updates.\n6. **Solo operator workflow.** Inventory draft intake and category/media tools are present; finish admin action queues, product template coverage and the direct-image-transfer MCP path with audited permissions.
7. **End-to-end verification.** Run mobile buyer and owner workflows with realistic photos and stock, check cache invalidation, checkout errors, notification and refund handling.

**Master reference:** [PURKINS_RETAIL_BLUEPRINT.md](PURKINS_RETAIL_BLUEPRINT.md) defines structure, design principles, phased roadmap, acceptance criteria and the first 12 implementation tickets.

## Recent local and live verification

- PR #33 Windows focused tests: 10/10; Astro check: 0 errors; two isolated Workers built successfully.
- PR #34 Windows focused tests: 6/6; Astro check: 0 errors; two isolated Workers built successfully.
- PR #35 user reported local checks green; no terminal output was supplied in the PR's latest status note.
- Live TY-899 is publicly visible via catalog API with real product image, K950 price and approved stock record. Do not confuse a product's published status with verified payment collection or fulfillment.
- Storefront `PRELAUNCH_NOINDEX=true` at previous live inspection; removing noindex is a later deliberate release decision.
- This document is a Git source/rollout register; it does not mean a commit or merge itself deploys the Workers or D1 migrations.

## Integration policy

Develop future features on fresh branches from current `main`, with a single PR per coherent feature and traceable acceptance tests. Merge only when source changes are reviewed and locally validated; reconcile D1 migrations and Cloudflare deploy separately. Do not resurrect the discontinued Payload architecture or cherry-pick long-superseded branches.
