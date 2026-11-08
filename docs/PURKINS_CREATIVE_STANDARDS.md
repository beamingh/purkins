# Purkins Creative Standards

Creative instructions live in **D1**, not in prompts, chat memory or hardcoded storefront templates. The implementation is versioned in GitHub, but the owner changes actual creative instructions in **Admin → Creative Standards**.

## Scope and precedence

A creative document has a domain (photography, naming, descriptions or social), scope (global, preset, category or product), a revision, active state, JSON rules, and approved `med_` media references.

Effective instructions merge: **global → selected preset → category → product**. Only configured **structured settings** override inherited values; instructions and required shots accumulate in precedence order so global brand safeguards remain visible. A product with multiple categories applies them in stable alphabetical order; product overrides always win. Reference images from all active levels are combined without duplicates.

Photography defaults: 4:5 portrait, 1080 × 1350 px, white studio. Approved presets: studio-product, feature-composite, purkins-kitchen, lifestyle. These are **starting defaults**, freely editable in Admin.

## Admin workflow

1. Upload approved reference photographs into the Admin Media Library.
2. Open **Creative Standards** and choose a domain, level and target (preset slug, `cat_` ID or `prod_` ID).
3. Save rules, approved `med_` image references, and any product-specific label/colour accuracy notes.
4. View effective inherited rules and revision history. **Restore** creates a *new* revision rather than deleting history.
5. Use the existing private product gallery and guarded MCP photo attachment to stage photos; review the draft and approve publication explicitly. No Creative Standards operation automatically publishes or changes shopper-visible images.

The Media Library blocks deletion while an image is an active standard reference. Remove its association first.

## MCP tools

Operator-credential **reads**, subject to each token's allowed tools:
- `list_purkins_creative_presets`
- `get_purkins_creative_standards`: effective document, sources, approved image URLs and a ready brief
- `get_purkins_creative_rule`: current individual rule and revision
- `get_purkins_creative_history`: immutable previous versions

MCP **writes**: `update_guarded_purkins_creative_standard` requires an owner token with the named write permission, an explicit global write switch, `PURKINS_MCP_CREATIVE_WRITES_ENABLED=true`, an authenticated actor, fresh UUID request_id, and the current expected_revision. Reusing an idempotency UUID with different inputs fails; stale writes fail closed.

## Deployment and media

Apply migration `0065_purkins_creative_standards.sql` **before deploying either Worker**; Admin and MCP share D1. The migration seeds editable photography defaults and presets. The guarded MCP creative write switch is OFF on fresh installations, and existing installations can opt in via the existing owner-confirmed `mcp-writes-on` configuration workflow.

Reference image URLs point at approved R2-backed Media Library objects on the public storefront. They are usable as exact visual references wherever the image-generation interface supports importing URLs; returning a URL **does not by itself** attach the image into an image-generation request. Approvals and product imagery remain managed through the existing gallery workflow.

4:5 **display framing** in storefront cards and galleries is a separate change in PR #56. Creative Standards manage guidance, not the image files or browser layout.
