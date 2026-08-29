# BrainEvaluationExamples Schema Decision

Canonical system: `knowledge-brain` Disposition: `extend` Status: accepted for
the progressive pilot

## Purpose

Store only evaluation examples that a teammate explicitly saves while using Ask
Maestro. The ledger lets a real Apero evaluation set grow from an empty
workspace without automatically retaining every question or copying evidence
excerpts.

## Data Contract

- Tenant scope: `workspace`
- Sensitivity: `confidential`
- PII categories: `customer-content`
- Export: `redacted-json`
- Delete/redaction: `delete`
- Retention: `retain-until-workspace-delete`
- Append-only: `false`; exact `exampleKey` replay is idempotent and conflicting
  reuse is rejected
- Write authority: `packages/convex/confect/agents/assistant.impl.ts`
- Maximum evidence references per example: 10
- Evidence references contain only source key, immutable revision key, and
  content hash; saving reopens and verifies each revision
- New examples enter the rolling `development` split. A later reviewed process
  may freeze a time/source-separated `holdout`; clients cannot assign it.
- Full questions are retained only after `Useful`, `Needs work`, `Save as test`,
  or the CLI `--save-example` opt-in.

## Migration And Rollback

This is a new empty table, so no backfill or compatibility union is required.
Rollback removes the save-example operation and leaves existing rows available
for redacted export or workspace deletion. The table becomes necessary as soon
as the first teammate explicitly saves a real evaluation example; an empty table
remains a valid pre-pilot state.
