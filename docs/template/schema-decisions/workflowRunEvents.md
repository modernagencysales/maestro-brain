# WorkflowRunEvents Schema Decision

Canonical system: `workflow-runtime` Disposition: `extend` Status: adopted

## Purpose

Store the ordered append-only event history that explains one durable workflow
run.

## Data Contract

- Tenant scope: `workspace`, inherited from the parent workflow run
- Sensitivity: `confidential`
- PII categories: customer content in redacted event payloads
- Export: `redacted-json`
- Delete/redaction: `retain-audit`
- Retention: `retain-audit-window`
- Append-only: `true`
- Write authority: `packages/convex/confect/workflows`

## Migration And Rollback

Existing events and their run-sequence indexes are adopted as-is. No sequence
renumbering or payload rewrite is permitted. Rollback disables new event writes
with the workflow runner and retains existing history with its parent run until
the audit window expires.
