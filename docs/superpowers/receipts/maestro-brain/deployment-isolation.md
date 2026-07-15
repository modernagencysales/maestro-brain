# Maestro Brain Deployment Isolation Receipt

Status: product instance of template gap `TB-DEPLOY-ISOLATION-01`.

## Isolation Contract

- Staging Convex deployment: `maestro-brain-staging`; URL hash is recorded as
  `sha256:375b7f2b3eecfd2e442720f714f713ce7f1eea2cbd6b9b17c01c163b0b5f5f59`.
- Production Convex deployment: `maestro-brain-production`; URL hash is recorded
  as `sha256:7dfef32bc94c6bac192406b0da1d069cd78c29c2bc4c729f1d0ec3699d408c3f`.
- Staging deploy key env: `MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY`.
- Production deploy key env: `MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY`.
- Staging callback origin env: `MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN`.
- Production callback origin env: `MAESTRO_BRAIN_PRODUCTION_CALLBACK_ORIGIN`.
- Staging Cloudflare env names: `MAESTRO_BRAIN_STAGING_CLOUDFLARE_API_TOKEN`,
  `MAESTRO_BRAIN_STAGING_CLOUDFLARE_ACCOUNT_ID`.
- Production Cloudflare env names:
  `MAESTRO_BRAIN_PRODUCTION_CLOUDFLARE_API_TOKEN`,
  `MAESTRO_BRAIN_PRODUCTION_CLOUDFLARE_ACCOUNT_ID`.
- Release signing metadata: signer `MAESTRO_BRAIN_RELEASE_SIGNER`, key id
  `MAESTRO_BRAIN_RELEASE_SIGNING_KEY_ID`, secret
  `MAESTRO_BRAIN_RELEASE_SIGNING_SECRET`; owner `Deploy owner`, stored in CI
  secret storage only.

## Negative Controls

- `SharedBackendForbidden`: release tooling rejects matching staging/production
  Convex deploy names or URLs.
- `EnvironmentCredentialMismatch`: deploy doctor requires the target
  environment's namespaced secrets and callback origin, so production
  credentials do not satisfy staging.
- `DemoSeedForbidden`: tenant deploy scripts no longer invoke
  `demo/showcase:seed`.
- `UnstagedCommit`: production promotion requires an exact staged release packet
  and never defaults a missing staged SHA to the current SHA.
- `IncompatibleRollback`: rollback planning rejects schema or manifest contract
  mismatches and never performs a data down-migration.

## Promotion And Rollback Flow

1. Staging runs `deploy-doctor staging`, deploys the staging backend, builds the
   web app against the staging Convex URL, and emits a staged release packet
   with commit, deployment hash, schema hash, manifest hash, build ID, and
   timestamp.
2. Production runs `deploy-doctor production` and `promote-plan` with the exact
   staged release packet before deploying the production backend.
3. Rollback uses
   `rollback-plan <current-release-packet> <candidate-release-packet>` and only
   selects a prior binary with matching schema and manifest contracts.

Provider-backed `deploy:doctor staging` and `deploy:doctor production` remain
acceptance gates when real credentials are available; this lane records local
fake-safe proof only.

## Focused Local Receipt

- Negative cross-deploy attempts are covered by release-tooling tests for
  staging with production key metadata and production with staging key metadata.
- Command result transcript is recorded in the S00-T03 proof packet. Live
  `deploy:doctor staging` and `deploy:doctor production` are external acceptance
  receipts because credentials are unavailable in this lane.
- No-demo transcript: `.buildkite/scripts/staging-deploy.sh` and
  `.buildkite/scripts/production-promote.sh` contain no `demo/showcase:seed`
  invocation.
