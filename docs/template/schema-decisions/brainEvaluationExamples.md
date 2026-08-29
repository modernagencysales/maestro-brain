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
- Explicit adjudication records only expected answerability, expected immutable
  evidence identities, and request risk. It does not store an expected prose
  answer or copy evidence excerpts.
- Adjudication uses `updatedAt` optimistic concurrency. Identical replay is
  idempotent; conflicting replay fails. Frozen holdout labels are immutable and
  hidden from ordinary reads.
- Freeze preview requires at least 25 adjudicated examples and selects exactly
  five test examples created at or after the chosen cutoff whose source keys do
  not occur in the earlier development slice. Apply is fenced by the preview
  hash and a stable freeze key. The preview hash binds each selected row's
  adjudicated status, immutable evidence identities, risk, and `updatedAt`, so
  any reviewed-gold change invalidates the apply request.
- Redacted export replaces questions with hashes, retains only immutable
  evidence identities for development examples, removes adjudicated gold from
  holdout examples, sorts deterministically, and includes an export hash.
- Full questions are retained only after `Useful`, `Needs work`, `Save as test`,
  or the CLI `--save-example` opt-in.

## Migration And Rollback

This is a new empty table, so no backfill or compatibility union is required.
Rollback removes the save-example operation and leaves existing rows available
for redacted export or workspace deletion. The table becomes necessary as soon
as the first teammate explicitly saves a real evaluation example; an empty table
remains a valid pre-pilot state.
