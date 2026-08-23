#!/usr/bin/env bash
set -euo pipefail

# Hosted agents are bare: install pinned node/pnpm and run frozen install.
source "$(dirname "$0")/setup.sh"

# Secretless self-protection: runs BEFORE any secret-bearing job so a PR that
# weakens the CI gate structure fails before credentialed code executes.
# check:ci-completeness pins the pipeline shape, gate package scripts, and hook
# config; do not grant this step any secrets.

pnpm check:ci-completeness
if [[ -f template-instance.json ]]; then
  echo "Generated customer target: skipping factory deploy authority verification."
else
  pnpm check:deploy-authority
fi
pnpm check:config-drift
pnpm check:workflow-semantics
pnpm check:convex-ai-files
pnpm check:agent-pack
pnpm check:app-map
pnpm check:gates
