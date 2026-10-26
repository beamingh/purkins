# Purkins | Baby & Mum Essentials — Retail Experience & Operations Blueprint

**Status:** planning baseline / proposed work, 26 October 2026  
**Scope:** purkins.ulwimbo.com storefront, admin.purkins.ulwimbo.com operator console, shared Cloudflare D1/R2, payments, delivery, catalog and MCP.  
**Principle:** adapt proven retail UX to a lean, mobile-first Zambian baby-and-mum store, operated initially by one person. This is NOT a request to copy eBay or build marketplace features.

## 0. Verified baseline (26 October 2026)

Source audit: current GitHub main, Cloudflare production settings/D1, and Purkins MCP.

**Already engineered:** Astro store with distinct Cloudflare public/Admin+MCP Workers; product, variant, category, cart, search, sorting, checkout and order endpoints; R2 media library with upload, product gallery and guarded MCP metadata controls; product drafts/intake, manual sales, locations, supplier barcodes, stock and revision guards; settings, navigation, content pages, shipping, customer/order and payments modules; private preview/publish.

**Live business configuration:** one published product (TY-899), one category (Feeding & Nursing), zero published content pages, zero header/footer menu entries, zero orders at audit time; demo checkout is the only payment rail the MCP exposes. Home currently falls back to the product catalog. The live Workers do not expose IMAGE_BASE_URL; D1 has no image_delivery override. This suggests original source-file delivery, despite a separately implemented transform ladder. Verify with real response headers/network waterfalls before claiming CDN resizing enabled. Both Workers have PRELAUNCH_NOINDEX=true.

**Recent work:** PR #35 optional compare-at pricing deployed after migration 0053 on 26 October; TY-899 uses historical K1,100 and selling K950, verified in public catalog/detail APIs. The source photo for TY-899 is ~1122 × 1402; currently one gallery image. Product description and public listing are populated. Store still lacks live real-money checkout configuration and validated shipping fulfillment.

## 1. Product strategy and non-goals

Mission: turn existing brand-new physical stock into trustworthy, searchable, purchasable products and orders without creating a complex marketplace or requiring a large team.

Primary users:
1. Mobile shopper in Zambia, often coming from Facebook/WhatsApp, comparing price, photos, size/age, availability, delivery and payment.
2. Solo Purkins operator cataloguing mixed garments, baby accessories and equipment and fulfilling each sale.
3. Assistant/MCP client allowed to perform permissioned intake, editing and lifecycle operations while retaining auditability.

Principles:
- Mobile-first, responsive, fast on ordinary mobile data; design for real photos and useful information, not decorative content.
- Be specific and factual about materials, electrical specs, completeness, warranties, stock, pickup and pricing; unknown stays unknown. Do not fabricate ratings, discounts or stock pressure.
- Never expose internal storage locations, supplier barcodes, purchasing costs, internal notes, raw checkout tokens or access secrets.
- Guest checkout first; accounts optional. WhatsApp contact as support, not the sole way to purchase.
- Reuse existing modular Astro/D1/R2/MCP systems; extend them only where audit identifies a concrete gap.
- Avoid promotional UX that distracts from seeing products and placing orders.

Non-goals for first trading release: multi-seller marketplace, loyalty points, wishlists, paid membership, elaborate recommendation ML, auctions, customer-generated reviews without verified orders, animated home-page carousels, mobile apps, complex AI shopping assistants.

## 2. Store information architecture

### Header, desktop
- Narrow optional announcement bar: a **true** pickup/delivery offer, launch sale or contact note; never an invented promise.
- Brand logo linked to home; short primary category menu (Baby Clothes, Feeding & Nursing, Bath & Care, Carriers & Travel, Offers) **only when populated**.
- Search (visible or prominent icon), cart count, optional account; an uncluttered Shop all link.
- On mobile: logo, search, cart and accessible menu; large touch targets, no overlapping sticky header or layout shifts.

### Footer
Design grouped and visually legible columns, powered by existing page + navigation editors:
- **Shop:** All products; Baby Clothes; Feeding & Nursing; other populated categories; Special Offers.
- **Help:** Contact Us; Delivery & Pickup; Returns, Exchanges & Refunds; FAQ; Track an Order.
- **About:** About Purkins; Our Story; Privacy Policy; Terms of Sale.
- **Contact/trust:** confirmed customer-service WhatsApp/phone and email; physical/pickup or operating location disclosed to the extent legally required; payment methods that ACTUALLY work; social links; copyright.
- Keep operator/admin access separate from consumer links. Do not put empty/404 targets into live menus.

### Required business pages and readiness
Before accepting real payments, create/publish:
1. Contact Us — legal trading identity, reachable phone/email, actual service area and contact options.
2. Delivery & Pickup — supported areas, fulfillment options, accurate fees, timelines, handover procedure, cutoffs, failed delivery.
3. Returns, Exchanges & Refunds — clear eligibility, process, exceptions for hygiene-sensitive products if legally applicable, timelines, damaged/wrong items, return cost.
4. Privacy & Cookies — collected fields, why, processing, vendor sharing, rights, retention, marketing choices.
5. Terms of Sale — sale formation, full charges, accepted payments, cancellation, product descriptions, dispute contact.
6. About Purkins — genuine business/brand information.
7. FAQ — concise, task-based answers on sizes, stock, delivery, payment, returns, warranty.
8. Order confirmation and order status — private guest token, receipts, customer support.
Optional after trading starts: Size Guide, Product Care/Safety, How to Buy, Promotions, News/Guides.

For Zambia, check the Electronic Communications and Transactions Act 2021 (particularly consumer information, price, delivery, refund and cooling-off provisions) and the Data Protection Act 2021. Policies must reflect the actual legal entity and processes; obtain appropriate legal review for exceptions and registration obligations. Avoid invented addresses or business registration numbers.

## 3. Homepage: a storefront, not a raw feed

- Hero: clear brand proposition and one CTA to Shop Baby Essentials; avoid slider.
- Featured/populated categories grid (responsive square/portrait images).
- New Arrivals: actual recently published stock.
- Selected Offers: products with genuine configured original price above current.
- What shoppers need to know: local service/pickup, support channel, payment availability and returns, **only once operational**.
- 1–2 strong editorial links (how to select baby clothes size; safe bottle warming) only if researched.
- Trust-building authentic brand imagery, actual product photos, never fictitious reviews.

Content and categories should be configured in Admin, with fallbacks for a category having only 1–2 products. Avoid unnecessary DB calls or duplicate header elements.

## 4. Catalog, search, filters and collections

- Clear categories + nested types; baby apparel: gender-neutral/girls/boys if used, age/size, garment type, colour, brand; equipment: function, brand, size/capacity if verified.
- Display one product card for a garment with variants, not duplicates per size.
- Grid cards: useful actual photo, full name, current price, optional crossed-out former price/Special Offer, availability; quick second photo only after media coverage justifies it.
- Sorting: newest, price asc/desc, product name; filters by populated category, size/age, price, availability, brand. Filter counts and current selection; mobile filter drawer.
- Search tolerant of product names/model codes and near matches. Empty states suggest categories/search correction.
- Pagination/URL query params shareable; SEO metadata/canonical and schema when noindex eventually removed.
- Avoid showing exact remaining stock to anonymous API clients; operator holds exact quantity.

## 5. Product page (PDP) blueprint

Layout:
- Breadcrumbs / Back to category.
- Desktop 2-column: **image-gallery left**, purchase-information right; single-column mobile with price and primary CTA near gallery.
- Name, category/brand, optional item model code (TY-899).
- Current price prominent; original price struck through only when set and truly higher; optional plain Special Offer text. Show discount amount/percent only from data and only if worth it.
- Verified availability, optional colour/size options as accessible buttons, quantity, Add to cart / Buy now.
- Clear pickup and delivery summary **before payment**; link to policy and shipping estimator when rates configured.
- Product facts above the long description: new/condition, age range, dimensions, materials, package contents, care, manufacturer directions and warning notes appropriate to category.
- Below purchase controls: compact sections **Description; Specifications; Delivery & Returns; Safety/Care** via on-page headings or vertical disclosures. Avoid hiding critical delivery/returns behind horizontal tabs.
- Related items based on category (existing capability), real reviews only after verified-purchaser system exists.
- Contact question CTA/WhatsApp with prefilled product name/link, not fabricated “live chat”.
- Preserve schema.org current Offer price, not previous price as payable price.

Example layout for TY-899:
  Image/thumbnail gallery | TY-899 Double Bottle Warmer & Sterilizer
  (zoom button)           | Feeding & Nursing
                          | ~~K1,100~~ K950 (if original price configured)
                          | Available • 4 units in operator inventory
                          | Digital temp / timer • dual bottle • defrost • steam sterilization
                          | [Add to Cart] [Buy Now]
                          | Delivery/Pickup information, return link
  Description, specifications, safety, related equipment below.

## 6. Image and media pipeline: definitive plan

**Current evidence:** ProductGallery displays multiple images in a snap scrolling rail with 64px thumbnail links. It uses square frames with object-cover and no explicit full-screen zoom. Image delivery selects original source if not explicitly configured for Cloudflare transformed image URLs. Cloudflare transform mode currently supports 128/384/768/1024px srcset candidates, conditional on IMAGE_BASE_URL + the chosen image-delivery setting. The public /images route caches R2 originals at edge but does not resize them.

Desired media model:
1. Accept JPEG/PNG/WebP uploads, paste, drag/drop and selective reuse of Media Library. Validate byte type/size and dimensions; optimize where configured. Keep R2 source and DB reference ownership.
2. One canonical image per media ID, with alt, dimension, orientation, photo role (front, rear, packaging, detail, scale, lifestyle), attribution/rights and display ordering. Some can remain null.
3. Create/serve appropriate renditions for thumbnail (e.g. ~128), card (~384), gallery (~768/1024), zoom (~1400–2000 where source allows); modern formats and correct source dimensions. Pick generation-on-demand plus caching OR upload-time derivatives after measuring Cloudflare Images bills/limits. Do not gratuitously run transformations for every image.
4. Browser chooses responsive dimensions through verified srcset/sizes; initial LCP image eager/high priority; later gallery images lazy; lightbox original/zoom fetched **on intent**. Preserve natural aspect ratio in gallery via object-contain; cards may crop with optional focal point.
5. Thumbnails/arrow keys/touch swipe, active thumb focus/highlight, accessible alt, lightbox zoom, next/previous, Esc to close; variant image selection integrated.
6. Product photo checklist: front, back, label/model, details/features, packaging, scale reference, complete set. Clothing front/back/close-up labels/measurements; equipment controls, accessories and power requirements. No unrealistic illustrative image presented as actual included accessory.
7. Fix image uploading UX with durable success/failure feedback, image-order persistence, alt bulk-editing, primary marker, focal point and caption; keep operator MCP metadata/actions.
8. Audit 64px thumbnails in Network panel: actual response size, width, cache status and total transferred bytes; set explicit performance budgets. No page should download the full original for each small thumbnail when derivative delivery is available.

## 7. Checkout, payment and orders — the commercial critical path

- A single checkout path and shared stock/price authority; accurate line subtotal + selected delivery + any applicable tax/fees BEFORE final confirmation.
- Guest checkout primary; require only full name, reachable mobile number, appropriate delivery/pickup address and optional email.
- Zambia-ready methods after operational onboarding: confirmed eligible mobile-money provider integration (MTN/Airtel) or carefully controlled manual merchant payment process with independent reconciliation; never mark paid based only on buyer screenshot. Cards optional later.
- **Current live payment rail is demo only**; do not present demo as real-world payment or collect customer funds through it.
- Payment state machine: initiated → pending/unpaid → verified paid → packed → ready for pickup/dispatched → delivered; cancelled/refunded exceptions. Payment/provider callbacks idempotent, signed/authenticated, timestamps.
- Oversell prevention: inventory reserves with clear expiry, server-side revalidation at checkout, no duplicate order on refresh/retry.
- Customer order reference, order confirmation, secure guest tracking link, downloadable/sent receipt, contact for problems.
- Delivery model: Lusaka zone options, pickup where confirmed, transparent flat/area-based charges first; weight-based or multiple carriers only when needed. Admin packing slip, labels, courier name/tracking when available. Test using realistic Zambian addresses and phone format.
- Return/refund handling ties back to original payment and stock disposition; audit log and clear operator controls.

## 8. Backend/Admin (single-operator cockpit)

### Dashboard
- Action queue, not vanity graphs: new orders to confirm, orders to pack/deliver, low stock, unpublished drafts, image gaps, customer inquiries, payment exceptions.
- Sales, margin and stock reporting AFTER valid cost data; distinguish money received from gross orders, demo transactions and refunds.

### Product workflows
- Product list with search, status filters, batch actions (safe), current price, image count, stock, category, completion level, last edit.
- Guided item editor: Details → Pricing & Stock → Photos → Variants → Review/Publish. Keep draft progress; save, autosave optional, explicit feedback.
- Template/checklists per type: clothing (age, size, colour, fabric, brand, package count); baby gear (power, controls, dimensions, compatible accessories, warranty, box contents, safety notes).
- Barcode scan/lookup for operator stock; supplier barcode distinct from Purkins SKU and not exposed publicly.
- Source/cost/overheads/exchange-rate/landed-cost per purchase batch, not forced at public listing time when unknown.
- Provenance of photos, multiple variants with one source item, no duplicate stock between variants and parent; support bundle/kit semantics later.

### Operations
- Intake: purchase batch → sack/bag/location → count & inspect → product draft → photos → publish.
- Manual/offline sale records reduce available stock; returns can restock only when condition allows.
- Reorder thresholds, inventory adjustments with reason/audit, location hierarchy, periodic cycle counts.
- Fulfillment board with bulk printable pick lists, contact notes, delivery assignments, packaging fees and dispatch status.
- Customer support timeline, order notes and privacy/retention controls.
- Settings pages for home merch, announcement, menus, contact/social, legal pages, discounts, payment, shipping; separate from security/developer configuration.
- Operator feedback everywhere: saved/unsaved/pending/error, retries, confirmation for destructive actions.

## 9. MCP and automation design

Permissioned, documented operations grouped by workflow:
- Read: list/search stock, list drafts, inspect catalog/product/gallery, readiness, orders, categories, settings summary.
- Write: guarded product-detail edit (including description, category, price and optional original price); upload/import media bytes or a controlled media URL; attach/reorder/set alt/primary; variant reconciliation; stock adjustment; publish/unpublish; create draft; create/update content page; update navigation.
- Payments/orders: read orders, prepare fulfillment updates, record *verified* manual settlement under owner approval; no accidental charging, no self-issued payment confirmation.
- Every write: token scope/owner actor, idempotency request ID, revision precondition for concurrent edits, explicit result, audit log, no secret material, no numeric DB row IDs in external API.
- Distinguish missing client permissions from missing backend registrations. Reconnection / token replacement should be a simple Admin action when new tools appear.
- Media transport is a separate functional requirement: text/metadata tools do not accept attached image bytes automatically; build a proper authenticated upload tool, rather than promising that every file in chat can be uploaded.

## 10. Performance, quality and operations

- Audit homepage, category, PDP, gallery and cart using phone viewport and a realistic slower mobile network; record LCP/CLS/INP and actual transferred image sizes.
- Public Cloudflare Worker and Admin Worker isolation remains. D1 reads must be bounded/paginated; cache invalidation must reach the PUBLIC Worker for publication and price changes. Do not conflate “DB says live” with “HTML cache current”.
- Sensitive buyer data/keys encrypted or restricted, tokenized order status, least-privilege MCP, backups and restore drills, webhook verification, rate limiting and log redaction.
- Error instrumentation: checkout failed, upload failed, payment pending/failed, cache purge failed, order notification failure; operator dashboard surfaces actionable failures.
- End-to-end browser cases: browsing → PDP → cart → address/delivery → checkout/payment test → order status; photo intake → edit → publish → public appearance; return/refund; mobile menu/search.
- Analytics/events: view product, add-to-cart, initiate checkout, submit order, verified payment, fulfillment, refund. No invasive tracking by default; comply with consent/privacy requirements.

## 11. Prioritized delivery roadmap

### Phase 0 — merchandising and trust foundation (first)
- Populate business contact and publish truthful legal/help pages; make footer/header navigation useful.
- Define real pickup/delivery coverage, fees and customer support process.
- Confirm payment gateway or manual merchant settlement procedure; keep real purchase disabled/demo-labeled until checkout is legitimate.
- Audit image delivery: source vs derivative and R2/cache cost; enable/correct responsive delivery and product-gallery object-contain.
- Apply vetted compare-at PR #35 migration 0053 and deploy together; enter K1,100 old price for TY-899 only if valid historical price.
- Deliver *one* complete happy path from product to confirmed paid/delivered order before spending effort on advanced home graphics.

### Phase 1 — coherent storefront
- Branded homepage, category grid, navigation, comprehensive footer.
- Redesigned PDP layout: genuine images/zoom, specs, size/condition, price, pickup/delivery and visible CTA; vertical sections instead of hidden horizontal tabs.
- Catalog filtering, product cards, category templates, search empty states and mobile polish.
- Order status and post-purchase communications.

### Phase 2 — efficient solo operations
- Admin action dashboard, intake templates, batch photo entry, product completion scoring, barcode and location lookup.
- Real payment and cash/manual reconciliation, packing/pickup/delivery boards, safe returns workflow.
- MCP product fields/media transport, publication lifecycle, category/menu/page tools and integration tests.

### Phase 3 — measured growth
- Stock threshold and replenishment insights, attributable promotions, abandoned checkout outreach only with valid opt-in, reports, verified reviews, size-guide content, selective recommendations and SEO after noindex is intentionally lifted.
- Avoid making review/testimonial claims before data exists.

## 12. Acceptance criteria / definition of done

**Image performance:** card and thumbnail requests do not routinely transfer original full-resolution bytes; width/height prevent CLS; first hero prioritized and rest deferred; gallery switches/zoom works on touch and keyboard.

**Shopper trust:** header/footer route only to real published pages; contact, business identity and operational policies are accurate; shipping fee shown before commitment.

**Product page:** all displayed price data agrees with cart; original price only if configured and higher; source image and multiple photos usable, optional details and safety information clear; product variants correctly control stock.

**Checkout:** a buyer can place one REAL paid order and get a confirmation; verification/retry does not double-charge or double-decrement; canceled/unavailable sales are reconciled and customers informed.

**Operator:** receive stock → draft → upload/copy/paste photos → create variants → check listing → publish → record order → fulfill/refund from one documented workflow with helpful errors.

**MCP:** authorized same lifecycle possible through scoped tools (including actual media upload), idempotent revisions and auditable changes; no public/private leakage.

**Deployment:** migrations, Workers and cache purge independently verified; noindex remains until policies, payments, fulfillment and site-content checks are passed. Merge is distinct from deploying.

## 13. Design references (principles, not page copying)

- eBay product listing pictures, item specifics, multiple images, zoom and seller information: https://www.ebay.com/help/selling/listings/creating-managing-listings/x?id=4148
- Shopify product media formats and differentiated sizes: https://help.shopify.com/en/manual/products/product-media/product-media-types
- Shopify theme image performance: https://shopify.dev/docs/storefronts/themes/best-practices/performance
- Baymard research, product-page imagery and clear buy section: https://baymard.com/research/product-page
- Baymard research, checkout and guest checkout: https://baymard.com/research-articles/current-state-of-checkout-ux
- Zambia Electronic Communications and Transactions Act 2021 (Part VIII, sections 63–67): https://zambialii.org/akn/zm/act/2021/4/eng%402021-03-24
- Zambia Data Protection Act 2021: https://zambialii.org/akn/zm/act/2021/3/eng%402021-03-24

## 14. Initial build tickets (recommended sequence)

1. **AUDIT-IMAGE-01:** confirm production image delivery mode and response bytes; reproduce thumbnail and hero network request sizes on TY-899.
2. **MEDIA-02:** Cloudflare responsive derivatives for cards/gallery/zoom; maintain R2 originals and affordable caching.
3. **GALLERY-03:** object-contain, selectable active thumbnails, swipe/keyboard, zoom modal, alt/status handling; test 1, 2, 6+ photo scenarios.
4. **CONTENT-04:** publish business pages and legal/support copy grounded in actual identity, shipping and payment terms.
5. **NAV-05:** design and configure branded header/footer, mobile navigation, trust/contact strip, category menu; no empty links.
6. **PAY-06:** choose and prove real Zambia-compatible payment; webhook or verified manual reconciliation and receipt.
7. **SHIP-07:** configure Lusaka pickup/delivery or validated geographic coverage, exact rates and fulfillment workflow.
8. **PDP-08:** redesigned product page with factual specifications, shipping info, variant selection, real promo price and buy controls.
9. **HOME-09:** merchant-managed branded homepage with curated category/new/offer collections.
10. **OPERATIONS-10:** draft completeness, stock count, manual sales integration and first order fulfillment board.
11. **MCP-11:** guarded product edit and direct image transport, category/page/nav read-write operations.
12. **E2E-12:** mobile end-to-end tests for browsing, images, real payment, and order fulfillment with analytics and alerting.

**Owner decision gates before release:** true operating/legal identity/contact details; actual delivery zones/fees; authentic supported payment and return processes; stock/condition review; permission to switch noindex off. Engineering should not invent any of these values.
