# Purkins — source integration and live release register

**Updated:** 26 October 2026. **Active base:** `main`.

**Architecture:** Astro/Minshop storefront, Cloudflare public and protected Admin+MCP Workers, a single permanent D1 database, R2 media. Payload CMS/Next.js branch is discontinued.

## Source status — verified against GitHub

As of the audit on 26 October 2026, **there are no open Purkins pull requests** after PR #36 was merged. There are many old source branches; an `ahead_by` count on a branch that was **squash-merged** does not mean its changes are missing from `main`. Compare PR integration history, current content and behavior before reviving a branch.

| Workstream | Integration result |
| --- | --- |
| Minshop + Purkins inventory | PR #2 merged; `feat/minshop-foundation` and `feat/purkins-inventory` are superseded ancestors |
| Hierarchical locations, stock intake, manual sales, split Cloudflare Workers | PRs #3–10 merged |
| Full operator MCP media/tools (former PR #11) | PR #11 closed unmerged, **explicitly superseded by merged PR #12**; PR #12 included its full commit history |
| MCP guarded writes, draft intake, media, permissions, connections and token auth | PRs #12–25 merged (excluding obsolete PR #11) |
| Private preview, variant reconciliation and guarded publication | PRs #29–31 closed unmerged and **integrated together through merged PR #32** |
| Guided five-step editor including copy/paste and drag/drop images | PR #33 merged |
| Gallery save-feedback fixes | PR #34 merged |
| Optional genuine compare-at prices | PR #35 merged into `main`; **live rollout remains pending** |
| Complete storefront/backend retail blueprint | PR #36 merged; see [PURKINS_RETAIL_BLUEPRINT.md](PURKINS_RETAIL_BLUEPRINT.md) |
| Payload CMS foundation | PR #1 deliberately closed **without merge**; archive only, never merge or deploy |

**Old branches:** Most are behind main or contain equivalent work via previous squash merges. No remaining open PR was found that needs merging. Do **not** merge all old branches merely because they have commits ahead. Reopen work from a fresh branch off current `main` if a **specific missing feature** is demonstrated.

**Scope limit:** This GitHub audit does not inspect uncommitted files or unpushed commits in the Windows checkout. Those are not reflected in GitHub branch/PR lists.

## Actual remaining release work

1. **Compare-at prices not yet deployed.** Production D1 `d1_migrations` includes `0052_purkins_mcp_publication.sql` but not migration `0053_purkins_compare_at_price.sql`; the live `products` table has no `compare_at_price_cents` column yet. Source was merged as PR #35. Apply `0053` through the permanent guarded migration command, deploy both Workers from current `main`, then enter historical K1,100 and current K950 for TY-899 if verified. A normal Purkins product-form save may unpublish an approved listing until it is re-approved: check owner approval and public cache before declaring complete.
2. **Media optimization and gallery.** Verify live network bytes: R2 originals are cached, but responsive width candidates require explicit image-delivery configuration and eligible image base URL. Define transforms, thumbnails, object-contain hero and zoom/multi-image behavior.
3. **Real trading readiness.** Existing checkout reports demo-only; confirm supported Zambian real-payment and reconciliation path, actual pickup/delivery coverage and rate calculation, and test the complete paid-to-fulfilled order process.
4. **Storefront content and IA.** The live D1 audit found no content pages and no header/footer menu entries. Publish factual support, delivery, returns, privacy and terms pages; then build menus, branded homepage, stronger product details, search and category filtering.
5. **Solo operator workflow.** Inventory draft intake and category/media tools are present; finish admin action queues, product template coverage and the direct-image-transfer MCP path with audited permissions.
6. **End-to-end verification.** Run mobile buyer and owner workflows with realistic photos and stock, check cache invalidation, checkout errors, notification and refund handling.

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
