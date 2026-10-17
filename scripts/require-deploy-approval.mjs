// Prevent accidental direct invocation of the production deployment sub-steps.
if (process.env.PURKINS_DEPLOY_APPROVED !== 'true') {
  console.error('Production operations are gated. Use "pnpm deploy" in an interactive terminal after following docs/LOCAL_DEVELOPMENT.md.')
  process.exit(1)
}
