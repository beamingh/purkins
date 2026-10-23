# Purkins Cloudflare staging — safe preparation (Windows PowerShell)

**Status: planning only. No resources have been created or deployed by this
document or the rapid-intake feature branch.** The connected Cloudflare account
already contains legacy-named resources `purkins` (D1) and `purkins-media`
(R2); their provenance has not been established. **Never repurpose them.**

## Intended independent development topology

| Resource | Proposed name | Purpose |
| --- | --- | --- |
| Storefront Worker | `purkins-dev` | Astro storefront + protected Admin |
| MCP Worker | `purkins-dev-mcp` | Read-only operator/buyer MCP initially |
| D1 | `purkins-dev-db` | Shared **only** between the two staging Workers |
| R2 | `purkins-dev-images` | Product images |
| R2 | `purkins-dev-files` | Private deliverables, no public bucket domain |

All names must be checked for availability before provisioning. Neither
Worker should be routed to the public Purkins brand domain during staging.

## Read-only operator preflight (safe to run now)

From `C:\GitHub\purkins` in Windows PowerShell:

```powershell
git switch main
git pull --ff-only origin main
npm ci
npm ci --prefix mcp
npm run check
npm run build
npm run mcp:check
npx wrangler whoami
npx wrangler d1 list
npx wrangler r2 bucket list
```

The final three commands **list** your Cloudflare identity and resources. Do
not paste credentials, tokens or private bindings into chat or git.

## Remote provisioning (a separate, deliberate stage)

1. Create **new** isolated D1 and R2 resources; never bind `purkins`,
   `purkins-media`, any SeeZambia asset, or an old Payload resource.
2. Validate `0040_purkins_intake.sql` and `0041_purkins_cataloguing.sql`
   with **local-only** migrations first. Render a unique staging Wrangler
   configuration from `wrangler.template.jsonc` with the new D1 ID.
3. Set fresh random `AUTH_SECRET` and `SECRETS_KEK` using Wrangler secrets.
   Never commit secrets or generated instance configs. The stock
   `scripts/provision-cf.sh` requires Bash/OpenSSL; **do not run it from
   PowerShell**. Implement/test a safe Node.js provisioning flow instead.
4. Protect the Worker with Cloudflare Access (or establish admin password
   immediately before allowing users in); verify that an unauthenticated
   visitor cannot reach Admin or its JSON endpoints. Use only sample
   inventory until the protection and migrations are proven.
5. Deploy the storefront to its staging workers.dev hostname. Test the Admin
   wizard, media upload, private drafts and publication guards.
6. Render the separate `mcp/wrangler.template.jsonc` with the **same staging
   D1 ID**, a dedicated MCP bearer secret, and
   `PURKINS_MCP_WRITES_ENABLED=false`. Only then deploy the MCP Worker.
7. Test both anonymous buyer calls (public only) and the authenticated
   operator's private **read-only** tools, including rejection of invalid
   tokens and private-data isolation.
8. MCP writes require separate permissions, idempotency, audit logging,
   concurrency protections and explicit authorization before enabling.

**Do not run** `npm run deploy`, `npm run provision:cf`, remote D1
migrations, `npm run mcp:deploy` or make Cloudflare mutations based only
on this document. Production and staging are separate release decisions.
