# WorkflowRunLinks Schema Decision

Canonical system: `workflow-runtime` Disposition: `extend` Status: adopted

## Purpose

Persist workspace-owned parent-child workflow relationships, idempotency,
status, and bounded child results.

## Data Contract

- Tenant scope: `workspace`
- Sensitivity: `confidential`
- PII categories: customer content in redacted child results
- Export: `redacted-json`
- Delete/redaction: `retain-audit`
- Retention: `retain-audit-window`
- Append-only: `false`; link status advances with the child run
- Write authority: `packages/convex/confect/workflows`

## Migration And Rollback

Existing links and indexes are adopted without changing their identities.
Rollback prevents new child starts before disabling link updates, then keeps the
links available for parent-run explanation and cleanup until both linked runs
have reached their retention boundary.
