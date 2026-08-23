# WorkflowRunEvidenceSnapshots Schema Decision

Canonical system: `workflow-runtime` Disposition: `extend` Status: adopted

## Purpose

Preserve the exact source identifiers, titles, materiality, snapshot bytes, and
hash used to ground a workflow run.

## Data Contract

- Tenant scope: `workspace`, inherited from the parent workflow run
- Sensitivity: `confidential`
- PII categories: customer content
- Export: `redacted-json`
- Delete/redaction: `retain-audit`
- Retention: `retain-audit-window`
- Append-only: `true`
- Write authority: `packages/convex/confect/workflows`

## Migration And Rollback

Existing hash-bound snapshots are adopted without re-encoding. Rollback stops
new snapshot creation before disabling grounded workflow execution; retained
snapshots remain readable only through workspace-authorized audit and citation
paths until their parent run retention anchor expires.
