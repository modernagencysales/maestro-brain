# BrainKnowledgeCandidates Schema Decision

Canonical system: `knowledge-brain` Disposition: `extend` Status: approved for
additive V1 rollout

## Purpose

Durable brainKnowledgeCandidates state owned by the knowledge-brain canonical
system.

## Data Contract

- Tenant scope: `workspace`
- Sensitivity: `confidential`
- PII categories: `customer-content`
- Export: `redacted-json`
- Delete/redaction: `delete`
- Retention: `retain-until-workspace-delete`
- Append-only: `false`
- Write authority:
  `packages/convex/confect/capabilities/extractBrainKnowledgeCandidates.spec.ts`
  for creation and
  `packages/convex/confect/capabilities/reviewBrainKnowledgeCandidate.spec.ts`
  for review transitions

## Migration And Rollback

This is a new derived-data table, so rollout is additive and requires no
backfill. Candidate creation is idempotent on the workspace-scoped receipt key.
Readers only expose candidates whose exact current retrieval entry has a
completed semantic projection for the same revision and extraction policy.

Review history is capped at 20 events per candidate. Exact evidence is capped at
one bounded citation in V1. These write-time invariants prevent either array
from becoming an unbounded child collection.

Rollback disables extraction and review, then removes candidate rows through the
workspace lifecycle authority. The source evidence remains canonical and can be
reprocessed later; candidates are never treated as company truth unless a
reviewer atomically creates a supported claim and citation.

The table is necessary because extraction output has a distinct provisional
lifecycle, idempotency identity, review revision, and rejection history. Those
properties do not belong on immutable evidence revisions or reviewed claims.

Required verification before activation:

- unique current evidence reopening for every visible candidate;
- zero visibility for running or failed semantic projections;
- workspace export emits redacted metadata and workspace deletion removes all
  candidate rows;
- replay preserves receipt identity, while a policy change creates a new receipt
  without modifying a reviewed candidate;
- rollback leaves existing evidence and reviewed claims readable.
