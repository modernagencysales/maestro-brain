#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-maestro-template}"
PRODUCTION_BRANCH="${CLOUDFLARE_PAGES_PRODUCTION_BRANCH:-main}"

pnpm build
pnpm smoke:web-static
pnpm dlx wrangler@latest pages deploy apps/web/dist \
  --project-name "${PROJECT_NAME}" \
  --branch "${PRODUCTION_BRANCH}" \
  --commit-dirty=true
