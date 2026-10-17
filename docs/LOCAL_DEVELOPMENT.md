# Purkins: Windows local development and deployment

This project is **inventory-first**, not a public store yet. All checks are manually invoked. **No GitHub Actions run on pushes or pull requests**, and nothing here deploys automatically.

## 1. Check tools

Use **Node.js 24.15.0 or newer** and **pnpm 10**. A Cloudflare Workers Paid plan may be required because the Payload Worker exceeds the Free Worker bundle limit. Check the cost before deployment.

From **PowerShell**:

```powershell
node --version
pnpm --version
```

If `pnpm` isn't available, install pnpm 10 first. Wrangler will be installed locally by `pnpm install`.

## 2. Get the feature branch

For a new clone:

```powershell
cd C:\GitHub
git clone https://github.com/beamingh/purkins.git
cd purkins
git switch --track origin/feat/payload-foundation
pnpm install
```

For an existing clone, from its root:

```powershell
git fetch origin
git switch feat/payload-foundation
git pull --ff-only
pnpm install
```

Do not test the README-only `main` branch; the application is on `feat/payload-foundation`.

## 3. Generate a **local-only** secret

Run once in the repository root:

```powershell
$secret = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
Set-Content -Path .env -Value "PAYLOAD_SECRET=$secret"
```

Cloudflare's local bindings can read `.env`. Do **not** create a second `.dev.vars` file at the same time; Wrangler prefers `.dev.vars` and can ignore the values in `.env`. Both files are gitignored. Do not paste the secret into a chat, issue, commit, or logs. Production must use a separate secret.

## 4. Run everything against the **local** D1/R2 emulator

```powershell
pnpm generate:types:cloudflare
pnpm payload migrate
pnpm dev
```

Open **http://localhost:3000/admin**. Register the first owner **only locally**. Create a sample product, add quantity and a ZMW price, and test an upload; local D1/R2 test data is separate from the real Purkins database and bucket.

Before using the account remotely, also verify that a pricing partner cannot edit quantity, see cost price, or approve a selling price, and anonymous requests cannot read inventory or photos. These are still manual acceptance tests, not completed production security tests.

## 5. Manual checks, only when YOU choose

Run individual checks, or the full local check:

```powershell
pnpm test:unit
pnpm lint
pnpm exec tsc --noEmit
pnpm check:local
```

`pnpm check:local` runs unit tests, lint, Cloudflare type generation, TypeScript and a production Next.js build **on your computer**, on demand. It does not touch production. `pnpm preview` can be used to check the OpenNext/Workers runtime locally.

No test hooks, push-based testing or automatic deployments have been enabled.

## 6. Production deployment from this machine (NOT YET)

Cloudflare resources already exist: dedicated D1 database `purkins` and private R2 bucket `purkins-media`. The Wrangler configuration points at them.

**Do not run `pnpm deploy` yet.** Production deployment is blocked on the following:

1. Protect the production hostname with Cloudflare Access **before first public exposure**. Protect `workers.dev` and preview URLs too, or disable those alternate access routes. Ensure only intended team members are allowed in.
2. Provision a **separate production** `PAYLOAD_SECRET` using `pnpm exec wrangler secret put PAYLOAD_SECRET` at the appropriate stage. Do not copy your local secret. Verify that this secret is actually present before traffic is served.
3. Test the first-user flow, signed-in media delivery, direct API restrictions, and owner/partner roles. An unclaimed first-user endpoint on the public internet is unsafe.
4. Inspect production migration effects and take a D1 backup; confirm paid plan coverage and bundle size.
5. Verify that the target hostname is protected. `igoola.com` does not currently appear as a zone in the connected Cloudflare account; `purkins.igoola.com` is not configured.

When those gates are met, the intentionally **interactive** command is:

```powershell
pnpm deploy
```

The command requires typing `DEPLOY PURKINS`; it then applies the committed schema migration to remote D1 and builds/deploys the Cloudflare Worker. The production subcommands reject direct execution without the confirmation guard.

The domain, Cloudflare Access, migrations against remote D1, and the production secret are **not** part of local testing. Do not treat a successful local build as permission to expose the administrator signup to the public internet.
