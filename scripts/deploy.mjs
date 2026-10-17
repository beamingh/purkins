import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

/**
 * Human-confirmed, local-only production deployment.
 * No GitHub Actions or automatic deployment is involved.
 */
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Purkins deployment requires an interactive terminal.')
  process.exit(1)
}

console.log(`
PURKINS PRODUCTION DEPLOYMENT

This applies the committed Payload migrations to the REAL Purkins D1
database and deploys the Worker from this computer.

Before continuing, verify:
- Cloudflare Access protects every public hostname, including workers.dev
  and preview URLs, or those alternate routes are disabled.
- The correct production PAYLOAD_SECRET is saved as a Cloudflare secret.
- The first-user setup and media/API access were tested locally.
- Cloudflare billing / Workers Paid compatibility has been verified.
- You have a current D1 backup and reviewed any schema changes.
`)

const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await rl.question('Type DEPLOY PURKINS to continue: ')
rl.close()
if (answer.trim() !== 'DEPLOY PURKINS') {
  console.log('Deployment cancelled. No database or Worker changes made.')
  process.exit(1)
}

const env = { ...process.env, PURKINS_DEPLOY_APPROVED: 'true' }
for (const script of ['deploy:database', 'deploy:app']) {
  console.log(`Running pnpm run ${script}...`)
  try {
    execSync(`pnpm run ${script}`, { env, stdio: 'inherit' })
  } catch (error) {
    console.error(`Stopped after ${script} failed. Do not retry blindly.`)
    process.exit(typeof error.status === 'number' ? error.status : 1)
  }
}
console.log('Deployment command completed; verify private access and functionality.')
