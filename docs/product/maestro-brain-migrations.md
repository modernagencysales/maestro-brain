# Maestro Brain Migration Harness

S00-T04 adds the internal expand/backfill migration seam used before stable-key,
source-ledger, or contract-phase schema changes. It is a template-gap
resolution: the wrapper stays product-local until two real product migrations
prove the pattern is generic enough to promote.

## Contract

Named migrations are server-owned literals: `reserveStableKeys`,
`reserveBrainKeys`, and `reservePageKeys`. They are reserved only; this task
does not rewrite workspace, Brain, or page rows. The Confect surface is
internal-only and callers cannot pass raw functions, `reset`, `next`, arbitrary
cursors, or an unbounded batch size.

Execute and dry-run modes dispatch through the mounted `@convex-dev/migrations`
component wrapper. The harness supplies the fixed migration ref from its
allowlist and a capped batch size of 25. Resume authority is only the last
committed component cursor from the append-only receipt stream after release,
deployment, and schema preconditions match.

## Receipts

Each batch emits a redacted child batch receipt:

```ts
{
  (migrationName,
    mode,
    cursor,
    scanned,
    changed,
    skipped,
    failed,
    complete,
    startedAt,
    finishedAt);
}
```

Execute mode also appends parent release-migration receipts containing release
commit, schema before/after, parity checks, rollback owner, observation window,
deployment/build identifiers, actor fields, and cryptographic child receipt
hashes. Receipts store counts, cursors, and hashes only; they must not store row
payloads, provider payloads, tokens, prompts, or customer text.

## Safety rules

- Dry runs compute counts and never write product rows or receipts.
- Execute mode records `planned/running -> complete | failed` receipt state and
  failed runs resume only from the last committed component cursor.
- Cross-release/schema/deployment resume attempts, malformed failed cursors,
  concurrent starts, destructive expand/backfill definitions, and invalid batch
  sizes fail closed with typed errors.
- Rollback removes the internal wrapper only after proving no migration rows or
  receipts exist in the target deployment. Later product migrations must
  document their own dual-write, parity, contract, and rollback steps.
