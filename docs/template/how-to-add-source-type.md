# How To Add A Source Type

The current template does not ship a `template:add-source-type` generator. Add
the smallest schema, normalizer, persistence mapping, and tests directly. Do not
advertise this command until a checked-in generator owns it.

For call transcripts, use
[`how-to-add-transcript-connector.md`](./how-to-add-transcript-connector.md).
Transcript connectors reuse the canonical source-unit pipeline and do not need a
new source schema.

## Required Files

- Source intake schema.
- Normalizer.
- Storage policy.
- Brain ingestion mapping.
- Export/delete metadata.
- Tests and docs.

## Tests

- accepted and rejected content;
- provenance;
- workspace isolation;
- storage URL expiry;
- conversion status;
- Brain consumption.

## Gates

- `pnpm --dir packages/convex test source-intake-storage`
- `pnpm check:schema-migration-notes`
- `pnpm check:secret-canaries`
