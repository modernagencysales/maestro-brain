# WorkflowEventInstances Schema Decision

Canonical system: `workflow-runtime` Disposition: `extend` Status: adopted

## Purpose

Persist exact workspace, run, generation, event-definition, principal, delivery,
and cleanup state for a durable workflow event instance.

## Data Contract

- Tenant scope: `workspace`
- Sensitivity: `confidential`
- PII categories: identity inside the server-derived principal snapshot
- Export: `redacted-json`
- Delete/redaction: `retain-audit`
- Retention: `retain-audit-window`
- Append-only: `false`; delivery and cleanup state advance in place
- Write authority: `packages/convex/confect/workflows`

## Migration And Rollback

This table is adopted from the standalone Brain without reshaping stored rows.
The alpha.9 chassis registers its existing Confect table and indexes under
`workflow-runtime`. Rollback stops new event allocation and delivery before the
table is removed; residual rows remain inaccessible except through workspace-
authorized cleanup and audit paths until the retention window expires.
