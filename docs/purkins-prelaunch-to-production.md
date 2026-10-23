# Purkins: one live environment, prelaunch → production

**Decision (23 October 2026): do not create separate staging/development and
production Cloudflare stacks.** Run **two permanent Workers** for different
trust boundaries (customer storefront and owner Admin+MCP), sharing the same
single D1/R2 installation. Promote those Workers without migrating stock.

## One permanent resource set

| Component | Permanent target name | Notes |
| --- | --- | --- |
| Public Worker | `purkins-storefront` | Customer pages, cart, checkout, webhooks, public APIs |
| D1 database | `purkins-storefront-db` | Stock, settings, orders; never reset to launch |
| Product images | `purkins-storefront-images` | R2, same objects and binding |
| Private files | `purkins-storefront-files` | R2, never enable public r2.dev |
| Admin + MCP Worker | `purkins-admin` | Owner UI + API + authenticated operator MCP; writes off initially |

Existing account resources `purkins` (D1) and `purkins-media` (R2)
have unverified origins. **Do not attach to, migrate, overwrite or delete
them.** Never change SeeZambia/Ulwimbo resources. Verify target names are
available again before creating them. These names are proposed, not yet created.

## Prelaunch: index suppression, not access control

`PRELAUNCH_NOINDEX=true` in the Wrangler configuration is the one
reversible indexing switch. While enabled:

- Dynamic responses carry `X-Robots-Tag: noindex, nofollow, noarchive`;
  storefront HTML also has the corresponding robots meta tag.
- `robots.txt` allows crawling of public paths **so engines can see
  noindex**. It continues to disallow Admin and API paths but does not
  advertise the sitemap.
- `/sitemap.xml` and `/llms.txt` return 404, `private, no-store`;
  they do not advertise products, pages or agent endpoints.
- Do **not** confuse noindex with privacy. The prelaunch site is accessible
  by anyone with its URL unless separately protected. Keep the whole prelaunch
  Worker behind Cloudflare Access until we are ready for public previews or
  configure the built-in Admin password securely before adding real stock.
  Verify both `/admin/*` and `/api/admin/*` reject anonymous users.
- Do not enable live payment keys merely to test inventory; start with demo
  checkout, private draft stock and no live promotions.

Cloudflare's own guidance allows adding Access to a Worker. Google's noindex
guidance requires crawlers to see the tag; `robots.txt: Disallow: /` is not
a substitute. Use both indexing controls and authorization for their
separate purposes.

## Windows-safe permanent provisioning commands

The **permanent** install uses `scripts/purkins-permanent.mjs`, with no Bash,
OpenSSL or Git-tracked Cloudflare IDs. These commands always operate on the
**new** names `purkins-storefront*`. The legacy `purkins` D1 and
`purkins-media` bucket must not be adopted or modified.

From `C:\GitHub\purkins` after merging the provisioning PR:

```powershell
git switch main
git pull --ff-only origin main
npm ci
npm run purkins:cloudflare
```

With no arguments, the command performs a read-only Cloudflare API preflight,
checking all relevant Worker, R2 and D1 names and refusing incomplete listings.
It authenticates through the installed Wrangler login without printing tokens.
With multiple Cloudflare accounts, set `CLOUDFLARE_ACCOUNT_ID` in your own
PowerShell session to select the intended account. Do not share authentication
tokens. Inspect the results before continuing.

Creating permanent cloud resources is a **separate, explicit decision**:

```powershell
npm run purkins:cloudflare -- create --confirm=CREATE-PURKINS-FOREVER
```

This creates exactly one permanent D1 and two private R2 buckets. It does not
create a staging copy, run remote migrations, deploy or modify Access.
Generated local configs are gitignored:

- `wrangler.purkins.permanent.jsonc` — permanent public storefront Worker
- `wrangler.admin.permanent.jsonc` — permanent Admin + authenticated MCP Worker
- `.instances/purkins-permanent.json` — local creation metadata

If only some API requests succeed, **STOP** and inspect Cloudflare resources.
The tool deliberately never deletes or repurposes partially created
infrastructure and refuses rerunning first-time creation blindly.

After resource creation (these steps are deliberately independent):

```powershell
npm run build:workers
npm run purkins:cloudflare -- build
npm run purkins:cloudflare -- migrate --confirm=MIGRATE-PURKINS-FOREVER
npm run purkins:cloudflare -- deploy --confirm=DEPLOY-UNROUTED-PURKINS
```

The root npm workspace installs MCP alongside Astro through a single `npm ci`.
The build swaps in the generated configuration only temporarily, then restores
the committed `wrangler.jsonc`, even on a normal build failure. It refuses
to run if that file has uncommitted edits or an unrecovered backup.

The migration action runs **all** numbered migrations against the one permanent
D1 and records completion locally; deployment is refused until they succeed.
Both route-filtered Workers initially deploy **unrouted**:
`workers_dev=false`, `preview_urls=false`. No public URL is enabled.
The public build omits Admin routes; the Admin build omits checkout, order
status, product catalog and payment webhooks. Both retain image access.

**Do not enable a public Worker URL or attach a domain yet.** Before doing so,
set long-lived random `AUTH_SECRET` and `SECRETS_KEK` in the permanent
Worker (once; never casually rotate the encryption key), configure
Cloudflare Access or an equivalent secure first-run owner-only onboarding
flow, and independently check `/admin/*` and `/api/admin/*` gating. The
current script intentionally does **not** create/open a public endpoint or
turn on live payments. The owner-only access and first-run secret setup remain
a release gate.

### Recovery caution

If the Node process is killed forcibly during the temporary config swap,
the reserved backup at `.instances/wrangler.original.backup.jsonc` stays
behind. The script refuses further operations until it is manually inspected
and the tracked `wrangler.jsonc` restored. Never overwrite your committed
config blindly or delete any D1/R2 resource as a recovery shortcut.

## First deployment workflow (no separate staging)

1. From Windows PowerShell, use `main` after merging and verifying the
   prelaunch change. `npm test`, `npm run check`, `npm run build`,
   `npm run theme:check`, `npm run mcp:check`.
2. Smoke test local D1 migration 0043: child bag, parent move, correct dynamic
   location paths and Admin stock form.
3. Use the Windows-safe Node.js provisioning workflow above. It performs
   complete read-only resource-name checks and creates D1/R2 only behind an
   explicit confirmation, never copying stock from staging. The generic
   `scripts/provision-cf.sh` requires Bash/OpenSSL and automatically deploys;
   **do not run it from PowerShell**. Never commit generated configs/secrets.
4. Ensure safe, owner-only access before exposing Admin's first-run setup
   wizard. Configure fresh `AUTH_SECRET` and `SECRETS_KEK`. Validate
   unauthenticated Admin pages and mutation API endpoints are blocked.
5. Apply migrations to the single new D1 **in order including 0043**, then
   deploy the Worker once. Validate real Worker request headers and
   `/robots.txt`, `/sitemap.xml`, `/llms.txt` while noindex is enabled.
6. Add a few actual Purkins stock items as private drafts and test images,
   variants, bulk/pack count, price review and location movements. No demo
   inventory seeding into long-lived stock unless intentionally requested.
7. Operator MCP is hosted **inside the Admin Worker**, sharing its D1 binding.
   Supply a dedicated MCP bearer secret, test session authentication and private
   data boundaries, and retain `PURKINS_MCP_WRITES_ENABLED=false` until audited
   write controls ship. Anonymous buyer MCP is **not** hosted on the Admin Worker;
   future buyer agents should use the public JSON API or a separately reviewed
   public MCP route. The existing DO-backed MCP handler is reused initially;
   migration to Cloudflare's stateless handler is a later compatibility-tested step.

These steps have **not** been run on remote Cloudflare infrastructure.

## Promotion to public production

No new D1, no copied R2 bucket, and no replacing the Worker. Instead:

1. Finish actual payment, shipping/pickup, checkout, inventory and security
   verification. Resolve prelaunch test/dummy stock and orders explicitly in
   the existing database without resetting real inventory.
2. Point the intended Purkins domain to the existing storefront Worker and
   configure canonical HTTPS origin, email settings and product-image delivery.
   Revisit Cloudflare Access: an all-Worker policy must be adjusted/removed for
   the shopper-visible routes while owner Admin stays authenticated.
3. Change **`PRELAUNCH_NOINDEX` from `true` to `false`** in that same
   Worker's config and redeploy. Verify the robots meta/header are absent,
   `/robots.txt` advertises the sitemap, and `/sitemap.xml` returns valid
   public product URLs. Check `/llms.txt` only when agent exposure is intended.
4. Check Cloudflare and browser caches for stale noindex responses; wait for
   caches to expire or purge them before submitting the sitemap to Search
   Console. Check both workers.dev and custom-domain behavior to avoid
   duplicate search indexing; disable alternative public ingress as appropriate.
5. Monitor search indexing and orders after launch. Noindex removal allows
   indexing but does not guarantee immediate Google indexing.

The larger plan remains: secure MCP writes, fast bulk intake, supplier barcode
capture, per-location stock placements, South Africa trip landed-cost
allocation, Admin inventory dashboard and Zambia-ready checkout.
