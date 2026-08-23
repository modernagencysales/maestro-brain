# WorkflowRuns Schema Decision

Canonical system: `workflow-runtime` Disposition: `extend` Status: adopted

## Purpose

Own the durable lifecycle anchor for a workspace workflow: graph, status,
idempotency, principal and policy snapshots, timing, cleanup, and retention.

## Data Contract

- Tenant scope: `workspace`
- Sensitivity: `confidential`
- PII categories: server-derived identity and customer content
- Export: `redacted-json`
- Delete/redaction: `retain-audit`
- Retention: `retain-audit-window`
- Append-only: `false`; lifecycle and terminal state advance in place
- Write authority: `packages/convex/confect/workflows`

## Migration And Rollback

The existing standalone Brain table and indexes are adopted without row
conversion. The server continues to derive principals and workspace authority;
callers do not supply an authorization user ID. Rollback stops new runs, waits
for or explicitly cancels admitted work, and retains terminal rows and linked
evidence until the audit window expires.
