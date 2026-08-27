#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_ENVIRONMENT:?DEPLOY_ENVIRONMENT is required}"
: "${CONVEX_DEPLOYMENT:?CONVEX_DEPLOYMENT is required}"

# Exercise the same authenticated sequence the hosted app runs immediately
# after login: provision the identity, resolve its workspace route, and resolve
# a foreign workspace. The final lookup must return null rather than throwing
# an expected access state as a generic Convex server error. A stable
# per-environment identity keeps this probe idempotent across deployments.
CANARY_SUBJECT="deployment-canary-${DEPLOY_ENVIRONMENT}"
CANARY_EMAIL="deployment-canary-${DEPLOY_ENVIRONMENT}@template.local"
CANARY_IDENTITY="$(CANARY_SUBJECT="${CANARY_SUBJECT}" CANARY_EMAIL="${CANARY_EMAIL}" node -e 'process.stdout.write(JSON.stringify({subject:process.env.CANARY_SUBJECT,email:process.env.CANARY_EMAIL,emailVerified:true,name:"Deployment Canary"}))')"

(cd packages/convex && pnpm exec convex run access/provisioning:ensureProvisioned '{"sessionEmail":"'"${CANARY_EMAIL}"'"}' --identity "${CANARY_IDENTITY}") >/dev/null

CANARY_ME="$(cd packages/convex && pnpm exec convex run auth/workspaces:me '{}' --identity "${CANARY_IDENTITY}")"
export CANARY_ME
CANARY_SLUG="$(node -e 'const result=JSON.parse(process.env.CANARY_ME); const slug=result?.workspaces?.[0]?.slug; if(typeof slug!=="string"||slug.length===0) throw new Error("Authenticated canary has no workspace slug"); process.stdout.write(slug)')"
CANARY_OWN_ARGS="$(CANARY_SLUG="${CANARY_SLUG}" node -e 'process.stdout.write(JSON.stringify({slug:process.env.CANARY_SLUG}))')"
CANARY_OWN_RESULT="$(cd packages/convex && pnpm exec convex run auth/workspaces:bySlug "${CANARY_OWN_ARGS}" --identity "${CANARY_IDENTITY}")"
export CANARY_OWN_RESULT CANARY_SLUG
node -e 'const result=JSON.parse(process.env.CANARY_OWN_RESULT); if(result?.slug!==process.env.CANARY_SLUG) throw new Error("Authenticated workspace route canary failed")'

CANARY_FOREIGN_RESULT="$(cd packages/convex && pnpm exec convex run auth/workspaces:bySlug '{"slug":"demo-showcase"}' --identity "${CANARY_IDENTITY}")"
export CANARY_FOREIGN_RESULT
node -e 'const result=JSON.parse(process.env.CANARY_FOREIGN_RESULT); if(result!==null) throw new Error("Foreign workspace route canary must return null")'
