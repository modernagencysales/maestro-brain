# WorkflowStageRuns Schema Decision

Canonical system: `workflow-runtime` Disposition: `extend` Status: adopted

## Purpose

Track bounded stage attempts, status, timing, errors, outputs, lifecycle
generation, and external-effect posture for a workflow run.

## Data Contract

- Tenant scope: `workspace`, inherited from the parent workflow run
- Sensitivity: `confidential`
- PII categories: customer content and provider metadata in redacted results
- Export: `redacted-json`
- Delete/redaction: `retain-audit`
- Retention: `retain-audit-window`
- Append-only: `false`; each admitted attempt advances to terminal state
- Write authority: `packages/convex/confect/workflows`

## Migration And Rollback

Existing stages and attempt indexes are adopted as-is. Rollback stops new stage
admission before disabling the runner and retains terminal attempt evidence with
its parent run. Ambiguous external effects remain subject to reservation and
reconciliation evidence rather than being retried during rollback.
