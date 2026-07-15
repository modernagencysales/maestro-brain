# Maestro Brain Deployment Isolation Receipt

Status: product instance of template gap `TB-DEPLOY-ISOLATION-01`.

## Isolation Contract

- Staging Convex deployment: `maestro-brain-staging`; URL hash recorded by
  deploy doctor output only.
- Production Convex deployment: `maestro-brain-production`; URL hash recorded by
  deploy doctor output only.
- Staging deploy key env: `MAESTRO_BRAIN_STAGING_CONVEX_DEPLOY_KEY`.
- Production deploy key env: `MAESTRO_BRAIN_PRODUCTION_CONVEX_DEPLOY_KEY`.
- Staging callback origin env: `MAESTRO_BRAIN_STAGING_CALLBACK_ORIGIN`.
- Production callback origin env: `MAESTRO_BRAIN_PRODUCTION_CALLBACK_ORIGIN`.
- Staging Cloudflare env names: `MAESTRO_BRAIN_STAGING_CLOUDFLARE_API_TOKEN`,
  `MAESTRO_BRAIN_STAGING_CLOUDFLARE_ACCOUNT_ID`.
- Production Cloudflare env names:
  `MAESTRO_BRAIN_PRODUCTION_CLOUDFLARE_API_TOKEN`,
  `MAESTRO_BRAIN_PRODUCTION_CLOUDFLARE_ACCOUNT_ID`.

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
