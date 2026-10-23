# Retired: separate Purkins staging plan

**Superseded on 23 October 2026.** Purkins will have **one permanent
Cloudflare storefront, one permanent D1 database, and one set of R2 buckets**.
The site starts in a noindex prelaunch phase and later switches to public
production **without migrating or replacing its stored inventory**.

The old proposal to create `purkins-dev`, `purkins-dev-db` and
`purkins-dev-*` buckets is cancelled. Do not follow the old commands.

See [Purkins prelaunch → production](./purkins-prelaunch-to-production.md)
for the current provisioning, security, indexing and promotion plan.
