#!/usr/bin/env bash
set -euo pipefail

# Hosted agents are bare: install pinned node/pnpm and run frozen install.
source "$(dirname "$0")/setup.sh"

COMMIT_SHA="${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}"
PROJECT_NAME="$(node scripts/_project-config.mjs get staging cloudflarePagesProject)"
BRANCH_NAME="$(node scripts/_project-config.mjs get staging cloudflareBranch)"

CONVEX_DEPLOY_KEY="${MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY:-}"
CLOUDFLARE_API_TOKEN="${MAESTRO_BRAIN_STAGING_CLOUDFLARE_API_TOKEN:-}"
CLOUDFLARE_ACCOUNT_ID="${MAESTRO_BRAIN_STAGING_CLOUDFLARE_ACCOUNT_ID:-}"
export CONVEX_DEPLOY_KEY CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

pnpm exec tsx tooling/release/src/index.ts deploy-doctor staging
pnpm exec tsx tooling/release/src/index.ts deploy-plan staging "${COMMIT_SHA}"

# Backend first: CONVEX_DEPLOY_KEY (validated by deploy-doctor) targets only
# the staging deployment. Tenant deploy paths must never seed demo/showcase.
(cd packages/convex && pnpm exec convex deploy -y)

VITE_CONVEX_URL="${VITE_CONVEX_URL:-$(node scripts/_project-config.mjs get staging convexUrl)}"
export VITE_CONVEX_URL

pnpm build
pnpm smoke:web-static
pnpm dlx wrangler@latest pages deploy apps/web/dist/client \
  --project-name "${PROJECT_NAME}" \
  --branch "${BRANCH_NAME}" \
  --commit-dirty=true

DEPLOYMENT_HASH="$(git rev-parse HEAD:packages/convex 2>/dev/null || git rev-parse HEAD)"
SCHEMA_HASH="$(git ls-files packages/convex/confect/tables packages/convex/convex/schema.ts | xargs git hash-object | git hash-object --stdin)"
MANIFEST_HASH="$(git hash-object project.config.json docs/template/env-manifest.json)"
BUILD_ID="${BUILDKITE_BUILD_ID:-local}"
RELEASE_PACKET="$(pnpm exec tsx tooling/release/src/index.ts staged-release-packet "${COMMIT_SHA}" "${DEPLOYMENT_HASH}" "${SCHEMA_HASH}" "${MANIFEST_HASH}" "${BUILD_ID}")"

if command -v buildkite-agent >/dev/null 2>&1; then
  buildkite-agent meta-data set staged-sha "${COMMIT_SHA}"
  buildkite-agent meta-data set staged-release-packet "${RELEASE_PACKET}"
fi
