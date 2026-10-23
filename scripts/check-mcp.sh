#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible Unix entrypoint. The npm script and Windows users invoke
# scripts/check-mcp.mjs directly; neither needs Bash or WSL.
root="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$root/scripts/check-mcp.mjs"
