# PageRevisions Schema Decision

Canonical system: `knowledge-brain` Disposition: `extend` Status: accepted

## Purpose

Immutable, workspace-scoped snapshots of every user-visible Brain page mutation.
The ledger makes stale-write rejection auditable and allows an older published
page state to be restored without overwriting history.

## Data Contract

- Tenant scope: `workspace`
- Sensitivity: `confidential`
- PII categories: `customer-content`
- Export: `markdown`
- Delete/redaction: `delete`
- Retention: `retain-until-workspace-delete`
- Append-only: `true`
- Write authority: `packages/convex/confect/brain/pages.spec.ts`

## Migration And Rollback

Existing `brainPages` rows remain readable because the added tree and lifecycle
fields are optional and receive compatible defaults in the page implementation.
New pages create an initial revision; subsequent content and metadata mutations
append one revision in the same transaction.

No speculative history is backfilled. A page created before this migration
begins its immutable history with its first post-migration mutation. The
`by_workspace_page_updated` index supports bounded page history and exact
restore lookup without crossing workspace boundaries.

Rollback stops new revision writes and removes the new public lifecycle
operations before removing the table. Existing `brainPages` rows remain the
current-state authority throughout that rollback; revision rows may be retained
until the workspace lifecycle process removes them.
