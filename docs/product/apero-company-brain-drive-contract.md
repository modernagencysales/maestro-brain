# Apero Company Brain Google Drive Source Contract

**Status:** frozen for WP05 fixture implementation

**Source type:** one explicitly selected Shared Drive with a bounded set of
folder roots. Personal My Drive ingestion is rejected.

## Identity And Scope

- `connectorScopeKey` is derived from connection key/generation, Shared Drive
  ID, the sorted unique root-folder IDs, and allowlist generation.
- Provider object identity is the Drive file ID. Folder membership is a
  versioned scope edge and is not part of object identity.
- A file admitted through two connector scopes has two membership edges and two
  publication subjects. The immutable object revision may be shared, but its
  eligibility and current publication pointers are not.
- Shortcuts are unsupported in the first slice. They become eligible only after
  independent target-revision and scope-membership proof exists.

## Revision And Observation Order

- A live file revision uses Drive's monotonic file `version`. Its revision key
  is `<fileId>:version:<version>` and its observation order is
  `file_version:<version>`.
- Equal version plus equal content and permission-snapshot hashes is a
  duplicate. Equal version with different evidence is a blocking conflict. A
  lower version is stale and never becomes current.
- Removal without a readable file version is accepted only from a successfully
  closed reconciliation epoch. Opaque change-page tokens are cursors, not
  revision order, and ingestion time is never used as a substitute.
- Trashed objects may tombstone immediately when Drive supplies the version.
  Move-out, access loss, and an ambiguous 404 require closed reconciliation.
- Recreation advances the source incarnation/lifecycle fence. A pre-tombstone
  effect cannot publish into the recreated incarnation.

## Content And Normalization

- Google Docs use a recorded `text/plain` export in the first slice.
- Plain text, Markdown, PDF, and DOCX are accepted only when the adapter
  supplies deterministic extracted text and records the source/export MIME
  types. ZIP files and every undeclared MIME type are visible coverage failures.
- Normalization version 1 applies Unicode NFC, LF line endings, trailing
  horizontal-whitespace removal, at most one blank line between blocks, and
  outer trim.
- Revisions record normalized content hash, permission/scope snapshot hash,
  provider and observed timestamps, provider locator, retention class, and
  normalization version. Tombstones contain no copied source text.

## Passage Contract

- Passages contain at most 8 KiB of normalized UTF-8 text.
- Splitting prefers paragraph, sentence, then UTF-8-safe character boundaries.
- Adjacent passages overlap only at a paragraph start and by at most 512 bytes.
- Every passage records heading path, ordinal, normalized UTF-8 byte offsets,
  content hash, and a stable key derived from those values plus the immutable
  provider revision.

## Cursor And Reconciliation

- Change cursors are owned by Drive, connector scope, connection generation, and
  allowlist generation.
- A fetched page is first bound to one immutable page envelope. The cursor
  advances only with all chunk receipts, observations, membership/seen markers,
  and ingestion obligations from that exact envelope.
- Full reconciliation follows
  `scan -> traversal_closed -> apply_removals -> drain_derived -> complete`.
  Partial traversal never infers deletion, and observations beyond the run's
  ledger high-water survive removal inference.

## Fixture Gate

The source-neutral fixture layer is covered by:

```bash
pnpm --dir packages/integrations test src/googleDrive/canonical.test.ts src/googleDrive/passages.test.ts
pnpm --dir packages/integrations typecheck
```

The live-provider exit gate additionally requires create, edit, move-out,
unshare, delete, duplicate, stale delivery, interrupted/complete reconciliation,
publication retry/rebuild, retrieval, and citation-open receipts from the exact
release SHA.
