# BrainExtractionScopeStats Schema Decision

Canonical system: `knowledge-brain` Disposition: `extend` Status: active

## Purpose

Lightweight exact grounding-quality aggregate by evidence scope and extraction
policy.

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

The table is introduced empty and accumulates exact grounding outcomes from new,
idempotently committed extraction runs. No full-corpus backfill is required:
pre-existing extraction rows remain readable and new policy/scope statistics
begin at zero. The compound index provides one bounded lookup per workspace,
provider, evidence scope, and extraction policy. Rollback removes the
circuit-breaker aggregate reads and writes before removing the table.
