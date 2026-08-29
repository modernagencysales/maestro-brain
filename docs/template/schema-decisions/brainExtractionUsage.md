# BrainExtractionUsage Schema Decision

Canonical system: `knowledge-brain` Disposition: `extend` Status: active

## Purpose

Lightweight daily extraction token and spend reservations for Company Brain.

## Data Contract

- Tenant scope: `workspace`
- Sensitivity: `internal`
- PII categories: none
- Export: `json`
- Delete/redaction: `delete`
- Retention: `retain-until-workspace-delete`
- Append-only: `false`
- Write authority:
  `packages/convex/confect/capabilities/extractBrainKnowledgeCandidates.impl.ts`

## Migration And Rollback

The first extraction on a UTC day creates the workspace/day row. Existing
per-entry counters remain readable during the compatibility window, but new
admission, completion, failure, and stale-lease recovery use this lightweight
ledger so a 1,000-source corpus never requires loading full Markdown for budget
accounting. Rolling back leaves inert ledger rows that are deleted with the
workspace; no evidence or reviewed claims depend on them.
