# ProviderConnections Schema Decision

Canonical system: `provider-integrations` Disposition: `extend` Status: approved

## Purpose

Workspace provider authorization and redacted connection status

## Data Contract

- Tenant scope: `workspace`
- Sensitivity: `confidential`
- PII categories: none
- Export: `redacted-json`
- Delete/redaction: `delete`
- Retention: `retain-until-workspace-delete`
- Append-only: `false`
- Write authority: `packages/convex/confect/integrations/connections.impl.ts`

## Migration And Rollback

The table already contains live connection rows. Scheduled reconciliation adds
only optional fields: an enable flag, the approved Slack channel IDs, Shared
Drive/root IDs, HubSpot portal ID, and allowlist generation. Existing rows stay
valid and remain unscheduled until a user completes an explicit scoped sync.
Reauthorization clears the persisted scope before the connection can be
scheduled again. No data backfill is required.

`by_workspace_and_provider` remains the authoritative lookup for one provider
generation, `by_workspace_and_status` supports workspace status projections, and
the additive `by_status` index gives the bounded hourly dispatcher an indexed
active-connection scan. Rollback first disables the cron and scheduled actions,
then removes web scope callers. Persisted optional scope fields may be left in
place; removing them is safe only after the old scheduler can no longer run.
