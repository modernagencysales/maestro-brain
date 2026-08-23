# WorkflowRunContextManifests Schema Decision

Canonical system: `workflow-runtime` Disposition: `extend` Status: adopted

## Purpose

Bind the source snapshots, policy snapshot, prompt reference, model receipt, and
canonical manifest hash used by one workflow run.

## Data Contract

- Tenant scope: `workspace`, inherited from the parent workflow run
- Sensitivity: `confidential`
- PII categories: customer content and provider metadata
- Export: `redacted-json`
- Delete/redaction: `retain-audit`
- Retention: `retain-audit-window`
- Append-only: `true`
- Write authority: `packages/convex/confect/workflows`

## Migration And Rollback

Existing manifests are adopted without backfill or field conversion. Readers
must resolve the parent run and its workspace before disclosure. Rollback stops
new manifest creation first and retains existing hash-bound manifests with their
parent runs until the reviewed audit window expires.
