# Purkins Rules & Standards

Purkins stores business rules in its own Cloudflare D1 database. ChatGPT memory and the GitHub repository are **not** sources of truth for the live wording of a rule. The Admin dashboard and owner-authorised MCP tools use the same records.

## Default and custom categories

Migration `0065_purkins_rules_and_standards.sql` creates **16 built-in categories** grouped by business area:

| Area | Built-in categories |
| --- | --- |
| Creative & Branding | Product Photography, Brand Identity |
| Product Management | Product Naming, Product Descriptions, Product Listings |
| Pricing & Sales | Pricing Guidelines, Discount Guidelines |
| Inventory & Operations | Inventory Intake, Restocking |
| Marketing | Social Posts, Promotions |
| Customer Experience | Customer Service, Returns & Exchanges |
| Fulfilment | Pickup & Delivery, Packaging |
| Technology & Automation | AI & Automation |

The owner can add any number of custom categories under any named section, and edit a category's display name, section, description or active state. Both built-in and custom category changes are revisioned; editing or deactivation can be performed entirely through authenticated MCP and restored without an Admin visit. A category's stable slug is immutable, so connected rules are not orphaned when renamed. Built-ins are normal editable categories, distinguished only by a `builtin` marker. Newly created categories become available to both Admin and MCP without a code change or database migration.

## Rule documents

One category can contain many rules, each identified by a `rule_slug` such as `product-photography`, `approved-facebook-cta` or `minimum-pickup-requirements`.

A rule contains:
- Title and **type**: guidance, policy or procedure. The type is descriptive, not a claim of automatic software enforcement.
- Instructions, applicability criteria, steps and tags.
- Simple typed key/value fields for structured guidance, such as `discount_threshold_percent: 10`.
- Optional photography-specific settings, including aspect ratio, resolution, background, composition rules, and required shots.
- Up to 12 approved references from the existing R2-backed `med_` Media Library.
- Active state, owner/editor identity, immutable revision history and restore-as-new-revision support.

Rule *scope* is independent of the business category: global → selected preset → product category → product. Structured values and fields override earlier levels; instructions, steps and required shots combine so global safeguards remain present. Referenced photos combine without duplicates.

The system seeds one `photography / product-photography` rule at global scope, with 4:5 portrait, 1080 × 1350 px, White Studio guidance, and four editable presets: Studio Product, Feature Composite, Purkins Kitchen and Lifestyle. These are ordinary rules and can be modified in Admin.

## Admin

Go to **Admin → Rules & Standards**, route `/admin/rules`. On the left, choose a default or custom category, create a category or edit its display details. On the right, pick an existing rule slug or type a new one. Choose global, preset, product-category or product scope. Save a rule, inspect its effective result, and restore earlier versions through the history panel.

Media Library deletion checks the general `purkins_rules` reference table. A file still approved for a rule cannot be removed until that reference is detached. Existing product/page/logo references remain protected as before.

## MCP (owner-only)

Read tools are individually grantable with read-only owner tokens:

- `list_purkins_rule_categories`
- `get_purkins_rule_category`
- `get_purkins_rule_category_history`
- `list_purkins_rules`
- `get_purkins_rule`
- `get_purkins_rule_history`
- `get_purkins_effective_rule`
- `get_purkins_effective_rules`

The effective-rule endpoint returns rule provenance, the exact instructions and approved reference URLs, plus an assistant-ready brief. These reads are private. They are not registered for anonymous storefront/buyer sessions.

Write tools:
- `update_guarded_purkins_rule`: create, edit, activate or deactivate a rule
- `restore_guarded_purkins_rule`: restore a previous rule revision, preserving history
- `create_guarded_purkins_rule_category`: create a custom category
- `update_guarded_purkins_rule_category`: rename/reclassify or activate/deactivate any category
- `restore_guarded_purkins_rule_category`: restore an earlier category revision

**MCP-first parity:** All routine Rules & Standards management offered through Admin can also be done through MCP. The Admin dashboard is optional for daily rule/category operations. A connected, authenticated owner with the appropriate granted tools and enabled write gates can create categories, maintain rules, change scopes, manage approved reference IDs, inspect resolved guidance, and restore revisions solely through an MCP client.

**Permission boundaries:** Read-only credentials remain read-only. Existing owner-issued tokens with frozen permission lists do not silently gain newly added tools. Reissue/re-authorise a token to grant them; the dedicated rule-write flag and the global write gate must also be enabled. This is a security requirement, not an Admin-only requirement.

These require an authenticated owner actor, a token explicitly granted that individual tool, global MCP writes enabled, and the separate `PURKINS_MCP_RULE_WRITES_ENABLED=true` switch. Rule writes also require a fresh UUID and the expected revision to prevent stale overwrites and handle retries. The separate switch is **off** in the fresh Wrangler template. Existing installations only enable it through their owner-confirmed MCP write configuration process.

## Critical distinction: information vs enforcement

A policy saved to D1 is **operational guidance** until application code explicitly loads it and validates a business action. For example, storing a maximum discount percentage does **not** change checkout behaviour or automatically authorise or block a sale. Existing server-side product, stock, pricing and publication controls remain authoritative. Automated enforcement needs a reviewed implementation and tests for each policy separately.

Similarly, approved reference-image URLs do not automatically feed an image generator. Images must be loaded into the tool as actual visual references using an interface that supports them. Generated or edited images still require owner review and existing private-gallery attachment before being published.

## Deployment

This is a replacement of the earlier unmerged Creative Standards proposal, not a second parallel rules system. Apply the replacement **0065** migration before deploying the Admin/MCP Worker; do not deploy the old creative-only migration. Run the Rules & Standards CI and check the Admin editor plus owner MCP read permissions before merging. No rule edit writes directly to the public storefront.

The separate 4:5 storefront framing work is in PR #56. Rules manage policy content; the storefront controls image presentation.
